-- ═══════════════════════════════════════════════════════════
-- Vigencia de pólizas — auditoría móvil 2026-07-25, Fase 1 (patrón Rango
-- de fechas).
--
-- Hallazgo "Pólizas": agregar "Fecha en la que inicia" (debajo de Número de
-- Contrato) y "Fecha en la que termina" (debajo de "Fecha en la que se
-- firmó"), elegidas con el selector único de rango (src/lib/dateRange.js)
-- en vez de dos cajas de fecha sueltas. Es funcionalidad nueva: hoy
-- patient_policies no tiene ninguna columna de fecha.
-- ═══════════════════════════════════════════════════════════

alter table public.patient_policies
  add column if not exists fecha_inicio date,
  add column if not exists fecha_fin    date;
