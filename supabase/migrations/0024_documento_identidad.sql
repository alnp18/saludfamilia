-- ═══════════════════════════════════════════════════════════
-- Campo de identificación (tipo + número de documento) — auditoría móvil
-- 2026-07-26, Fase 2 (Ficha de Paciente)
--
-- RCN (Registro Civil de Nacimiento), TI (Tarjeta de Identidad), CC (Cédula
-- de Ciudadanía) y CE (Cédula de Extranjería) son los tipos de documento de
-- identidad colombianos relevantes para un paciente familiar (no aplica NIT,
-- que es de personas jurídicas). Se guardan como texto libre: CC/TI/RCN son
-- solo numéricos pero CE puede traer letras, así que la columna no puede ser
-- numeric — la validación de "solo dígitos salvo CE" vive en el formulario
-- (src/modules/patients.js), no en la base de datos.
-- ═══════════════════════════════════════════════════════════

alter table public.patients
  add column if not exists tipo_documento text,
  add column if not exists numero_documento text;
