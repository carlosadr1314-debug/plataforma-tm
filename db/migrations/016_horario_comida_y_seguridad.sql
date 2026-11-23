-- =====================================================================
-- Migracion 016 — Horario, comida y check-in de seguridad
--
-- Cuatro cosas que van juntas porque describen el dia del promotor, no
-- la visita:
--
--   · El horario que le toca cumplir, como plantilla semanal.
--   · El check-in de seguridad con el que abre el dia. Reemplaza al
--     "iniciar jornada" a secas: ahora es obligatorio, lleva ubicacion
--     y tiene que hacerse antes de la primera visita.
--   · La comida, con su contador y su foto de regreso.
--   · La evidencia etiquetada por tipo, para poder distinguir la foto
--     de una pregunta del formulario de la de llegada al punto de
--     venta o la del regreso de comer.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. El horario del promotor
--
--    Plantilla semanal: un renglon por dia que trabaja. Los dias que
--    no trabaja simplemente no tienen renglon, que es mas claro que
--    guardar ceros.
-- ---------------------------------------------------------------------

create table if not exists horario_promotor (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references organizacion(id) on delete cascade,
  usuario_id      uuid not null references usuario(id) on delete cascade,

  -- 0 = domingo, como extract(dow). Es lo que usa Postgres, y
  -- traducirlo en dos lados es una fuente de errores de un dia.
  dia_semana      smallint not null check (dia_semana between 0 and 6),

  entrada         time not null,
  salida          time not null,
  minutos_comida  integer not null default 60
                    check (minutos_comida between 0 and 240),

  creado_en       timestamptz not null default now(),

  constraint horario_salida_posterior check (salida > entrada),
  unique (usuario_id, dia_semana)
);

create index if not exists horario_usuario_idx on horario_promotor (usuario_id);

comment on table horario_promotor is
  'Horario semanal que le toca cumplir a cada promotor. Un renglon por '
  'dia trabajado; los dias libres no tienen renglon.';

-- ---------------------------------------------------------------------
-- 2. El check-in de seguridad
--
--    La jornada ya existia. Lo que cambia es como se abre: antes
--    bastaba con tocar un boton, ahora se registra donde estaba el
--    promotor al hacerlo. Es un registro de seguridad: sirve para
--    saber que salio de casa y desde donde, antes de que llegue a la
--    primera tienda.
-- ---------------------------------------------------------------------

alter table jornada add column if not exists check_in_seguridad timestamptz;
alter table jornada add column if not exists seguridad_lat       double precision;
alter table jornada add column if not exists seguridad_lng       double precision;
alter table jornada add column if not exists seguridad_precision double precision;

comment on column jornada.check_in_seguridad is
  'Cuando el promotor hizo su check-in de seguridad. Null en jornadas '
  'anteriores a esta migracion, que se abrieron con el boton viejo.';

-- Abre el dia dejando constancia de donde estaba. Idempotente, igual
-- que iniciar_jornada(): el telefono puede reintentar sin ensuciar.
create or replace function check_in_seguridad(
  p_lat double precision default null,
  p_lng double precision default null,
  p_precision double precision default null
)
returns jornada
language plpgsql security invoker
set search_path = public
as $$
declare j jornada;
begin
  select * into j from jornada
   where usuario_id = auth.uid() and fin is null;

  if found then
    -- Ya habia una jornada abierta sin check-in: se completa en vez de
    -- abrir otra. Pasa cuando el telefono reintenta sin señal.
    if j.check_in_seguridad is null then
      update jornada
         set check_in_seguridad = now(),
             seguridad_lat = p_lat, seguridad_lng = p_lng,
             seguridad_precision = p_precision
       where id = j.id
      returning * into j;
    end if;
    return j;
  end if;

  insert into jornada (organizacion_id, usuario_id, fecha,
                       check_in_seguridad, seguridad_lat, seguridad_lng,
                       seguridad_precision)
  values (organizacion_actual(), auth.uid(),
          (now() at time zone 'America/Mexico_City')::date,
          now(), p_lat, p_lng, p_precision)
  returning * into j;

  return j;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. La comida
--
--    Un renglon por comida tomada. Se guarda cuantos minutos le
--    tocaban al momento de tomarla, no se consulta el horario al
--    leerla: si manana le cambian el horario, lo que paso hoy no debe
--    cambiar de sentido.
-- ---------------------------------------------------------------------

create table if not exists comida (
  id                 uuid primary key default gen_random_uuid(),
  jornada_id         uuid not null references jornada(id) on delete cascade,
  inicio             timestamptz not null default now(),
  fin                timestamptz,
  minutos_asignados  integer not null check (minutos_asignados between 0 and 240),
  creado_en          timestamptz not null default now(),
  constraint comida_fin_posterior check (fin is null or fin >= inicio)
);

-- No se puede estar en dos comidas a la vez.
create unique index if not exists comida_abierta_unica
  on comida (jornada_id) where fin is null;

create index if not exists comida_jornada_idx on comida (jornada_id, inicio);

comment on table comida is
  'Tiempo de comida del promotor. minutos_asignados se congela al '
  'iniciarla: un cambio de horario posterior no reescribe el pasado.';

-- ---------------------------------------------------------------------
-- 4. La evidencia, etiquetada
--
--    Hasta ahora toda la evidencia colgaba de una visita y de una
--    pregunta del formulario. Ya no: la foto de regreso de comer
--    cuelga de la jornada y no tiene pregunta, y la de llegada al
--    punto de venta cuelga de la visita pero tampoco tiene pregunta.
--    Sin una etiqueta, en el panel serian todas "una foto mas".
-- ---------------------------------------------------------------------

