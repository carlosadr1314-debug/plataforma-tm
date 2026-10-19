-- =====================================================================
-- Migracion 005 — Cuentas pendientes de perfil
--
-- Crear una cuenta de acceso requiere la llave de servicio, que nunca
-- puede estar en el navegador. El alta queda en dos tiempos: la cuenta
-- se crea en el panel de Supabase y la consola completa su perfil.
--
-- Esta funcion es lo que permite a la consola ver que cuentas existen
-- en autenticacion pero todavia no tienen perfil asignado.
--
-- Ejecutar DESPUES de 004.
-- =====================================================================

create or replace function usuarios_sin_perfil()
returns table (id uuid, correo text, creado timestamptz)
language sql
stable
security definer
set search_path = public, auth
as $$
  select a.id, a.email::text, a.created_at
  from auth.users a
  left join public.usuario u on u.id = a.id
  where u.id is null
    and puede('admin')
  order by a.created_at desc;
$$;

revoke all on function usuarios_sin_perfil() from public;
grant execute on function usuarios_sin_perfil() to authenticated;

-- =====================================================================
-- VERIFICACION
-- =====================================================================

-- La funcion existe
select proname, prosecdef as es_security_definer
from pg_proc where proname = 'usuarios_sin_perfil';

-- Un administrador ve las cuentas pendientes.
-- Si todas las cuentas ya tienen perfil, devuelve cero filas: es correcto.
begin;
  select set_config('request.jwt.claims',
    json_build_object(
      'sub',  (select id::text from usuario where nombre = 'Administrador Apatayana'),
      'role', 'authenticated')::text, true);
  set local role authenticated;
  select * from usuarios_sin_perfil();
rollback;

-- Un promotor no ve ninguna, aunque existan.
begin;
  select set_config('request.jwt.claims',
    json_build_object(
      'sub',  (select id::text from usuario where nombre = 'Promotor de prueba'),
      'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) as debe_ser_cero from usuarios_sin_perfil();
rollback;
