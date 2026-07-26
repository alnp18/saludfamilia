import { supabase } from './supabaseClient.js';

/**
 * Capa de acceso a datos. Aísla dos cosas del resto de la app:
 *  1) el mapeo snake_case (Postgres) ↔ camelCase (JS), y
 *  2) el scoping por household_id (multi-tenant vía RLS).
 * El resto de los módulos nunca arma queries de Supabase directamente.
 */

// ─────────────────────────────────────────
// PATIENTS
// ─────────────────────────────────────────
// rowToPatient/patientToRow y sus respaldos de formato legado se exportan
// solo para poder probarlos de forma aislada (son funciones puras, sin I/O);
// el resto de la app los sigue usando a través de las funciones de arriba.
export function rowToPatient(r) {
  return {
    id: r.id,
    primerNombre: r.primer_nombre,
    segundoNombre: r.segundo_nombre,
    primerApellido: r.primer_apellido,
    segundoApellido: r.segundo_apellido,
    // Nombre completo ensamblado — se mantiene por compatibilidad para todo
    // lugar que solo necesita MOSTRAR el nombre (avatar, listados, header,
    // dashboard, etc.): no hay que tocar esos módulos, ya que arman el
    // nombre desde acá, en un único lugar (ver P1.5 — Ficha de Paciente).
    nombre: [r.primer_nombre, r.segundo_nombre, r.primer_apellido, r.segundo_apellido]
      .filter(Boolean).join(' '),
    fechaNacimiento: r.fecha_nacimiento,
    sexo: r.sexo,
    tipoSangre: r.tipo_sangre,
    eps: r.eps,
    numeroAfiliado: r.numero_afiliado,
    direccion: r.direccion,
    // Patrón Departamento/Municipio (DANE) — auditoría móvil 2026-07-25.
    departamento: r.departamento,
    municipio: r.municipio,
    // Antes texto libre; ahora una estructura (nombre, parentesco, teléfonos,
    // dirección, ciudad) — ver P1.5. Puede venir null si nunca se llenó.
    contactoEmergencia: r.contacto_emergencia,
    notas: r.notas,
    // Foto del paciente (MI AUDITORIA #1) — mismo formato que patient_policies.imagen
    // ({name,type,size,path} en Storage), pero se muestra tal cual: nunca se
    // convierte a PDF. Se recorta/encuadra al subirla (src/lib/imageCropper.js).
    foto: r.foto,
    // Columna legada: ya no se lee/escribe desde la UI (ver P1.5 — el modo
    // claro/oscuro es ahora un único control general en el header, nunca una
    // preferencia por paciente). Se mantiene el mapeo por compatibilidad con
    // la columna existente en la base de datos.
    _lightMode: r.light_mode,
    creadoEn: r.created_at,
  };
}
/**
 * Split heurístico del "nombre" de texto libre (formato viejo, anterior a
 * P1.5) en las 4 columnas actuales — mismo criterio que la migración SQL
 * 0009. Solo se usa como respaldo al importar un .sfam exportado antes de
 * este cambio, para no perder el nombre en vez de guardarlo vacío.
 */
export function splitNombreLegado(nombre) {
  const w = (nombre || '').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return { primerNombre: '', segundoNombre: '', primerApellido: '', segundoApellido: '' };
  if (w.length === 1) return { primerNombre: w[0], segundoNombre: '', primerApellido: '', segundoApellido: '' };
  if (w.length === 2) return { primerNombre: w[0], segundoNombre: '', primerApellido: w[1], segundoApellido: '' };
  if (w.length === 3) return { primerNombre: w[0], segundoNombre: '', primerApellido: w[1], segundoApellido: w[2] };
  return { primerNombre: w[0], segundoNombre: w[1], primerApellido: w[2], segundoApellido: w.slice(3).join(' ') };
}

/** Mismo respaldo que splitNombreLegado, para el contacto de emergencia
 * cuando llega como texto libre "Nombre · relación · teléfono" (formato
 * viejo, anterior a P1.5) en vez de la estructura actual. */
export function splitContactoLegado(str) {
  const seg = (str || '').split('·').map(s => s.trim());
  return {
    primerNombre: seg[0] || '', segundoNombre: '', primerApellido: '', segundoApellido: '',
    parentesco: '', telefono1: seg[2] || '', telefono2: '', direccion: '', ciudad: '',
    departamento: '', municipio: '',
  };
}

