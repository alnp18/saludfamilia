-- ═══════════════════════════════════════════════════════════
-- Anti-spam del directorio público (follow-up auditoría, punto 2)
--
-- Problema: la política de INSERT de public_doctors / public_centers
-- (migración 0020) permite que cualquier usuaria autenticada inserte
-- propuestas 'pendiente' SIN límite. Una cuenta maliciosa (o un bug de
-- cliente) puede inundar la cola de revisión de la admin con miles de
-- filas.
--
-- Solución: un trigger BEFORE INSERT que acota cuántas propuestas
-- 'pendiente' puede tener a la vez cada usuaria por tabla. No reemplaza ni
-- toca la RLS existente (que sigue garantizando propuesto_por = auth.uid()
-- y estado = 'pendiente' para quien no es admin): solo AGREGA un límite.
--
-- Criterio (mismo estilo que 0007 / 0020):
--  · La admin no tiene límite (altas directas y gestión del directorio).
--  · Solo se cuentan/limitan las propias filas en estado 'pendiente'.
--    Aprobar o rechazar libera cupo; el tope acota la cola, no el total
--    histórico de propuestas.
--  · SECURITY DEFINER + search_path fijo: el conteo ve todas las filas
--    (no pasa por RLS), que es justo lo que se quiere para contar las
--    pendientes reales de la usuaria.
-- ═══════════════════════════════════════════════════════════

create or replace function public.enforce_public_proposal_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  pending_count integer;
  max_pending   constant integer := 25;  -- tope de pendientes por usuaria y tabla
begin
  -- La admin gestiona el directorio sin tope.
  if private.is_app_admin() then
    return new;
  end if;

  -- Solo limitamos las propuestas que entran como 'pendiente'.
  if new.estado is distinct from 'pendiente' then
    return new;
  end if;

  -- Conteo dinámico sobre la tabla que disparó el trigger (ambas comparten
  -- las columnas propuesto_por y estado).
  execute format(
    'select count(*) from public.%I where propuesto_por = $1 and estado = ''pendiente''',
    tg_table_name
  ) into pending_count using new.propuesto_por;

  if pending_count >= max_pending then
    raise exception
      'Alcanzaste el límite de % propuestas pendientes en este directorio. Esperá a que se revisen antes de proponer más.',
      max_pending
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.enforce_public_proposal_limit() is
  'Anti-spam del directorio público (punto 2 de la auditoría): limita a 25 '
  'las propuestas en estado pendiente por usuaria y por tabla. La admin no '
  'tiene tope. La usan los triggers BEFORE INSERT de public_doctors y '
  'public_centers.';

-- Función de trigger: no se llama directamente desde el cliente.
revoke execute on function public.enforce_public_proposal_limit() from public, anon, authenticated;

create trigger trg_public_doctors_proposal_limit
  before insert on public.public_doctors
  for each row execute function public.enforce_public_proposal_limit();

create trigger trg_public_centers_proposal_limit
  before insert on public.public_centers
  for each row execute function public.enforce_public_proposal_limit();
