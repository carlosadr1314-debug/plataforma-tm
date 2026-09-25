-- =====================================================================
-- Correccion: proteccion del administrador raiz
--
-- Problema detectado en la prueba 5:
--   La condicion "old.id <> auth.uid()" se evalua como NULL cuando
--   auth.uid() es nulo (SQL Editor, llave de servicio). En SQL, una
--   comparacion contra NULL no es falsa: es NULL, y el IF no entra.
--   La proteccion se saltaba en silencio.
--
-- Solucion:
--   - "is distinct from" en lugar de "<>", que si maneja nulos.
--   - La proteccion aplica solo a usuarios autenticados. Las
--     operaciones con llave de servicio siguen permitidas, porque el
--     backoffice las necesita para mantenimiento.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Reparar el dato que la prueba alcanzo a modificar
-- ---------------------------------------------------------------------

update usuario set activo = true where es_admin_raiz;

select nombre, activo, es_admin_raiz from usuario where es_admin_raiz;
-- Debe devolver el administrador con activo = true

-- ---------------------------------------------------------------------
-- 2. Trigger corregido
-- ---------------------------------------------------------------------

create or replace function proteger_admin_raiz()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  quien uuid := auth.uid();
begin
  -- La proteccion aplica a usuarios autenticados. Las operaciones con
  -- llave de servicio (auth.uid() nulo) quedan fuera a proposito: el
  -- backoffice las requiere para tareas de mantenimiento.
  if quien is null then
    return coalesce(new, old);
  end if;

  if old.es_admin_raiz and old.id is distinct from quien then
    if tg_op = 'DELETE' then
      raise exception 'No se puede eliminar al administrador raiz';
    end if;
    if new.activo          is distinct from old.activo
    or new.perfil_id       is distinct from old.perfil_id
    or new.es_admin_raiz   is distinct from old.es_admin_raiz
    or new.agencia_id      is distinct from old.agencia_id then
      raise exception 'No se puede modificar al administrador raiz';
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Prueba correcta: simular un usuario autenticado
--
--    La prueba original no podia funcionar desde el SQL Editor, igual
--    que las pruebas de RLS. Hay que suplantar a un usuario real.
--    Todo va dentro de una transaccion que se revierte al final.
-- ---------------------------------------------------------------------

begin;

  -- Suplantar al usuario "Contacto Televia"
  select set_config(
    'request.jwt.claims',
    json_build_object(
      'sub',  (select id::text from usuario where nombre = 'Contacto Televia'),
      'role', 'authenticated'
    )::text,
    true
  );

  -- Confirmar que auth.uid() ya devuelve algo
  select auth.uid() as usuario_simulado;

  -- Esta instruccion DEBE fallar con
  -- "No se puede modificar al administrador raiz"
  update usuario set activo = false where es_admin_raiz;

rollback;

-- ---------------------------------------------------------------------
-- 4. Confirmar que el administrador siguio intacto
-- ---------------------------------------------------------------------

select nombre, activo, es_admin_raiz from usuario where es_admin_raiz;
