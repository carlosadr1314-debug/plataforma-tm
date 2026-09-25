-- =====================================================================
-- Plataforma de trade marketing — esquema v2
-- PostgreSQL / Supabase
--
-- Cambios respecto de v1, derivados del levantamiento de requerimientos:
--   1. Catalogo pasa a 4 niveles: cliente > producto > subproducto > sku
--   2. Regiones, para el alcance del perfil supervisor
--   3. Tipos de pregunta completos (firma, codigo de barras)
--   4. Preguntas condicionales
--   5. Formularios plantilla y formularios derivados
--   6. Varias visitas al mismo PDV en una misma fecha
--   7. Comunicados del cliente final
--   8. Telemetria de apertura de la aplicacion
--   9. Consentimiento de registro de ubicacion
--  10. Proteccion del administrador raiz
-- =====================================================================

create extension if not exists "pgcrypto";

-- =====================================================================
-- TIPOS
-- =====================================================================

create type tipo_pregunta as enum (
  'texto', 'numero', 'booleano', 'opcion_unica', 'opcion_multiple',
  'fecha', 'foto', 'precio_sku', 'existencia_sku',
  'firma', 'codigo_barras'
);

create type estado_visita as enum (
  'programada', 'en_curso', 'completada', 'no_realizada'
);

create type operador_condicion as enum (
  'igual', 'distinto', 'mayor', 'menor', 'contiene', 'vacio', 'no_vacio'
);

-- =====================================================================
-- NIVEL 1 — TENANT Y TERRITORIO
-- =====================================================================

create table agencia (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  activo      boolean not null default true,
  creado_en   timestamptz not null default now()
);

create table cliente (
  id          uuid primary key default gen_random_uuid(),
  agencia_id  uuid not null references agencia(id) on delete cascade,
  nombre      text not null,
  activo      boolean not null default true,
  creado_en   timestamptz not null default now(),
  unique (agencia_id, nombre)
);

-- NUEVO v2: el supervisor ve unicamente su region.
create table region (
  id          uuid primary key default gen_random_uuid(),
  agencia_id  uuid not null references agencia(id) on delete cascade,
  nombre      text not null,
  unique (agencia_id, nombre)
);

-- =====================================================================
-- NIVEL 2 — USUARIOS Y PERMISOS
-- =====================================================================

create table perfil (
  id          uuid primary key default gen_random_uuid(),
  agencia_id  uuid not null references agencia(id) on delete cascade,
  nombre      text not null,
  -- claves: 'admin', 'gestionar_catalogo', 'crear_formularios',
  --         'ver_reportes', 'emitir_comunicados', 'capturar_visitas'
  permisos    jsonb not null default '[]'::jsonb,
  -- NUEVO v2: el perfil de cliente final tiene permisos de
  -- administrador pero no puede tocar al administrador raiz.
  es_cliente  boolean not null default false,
  unique (agencia_id, nombre)
);

create table usuario (
  id                       uuid primary key references auth.users(id) on delete cascade,
  agencia_id               uuid not null references agencia(id) on delete cascade,
  perfil_id                uuid not null references perfil(id),
  region_id                uuid references region(id),          -- NUEVO v2
  nombre                   text not null,
  telefono                 text,
  es_promotor              boolean not null default false,
  -- NUEVO v2: ningun usuario, ni el cliente final, puede desactivar
  -- o reasignar al administrador raiz de la agencia.
  es_admin_raiz            boolean not null default false,
  -- NUEVO v2: LFPDPPP. Se registra cuando el promotor acepta los
  -- terminos que incluyen el rastreo de ubicacion.
  consentimiento_ubicacion timestamptz,
  activo                   boolean not null default true,
  creado_en                timestamptz not null default now()
);

create index on usuario (agencia_id);
create index on usuario (region_id);
create unique index un_admin_raiz_por_agencia
  on usuario (agencia_id) where es_admin_raiz;

create table usuario_cliente (
  usuario_id  uuid not null references usuario(id) on delete cascade,
  cliente_id  uuid not null references cliente(id) on delete cascade,
  primary key (usuario_id, cliente_id)
);

-- =====================================================================
-- NIVEL 3 — CATALOGO (4 niveles, cambio de v2)
-- =====================================================================

create table producto (
  id          uuid primary key default gen_random_uuid(),
  cliente_id  uuid not null references cliente(id) on delete cascade,
  nombre      text not null,
  activo      boolean not null default true,
  unique (cliente_id, nombre)
);

create table subproducto (
  id           uuid primary key default gen_random_uuid(),
  producto_id  uuid not null references producto(id) on delete cascade,
  nombre       text not null,
  activo       boolean not null default true,
  unique (producto_id, nombre)
);

