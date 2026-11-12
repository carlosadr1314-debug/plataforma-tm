-- =====================================================================
-- Migracion 006 — Jornada y seguimiento de ubicacion
--
-- El seguimiento NO corre libre: vive dentro de una jornada que el
-- promotor abre y cierra. Fuera de esa ventana no se guarda un solo
-- punto. Eso acota tres cosas a la vez: el consentimiento, el volumen
-- de datos y el consumo de bateria.
--
-- La bitacora de puntos es de solo agregar: no se actualiza ni se
-- borra desde la aplicacion. Un recorrido que se puede editar no
-- sirve como evidencia.
-- =====================================================================

-- =====================================================================
-- TIPOS
-- =====================================================================

do $$ begin
  create type motivo_fin_jornada as enum (
    'manual',       -- el promotor la cerro
    'supervisor',   -- la cerro la oficina
    'inactividad',  -- dejo de reportar y se cerro sola
    'fin_de_dia'    -- corte automatico por limite de horas
  );
exception when duplicate_object then null;
end $$;

-- =====================================================================
-- JORNADA
-- =====================================================================

create table if not exists jornada (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references organizacion(id) on delete cascade,
  usuario_id      uuid not null references usuario(id) on delete cascade,
  fecha           date not null,
  inicio          timestamptz not null default now(),
  fin             timestamptz,
  motivo_fin      motivo_fin_jornada,

  -- Resumen que se calcula al cerrar, para no recorrer miles de
  -- puntos cada vez que alguien abre un reporte.
  puntos          integer not null default 0,

  creado_en       timestamptz not null default now(),
  constraint jornada_fin_posterior check (fin is null or fin >= inicio)
);

-- Un promotor no puede traer dos jornadas abiertas al mismo tiempo.
-- Si puede tener varias en un dia (manana y tarde), por eso el indice
-- es parcial y no un unique sobre la fecha.
create unique index if not exists jornada_abierta_unica
  on jornada (usuario_id) where fin is null;

create index if not exists jornada_org_fecha_idx on jornada (organizacion_id, fecha);
create index if not exists jornada_usuario_fecha_idx on jornada (usuario_id, fecha desc);

-- =====================================================================
-- UBICACION
-- =====================================================================

create table if not exists ubicacion (
  id              bigint generated always as identity primary key,
  jornada_id      uuid not null references jornada(id) on delete cascade,
  usuario_id      uuid not null references usuario(id) on delete cascade,
  organizacion_id uuid not null references organizacion(id) on delete cascade,

  lat             double precision not null,
  lng             double precision not null,
  precision_m     real,          -- margen de error que reporta el telefono
  velocidad_kmh   real,
  rumbo           real,          -- grados, 0 = norte

  bateria         smallint,      -- 0 a 100; sirve para explicar huecos
  ubicacion_simulada boolean not null default false,

  -- Momento en que el telefono tomo el punto. Puede ser muy anterior
  -- a recibida_en si venia en la cola sin senal.
  capturada_en    timestamptz not null,
  recibida_en     timestamptz not null default now(),

  constraint ubicacion_lat_valida check (lat between -90 and 90),
  constraint ubicacion_lng_valida check (lng between -180 and 180),
  constraint ubicacion_bateria_valida check (bateria is null or bateria between 0 and 100)
);

-- Clave de sincronizacion: si el telefono reenvia un bloque que ya
-- habia llegado, el punto no se duplica. El envio usa
-- "on conflict do nothing".
create unique index if not exists ubicacion_sin_duplicados
  on ubicacion (jornada_id, capturada_en);

create index if not exists ubicacion_jornada_idx on ubicacion (jornada_id, capturada_en);
create index if not exists ubicacion_org_reciente_idx on ubicacion (organizacion_id, capturada_en desc);

-- =====================================================================
-- VISTA DE POSICION ACTUAL
--
-- security_invoker hace que la vista respete las politicas del que
-- consulta. Sin eso correria con los permisos del dueno y cualquiera
-- veria a todos los promotores de todas las organizaciones.
-- =====================================================================

create or replace view posicion_actual
with (security_invoker = true) as
select
  j.id              as jornada_id,
  j.usuario_id,
  u.nombre,
  u.telefono,
  j.fecha,
  j.inicio,
  p.lat,
  p.lng,
  p.precision_m,
  p.velocidad_kmh,
  p.bateria,
  p.ubicacion_simulada,
  p.capturada_en,
  case when p.capturada_en is null then null
       else round((extract(epoch from (now() - p.capturada_en)) / 60)::numeric, 1)
  end as minutos_sin_reportar
from jornada j
join usuario u on u.id = j.usuario_id
left join lateral (
  select lat, lng, precision_m, velocidad_kmh, bateria,
         ubicacion_simulada, capturada_en
  from ubicacion
  where jornada_id = j.id
  order by capturada_en desc
  limit 1
) p on true
where j.fin is null;

-- =====================================================================
-- FUNCIONES DE JORNADA
--
-- Son security invoker a proposito: corren con los permisos de quien
-- llama, asi que las politicas de abajo siguen aplicando.
-- =====================================================================

