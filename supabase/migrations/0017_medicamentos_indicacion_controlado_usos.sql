-- Auditoría de Medicamentos (2026-07-17).
--
-- 1) Dos columnas nuevas en medications:
--    - indicacion: enfermedad o síntoma por el que se toma el medicamento
--      (texto libre — decisión del usuario, no se enlaza al catálogo CIE10).
--    - controlado: marca de "medicamento controlado", para destacarlo y
--      agruparlo aparte en la lista de activos.
alter table public.medications add column indicacion text;
alter table public.medications add column controlado boolean not null default false;

-- 2) Registro de usos de los medicamentos "a demanda". Cada vez que se
--    presiona "USADO" (desde el dashboard o desde la tarjeta) se guarda un
--    evento con la razón y el momento del uso. Es append-only: no hay
--    política de UPDATE — corregir un apunte es eliminarlo y volver a
--    registrarlo.
--
-- FKs compuestas (col, household_id) hacia patients y medications, mismo
-- patrón endurecido de la migración 0007: impide referenciar un paciente o
-- un medicamento de OTRO household aunque se conozca su id.
create table public.med_usage_events (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  patient_id    uuid not null,
  medication_id uuid not null,
  usado_en      timestamptz not null default now(),
  razon         text not null,
  created_at    timestamptz not null default now(),
  foreign key (patient_id, household_id)    references public.patients   (id, household_id) on delete cascade,
  foreign key (medication_id, household_id) references public.medications (id, household_id) on delete cascade
);

create index idx_med_usage_med     on public.med_usage_events (medication_id, household_id);
create index idx_med_usage_patient on public.med_usage_events (patient_id, household_id);

alter table public.med_usage_events enable row level security;

create policy med_usage_events_select on public.med_usage_events
  for select using (private.is_household_member(household_id));
create policy med_usage_events_insert on public.med_usage_events
  for insert with check (private.is_household_member(household_id));
create policy med_usage_events_delete on public.med_usage_events
  for delete using (private.is_household_member(household_id));

revoke all on public.med_usage_events from anon;
