-- 0035 — La consulta pasa a ser una entidad
--
-- ── Por qué ────────────────────────────────────────────────────────────────
--
-- Una consulta médica termina, con frecuencia, en varias órdenes. Hasta ahora
-- la aplicación no tenía forma de decirlo: cada fila de `medical_orders` era
-- el flujo entero de UNA orden, y el médico, la fecha y la historia clínica
-- —que son de la CONSULTA, no de la orden— vivían dentro de cada fila.
--
-- Consecuencias, todas verificadas sobre los datos reales que había antes de
-- esta migración:
--
--   * Las tres órdenes del 2026-07-27 (Clínica de Heridas, Neumología
--     Pediátrica, Cirugía Pediátrica) eran del mismo médico y del mismo día, y
--     guardaban el MISMO PDF de historia clínica tres veces: tres objetos de
--     2437.1 KB, idéntico nombre de archivo, en tres carpetas distintas de
--     Storage.
--   * Registrar la segunda orden de una consulta obligaba a volver a elegir el
--     médico, volver a escribir la fecha y volver a fotografiar la misma hoja.
--   * La pestaña "Flujo" ya agrupaba por fecha + médico (`flowGroupKey`), pero
--     de forma CALCULADA: el agrupamiento correcto existía en la pantalla y no
--     en la base, así que no se podía editar, ni consultar, ni apoyarse en él.
--
-- Lo que NO era el problema, y conviene dejar escrito porque la duda vuelve:
-- el seguimiento por orden ya estaba bien. Cada orden tiene su propia
-- solicitud, su propia autorización y su propia cita, y las conserva. Agrupar
-- la consulta NO une los seguimientos. (`order_authorizations`, por su parte,
-- nunca fue "la autorización de la orden": es la tabla mes a mes que solo usa
-- el tipo "Medicamentos/Insumos/Terapias" — ver 0015.)
--
-- ── Momento elegido ────────────────────────────────────────────────────────
--
-- Esta migración mueve `orden_archivo` (la historia clínica) de una tabla a
-- otra. Esa operación es la de más riesgo del proyecto: hecha sobre datos
-- existentes exige una ventana de lectura doble durante el despliegue, porque
-- unos navegadores tendrían el JavaScript viejo y otros el nuevo.
--
-- Se hace AHORA, y sin esa ventana, porque `medical_orders` quedó vacía a
-- pedido del usuario (2026-08-11, se borraron las 6 órdenes que había). Sin
-- filas no hay nada que migrar y el riesgo desaparece. Por eso `visit_id`
-- puede declararse `not null` de una: si esta migración se intentara sobre una
-- tabla con datos, fallaría acá — a propósito.
--
-- ── Orden de despliegue ────────────────────────────────────────────────────
--
-- Aplicar ESTA MIGRACIÓN PRIMERO y después empujar el código. La vista
-- `medical_orders_with_stage` sigue exponiendo `medico_id`, `fecha_orden` y
-- `orden_archivo` (ahora leídos de la consulta), así que el JavaScript viejo
-- sigue LEYENDO bien durante los minutos que tarde Vercel. Lo único que queda
-- roto en esa ventana es crear o editar una orden.
--
-- ── Nota sobre la vista ────────────────────────────────────────────────────
--
-- Se borra y se recrea, no `create or replace`: cambian columnas del medio y
-- eso no lo admite. `security_invoker = true` NO es opcional — sin él la vista
-- corre con los permisos de quien la creó y se salta la RLS, que es lo único
-- que separa a una familia de otra. Ahora aplica a las DOS tablas del join.

-- ═══════════════════════════════════════════════════════════
-- 1. La consulta
-- ═══════════════════════════════════════════════════════════

create table public.medical_visits (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  patient_id uuid not null,
  medico_id uuid,
  fecha date not null,
  -- Historia clínica de la consulta. Es el antiguo `medical_orders.orden_archivo`,
  -- con el nombre que siempre debió tener: aquel se llamó "orden_archivo" cuando
  -- era el único adjunto de la etapa A, y arrastró esa confusión hasta hoy.
  hc_archivo jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Mismo patrón compuesto que el resto del esquema (ver 0007): la FK incluye
  -- household_id para que no se pueda apuntar a un paciente o a un médico de
  -- otra familia ni siquiera con una consulta manipulada.
  constraint medical_visits_patient_fkey
    foreign key (patient_id, household_id) references public.patients (id, household_id) on delete cascade,
  constraint medical_visits_medico_fkey
    foreign key (medico_id, household_id) references public.doctors (id, household_id) on delete set null (medico_id),

  -- Necesarias para la FK compuesta de medical_orders, abajo.
  constraint medical_visits_id_household_key unique (id, household_id),
  constraint medical_visits_id_household_patient_key unique (id, household_id, patient_id)
);

create index idx_medical_visits_patient on public.medical_visits (patient_id, fecha desc);
create index idx_medical_visits_household on public.medical_visits (household_id, fecha desc);

comment on table public.medical_visits is
  'Una consulta médica: fecha, médico tratante e historia clínica. Agrupa las órdenes que salieron de ella (medical_orders.visit_id). No agrupa su SEGUIMIENTO: cada orden conserva su propia solicitud, autorización y cita.';
comment on column public.medical_visits.hc_archivo is
  'Historia clínica de la consulta. Antes vivía por orden, en medical_orders.orden_archivo, y se duplicaba una vez por orden (ver el encabezado de 0035).';

