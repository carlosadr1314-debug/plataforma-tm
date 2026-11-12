-- =====================================================================
-- Migracion 004 — Organizacion y permisos por operacion
--
-- NOTA SOBRE ESTE ARCHIVO
-- El original se perdio. Este fue reconstruido a partir del estado
-- real de la base de produccion, no de memoria: se volcaron columnas,
-- politicas, funciones y disparadores, y se escribio la diferencia
-- exacta contra lo que dejan 001, 002 y 003. Despues se corrio la
-- cadena completa sobre una base vacia y se comparo el resultado
-- contra ese volcado hasta que coincidieron.
--
-- Por eso no es palabra por palabra el archivo que se ejecuto en su
-- momento, pero produce el mismo resultado. Si algo no cuadra con lo
-- que recuerdas, esa es la razon.
--
-- QUE HACE
--   1. Renombra agencia a organizacion en toda la base.
--   2. Agrega puede(), es_promotor() e itinerarios_visibles().
--   3. Cambia las politicas "for all" de 001 por politicas separadas
--      por operacion. Un promotor puede capturar su visita pero no
--      editar el catalogo.
--   4. Agrega las politicas de usuario_cliente y cliente_pdv, que en
--      001 tenian RLS activo y ninguna politica: nadie podia leerlas.
--   5. Rehace las politicas de Storage, que quedaron apuntando a la
--      funcion vieja.
-- =====================================================================

-- =====================================================================
-- 1. RENOMBRE
-- =====================================================================

alter table agencia rename to organizacion;

alter table cliente    rename column agencia_id to organizacion_id;
alter table region     rename column agencia_id to organizacion_id;
alter table perfil     rename column agencia_id to organizacion_id;
alter table usuario    rename column agencia_id to organizacion_id;
alter table cadena     rename column agencia_id to organizacion_id;
alter table pdv        rename column agencia_id to organizacion_id;
alter table formulario rename column agencia_id to organizacion_id;

alter index un_admin_raiz_por_agencia rename to un_admin_raiz_por_organizacion;

-- =====================================================================
-- 2. FUERA LAS POLITICAS VIEJAS
--
-- Van antes de tocar las funciones: mientras una politica use
-- agencia_actual(), Postgres no deja borrarla.
-- =====================================================================

drop policy if exists agencia_propia         on organizacion;
drop policy if exists region_agencia         on region;
drop policy if exists perfil_agencia         on perfil;
drop policy if exists usuario_agencia        on usuario;
drop policy if exists cadena_agencia         on cadena;
drop policy if exists pdv_agencia            on pdv;
drop policy if exists cliente_visible        on cliente;
drop policy if exists producto_visible       on producto;
drop policy if exists subproducto_visible    on subproducto;
drop policy if exists sku_visible            on sku;
drop policy if exists formulario_visible     on formulario;
drop policy if exists pregunta_visible       on pregunta;
drop policy if exists opcion_visible         on opcion_pregunta;
drop policy if exists condicion_visible      on condicion_pregunta;
drop policy if exists tarea_visible          on tarea;
drop policy if exists itinerario_visible     on itinerario;
drop policy if exists visita_visible         on visita;
drop policy if exists respuesta_visible      on respuesta;
drop policy if exists evidencia_visible      on evidencia;
drop policy if exists comunicado_visible     on comunicado;
drop policy if exists sesion_propia          on sesion_app;

-- Esta se rehace solo para dejarle el "with check" explicito. En 001
-- venia sin el; Postgres entonces reutiliza el "using" al validar
-- escrituras, asi que el efecto es el mismo, pero escrito queda claro.
drop policy if exists comunicado_leido_propio on comunicado_leido;

-- Las de Storage tambien apuntan a agencia_actual(). Se vuelven a
-- crear mas abajo, ya con el nombre nuevo.
drop policy if exists evidencia_lectura   on storage.objects;
drop policy if exists evidencia_escritura on storage.objects;

-- =====================================================================
-- 3. FUNCIONES DE CONTEXTO
-- =====================================================================

drop function if exists agencia_actual();

create or replace function organizacion_actual()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select organizacion_id from usuario where id = auth.uid();
$$;

