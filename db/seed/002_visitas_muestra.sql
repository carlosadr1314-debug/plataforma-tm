-- =====================================================================
-- Datos de muestra: visitas de la ultima semana  (version corregida)
--
-- Correcciones respecto de la version anterior:
--   · El contador de fotografias reutilizaba la variable del contador
--     de paradas, de modo que a partir de la segunda tienda del dia el
--     indice se salia del rango y la hora de entrada quedaba nula.
--   · Las horas se guardaban en horario universal. Ahora se registran
--     en horario de Mexico, que es como las vera quien supervisa.
--   · La visita en curso se coloca en el ultimo dia habil generado, no
--     en la fecha de hoy, para que exista aunque se corra en fin de
--     semana.
--
-- Se puede volver a ejecutar: limpia lo que genero antes.
-- ATENCION: son datos ficticios. Borrarlos antes de operar de verdad.
-- =====================================================================

-- Los disparadores impiden tocar una visita cerrada. Para poder limpiar
-- una corrida anterior hay que apartarlos un momento.
alter table respuesta disable trigger tg_respuesta_visita_cerrada;
alter table evidencia disable trigger tg_evidencia_visita_cerrada;

do $$
declare
  v_zona      text := 'America/Mexico_City';
  v_cliente   uuid := '22222222-2222-2222-2222-222222222222';
  v_promotor  uuid;
  v_tarea     uuid;
  v_form      uuid;
  v_pdv       record;
  v_preg      record;
  v_opcion    uuid;
  v_it        uuid;
  v_vis       uuid;
  v_dia       date;
  v_ultimo    date;
  v_horas     time[] := array['09:00','11:30','16:00']::time[];
  v_parada    int;
  v_foto      int;
  v_n         int := 0;
  v_entrada   timestamptz;
  v_salida    timestamptz;
  v_dist      numeric;
  v_estado    estado_visita;
  v_cuantas   int;
