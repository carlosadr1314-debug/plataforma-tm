-- =====================================================================
-- Storage: bucket de evidencia fotografica y sus politicas
-- VERSION CORREGIDA
--
-- Cambios respecto de la version anterior:
--   - Se elimino "alter table storage.objects enable row level security".
--     Esa tabla pertenece al rol supabase_storage_admin, por lo que el
--     usuario del panel no puede alterarla y devuelve el error
--     "must be owner of table objects". No es necesaria: Supabase ya
--     trae RLS activado en storage.objects de fabrica.
--   - Se reescribieron las subconsultas sobre clientes_visibles() con
--     alias explicito, que es la forma correcta de recorrer una
--     funcion que devuelve un conjunto.
--
-- Ejecutar DESPUES de 06-esquema-supabase-v2.sql
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Bucket privado. Nunca publico: las fotos contienen ubicacion
--    y operacion de clientes distintos.
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'evidencia',
  'evidencia',
  false,
  5242880,                                   -- 5 MB por archivo
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 2. Politicas de acceso
--
--    Convencion de ruta dentro del bucket:
--    <agencia_id>/<cliente_id>/<visita_id>/<uuid>.jpg
--
--    La politica valida el primer y segundo segmento, de modo que un
--    usuario no pueda leer archivos de otra agencia ni de un cliente
--    que no tiene asignado.
-- ---------------------------------------------------------------------

drop policy if exists evidencia_lectura on storage.objects;
drop policy if exists evidencia_escritura on storage.objects;

create policy evidencia_lectura on storage.objects
for select to authenticated
using (
  bucket_id = 'evidencia'
  and (storage.foldername(name))[1] = agencia_actual()::text
  and (storage.foldername(name))[2] in (
    select cv::text from clientes_visibles() as cv
  )
);

create policy evidencia_escritura on storage.objects
for insert to authenticated
with check (
  bucket_id = 'evidencia'
  and (storage.foldername(name))[1] = agencia_actual()::text
  and (storage.foldername(name))[2] in (
    select cv::text from clientes_visibles() as cv
  )
);

-- Sin politica de update ni de delete: la evidencia es inmutable.
-- El borrado se hace con la llave de servicio desde el backoffice,
-- conforme a la politica de retencion que se defina.

-- ---------------------------------------------------------------------
-- 3. Una visita cerrada no admite cambios
-- ---------------------------------------------------------------------

create or replace function bloquear_visita_cerrada()
returns trigger language plpgsql as $$
declare
  cerrada timestamptz;
begin
  select v.check_out into cerrada
  from visita v
  where v.id = coalesce(new.visita_id, old.visita_id);

  if cerrada is not null then
    raise exception 'La visita ya fue cerrada; no admite cambios';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists tg_respuesta_visita_cerrada on respuesta;
drop trigger if exists tg_evidencia_visita_cerrada on evidencia;

create trigger tg_respuesta_visita_cerrada
  before insert or update or delete on respuesta
  for each row execute function bloquear_visita_cerrada();

create trigger tg_evidencia_visita_cerrada
  before insert or update or delete on evidencia
  for each row execute function bloquear_visita_cerrada();

-- ---------------------------------------------------------------------
-- 4. Verificacion
-- ---------------------------------------------------------------------

-- El bucket existe y es privado
select id, name, public, file_size_limit
from storage.buckets where id = 'evidencia';

-- Las dos politicas quedaron registradas
select policyname, cmd from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and policyname like 'evidencia%';

-- RLS ya viene activado de fabrica. Debe devolver true.
-- Si devuelve false, activalo desde Storage > Policies en el panel,
-- nunca por SQL.
select relrowsecurity as rls_activado
from pg_class where oid = 'storage.objects'::regclass;
