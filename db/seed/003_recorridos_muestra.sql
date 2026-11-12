-- =====================================================================
-- Semilla 003 — Recorridos de muestra
--
-- Abre una jornada por promotor y genera el recorrido de las ultimas
-- horas, para poder ver el mapa con datos antes de que la aplicacion
-- movil este lista.
--
-- Se puede volver a correr: primero limpia las jornadas de muestra
-- del dia y las vuelve a generar desde la hora actual.
--
-- Los puntos van sobre calles reales de la Ciudad de Mexico, con
-- ruido de GPS, paradas en las tiendas y bateria que baja. Un
-- recorrido en linea recta y perfecta no sirve para probar el mapa.
-- =====================================================================

do $$
declare
  v_org        uuid;
  v_prom       record;
  v_jornada    uuid;

  -- Cada ruta es una lista de puntos por los que pasa el promotor:
  -- sale de una zona habitacional y va encadenando tiendas. Hay seis
  -- por zonas distintas de la ciudad para que los trazos no se
  -- encimen; si hay mas promotores que rutas, se reparten ciclicamente.
  v_rutas jsonb := $json$[
    [[19.3762,-99.1684],[19.3685,-99.1763],[19.3911,-99.1857],[19.3596,-99.1689]],
    [[19.4890,-99.1280],[19.4760,-99.1100],[19.4620,-99.1380],[19.4780,-99.1540]],
    [[19.3310,-99.1215],[19.3444,-99.1398],[19.3561,-99.1622],[19.3660,-99.1455]],
    [[19.4330,-99.1950],[19.4280,-99.1790],[19.4260,-99.1650],[19.4180,-99.1620]],
    [[19.4890,-99.2320],[19.4680,-99.2400],[19.4430,-99.2560],[19.4200,-99.2430]],
    [[19.2960,-99.1030],[19.2990,-99.1280],[19.3060,-99.1600],[19.3185,-99.1760]]
  ]$json$::jsonb;

  v_ruta       jsonb;
  v_n_rutas    int := jsonb_array_length(v_rutas);
  v_i          int := 0;

  v_tramos     int;
  v_t          int;
  v_paso       int;
  v_lat0       double precision;
  v_lng0       double precision;
  v_lat1       double precision;
  v_lng1       double precision;
  v_lat        double precision;
  v_lng        double precision;
  v_frac       double precision;

  v_inicio     timestamptz;
  v_momento    timestamptz;
  v_minuto     int;
  v_total_min  int;
  v_bateria    smallint;
  v_bat0       smallint;
  v_vel        real;
  v_rezago     int;
  v_parado     int;

  -- 45 puntos en movimiento y 15 detenido en cada tienda
  k_andando    constant int := 45;
  k_parado     constant int := 15;

  v_promotores int := 0;