-- Permisos por clave. El perfil guarda un arreglo JSON; 'admin' abre
-- todo. Claves en uso: admin, gestionar_catalogo, crear_formularios,
-- gestionar_itinerarios, ver_reportes, emitir_comunicados,
-- capturar_visitas.
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
      and (p.permisos ? 'admin' or p.permisos ? clave)
  );
$$;

create or replace function es_promotor()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((select es_promotor from usuario where id = auth.uid()), false);
$$;

-- Que itinerarios ve cada quien. El promotor, los suyos. La oficina,
-- los de sus clientes dentro de su organizacion, y si tiene region
-- asignada, solo los de esa region.
create or replace function itinerarios_visibles()
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select i.id
  from itinerario i
  join pdv v on v.id = i.pdv_id
  where i.usuario_id = auth.uid()
     or ( i.cliente_id in (select cliente_id from usuario_cliente
                           where usuario_id = auth.uid())
          and v.organizacion_id = (select organizacion_id from usuario
                                   where id = auth.uid())
          and ( (select region_id from usuario where id = auth.uid()) is null
                or v.region_id = (select region_id from usuario where id = auth.uid()) ) );
$$;

-- El disparador de 003, ahora contra la columna renombrada.
create or replace function proteger_admin_raiz()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  quien uuid := auth.uid();
begin
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
    or new.organizacion_id is distinct from old.organizacion_id then
      raise exception 'No se puede modificar al administrador raiz';
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

-- =====================================================================
-- 4. POLITICAS NUEVAS
--
-- Patron general: todos leen lo de su ambito; escribir exige un
-- permiso. Lo que captura el promotor en campo (visita, respuesta,
-- evidencia) solo lo puede escribir el dueno del itinerario.
-- =====================================================================

-- ---- organizacion ---------------------------------------------------
create policy organizacion_lectura on organizacion
  for select using (id = organizacion_actual());

create policy organizacion_edicion on organizacion
  for update using (id = organizacion_actual() and puede('admin'));

-- ---- region ---------------------------------------------------------
create policy region_lectura on region
  for select using (organizacion_id = organizacion_actual());

create policy region_alta on region
  for insert with check (organizacion_id = organizacion_actual() and puede('admin'));

create policy region_edicion on region
  for update using (organizacion_id = organizacion_actual() and puede('admin'));

create policy region_baja on region
  for delete using (organizacion_id = organizacion_actual() and puede('admin'));

-- ---- perfil ---------------------------------------------------------
create policy perfil_lectura on perfil
  for select using (organizacion_id = organizacion_actual());

create policy perfil_alta on perfil
  for insert with check (organizacion_id = organizacion_actual() and puede('admin'));

create policy perfil_edicion on perfil
  for update using (organizacion_id = organizacion_actual() and puede('admin'));

create policy perfil_baja on perfil
  for delete using (organizacion_id = organizacion_actual() and puede('admin'));

-- ---- usuario --------------------------------------------------------
create policy usuario_lectura on usuario
  for select using (organizacion_id = organizacion_actual());

create policy usuario_alta on usuario
  for insert with check (organizacion_id = organizacion_actual() and puede('admin'));

-- Cada quien puede editar su propia ficha; lo demas exige admin.
create policy usuario_edicion on usuario
  for update using (
    organizacion_id = organizacion_actual()
    and (puede('admin') or id = auth.uid())
  );

create policy usuario_baja on usuario
  for delete using (organizacion_id = organizacion_actual() and puede('admin'));

-- ---- usuario_cliente ------------------------------------------------
-- En 001 esta tabla tenia RLS activo y ninguna politica, asi que
-- nadie la podia leer. Como clientes_visibles() depende de ella, eso
-- dejaba a todos sin ver ningun cliente.
create policy usuario_cliente_lectura on usuario_cliente
  for select using (
    usuario_id = auth.uid()
    or exists (select 1 from usuario u
               where u.id = usuario_cliente.usuario_id
                 and u.organizacion_id = organizacion_actual())
  );

create policy usuario_cliente_escritura on usuario_cliente
  for all using (puede('admin')) with check (puede('admin'));

-- ---- cliente --------------------------------------------------------
create policy cliente_lectura on cliente
  for select using (id in (select clientes_visibles()));

