-- 0033 — Documento de la orden, separado de la historia clínica
--
-- La etapa A tenía un solo adjunto, etiquetado "Historia clínica". Pero son
-- dos papeles distintos: la orden que firma el médico y la historia clínica de
-- la consulta. Guardarlos en el mismo campo obliga a elegir cuál se conserva.
--
-- OJO CON EL NOMBRE. La columna que ya existía se llama `orden_archivo` pero
-- guarda la HISTORIA CLÍNICA — se llamó así cuando era el único adjunto de la
-- etapa. La nueva, `orden_documento`, es la que guarda la orden propiamente
-- dicha. Renombrar `orden_archivo` sería lo correcto, pero cruzaría los datos
-- ya cargados durante el despliegue: entre que la columna cambia de nombre y
-- que el navegador de cada familia recibe el JavaScript nuevo, las dos puntas
-- estarían leyendo campos distintos. No vale el riesgo por un nombre.
--
--   orden_archivo    → Historia clínica  (existente, datos intactos)
--   orden_documento  → Orden             (nueva)

alter table public.medical_orders
  add column orden_documento jsonb;

comment on column public.medical_orders.orden_archivo is
  'Adjunto de la HISTORIA CLÍNICA de la etapa A. El nombre es histórico: era '
  'el único adjunto de la etapa. Ver 0033.';
comment on column public.medical_orders.orden_documento is
  'Adjunto de la ORDEN médica de la etapa A (ver 0033).';
