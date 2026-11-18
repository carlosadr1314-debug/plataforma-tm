-- =====================================================================
-- Migracion 010 — Correo del administrador y datos de acceso
--
-- Dos cosas:
--
-- 1. resumen_empresas() no devolvia con que correo entra cada
--    empresa, asi que el panel no podia mostrarlo.
--
-- 2. correo_de_usuario(): para que la consola pueda mostrar el correo
--    de alguien de su propio equipo sin darle acceso a auth.users,
--    que trae las cuentas de TODAS las empresas.
-- =====================================================================

-- Cambia las columnas que devuelve, asi que hay que tirarla antes:
-- Postgres no deja reemplazar una funcion con otra forma de salida.
drop function if exists resumen_empresas();

create or replace function resumen_empresas()
returns table (
  empresa       text,
  codigo        text,
  alta          date,
  administrador text,
  correo        text,
  usuarios      bigint,
  clientes      bigint,
  puntos_venta  bigint
)
language sql stable security definer
set search_path = public, auth
as $$
  select o.nombre, o.slug, o.creado_en::date,
         r.nombre,
         a.email::text,
         (select count(*) from usuario u where u.organizacion_id = o.id),
         (select count(*) from cliente c where c.organizacion_id = o.id),
         (select count(*) from pdv p where p.organizacion_id = o.id)
  from organizacion o
  left join usuario r on r.organizacion_id = o.id and r.es_admin_raiz
  left join auth.users a on a.id = r.id
  where auth.uid() is null or es_superadmin()
  order by o.creado_en;
$$;

revoke all on function resumen_empresas() from public;
grant execute on function resumen_empresas() to authenticated;

-- Correo de alguien del propio equipo. Devuelve nulo para cualquiera
-- de otra empresa, asi que no sirve para espiar: la restriccion esta
-- aqui dentro y no depende de que la pantalla filtre bien.
create or replace function correo_de_usuario(p_usuario uuid)
returns text
language sql stable security definer
set search_path = public, auth
as $$
  select a.email::text
  from usuario u
  join auth.users a on a.id = u.id
  where u.id = p_usuario
    and u.organizacion_id = organizacion_actual();
$$;

revoke all on function correo_de_usuario(uuid) from public;
grant execute on function correo_de_usuario(uuid) to authenticated;
