-- ═══════════════════════════════════════════════════════════
-- Pieza A de arquitectura — Directorio público auditado de
-- médicos y centros médicos
--
-- Diseño (cerrado con el usuario el 2026-07-17):
--  · Los directorios privados (doctors / medical_centers) NO cambian de
--    modelo: siguen aislados por household. El directorio público vive en
--    tablas nuevas separadas (public_doctors / public_centers), visibles
--    para cualquier usuario autenticado — nunca para anon.
--  · Rol de administradora: tabla app_admins (hoy: la cuenta de alnp).
--    Solo la admin publica, edita, rechaza o elimina entradas públicas.
--  · Flujo de auditoría: cualquier usuaria "propone" una entrada desde su
--    directorio privado; queda en estado 'pendiente', visible solo para
--    ella y la admin. La admin la aprueba ('publicado'), la corrige antes
--    de aprobar, o la rechaza ('rechazado', con nota opcional). La admin
--    también puede crear entradas directamente ya publicadas.
--  · Usar una entrada pública = COPIARLA al directorio privado propio
--    (fila nueva, editable libremente, sin afectar el original). La copia
--    guarda su procedencia en doctors/medical_centers.public_source_id
--    (decisión del usuario: con referencia de origen).
--  · Las tablas públicas son globales: sin household_id, sin FK hacia
--    datos privados (ver comentario de origen_privado_id abajo).
--
-- Seguridad (mismo criterio que la auditoría 0007):
--  · RLS en todo; anon sin ningún acceso.
--  · El chequeo de admin vive en private.is_app_admin() (schema private,
--    no expuesto por PostgREST), SECURITY DEFINER estable, igual que
--    private.is_household_member().
--  · app_admins solo se administra por SQL (sin políticas de escritura y
--    con grants de escritura revocados): agregar/quitar admins es una
--    decisión de operación, no una función de la app.
-- ═══════════════════════════════════════════════════════════

-- ───────────────────────────────────────────
-- 1. Rol de administradora del directorio
-- ───────────────────────────────────────────
create table public.app_admins (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

comment on table public.app_admins is
  'Cuentas con rol de administradora del directorio público (pieza A). '
  'Se administra únicamente por SQL: el cliente solo puede leer su propia '
  'fila (para saber si le toca mostrar la interfaz de revisión).';

alter table public.app_admins enable row level security;

-- Cada cuenta puede ver SOLO su propia fila (¿soy admin?). Nadie ve la
-- lista completa de admins desde el cliente.
create policy app_admins_select_self on public.app_admins
  for select using (user_id = (select auth.uid()));

-- Sin políticas de INSERT/UPDATE/DELETE + grants revocados (defensa en
-- profundidad, mismo criterio que 0007).
revoke insert, update, delete on public.app_admins from authenticated;
revoke all on public.app_admins from anon;

-- Chequeo de admin para políticas RLS. SECURITY DEFINER para no depender
-- de la política de app_admins al evaluarse dentro de otras políticas
-- (solo necesita responder sobre el propio caller: auth.uid()).
create or replace function private.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.app_admins where user_id = auth.uid()
  );
$$;

comment on function private.is_app_admin() is
  'true si el usuario autenticado actual es administradora del directorio '
  'público. Vive en private (no expuesta por PostgREST); solo la usan las '
  'políticas RLS de public_doctors / public_centers.';

revoke execute on function private.is_app_admin() from public, anon;
grant execute on function private.is_app_admin() to authenticated;

