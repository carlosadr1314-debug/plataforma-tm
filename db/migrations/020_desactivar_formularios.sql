-- =====================================================================
-- Migracion 020 — Desactivar formularios, solo quien administra
--
-- La columna activo existe desde la 001 y nadie la usaba: ni habia
-- como cambiarla desde el portal ni el telefono la miraba.
--
-- Por que una funcion y no dejar el update a secas: la politica de
-- escritura de formulario pide 'crear_formularios', que es el permiso
-- de quien arma los formularios. Desactivar uno es otra cosa —saca de
-- circulacion algo que ya se esta usando en campo— y se pidio que sea
-- cosa de administradores. RLS no distingue por columna, asi que la
-- unica forma de pedir un permiso distinto para ESTE cambio es
-- sacarlo a una funcion.
--
-- Desactivar NO borra nada. Las visitas hechas con ese formulario y
-- sus respuestas se siguen consultando igual; lo que deja de pasar es
-- que se pida en rutas nuevas.
-- =====================================================================

create or replace function fijar_formulario_activo(
  p_formulario uuid,
  p_activo boolean
)
returns formulario
language plpgsql security definer
set search_path = public
as $$
declare f formulario;
begin
  if not puede('admin') then
    raise exception 'Solo un administrador puede activar o desactivar formularios'
      using errcode = 'insufficient_privilege';
  end if;

  update formulario
     set activo = p_activo
   where id = p_formulario
     and organizacion_id = organizacion_actual()
  returning * into f;

  if not found then
    raise exception 'Ese formulario no existe o no es de tu empresa'
      using errcode = 'no_data_found';
  end if;

  return f;
end;
$$;

comment on function fijar_formulario_activo(uuid, boolean) is
  'Activa o desactiva un formulario. Solo con el permiso admin: armar '
  'formularios y sacarlos de circulacion son decisiones distintas. '
  'Desactivar no borra nada de lo ya capturado.';

grant execute on function fijar_formulario_activo(uuid, boolean) to authenticated;