create policy cliente_alta on cliente
  for insert with check (organizacion_id = organizacion_actual() and puede('admin'));

create policy cliente_edicion on cliente
  for update using (id in (select clientes_visibles()) and puede('admin'));

create policy cliente_baja on cliente
  for delete using (id in (select clientes_visibles()) and puede('admin'));

-- ---- catalogo de producto -------------------------------------------
create policy producto_lectura on producto
  for select using (cliente_id in (select clientes_visibles()));

create policy producto_escritura on producto
  for all using (cliente_id in (select clientes_visibles()) and puede('gestionar_catalogo'))
      with check (cliente_id in (select clientes_visibles()) and puede('gestionar_catalogo'));

create policy subproducto_lectura on subproducto
  for select using (producto_id in (select id from producto));

create policy subproducto_escritura on subproducto
  for all using (producto_id in (select id from producto) and puede('gestionar_catalogo'))
      with check (producto_id in (select id from producto) and puede('gestionar_catalogo'));

create policy sku_lectura on sku
  for select using (subproducto_id in (select id from subproducto));

create policy sku_escritura on sku
  for all using (subproducto_id in (select id from subproducto) and puede('gestionar_catalogo'))
      with check (subproducto_id in (select id from subproducto) and puede('gestionar_catalogo'));

-- ---- red de puntos de venta -----------------------------------------
create policy cadena_lectura on cadena
  for select using (organizacion_id = organizacion_actual());

create policy cadena_escritura on cadena
  for all using (organizacion_id = organizacion_actual() and puede('gestionar_catalogo'))
      with check (organizacion_id = organizacion_actual() and puede('gestionar_catalogo'));

-- Quien tiene region asignada solo ve los puntos de venta de su region.
create policy pdv_lectura on pdv
  for select using (
    organizacion_id = organizacion_actual()
    and (region_actual() is null or region_id = region_actual())
  );

create policy pdv_escritura on pdv
  for all using (organizacion_id = organizacion_actual() and puede('gestionar_catalogo'))
      with check (organizacion_id = organizacion_actual() and puede('gestionar_catalogo'));

create policy cliente_pdv_lectura on cliente_pdv
  for select using (cliente_id in (select clientes_visibles()));

create policy cliente_pdv_escritura on cliente_pdv
  for all using (cliente_id in (select clientes_visibles()) and puede('gestionar_catalogo'))
      with check (cliente_id in (select clientes_visibles()) and puede('gestionar_catalogo'));

-- ---- formularios ----------------------------------------------------
-- Las plantillas son de la organizacion; los formularios propios, del
-- cliente al que pertenecen.
create policy formulario_lectura on formulario
  for select using (
    (es_plantilla and organizacion_id = organizacion_actual())
    or cliente_id in (select clientes_visibles())
  );

create policy formulario_escritura on formulario
  for all using (organizacion_id = organizacion_actual() and puede('crear_formularios'))
      with check (organizacion_id = organizacion_actual() and puede('crear_formularios'));

create policy pregunta_lectura on pregunta
  for select using (formulario_id in (select id from formulario));

create policy pregunta_escritura on pregunta
  for all using (formulario_id in (select id from formulario) and puede('crear_formularios'))
      with check (formulario_id in (select id from formulario) and puede('crear_formularios'));

create policy opcion_lectura on opcion_pregunta
  for select using (pregunta_id in (select id from pregunta));

create policy opcion_escritura on opcion_pregunta
  for all using (pregunta_id in (select id from pregunta) and puede('crear_formularios'))
      with check (pregunta_id in (select id from pregunta) and puede('crear_formularios'));

create policy condicion_lectura on condicion_pregunta
  for select using (pregunta_id in (select id from pregunta));

create policy condicion_escritura on condicion_pregunta
  for all using (pregunta_id in (select id from pregunta) and puede('crear_formularios'))
      with check (pregunta_id in (select id from pregunta) and puede('crear_formularios'));

-- ---- planeacion -----------------------------------------------------
create policy tarea_lectura on tarea
  for select using (cliente_id in (select clientes_visibles()));