create table sku (
  id              uuid primary key default gen_random_uuid(),
  subproducto_id  uuid not null references subproducto(id) on delete cascade,
  codigo          text not null,
  nombre          text not null,
  codigo_barras   text,
  precio_sugerido numeric(12,2),
  activo          boolean not null default true,
  unique (subproducto_id, codigo)
);

create index on sku (subproducto_id);
create index on sku (codigo_barras);

-- =====================================================================
-- NIVEL 4 — RED DE PUNTOS DE VENTA
-- =====================================================================

create table cadena (
  id          uuid primary key default gen_random_uuid(),
  agencia_id  uuid not null references agencia(id) on delete cascade,
  nombre      text not null,
  unique (agencia_id, nombre)
);

create table pdv (
  id             uuid primary key default gen_random_uuid(),
  agencia_id     uuid not null references agencia(id) on delete cascade,
  cadena_id      uuid references cadena(id),
  region_id      uuid references region(id),        -- NUEVO v2
  codigo         text not null,
  nombre         text not null,
  direccion      text,
  ciudad         text,
  estado         text,
  lat            double precision,
  lng            double precision,
  radio_checkin  integer not null default 150,
  activo         boolean not null default true,
  creado_en      timestamptz not null default now(),
  unique (agencia_id, codigo)
);

create index on pdv (agencia_id);
create index on pdv (region_id);

create table cliente_pdv (
  cliente_id  uuid not null references cliente(id) on delete cascade,
  pdv_id      uuid not null references pdv(id) on delete cascade,
  primary key (cliente_id, pdv_id)
);

-- =====================================================================
-- NIVEL 5 — MOTOR DE FORMULARIOS
-- =====================================================================

create table formulario (
  id            uuid primary key default gen_random_uuid(),
  -- NUEVO v2: una plantilla estandar vive a nivel agencia
  -- (cliente_id nulo) y se puede derivar por cliente.
  agencia_id    uuid not null references agencia(id) on delete cascade,
  cliente_id    uuid references cliente(id) on delete cascade,
  es_plantilla  boolean not null default false,
  derivado_de   uuid references formulario(id),
  nombre        text not null,
  descripcion   text,
  version       integer not null default 1,
  activo        boolean not null default true,
  creado_por    uuid references usuario(id),
  creado_en     timestamptz not null default now(),
  -- una plantilla no pertenece a un cliente; un formulario si
  check ((es_plantilla and cliente_id is null)
      or (not es_plantilla and cliente_id is not null))
);

create index on formulario (cliente_id);
create index on formulario (agencia_id) where es_plantilla;

create table pregunta (
  id             uuid primary key default gen_random_uuid(),
  formulario_id  uuid not null references formulario(id) on delete cascade,
  orden          integer not null,
  texto          text not null,
  tipo           tipo_pregunta not null,
  obligatoria    boolean not null default false,
  -- la pregunta puede anclarse a cualquier nivel del catalogo
  producto_id    uuid references producto(id),
  subproducto_id uuid references subproducto(id),
  sku_id         uuid references sku(id),
  -- {"min":0,"max":999} | {"max_fotos":20} | {"alerta_variacion":10}
  config         jsonb not null default '{}'::jsonb,
  unique (formulario_id, orden)
);

create index on pregunta (formulario_id);

create table opcion_pregunta (
  id           uuid primary key default gen_random_uuid(),
  pregunta_id  uuid not null references pregunta(id) on delete cascade,
  orden        integer not null,
  texto        text not null,
  unique (pregunta_id, orden)
);

-- NUEVO v2: preguntas condicionales.
-- "Mostrar esta pregunta solo si la respuesta a otra cumple X."
create table condicion_pregunta (
  id                uuid primary key default gen_random_uuid(),
  pregunta_id       uuid not null references pregunta(id) on delete cascade,
  depende_de_id     uuid not null references pregunta(id) on delete cascade,
  operador          operador_condicion not null,
  valor             jsonb,
  check (pregunta_id <> depende_de_id)
);

create index on condicion_pregunta (pregunta_id);

-- =====================================================================
-- NIVEL 6 — PLANEACION Y EJECUCION
-- =====================================================================

create table tarea (
  id             uuid primary key default gen_random_uuid(),
  cliente_id     uuid not null references cliente(id) on delete cascade,
  formulario_id  uuid not null references formulario(id),
  nombre         text not null,
  vigencia_ini   date not null,
  vigencia_fin   date not null,
  activa         boolean not null default true,
  check (vigencia_fin >= vigencia_ini)
);

create table itinerario (
  id                uuid primary key default gen_random_uuid(),
  cliente_id        uuid not null references cliente(id) on delete cascade,
  usuario_id        uuid not null references usuario(id),
  pdv_id            uuid not null references pdv(id),
  tarea_id          uuid references tarea(id),
  fecha_programada  date not null,
  -- NUEVO v2: un promotor puede visitar el mismo PDV varias veces
  -- en un dia. La secuencia sustituye la restriccion unica de v1.
  secuencia         integer not null default 1,
  hora_estimada     time,
  creado_en         timestamptz not null default now(),
  unique (usuario_id, pdv_id, fecha_programada, secuencia)
);

