-- =====================================================================
-- Migracion 019 — El promotor solo ve SU ruta
--
-- Fuga de verdad: cualquier promotor con clientes asignados veia los
-- itinerarios de TODOS los promotores de esos clientes. Dar de alta un
-- promotor nuevo y asignarle un cliente bastaba para que le
-- aparecieran las visitas ya hechas por otro.
--
-- La intencion siempre fue otra. El comentario de la 004 lo dice:
-- "El promotor, los suyos. La oficina, los de sus clientes". Pero las
-- tres ramas se sumaban con or, sin preguntar quien es quien:
--
--     i.usuario_id = auth.uid()                 <- el promotor
--  or i.cliente_id in (sus clientes asignados)  <- la oficina
--  or puede('admin')                            <- quien administra
--
-- y un promotor con clientes asignados cumple la segunda. La rama del
-- medio es para supervisores y coordinadores, que vigilan el trabajo
-- de un cliente completo; un promotor no vigila a nadie, ejecuta su
-- ruta.
--
-- Arrastra a visita, respuesta, evidencia y alerta_radio, que cuelgan
-- todas de esta funcion. Es decir: el promotor nuevo tambien veia las
-- respuestas de formulario y las fotos del otro.
-- =====================================================================

create or replace function itinerarios_visibles()
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select i.id
  from itinerario i
  join pdv v on v.id = i.pdv_id
  where
    -- El promotor: su propia ruta y nada mas. Que ademas tenga
    -- clientes asignados no lo convierte en supervisor de ellos.
    i.usuario_id = auth.uid()

    or (
      not es_promotor()
      and (
        -- Quien tiene clientes asignados, dentro de su region si la trae.
        ( i.cliente_id in (select cliente_id from usuario_cliente
                           where usuario_id = auth.uid())
          and v.organizacion_id = (select organizacion_id from usuario
                                   where id = auth.uid())
          and ( (select region_id from usuario where id = auth.uid()) is null
                or v.region_id = (select region_id from usuario where id = auth.uid()) ) )

        -- Quien administra, con todo lo de su empresa.
        or ( puede('admin')
             and v.organizacion_id = (select organizacion_id from usuario
                                      where id = auth.uid())
             and ( (select region_id from usuario where id = auth.uid()) is null
                   or v.region_id = (select region_id from usuario where id = auth.uid()) ) )
      )
    );
$$;

comment on function itinerarios_visibles() is
  'Itinerarios que el usuario actual puede leer. El promotor, SOLO los '
  'suyos, tenga o no clientes asignados. Quien no es promotor: los de '
  'sus clientes asignados y, con el permiso admin, todos los de su '
  'empresa; la region, cuando la trae, acota las dos.';
