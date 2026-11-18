-- =====================================================================
-- Migracion 011 — Plantilla estandar de visita y clonado
--
-- Dos cosas:
--
-- 1. sembrar_plantilla_estandar(): crea en una organizacion un
--    formulario de auditoria de tienda listo para usar.
--
-- 2. clonar_formulario(): copia una plantilla para un cliente, con
--    todas sus preguntas, opciones y condiciones. Hasta ahora se
--    podia marcar un formulario como plantilla pero no habia forma
--    de usarla, que es para lo unico que sirve serlo.
--
-- DE DONDE SALE LA PLANTILLA
-- De como lo arman las marcas grandes: los programas de "tienda
-- perfecta" se organizan en disponibilidad, visibilidad, exhibicion
-- y precio, y las listas de auditoria de campo agregan competencia y
-- evidencia fotografica. Son siete bloques.
--
-- Esta pensada para recortarse, no para usarse entera. Veinticuatro
-- preguntas es mucho para una visita de quince minutos; cada cliente
-- clona y borra lo que no le toca. Mejor quitar que inventar.
--
-- POR QUE FUNCIONA PARA CUALQUIER CLIENTE
-- Los bloques de existencia y precio usan los tipos que se expanden
-- solos con el catalogo de cada quien. La misma plantilla sirve para
-- una marca de pan y para una de cafe sin reescribir una pregunta.
-- =====================================================================

-- =====================================================================
-- 1. SEMBRAR LA PLANTILLA
-- =====================================================================

create or replace function sembrar_plantilla_estandar(p_organizacion uuid)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_form uuid;
  v_estado   uuid;  -- de estas cuelgan preguntas condicionales
  v_promo    uuid;
  v_exhibe   uuid;
  v_incidencia uuid;
  v_p        uuid;

  -- Numera las preguntas sin tener que llevar la cuenta a mano.
  v_orden int := 0;