alter table evidencia add column if not exists tipo text not null default 'pregunta';
alter table evidencia add column if not exists jornada_id uuid
  references jornada(id) on delete cascade;

alter table evidencia alter column visita_id drop not null;

do $$ begin
  alter table evidencia add constraint evidencia_tipo_conocido
    check (tipo in ('pregunta', 'inicio_visita', 'regreso_comida', 'check_in_seguridad'));
exception when duplicate_object then null; end $$;

-- Toda evidencia cuelga de algo: de una visita o de una jornada.
do $$ begin
  alter table evidencia add constraint evidencia_pertenece_a_algo
    check (visita_id is not null or jornada_id is not null);
exception when duplicate_object then null; end $$;

create index if not exists evidencia_jornada_idx on evidencia (jornada_id);

comment on column evidencia.tipo is
  'De que es la foto: pregunta del formulario, llegada al punto de '
  'venta, regreso de comer o check-in de seguridad.';

-- ---------------------------------------------------------------------
-- 5. Quien ve y quien escribe
-- ---------------------------------------------------------------------

alter table horario_promotor enable row level security;
alter table comida           enable row level security;

-- El promotor ve el suyo; quien administra, el de toda su empresa.
drop policy if exists horario_lectura on horario_promotor;
create policy horario_lectura on horario_promotor
  for select using (
    usuario_id = auth.uid()
    or (organizacion_id = organizacion_actual() and puede('admin'))
  );

-- Escribirlo es cosa de la oficina. Un promotor que pudiera moverse su
-- propio horario volveria inutil el registro de cumplimiento.
drop policy if exists horario_escritura on horario_promotor;
create policy horario_escritura on horario_promotor
  for all using (organizacion_id = organizacion_actual() and puede('admin'))
      with check (organizacion_id = organizacion_actual() and puede('admin'));

-- La comida la maneja el propio promotor dentro de su jornada.
drop policy if exists comida_propia on comida;
create policy comida_propia on comida
  for all using (
    jornada_id in (select id from jornada where usuario_id = auth.uid())
  ) with check (
    jornada_id in (select id from jornada where usuario_id = auth.uid())
  );

-- Y la oficina la lee.
drop policy if exists comida_lectura_oficina on comida;
create policy comida_lectura_oficina on comida
  for select using (
    jornada_id in (select id from jornada
                    where organizacion_id = organizacion_actual()
                      and puede('admin'))
  );

-- La evidencia de jornada: el promotor escribe la suya, la oficina lee
-- la de su empresa. Las politicas se suman a las que ya habia para la
-- evidencia de visita, no las reemplazan.
drop policy if exists evidencia_jornada_alta on evidencia;
create policy evidencia_jornada_alta on evidencia
  for insert with check (
    jornada_id in (select id from jornada where usuario_id = auth.uid())
  );

drop policy if exists evidencia_jornada_lectura on evidencia;
create policy evidencia_jornada_lectura on evidencia
  for select using (
    jornada_id in (select id from jornada
                    where usuario_id = auth.uid()
                       or (organizacion_id = organizacion_actual() and puede('admin')))
  );

-- ---------------------------------------------------------------------
-- 6. El bucket, para lo que no cuelga de una visita
--
--    La convencion de ruta era <organizacion>/<cliente>/<visita>/...
--    y la foto de regreso de comer no tiene cliente ni visita. Se le
--    da la suya: <organizacion>/jornada/<jornada_id>/<archivo>.
--    "jornada" va literal en el segundo segmento, que es donde las
--    politicas viejas esperan un cliente: asi no se confunden.
-- ---------------------------------------------------------------------

drop policy if exists evidencia_jornada_bucket_lectura on storage.objects;
create policy evidencia_jornada_bucket_lectura on storage.objects
for select to authenticated
using (
  bucket_id = 'evidencia'
  and (storage.foldername(name))[1] = organizacion_actual()::text
  and (storage.foldername(name))[2] = 'jornada'
  and (storage.foldername(name))[3] in (
    select j.id::text from jornada j
     where j.usuario_id = auth.uid()
        or (j.organizacion_id = organizacion_actual() and puede('admin'))
  )
);

drop policy if exists evidencia_jornada_bucket_escritura on storage.objects;
create policy evidencia_jornada_bucket_escritura on storage.objects
for insert to authenticated
with check (
  bucket_id = 'evidencia'
  and (storage.foldername(name))[1] = organizacion_actual()::text
  and (storage.foldername(name))[2] = 'jornada'
  and (storage.foldername(name))[3] in (
    select j.id::text from jornada j where j.usuario_id = auth.uid()
  )
);

-- ---------------------------------------------------------------------
-- 7. El horario de hoy, para la pantalla de resumen
--
--    Devuelve lo que le toca al promotor en la fecha pedida, o nada si
--    ese dia no trabaja. Se resuelve en la base para que el telefono
--    no tenga que saber como se numeran los dias.
-- ---------------------------------------------------------------------

create or replace function mi_horario(p_fecha date default null)
returns table (
  fecha          date,
  entrada        time,
  salida         time,
  minutos_comida integer
)
language sql stable security invoker
set search_path = public
as $$
  select f.d, h.entrada, h.salida, h.minutos_comida
    from (select coalesce(p_fecha,
                 (now() at time zone 'America/Mexico_City')::date) as d) f
    join horario_promotor h
      on h.usuario_id = auth.uid()
     and h.dia_semana = extract(dow from f.d)::smallint;
$$;

grant execute on function check_in_seguridad(double precision, double precision, double precision)
  to authenticated;
grant execute on function mi_horario(date) to authenticated;
