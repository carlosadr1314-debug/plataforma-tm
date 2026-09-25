-- =====================================================================
-- Paso 6 — Prueba de aislamiento entre clientes
--
-- COMO SE USA:
--   Corre un bloque a la vez, no el archivo completo. Cada bloque
--   entre BEGIN y ROLLBACK simula a un usuario distinto y revierte
--   todo al terminar.
--
-- POR QUE ASI:
--   El SQL Editor se conecta como el rol "postgres", que tiene
--   BYPASSRLS. Las politicas no se le aplican. Para probarlas hay que
--   cambiar al rol "authenticated" e inyectar un token con
--   request.jwt.claims para que auth.uid() devuelva un usuario real.
-- =====================================================================


-- =====================================================================
-- BLOQUE 0 — Preparar el escenario (corre como postgres, sin rollback)
-- =====================================================================

-- Segunda marca, visible SOLO para el administrador.
insert into cliente (id, agencia_id, nombre) values
  ('22222222-2222-2222-2222-222222222223',
   '11111111-1111-1111-1111-111111111111', 'Marca de prueba')
on conflict (id) do nothing;

insert into usuario_cliente (usuario_id, cliente_id)
select u.id, '22222222-2222-2222-2222-222222222223'
from usuario u where u.nombre = 'Administrador Apatayana'
on conflict do nothing;

-- Estado esperado a partir de aqui:
--   Administrador ....... 2 clientes, sin region  -> 3 PDV
--   Contacto Televia .... 1 cliente,  sin region  -> 3 PDV
--   Supervisor .......... 1 cliente,  Valle de Mexico -> 2 PDV
--   Promotor ............ 1 cliente,  Valle de Mexico -> 2 PDV

select u.nombre, count(uc.cliente_id) as clientes, r.nombre as region
from usuario u
left join usuario_cliente uc on uc.usuario_id = u.id
left join region r on r.id = u.region_id
group by u.nombre, r.nombre
order by 1;


-- =====================================================================
-- BLOQUE 1 — Como PROMOTOR
-- Esperado: 1 cliente (Televia) y 2 PDV (solo Valle de Mexico)
-- =====================================================================

begin;

  select set_config('request.jwt.claims',
    json_build_object(
      'sub',  (select id::text from usuario where nombre = 'Promotor de prueba'),
      'role', 'authenticated'
    )::text, true);

  set local role authenticated;

  select 'clientes visibles' as prueba, count(*) as total,
         string_agg(nombre, ', ') as detalle
  from cliente
  union all
  select 'pdv visibles', count(*), string_agg(nombre, ', ') from pdv;

rollback;


-- =====================================================================
-- BLOQUE 2 — Como ADMINISTRADOR
-- Esperado: 2 clientes y 3 PDV (no tiene region asignada)
-- =====================================================================

begin;

  select set_config('request.jwt.claims',
    json_build_object(
      'sub',  (select id::text from usuario where nombre = 'Administrador Apatayana'),
      'role', 'authenticated'
    )::text, true);

  set local role authenticated;

  select 'clientes visibles' as prueba, count(*) as total,
         string_agg(nombre, ', ') as detalle
  from cliente
  union all
  select 'pdv visibles', count(*), string_agg(nombre, ', ') from pdv;

rollback;


-- =====================================================================
-- BLOQUE 3 — Como SUPERVISOR
-- Esperado: 1 cliente y 2 PDV. NO debe ver el PDV de Guadalajara,
-- porque pertenece a la region Occidente.
-- =====================================================================

begin;

  select set_config('request.jwt.claims',
    json_build_object(
      'sub',  (select id::text from usuario where nombre = 'Supervisor Valle de Mexico'),
      'role', 'authenticated'
    )::text, true);

  set local role authenticated;

  select 'clientes visibles' as prueba, count(*) as total,
         string_agg(nombre, ', ') as detalle
  from cliente
  union all
  select 'pdv visibles', count(*), string_agg(nombre, ', ') from pdv;

rollback;


-- =====================================================================
-- BLOQUE 4 — Sin sesion (token nulo)
-- Esperado: 0 en todo. Es la prueba de que nada queda abierto.
-- =====================================================================

begin;

  set local role authenticated;

  select 'clientes visibles' as prueba, count(*) as total from cliente
  union all
  select 'pdv visibles', count(*) from pdv
  union all
  select 'itinerarios visibles', count(*) from itinerario;

rollback;


-- =====================================================================
-- BLOQUE 5 — El promotor no puede escribir catalogo
-- Esperado: 0 filas afectadas. La politica lo filtra antes de tocar
-- nada, porque el SKU pertenece a un cliente... que si ve. Aqui el
-- resultado revela un pendiente real, ver nota al final.
-- =====================================================================

begin;

  select set_config('request.jwt.claims',
    json_build_object(
      'sub',  (select id::text from usuario where nombre = 'Promotor de prueba'),
      'role', 'authenticated'
    )::text, true);

  set local role authenticated;

  update sku set precio_sugerido = 1 where codigo = 'TV-001';

  select codigo, precio_sugerido from sku where codigo = 'TV-001';

rollback;


-- =====================================================================
-- LIMPIEZA — solo si quieres dejar la base como estaba
-- =====================================================================

-- delete from usuario_cliente
--  where cliente_id = '22222222-2222-2222-2222-222222222223';
-- delete from cliente
--  where id = '22222222-2222-2222-2222-222222222223';
