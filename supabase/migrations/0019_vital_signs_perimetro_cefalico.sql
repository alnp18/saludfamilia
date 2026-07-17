-- Auditoría de Signos Vitales (adición 2026-07-17): perímetro cefálico.
--
-- Medida de crecimiento rutinaria en lactantes (< 2 años). Se guarda en cm
-- con un decimal, igual que los demás perímetros. Aditiva e idempotente.
alter table public.vital_signs add column if not exists per_cefalico numeric(5,1);