begin
  -- Idempotente: si ya la tiene, se devuelve la que hay.
  select id into v_form from formulario
   where organizacion_id = p_organizacion
     and es_plantilla
     and nombre = 'Auditoría de tienda (estándar)';
  if found then return v_form; end if;

  insert into formulario (organizacion_id, cliente_id, es_plantilla, nombre, descripcion)
  values (p_organizacion, null, true, 'Auditoría de tienda (estándar)',
          'Siete bloques: llegada, disponibilidad, precio, visibilidad, '
          'exhibición adicional, material POP y competencia. Clónala para '
          'un cliente y recorta lo que no aplique.')
  returning id into v_form;

  -- ---- Bloque 1: llegada -------------------------------------------
  v_orden := v_orden + 1;
  insert into pregunta (formulario_id, orden, texto, tipo, obligatoria, config)
  values (v_form, v_orden, 'Fachada del punto de venta', 'foto', true,
          '{"bloque":"Llegada","max_fotos":1}')
  returning id into v_p;

  v_orden := v_orden + 1;
  insert into pregunta (formulario_id, orden, texto, tipo, obligatoria, config)
  values (v_form, v_orden, '¿Cómo encontraste la tienda?', 'opcion_unica', true,
          '{"bloque":"Llegada"}')
  returning id into v_estado;
  insert into opcion_pregunta (pregunta_id, orden, texto) values
    (v_estado, 1, 'Abierta y operando'),
    (v_estado, 2, 'Cerrada'),
    (v_estado, 3, 'No permitieron el acceso'),
    (v_estado, 4, 'No se localizó la tienda');

  v_orden := v_orden + 1;
  insert into pregunta (formulario_id, orden, texto, tipo, obligatoria, config)
  values (v_form, v_orden, '¿Qué pasó?', 'texto', true, '{"bloque":"Llegada"}')
  returning id into v_p;
  insert into condicion_pregunta (pregunta_id, depende_de_id, operador, valor)
  values (v_p, v_estado, 'distinto', '"Abierta y operando"');

  -- ---- Bloque 2: disponibilidad ------------------------------------
  v_orden := v_orden + 1;
  insert into pregunta (formulario_id, orden, texto, tipo, obligatoria, config)
  values (v_form, v_orden, 'Existencia en anaquel por producto', 'existencia_sku', true,
          '{"bloque":"Disponibilidad"}');

  v_orden := v_orden + 1;
  insert into pregunta (formulario_id, orden, texto, tipo, obligatoria, config)
  values (v_form, v_orden, '¿Hay producto en bodega para resurtir?', 'booleano', false,
          '{"bloque":"Disponibilidad"}');

  v_orden := v_orden + 1;
  insert into pregunta (formulario_id, orden, texto, tipo, obligatoria, config)
  values (v_form, v_orden, '¿Falta alguna etiqueta de precio en el anaquel?', 'booleano', false,
          '{"bloque":"Disponibilidad"}');

  -- ---- Bloque 3: precio ---------------------------------------------
  v_orden := v_orden + 1;
  insert into pregunta (formulario_id, orden, texto, tipo, obligatoria, config)
  values (v_form, v_orden, 'Precio de anaquel por producto', 'precio_sku', true,
          '{"bloque":"Precio"}');

  v_orden := v_orden + 1;
  insert into pregunta (formulario_id, orden, texto, tipo, obligatoria, config)
  values (v_form, v_orden, '¿Hay promoción vigente de nuestra marca?', 'booleano', false,
          '{"bloque":"Precio"}')
  returning id into v_promo;

  v_orden := v_orden + 1;
  insert into pregunta (formulario_id, orden, texto, tipo, obligatoria, config)
  values (v_form, v_orden, '¿En qué productos y a qué precio?', 'texto', false,
          '{"bloque":"Precio"}')
  returning id into v_p;
  insert into condicion_pregunta (pregunta_id, depende_de_id, operador, valor)
  values (v_p, v_promo, 'igual', 'true');

  -- ---- Bloque 4: visibilidad ----------------------------------------
  v_orden := v_orden + 1;
  insert into pregunta (formulario_id, orden, texto, tipo, obligatoria, config)
  values (v_form, v_orden, 'Frentes de nuestra marca en el anaquel', 'numero', true,
          '{"bloque":"Visibilidad","min":0,"max":99}');

  v_orden := v_orden + 1;
  insert into pregunta (formulario_id, orden, texto, tipo, obligatoria, config)
  values (v_form, v_orden, '¿A qué altura está el producto?', 'opcion_unica', false,
          '{"bloque":"Visibilidad"}')
  returning id into v_p;
  insert into opcion_pregunta (pregunta_id, orden, texto) values
    (v_p, 1, 'Piso'), (v_p, 2, 'Altura de la mano'),
    (v_p, 3, 'Altura de los ojos'), (v_p, 4, 'Arriba de los ojos');

  v_orden := v_orden + 1;
  insert into pregunta (formulario_id, orden, texto, tipo, obligatoria, config)
  values (v_form, v_orden, '¿Se respeta el planograma?', 'opcion_unica', false,
          '{"bloque":"Visibilidad"}')
  returning id into v_p;
  insert into opcion_pregunta (pregunta_id, orden, texto) values
    (v_p, 1, 'Sí, completo'), (v_p, 2, 'Parcialmente'),
    (v_p, 3, 'No se respeta'), (v_p, 4, 'No hay planograma definido');

  v_orden := v_orden + 1;
  insert into pregunta (formulario_id, orden, texto, tipo, obligatoria, config)
  values (v_form, v_orden, 'Foto del anaquel completo', 'foto', true,
          '{"bloque":"Visibilidad","max_fotos":2}');

  -- ---- Bloque 5: exhibicion adicional -------------------------------
  v_orden := v_orden + 1;
  insert into pregunta (formulario_id, orden, texto, tipo, obligatoria, config)
  values (v_form, v_orden, '¿Hay exhibición adicional de la marca?', 'booleano', true,
          '{"bloque":"Exhibición adicional"}')
  returning id into v_exhibe;

  v_orden := v_orden + 1;
  insert into pregunta (formulario_id, orden, texto, tipo, obligatoria, config)
  values (v_form, v_orden, '¿De qué tipo?', 'opcion_unica', false,
          '{"bloque":"Exhibición adicional"}')
  returning id into v_p;
  insert into opcion_pregunta (pregunta_id, orden, texto) values
    (v_p, 1, 'Cabecera de góndola'), (v_p, 2, 'Isla'),
    (v_p, 3, 'Chequera o caja'), (v_p, 4, 'Exhibidor de piso'), (v_p, 5, 'Otra');
  insert into condicion_pregunta (pregunta_id, depende_de_id, operador, valor)
  values (v_p, v_exhibe, 'igual', 'true');

  v_orden := v_orden + 1;
  insert into pregunta (formulario_id, orden, texto, tipo, obligatoria, config)
  values (v_form, v_orden, '¿Cómo está de surtida?', 'opcion_unica', false,
          '{"bloque":"Exhibición adicional"}')
  returning id into v_p;
  insert into opcion_pregunta (pregunta_id, orden, texto) values
    (v_p, 1, 'Llena'), (v_p, 2, 'A la mitad'), (v_p, 3, 'Casi vacía');
  insert into condicion_pregunta (pregunta_id, depende_de_id, operador, valor)
  values (v_p, v_exhibe, 'igual', 'true');

  v_orden := v_orden + 1;
  insert into pregunta (formulario_id, orden, texto, tipo, obligatoria, config)
  values (v_form, v_orden, 'Foto de la exhibición adicional', 'foto', false,
          '{"bloque":"Exhibición adicional","max_fotos":2}')
  returning id into v_p;
  insert into condicion_pregunta (pregunta_id, depende_de_id, operador, valor)
  values (v_p, v_exhibe, 'igual', 'true');

  -- ---- Bloque 6: material POP ---------------------------------------
  v_orden := v_orden + 1;
  insert into pregunta (formulario_id, orden, texto, tipo, obligatoria, config)
  values (v_form, v_orden, '¿Qué material promocional está colocado?', 'opcion_multiple', false,
          '{"bloque":"Material POP"}')
  returning id into v_p;
  insert into opcion_pregunta (pregunta_id, orden, texto) values
    (v_p, 1, 'Cenefa'), (v_p, 2, 'Colgante'), (v_p, 3, 'Portaprecios'),
    (v_p, 4, 'Exhibidor'), (v_p, 5, 'Ninguno');

  v_orden := v_orden + 1;
  insert into pregunta (formulario_id, orden, texto, tipo, obligatoria, config)
  values (v_form, v_orden, '¿El material está en buen estado?', 'booleano', false,
          '{"bloque":"Material POP"}');

  v_orden := v_orden + 1;
  insert into pregunta (formulario_id, orden, texto, tipo, obligatoria, config)
  values (v_form, v_orden, 'Foto del material promocional', 'foto', false,
          '{"bloque":"Material POP","max_fotos":2}');

  -- ---- Bloque 7: competencia e incidencias ---------------------------
  v_orden := v_orden + 1;
  insert into pregunta (formulario_id, orden, texto, tipo, obligatoria, config)
  values (v_form, v_orden, '¿Qué promociones viste de la competencia?', 'texto', false,
          '{"bloque":"Competencia"}');

  v_orden := v_orden + 1;
  insert into pregunta (formulario_id, orden, texto, tipo, obligatoria, config)
  values (v_form, v_orden, 'Foto del anaquel de la competencia', 'foto', false,
          '{"bloque":"Competencia","max_fotos":2}');

  v_orden := v_orden + 1;
  insert into pregunta (formulario_id, orden, texto, tipo, obligatoria, config)
  values (v_form, v_orden, '¿Hubo alguna incidencia en la visita?', 'booleano', false,
          '{"bloque":"Competencia"}')
  returning id into v_incidencia;

  v_orden := v_orden + 1;
  insert into pregunta (formulario_id, orden, texto, tipo, obligatoria, config)
  values (v_form, v_orden, 'Cuéntala', 'texto', true, '{"bloque":"Competencia"}')
  returning id into v_p;
  insert into condicion_pregunta (pregunta_id, depende_de_id, operador, valor)
  values (v_p, v_incidencia, 'igual', 'true');

  v_orden := v_orden + 1;
  insert into pregunta (formulario_id, orden, texto, tipo, obligatoria, config)
  values (v_form, v_orden, 'Firma de quien atendió en la tienda', 'firma', false,
          '{"bloque":"Competencia"}');

  return v_form;