-- Idempotente: si ya hay una jornada abierta la devuelve en vez de
-- fallar. El telefono puede reintentar sin ensuciar la base.
create or replace function iniciar_jornada()
returns jornada
language plpgsql security invoker
set search_path = public
as $$
declare j jornada;
begin
  select * into j from jornada
   where usuario_id = auth.uid() and fin is null;
  if found then
    return j;
  end if;

  insert into jornada (organizacion_id, usuario_id, fecha)
  values (organizacion_actual(), auth.uid(),
          (now() at time zone 'America/Mexico_City')::date)
  returning * into j;

  return j;
end;
$$;

create or replace function cerrar_jornada(motivo motivo_fin_jornada default 'manual')
returns jornada
language plpgsql security invoker
set search_path = public
as $$
declare j jornada;
begin
  select * into j from jornada
   where usuario_id = auth.uid() and fin is null;
  if not found then
    return null;
  end if;

  update jornada
     set fin        = now(),
         motivo_fin = motivo,
         puntos     = (select count(*) from ubicacion where jornada_id = j.id)
   where id = j.id
  returning * into j;

  return j;
end;
$$;

-- Red de seguridad para el promotor que olvido cerrar. La corre la
-- oficina o una tarea programada. Es definer porque actua sobre
-- jornadas ajenas.
create or replace function cerrar_jornadas_olvidadas(limite_horas integer default 14)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare n integer;
begin
  with cerradas as (
    update jornada j
       set fin = coalesce(
                   (select max(capturada_en) from ubicacion where jornada_id = j.id),
                   j.inicio),
           motivo_fin = 'fin_de_dia',
           puntos = (select count(*) from ubicacion where jornada_id = j.id)
     where j.fin is null
       and j.inicio < now() - (limite_horas || ' hours')::interval
    returning 1)
  select count(*) into n from cerradas;
  return n;
end;
$$;

-- Retencion. Los recorridos crudos pesan: 50 promotores a un punto
-- por minuto son unos 24,000 registros al dia. Esto se corre
-- periodicamente con el plazo que acuerde el cliente.
create or replace function purgar_ubicaciones(dias integer default 30)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare n integer;
begin
  delete from ubicacion
   where capturada_en < now() - (dias || ' days')::interval;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Permisos de tabla. Supabase suele otorgarlos solo a las tablas
-- nuevas, pero dejarlo explicito evita un "permission denied" que
-- cuesta trabajo diagnosticar en remoto. Nota que no se concede
-- delete en ninguna de las dos, ni update sobre ubicacion.
grant select, insert, update on jornada   to authenticated;
grant select, insert         on ubicacion to authenticated;
grant select                 on posicion_actual to authenticated;
grant all on jornada, ubicacion to service_role;
grant select on posicion_actual to service_role;

revoke all on function cerrar_jornadas_olvidadas(integer) from public;
revoke all on function purgar_ubicaciones(integer) from public;
grant execute on function iniciar_jornada() to authenticated;
grant execute on function cerrar_jornada(motivo_fin_jornada) to authenticated;
grant execute on function cerrar_jornadas_olvidadas(integer) to authenticated;
grant execute on function purgar_ubicaciones(integer) to service_role;

-- =====================================================================
-- AISLAMIENTO
-- =====================================================================

alter table jornada   enable row level security;
alter table ubicacion enable row level security;

-- --- Jornada ---------------------------------------------------------

drop policy if exists jornada_lectura on jornada;
create policy jornada_lectura on jornada
  for select using (
    usuario_id = auth.uid()
    or (organizacion_id = organizacion_actual() and puede('ver_reportes'))
  );

-- Solo se abre jornada para uno mismo.
drop policy if exists jornada_insercion on jornada;
create policy jornada_insercion on jornada
  for insert with check (
    usuario_id = auth.uid()
    and organizacion_id = organizacion_actual()
  );

-- La cierra el propio promotor o quien programa itinerarios.
drop policy if exists jornada_cierre on jornada;
create policy jornada_cierre on jornada
  for update using (
    usuario_id = auth.uid()
    or (organizacion_id = organizacion_actual() and puede('gestionar_itinerarios'))
  ) with check (
    usuario_id = auth.uid()
    or (organizacion_id = organizacion_actual() and puede('gestionar_itinerarios'))
  );

-- Nadie borra jornadas desde la aplicacion. No hay politica de delete.

-- --- Ubicacion -------------------------------------------------------

drop policy if exists ubicacion_lectura on ubicacion;
create policy ubicacion_lectura on ubicacion
  for select using (
    usuario_id = auth.uid()
    or (organizacion_id = organizacion_actual() and puede('ver_reportes'))
  );

-- Solo se escriben puntos propios, y solo dentro de una jornada
-- propia que siga abierta. Cerrada la jornada, el recorrido queda fijo.
drop policy if exists ubicacion_insercion on ubicacion;
create policy ubicacion_insercion on ubicacion
  for insert with check (
    usuario_id = auth.uid()
    and organizacion_id = organizacion_actual()
    and exists (
      select 1 from jornada j
       where j.id = jornada_id
         and j.usuario_id = auth.uid()
         and j.fin is null
    )
  );

-- Sin politicas de update ni de delete: la bitacora es de solo agregar.

-- =====================================================================
-- ACTUALIZACION EN VIVO
--
-- Permite que el mapa de la consola se refresque solo cuando entra un
-- punto nuevo, en vez de estar consultando cada pocos segundos.
-- =====================================================================

do $$
begin
  alter publication supabase_realtime add table ubicacion;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table jornada;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
