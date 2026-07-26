-- ═══════════════════════════════════════════════════════════
-- Patrón Departamento/Municipio (DANE) — auditoría móvil 2026-07-25, Fase 1
--
-- Agrega columnas de departamento/municipio (división político-administrativa
-- del DANE) a los dos lugares con dirección que viven en columnas propias de
-- SQL: la dirección del propio paciente y los centros médicos privados.
--
-- El contacto de emergencia guarda su dirección dentro de la columna jsonb
-- `contacto_emergencia` (ver migración 0009); al ser jsonb no necesita
-- migración — el módulo agrega las claves `departamento`/`municipio` a ese
-- objeto directamente desde la capa de mapeo (src/lib/api.js).
--
-- Se guardan como texto libre (nombre del departamento/municipio), igual que
-- el resto de campos de dirección existentes: no son FK a un catálogo propio
-- porque la lista completa del DANE vive en el frontend
-- (src/lib/data/dane-departamentos-municipios.json), igual que otros
-- catálogos cerrados de la app (tipo de sangre, parentesco, etc.).
-- ═══════════════════════════════════════════════════════════

alter table public.patients
  add column if not exists departamento text,
  add column if not exists municipio    text;

alter table public.medical_centers
  add column if not exists departamento text,
  add column if not exists municipio    text;
