-- =====================================================================
-- Datos de prueba
-- Ejecutar DESPUES del esquema y del script de storage.
--
-- ATENCION: son datos ficticios para validar el modelo. Borrarlos
-- antes de cargar informacion real de la operacion.
--
-- REQUISITO PREVIO: crear estos 4 usuarios en el panel de Supabase,
-- en Authentication > Users > Add user, con "Auto Confirm" activado:
--
--   admin@apatayana.test
--   cliente@televia.test
--   supervisor@apatayana.test
--   promotor@apatayana.test
--
-- La seccion 8 los enlaza por correo; no hace falta copiar UUIDs.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Agencia, cliente y regiones
-- ---------------------------------------------------------------------

insert into agencia (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Apatayana Agencia de Mkt');

insert into cliente (id, agencia_id, nombre) values
  ('22222222-2222-2222-2222-222222222222',
   '11111111-1111-1111-1111-111111111111', 'Televia');

insert into region (id, agencia_id, nombre) values
  ('33333333-3333-3333-3333-333333333331',
   '11111111-1111-1111-1111-111111111111', 'Valle de Mexico'),
  ('33333333-3333-3333-3333-333333333332',
   '11111111-1111-1111-1111-111111111111', 'Occidente');

-- ---------------------------------------------------------------------
-- 2. Perfiles
-- ---------------------------------------------------------------------

insert into perfil (id, agencia_id, nombre, permisos, es_cliente) values
  ('44444444-4444-4444-4444-444444444441',
   '11111111-1111-1111-1111-111111111111', 'Administrador',
   '["admin","gestionar_catalogo","crear_formularios","ver_reportes","emitir_comunicados"]', false),

  ('44444444-4444-4444-4444-444444444442',
   '11111111-1111-1111-1111-111111111111', 'Cliente',
   '["admin","gestionar_catalogo","crear_formularios","ver_reportes","emitir_comunicados"]', true),

  ('44444444-4444-4444-4444-444444444443',
   '11111111-1111-1111-1111-111111111111', 'Supervisor',
   '["ver_reportes","gestionar_itinerarios"]', false),

  ('44444444-4444-4444-4444-444444444444',
   '11111111-1111-1111-1111-111111111111', 'Promotor',
   '["capturar_visitas"]', false);

-- ---------------------------------------------------------------------
-- 3. Catalogo: cliente > producto > subproducto > sku
-- ---------------------------------------------------------------------

insert into producto (id, cliente_id, nombre) values
  ('55555555-5555-5555-5555-555555555551',
   '22222222-2222-2222-2222-222222222222', 'Telepeaje');

insert into subproducto (id, producto_id, nombre) values
  ('66666666-6666-6666-6666-666666666661',
   '55555555-5555-5555-5555-555555555551', 'TAG vehicular'),
  ('66666666-6666-6666-6666-666666666662',
   '55555555-5555-5555-5555-555555555551', 'TAG motocicleta');

insert into sku (id, subproducto_id, codigo, nombre, precio_sugerido) values
  ('77777777-7777-7777-7777-777777777771',
   '66666666-6666-6666-6666-666666666661', 'TV-001', 'TAG Televia vehicular', 225.00),
  ('77777777-7777-7777-7777-777777777772',
   '66666666-6666-6666-6666-666666666662', 'TV-002', 'TAG Televia motocicleta', 180.00);

-- ---------------------------------------------------------------------
-- 4. Cadenas y puntos de venta
--    Coordenadas aproximadas, solo para probar el radio de check-in.
-- ---------------------------------------------------------------------

insert into cadena (id, agencia_id, nombre) values
  ('88888888-8888-8888-8888-888888888881',
   '11111111-1111-1111-1111-111111111111', 'Oxxo'),
  ('88888888-8888-8888-8888-888888888882',
   '11111111-1111-1111-1111-111111111111', 'Walmart'),
  ('88888888-8888-8888-8888-888888888883',
   '11111111-1111-1111-1111-111111111111', 'Chedraui');

insert into pdv (id, agencia_id, cadena_id, region_id, codigo, nombre, ciudad, estado, lat, lng) values
  ('99999999-9999-9999-9999-999999999991',
   '11111111-1111-1111-1111-111111111111',
   '88888888-8888-8888-8888-888888888881',
   '33333333-3333-3333-3333-333333333331',
   'PDV-001', 'Oxxo Reforma Centro', 'Ciudad de Mexico', 'CDMX', 19.4350, -99.1450),

  ('99999999-9999-9999-9999-999999999992',
   '11111111-1111-1111-1111-111111111111',
   '88888888-8888-8888-8888-888888888882',
   '33333333-3333-3333-3333-333333333331',
   'PDV-002', 'Walmart Universidad', 'Ciudad de Mexico', 'CDMX', 19.3620, -99.1720),

  ('99999999-9999-9999-9999-999999999993',
   '11111111-1111-1111-1111-111111111111',
   '88888888-8888-8888-8888-888888888883',
   '33333333-3333-3333-3333-333333333332',
   'PDV-003', 'Chedraui Guadalajara Centro', 'Guadalajara', 'Jalisco', 20.6740, -103.3440);

insert into cliente_pdv (cliente_id, pdv_id) values
  ('22222222-2222-2222-2222-222222222222', '99999999-9999-9999-9999-999999999991'),
  ('22222222-2222-2222-2222-222222222222', '99999999-9999-9999-9999-999999999992'),
  ('22222222-2222-2222-2222-222222222222', '99999999-9999-9999-9999-999999999993');

-- ---------------------------------------------------------------------
-- 5. Formulario plantilla (nivel agencia, sin cliente)
-- ---------------------------------------------------------------------

insert into formulario (id, agencia_id, cliente_id, es_plantilla, nombre, descripcion) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
   '11111111-1111-1111-1111-111111111111', null, true,
   'Plantilla estandar de visita',
   'Base modificable comun a todos los clientes');

