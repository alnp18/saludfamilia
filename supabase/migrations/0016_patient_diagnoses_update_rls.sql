-- Auditoría 2026-07-17: los diagnósticos ahora pueden editarse (antes solo
-- se podían agregar o eliminar — ver comentario original en la migración
-- 0014). Falta la política RLS de UPDATE, que nunca se creó porque ese
-- flujo no existía. Mismo patrón que patient_policies_update (migración
-- 0009).
create policy patient_diagnoses_update on public.patient_diagnoses
  for update using (private.is_household_member(household_id)) with check (private.is_household_member(household_id));
