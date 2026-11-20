-- =====================================================================
-- Migracion 014 — El administrador ve las visitas de su empresa
--
-- Mismo hueco que arreglo la 012, en la otra funcion de visibilidad.
-- itinerarios_visibles() devolvia:
--
--   · los itinerarios propios (el promotor ve su ruta), o
--   · los de los clientes asignados en usuario_cliente
--
-- Un administrador no es el promotor de nada y nadie le asigna
-- clientes, asi que caia fuera de las dos. El resultado era que un
-- promotor completaba su visita, la base la guardaba, y el panel de
-- Visitas seguia en cero.
--
-- Por que no se noto antes: itinerario tiene ademas una politica
-- "for all" para gestionar rutas, y en Postgres las politicas se
-- suman, asi que el administrador SI veia los itinerarios. visita no
-- tiene esa segunda politica y se quedaba colgada nada mas de
-- itinerarios_visibles(). De ahi lo confuso del sintoma: la ruta se
-- veia completa y las visitas no aparecian por ningun lado.
--
-- El arreglo es el mismo criterio de la 012: quien tiene 'admin' ve lo
-- de su empresa. Si ademas trae region asignada, solo lo de su region,
-- igual que ya pasaba con los clientes asignados.
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
    -- El promotor, con su propia ruta.
    i.usuario_id = auth.uid()

    -- Quien tiene clientes asignados, dentro de su region si la trae.
    or ( i.cliente_id in (select cliente_id from usuario_cliente
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
               or v.region_id = (select region_id from usuario where id = auth.uid()) ) );
$$;

comment on function itinerarios_visibles() is
  'Itinerarios que el usuario actual puede leer: los suyos si es promotor, '
  'los de sus clientes asignados, y todos los de su empresa si tiene el '
  'permiso admin. La region, cuando la trae, acota las tres.';
