-- 0032 — Dos avisos del linter de Supabase, cerrados
--
-- Salieron al revisar los advisors después de 0031. Ninguno es explotable hoy,
-- pero los dos son de la clase que deja de ser inofensiva en cuanto alguien
-- cambia algo cerca.

-- 1) household_members_with_email es SECURITY DEFINER y `anon` podía llamarla
--    por /rest/v1/rpc/. Sin sesión no devuelve nada, porque adentro exige
--    private.is_household_member() y para anon eso es falso — pero la defensa
--    queda dependiendo de una comprobación en el cuerpo de una función que
--    corre con permisos elevados. Que ni siquiera sea invocable es más barato
--    de sostener que revisar cada vez que se toque el cuerpo.
revoke execute on function public.household_members_with_email(uuid) from anon;

-- 2) order_stage() no fija search_path. Es la única función del esquema sin
--    fijarlo (0002 endureció el resto). No es SECURITY DEFINER, así que no hay
--    escalación posible acá; se alinea con el resto para que el linter quede
--    limpio y el próximo aviso real no se pierda entre ruido conocido.
alter function public.order_stage(public.medical_orders) set search_path = public;
