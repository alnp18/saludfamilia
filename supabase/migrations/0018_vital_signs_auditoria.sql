-- Auditoría de signos vitales: hora de toma, frecuencia respiratoria,
-- longitud tibial (alternativa a altura), y ampliación de precisión de
-- peso para admitir gramos de lactantes convertidos a kg con 3 decimales.
--
-- Nota: en la base de datos de producción esta migración quedó aplicada
-- bajo el nombre "0005_vital_signs_auditoria" (por trabajarse sobre una
-- copia local desactualizada); este archivo la documenta con el número
-- correcto en la secuencia. Es idempotente (IF NOT EXISTS), así que
-- reaplicarla no causa error.

alter table public.vital_signs add column if not exists hora time;
alter table public.vital_signs add column if not exists frecuencia_respiratoria integer;
alter table public.vital_signs add column if not exists longitud_tibial numeric(4,1);
alter table public.vital_signs alter column peso type numeric(6,3);