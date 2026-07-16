-- ═══════════════════════════════════════════════════════════
-- Edición de interfaz — Ficha de Paciente (P1.5)
--
-- Cambios de esquema para los 4 ítems de "Ficha de Paciente (creación y
-- edición)" del plan de avance:
--  1. Nombre del paciente: de un campo de texto libre a 4 columnas
--     (primer_nombre, segundo_nombre, primer_apellido, segundo_apellido).
--  2. Dirección de residencia: columna nueva.
--  3. Pólizas de seguro adicionales: tabla nueva patient_policies (uno a
--     muchos) + catálogo genérico y extensible custom_catalog_options
--     (patrón "Otra" — pensado para reutilizarse después en Vía de
--     administración (Medicamentos) y Especialidad (Médicos), en vez de
--     crear una tabla de catálogo distinta por módulo).
--  4. Contacto de emergencia: de un campo de texto libre a una estructura
--     (nombre completo, parentesco, dos teléfonos, dirección, ciudad).
--     Se modela como jsonb: es 1:1 con el paciente y no se necesita
--     filtrar/ordenar por sus campos, así que no amerita una tabla aparte.
--
-- Migración de datos existentes: en producción solo existe 1 paciente de
-- prueba. Se aplica un split heurístico (mejor esfuerzo) al nombre y al
-- contacto de emergencia ya cargados; al ser datos de prueba, se pueden
-- corregir a mano desde el formulario si el resultado no queda perfecto.
-- ═══════════════════════════════════════════════════════════

-- ───────────────────────────────────────────
-- 1. Nombre del paciente → 4 columnas
-- ───────────────────────────────────────────
alter table public.patients
  add column primer_nombre text,
  add column segundo_nombre text,
  add column primer_apellido text,
  add column segundo_apellido text;

with partes as (
  select id, string_to_array(trim(nombre), ' ') as w
  from public.patients
  where nombre is not null and trim(nombre) <> ''
)
update public.patients p
set
  primer_nombre    = partes.w[1],
  segundo_nombre   = case when array_length(partes.w, 1) >= 4 then partes.w[2] else null end,
  primer_apellido  = case
                        when array_length(partes.w, 1) <= 1 then ''
                        when array_length(partes.w, 1) >= 4 then partes.w[3]
                        else partes.w[2]
                      end,
  segundo_apellido = case
                        when array_length(partes.w, 1) = 4 then partes.w[4]
                        when array_length(partes.w, 1) = 3 then partes.w[3]
                        else null
                      end
from partes
where p.id = partes.id;

alter table public.patients
  alter column primer_nombre set default '',
  alter column primer_apellido set default '';

update public.patients set primer_nombre = '' where primer_nombre is null;
update public.patients set primer_apellido = '' where primer_apellido is null;

alter table public.patients
  alter column primer_nombre set not null,
  alter column primer_apellido set not null;

alter table public.patients drop column nombre;

-- ───────────────────────────────────────────
-- 2. Dirección de residencia
-- ───────────────────────────────────────────
alter table public.patients add column direccion text;

-- ───────────────────────────────────────────
-- 3. Pólizas de seguro adicionales + catálogo extensible genérico
-- ───────────────────────────────────────────
create table public.custom_catalog_options (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  categoria text not null, -- 'poliza_tipo' hoy; 'via_administracion' / 'especialidad' a futuro
  valor text not null,
  created_at timestamptz not null default now(),
  unique (household_id, categoria, valor)
);

alter table public.custom_catalog_options enable row level security;

create policy custom_catalog_options_select on public.custom_catalog_options
  for select using (private.is_household_member(household_id));
create policy custom_catalog_options_insert on public.custom_catalog_options
  for insert with check (private.is_household_member(household_id));
create policy custom_catalog_options_delete on public.custom_catalog_options
  for delete using (private.is_household_member(household_id));

create table public.patient_policies (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  patient_id uuid not null,
  tipo text not null,
  numero_poliza text,
  imagen jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (patient_id, household_id) references public.patients (id, household_id) on delete cascade
);

create index idx_patient_policies_patient on public.patient_policies (patient_id, household_id);

alter table public.patient_policies enable row level security;

create policy patient_policies_select on public.patient_policies
  for select using (private.is_household_member(household_id));
create policy patient_policies_insert on public.patient_policies
  for insert with check (private.is_household_member(household_id));
create policy patient_policies_update on public.patient_policies
  for update using (private.is_household_member(household_id)) with check (private.is_household_member(household_id));
create policy patient_policies_delete on public.patient_policies
  for delete using (private.is_household_member(household_id));

revoke all on public.custom_catalog_options, public.patient_policies from anon;

-- ───────────────────────────────────────────
-- 4. Contacto de emergencia → estructura (jsonb)
-- ───────────────────────────────────────────
alter table public.patients add column contacto_emergencia_new jsonb;

with partes as (
  select id, string_to_array(contacto_emergencia, ' · ') as seg
  from public.patients
  where contacto_emergencia is not null and trim(contacto_emergencia) <> ''
)
update public.patients p
set contacto_emergencia_new = jsonb_build_object(
  'primerNombre', coalesce(partes.seg[1], ''),
  'segundoNombre', null,
  'primerApellido', null,
  'segundoApellido', null,
  'parentesco', lower(coalesce(partes.seg[2], '')),
  'telefono1', coalesce(partes.seg[3], ''),
  'telefono2', null,
  'direccion', null,
  'ciudad', null
)
from partes
where p.id = partes.id;

alter table public.patients drop column contacto_emergencia;
alter table public.patients rename column contacto_emergencia_new to contacto_emergencia;