export function patientToRow(p, householdId) {
  const legacyNombre = (!p.primerNombre && !p.primerApellido && p.nombre) ? splitNombreLegado(p.nombre) : null;
  const contactoEmergencia = typeof p.contactoEmergencia === 'string'
    ? splitContactoLegado(p.contactoEmergencia)
    : (p.contactoEmergencia || null);
  return {
    household_id: householdId,
    primer_nombre: (p.primerNombre || legacyNombre?.primerNombre || '').trim(),
    segundo_nombre: (p.segundoNombre || legacyNombre?.segundoNombre || '').trim() || null,
    primer_apellido: (p.primerApellido || legacyNombre?.primerApellido || '').trim(),
    segundo_apellido: (p.segundoApellido || legacyNombre?.segundoApellido || '').trim() || null,
    fecha_nacimiento: p.fechaNacimiento || null,
    sexo: p.sexo || null,
    tipo_sangre: p.tipoSangre || null,
    eps: p.eps || null,
    numero_afiliado: p.numeroAfiliado || null,
    direccion: p.direccion || null,
    departamento: p.departamento || null,
    municipio: p.municipio || null,
    contacto_emergencia: contactoEmergencia,
    notas: p.notas || null,
    foto: p.foto || null,
    light_mode: false, // deprecado (ver P1.5); columna conservada por compatibilidad
  };
}

export async function listPatients(householdId) {
  const { data, error } = await supabase.from('patients').select('*')
    .eq('household_id', householdId).order('primer_nombre').order('primer_apellido');
  if (error) throw error;
  return data.map(rowToPatient);
}

export async function getPatient(id) {
  const { data, error } = await supabase.from('patients').select('*').eq('id', id).single();
  if (error) throw error;
  return rowToPatient(data);
}

export async function savePatient(patient, householdId) {
  const row = patientToRow(patient, householdId);
  if (patient.id) {
    const { data, error } = await supabase.from('patients').update(row).eq('id', patient.id).select().single();
    if (error) throw error;
    return rowToPatient(data);
  }
  const { data, error } = await supabase.from('patients').insert(row).select().single();
  if (error) throw error;
  return rowToPatient(data);
}

export async function deletePatient(id) {
  const { error } = await supabase.from('patients').delete().eq('id', id);
  if (error) throw error;
}

// ─────────────────────────────────────────
// PATIENT POLICIES (pólizas de seguro adicionales — ficha de paciente)
// ─────────────────────────────────────────
function rowToPolicy(r) {
  return {
    id: r.id,
    patientId: r.patient_id,
    tipo: r.tipo,
    numeroPoliza: r.numero_poliza,
    aseguradora: r.aseguradora,
    imagen: r.imagen,
    creadoEn: r.created_at,
  };
}

export async function listPatientPolicies(patientId) {
  const { data, error } = await supabase.from('patient_policies').select('*')
    .eq('patient_id', patientId).order('created_at');
  if (error) throw error;
  return data.map(rowToPolicy);
}

export async function savePatientPolicy(policy, householdId, patientId) {
  const row = {
    household_id: householdId,
    patient_id: patientId,
    tipo: policy.tipo,
    numero_poliza: policy.numeroPoliza || null,
    aseguradora: policy.aseguradora || null,
    imagen: policy.imagen || null,
  };
  if (policy.id) {
    const { data, error } = await supabase.from('patient_policies').update(row).eq('id', policy.id).select().single();
    if (error) throw error;
    return rowToPolicy(data);
  }
  const { data, error } = await supabase.from('patient_policies').insert(row).select().single();
  if (error) throw error;
  return rowToPolicy(data);
}

export async function deletePatientPolicy(id) {
  const { error } = await supabase.from('patient_policies').delete().eq('id', id);
  if (error) throw error;
}

// ─────────────────────────────────────────
// PATIENT DIAGNOSES (condiciones crónicas — MI AUDITORIA #5)
// Solo carga manual del código CIE10 por ahora (ver migración 0014).
// Editable desde la auditoría 2026-07-17 (ver migración 0016 — RLS update).
// ─────────────────────────────────────────
function rowToDiagnosis(r) {
  return {
    id: r.id,
    patientId: r.patient_id,
    codigoCie10: r.codigo_cie10,
    descripcion: r.descripcion,
    creadoEn: r.created_at,
  };
}

export async function listPatientDiagnoses(patientId) {
  const { data, error } = await supabase.from('patient_diagnoses').select('*')
    .eq('patient_id', patientId).order('created_at');
  if (error) throw error;
  return data.map(rowToDiagnosis);
}

