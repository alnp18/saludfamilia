-- ═══════════════════════════════════════════════════════════
-- Recordatorios de orden — auditoría móvil 2026-07-26, Fase 3
--
-- "¿Recordarme cada 3 días?": una orden radicada ante la EPS puede quedarse
-- semanas sin autorización, y quien la radicó se olvida de insistir. El
-- recordatorio existe justamente para ese hueco, así que muere solo cuando
-- la autorización llega (etapa C) — no hay que acordarse de apagarlo.
--
-- `proximo_aviso` es la fecha/hora del siguiente aviso. Se recalcula sumando
-- `cada_dias` cada vez que se entrega uno. Se guarda del lado del servidor y
-- no en el navegador para que el recordatorio siga existiendo aunque se
-- cambie de teléfono, se borren los datos del sitio o entre otra persona de
-- la familia.
--
-- Un recordatorio por orden: insistir dos veces por lo mismo no aporta.
-- ═══════════════════════════════════════════════════════════

create table public.order_reminders (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  order_id uuid not null references public.medical_orders(id) on delete cascade,
  cada_dias int not null default 3 check (cada_dias between 1 and 30),
  proximo_aviso timestamptz not null,
  ultimo_aviso timestamptz,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (order_id)
);

create index idx_order_reminders_pendientes
  on public.order_reminders (household_id, proximo_aviso)
  where activo;

alter table public.order_reminders enable row level security;

create policy order_reminders_select on public.order_reminders
  for select using (private.is_household_member(household_id));
create policy order_reminders_insert on public.order_reminders
  for insert with check (private.is_household_member(household_id));
create policy order_reminders_update on public.order_reminders
  for update using (private.is_household_member(household_id));
create policy order_reminders_delete on public.order_reminders
  for delete using (private.is_household_member(household_id));

revoke all on public.order_reminders from anon;