begin
  -- --- requisitos -----------------------------------------------------
  select id into v_promotor
  from usuario where es_promotor and activo order by nombre limit 1;
  if v_promotor is null then
    raise exception 'No hay ningun promotor activo. Crea uno antes de correr esto.';
  end if;

  select id into v_form
  from formulario where cliente_id = v_cliente and not es_plantilla and activo
  order by creado_en limit 1;
  if v_form is null then
    raise exception 'No hay formulario para el cliente. Crea uno antes de correr esto.';
  end if;

  select id into v_tarea from tarea where cliente_id = v_cliente
  order by vigencia_ini desc limit 1;
  if v_tarea is null then
    insert into tarea (cliente_id, formulario_id, nombre, vigencia_ini, vigencia_fin)
    values (v_cliente, v_form, 'Activacion de temporada',
            current_date - 30, current_date + 60)
    returning id into v_tarea;
  end if;

  -- ultimo dia habil del periodo, para colocar ahi la visita en curso
  select max(d::date) into v_ultimo
  from generate_series(current_date - 6, current_date, '1 day') d
  where extract(isodow from d) <= 5;

  -- --- limpieza de corridas anteriores --------------------------------
  delete from itinerario
  where cliente_id = v_cliente
    and usuario_id = v_promotor
    and fecha_programada between current_date - 6 and current_date;

  -- --- generacion -----------------------------------------------------
  for v_dia in
    select d::date from generate_series(current_date - 6, current_date, '1 day') d
    where extract(isodow from d) <= 5           -- solo de lunes a viernes
  loop
    v_parada := 0;

    for v_pdv in
      select p.id, p.lat, p.lng
      from pdv p
      join cliente_pdv cp on cp.pdv_id = p.id
      where cp.cliente_id = v_cliente and p.activo
      order by p.codigo
      limit 3
    loop
      v_parada := v_parada + 1;
      v_n := v_n + 1;

      insert into itinerario (cliente_id, usuario_id, pdv_id, tarea_id,
                              fecha_programada, secuencia, hora_estimada)
      values (v_cliente, v_promotor, v_pdv.id, v_tarea,
              v_dia, 1, v_horas[v_parada])
      returning id into v_it;

      -- La ultima parada del ultimo dia habil queda en curso; una de
      -- cada ocho no se realiza. El resto se completan.
      if v_dia = v_ultimo and v_parada = 3 then
        v_estado := 'en_curso';
      elsif v_n % 8 = 0 then
        v_estado := 'no_realizada';
      else
        v_estado := 'completada';
      end if;

      if v_estado = 'no_realizada' then
        insert into visita (itinerario_id, estado, id_local, motivo_no_visita)
        values (v_it, 'no_realizada', gen_random_uuid(),
                'Tienda cerrada por remodelacion');
        continue;
      end if;

      -- distancia a la tienda; una de cada nueve queda fuera del radio
      v_dist := case when v_n % 9 = 0
                     then 180 + (v_n % 5) * 70
                     else 12 + (v_n % 7) * 11 end;

      -- las horas se registran en horario de Mexico
      v_entrada := ((v_dia + v_horas[v_parada]) at time zone v_zona)
                   + ((v_n % 17) || ' minutes')::interval;
      v_salida  := v_entrada + ((18 + (v_n % 23)) || ' minutes')::interval;

      insert into visita (
        itinerario_id, estado, id_local,
        check_in, check_in_lat, check_in_lng, check_in_precision,
        ubicacion_simulada, distancia_pdv, minutos_desfase, sincronizada_en
      ) values (
        v_it, 'en_curso', gen_random_uuid(),
        v_entrada,
        coalesce(v_pdv.lat, 19.43) + (v_dist / 111000.0),
        coalesce(v_pdv.lng, -99.14) + (v_dist / 111000.0),
        6 + (v_n % 9),
        false, v_dist, (v_n % 17),
        case when v_estado = 'completada' then v_salida + interval '4 minutes' end
      ) returning id into v_vis;

      if v_estado <> 'completada' then
        continue;                 -- la visita en curso se queda abierta
      end if;

      -- --- respuestas al formulario -----------------------------------
      for v_preg in
        select id, tipo from pregunta where formulario_id = v_form order by orden
      loop
        if v_preg.tipo = 'booleano' then
          insert into respuesta (visita_id, pregunta_id, valor_bool)
          values (v_vis, v_preg.id, true);

        elsif v_preg.tipo = 'existencia_sku' then
          insert into respuesta (visita_id, pregunta_id, valor_bool)
          values (v_vis, v_preg.id, (v_n % 4 <> 0));

        elsif v_preg.tipo = 'precio_sku' then
          insert into respuesta (visita_id, pregunta_id, valor_numero)
          values (v_vis, v_preg.id, 198 + (v_n % 6) * 9);

        elsif v_preg.tipo = 'numero' then
          insert into respuesta (visita_id, pregunta_id, valor_numero)
          values (v_vis, v_preg.id, 3 + (v_n % 12));

        elsif v_preg.tipo in ('opcion_unica','opcion_multiple') then
          select count(*) into v_cuantas
          from opcion_pregunta where pregunta_id = v_preg.id;
          if v_cuantas > 0 then
            select id into v_opcion from opcion_pregunta
            where pregunta_id = v_preg.id order by orden
            offset (v_n % v_cuantas) limit 1;
            insert into respuesta (visita_id, pregunta_id, valor_opcion)
            values (v_vis, v_preg.id, to_jsonb(array[v_opcion::text]));
          end if;

        elsif v_preg.tipo = 'firma' then
          insert into respuesta (visita_id, pregunta_id, valor_texto)
          values (v_vis, v_preg.id, 'Encargado de tienda');

        elsif v_preg.tipo = 'texto' then
          insert into respuesta (visita_id, pregunta_id, valor_texto)
          values (v_vis, v_preg.id, 'Sin observaciones.');

        elsif v_preg.tipo = 'fecha' then
          insert into respuesta (visita_id, pregunta_id, valor_fecha)
          values (v_vis, v_preg.id, v_dia);

        elsif v_preg.tipo = 'codigo_barras' then
          insert into respuesta (visita_id, pregunta_id, valor_texto)
          values (v_vis, v_preg.id, '750123400001' || (v_n % 10)::text);
        end if;
      end loop;

      -- --- evidencia fotografica --------------------------------------
      for v_foto in 1..(2 + (v_n % 4)) loop
        insert into evidencia (visita_id, storage_path, bytes, lat, lng, tomada_en)
        values (
          v_vis,
          '11111111-1111-1111-1111-111111111111/' || v_cliente || '/' ||
            v_vis || '/' || gen_random_uuid() || '.jpg',
          160000 + (v_n * 1300 + v_foto * 4100) % 90000,
          coalesce(v_pdv.lat, 19.43), coalesce(v_pdv.lng, -99.14),
          v_entrada + (v_foto || ' minutes')::interval
        );
      end loop;

      -- cerrar al final: el disparador impide cambios despues del cierre
      update visita set estado = 'completada', check_out = v_salida
      where id = v_vis;

    end loop;
  end loop;

  raise notice 'Visitas de muestra generadas: %', v_n;
end $$;

alter table respuesta enable trigger tg_respuesta_visita_cerrada;
alter table evidencia enable trigger tg_evidencia_visita_cerrada;

-- =====================================================================
-- VERIFICACION
-- =====================================================================

-- Ninguna visita completada debe quedar sin hora de entrada
select count(*) as completadas_sin_hora
from visita where estado = 'completada' and check_in is null;

-- Resumen por dia, con las horas ya en horario de Mexico
select i.fecha_programada,
       count(*)                                           as total,
       count(*) filter (where v.estado = 'completada')     as completadas,
       count(*) filter (where v.estado = 'en_curso')       as en_curso,
       count(*) filter (where v.estado = 'no_realizada')   as no_realizadas,
       count(*) filter (where v.distancia_pdv > 150)       as fuera_de_radio,
       min(v.check_in at time zone 'America/Mexico_City')::time as primera_entrada
from visita v
join itinerario i on i.id = v.itinerario_id
group by i.fecha_programada
order by i.fecha_programada;