export async function addPatientDiagnosis(diagnosis, householdId, patientId) {
  const row = {
    household_id: householdId,
    patient_id: patientId,
    codigo_cie10: diagnosis.codigoCie10,
    descripcion: diagnosis.descripcion || null,
  };
  const { data, error } = await supabase.from('patient_diagnoses').insert(row).select().single();
  if (error) throw error;
  return rowToDiagnosis(data);
}

// Editar un diagnóstico existente (auditoría 2026-07-17): antes solo se
// podía eliminar y volver a agregar. Requiere la migración 0016
// (patient_diagnoses_update), que agrega la política RLS de UPDATE que no
// existía porque el único flujo original era agregar/eliminar.
export async function updatePatientDiagnosis(id, diagnosis) {
  const row = {
    codigo_cie10: diagnosis.codigoCie10,
    descripcion: diagnosis.descripcion || null,
  };
  const { data, error } = await supabase.from('patient_diagnoses').update(row).eq('id', id).select().single();
  if (error) throw error;
  return rowToDiagnosis(data);
}

export async function deletePatientDiagnosis(id) {
  const { error } = await supabase.from('patient_diagnoses').delete().eq('id', id);
  if (error) throw error;
}

// ─────────────────────────────────────────
// CATÁLOGOS EXTENSIBLES ("Otra" → texto libre → se suma a las opciones)
// Genérico por household + categoría — reutilizable para pólizas
// (Pacientes), vía de administración (Medicamentos) y especialidad
// (Médicos), en vez de una tabla de catálogo por módulo.
// ─────────────────────────────────────────
export async function listCatalogOptions(householdId, categoria) {
  const { data, error } = await supabase.from('custom_catalog_options').select('*')
    .eq('household_id', householdId).eq('categoria', categoria).order('valor');
  if (error) throw error;
  return data.map(r => r.valor);
}

export async function addCatalogOption(householdId, categoria, valor) {
  const v = (valor || '').trim();
  if (!v) return null;
  const { data, error } = await supabase.from('custom_catalog_options')
    .upsert({ household_id: householdId, categoria, valor: v }, { onConflict: 'household_id,categoria,valor', ignoreDuplicates: true })
    .select().maybeSingle();
  if (error) throw error;
  return v;
}

// ─────────────────────────────────────────
// MEDICAL CENTERS
// ─────────────────────────────────────────
function rowToCenter(r) {
  return {
    id: r.id, nombre: r.nombre, tel1: r.tel1, tel2: r.tel2,
    dir: r.direccion, email: r.email, web: r.web,
    // Patrón Departamento/Municipio (DANE) — auditoría móvil 2026-07-25.
    departamento: r.departamento, municipio: r.municipio,
    publicSourceId: r.public_source_id,
  };
}
function centerToRow(c, householdId) {
  const row = {
    household_id: householdId,
    nombre: c.nombre, tel1: c.tel1 || null, tel2: c.tel2 || null,
    direccion: c.dir || null, email: c.email || null, web: c.web || null,
    departamento: c.departamento || null, municipio: c.municipio || null,
  };
  // Procedencia (pieza A): la columna solo se escribe si el llamador trae la
  // clave — así una edición normal desde el formulario (que no la conoce) no
  // pisa a null la referencia de una copia hecha desde el directorio público.
  if ('publicSourceId' in c) row.public_source_id = c.publicSourceId || null;
  return row;
}

export async function listCenters(householdId) {
  const { data, error } = await supabase.from('medical_centers').select('*')
    .eq('household_id', householdId).order('nombre');
  if (error) throw error;
  return data.map(rowToCenter);
}
export async function getCenter(id) {
  const { data, error } = await supabase.from('medical_centers').select('*').eq('id', id).single();
  if (error) throw error;
  return rowToCenter(data);
}
export async function saveCenter(center, householdId) {
  const row = centerToRow(center, householdId);
  if (center.id) {
    const { data, error } = await supabase.from('medical_centers').update(row).eq('id', center.id).select().single();
    if (error) throw error;
    return rowToCenter(data);
  }
  const { data, error } = await supabase.from('medical_centers').insert(row).select().single();
  if (error) throw error;
  return rowToCenter(data);
}
export async function deleteCenter(id) {
  const { error } = await supabase.from('medical_centers').delete().eq('id', id);
  if (error) throw error;
}