end;
$$;

revoke all on function sembrar_plantilla_estandar(uuid) from public;

-- =====================================================================
-- 2. CLONAR UNA PLANTILLA PARA UN CLIENTE
--
-- Copia el formulario con todas sus preguntas, opciones y
-- condiciones. Las condiciones apuntan a preguntas por identificador,
-- asi que hay que reapuntarlas a las copias: si no, el formulario
-- nuevo dependeria de las preguntas del original.
-- =====================================================================

create or replace function clonar_formulario(
  p_origen  uuid,
  p_cliente uuid,
  p_nombre  text default null
)
returns uuid
language plpgsql security invoker
set search_path = public
as $$
declare
  v_nuevo uuid;
  v_org   uuid;
begin
  if not puede('crear_formularios') then
    raise exception 'Tu perfil no tiene permiso para crear formularios';
  end if;

  select organizacion_id into v_org from formulario where id = p_origen;
  if v_org is null then
    raise exception 'No se encontró el formulario que quieres copiar';
  end if;

  insert into formulario (organizacion_id, cliente_id, es_plantilla, derivado_de,
                          nombre, descripcion, creado_por)
  select organizacion_id, p_cliente, false, p_origen,
         coalesce(p_nombre, nombre), descripcion, auth.uid()
    from formulario where id = p_origen
  returning id into v_nuevo;

  -- Las preguntas, guardando a que copia corresponde cada original.
  create temporary table if not exists _mapa_preguntas
    (viejo uuid primary key, nuevo uuid) on commit drop;
  delete from _mapa_preguntas;

  with copiadas as (
    insert into pregunta (formulario_id, orden, texto, tipo, obligatoria,
                          producto_id, subproducto_id, sku_id, config)
    select v_nuevo, orden, texto, tipo, obligatoria,
           producto_id, subproducto_id, sku_id, config
      from pregunta where formulario_id = p_origen
     order by orden
    returning id, orden
  )
  insert into _mapa_preguntas (viejo, nuevo)
  select v.id, c.id
    from copiadas c
    join pregunta v on v.formulario_id = p_origen and v.orden = c.orden;

  insert into opcion_pregunta (pregunta_id, orden, texto)
  select m.nuevo, o.orden, o.texto
    from opcion_pregunta o
    join _mapa_preguntas m on m.viejo = o.pregunta_id;

  -- Las dos puntas de cada condicion se reapuntan a las copias.
  insert into condicion_pregunta (pregunta_id, depende_de_id, operador, valor)
  select mp.nuevo, md.nuevo, c.operador, c.valor
    from condicion_pregunta c
    join _mapa_preguntas mp on mp.viejo = c.pregunta_id
    join _mapa_preguntas md on md.viejo = c.depende_de_id;

  return v_nuevo;
