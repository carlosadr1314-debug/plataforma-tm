-- =====================================================================
-- Migracion 015 — El promotor ve los clientes de su propia ruta
--
-- Tercera vez que aparece el mismo hueco, y conviene nombrarlo antes
-- de que salga una cuarta: las funciones de visibilidad daban por
-- hecho que usuario_cliente siempre esta llena. No lo esta.
--
--   · 012: el administrador no es promotor de nada y nadie le asigna
--          clientes, asi que no veia ninguno.
--   · 014: lo mismo en itinerarios_visibles().
--   · 015: el promotor que tiene ruta pero a quien nadie le asigno el
--          cliente a mano.
--
-- Esta tercera no habia dado la cara porque los paneles del promotor
-- cuelgan de itinerarios_visibles(), no de clientes_visibles(). Donde
-- si importa es al subir evidencia: la politica del bucket exige que
-- el segundo segmento de la ruta —el cliente— este en
-- clientes_visibles(). Sin esto, el promotor toma la foto, la foto se
-- queda en el telefono y el servidor la rechaza sin que nadie se
-- entere hasta que la marca pregunta por su evidencia.
--
-- El criterio correcto no es "que alguien se acuerde de asignarlo",
-- sino el hecho: si el promotor tiene en su ruta un punto de venta de
-- ese cliente, ese cliente lo tiene a la vista. La asignacion a mano
-- sigue valiendo para todo lo demas.
-- =====================================================================

create or replace function clientes_visibles()
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  -- Los asignados a mano.
  select cliente_id
    from usuario_cliente
   where usuario_id = auth.uid()

  union

  -- Toda la empresa, para quien administra.
  select c.id
    from cliente c
   where c.organizacion_id = organizacion_actual()
     and puede('admin')

  union

  -- Los de la propia ruta. Se acota a la empresa del usuario por si
  -- un itinerario quedara mal armado: la ruta no es una puerta para
  -- salirse de su organizacion.
  select i.cliente_id
    from itinerario i
    join cliente c on c.id = i.cliente_id
   where i.usuario_id = auth.uid()
     and c.organizacion_id = organizacion_actual()
$$;

comment on function clientes_visibles() is
  'Clientes que el usuario actual puede leer: los asignados en '
  'usuario_cliente, todos los de su empresa si tiene el permiso admin, '
  'y los de los puntos de venta que trae en su propia ruta.';
