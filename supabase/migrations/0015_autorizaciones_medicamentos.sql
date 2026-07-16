-- ═══════════════════════════════════════════════════════════
-- MI AUDITORIA — Órdenes #4: tipo de orden "Medicamentos/Insumos/Terapias"
--
-- 1. Se elimina el tipo "Insumos Médicos" y se renombra "Medicamentos" a
--    "Medicamentos/Insumos/Terapias" — ambos tipos existentes (guardados
--    hoy como 'Medicamento' y 'Suministro médico') se fusionan en el
--    nuevo nombre. Verificado antes de migrar: ninguna de las 3 órdenes
--    de prueba afectadas tenía cita ni autorización ya cargada, así que
--    la fusión no pierde información.
-- 2. Este tipo de orden reemplaza la etapa "Autorización" (un solo
--    registro) por "Autorizaciones" (plural): se declara un número de
--    meses y se genera una fila por mes en una tabla nueva
--    order_authorizations (número de autorización, fecha de inicio,
--    fecha de vencimiento, cantidad, entregado). Decisión tomada con el
--    usuario: una fila por mes, no un dato meramente informativo.
-- 3. Como este tipo de orden nunca pasa por "Cita" (se bloquea en la UI),
--    order_stage() se ajusta para que pueda llegar a "Finalizado" sin
--    fecha de cita: reutiliza estado_cita (ya es el campo "proceso
--    finalizado manualmente") apenas se haya definido auth_meses.
--    Decisión tomada con el usuario: botón manual "Marcar como
--    finalizado", no automático ni "sin estado terminal".
-- ═══════════════════════════════════════════════════════════

alter table public.medical_orders add column auth_meses integer;

update public.medical_orders
set tipo_orden = 'Medicamentos/Insumos/Terapias'
where tipo_orden in ('Medicamento', 'Suministro médico');

-- Necesario para la FK compuesta de order_authorizations (mismo patrón
-- que patients/doctors/medical_centers/medications en la migración 0007).
alter table public.medical_orders
  add constraint medical_orders_id_household_key unique (id, household_id);

create table public.order_authorizations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  order_id uuid not null,
  mes_numero integer not null,
  numero_autorizacion text,
  fecha_inicio date,
  fecha_vencimiento date,
  cantidad text,
  entregado boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (order_id, household_id) references public.medical_orders (id, household_id) on delete cascade
);

create index idx_order_authorizations_order on public.order_authorizations (order_id, household_id);

alter table public.order_authorizations enable row level security;

create policy order_authorizations_select on public.order_authorizations
  for select using (private.is_household_member(household_id));
create policy order_authorizations_insert on public.order_authorizations
  for insert with check (private.is_household_member(household_id));
create policy order_authorizations_update on public.order_authorizations
  for update using (private.is_household_member(household_id)) with check (private.is_household_member(household_id));
create policy order_authorizations_delete on public.order_authorizations
  for delete using (private.is_household_member(household_id));

revoke all on public.order_authorizations from anon;

-- order_stage(): "Medicamentos/Insumos/Terapias" nunca pasa por Cita, así
-- que necesita sus propias reglas de C y Finalizado ANTES de las reglas
-- generales (que exigen cita_fecha para llegar a D/Finalizado).
create or replace function public.order_stage(o public.medical_orders)
returns text
language sql
stable
as $$
  select case
    when o.tipo_orden = 'Medicamentos/Insumos/Terapias' and o.estado_cita = 'Finalizado' then 'Finalizado'
    when o.tipo_orden = 'Medicamentos/Insumos/Terapias' and o.auth_meses is not null then 'C'
    when o.cita_fecha is not null and o.estado_cita = 'Finalizado' then 'Finalizado'
    when o.cita_fecha is not null then 'D'
    when o.auth_numero is not null or o.auth_fecha_inicio is not null then 'C'
    when o.solicitud_numero is not null or o.solicitud_fecha is not null then 'B'
    else 'A'
  end;
$$;
