-- =====================================================================
-- Migracion 018 — Una jornada por dia
--
-- El indice de la 006 era parcial: impedia tener dos jornadas
-- ABIERTAS a la vez, no dos jornadas. Cerrar y volver a hacer
-- check-in abria otra, y otra. En una tarde de pruebas salieron seis
-- del mismo dia.
--
-- Eso rompe mas de lo que parece. El check-in de seguridad existe para
-- responder "¿a que hora salio de su casa?", y con seis jornadas la
-- pregunta ya no tiene una respuesta. Lo mismo la comida, que cuelga
-- de una jornada: cual de las seis.
--
-- Mismo criterio que la comida en la 017: se acota por usuario y
-- fecha. Y el check-in deja de reabrir: una vez cerrada la jornada del
-- dia, se devuelve tal cual esta para que la aplicacion lo diga, en
-- lugar de empezar otra a escondidas.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Juntar las que ya se duplicaron
--
--    No se borran a secas: traen puntos de rastreo, evidencia y
--    comidas colgando. Se mueve todo a la primera del dia y luego se
--    quitan las demas. Perder el rastro de una tarde por limpiar un
--    indice seria un mal negocio.
-- ---------------------------------------------------------------------

create temporary table jornada_canonica as
select distinct on (usuario_id, fecha)
       id as se_queda, usuario_id, fecha
  from jornada
 order by usuario_id, fecha, inicio;

-- Con que hora cierra la jornada que se queda. Se calcula AHORA, con
-- todas las del dia todavia a la vista, y se aplica hasta el final:
-- si se escribiera antes de borrar las otras, al reabrir la primera
-- habria dos abiertas a la vez por un instante y el indice de la 006
-- lo rechaza.
--
-- Hereda el cierre mas tardio del grupo. Salvo que alguna siguiera
-- abierta: si el promotor esta a media tarde con su jornada en curso,
-- consolidar no es motivo para darle el dia por terminado.
create temporary table jornada_cierre as
select c.se_queda,
       case when bool_or(t.fin is null) then null else max(t.fin) end as fin_real
  from jornada_canonica c
  join jornada t on t.usuario_id = c.usuario_id and t.fecha = c.fecha
 group by c.se_queda;

create temporary table jornada_sobrante as
select j.id as se_va, c.se_queda
  from jornada j
  join jornada_canonica c
    on c.usuario_id = j.usuario_id and c.fecha = j.fecha
 where j.id <> c.se_queda;

-- Los puntos de rastreo y la evidencia se mudan.
update ubicacion u set jornada_id = s.se_queda
  from jornada_sobrante s where u.jornada_id = s.se_va;

update evidencia e set jornada_id = s.se_queda
  from jornada_sobrante s where e.jornada_id = s.se_va;

-- Las comidas tambien, salvo que la que se queda ya tenga una: el
-- indice de la 017 es una comida por dia y hay que respetarlo.
update comida c set jornada_id = s.se_queda
  from jornada_sobrante s
 where c.jornada_id = s.se_va
   and not exists (select 1 from comida otra where otra.jornada_id = s.se_queda);

delete from comida c using jornada_sobrante s where c.jornada_id = s.se_va;

delete from jornada j using jornada_sobrante s where j.id = s.se_va;

-- Ahora si, ya sin competencia por el indice de las abiertas.
update jornada j
   set fin = x.fin_real
  from jornada_cierre x
 where j.id = x.se_queda
   and j.id in (select se_queda from jornada_sobrante)
   and j.fin is distinct from x.fin_real;

-- El resumen de puntos queda mal despues de mudar ubicaciones.
update jornada j
   set puntos = (select count(*) from ubicacion u where u.jornada_id = j.id)
 where j.id in (select se_queda from jornada_sobrante);

-- ---------------------------------------------------------------------
-- 2. Que no vuelva a pasar
-- ---------------------------------------------------------------------

create unique index if not exists jornada_una_por_dia
  on jornada (usuario_id, fecha);

comment on index jornada_una_por_dia is
  'Una jornada por promotor y por dia. El indice viejo era parcial '
  '(solo sobre las abiertas) y permitia cerrar y abrir otra.';

-- ---------------------------------------------------------------------
-- 3. El check-in ya no reabre
--
--    Devuelve la jornada del dia como este. Si ya se cerro, se
--    devuelve cerrada y la aplicacion lo dice; antes, al no encontrar
--    ninguna ABIERTA, insertaba una nueva sin avisar.
-- ---------------------------------------------------------------------

create or replace function check_in_seguridad(
  p_lat double precision default null,
  p_lng double precision default null,
  p_precision double precision default null
)
returns jornada
language plpgsql security invoker
set search_path = public
as $$
declare
  j   jornada;
  hoy date := (now() at time zone 'America/Mexico_City')::date;
begin
  select * into j from jornada
   where usuario_id = auth.uid() and fecha = hoy;

  if found then
    -- Ya cerro su dia: se devuelve tal cual. Reabrirla seria borrar la
    -- hora a la que termino.
    if j.fin is not null then
      return j;
    end if;

    -- Abierta pero sin check-in: se completa en vez de abrir otra.
    -- Pasa cuando el telefono reintenta sin señal.
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
  values (organizacion_actual(), auth.uid(), hoy,
          now(), p_lat, p_lng, p_precision)
  returning * into j;

  return j;
end;
$$;

comment on function check_in_seguridad(double precision, double precision, double precision) is
  'Abre el dia del promotor dejando constancia de donde estaba. Una por '
  'dia: si ya existe la devuelve como este, cerrada incluida, y nunca '
  'la reabre.';