create index on itinerario (usuario_id, fecha_programada);
create index on itinerario (cliente_id, fecha_programada);

create table visita (
  id                  uuid primary key default gen_random_uuid(),
  itinerario_id       uuid not null unique references itinerario(id) on delete cascade,
  estado              estado_visita not null default 'programada',

  -- idempotencia de sincronizacion: el dispositivo genera este uuid
  -- sin conexion, de modo que un reintento no duplica la visita.
  id_local            uuid unique,

  check_in            timestamptz,
  check_in_lat        double precision,
  check_in_lng        double precision,
  check_in_precision  double precision,
  ubicacion_simulada  boolean not null default false,
  distancia_pdv       double precision,
  -- NUEVO v2: el problema reportado son registros extemporaneos,
  -- no falsificados. Se marca el desfase contra la hora estimada.
  minutos_desfase     integer,

  check_out           timestamptz,
  motivo_no_visita    text,

  sincronizada_en     timestamptz,
  creado_en           timestamptz not null default now()
);

create index on visita (estado);
create index on visita (check_in);

create table respuesta (
  id            uuid primary key default gen_random_uuid(),
  visita_id     uuid not null references visita(id) on delete cascade,
  pregunta_id   uuid not null references pregunta(id),
  valor_texto   text,
  valor_numero  numeric,
  valor_bool    boolean,
  valor_fecha   date,
  valor_opcion  jsonb,
  capturada_en  timestamptz not null default now(),
  unique (visita_id, pregunta_id)
);

create index on respuesta (visita_id);
create index on respuesta (pregunta_id);

create table evidencia (
  id            uuid primary key default gen_random_uuid(),
  visita_id     uuid not null references visita(id) on delete cascade,
  pregunta_id   uuid references pregunta(id),
  storage_path  text not null,
  bytes         integer,
  lat           double precision,
  lng           double precision,
  tomada_en     timestamptz,
  subida_en     timestamptz not null default now()
);

create index on evidencia (visita_id);

-- =====================================================================
-- NIVEL 7 — COMUNICACION (nuevo en v2)
-- =====================================================================

-- El cliente final puede emitir comunicados generales.
-- Promotor y supervisor no pueden responder ni escribirle.
create table comunicado (
  id           uuid primary key default gen_random_uuid(),
  cliente_id   uuid not null references cliente(id) on delete cascade,
  emitido_por  uuid not null references usuario(id),
  titulo       text not null,
  cuerpo       text not null,
  vigencia_fin date,
  creado_en    timestamptz not null default now()
);

create table comunicado_leido (
  comunicado_id  uuid not null references comunicado(id) on delete cascade,
  usuario_id     uuid not null references usuario(id) on delete cascade,
  leido_en       timestamptz not null default now(),
  primary key (comunicado_id, usuario_id)
);

-- =====================================================================
-- NIVEL 8 — TELEMETRIA DE APLICACION (nuevo en v2)
-- =====================================================================

-- Solicitud del anexo del cuestionario: registrar la apertura de la
-- aplicacion en el tiempo y contabilizar el numero de aperturas.
-- Se captura desde ahora aunque el reporte se construya despues.
create table sesion_app (
  id              uuid primary key default gen_random_uuid(),
  usuario_id      uuid not null references usuario(id) on delete cascade,
  abierta_en      timestamptz not null,
  cerrada_en      timestamptz,
  plataforma      text,          -- 'android' | 'ios'
  version_app     text,
  registrada_en   timestamptz not null default now()
);

create index on sesion_app (usuario_id, abierta_en);

-- =====================================================================
-- FUNCIONES DE CONTEXTO PARA RLS
-- =====================================================================

create or replace function agencia_actual()
returns uuid language sql stable security definer set search_path = public as $$
  select agencia_id from usuario where id = auth.uid();
$$;

create or replace function clientes_visibles()
returns setof uuid language sql stable security definer set search_path = public as $$
  select cliente_id from usuario_cliente where usuario_id = auth.uid();
$$;

-- NUEVO v2: alcance territorial del supervisor.
-- Devuelve null cuando el usuario no esta limitado por region.
create or replace function region_actual()
returns uuid language sql stable security definer set search_path = public as $$
  select region_id from usuario where id = auth.uid();
$$;

-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================

