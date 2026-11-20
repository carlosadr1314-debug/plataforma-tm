-- =====================================================================
-- Prueba de aislamiento entre empresas y de niveles de permiso
--
-- Corre esto en el SQL Editor despues de cada migracion. Monta dos
-- empresas de mentiras, suplanta a un usuario de cada nivel y
-- comprueba que cada quien puede exactamente lo que debe y nada mas.
--
-- Es seguro correrlo sobre la base en operacion: todo lo que crea lo
-- borra al final. No toca ningun dato existente.
--
-- Si algo falla, se detiene con un mensaje que dice que fallo. Si
-- llega hasta el final sin detenerse, el aislamiento esta intacto.
--
-- POR QUE HACE FALTA
-- El aislamiento vive en las politicas de la base, no en el codigo
-- de las pantallas. Una politica mal escrita no rompe nada visible:
-- simplemente deja que una empresa vea los datos de otra, y eso no
-- se nota hasta que alguien lo reporta. Esta prueba lo nota antes.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Ayudante
-- ---------------------------------------------------------------------
create or replace function pg_temp.afirmar(descripcion text, condicion boolean)
returns void language plpgsql as $$
begin
  if condicion then
    raise notice '  OK    %', descripcion;
  else
    raise exception 'FALLA LA PRUEBA: %', descripcion;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Montaje
-- ---------------------------------------------------------------------
do $$
declare
  v_bimbo  uuid;
  v_nestle uuid;