end;
$$;

grant execute on function clonar_formulario(uuid, uuid, text) to authenticated;

-- =====================================================================
-- 3. QUE TODA EMPRESA NAZCA CON ELLA
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
     '["ver_reportes","gestionar_itinerarios"]'::jsonb, false, true),
    (v_org, 'Cliente',
     '["ver_reportes"]'::jsonb, true, true),
    (v_org, 'Promotor',
     '["capturar_visitas"]'::jsonb, false, false);

  select id into v_perfil
    from perfil where organizacion_id = v_org and nombre = 'Administrador';

  insert into usuario (id, organizacion_id, perfil_id, nombre, es_admin_raiz)
  values (p_usuario_admin, v_org, v_perfil, p_nombre_admin, true);

  -- Que no empiece con la pantalla de formularios vacia.
  perform sembrar_plantilla_estandar(v_org);

  return v_org;
end;
$$;

-- Y las que ya existen tambien.
do $$
declare o record;
begin
  for o in select id from organizacion loop
    perform sembrar_plantilla_estandar(o.id);
  end loop;
end $$;

select f.nombre, count(p.id) as preguntas,
       (select count(*) from condicion_pregunta c
         join pregunta q on q.id = c.pregunta_id
        where q.formulario_id = f.id) as condicionales
  from formulario f
  left join pregunta p on p.formulario_id = f.id
 where f.es_plantilla
 group by f.id, f.nombre;