// ─────────────────────────────────────────
// DOCTORS
// ─────────────────────────────────────────
function rowToDoctor(r) {
  return {
    id: r.id, nombre: r.nombre, especialidad: r.especialidad,
    centroId: r.centro_id, consultorio: r.consultorio, tel: r.telefono, notas: r.notas,
    tarjetaProfesional: r.tarjeta_profesional,
    publicSourceId: r.public_source_id,
  };
}
function doctorToRow(d, householdId) {
  const row = {
    household_id: householdId,
    nombre: d.nombre, especialidad: d.especialidad || null,
    centro_id: d.centroId || null, consultorio: d.consultorio || null,
    telefono: d.tel || null, notas: d.notas || null,
    tarjeta_profesional: d.tarjetaProfesional || null,
  };
  // Procedencia (pieza A) — mismo criterio que centerToRow.
  if ('publicSourceId' in d) row.public_source_id = d.publicSourceId || null;
  return row;
}

export async function listDoctors(householdId) {
  const { data, error } = await supabase.from('doctors').select('*')
    .eq('household_id', householdId).order('nombre');
  if (error) throw error;
  return data.map(rowToDoctor);
}
export async function getDoctor(id) {
  const { data, error } = await supabase.from('doctors').select('*').eq('id', id).single();
  if (error) throw error;
  return rowToDoctor(data);
}
export async function saveDoctor(doctor, householdId) {
  const row = doctorToRow(doctor, householdId);
  if (doctor.id) {
    const { data, error } = await supabase.from('doctors').update(row).eq('id', doctor.id).select().single();
    if (error) throw error;
    return rowToDoctor(data);
  }
  const { data, error } = await supabase.from('doctors').insert(row).select().single();
  if (error) throw error;
  return rowToDoctor(data);
}
export async function deleteDoctor(id) {
  const { error } = await supabase.from('doctors').delete().eq('id', id);
  if (error) throw error;
}

// ─────────────────────────────────────────
// DIRECTORIO PÚBLICO (pieza A)
// ─────────────────────────────────────────
// Tablas globales public_doctors / public_centers, compartidas entre todas
// las familias. La RLS (migración 0020) hace el trabajo pesado: cualquier
// autenticado ve lo publicado y sus propias propuestas; solo la admin
// (app_admins) ve pendientes ajenas, edita, aprueba, rechaza o elimina.
// Acá no se filtra "por si acaso" nada que la RLS ya garantice.

function rowToPublicDoctor(r) {
  return {
    id: r.id, nombre: r.nombre, especialidad: r.especialidad,
    tarjetaProfesional: r.tarjeta_profesional, centro: r.centro,
    consultorio: r.consultorio, tel: r.telefono, notas: r.notas,
    estado: r.estado, propuestoPor: r.propuesto_por,
    origenPrivadoId: r.origen_privado_id, notaRevision: r.nota_revision,
    creadoEn: r.created_at,
  };
}
function publicDoctorToRow(d) {
  return {
    nombre: d.nombre, especialidad: d.especialidad || null,
    tarjeta_profesional: d.tarjetaProfesional || null,
    centro: d.centro || null, consultorio: d.consultorio || null,
    telefono: d.tel || null, notas: d.notas || null,
  };
}
function rowToPublicCenter(r) {
  return {
    id: r.id, nombre: r.nombre, tel1: r.tel1, tel2: r.tel2,
    dir: r.direccion, email: r.email, web: r.web,
    estado: r.estado, propuestoPor: r.propuesto_por,
    origenPrivadoId: r.origen_privado_id, notaRevision: r.nota_revision,
    creadoEn: r.created_at,
  };
}
function publicCenterToRow(c) {
  return {
    nombre: c.nombre, tel1: c.tel1 || null, tel2: c.tel2 || null,
    direccion: c.dir || null, email: c.email || null, web: c.web || null,
  };
}

/** ¿La cuenta actual es administradora del directorio? La RLS de app_admins
 * solo deja ver la fila propia, así que basta con mirar si hay alguna. */
export async function isDirectoryAdmin() {
  const { data, error } = await supabase.from('app_admins').select('user_id').maybeSingle();
  if (error) throw error;
  return !!data;
}

export async function listPublicDoctors(estado) {
  const { data, error } = await supabase.from('public_doctors').select('*')
    .eq('estado', estado).order('nombre');
  if (error) throw error;
  return data.map(rowToPublicDoctor);
}

export async function listPublicCenters(estado) {
  const { data, error } = await supabase.from('public_centers').select('*')
    .eq('estado', estado).order('nombre');
  if (error) throw error;
  return data.map(rowToPublicCenter);
}

