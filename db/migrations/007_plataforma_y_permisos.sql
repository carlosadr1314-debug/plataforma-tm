-- =====================================================================
-- Migracion 007 — Nivel de plataforma y permisos explicitos
--
-- Tres cambios de fondo:
--
-- 1. Aparece un nivel arriba de la organizacion. Hasta ahora las
--    organizaciones se metian a mano en la semilla. Ahora hay
--    administradores de plataforma que las pueden crear.
--
-- 2. 'admin' deja de ser llave maestra. Antes bastaba tener esa clave
--    para poder todo; ahora cada perfil lista lo que puede. Se ve en
--    la tabla en vez de depender de una palabra magica.
--
-- 3. Dar de alta usuarios se separa del resto de la administracion.
--    Por omision solo el administrador raiz de cada empresa puede
--    hacerlo, y se le puede delegar a un administrador normal.
--
-- Tambien deja preparado el acceso del promotor desde la aplicacion
-- con codigo de empleado y NIP, sin que vea nunca un correo.
--
-- A TENER PRESENTE DE AQUI EN ADELANTE
-- Como 'admin' ya no concede todo, cada permiso nuevo que se invente
-- hay que agregarlo a mano a los perfiles que deban tenerlo. Antes
-- aparecia solo para los administradores; ahora no. Es el precio de
-- que los permisos se puedan leer en la tabla, y vale la pena, pero
-- se olvida facil: si un boton nuevo "no le sirve al administrador",
-- lo primero que hay que revisar es si su perfil trae la clave.
-- =====================================================================

-- =====================================================================
-- 1. CODIGO DE EMPRESA
--
-- La aplicacion movil lo pide una sola vez al instalarse. De ahi sale
-- el ambiente al que pertenece el telefono, y con el, el correo
-- interno que la aplicacion arma sola para iniciar sesion.
-- =====================================================================

alter table organizacion add column if not exists slug text;

-- Derivarlo del nombre para las organizaciones que ya existen:
-- minusculas, sin acentos, sin espacios.
update organizacion
   set slug = regexp_replace(
                lower(translate(nombre,
                      'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')),
                '[^a-z0-9]+', '', 'g')
 where slug is null;

alter table organizacion alter column slug set not null;

create unique index if not exists organizacion_slug_unico on organizacion (slug);

alter table organizacion
  add constraint organizacion_slug_formato
  check (slug ~ '^[a-z0-9]{3,30}$');

-- =====================================================================
-- 2. CODIGO DE EMPLEADO
--
-- Lo que el promotor teclea para entrar, en vez de un correo. Unico
-- dentro de su empresa, no entre empresas: el promotor 1042 de Bimbo
-- y el 1042 de Nestle pueden coexistir.
-- =====================================================================

alter table usuario add column if not exists codigo text;

create unique index if not exists usuario_codigo_unico
  on usuario (organizacion_id, codigo) where codigo is not null;

alter table usuario
  add constraint usuario_codigo_formato
  check (codigo is null or codigo ~ '^[0-9]{4,10}$');

-- =====================================================================
-- 3. QUIEN PUEDE ENTRAR AL PORTAL WEB
--
-- El promotor trabaja en la aplicacion. Este campo es para que el
-- portal lo saque con un mensaje claro en vez de mostrarle pantallas
-- vacias.
--
-- Ojo: esto es claridad, no seguridad. Lo que de verdad protege es
-- que sus politicas no le permiten leer ni escribir nada fuera de su
-- ruta. Un bloqueo en la pantalla se puede rodear; las politicas no.
-- =====================================================================

alter table perfil add column if not exists puede_portal boolean not null default true;

update perfil set puede_portal = false
 where nombre ilike '%promotor%';

-- =====================================================================
-- 4. ADMINISTRADORES DE PLATAFORMA
--
-- A proposito NO pueden ver los datos de las organizaciones. Solo
-- pueden crearlas. Darles lectura sobre todo obligaria a tocar las 55
-- politicas existentes y cualquier error ahi filtra datos entre
-- empresas. Crear una organizacion es una operacion rara y acotada;
-- espiarlas no deberia ser una capacidad que exista.
-- =====================================================================

-- Apunta a la cuenta de acceso, no a la tabla usuario. Un
-- administrador de plataforma no pertenece a ninguna empresa: si
-- tuviera que ser usuario de una, haria falta una organizacion para
-- poder crear la primera organizacion.
create table if not exists plataforma_admin (
  cuenta_id uuid primary key references auth.users(id) on delete cascade,
  nota      text,
  creado_en timestamptz not null default now()
);

alter table plataforma_admin enable row level security;

create or replace function es_superadmin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from plataforma_admin where cuenta_id = auth.uid());
$$;

-- Cada quien ve si el mismo lo es; nadie ve la lista completa.
drop policy if exists plataforma_admin_propio on plataforma_admin;
create policy plataforma_admin_propio on plataforma_admin
  for select using (cuenta_id = auth.uid());

