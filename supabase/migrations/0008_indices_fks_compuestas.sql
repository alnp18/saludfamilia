-- ═══════════════════════════════════════════════════════════
-- Índices cobertores para las FKs compuestas de la migración 0007
--
-- Las FKs compuestas (col, household_id) necesitan un índice cuyas
-- columnas iniciales coincidan para que los chequeos referenciales (y los
-- deletes en cascada) no escaneen la tabla. Se REEMPLAZAN los índices de
-- una sola columna por sus versiones compuestas — misma cantidad de
-- índices y las consultas de la app (que filtran por la primera columna)
-- se sirven igual. vital_signs conserva (patient_id, fecha) para el
-- listado ordenado y suma el cobertor de la FK.
-- ═══════════════════════════════════════════════════════════

drop index if exists idx_orders_patient;
create index idx_orders_patient on public.medical_orders (patient_id, household_id);
drop index if exists idx_orders_medico;
create index idx_orders_medico on public.medical_orders (medico_id, household_id);
drop index if exists idx_orders_medico_cita;
create index idx_orders_medico_cita on public.medical_orders (medico_id_cita, household_id);
drop index if exists idx_orders_auth_centro;
create index idx_orders_auth_centro on public.medical_orders (auth_centro_id, household_id);

drop index if exists idx_meds_patient;
create index idx_meds_patient on public.medications (patient_id, household_id);
drop index if exists idx_meds_padre;
create index idx_meds_padre on public.medications (medicamento_padre_id, household_id);

create index idx_vitals_patient_household on public.vital_signs (patient_id, household_id);

drop index if exists idx_doctors_centro;
create index idx_doctors_centro on public.doctors (centro_id, household_id);

-- FKs de household_invitations hacia auth.users
create index idx_invitations_created_by on public.household_invitations (created_by);
create index idx_invitations_used_by on public.household_invitations (used_by);