/** Propuestas de la cuenta actual (todas: pendientes, publicadas y
 * rechazadas con su nota), para la pestaña "Mis propuestas" y para saber
 * qué registros privados ya fueron propuestos. */
export async function listMyProposals(userId) {
  const [d, c] = await Promise.all([
    supabase.from('public_doctors').select('*').eq('propuesto_por', userId)
      .order('created_at', { ascending: false }),
    supabase.from('public_centers').select('*').eq('propuesto_por', userId)
      .order('created_at', { ascending: false }),
  ]);
  if (d.error) throw d.error;
  if (c.error) throw c.error;
  return { doctors: d.data.map(rowToPublicDoctor), centers: c.data.map(rowToPublicCenter) };
}

/** Proponer una entrada (queda 'pendiente' hasta que la admin la revise).
 * origenPrivadoId enlaza con la fila privada de la que salió, para no
 * ofrecer proponerla dos veces. */
export async function proposePublicDoctor(d, userId) {
  const { data, error } = await supabase.from('public_doctors')
    .insert({ ...publicDoctorToRow(d), propuesto_por: userId, origen_privado_id: d.origenPrivadoId || null })
    .select().single();
  if (error) throw error;
  return rowToPublicDoctor(data);
}

export async function proposePublicCenter(c, userId) {
  const { data, error } = await supabase.from('public_centers')
    .insert({ ...publicCenterToRow(c), propuesto_por: userId, origen_privado_id: c.origenPrivadoId || null })
    .select().single();
  if (error) throw error;
  return rowToPublicCenter(data);
}

/** Solo admin (la RLS lo garantiza): crear una entrada ya publicada (alta
 * directa) o editar los datos de una existente sin tocar su estado. */
export async function savePublicDoctor(d, userId) {
  if (d.id) {
    const { data, error } = await supabase.from('public_doctors')
      .update(publicDoctorToRow(d)).eq('id', d.id).select().single();
    if (error) throw error;
    return rowToPublicDoctor(data);
  }
  const { data, error } = await supabase.from('public_doctors')
    .insert({ ...publicDoctorToRow(d), estado: 'publicado', propuesto_por: userId })
    .select().single();
  if (error) throw error;
  return rowToPublicDoctor(data);
}

export async function savePublicCenter(c, userId) {
  if (c.id) {
    const { data, error } = await supabase.from('public_centers')
      .update(publicCenterToRow(c)).eq('id', c.id).select().single();
    if (error) throw error;
    return rowToPublicCenter(data);
  }
  const { data, error } = await supabase.from('public_centers')
    .insert({ ...publicCenterToRow(c), estado: 'publicado', propuesto_por: userId })
    .select().single();
  if (error) throw error;
  return rowToPublicCenter(data);
}

/** Solo admin: aprobar ('publicado') o rechazar ('rechazado', con nota
 * opcional que ve la proponente). Quién y cuándo revisó lo registra el
 * trigger del servidor, no el cliente. */
export async function setPublicDoctorEstado(id, estado, notaRevision) {
  const { error } = await supabase.from('public_doctors')
    .update({ estado, nota_revision: notaRevision || null }).eq('id', id);
  if (error) throw error;
}

export async function setPublicCenterEstado(id, estado, notaRevision) {
  const { error } = await supabase.from('public_centers')
    .update({ estado, nota_revision: notaRevision || null }).eq('id', id);
  if (error) throw error;
}

/** Admin: eliminar cualquiera. Proponente: retirar su pendiente o
 * descartar su rechazada (la RLS impide todo lo demás). */
export async function deletePublicDoctor(id) {
  const { error } = await supabase.from('public_doctors').delete().eq('id', id);
  if (error) throw error;
}

export async function deletePublicCenter(id) {
  const { error } = await supabase.from('public_centers').delete().eq('id', id);
  if (error) throw error;
}