-- ---------------------------------------------------------------------
-- 6. Formulario del cliente, derivado de la plantilla
-- ---------------------------------------------------------------------

insert into formulario (id, agencia_id, cliente_id, es_plantilla, derivado_de, nombre) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2',
   '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', false,
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
   'Activacion de trade marketing');

insert into pregunta (id, formulario_id, orden, texto, tipo, obligatoria, sku_id, config) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 1,
   'La tienda esta abierta y operando', 'booleano', true, null, '{}'),

  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 2,
   'Hay producto en exhibicion', 'existencia_sku', true,
   '77777777-7777-7777-7777-777777777771', '{}'),

  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 3,
   'Precio en anaquel', 'precio_sku', true,
   '77777777-7777-7777-7777-777777777771',
   '{"alerta_variacion":10}'),

  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 4,
   'Motivo por el que no hay producto', 'opcion_unica', true, null, '{}'),

  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb5',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 5,
   'Fotografia del anaquel completo', 'foto', true, null,
   '{"min_fotos":2,"max_fotos":20}'),

  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb6',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 6,
   'Firma del encargado de tienda', 'firma', false, null, '{}');

insert into opcion_pregunta (pregunta_id, orden, texto) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4', 1, 'Agotado en tienda'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4', 2, 'No lo manejan'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4', 3, 'Desplazado por competencia'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4', 4, 'Otro');

-- Condicional: la pregunta 4 solo aparece si la 2 se respondio "no".
insert into condicion_pregunta (pregunta_id, depende_de_id, operador, valor) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2',
   'igual', 'false'::jsonb);

-- ---------------------------------------------------------------------
-- 7. Tarea vigente
-- ---------------------------------------------------------------------

insert into tarea (id, cliente_id, formulario_id, nombre, vigencia_ini, vigencia_fin) values
  ('cccccccc-cccc-cccc-cccc-ccccccccccc1',
   '22222222-2222-2222-2222-222222222222',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2',
   'Activacion telepeaje trimestre 4',
   current_date, current_date + 90);

-- ---------------------------------------------------------------------
-- 8. Usuarios — enlaza los de Authentication por correo
-- ---------------------------------------------------------------------

insert into usuario (id, agencia_id, perfil_id, region_id, nombre, es_promotor, es_admin_raiz)
select u.id, '11111111-1111-1111-1111-111111111111',
       '44444444-4444-4444-4444-444444444441', null, 'Administrador Apatayana', false, true
