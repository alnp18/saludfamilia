-- MI AUDITORIA — Pacientes #5: condiciones crónicas (diagnósticos CIE10).
--
-- Solo se implementa la carga MANUAL del código CIE10 (el usuario ya lo
-- conoce) — la búsqueda por código o nombre contra un catálogo CIE10 queda
-- deferida a una fase futura: requiere decidir la fuente de datos (el PDF
-- de la OPS/PAHO no es consultable en vivo por código) y qué debería
-- verificar en la práctica "solo disponible con internet". Decisión
-- tomada junto con el usuario — ver tarea de la auditoría.
--
-- Uno a muchos (un paciente puede tener varias condiciones crónicas),
-- mismo patrón que patient_policies.
create table public.patient_diagnoses (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  patient_id uuid not null,
  codigo_cie10 text not null,
  descripcion text,
  created_at timestamptz not null default now(),
  foreign key (patient_id, household_id) references public.patients (id, household_id) on delete cascade
);

create index idx_patient_diagnoses_patient on public.patient_diagnoses (patient_id, household_id);

alter table public.patient_diagnoses enable row level security;

create policy patient_diagnoses_select on public.patient_diagnoses
  for select using (private.is_household_member(household_id));
create policy patient_diagnoses_insert on public.patient_diagnoses
  for insert with check (private.is_household_member(household_id));
create policy patient_diagnoses_delete on public.patient_diagnoses
  for delete using (private.is_household_member(household_id));

revoke all on public.patient_diagnoses from anon;