create trigger trg_visits_updated_at
  before update on public.medical_visits
  for each row execute function set_updated_at();

alter table public.medical_visits enable row level security;

create policy medical_visits_select on public.medical_visits
  for select using (private.is_household_member(household_id));
create policy medical_visits_insert on public.medical_visits
  for insert with check (private.is_household_member(household_id));
create policy medical_visits_update on public.medical_visits
  for update using (private.is_household_member(household_id)) with check (private.is_household_member(household_id));
create policy medical_visits_delete on public.medical_visits
  for delete using (private.is_household_member(household_id));

revoke all on public.medical_visits from anon;

-- ═══════════════════════════════════════════════════════════
-- 2. La orden cuelga de su consulta
-- ═══════════════════════════════════════════════════════════

-- `not null` de una: la tabla está vacía. Si tuviera filas, esto fallaría, que
-- es exactamente lo que debe pasar (ver "Momento elegido", arriba).
alter table public.medical_orders add column visit_id uuid not null;

-- La FK lleva household_id Y patient_id: garantiza que una orden nunca pueda
-- pertenecer a una consulta de otra familia ni de otro paciente. Sin patient_id
-- se podría colgar la orden de un paciente de la consulta de su hermano.
alter table public.medical_orders
  add constraint medical_orders_visit_fkey
  foreign key (visit_id, household_id, patient_id)
  references public.medical_visits (id, household_id, patient_id)
  on delete cascade;

create index idx_medical_orders_visit on public.medical_orders (visit_id);

comment on column public.medical_orders.visit_id is
  'Consulta de la que salió esta orden. El médico, la fecha y la historia clínica viven allá; la vista medical_orders_with_stage los vuelve a exponer para leer.';

-- ═══════════════════════════════════════════════════════════
-- 3. Se van los campos que eran de la consulta
-- ═══════════════════════════════════════════════════════════

-- La vista depende de las tres columnas, así que se borra antes.
drop view public.medical_orders_with_stage;

alter table public.medical_orders
  drop column medico_id,
  drop column fecha_orden,
  drop column orden_archivo;

-- ═══════════════════════════════════════════════════════════
-- 4. La vista, recreada sobre el join
-- ═══════════════════════════════════════════════════════════
--
-- `medico_id`, `fecha_orden` y `orden_archivo` siguen saliendo con los mismos
-- nombres, ahora traídos de la consulta. No es nostalgia: es lo que permite
-- que el panel, la pestaña Archivo, los filtros y los recordatorios sigan
-- funcionando sin tocarlos, y lo que deja leer bien al JavaScript viejo
-- mientras Vercel despliega.
--
-- ⚠️ Por la vista son de SOLO LECTURA. Escribirlos va a medical_visits.
--
-- El join es interno, no `left`: una orden sin consulta no puede existir
-- (visit_id es not null con FK). Si alguna vez desapareciera de esta lista,
-- sería un síntoma de corrupción, no algo que convenga esconder con un left.

create view public.medical_orders_with_stage
with (security_invoker = true) as
select
  o.id,
  o.household_id,
  o.patient_id,
  o.visit_id,
  v.medico_id,                      -- de la consulta
  v.fecha        as fecha_orden,    -- de la consulta
  v.hc_archivo   as orden_archivo,  -- de la consulta (historia clínica)
  o.tipo_orden,
  o.descripcion,
  o.orden_documento,                -- la orden médica en sí (ver 0033)
  o.solicitud_fecha,
  o.solicitud_hora,
  o.solicitud_numero,
  o.solicitud_imagen,
  o.auth_fecha_inicio,
  o.auth_fecha_vence,
  o.auth_numero,
  o.auth_centro_id,
  o.auth_imagen,
  o.auth_meses,
  o.cita_fecha,
  o.cita_hora,
  o.medico_id_cita,
  o.cita_consultorio,
  o.cita_direccion,
  o.cita_indicaciones,
  o.estado_cita,
  o.created_at,
  o.updated_at,
  public.order_stage(o.*) as stage
from public.medical_orders o
join public.medical_visits v on v.id = o.visit_id;

comment on view public.medical_orders_with_stage is
  'Órdenes con su etapa calculada. medico_id, fecha_orden y orden_archivo vienen de la consulta (medical_visits) y son de solo lectura acá: para cambiarlos hay que escribir en medical_visits.';

-- ═══════════════════════════════════════════════════════════
-- 5. Las consultas con su resumen
-- ═══════════════════════════════════════════════════════════
--
-- La razón de existir de la consulta es poder abrir una y ver de un vistazo
-- cómo va todo el paquete. Ese recuento se hace acá y no en el navegador para
-- no traerse todas las órdenes de la familia solo para contarlas.

create view public.medical_visits_with_summary
with (security_invoker = true) as
select
  v.*,
  count(o.id)                                                       as ordenes_total,
  count(o.id) filter (where public.order_stage(o.*) = 'Finalizado')  as ordenes_finalizadas,
  count(o.id) filter (where public.order_stage(o.*) <> 'Finalizado') as ordenes_pendientes
from public.medical_visits v
left join public.medical_orders o on o.visit_id = v.id
group by v.id;

comment on view public.medical_visits_with_summary is
  'Consultas con el recuento de sus órdenes por estado. El left join es a propósito: una consulta recién creada, todavía sin órdenes, tiene que seguir apareciendo.';