// ─────────────────────────────────────────
// MEDICAL ORDERS (usa la vista con stage ya calculado)
// ─────────────────────────────────────────
function rowToOrder(r) {
  return {
    id: r.id,
    patientId: r.patient_id,
    medicoId: r.medico_id,
    fechaOrden: r.fecha_orden,
    tipoOrden: r.tipo_orden,
    descripcion: r.descripcion,
    orden_archivo: r.orden_archivo,
    solicitud_fecha: r.solicitud_fecha,
    solicitud_hora: r.solicitud_hora,
    solicitud_numero: r.solicitud_numero,
    solicitud_imagen: r.solicitud_imagen,
    auth_fechaInicio: r.auth_fecha_inicio,
    auth_fechaVence: r.auth_fecha_vence,
    auth_numero: r.auth_numero,
    auth_centroId: r.auth_centro_id,
    auth_imagen: r.auth_imagen,
    auth_meses: r.auth_meses,
    cita_fecha: r.cita_fecha,
    cita_hora: r.cita_hora,
    medicoId_cita: r.medico_id_cita,
    cita_consultorio: r.cita_consultorio,
    cita_direccion: r.cita_direccion,
    cita_indicaciones: r.cita_indicaciones,
    estadoCita: r.estado_cita,
    _stage: r.stage, // ya viene calculado desde medical_orders_with_stage
  };
}
function orderToRow(o, householdId, patientId) {
  return {
    household_id: householdId,
    patient_id: patientId,
    medico_id: o.medicoId || null,
    fecha_orden: o.fechaOrden || null,
    tipo_orden: o.tipoOrden || null,
    descripcion: o.descripcion || null,
    orden_archivo: o.orden_archivo || null,
    solicitud_fecha: o.solicitud_fecha || null,
    solicitud_hora: o.solicitud_hora || null,
    solicitud_numero: o.solicitud_numero || null,
    solicitud_imagen: o.solicitud_imagen || null,
    auth_fecha_inicio: o.auth_fechaInicio || null,
    auth_fecha_vence: o.auth_fechaVence || null,
    auth_numero: o.auth_numero || null,
    auth_centro_id: o.auth_centroId || null,
    auth_imagen: o.auth_imagen || null,
    auth_meses: o.auth_meses || null,
    cita_fecha: o.cita_fecha || null,
    cita_hora: o.cita_hora || null,
    medico_id_cita: o.medicoId_cita || null,
    cita_consultorio: o.cita_consultorio || null,
    cita_direccion: o.cita_direccion || null,
    cita_indicaciones: o.cita_indicaciones || null,
    estado_cita: o.estadoCita || null,
  };
}

export async function listOrdersByPatient(patientId) {
  const { data, error } = await supabase.from('medical_orders_with_stage').select('*')
    .eq('patient_id', patientId).order('fecha_orden', { ascending: false });
  if (error) throw error;
  return data.map(rowToOrder);
}
export async function getOrder(id) {
  const { data, error } = await supabase.from('medical_orders_with_stage').select('*').eq('id', id).single();
  if (error) throw error;
  return rowToOrder(data);
}
export async function saveOrder(order, householdId, patientId) {
  const row = orderToRow(order, householdId, patientId);
  if (order.id) {
    const { error } = await supabase.from('medical_orders').update(row).eq('id', order.id);
    if (error) throw error;
    return getOrder(order.id);
  }
  const { data, error } = await supabase.from('medical_orders').insert(row).select('id').single();
  if (error) throw error;
  return getOrder(data.id);
}
export async function deleteOrder(id) {
  const { error } = await supabase.from('medical_orders').delete().eq('id', id);
  if (error) throw error;
}

// ─────────────────────────────────────────
// ORDER AUTHORIZATIONS (tabla "Autorizaciones" — tipo de orden
// "Medicamentos/Insumos/Terapias", MI AUDITORIA Órdenes #4)
// Una fila por mes autorizado. El formulario regenera el set completo
// cada vez que cambia el número de meses, así que se guarda como
// "reemplazar todo" en vez de update fila por fila — más simple y evita
// tener que reconciliar altas/bajas de filas intermedias.
// ─────────────────────────────────────────
function rowToOrderAuth(r) {
  return {
    id: r.id,
    orderId: r.order_id,
    mesNumero: r.mes_numero,
    numeroAutorizacion: r.numero_autorizacion,
    fechaInicio: r.fecha_inicio,
    fechaVencimiento: r.fecha_vencimiento,
    cantidad: r.cantidad,
    entregado: r.entregado,
  };
}

export async function listOrderAuthorizations(orderId) {
  const { data, error } = await supabase.from('order_authorizations').select('*')
    .eq('order_id', orderId).order('mes_numero');
  if (error) throw error;
  return data.map(rowToOrderAuth);
}

/** Reemplaza todas las filas de autorizaciones de una orden por `rows`. */
export async function replaceOrderAuthorizations(orderId, householdId, rows) {
  const { error: delErr } = await supabase.from('order_authorizations').delete().eq('order_id', orderId);
  if (delErr) throw delErr;
  if (!rows.length) return [];
  const payload = rows.map(r => ({
    household_id: householdId,
    order_id: orderId,
    mes_numero: r.mesNumero,
    numero_autorizacion: r.numeroAutorizacion || null,
    fecha_inicio: r.fechaInicio || null,
    fecha_vencimiento: r.fechaVencimiento || null,
    cantidad: r.cantidad || null,
    entregado: !!r.entregado,
  }));
  const { data, error } = await supabase.from('order_authorizations').insert(payload).select();
  if (error) throw error;
  return data.map(rowToOrderAuth);
}