from auth.users u where u.email = 'admin@apatayana.test';

insert into usuario (id, agencia_id, perfil_id, region_id, nombre, es_promotor, es_admin_raiz)
select u.id, '11111111-1111-1111-1111-111111111111',
       '44444444-4444-4444-4444-444444444442', null, 'Contacto Televia', false, false
from auth.users u where u.email = 'cliente@televia.test';

insert into usuario (id, agencia_id, perfil_id, region_id, nombre, es_promotor, es_admin_raiz)
select u.id, '11111111-1111-1111-1111-111111111111',
       '44444444-4444-4444-4444-444444444443',
       '33333333-3333-3333-3333-333333333331', 'Supervisor Valle de Mexico', false, false
from auth.users u where u.email = 'supervisor@apatayana.test';

insert into usuario (id, agencia_id, perfil_id, region_id, nombre, es_promotor, es_admin_raiz, consentimiento_ubicacion)
select u.id, '11111111-1111-1111-1111-111111111111',
       '44444444-4444-4444-4444-444444444444',
       '33333333-3333-3333-3333-333333333331', 'Promotor de prueba', true, false, now()
from auth.users u where u.email = 'promotor@apatayana.test';

-- Todos ven al cliente Televia
insert into usuario_cliente (usuario_id, cliente_id)
select id, '22222222-2222-2222-2222-222222222222' from usuario;

-- ---------------------------------------------------------------------
-- 9. Itinerario del promotor para hoy
-- ---------------------------------------------------------------------

insert into itinerario (cliente_id, usuario_id, pdv_id, tarea_id, fecha_programada, secuencia, hora_estimada)
select '22222222-2222-2222-2222-222222222222', u.id,
       '99999999-9999-9999-9999-999999999991',
       'cccccccc-cccc-cccc-cccc-ccccccccccc1',
       current_date, 1, '09:00'
from usuario u where u.nombre = 'Promotor de prueba';

insert into itinerario (cliente_id, usuario_id, pdv_id, tarea_id, fecha_programada, secuencia, hora_estimada)
select '22222222-2222-2222-2222-222222222222', u.id,
       '99999999-9999-9999-9999-999999999992',
       'cccccccc-cccc-cccc-cccc-ccccccccccc1',
       current_date, 1, '11:30'
from usuario u where u.nombre = 'Promotor de prueba';

-- Segunda visita al mismo PDV en el mismo dia: valida la columna
-- secuencia agregada en la version 2 del esquema.
insert into itinerario (cliente_id, usuario_id, pdv_id, tarea_id, fecha_programada, secuencia, hora_estimada)
select '22222222-2222-2222-2222-222222222222', u.id,
       '99999999-9999-9999-9999-999999999991',
       'cccccccc-cccc-cccc-cccc-ccccccccccc1',
       current_date, 2, '16:00'
from usuario u where u.nombre = 'Promotor de prueba';

-- =====================================================================
-- VERIFICACION
-- =====================================================================

-- 1. El catalogo baja los cuatro niveles
select c.nombre cliente, p.nombre producto, s.nombre subproducto,
       k.codigo, k.nombre sku, k.precio_sugerido
from cliente c
join producto p on p.cliente_id = c.id
join subproducto s on s.producto_id = p.id
join sku k on k.subproducto_id = s.id
order by 1,2,3,4;

-- 2. La pregunta condicional quedo enlazada
select pr.texto pregunta, cp.operador, cp.valor, dep.texto depende_de
from condicion_pregunta cp
join pregunta pr on pr.id = cp.pregunta_id
join pregunta dep on dep.id = cp.depende_de_id;

-- 3. Dos visitas al mismo PDV en la misma fecha
select v.nombre pdv, i.fecha_programada, i.secuencia, i.hora_estimada
from itinerario i join pdv v on v.id = i.pdv_id
order by i.hora_estimada;

-- 4. Solo puede existir un administrador raiz por agencia.
--    Esta instruccion DEBE fallar:
-- update usuario set es_admin_raiz = true
-- where nombre = 'Contacto Televia';

-- 5. El administrador raiz esta protegido.
--    Esta instruccion DEBE fallar cuando la ejecuta otro usuario:
-- update usuario set activo = false where es_admin_raiz;
