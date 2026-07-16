-- ═══════════════════════════════════════════════════════════
-- Adjuntos en Supabase Storage (P1 #7)
--
-- Hasta ahora los archivos de las órdenes médicas (orden, solicitud,
-- autorización) se guardaban como data-URL base64 dentro de columnas
-- jsonb. Eso infla las filas, viaja completo en cada SELECT y limita el
-- tamaño práctico. Se migra a un bucket privado, con el mismo modelo de
-- aislamiento que el resto de la app:
--
--  · Ruta de cada objeto: <household_id>/<order_id>/<slot>-<ts>-<nombre>
--  · Las políticas reutilizan is_household_member() sobre el primer
--    segmento de la ruta — un usuario solo ve/sube/borra archivos de
--    households a los que pertenece.
--  · Bucket privado (los archivos se sirven con URLs firmadas), máx.
--    10MB por archivo, solo imágenes y PDF.
--  · Sin política de UPDATE: cada subida usa una ruta nueva (sin
--    upsert); reemplazar = subir nuevo + borrar viejo.
--
-- Migración de datos existentes: al aplicarse esta migración se verificó
-- que NO había ningún adjunto base64 en producción (0 filas con
-- orden_archivo/solicitud_imagen/auth_imagen), así que no hay datos que
-- mover. El cliente conserva compatibilidad de lectura con el formato
-- viejo {name, type, data} por si aparece en archivos de exportación
-- antiguos; el formato nuevo es {name, type, size, path}.
-- ═══════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'adjuntos', 'adjuntos', false, 10485760,
  array['image/jpeg','image/png','image/webp','image/gif','application/pdf']
)
on conflict (id) do nothing;

create policy adjuntos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'adjuntos'
    and public.is_household_member(((storage.foldername(name))[1])::uuid)
  );

create policy adjuntos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'adjuntos'
    and public.is_household_member(((storage.foldername(name))[1])::uuid)
  );

create policy adjuntos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'adjuntos'
    and public.is_household_member(((storage.foldername(name))[1])::uuid)
  );
