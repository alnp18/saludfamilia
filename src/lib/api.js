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
function rowToPatient(r) {
  return {
    id: r.id,
    nombre: r.nombre,
    fechaNacimiento: r.fecha_nacimiento,
    sexo: r.sexo,
    tipoSangre: r.tipo_sangre,
    eps: r.eps,
    numeroAfiliado: r.numero_afiliado,
    contactoEmergencia: r.contacto_emergencia,
    notas: r.notas,
    _lightMode: r.light_mode,
    creadoEn: r.created_at,
  };
}
function patientToRow(p, householdId) {
  return {
    household_id: householdId,
    nombre: p.nombre,
    fecha_nacimiento: p.fechaNacimiento || null,
    sexo: p.sexo || null,
    tipo_sangre: p.tipoSangre || null,
    eps: p.eps || null,
    numero_afiliado: p.numeroAfiliado || null,
    contacto_emergencia: p.contactoEmergencia || null,
    notas: p.notas || null,
    light_mode: !!p._lightMode,
  };
}

export async function listPatients(householdId) {
  const { data, error } = await supabase.from('patients').select('*')
    .eq('household_id', householdId).order('nombre');
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
// MEDICAL CENTERS
// ─────────────────────────────────────────
function rowToCenter(r) {
  return {
    id: r.id, nombre: r.nombre, tel1: r.tel1, tel2: r.tel2,
    dir: r.direccion, email: r.email, web: r.web,
  };
}
function centerToRow(c, householdId) {
  return {
    household_id: householdId,
    nombre: c.nombre, tel1: c.tel1 || null, tel2: c.tel2 || null,
    direccion: c.dir || null, email: c.email || null, web: c.web || null,
  };
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
  };
}
function doctorToRow(d, householdId) {
  return {
    household_id: householdId,
    nombre: d.nombre, especialidad: d.especialidad || null,
    centro_id: d.centroId || null, consultorio: d.consultorio || null,
    telefono: d.tel || null, notas: d.notas || null,
  };
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
// MEDICATIONS (con versionado)
// ─────────────────────────────────────────
function rowToMed(r) {
  return {
    id: r.id, patientId: r.patient_id, nombre: r.nombre, dosis: r.dosis,
    unidad: r.unidad, frecuencia: r.frecuencia, horarios: r.horarios || [],
    via: r.via, fechaInicio: r.fecha_inicio, fechaFin: r.fecha_fin,
    observaciones: r.observaciones, activo: r.activo, version: r.version,
    medicamentoPadreId: r.medicamento_padre_id, motivoCambio: r.motivo_cambio,
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
// VITAL SIGNS
// ─────────────────────────────────────────
function rowToVital(r) {
  return {
    id: r.id, patientId: r.patient_id, fecha: r.fecha, edad: r.edad,
    peso: r.peso, altura: r.altura, perCintura: r.per_cintura,
    perCadera: r.per_cadera, perBrazo: r.per_brazo,
    presionSis: r.presion_sistolica, presionDia: r.presion_diastolica,
    temperatura: r.temperatura, saturacion: r.saturacion, glucosa: r.glucosa,
    frecCardiaca: r.frecuencia_cardiaca, notas: r.notas, creadoEn: r.created_at,
  };
}
function vitalToRow(v, householdId, patientId) {
  return {
    household_id: householdId,
    patient_id: patientId,
    fecha: v.fecha,
    edad: v.edad || null,
    peso: v.peso || null,
    altura: v.altura || null,
    per_cintura: v.perCintura || null,
    per_cadera: v.perCadera || null,
    per_brazo: v.perBrazo || null,
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
