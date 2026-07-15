-- ═══════════════════════════════════════════════════════════
-- Fix: 403 al crear el primer household de un usuario nuevo
--
-- ensureHousehold() hace INSERT ... RETURNING sobre households. La
-- política de SELECT dependía solo de is_household_member(), una función
-- STABLE que dentro de la misma sentencia no ve la membership que el
-- trigger on_household_created acaba de insertar — por lo que el
-- RETURNING fallaba con 403 y bloqueaba todo uso de la app tras signup.
--
-- Solución: el creador del household siempre puede verlo, además de
-- cualquier miembro. (Aplicada en la BD el 2026-07-10; este archivo se
-- agregó al repo después para mantener el historial completo.)
-- ═══════════════════════════════════════════════════════════

drop policy households_select on public.households;
create policy households_select on public.households
  for select using (
    public.is_household_member(id)
    or (select auth.uid()) = created_by
  );
