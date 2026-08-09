-- 0021b — Corregir household_members_with_email
--
-- Se aplicó a producción el 2026-07-25 (versión 20260725130145) sin quedar
-- versionada en el repo. Recuperada el 2026-08-09 desde
-- supabase_migrations.schema_migrations, tal cual se ejecutó.
--
-- Va numerada 0021b y no 0022 porque en la base se aplicó DESPUÉS de
-- 0021_directorio_publico_antispam (20260722015300) y ANTES de
-- 0022_departamento_municipio_patrones (20260726002211). Renumerar el resto
-- rompería la correspondencia con lo ya aplicado.
--
-- Qué arregla: la RPC llamaba a public.is_household_member(), que la
-- migración 0007 movió al schema private. La pestaña Familia respondía 404.

DROP FUNCTION IF EXISTS public.household_members_with_email(uuid);

CREATE FUNCTION public.household_members_with_email(p_household_id uuid)
RETURNS TABLE (user_id uuid, role text, joined_at timestamptz, email text) AS $$
BEGIN
  RETURN QUERY
  SELECT hm.user_id, hm.role, hm.joined_at, u.email::text
  FROM public.household_members hm
  JOIN auth.users u ON u.id = hm.user_id
  WHERE hm.household_id = p_household_id
    AND private.is_household_member(p_household_id)
  ORDER BY hm.role DESC, hm.joined_at;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION public.household_members_with_email(uuid) IS
  'RPC: lista miembros del household con sus correos (desde auth.users). '
  'Solo responde a miembros autenticados del household (vía is_household_member). '
  'Usa private.is_household_member() que fue movida en 0007_auditoria_rls_hardening.';