-- Alta de una empresa completa: la organizacion, sus cuatro perfiles
-- y su administrador raiz, en una sola operacion. La cuenta de acceso
-- se crea antes desde el panel de Supabase; aqui se le da perfil.
create or replace function crear_organizacion(
  p_nombre        text,
  p_slug          text,
  p_usuario_admin uuid,
  p_nombre_admin  text
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_org    uuid;
  v_perfil uuid;
begin
  if not es_superadmin() then
    raise exception 'Solo un administrador de plataforma puede crear organizaciones';
  end if;

  insert into organizacion (nombre, slug)
  values (p_nombre, lower(p_slug))
  returning id into v_org;

  insert into perfil (organizacion_id, nombre, permisos, es_cliente, puede_portal) values
    (v_org, 'Administrador',
     '["admin","gestionar_catalogo","crear_formularios","gestionar_itinerarios","ver_reportes","emitir_comunicados"]'::jsonb,
     false, true),
    (v_org, 'Supervisor',
     '["ver_reportes","gestionar_itinerarios"]'::jsonb,
     false, true),
    (v_org, 'Cliente',
     '["ver_reportes"]'::jsonb,
     true, true),
    (v_org, 'Promotor',
     '["capturar_visitas"]'::jsonb,
     false, false);

  select id into v_perfil
    from perfil where organizacion_id = v_org and nombre = 'Administrador';

  insert into usuario (id, organizacion_id, perfil_id, nombre, es_admin_raiz)
  values (p_usuario_admin, v_org, v_perfil, p_nombre_admin, true);

  return v_org;
end;
$$;

revoke all on function crear_organizacion(text, text, uuid, text) from public;
grant execute on function crear_organizacion(text, text, uuid, text) to authenticated;
grant execute on function es_superadmin() to authenticated;
grant select on plataforma_admin to authenticated;

-- =====================================================================
-- 5. PERMISOS EXPLICITOS
--
-- Primero se expanden los perfiles que dependian de la llave maestra,
-- y hasta despues se cambia la funcion. Si fuera al reves, entre una
-- instruccion y otra nadie podria hacer nada.
-- =====================================================================

-- Todo lo que 'admin' concedia de hecho, ahora escrito. Nota que
-- 'gestionar_usuarios' NO va aqui: esa es justo la que se separa.
update perfil
   set permisos = (
     select jsonb_agg(distinct clave)
     from jsonb_array_elements_text(
       permisos || '["admin","gestionar_catalogo","crear_formularios",
                     "gestionar_itinerarios","ver_reportes",
                     "emitir_comunicados"]'::jsonb) as clave
   )
 where permisos ? 'admin';

create or replace function puede(clave text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from usuario u
    join perfil p on p.id = u.perfil_id
    where u.id = auth.uid()
      and u.activo
      and p.permisos ? clave
  );
$$;

-- Dar de alta usuarios. El administrador raiz siempre puede, sin
-- importar su perfil. A un administrador normal se le concede
-- agregando 'gestionar_usuarios' a su perfil.
create or replace function puede_gestionar_usuarios()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from usuario where id = auth.uid() and activo and es_admin_raiz
  ) or puede('gestionar_usuarios');
$$;

grant execute on function puede_gestionar_usuarios() to authenticated;

-- =====================================================================
-- 6. POLITICAS DE USUARIOS
--
-- Las tres que dan de alta, dan de baja y asignan clientes pasan a
-- depender del permiso separado. El resto sigue igual: 'admin' ahora
-- significa "tiene esa clave escrita", no "puede todo".
-- =====================================================================

drop policy if exists usuario_alta on usuario;
create policy usuario_alta on usuario
  for insert with check (
    organizacion_id = organizacion_actual() and puede_gestionar_usuarios()
  );

drop policy if exists usuario_baja on usuario;
create policy usuario_baja on usuario
  for delete using (
    organizacion_id = organizacion_actual() and puede_gestionar_usuarios()
  );

-- Cada quien edita su propia ficha. Cambiarle el perfil, la region o
-- los clientes a alguien mas exige el permiso de usuarios.
drop policy if exists usuario_edicion on usuario;
create policy usuario_edicion on usuario
  for update using (
    organizacion_id = organizacion_actual()
    and (id = auth.uid() or puede_gestionar_usuarios())
  );

drop policy if exists usuario_cliente_escritura on usuario_cliente;
create policy usuario_cliente_escritura on usuario_cliente
  for all using (puede_gestionar_usuarios())
      with check (puede_gestionar_usuarios());

-- La lista de cuentas pendientes de perfil tambien.
create or replace function usuarios_sin_perfil()
returns table (id uuid, correo text, creado timestamptz)
language sql stable security definer
set search_path = public, auth
as $$
  select a.id, a.email::text, a.created_at
  from auth.users a
  left join public.usuario u on u.id = a.id
  where u.id is null
    and puede_gestionar_usuarios()
  order by a.created_at desc;
$$;

revoke all on function usuarios_sin_perfil() from public;
grant execute on function usuarios_sin_perfil() to authenticated;

-- =====================================================================
-- 7. RESOLVER EL CODIGO DE EMPLEADO
--
-- La aplicacion no puede consultar la tabla de usuarios antes de
-- iniciar sesion, asi que el correo interno se arma por convencion y
-- no por consulta:
--
--     <codigo>@<slug>.promotor.local
--
-- Esta funcion existe para que el backoffice muestre al administrador
-- exactamente que correo le corresponde a cada codigo al dar de alta.
-- No la usa la aplicacion.
-- =====================================================================

create or replace function correo_de_promotor(p_slug text, p_codigo text)
returns text
language sql immutable
set search_path = public
as $$
  select lower(p_codigo) || '@' || lower(p_slug) || '.promotor.local';
$$;

grant execute on function correo_de_promotor(text, text) to authenticated;