alter table agencia          enable row level security;
alter table cliente          enable row level security;
alter table region           enable row level security;
alter table perfil           enable row level security;
alter table usuario          enable row level security;
alter table usuario_cliente  enable row level security;
alter table producto         enable row level security;
alter table subproducto      enable row level security;
alter table sku              enable row level security;
alter table cadena           enable row level security;
alter table pdv              enable row level security;
alter table cliente_pdv      enable row level security;
alter table formulario       enable row level security;
alter table pregunta         enable row level security;
alter table opcion_pregunta  enable row level security;
alter table condicion_pregunta enable row level security;
alter table tarea            enable row level security;
alter table itinerario       enable row level security;
alter table visita           enable row level security;
alter table respuesta        enable row level security;
alter table evidencia        enable row level security;
alter table comunicado       enable row level security;
alter table comunicado_leido enable row level security;
alter table sesion_app       enable row level security;

create policy agencia_propia on agencia
  for select using (id = agencia_actual());

create policy region_agencia on region
  for all using (agencia_id = agencia_actual());

create policy perfil_agencia on perfil
  for all using (agencia_id = agencia_actual());

create policy usuario_agencia on usuario
  for select using (agencia_id = agencia_actual());

create policy cadena_agencia on cadena
  for all using (agencia_id = agencia_actual());

-- NUEVO v2: el PDV se filtra ademas por region cuando el usuario
-- tiene una asignada.
create policy pdv_agencia on pdv
  for all using (
    agencia_id = agencia_actual()
    and (region_actual() is null or region_id = region_actual())
  );

create policy cliente_visible on cliente
  for all using (id in (select clientes_visibles()));

create policy producto_visible on producto
  for all using (cliente_id in (select clientes_visibles()));

create policy subproducto_visible on subproducto
  for all using (producto_id in (select id from producto));

create policy sku_visible on sku
  for all using (subproducto_id in (select id from subproducto));

create policy formulario_visible on formulario
  for all using (
    (es_plantilla and agencia_id = agencia_actual())
    or cliente_id in (select clientes_visibles())
  );

create policy pregunta_visible on pregunta
  for all using (formulario_id in (select id from formulario));

create policy opcion_visible on opcion_pregunta
  for all using (pregunta_id in (select id from pregunta));

create policy condicion_visible on condicion_pregunta
  for all using (pregunta_id in (select id from pregunta));

create policy tarea_visible on tarea
  for all using (cliente_id in (select clientes_visibles()));

create policy itinerario_visible on itinerario
  for all using (
    usuario_id = auth.uid()
    or (cliente_id in (select clientes_visibles())
        and pdv_id in (select id from pdv))
  );

create policy visita_visible on visita
  for all using (itinerario_id in (select id from itinerario));

create policy respuesta_visible on respuesta
  for all using (visita_id in (select id from visita));

create policy evidencia_visible on evidencia
  for all using (visita_id in (select id from visita));

create policy comunicado_visible on comunicado
  for all using (cliente_id in (select clientes_visibles()));

create policy comunicado_leido_propio on comunicado_leido
  for all using (usuario_id = auth.uid());

create policy sesion_propia on sesion_app
  for all using (
    usuario_id = auth.uid()
    or agencia_actual() = (select agencia_id from usuario u where u.id = usuario_id)
  );

-- =====================================================================
-- PROTECCION DEL ADMINISTRADOR RAIZ (nuevo en v2)
-- =====================================================================

-- El cliente final tiene permisos de administrador pero no puede
-- desactivar, degradar ni eliminar al administrador raiz.

create or replace function proteger_admin_raiz()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.es_admin_raiz and old.id <> auth.uid() then
    if tg_op = 'DELETE' then
      raise exception 'No se puede eliminar al administrador raiz';
    end if;
    if new.activo is distinct from old.activo
       or new.perfil_id is distinct from old.perfil_id
       or new.es_admin_raiz is distinct from old.es_admin_raiz then
      raise exception 'No se puede modificar al administrador raiz';
    end if;
  end if;
  return new;
end;
$$;

create trigger tg_proteger_admin_raiz
  before update or delete on usuario
  for each row execute function proteger_admin_raiz();

-- =====================================================================
-- PENDIENTES ANTES DE PRODUCCION
-- =====================================================================
--
--  1. Separar politicas por operacion (select/insert/update/delete).
--     Hoy "for all" permite al promotor escribir catalogo.
--  2. Bucket de Storage con politica ligada a visita_id.
--  3. Trigger que impida modificar una visita con check_out registrado.
--  4. Politica de retencion de evidencia fotografica.
--     Hasta 20 fotos por visita, 500 promotores proyectados.
--  5. Validar que las condiciones de pregunta no formen ciclos.
--  6. Particionar visita, respuesta y evidencia por fecha cuando el
--     volumen lo justifique. Con 500 promotores es previsible.
--  7. Vistas materializadas para los reportes, una vez definido el
--     bloque E del levantamiento.
--  8. Indices adicionales segun los reportes reales.