create policy tarea_escritura on tarea
  for all using (cliente_id in (select clientes_visibles()) and puede('gestionar_itinerarios'))
      with check (cliente_id in (select clientes_visibles()) and puede('gestionar_itinerarios'));

create policy itinerario_lectura on itinerario
  for select using (id in (select itinerarios_visibles()));

create policy itinerario_escritura on itinerario
  for all using (cliente_id in (select clientes_visibles()) and puede('gestionar_itinerarios'))
      with check (cliente_id in (select clientes_visibles()) and puede('gestionar_itinerarios'));

-- ---- ejecucion en campo ---------------------------------------------
-- Leer, los que ven el itinerario. Escribir, solo el promotor al que
-- se le asigno. Y una visita cerrada ya no admite cambios: de eso se
-- encargan los disparadores de 002.
create policy visita_lectura on visita
  for select using (itinerario_id in (select itinerarios_visibles()));

create policy visita_alta on visita
  for insert with check (
    itinerario_id in (select id from itinerario where usuario_id = auth.uid())
  );

create policy visita_edicion on visita
  for update using (
    itinerario_id in (select id from itinerario where usuario_id = auth.uid())
  );

create policy respuesta_lectura on respuesta
  for select using (visita_id in (select id from visita));

create policy respuesta_alta on respuesta
  for insert with check (
    visita_id in (select v.id from visita v
                  join itinerario i on i.id = v.itinerario_id
                  where i.usuario_id = auth.uid())
  );

create policy respuesta_edicion on respuesta
  for update using (
    visita_id in (select v.id from visita v
                  join itinerario i on i.id = v.itinerario_id
                  where i.usuario_id = auth.uid())
  );

-- La evidencia no se edita ni se borra: se sube una vez y queda.
create policy evidencia_lectura_tabla on evidencia
  for select using (visita_id in (select id from visita));

create policy evidencia_alta on evidencia
  for insert with check (
    visita_id in (select v.id from visita v
                  join itinerario i on i.id = v.itinerario_id
                  where i.usuario_id = auth.uid())
  );

-- ---- comunicados ----------------------------------------------------
create policy comunicado_leido_propio on comunicado_leido
  for all using (usuario_id = auth.uid())
      with check (usuario_id = auth.uid());

create policy comunicado_lectura on comunicado
  for select using (cliente_id in (select clientes_visibles()));

create policy comunicado_escritura on comunicado
  for all using (cliente_id in (select clientes_visibles()) and puede('emitir_comunicados'))
      with check (cliente_id in (select clientes_visibles()) and puede('emitir_comunicados'));

-- ---- sesiones de la aplicacion --------------------------------------
create policy sesion_lectura on sesion_app
  for select using (
    usuario_id = auth.uid()
    or (puede('ver_reportes') and exists (
          select 1 from usuario u
          where u.id = sesion_app.usuario_id
            and u.organizacion_id = organizacion_actual()))
  );

create policy sesion_propia_alta on sesion_app
  for insert with check (usuario_id = auth.uid());

-- =====================================================================
-- 5. STORAGE
--
-- Las politicas de 002 quedaron apuntando a agencia_actual(), que ya
-- no existe. Se rehacen con el nombre nuevo. La convencion de ruta
-- pasa a ser <organizacion_id>/<cliente_id>/<visita_id>/<uuid>.jpg
-- =====================================================================

create policy evidencia_lectura on storage.objects
for select to authenticated
using (
  bucket_id = 'evidencia'
  and (storage.foldername(name))[1] = organizacion_actual()::text
  and (storage.foldername(name))[2] in (
    select cv::text from clientes_visibles() as cv
  )
);

create policy evidencia_escritura on storage.objects
for insert to authenticated
with check (
  bucket_id = 'evidencia'
  and (storage.foldername(name))[1] = organizacion_actual()::text
  and (storage.foldername(name))[2] in (
    select cv::text from clientes_visibles() as cv
  )
);

-- =====================================================================
-- 6. PERMISOS DE TABLA
-- =====================================================================

grant execute on function organizacion_actual()   to authenticated;
grant execute on function puede(text)             to authenticated;
grant execute on function es_promotor()           to authenticated;
grant execute on function itinerarios_visibles()  to authenticated;
