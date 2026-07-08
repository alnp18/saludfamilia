-- ═══════════════════════════════════════════════════════════
-- SaludFamilia — Esquema inicial
-- Multiusuario: cada grupo familiar ("household") tiene N usuarios
-- RLS: un usuario solo ve datos de los households a los que pertenece
-- ═══════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ───────────────────────────────────────────
-- 1. HOUSEHOLDS (grupos familiares) + MEMBRESÍA
-- ───────────────────────────────────────────
create table public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'Mi familia',
  created_by  uuid not null references auth.users(id) on delete restrict,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null default 'member' check (role in ('owner','member')),
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);

create index idx_household_members_user on public.household_members(user_id);

-- Al crear un household, su creador queda como owner automáticamente
create or replace function public.handle_new_household()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.household_members (household_id, user_id, role)
  values (new.id, new.created_by, 'owner');
  return new;
end;
$$;

create trigger on_household_created
  after insert on public.households
  for each row execute function public.handle_new_household();

-- Helper: ¿el usuario actual pertenece a este household?
-- security definer para evitar recursión de RLS sobre household_members
create or replace function public.is_household_member(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.household_members hm
    where hm.household_id = hid and hm.user_id = auth.uid()
  );
$$;

-- ───────────────────────────────────────────
-- 2. TRIGGER GENÉRICO updated_at
-- ───────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ───────────────────────────────────────────
-- 3. PATIENTS
-- ───────────────────────────────────────────
create table public.patients (
  id                    uuid primary key default gen_random_uuid(),
  household_id          uuid not null references public.households(id) on delete cascade,
  nombre                text not null,
  fecha_nacimiento      date,
  sexo                  text check (sexo in ('Masculino','Femenino','Otro')),
  tipo_sangre           text,
  eps                   text,
  numero_afiliado       text,
  contacto_emergencia   text,
  notas                 text,
  light_mode            boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index idx_patients_household on public.patients(household_id);

create trigger trg_patients_updated_at
  before update on public.patients
  for each row execute function public.set_updated_at();

-- ───────────────────────────────────────────
-- 4. MEDICAL_CENTERS
-- ───────────────────────────────────────────
create table public.medical_centers (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  nombre        text not null,
  tel1          text,
  tel2          text,
  direccion     text,
  email         text,
  web           text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index idx_centers_household on public.medical_centers(household_id);

create trigger trg_centers_updated_at
  before update on public.medical_centers
  for each row execute function public.set_updated_at();

-- ───────────────────────────────────────────
-- 5. DOCTORS
-- ───────────────────────────────────────────
create table public.doctors (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references public.households(id) on delete cascade,
  nombre         text not null,
  especialidad   text,
  centro_id      uuid references public.medical_centers(id) on delete set null,
  consultorio    text,
  telefono       text,
  notas          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index idx_doctors_household on public.doctors(household_id);
create index idx_doctors_centro on public.doctors(centro_id);

create trigger trg_doctors_updated_at
  before update on public.doctors
  for each row execute function public.set_updated_at();

-- ───────────────────────────────────────────
-- 6. MEDICAL_ORDERS  (flujo A → B → C → D)
-- ───────────────────────────────────────────
create table public.medical_orders (
  id                  uuid primary key default gen_random_uuid(),
  household_id        uuid not null references public.households(id) on delete cascade,
  patient_id          uuid not null references public.patients(id) on delete cascade,

  -- Etapa A · Orden
  medico_id           uuid references public.doctors(id) on delete set null,
  fecha_orden         date,
  tipo_orden          text,
  descripcion         text,
  orden_archivo       jsonb,

  -- Etapa B · Solicitud
  solicitud_fecha     date,
  solicitud_hora      time,
  solicitud_numero    text,
  solicitud_imagen    jsonb,

  -- Etapa C · Autorización
  auth_fecha_inicio   date,
  auth_fecha_vence    date,
  auth_numero         text,
  auth_centro_id      uuid references public.medical_centers(id) on delete set null,
  auth_imagen         jsonb,

  -- Etapa D · Cita
  cita_fecha          date,
  cita_hora           time,
  medico_id_cita      uuid references public.doctors(id) on delete set null,
  cita_consultorio    text,
  cita_direccion      text,
  cita_indicaciones   text,
  estado_cita         text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index idx_orders_household on public.medical_orders(household_id);
create index idx_orders_patient on public.medical_orders(patient_id);
create index idx_orders_auth_vence on public.medical_orders(auth_fecha_vence);
create index idx_orders_cita_fecha on public.medical_orders(cita_fecha);

create trigger trg_orders_updated_at
  before update on public.medical_orders
  for each row execute function public.set_updated_at();

-- Etapa calculada (A/B/C/D/Finalizado) — función, no columna generada,
-- porque depende de estado_cita y no de current_date (así que sí podría
-- ser generada, pero se deja como función para reutilizar en vistas).
create or replace function public.order_stage(o public.medical_orders)
returns text
language sql
stable
as $$
  select case
    when o.cita_fecha is not null and o.estado_cita = 'Finalizado' then 'Finalizado'
    when o.cita_fecha is not null then 'D'
    when o.auth_numero is not null or o.auth_fecha_inicio is not null then 'C'
    when o.solicitud_numero is not null or o.solicitud_fecha is not null then 'B'
    else 'A'
  end;
$$;

-- Vista con la etapa ya calculada. security_invoker respeta la RLS
-- del usuario que consulta, no la del dueño de la vista.
create view public.medical_orders_with_stage
with (security_invoker = true) as
select o.*, public.order_stage(o) as stage
from public.medical_orders o;

-- ───────────────────────────────────────────
-- 7. MEDICATIONS  (con versionado)
-- ───────────────────────────────────────────
create table public.medications (
  id                     uuid primary key default gen_random_uuid(),
  household_id           uuid not null references public.households(id) on delete cascade,
  patient_id             uuid not null references public.patients(id) on delete cascade,
  nombre                 text not null,
  dosis                  text,
  unidad                 text,
  frecuencia             text,
  horarios               text[] not null default '{}',
  via                    text,
  fecha_inicio           date,
  fecha_fin              date,
  observaciones          text,
  activo                 boolean not null default true,
  version                integer not null default 1,
  medicamento_padre_id   uuid references public.medications(id) on delete set null,
  motivo_cambio          text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index idx_meds_household on public.medications(household_id);
create index idx_meds_patient on public.medications(patient_id);
create index idx_meds_padre on public.medications(medicamento_padre_id);

create trigger trg_meds_updated_at
  before update on public.medications
  for each row execute function public.set_updated_at();

-- ───────────────────────────────────────────
-- 8. VITAL_SIGNS
-- ───────────────────────────────────────────
create table public.vital_signs (
  id                  uuid primary key default gen_random_uuid(),
  household_id        uuid not null references public.households(id) on delete cascade,
  patient_id          uuid not null references public.patients(id) on delete cascade,
  fecha               date not null,
  edad                integer,
  peso                numeric(5,1),
  altura              numeric(5,1),
  per_cintura         numeric(5,1),
  per_cadera          numeric(5,1),
  per_brazo           numeric(5,1),
  presion_sistolica   integer,
  presion_diastolica  integer,
  temperatura         numeric(4,1),
  saturacion          integer,
  glucosa             integer,
  frecuencia_cardiaca integer,
  notas               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index idx_vitals_household on public.vital_signs(household_id);
create index idx_vitals_patient_fecha on public.vital_signs(patient_id, fecha);

create trigger trg_vitals_updated_at
  before update on public.vital_signs
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════

alter table public.households         enable row level security;
alter table public.household_members  enable row level security;
alter table public.patients           enable row level security;
alter table public.medical_centers    enable row level security;
alter table public.doctors            enable row level security;
alter table public.medical_orders     enable row level security;
alter table public.medications        enable row level security;
alter table public.vital_signs        enable row level security;

-- households: ver/editar solo si soy miembro; cualquiera autenticado puede crear uno
create policy households_select on public.households
  for select using (public.is_household_member(id));

create policy households_insert on public.households
  for insert with check (auth.uid() = created_by);

create policy households_update on public.households
  for update using (public.is_household_member(id));

-- household_members: ver miembros de mis households; solo el propio owner gestiona altas/bajas
create policy household_members_select on public.household_members
  for select using (public.is_household_member(household_id));

create policy household_members_insert on public.household_members
  for insert with check (
    exists (
      select 1 from public.household_members hm
      where hm.household_id = household_members.household_id
        and hm.user_id = auth.uid()
        and hm.role = 'owner'
    )
  );

create policy household_members_delete on public.household_members
  for delete using (
    exists (
      select 1 from public.household_members hm
      where hm.household_id = household_members.household_id
        and hm.user_id = auth.uid()
        and hm.role = 'owner'
    )
  );

-- Tablas de dominio: CRUD completo para cualquier miembro del household
create policy patients_all on public.patients
  for all using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

create policy centers_all on public.medical_centers
  for all using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

create policy doctors_all on public.doctors
  for all using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

create policy orders_all on public.medical_orders
  for all using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

create policy meds_all on public.medications
  for all using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

create policy vitals_all on public.vital_signs
  for all using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
