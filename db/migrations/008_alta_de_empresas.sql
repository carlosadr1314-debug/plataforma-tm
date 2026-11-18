-- =====================================================================
-- Migracion 008 — Alta de empresas desde el SQL Editor
--
-- POR QUE HACE FALTA
-- La 007 dejo crear_organizacion() protegida con es_superadmin(), que
-- revisa quien esta conectado. Pero en el SQL Editor de Supabase no
-- hay nadie conectado: corre con la llave de servicio y auth.uid() es
-- nulo. Resultado: la funcion se rechazaba a si misma justo donde mas
-- falta hacia usarla.
--
-- La correccion sigue el mismo criterio que ya usa el disparador del
-- administrador raiz: la revision aplica a usuarios conectados. Quien
-- entra con la llave de servicio ya tiene acceso total a la base por
-- otros medios; exigirle un permiso ahi no protege nada, solo estorba.
--
-- Ademas agrega alta_empresa(), que recibe correos en vez de
-- identificadores. Dar de alta una empresa no deberia obligar a andar
-- copiando UUIDs a mano.
-- =====================================================================

-- =====================================================================
-- 1. CREAR ORGANIZACION, AHORA UTILIZABLE DESDE EL SQL EDITOR
-- =====================================================================

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
  -- Desde la aplicacion, solo un administrador de plataforma. Desde
  -- la llave de servicio (auth.uid() nulo), se permite: ahi ya hay
  -- acceso total por otros caminos.
  if auth.uid() is not null and not es_superadmin() then
    raise exception 'Solo un administrador de plataforma puede crear organizaciones';
  end if;

  if p_slug !~ '^[a-z0-9]{3,30}$' then
    raise exception 'El codigo de empresa "%" no sirve: solo minusculas y numeros, de 3 a 30 caracteres', p_slug;
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

-- =====================================================================
-- 2. ALTA POR CORREO
--
-- Lo que se corre cuando una empresa contrata. Antes hay que crear la
-- cuenta de acceso de su administrador en Authentication > Add user,
-- porque las cuentas no se crean por SQL.
-- =====================================================================

create or replace function alta_empresa(
  p_nombre       text,
  p_slug         text,
  p_correo_admin text,
  p_nombre_admin text
)
returns table (
  empresa        text,
  codigo_empresa text,
  administrador  text,
  correo         text,
  organizacion   uuid
)
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_cuenta uuid;
  v_org    uuid;
begin
  select id into v_cuenta from auth.users where lower(email) = lower(p_correo_admin);

  if v_cuenta is null then
    raise exception
      'No existe una cuenta de acceso con el correo %. Creala primero en Authentication > Users > Add user, marcando "Auto Confirm User".',
      p_correo_admin;
  end if;

  if exists (select 1 from usuario where id = v_cuenta) then
    raise exception
      'La cuenta % ya pertenece a una empresa. Usa otro correo para el administrador de la nueva.',
      p_correo_admin;
  end if;

  if exists (select 1 from organizacion where slug = lower(p_slug)) then
    raise exception 'Ya hay una empresa con el codigo "%". Elige otro.', p_slug;
  end if;

  v_org := crear_organizacion(p_nombre, p_slug, v_cuenta, p_nombre_admin);

  return query
    select o.nombre, o.slug, u.nombre, p_correo_admin, o.id
      from organizacion o
      join usuario u on u.organizacion_id = o.id and u.es_admin_raiz
     where o.id = v_org;
end;
$$;

revoke all on function alta_empresa(text, text, text, text) from public;
grant execute on function alta_empresa(text, text, text, text) to authenticated;

-- =====================================================================
-- 3. ALTA DE UN ADMINISTRADOR DE PLATAFORMA, TAMBIEN POR CORREO
-- =====================================================================

create or replace function alta_admin_plataforma(p_correo text, p_nota text default null)
returns text
language plpgsql security definer
set search_path = public, auth
as $$
declare v_cuenta uuid;
begin
  if auth.uid() is not null and not es_superadmin() then
    raise exception 'Solo un administrador de plataforma puede nombrar a otro';
  end if;

  select id into v_cuenta from auth.users where lower(email) = lower(p_correo);
  if v_cuenta is null then
    raise exception
      'No existe una cuenta de acceso con el correo %. Creala primero en Authentication > Users > Add user.',
      p_correo;
  end if;

  insert into plataforma_admin (cuenta_id, nota)
  values (v_cuenta, coalesce(p_nota, p_correo))
  on conflict (cuenta_id) do update set nota = excluded.nota;

  return p_correo || ' ya es administrador de plataforma';
end;
$$;

revoke all on function alta_admin_plataforma(text, text) from public;
grant execute on function alta_admin_plataforma(text, text) to authenticated;

-- =====================================================================
-- 4. VISTA DE EMPRESAS, PARA EL ADMINISTRADOR DE PLATAFORMA
--
-- Solo cuenta cuantas hay y de que tamano. No asoma a los datos de
-- cada una: eso sigue vedado a proposito.
-- =====================================================================

create or replace function resumen_empresas()
returns table (
  empresa       text,
  codigo        text,
  alta          date,
  usuarios      bigint,
  clientes      bigint,
  puntos_venta  bigint
)
language sql stable security definer
set search_path = public
as $$
  select o.nombre, o.slug, o.creado_en::date,
         (select count(*) from usuario u where u.organizacion_id = o.id),
         (select count(*) from cliente c where c.organizacion_id = o.id),
         (select count(*) from pdv p where p.organizacion_id = o.id)
  from organizacion o
  where auth.uid() is null or es_superadmin()
  order by o.creado_en;
$$;

revoke all on function resumen_empresas() from public;
grant execute on function resumen_empresas() to authenticated;
