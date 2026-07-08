-- ═══════════════════════════════════════════════════════════
-- Endurecimiento post-advisors de seguridad
-- 1) search_path fijo en funciones (evita search_path hijacking)
-- 2) handle_new_household: nadie debe poder invocarla por RPC directo,
--    solo la dispara el trigger on_household_created
-- 3) is_household_member: se usa dentro de políticas RLS, así que
--    "authenticated" debe conservar EXECUTE; se revoca solo a "anon"
-- ═══════════════════════════════════════════════════════════

alter function public.set_updated_at() set search_path = public;
alter function public.order_stage(public.medical_orders) set search_path = public;
alter function public.is_household_member(uuid) set search_path = public;
alter function public.handle_new_household() set search_path = public;

revoke execute on function public.handle_new_household() from public, anon, authenticated;
revoke execute on function public.is_household_member(uuid) from public, anon;
grant execute on function public.is_household_member(uuid) to authenticated;
