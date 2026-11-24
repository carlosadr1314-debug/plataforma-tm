-- =====================================================================
-- Migracion 017 — Una comida al dia y las alertas de radio
--
-- Tres cosas:
--
--   · La comida es una al dia. El indice de la 016 solo impedia tener
--     dos ABIERTAS a la vez, asi que al terminar una se podia empezar
--     otra, y otra. Eso no es un descuido del promotor: es un hueco.
--
--   · Las alertas de radio. Hasta ahora el radio solo servia para
--     dejar o no INICIAR la visita. Si el promotor se iba a medio
--     trabajo, nadie se enteraba: los puntos del rastreo quedaban ahi,
--     pero nadie los compara contra el punto de venta.
--
--   · El reporte de exceso de comida, con sus dos minutos de gracia.
--     La gracia vive aqui y no en la pantalla para que el numero sea
--     el mismo en todos lados, y para que se pueda auditar por que un
--     dia se reporto y otro no.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Una comida por promotor y por dia
--
--    Se acota por usuario y fecha, no por jornada: cerrar la jornada y
--    volver a abrirla el mismo dia daria derecho a otra comida, y eso
--    es justo lo que se quiere evitar.
-- ---------------------------------------------------------------------

alter table comida add column if not exists usuario_id uuid references usuario(id) on delete cascade;
alter table comida add column if not exists fecha date;

-- Se copian de la jornada en vez de pedirselos a quien inserta: si el
-- telefono los mandara, podria mandarlos mal.
create or replace function comida_completar()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  select j.usuario_id, j.fecha into new.usuario_id, new.fecha
    from jornada j where j.id = new.jornada_id;
  return new;
end;
$$;

drop trigger if exists comida_completar_tr on comida;
create trigger comida_completar_tr
  before insert on comida
  for each row execute function comida_completar();

-- Las que ya existan se completan antes de poner el indice.
update comida c
   set usuario_id = j.usuario_id, fecha = j.fecha
  from jornada j
 where j.id = c.jornada_id
   and (c.usuario_id is null or c.fecha is null);

-- Si de las de antes quedaran repetidas, se dejan solo las primeras:
-- el indice no entraria con duplicados y la migracion se caeria a la
-- mitad.
delete from comida c
 using comida otra
 where c.usuario_id = otra.usuario_id
   and c.fecha = otra.fecha
   and c.inicio > otra.inicio;

create unique index if not exists comida_una_por_dia
  on comida (usuario_id, fecha);

comment on index comida_una_por_dia is
  'Una comida por promotor y por dia. Acotado por usuario y fecha y no '
  'por jornada, porque cerrar y reabrir la jornada daria derecho a otra.';

-- ---------------------------------------------------------------------
-- 2. Las alertas de radio
--
--    Un renglon por salida: cuando se fue, cuando volvio y que tan
--    lejos llego. Se cuelga del itinerario y no de la visita porque es
--    lo que el telefono conoce sin preguntar: la visita puede no
--    existir todavia cuando la alerta se registra.
-- ---------------------------------------------------------------------

create table if not exists alerta_radio (
  id             uuid primary key default gen_random_uuid(),
  itinerario_id  uuid not null references itinerario(id) on delete cascade,
  salio_en       timestamptz not null,
  volvio_en      timestamptz,
  distancia_max  integer not null,
  lat            double precision,
  lng            double precision,
  avisada        boolean not null default false,
  registrada_en  timestamptz not null default now(),
  constraint alerta_volvio_posterior check (volvio_en is null or volvio_en >= salio_en)
);

create index if not exists alerta_radio_itinerario_idx
  on alerta_radio (itinerario_id, salio_en);

-- El telefono manda la misma alerta mas de una vez mientras el
-- promotor sigue afuera —va actualizando hasta donde llego— asi que se
-- necesita poder reenviarla sin duplicar.
create unique index if not exists alerta_radio_unica
  on alerta_radio (itinerario_id, salio_en);

comment on table alerta_radio is
  'Veces que el promotor se alejo del punto de venta con la visita en '
  'curso. Una por salida, con la distancia maxima a la que llego.';

alter table alerta_radio enable row level security;

-- Quien ve la visita ve sus alertas. El promotor escribe las suyas.
drop policy if exists alerta_radio_lectura on alerta_radio;
create policy alerta_radio_lectura on alerta_radio
  for select using (itinerario_id in (select itinerarios_visibles()));

drop policy if exists alerta_radio_alta on alerta_radio;
create policy alerta_radio_alta on alerta_radio
  for insert with check (
    itinerario_id in (select id from itinerario where usuario_id = auth.uid())
  );

-- Actualizar solo lo suyo, y solo para cerrar la salida o corregir
-- hasta donde llego.
drop policy if exists alerta_radio_cierre on alerta_radio;
create policy alerta_radio_cierre on alerta_radio
  for update using (
    itinerario_id in (select id from itinerario where usuario_id = auth.uid())
  ) with check (
    itinerario_id in (select id from itinerario where usuario_id = auth.uid())
  );

-- ---------------------------------------------------------------------
-- 3. El reporte de comida
--
--    Los dos minutos de gracia viven aqui. Que esten en un solo lugar
--    importa por dos razones: el numero sale igual en cualquier
--    pantalla que lo consulte, y el dia que haya que cambiarlo se
--    cambia una vez.
--
--    El promotor no ve esto. En su telefono el contador cuenta contra
--    los minutos que se le asignaron, a secas; la gracia es criterio
--    de la oficina al revisar, no tiempo extra que se le regale.
-- ---------------------------------------------------------------------

create or replace function gracia_comida_min()
returns integer language sql immutable as $$ select 2 $$;

comment on function gracia_comida_min() is
  'Minutos de tolerancia antes de reportar un exceso de comida. No se '
  'le muestran al promotor: su contador corre contra lo asignado.';

-- security_invoker NO es opcional: sin el, la vista corre con los
-- permisos de su dueño y se salta el RLS de comida y jornada. Una
-- empresa veria las comidas de otra, que es exactamente lo que todo
-- el aislamiento esta montado para impedir.
create or replace view comida_reporte
with (security_invoker = true) as
select
  c.id,
  c.jornada_id,
  c.usuario_id,
  u.nombre              as promotor,
  j.organizacion_id,
  c.fecha,
  c.inicio,
  c.fin,
  c.minutos_asignados,
  -- Una comida sin cerrar se mide contra el reloj: si el promotor no
  -- volvio, el exceso sigue creciendo y el reporte tiene que decirlo.
  greatest(0, round(extract(epoch from (coalesce(c.fin, now()) - c.inicio)) / 60)::integer)
                        as minutos_tomados,
  c.fin is null         as abierta,
  greatest(0,
    round(extract(epoch from (coalesce(c.fin, now()) - c.inicio)) / 60)::integer
    - c.minutos_asignados - gracia_comida_min())
                        as minutos_de_mas
from comida c
join jornada j on j.id = c.jornada_id
join usuario u on u.id = c.usuario_id;

comment on view comida_reporte is
  'Comidas con lo que duraron y cuanto se pasaron, ya descontada la '
  'gracia. Una comida sin cerrar se mide contra el reloj.';

-- La vista hereda las politicas de comida y jornada, pero hay que
-- poder leerla.
grant select on comida_reporte to authenticated;
grant execute on function gracia_comida_min() to authenticated;