// ─────────────────────────────────────────
// MEDICATIONS (con versionado)
// ─────────────────────────────────────────
/** Compatibilidad: horarios viejos (import .sfam anterior a P1.5, o migración
 * 0010 sobre datos que no hayan pasado por ella) venían como texto plano
 * ("08:00"). Se normalizan a {hora, dosis} — dosis vacía, no existía antes. */
function normalizeHorarios(horarios) {
  return (horarios || []).map(h => typeof h === 'string' ? { hora: h, dosis: '' } : h);
}
function rowToMed(r) {
  return {
    id: r.id, patientId: r.patient_id, nombre: r.nombre, dosis: r.dosis,
    unidad: r.unidad, frecuencia: r.frecuencia, horarios: normalizeHorarios(r.horarios),
    via: r.via, fechaInicio: r.fecha_inicio, fechaFin: r.fecha_fin,
    observaciones: r.observaciones, activo: r.activo, version: r.version,
    medicamentoPadreId: r.medicamento_padre_id, motivoCambio: r.motivo_cambio,
    // Auditoría de medicamentos (2026-07-17): indicación (enfermedad/síntoma,
    // texto libre) y marca de medicamento controlado.
    indicacion: r.indicacion, controlado: !!r.controlado,
  };
}
function medToRow(m, householdId, patientId) {
  return {
    household_id: householdId,
    patient_id: patientId,
    nombre: m.nombre, dosis: m.dosis, unidad: m.unidad || null,
    frecuencia: m.frecuencia || null, horarios: m.horarios || [],
    via: m.via || null, fecha_inicio: m.fechaInicio || null, fecha_fin: m.fechaFin || null,
    observaciones: m.observaciones || null, activo: m.activo !== false,
    version: m.version || 1, medicamento_padre_id: m.medicamentoPadreId || null,
    motivo_cambio: m.motivoCambio || null,
    indicacion: m.indicacion || null, controlado: m.controlado === true,
  };
}

export async function listMedsByPatient(patientId) {
  const { data, error } = await supabase.from('medications').select('*')
    .eq('patient_id', patientId).order('created_at', { ascending: false });
  if (error) throw error;
  return data.map(rowToMed);
}
export async function getMed(id) {
  const { data, error } = await supabase.from('medications').select('*').eq('id', id).single();
  if (error) throw error;
  return rowToMed(data);
}
export async function insertMed(med, householdId, patientId) {
  const row = medToRow(med, householdId, patientId);
  const { data, error } = await supabase.from('medications').insert(row).select().single();
  if (error) throw error;
  return rowToMed(data);
}
export async function updateMed(id, patch, householdId, patientId) {
  const row = medToRow(patch, householdId, patientId);
  const { data, error } = await supabase.from('medications').update(row).eq('id', id).select().single();
  if (error) throw error;
  return rowToMed(data);
}
export async function deleteMed(id) {
  const { error } = await supabase.from('medications').delete().eq('id', id);
  if (error) throw error;
}

// ─────────────────────────────────────────
// MED USAGE EVENTS (usos de medicamentos "a demanda" — auditoría 2026-07-17)
// Append-only: se listan, se agregan y se pueden eliminar (para corregir un
// apunte), no se editan. Ver migración 0017.
// ─────────────────────────────────────────
function rowToMedUsage(r) {
  return {
    id: r.id, medicationId: r.medication_id, patientId: r.patient_id,
    usadoEn: r.usado_en, razon: r.razon,
  };
}

/** Todos los usos registrados de los medicamentos de un paciente, del más
 * reciente al más antiguo. El llamador los agrupa por medicationId. */
export async function listMedUsageByPatient(patientId) {
  const { data, error } = await supabase.from('med_usage_events').select('*')
    .eq('patient_id', patientId).order('usado_en', { ascending: false });
  if (error) throw error;
  return data.map(rowToMedUsage);
}

export async function addMedUsageEvent({ medicationId, razon }, householdId, patientId) {
  const { data, error } = await supabase.from('med_usage_events').insert({
    household_id: householdId, patient_id: patientId,
    medication_id: medicationId, razon,
  }).select().single();
  if (error) throw error;
  return rowToMedUsage(data);
}

