-- ═══════════════════════════════════════════════════════════
-- Índices faltantes en FKs + optimización de RLS
-- (auth.uid() envuelto en subselect para que el planner lo
--  evalúe una sola vez por consulta, no por fila)
-- ═══════════════════════════════════════════════════════════

create index if not exists idx_households_created_by on public.households(created_by);
create index if not exists idx_orders_auth_centro on public.medical_orders(auth_centro_id);
create index if not exists idx_orders_medico_cita on public.medical_orders(medico_id_cita);
create index if not exists idx_orders_medico on public.medical_orders(medico_id);

drop policy households_insert on public.households;
create policy households_insert on public.households
  for insert with check ((select auth.uid()) = created_by);

drop policy household_members_insert on public.household_members;
create policy household_members_insert on public.household_members
  for insert with check (
    exists (
      select 1 from public.household_members hm
      where hm.household_id = household_members.household_id
        and hm.user_id = (select auth.uid())
        and hm.role = 'owner'
    )
  );

drop policy household_members_delete on public.household_members;
create policy household_members_delete on public.household_members
  for delete using (
    exists (
      select 1 from public.household_members hm
      where hm.household_id = household_members.household_id
        and hm.user_id = (select auth.uid())
        and hm.role = 'owner'
    )
  );
