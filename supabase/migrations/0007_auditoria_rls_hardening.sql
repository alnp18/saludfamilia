-- ═══════════════════════════════════════════════════════════
-- Auditoría de seguridad RLS pre-lanzamiento (P1 #8) — endurecimiento
--
-- Hallazgos corregidos:
--  1. is_household_member() estaba expuesta como RPC en /rest/v1/rpc/
--     (WARN del linter que motivó esta auditoría). Solo revela la
--     membresía del propio caller, pero no necesita ser API pública: se
--     mueve al schema `private` (no expuesto por PostgREST). Las
--     políticas la referencian por OID, así que siguen funcionando.
--  2. Las FKs de una sola columna permitían referencias cruzadas entre
--     households (ej.: una orden de mi familia apuntando al paciente de
--     otra). Sin fuga de lectura, pero sí contaminación referencial. Se
--     reemplazan por FKs compuestas (col, household_id) que fuerzan que
--     todo lo referenciado pertenezca al mismo household. Verificado
--     antes: 0 violaciones en los datos existentes.
--  3. households.created_by era actualizable por cualquier miembro, y esa
--     columna otorga visibilidad permanente vía households_select (un
--     ex-miembro que se la hubiera asignado retendría acceso al nombre
--     del household). Se deja actualizable SOLO el nombre.
--  4. Defensa en profundidad: se revocan los grants de escritura que
--     ninguna política respalda (UPDATE en household_members; INSERT/
--     UPDATE en household_invitations — solo escriben las funciones
--     SECURITY DEFINER) y TODO acceso de `anon` a tablas de public (esta
--     app no tiene ninguna lectura anónima legítima).
--
-- Aceptado y documentado (sin cambio):
--  · create_household_invitation / redeem_household_invitation /
--    household_members_with_email siguen expuestas como RPC: SON la API
--    de invitaciones, con autorización interna probada por tests.
--  · households no tiene política de DELETE: ningún usuario borra
--    households por API (solo redeem_household_invitation, como owner de
--    la función, elimina el household vacío del invitado).
--  · "Leaked password protection" es configuración de Auth (dashboard),
--    no SQL — pendiente de activarse manualmente.
-- ═══════════════════════════════════════════════════════════

-- ───────────────────────────────────────────
-- 1. is_household_member fuera del schema expuesto
-- ───────────────────────────────────────────
create schema if not exists private;
grant usage on schema private to authenticated;
alter function public.is_household_member(uuid) set schema private;

-- ───────────────────────────────────────────
-- 2. Consistencia multi-tenant: FKs compuestas
-- ───────────────────────────────────────────
alter table public.patients        add constraint patients_id_household_key  unique (id, household_id);
alter table public.doctors         add constraint doctors_id_household_key   unique (id, household_id);
alter table public.medical_centers add constraint centers_id_household_key   unique (id, household_id);
alter table public.medications     add constraint medications_id_household_key unique (id, household_id);

alter table public.medical_orders
  drop constraint medical_orders_patient_id_fkey,
  add constraint medical_orders_patient_fkey
    foreign key (patient_id, household_id)
    references public.patients (id, household_id) on delete cascade,
  drop constraint medical_orders_medico_id_fkey,
  add constraint medical_orders_medico_fkey
    foreign key (medico_id, household_id)
    references public.doctors (id, household_id) on delete set null (medico_id),
  drop constraint medical_orders_medico_id_cita_fkey,
  add constraint medical_orders_medico_cita_fkey
    foreign key (medico_id_cita, household_id)
    references public.doctors (id, household_id) on delete set null (medico_id_cita),
  drop constraint medical_orders_auth_centro_id_fkey,
  add constraint medical_orders_auth_centro_fkey
    foreign key (auth_centro_id, household_id)
    references public.medical_centers (id, household_id) on delete set null (auth_centro_id);

alter table public.medications
  drop constraint medications_patient_id_fkey,
  add constraint medications_patient_fkey
    foreign key (patient_id, household_id)
    references public.patients (id, household_id) on delete cascade,
  drop constraint medications_medicamento_padre_id_fkey,
  add constraint medications_padre_fkey
    foreign key (medicamento_padre_id, household_id)
    references public.medications (id, household_id) on delete set null (medicamento_padre_id);

alter table public.vital_signs
  drop constraint vital_signs_patient_id_fkey,
  add constraint vital_signs_patient_fkey
    foreign key (patient_id, household_id)
    references public.patients (id, household_id) on delete cascade;

alter table public.doctors
  drop constraint doctors_centro_id_fkey,
  add constraint doctors_centro_fkey
    foreign key (centro_id, household_id)
    references public.medical_centers (id, household_id) on delete set null (centro_id);

-- ───────────────────────────────────────────
-- 3. households: solo el nombre es editable
-- ───────────────────────────────────────────
revoke update on public.households from authenticated, anon;
grant update (name) on public.households to authenticated;

drop policy households_update on public.households;
create policy households_update on public.households
  for update
  using (private.is_household_member(id))
  with check (private.is_household_member(id));

-- ───────────────────────────────────────────
-- 4. Defensa en profundidad: grants sin política que los respalde
-- ───────────────────────────────────────────
revoke update on public.household_members from authenticated, anon;
revoke insert, update on public.household_invitations from authenticated, anon;
revoke all on all tables in schema public from anon;

-- ───────────────────────────────────────────
-- 5. Documentar las RPC intencionales
-- ───────────────────────────────────────────
comment on function public.create_household_invitation(uuid) is
  'RPC intencional (SECURITY DEFINER): API de invitaciones. Autoriza internamente que el caller sea owner del household.';
comment on function public.redeem_household_invitation(text) is
  'RPC intencional (SECURITY DEFINER): API de canje. Valida código (hash, caducidad, un solo uso) y membresías internamente.';
comment on function public.household_members_with_email(uuid) is
  'RPC intencional (SECURITY DEFINER): expone el correo SOLO de co-miembros del household consultado.';