export async function deleteMedUsageEvent(id) {
  const { error } = await supabase.from('med_usage_events').delete().eq('id', id);
  if (error) throw error;
}

// ─────────────────────────────────────────
// FAMILIA (miembros del household + invitaciones)
// ─────────────────────────────────────────
export async function listHouseholdMembers(householdId) {
  // RPC en vez de select directo: el correo vive en auth.users, que no es
  // accesible desde el cliente. La función solo responde a miembros.
  const { data, error } = await supabase.rpc('household_members_with_email', {
    p_household_id: householdId,
  });
  if (error) throw error;
  return data.map(r => ({
    userId: r.user_id, role: r.role, joinedAt: r.joined_at, email: r.email,
  }));
}

export async function listInvitations(householdId) {
  const { data, error } = await supabase.from('household_invitations').select('*')
    .eq('household_id', householdId).order('created_at', { ascending: false });
  if (error) throw error;
  return data.map(r => ({
    id: r.id, createdAt: r.created_at, expiresAt: r.expires_at,
    usedBy: r.used_by, usedAt: r.used_at,
  }));
}

/** Devuelve el código en claro — la única vez que existe fuera del hash. */
export async function createInvitation(householdId) {
  const { data, error } = await supabase.rpc('create_household_invitation', {
    p_household_id: householdId,
  });
  if (error) throw error;
  return data;
}

export async function revokeInvitation(id) {
  const { error } = await supabase.from('household_invitations').delete().eq('id', id);
  if (error) throw error;
}

export async function redeemInvitation(code) {
  const { data, error } = await supabase.rpc('redeem_household_invitation', {
    p_code: code,
  });
  if (error) throw error;
  return { householdId: data.household_id, householdName: data.household_name };
}

export async function removeMember(householdId, userId) {
  const { error } = await supabase.from('household_members').delete()
    .eq('household_id', householdId).eq('user_id', userId);
  if (error) throw error;
}

// ─────────────────────────────────────────
// VITAL SIGNS
// ─────────────────────────────────────────
function rowToVital(r) {
  return {
    id: r.id, patientId: r.patient_id, fecha: r.fecha, hora: r.hora, edad: r.edad,
    peso: r.peso, altura: r.altura, longitudTibial: r.longitud_tibial,
    perCintura: r.per_cintura, perCadera: r.per_cadera, perBrazo: r.per_brazo,
    perCefalico: r.per_cefalico,
    presionSis: r.presion_sistolica, presionDia: r.presion_diastolica,
    temperatura: r.temperatura, saturacion: r.saturacion, glucosa: r.glucosa,
    frecCardiaca: r.frecuencia_cardiaca, frecRespiratoria: r.frecuencia_respiratoria,
    notas: r.notas, creadoEn: r.created_at,
  };
}
function vitalToRow(v, householdId, patientId) {
  return {
    household_id: householdId,
    patient_id: patientId,
    fecha: v.fecha,
    hora: v.hora || null,
    edad: v.edad || null,
    peso: v.peso || null,
    altura: v.altura || null,
    longitud_tibial: v.longitudTibial || null,
    frecuencia_respiratoria: v.frecRespiratoria || null,
    per_cintura: v.perCintura || null,
    per_cadera: v.perCadera || null,
    per_brazo: v.perBrazo || null,
    per_cefalico: v.perCefalico || null,
    presion_sistolica: v.presionSis || null,
    presion_diastolica: v.presionDia || null,
    temperatura: v.temperatura || null,
    saturacion: v.saturacion || null,
    glucosa: v.glucosa || null,
    frecuencia_cardiaca: v.frecCardiaca || null,
    notas: v.notas || null,
  };
}

export async function listVitalsByPatient(patientId) {
  const { data, error } = await supabase.from('vital_signs').select('*')
    .eq('patient_id', patientId).order('fecha');
  if (error) throw error;
  return data.map(rowToVital);
}
export async function saveVital(vital, householdId, patientId) {
  const row = vitalToRow(vital, householdId, patientId);
  if (vital.id) {
    const { data, error } = await supabase.from('vital_signs').update(row).eq('id', vital.id).select().single();
    if (error) throw error;
    return rowToVital(data);
  }
  const { data, error } = await supabase.from('vital_signs').insert(row).select().single();
  if (error) throw error;
  return rowToVital(data);
}
export async function deleteVital(id) {
  const { error } = await supabase.from('vital_signs').delete().eq('id', id);
  if (error) throw error;
}
