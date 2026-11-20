-- =====================================================================
-- Migracion 013 — clonar_formulario() sin tabla temporal
--
-- El clonado fallaba en Supabase con "DELETE requires a WHERE clause".
-- La funcion armaba el mapa de preguntas viejas a nuevas en una tabla
-- temporal y la vaciaba con "delete from _mapa_preguntas;" sin WHERE.
-- Supabase bloquea los DELETE y UPDATE sin WHERE a proposito, asi que
-- la copia nunca se completaba. En mi Postgres de pruebas pasaba
-- porque ahi ese candado no existe.
--
-- En vez de ponerle un WHERE se va la tabla temporal entera, que
-- ademas nunca hizo falta: pregunta tiene unique (formulario_id,
-- orden), asi que la pregunta copiada es, por definicion, la que
-- tiene el mismo orden en el formulario nuevo. El mapa se resuelve
-- con un join y no hay estado que limpiar entre llamadas.
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

  insert into pregunta (formulario_id, orden, texto, tipo, obligatoria,
                        producto_id, subproducto_id, sku_id, config)
  select v_nuevo, orden, texto, tipo, obligatoria,
         producto_id, subproducto_id, sku_id, config
    from pregunta where formulario_id = p_origen;

  -- El orden es la llave: unique (formulario_id, orden) garantiza que
  -- cada pregunta vieja tiene exactamente una copia.
  insert into opcion_pregunta (pregunta_id, orden, texto)
  select n.id, o.orden, o.texto
    from opcion_pregunta o
    join pregunta v on v.id = o.pregunta_id and v.formulario_id = p_origen
    join pregunta n on n.formulario_id = v_nuevo and n.orden = v.orden;

  -- Las dos puntas de cada condicion se reapuntan a las copias: si solo
  -- se reapunta una, el formulario nuevo queda dependiendo de preguntas
  -- del original y se rompe en cuanto alguien edite la plantilla.
  insert into condicion_pregunta (pregunta_id, depende_de_id, operador, valor)
  select np.id, nd.id, c.operador, c.valor
    from condicion_pregunta c
    join pregunta vp on vp.id = c.pregunta_id   and vp.formulario_id = p_origen
    join pregunta vd on vd.id = c.depende_de_id and vd.formulario_id = p_origen
    join pregunta np on np.formulario_id = v_nuevo and np.orden = vp.orden
    join pregunta nd on nd.formulario_id = v_nuevo and nd.orden = vd.orden;

  return v_nuevo;
end;
$$;

grant execute on function clonar_formulario(uuid, uuid, text) to authenticated;