begin
  insert into auth.users (instance_id, id, aud, role, email,
                          encrypted_password, email_confirmed_at,
                          created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000'::uuid, id,
         'authenticated', 'authenticated', correo, 'x', now(), now(), now()
  from (values
    ('eeee0000-0000-0000-0000-00000000000a'::uuid, 'prueba.super@local'),
    ('eeee0000-0000-0000-0000-0000000000b1'::uuid, 'prueba.braiz@local'),
    ('eeee0000-0000-0000-0000-0000000000b2'::uuid, 'prueba.badmin@local'),
    ('eeee0000-0000-0000-0000-0000000000b3'::uuid, 'prueba.bsuper@local'),
    ('eeee0000-0000-0000-0000-0000000000b4'::uuid, 'prueba.bprom@local'),
    ('eeee0000-0000-0000-0000-0000000000c1'::uuid, 'prueba.nraiz@local'),
    ('eeee0000-0000-0000-0000-0000000000c4'::uuid, 'prueba.nprom@local')
  ) as t(id, correo);

  insert into plataforma_admin (cuenta_id, nota)
  values ('eeee0000-0000-0000-0000-00000000000a', 'cuenta de prueba');

  -- Las organizaciones se crean con la funcion, no a mano: asi la
  -- prueba tambien verifica que esa funcion sirve.
  perform set_config('request.jwt.claims',
    '{"sub":"eeee0000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

  v_bimbo  := crear_organizacion('Prueba Bimbo',  'pruebabimbo',
                'eeee0000-0000-0000-0000-0000000000b1', 'Raiz Bimbo');
  v_nestle := crear_organizacion('Prueba Nestle', 'pruebanestle',
                'eeee0000-0000-0000-0000-0000000000c1', 'Raiz Nestle');

  -- Resto del equipo de Bimbo
  insert into usuario (id, organizacion_id, perfil_id, nombre, es_promotor, codigo)
  select 'eeee0000-0000-0000-0000-0000000000b2', v_bimbo, id, 'Admin Bimbo', false, null
    from perfil where organizacion_id = v_bimbo and nombre = 'Administrador';
  insert into usuario (id, organizacion_id, perfil_id, nombre, es_promotor, codigo)
  select 'eeee0000-0000-0000-0000-0000000000b3', v_bimbo, id, 'Supervisor Bimbo', false, null
    from perfil where organizacion_id = v_bimbo and nombre = 'Supervisor';
  insert into usuario (id, organizacion_id, perfil_id, nombre, es_promotor, codigo)
  select 'eeee0000-0000-0000-0000-0000000000b4', v_bimbo, id, 'Promotor Bimbo', true, '1042'
    from perfil where organizacion_id = v_bimbo and nombre = 'Promotor';

  insert into usuario (id, organizacion_id, perfil_id, nombre, es_promotor, codigo)
  select 'eeee0000-0000-0000-0000-0000000000c4', v_nestle, id, 'Promotor Nestle', true, '1042'
    from perfil where organizacion_id = v_nestle and nombre = 'Promotor';

  -- Un cliente y un punto de venta en cada empresa
  insert into cliente (id, organizacion_id, nombre) values
    ('eeee1111-0000-0000-0000-00000000000b', v_bimbo,  'Marca de Bimbo'),
    ('eeee1111-0000-0000-0000-00000000000c', v_nestle, 'Marca de Nestle');

  insert into usuario_cliente (usuario_id, cliente_id) values
    ('eeee0000-0000-0000-0000-0000000000b1','eeee1111-0000-0000-0000-00000000000b'),
    ('eeee0000-0000-0000-0000-0000000000b2','eeee1111-0000-0000-0000-00000000000b'),
    ('eeee0000-0000-0000-0000-0000000000b3','eeee1111-0000-0000-0000-00000000000b'),
    ('eeee0000-0000-0000-0000-0000000000b4','eeee1111-0000-0000-0000-00000000000b'),
    ('eeee0000-0000-0000-0000-0000000000c1','eeee1111-0000-0000-0000-00000000000c'),
    ('eeee0000-0000-0000-0000-0000000000c4','eeee1111-0000-0000-0000-00000000000c');

  -- Una marca que NADIE tiene asignada en usuario_cliente, con su
  -- tienda, su ruta y una visita hecha. Es el caso real: el admin no
  -- es el promotor de nada y nadie le asigna clientes, asi que si la
  -- visibilidad depende solo de usuario_cliente, no ve el trabajo de
  -- su propia empresa.
  insert into cliente (id, organizacion_id, nombre) values
    ('eeee1111-0000-0000-0000-00000000002b', v_bimbo, 'Marca sin asignar');

  insert into pdv (id, organizacion_id, codigo, nombre, radio_checkin) values
    ('eeee2222-0000-0000-0000-00000000000b', v_bimbo,  'PDV-B1', 'Tienda Bimbo',  150),
    ('eeee2222-0000-0000-0000-00000000000c', v_nestle, 'PDV-C1', 'Tienda Nestle', 150);

  insert into itinerario (id, cliente_id, usuario_id, pdv_id, fecha_programada) values
    ('eeee3333-0000-0000-0000-00000000000b',
     'eeee1111-0000-0000-0000-00000000002b',
     'eeee0000-0000-0000-0000-0000000000b4',
     'eeee2222-0000-0000-0000-00000000000b', current_date);

  insert into visita (itinerario_id, estado, check_in) values
    ('eeee3333-0000-0000-0000-00000000000b', 'completada', now());

  insert into producto (cliente_id, nombre) values
    ('eeee1111-0000-0000-0000-00000000000b', 'Producto de Bimbo'),
    ('eeee1111-0000-0000-0000-00000000000c', 'Producto de Nestle');

  perform set_config('request.jwt.claims', '', true);
  raise notice 'Montaje listo: dos empresas de prueba.';
end $$;

-- ---------------------------------------------------------------------
-- Pruebas
-- ---------------------------------------------------------------------
do $$
declare
  n          int;
  permitido  boolean;
  v_bimbo    uuid := (select id from organizacion where slug = 'pruebabimbo');
  v_nestle   uuid := (select id from organizacion where slug = 'pruebanestle');
begin
  raise notice '--- Aislamiento entre empresas ---';

  -- El administrador de Bimbo no debe ver nada de Nestle
  perform set_config('request.jwt.claims',
    '{"sub":"eeee0000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
  set local role authenticated;

  select count(*) into n from organizacion;
  perform pg_temp.afirmar('El admin de Bimbo ve solo su organizacion', n = 1);

  select count(*) into n from cliente;
  perform pg_temp.afirmar('El admin de Bimbo ve solo clientes de Bimbo',
    n = (select count(*) from cliente where organizacion_id = v_bimbo));

  select count(*) into n from producto;
  perform pg_temp.afirmar('El admin de Bimbo ve solo su catalogo', n = 1);

  select count(*) into n from usuario;
  perform pg_temp.afirmar('El admin de Bimbo ve solo a su equipo (4)', n = 4);

  reset role;

  -- Y Nestle tampoco ve a Bimbo
  perform set_config('request.jwt.claims',
    '{"sub":"eeee0000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
  set local role authenticated;

  select count(*) into n from producto;
  perform pg_temp.afirmar('El raiz de Nestle ve solo su catalogo', n = 1);

  select count(*) into n from usuario;
  perform pg_temp.afirmar('El raiz de Nestle ve solo a su equipo (2)', n = 2);

  reset role;

  raise notice '--- Quien puede dar de alta usuarios ---';

  -- El administrador raiz siempre puede
  perform set_config('request.jwt.claims',
    '{"sub":"eeee0000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
  set local role authenticated;
  perform pg_temp.afirmar('El administrador raiz puede dar de alta',
                          puede_gestionar_usuarios());
  reset role;

  -- Un administrador normal no, aunque tenga la clave admin
  perform set_config('request.jwt.claims',
    '{"sub":"eeee0000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
  set local role authenticated;
  perform pg_temp.afirmar('Un administrador normal NO puede dar de alta',
                          not puede_gestionar_usuarios());
  perform pg_temp.afirmar('...pero sigue pudiendo el catalogo',
                          puede('gestionar_catalogo'));
  reset role;

  -- Y si se le delega, si
  update perfil set permisos = permisos || '["gestionar_usuarios"]'::jsonb
   where organizacion_id = v_bimbo and nombre = 'Administrador';

  perform set_config('request.jwt.claims',
    '{"sub":"eeee0000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
  set local role authenticated;
  perform pg_temp.afirmar('Delegado el permiso, el administrador normal ya puede',
                          puede_gestionar_usuarios());
  reset role;

  update perfil set permisos = permisos - 'gestionar_usuarios'
   where organizacion_id = v_bimbo and nombre = 'Administrador';

  raise notice '--- admin ya no es llave maestra ---';

  perform set_config('request.jwt.claims',
    '{"sub":"eeee0000-0000-0000-0000-0000000000b3","role":"authenticated"}', true);
  set local role authenticated;
  perform pg_temp.afirmar('El supervisor ve reportes', puede('ver_reportes'));
  perform pg_temp.afirmar('El supervisor NO toca el catalogo',
                          not puede('gestionar_catalogo'));
  perform pg_temp.afirmar('El supervisor NO da de alta usuarios',
                          not puede_gestionar_usuarios());
  reset role;

  raise notice '--- El promotor ---';

  perform set_config('request.jwt.claims',
    '{"sub":"eeee0000-0000-0000-0000-0000000000b4","role":"authenticated"}', true);
  set local role authenticated;

  select count(*) into n from producto;
  perform pg_temp.afirmar('El promotor ve el catalogo de su cliente', n = 1);

  permitido := false;
  begin
    insert into producto (cliente_id, nombre)
    values ('eeee1111-0000-0000-0000-00000000000b', 'Metido por el promotor');
    permitido := true;
  exception when others then null;
  end;
  perform pg_temp.afirmar('El promotor NO puede escribir en el catalogo', not permitido);

  reset role;

  select count(*) into n from perfil
   where organizacion_id = v_bimbo and nombre = 'Promotor' and puede_portal;
  perform pg_temp.afirmar('El perfil Promotor esta marcado como fuera del portal', n = 0);

  raise notice '--- Crear organizaciones ---';

  -- Un administrador de empresa no es administrador de plataforma
  perform set_config('request.jwt.claims',
    '{"sub":"eeee0000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
  set local role authenticated;
  perform pg_temp.afirmar('El raiz de una empresa NO es superadmin', not es_superadmin());
  permitido := false;
  begin
    perform crear_organizacion('Intrusa','intrusa',
                               'eeee0000-0000-0000-0000-0000000000b2','x');
    permitido := true;
  exception when others then null;
  end;
  perform pg_temp.afirmar('El raiz de una empresa NO puede crear otra', not permitido);
  reset role;

  raise notice '--- El administrador ve lo que da de alta ---';

  -- El caso real: un administrador da de alta un cliente y nadie le
  -- asigna nada en usuario_cliente. Antes de la migracion 012 el
  -- insert pasaba y el select no, asi que la pantalla seguia diciendo
  -- "sin clientes" y el segundo intento chocaba contra el unico.
  perform set_config('request.jwt.claims',
    '{"sub":"eeee0000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
  set local role authenticated;

  insert into cliente (organizacion_id, nombre)
  values (v_bimbo, 'Marca recien dada de alta');

  select count(*) into n from cliente where nombre = 'Marca recien dada de alta';
  perform pg_temp.afirmar('El admin ve el cliente que acaba de crear', n = 1);

  select count(*) into n from cliente;
  perform pg_temp.afirmar('Y ve todos los de su empresa, no solo el asignado',
    n = (select count(*) from cliente where organizacion_id = v_bimbo));
  reset role;

  -- Sin ser admin no cambia nada: el supervisor sigue viendo lo suyo.
  perform set_config('request.jwt.claims',
    '{"sub":"eeee0000-0000-0000-0000-0000000000b3","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into n from cliente;
  perform pg_temp.afirmar('El supervisor sigue viendo solo el asignado', n = 1);
  reset role;

  -- Y la frontera entre empresas aguanta: el nuevo cliente de Bimbo
  -- no se asoma del otro lado.
  perform set_config('request.jwt.claims',
    '{"sub":"eeee0000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into n from cliente;
  perform pg_temp.afirmar('El admin de Nestle sigue sin ver nada de Bimbo',
    n = (select count(*) from cliente where organizacion_id = v_nestle));
  reset role;

  raise notice '--- El administrador ve el trabajo de su empresa ---';

  -- El sintoma era confuso: el admin veia la ruta completa y el panel
  -- de Visitas en cero. itinerario tiene una segunda politica "for
  -- all" que le daba la lectura; visita no, y se quedaba colgada de
  -- itinerarios_visibles(), donde el admin no caia.
  perform set_config('request.jwt.claims',
    '{"sub":"eeee0000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
  set local role authenticated;

  select count(*) into n from itinerario
   where cliente_id = 'eeee1111-0000-0000-0000-00000000002b';
  perform pg_temp.afirmar('El admin ve rutas de una marca que no tiene asignada', n = 1);

  select count(*) into n from visita;
  perform pg_temp.afirmar('Y las visitas que el promotor ya completo', n = 1);
  reset role;

  -- La frontera entre empresas no se movio.
  perform set_config('request.jwt.claims',
    '{"sub":"eeee0000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into n from visita v
    join itinerario i on i.id = v.itinerario_id
    join pdv p on p.id = i.pdv_id
   where p.organizacion_id = v_bimbo;
  perform pg_temp.afirmar('El admin de Nestle no ve ninguna visita de Bimbo', n = 0);
  reset role;

  raise notice '--- Codigo de empleado ---';

  select count(*) into n from usuario where codigo = '1042';
  perform pg_temp.afirmar('El mismo codigo puede existir en dos empresas', n = 2);

  permitido := false;
  begin
    update usuario set codigo = '1042'
     where id = 'eeee0000-0000-0000-0000-0000000000b3';
    permitido := true;
  exception when others then null;
  end;
  perform pg_temp.afirmar('Pero no dos veces en la misma empresa', not permitido);

  perform set_config('request.jwt.claims', '', true);
  raise notice '';
  raise notice '*** Todas las pruebas pasaron ***';
end $$;

-- ---------------------------------------------------------------------
-- Limpieza
-- ---------------------------------------------------------------------
do $$
begin
  delete from organizacion where slug in ('pruebabimbo','pruebanestle','intrusa');
  delete from plataforma_admin where cuenta_id = 'eeee0000-0000-0000-0000-00000000000a';
  delete from auth.users where email like 'prueba.%@local';
  raise notice 'Limpieza hecha: no quedo nada de la prueba.';
end $$;

select 'Sin rastros' as estado,
       (select count(*) from organizacion where slug like 'prueba%') as organizaciones,
       (select count(*) from auth.users where email like 'prueba.%@local') as cuentas;