-- ───────────────────────────────────────────
-- 2. Directorio público: médicos
-- ───────────────────────────────────────────
-- Espejo de los campos "compartibles" de doctors. El centro médico va como
-- TEXTO (no FK): una tarjeta del directorio es autocontenida; publicar un
-- médico no obliga a publicar también su centro.
create table public.public_doctors (
  id                   uuid primary key default gen_random_uuid(),
  nombre               text not null,
  especialidad         text,
  tarjeta_profesional  text,
  centro               text,
  consultorio          text,
  telefono             text,
  notas                text,
  estado               text not null default 'pendiente'
                         check (estado in ('pendiente', 'publicado', 'rechazado')),
  -- Metadatos de auditoría del flujo proponer → revisar.
  propuesto_por        uuid default auth.uid() references auth.users(id) on delete set null,
  origen_privado_id    uuid,
  nota_revision        text,
  revisado_por         uuid references auth.users(id) on delete set null,
  revisado_en          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on column public.public_doctors.origen_privado_id is
  'Id de la fila privada (doctors) desde la que se propuso esta entrada. '
  'DELIBERADAMENTE sin FK: (1) el directorio público no debe acoplarse al '
  'ciclo de vida de datos privados de ningún household, y (2) una FK '
  'validaría el uuid contra las filas de TODAS las familias (las FKs no '
  'pasan por RLS), lo que serviría de oráculo de existencia de ids '
  'ajenos. Solo lo usa la proponente para no proponer dos veces el mismo '
  'registro; un valor colgado es inofensivo.';

create index idx_public_doctors_estado     on public.public_doctors (estado);
create index idx_public_doctors_proponente on public.public_doctors (propuesto_por);

create trigger trg_public_doctors_updated_at
  before update on public.public_doctors
  for each row execute function public.set_updated_at();

-- ───────────────────────────────────────────
-- 3. Directorio público: centros médicos
-- ───────────────────────────────────────────
create table public.public_centers (
  id                 uuid primary key default gen_random_uuid(),
  nombre             text not null,
  tel1               text,
  tel2               text,
  direccion          text,
  email              text,
  web                text,
  estado             text not null default 'pendiente'
                       check (estado in ('pendiente', 'publicado', 'rechazado')),
  propuesto_por      uuid default auth.uid() references auth.users(id) on delete set null,
  origen_privado_id  uuid,
  nota_revision      text,
  revisado_por       uuid references auth.users(id) on delete set null,
  revisado_en        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on column public.public_centers.origen_privado_id is
  'Ver el comentario de public_doctors.origen_privado_id (mismo criterio: '
  'sin FK, a propósito).';

create index idx_public_centers_estado     on public.public_centers (estado);
create index idx_public_centers_proponente on public.public_centers (propuesto_por);

create trigger trg_public_centers_updated_at
  before update on public.public_centers
  for each row execute function public.set_updated_at();

-- ───────────────────────────────────────────
-- 4. Auditoría automática de la revisión
-- ───────────────────────────────────────────
-- Cada vez que cambia `estado` (aprobar/rechazar/volver a pendiente), se
-- registra quién y cuándo, en el servidor — la UI no puede olvidarlo ni
-- falsificarlo hacia otra cuenta.
create or replace function public.set_directory_review_meta()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.estado is distinct from old.estado then
    new.revisado_por := auth.uid();
    new.revisado_en  := now();
  end if;
  return new;
end;
$$;

revoke execute on function public.set_directory_review_meta() from public, anon, authenticated;

create trigger trg_public_doctors_review_meta
  before update on public.public_doctors
  for each row execute function public.set_directory_review_meta();

create trigger trg_public_centers_review_meta
  before update on public.public_centers
  for each row execute function public.set_directory_review_meta();

-- ───────────────────────────────────────────
-- 5. RLS del directorio público (idéntica en ambas tablas)
-- ───────────────────────────────────────────
alter table public.public_doctors enable row level security;
alter table public.public_centers enable row level security;

-- Ver: lo publicado (cualquier autenticado), lo propio (la proponente
-- sigue el estado de sus propuestas, incluida la nota de rechazo), y todo
-- (la admin, que necesita revisar pendientes).
create policy public_doctors_select on public.public_doctors
  for select using (
    estado = 'publicado'
    or propuesto_por = (select auth.uid())
    or private.is_app_admin()
  );

create policy public_centers_select on public.public_centers
  for select using (
    estado = 'publicado'
    or propuesto_por = (select auth.uid())
    or private.is_app_admin()
  );

-- Proponer: cualquier autenticado inserta SOLO a su nombre y SOLO en
-- estado pendiente. La admin además puede insertar ya publicado (alta
-- directa, sin pasar por revisión).
create policy public_doctors_insert on public.public_doctors
  for insert with check (
    propuesto_por = (select auth.uid())
    and (estado = 'pendiente' or private.is_app_admin())
  );

create policy public_centers_insert on public.public_centers
  for insert with check (
    propuesto_por = (select auth.uid())
    and (estado = 'pendiente' or private.is_app_admin())
  );

-- Editar (incluye aprobar/rechazar = cambiar estado): solo la admin.
-- La proponente NO edita su propuesta pendiente: la retira y la vuelve a
-- proponer (mantiene una sola vía de escritura y evita ediciones después
-- de que la admin ya la miró).
create policy public_doctors_update on public.public_doctors
  for update using (private.is_app_admin())
  with check (private.is_app_admin());

create policy public_centers_update on public.public_centers
  for update using (private.is_app_admin())
  with check (private.is_app_admin());

-- Eliminar: la admin siempre; la proponente solo sus propias filas y solo
-- mientras NO estén publicadas: retirar una propuesta pendiente antes de
-- la revisión, o descartar una rechazada (p. ej. para corregirla y
-- volverla a proponer). Lo publicado solo lo toca la admin.
create policy public_doctors_delete on public.public_doctors
  for delete using (
    private.is_app_admin()
    or (propuesto_por = (select auth.uid()) and estado in ('pendiente', 'rechazado'))
  );

create policy public_centers_delete on public.public_centers
  for delete using (
    private.is_app_admin()
    or (propuesto_por = (select auth.uid()) and estado in ('pendiente', 'rechazado'))
  );

-- anon: nada (0007 revocó anon de las tablas existentes; estas son nuevas
-- y los default privileges lo vuelven a otorgar, así que se revoca acá).
revoke all on public.public_doctors from anon;
revoke all on public.public_centers from anon;

-- ───────────────────────────────────────────
-- 6. Procedencia de las copias (público → privado)
-- ───────────────────────────────────────────
-- "Usar" una entrada del directorio la copia al directorio privado; la
-- copia recuerda de dónde vino. FK real (la tabla pública es global, acá
-- no hay oráculo posible) con on delete set null: si la admin elimina la
-- entrada pública, las copias privadas quedan intactas, solo sueltan la
-- referencia.
alter table public.doctors
  add column public_source_id uuid references public.public_doctors(id) on delete set null;

alter table public.medical_centers
  add column public_source_id uuid references public.public_centers(id) on delete set null;

comment on column public.doctors.public_source_id is
  'Entrada del directorio público desde la que se copió este médico '
  '(pieza A). Null si se creó a mano. La copia es independiente: editarla '
  'no toca el directorio público.';

comment on column public.medical_centers.public_source_id is
  'Ver doctors.public_source_id (mismo criterio).';

-- Índices parciales para el on delete set null y para "¿ya lo copié?"
-- (solo indexan las filas que efectivamente vienen del directorio).
create index idx_doctors_public_source on public.doctors (public_source_id)
  where public_source_id is not null;
create index idx_centers_public_source on public.medical_centers (public_source_id)
  where public_source_id is not null;

-- ───────────────────────────────────────────
-- 7. Alta de la administradora actual
-- ───────────────────────────────────────────
-- Decisión del usuario (2026-07-17): la admin del directorio es la cuenta
-- de alnp. Si el correo no existiera (p. ej. al reaplicar en otro
-- entorno), simplemente no inserta nada — se agrega luego por SQL.
insert into public.app_admins (user_id)
select id from auth.users where email = 'alnp.alnp@gmail.com'
on conflict (user_id) do nothing;