begin
  -- --------------------------------------------------------------
  -- Limpieza antes de generar
  -- --------------------------------------------------------------
  -- Las de hoy se rehacen desde cero.
  delete from jornada
   where fecha = (now() at time zone 'America/Mexico_City')::date;

  -- Las que quedaron abiertas de dias anteriores se cierran, no se
  -- borran. El indice jornada_abierta_unica impide crear la nueva
  -- mientras exista otra abierta del mismo promotor, asi que sin
  -- esto la semilla truena al segundo dia.
  update jornada j
     set fin = coalesce((select max(capturada_en) from ubicacion where jornada_id = j.id), j.inicio),
         motivo_fin = 'fin_de_dia',
         puntos = (select count(*) from ubicacion where jornada_id = j.id)
   where j.fin is null;

  for v_prom in
    select u.id, u.nombre, u.organizacion_id
      from usuario u
      join perfil p on p.id = u.perfil_id
     where u.activo
       and (p.nombre ilike '%promotor%' or u.es_promotor)
     order by u.nombre
  loop
    v_promotores := v_promotores + 1;
    v_org  := v_prom.organizacion_id;
    v_ruta := v_rutas -> (v_i % v_n_rutas);
    v_i    := v_i + 1;

    -- Unos cubren tres paradas y otros dos: asi las horas de inicio y
    -- el numero de puntos no salen calcados entre promotores.
    v_tramos := least(jsonb_array_length(v_ruta) - 1, 2 + (v_i % 2));

    -- Cuanto se queda en cada tienda. Varia por promotor para que las
    -- horas de inicio no salgan todas iguales.
    v_parado := k_parado + (v_i * 5) % 13;

    v_total_min := v_tramos * (k_andando + v_parado);

    -- Minutos que lleva sin reportar. La mayoria al corriente, uno
    -- con un hueco corto y otro con uno largo, para que en el mapa
    -- se vean los tres estados y no todo en verde.
    v_rezago := case v_i % 5 when 2 then 8 when 4 then 78 else 0 end;

    -- Bateria con la que empezo la jornada: ni todos al 94.
    v_bat0 := (87 + (v_i * 7) % 12)::smallint;

    -- El ultimo punto queda "hace v_rezago minutos".
    v_inicio := now() - ((v_total_min + v_rezago) || ' minutes')::interval;

    insert into jornada (organizacion_id, usuario_id, fecha, inicio)
    values (v_org, v_prom.id,
            (now() at time zone 'America/Mexico_City')::date,
            v_inicio)
    returning id into v_jornada;

    v_minuto := 0;

    for v_t in 0 .. v_tramos - 1 loop
      v_lat0 := (v_ruta -> v_t ->> 0)::double precision;
      v_lng0 := (v_ruta -> v_t ->> 1)::double precision;
      v_lat1 := (v_ruta -> (v_t + 1) ->> 0)::double precision;
      v_lng1 := (v_ruta -> (v_t + 1) ->> 1)::double precision;

      -- ---- en camino ----
      for v_paso in 1 .. k_andando loop
        v_frac := v_paso::double precision / k_andando;

        -- Curva suave en vez de linea recta, mas una desviacion
        -- lateral para que el trazo siga algo parecido a calles.
        v_lat := v_lat0 + (v_lat1 - v_lat0) * v_frac
                 + sin(v_frac * pi()) * 0.0022 * (case when v_t % 2 = 0 then 1 else -1 end);
        v_lng := v_lng0 + (v_lng1 - v_lng0) * v_frac
                 + sin(v_frac * pi()) * 0.0016;

        -- Ruido de GPS: unos 15 metros
        v_lat := v_lat + (random() - 0.5) * 0.00028;
        v_lng := v_lng + (random() - 0.5) * 0.00028;

        v_minuto  := v_minuto + 1;
        v_momento := v_inicio + (v_minuto || ' minutes')::interval;
        v_bateria := greatest(12, v_bat0 - (v_minuto * 3 / 60))::smallint;  -- ~3% por hora
        v_vel     := (16 + random() * 26)::real;

        insert into ubicacion (
          jornada_id, usuario_id, organizacion_id,
          lat, lng, precision_m, velocidad_kmh, rumbo,
          bateria, ubicacion_simulada, capturada_en, recibida_en)
        values (
          v_jornada, v_prom.id, v_org,
          v_lat, v_lng, (6 + random() * 14)::real, v_vel,
          (degrees(atan2(v_lng1 - v_lng0, v_lat1 - v_lat0)) + (random() - 0.5) * 30)::real,
          v_bateria, false, v_momento, v_momento + interval '3 seconds')
        on conflict do nothing;
      end loop;

      -- ---- detenido en la tienda ----
      for v_paso in 1 .. v_parado loop
        v_minuto  := v_minuto + 1;
        v_momento := v_inicio + (v_minuto || ' minutes')::interval;
        v_bateria := greatest(12, v_bat0 - (v_minuto * 3 / 60))::smallint;

        insert into ubicacion (
          jornada_id, usuario_id, organizacion_id,
          lat, lng, precision_m, velocidad_kmh, rumbo,
          bateria, ubicacion_simulada, capturada_en, recibida_en)
        values (
          v_jornada, v_prom.id, v_org,
          v_lat1 + (random() - 0.5) * 0.00022,
          v_lng1 + (random() - 0.5) * 0.00022,
          (5 + random() * 9)::real, 0::real, null,
          v_bateria, false, v_momento, v_momento + interval '3 seconds')
        on conflict do nothing;
      end loop;
    end loop;

    raise notice 'Jornada de % — % puntos', v_prom.nombre, v_minuto;
  end loop;

  if v_promotores = 0 then
    raise exception 'No se encontro ningun usuario con perfil de promotor. '
                    'Crea al menos uno antes de correr esta semilla.';
  end if;

  raise notice 'Listo: % promotores con jornada abierta.', v_promotores;
end $$;

-- Comprobacion
select u.nombre,
       to_char(j.inicio at time zone 'America/Mexico_City', 'HH24:MI') as inicio,
       count(p.id)                                        as puntos,
       max(p.bateria)                                     as bateria_inicial,
       min(p.bateria)                                     as bateria_actual,
       round(extract(epoch from (now() - max(p.capturada_en)))::numeric / 60, 0)
                                                          as min_sin_reportar
  from jornada j
  join usuario u  on u.id = j.usuario_id
  left join ubicacion p on p.jornada_id = j.id
 where j.fin is null
 group by u.nombre, j.inicio
 order by u.nombre;
