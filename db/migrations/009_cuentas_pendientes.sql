-- =====================================================================
-- Migracion 009 — Cuentas pendientes para el panel de plataforma
--
-- usuarios_sin_perfil() exige puede_gestionar_usuarios(), que a su vez
-- exige tener fila en la tabla usuario. El administrador de plataforma
-- no tiene ninguna, a proposito: no pertenece a ninguna empresa. Sin
-- esto, el panel no podria mostrarle las cuentas que estan esperando
-- que se les asigne una.
--
-- Tambien deja fuera de la lista a las cuentas que ya son
-- administradores de plataforma: tampoco van a tener fila en usuario
-- nunca, y aparecer ahi para siempre solo estorba.
-- =====================================================================

create or replace function usuarios_sin_perfil()
returns table (id uuid, correo text, creado timestamptz)
language sql stable security definer
set search_path = public, auth
as $$
  select a.id, a.email::text, a.created_at
  from auth.users a
  left join public.usuario u on u.id = a.id
  where u.id is null
    and not exists (select 1 from plataforma_admin pa where pa.cuenta_id = a.id)
    and (puede_gestionar_usuarios() or es_superadmin())
  order by a.created_at desc;
$$;

revoke all on function usuarios_sin_perfil() from public;
grant execute on function usuarios_sin_perfil() to authenticated;

-- Lista de administradores de plataforma, visible solo entre ellos.
create or replace function admins_plataforma()
returns table (correo text, nota text, desde date)
language sql stable security definer
set search_path = public, auth
as $$
  select a.email::text, pa.nota, pa.creado_en::date
  from plataforma_admin pa
  join auth.users a on a.id = pa.cuenta_id
  where auth.uid() is null or es_superadmin()
  order by pa.creado_en;
$$;

revoke all on function admins_plataforma() from public;
grant execute on function admins_plataforma() to authenticated;
