-- ═══════════════════════════════════════════════════════════
-- Sistema de curación del directorio público — auditoría móvil
-- 2026-07-26, Fase 4
--
-- Qué faltaba: la migración 0020 resolvió proponer entradas NUEVAS
-- (public_doctors / public_centers con estado pendiente → publicado). Lo
-- que no existía era proponer una CORRECCIÓN a algo ya publicado: si una
-- familia detectaba que un médico cambió de consultorio, o que le falta una
-- especialidad, no tenía cómo decirlo — solo la admin podía editar, y para
-- eso tenía que enterarse por fuera de la app.
--
-- Esta tabla es la "tabla de cambios" del plan. La unidad es el CAMPO, no
-- la propuesta: una fila por campo que se quiere cambiar. Esa granularidad
-- es lo que permite las tres cosas que pide el panel de revisión —
-- aceptar o rechazar dato por dato, contar cuántos cambios trae una entrada
-- para el badge, y mostrar "valor anterior → valor propuesto" en cada
-- renglón. Con una fila por propuesta habría que meter un jsonb y volver a
-- desarmarlo en el cliente para lo mismo.
--
-- `valor_anterior` es una FOTO del valor al momento de proponer, no una
-- lectura en vivo. Se guarda así a propósito: es lo que la proponente
-- estaba viendo cuando decidió que estaba mal, y es la única forma de que
-- el panel pueda advertir que la entrada cambió desde entonces (si el valor
-- actual ya no coincide con la foto, aceptar el cambio a ciegas pisaría una
-- edición más nueva de la admin).
--
-- Dos columnas de destino con FK real en vez de un par (tabla, id)
-- polimórfico: así el borrado en cascada lo hace Postgres y no puede quedar
-- una propuesta huérfana apuntando a algo que ya no existe. Las tablas
-- públicas son globales (sin household_id), así que acá una FK no filtra
-- nada — el mismo criterio con el que 0020 sí puso FK en public_source_id.
-- ═══════════════════════════════════════════════════════════

create table public.directory_change_proposals (
  id                uuid primary key default gen_random_uuid(),
  public_doctor_id  uuid references public.public_doctors(id) on delete cascade,
  public_center_id  uuid references public.public_centers(id) on delete cascade,
  campo             text not null,
  valor_anterior    text,
  valor_propuesto   text,
  estado            text not null default 'pendiente'
                      check (estado in ('pendiente', 'aceptado', 'rechazado')),
  propuesto_por     uuid default auth.uid() references auth.users(id) on delete set null,
  revisado_por      uuid references auth.users(id) on delete set null,
  revisado_en       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- Exactamente un destino: o médico o centro, nunca los dos ni ninguno.
  constraint dcp_un_solo_destino check (
    (public_doctor_id is not null)::int + (public_center_id is not null)::int = 1
  )
);

comment on table public.directory_change_proposals is
  'Correcciones propuestas a entradas YA publicadas del directorio público. '
  'Una fila por campo (ver comentario de la migración 0026): así el panel de '
  'revisión puede aceptar/rechazar dato por dato y contar cuántos cambios '
  'trae cada entrada.';

comment on column public.directory_change_proposals.valor_anterior is
  'Foto del valor al momento de proponer. Si al revisar ya no coincide con '
  'el valor actual, la entrada cambió desde entonces y aceptar el cambio a '
  'ciegas pisaría una edición más nueva — el panel lo advierte.';

-- Sin índice sobre `campo`: nunca se busca por nombre de campo, siempre se
-- traen todos los pendientes de una entrada juntos.
create index idx_dcp_pendientes_doctor on public.directory_change_proposals (public_doctor_id)
  where estado = 'pendiente' and public_doctor_id is not null;
create index idx_dcp_pendientes_centro on public.directory_change_proposals (public_center_id)
  where estado = 'pendiente' and public_center_id is not null;
create index idx_dcp_proponente on public.directory_change_proposals (propuesto_por);

create trigger trg_dcp_updated_at
  before update on public.directory_change_proposals
  for each row execute function public.set_updated_at();

-- Misma auditoría automática que 0020: quién resolvió el cambio y cuándo,
-- puesto por el servidor para que la UI no pueda olvidarlo ni atribuirlo a
-- otra cuenta.
create trigger trg_dcp_review_meta
  before update on public.directory_change_proposals
  for each row execute function public.set_directory_review_meta();

-- ───────────────────────────────────────────
-- RLS — mismo criterio que 0020
-- ───────────────────────────────────────────
alter table public.directory_change_proposals enable row level security;

-- Ver: lo propio (la proponente sigue qué pasó con su corrección) y todo
-- (la admin, que es quien revisa). Una corrección pendiente NO es visible
-- para el resto: todavía no es verdad, y mostrarla como si lo fuera
-- confundiría el directorio.
create policy dcp_select on public.directory_change_proposals
  for select using (
    propuesto_por = (select auth.uid())
    or private.is_app_admin()
  );

-- Proponer: cualquier autenticado, solo a su nombre y solo como pendiente.
-- La admin no necesita esta vía (edita la entrada directamente).
create policy dcp_insert on public.directory_change_proposals
  for insert with check (
    propuesto_por = (select auth.uid())
    and estado = 'pendiente'
  );

-- Resolver (aceptar/rechazar): solo la admin.
create policy dcp_update on public.directory_change_proposals
  for update using (private.is_app_admin())
  with check (private.is_app_admin());

-- Eliminar: la admin siempre; la proponente solo lo suyo y solo mientras
-- siga pendiente — una vez resuelto, el registro es historial de auditoría.
create policy dcp_delete on public.directory_change_proposals
  for delete using (
    private.is_app_admin()
    or (propuesto_por = (select auth.uid()) and estado = 'pendiente')
  );

revoke all on public.directory_change_proposals from anon;
