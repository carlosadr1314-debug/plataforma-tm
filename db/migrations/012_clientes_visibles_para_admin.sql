-- =====================================================================
-- Migracion 012 — El administrador ve los clientes de su empresa
--
-- clientes_visibles() devolvia unicamente los clientes asignados a uno
-- en usuario_cliente. Esa tabla existe para limitar a los usuarios de
-- perfil Cliente y a los promotores a sus marcas, no para cegar a quien
-- administra.
--
-- El efecto era este: cliente_alta deja insertar con puede('admin'),
-- pero cliente_lectura filtra por clientes_visibles(). Un administrador
-- daba de alta un cliente, la base lo guardaba, y la pantalla seguia
-- diciendo "Sin clientes" —el insert pasaba y el select no—. El
-- segundo intento fallaba con "ya tienes un cliente con ese nombre",
-- hablando de un cliente que no se veia por ningun lado.
--
-- Y como de cliente cuelgan el catalogo, los formularios y los
-- itinerarios, una empresa recien dada de alta no podia salir de ahi:
-- el unico lugar donde se asignan clientes a un usuario es la pantalla
-- de Usuarios, que necesita que ya existan clientes.
--
-- El arreglo: quien tiene 'admin' ve los clientes de su empresa. Los
-- demas siguen viendo solo los suyos. La frontera entre empresas no se
-- toca: sigue siendo organizacion_id, y la prueba de aislamiento lo
-- comprueba.
-- =====================================================================

create or replace function clientes_visibles()
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select cliente_id
    from usuario_cliente
   where usuario_id = auth.uid()
  union
  select c.id
    from cliente c
   where c.organizacion_id = organizacion_actual()
     and puede('admin')
$$;

comment on function clientes_visibles() is
  'Clientes que el usuario actual puede leer: los asignados en '
  'usuario_cliente, mas todos los de su empresa si tiene el permiso admin.';
