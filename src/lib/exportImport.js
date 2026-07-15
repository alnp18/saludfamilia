import * as api from './api.js';

/**
 * Exportar / Importar pacientes entre familias, como archivo cifrado que se
 * descarga al dispositivo.
 *
 * Decisiones de seguridad:
 *  · Todo ocurre en el navegador: el servidor nunca ve el archivo, su
 *    contenido ni la contraseña. Los datos se leen y escriben por el API
 *    existente, así que la RLS por household aplica igual que siempre.
 *  · Cifrado AES-256-GCM con clave derivada por PBKDF2 (SHA-256, 310.000
 *    iteraciones) de una contraseña definida para esa exportación puntual
 *    (NO la de la cuenta: el archivo puede compartirse con otra persona).
 *  · GCM autentica el contenido: contraseña incorrecta o archivo alterado
 *    fallan al descifrar, no producen datos corruptos.
 */

const FILE_TYPE = 'saludfamilia-export';
const FILE_VERSION = 1;
const PBKDF2_ITERATIONS = 310000;
export const MIN_EXPORT_PASSWORD = 8;
export const FILE_EXTENSION = '.sfam';

// ─────────────────────────────────────────
// Utilidades base64 (por bloques: los adjuntos pueden pesar varios MB)
// ─────────────────────────────────────────
function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let out = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(out);
}

function b64ToBuf(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ─────────────────────────────────────────
// Cifrado
// ─────────────────────────────────────────
async function deriveKey(password, salt) {
  const material = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptPayload(payload, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return {
    app: 'SaludFamilia',
    type: FILE_TYPE,
    v: FILE_VERSION,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: PBKDF2_ITERATIONS },
    salt: bufToB64(salt),
    iv: bufToB64(iv),
    data: bufToB64(ciphertext),
  };
}

export async function decryptEnvelope(envelope, password) {
  if (!envelope || envelope.type !== FILE_TYPE || envelope.app !== 'SaludFamilia') {
    throw new Error('El archivo no es una exportación de SaludFamilia.');
  }
  if (envelope.v !== FILE_VERSION) {
    throw new Error('El archivo fue creado con una versión más nueva de la app.');
  }
  const key = await deriveKey(password, b64ToBuf(envelope.salt));
  let plaintext;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64ToBuf(envelope.iv) },
      key,
      b64ToBuf(envelope.data)
    );
  } catch {
    throw new Error('Contraseña incorrecta o archivo dañado.');
  }
  return JSON.parse(new TextDecoder().decode(plaintext));
}

// ─────────────────────────────────────────
// Armar la exportación (lee vía API → RLS del household actual)
// ─────────────────────────────────────────
/**
 * Reúne los datos de los pacientes seleccionados, más los médicos y centros
 * referenciados por sus órdenes (solo los referenciados: al importar no se
 * arrastra el directorio completo a la familia destino).
 */
export async function buildExportPayload(householdId, householdName, selectedPatients) {
  const orders = [];
  const meds = [];
  const vitals = [];

  for (const p of selectedPatients) {
    const [po, pm, pv] = await Promise.all([
      api.listOrdersByPatient(p.id),
      api.listMedsByPatient(p.id),
      api.listVitalsByPatient(p.id),
    ]);
    orders.push(...po.map(o => ({ ...o, patientId: p.id })));
    meds.push(...pm);
    vitals.push(...pv);
  }

  const [allDoctors, allCenters] = await Promise.all([
    api.listDoctors(householdId),
    api.listCenters(householdId),
  ]);

  const doctorIds = new Set();
  const centerIds = new Set();
  for (const o of orders) {
    if (o.medicoId) doctorIds.add(o.medicoId);
    if (o.medicoId_cita) doctorIds.add(o.medicoId_cita);
    if (o.auth_centroId) centerIds.add(o.auth_centroId);
  }
  const doctors = allDoctors.filter(d => doctorIds.has(d.id));
  // Un médico referenciado puede referenciar a su vez un centro.
  for (const d of doctors) if (d.centroId) centerIds.add(d.centroId);
  const centers = allCenters.filter(c => centerIds.has(c.id));

  return {
    exportedAt: new Date().toISOString(),
    householdName,
    patients: selectedPatients,
    doctors,
    centers,
    orders,
    meds,
    vitals,
  };
}

export function summarizePayload(payload) {
  return {
    pacientes: (payload.patients || []).length,
    ordenes: (payload.orders || []).length,
    medicamentos: (payload.meds || []).length,
    vitales: (payload.vitals || []).length,
    medicos: (payload.doctors || []).length,
    centros: (payload.centers || []).length,
  };
}

// ─────────────────────────────────────────
// Importar (escribe vía API → RLS del household destino)
// ─────────────────────────────────────────
/**
 * Crea todo el contenido del payload dentro del household destino, con IDs
 * nuevos y referencias remapeadas. Orden: centros → médicos → pacientes →
 * órdenes → medicamentos (padres antes que hijos) → signos vitales.
 * `onProgress(texto)` es opcional, para feedback en la UI.
 */
export async function importPayload(payload, householdId, onProgress = () => {}) {
  const centerMap = new Map();
  const doctorMap = new Map();
  const patientMap = new Map();
  const medMap = new Map();

  onProgress('Importando centros médicos…');
  for (const c of payload.centers || []) {
    const saved = await api.saveCenter({ ...c, id: undefined }, householdId);
    centerMap.set(c.id, saved.id);
  }

  onProgress('Importando médicos…');
  for (const d of payload.doctors || []) {
    const saved = await api.saveDoctor({
      ...d, id: undefined,
      centroId: d.centroId ? centerMap.get(d.centroId) || null : null,
    }, householdId);
    doctorMap.set(d.id, saved.id);
  }

  onProgress('Importando pacientes…');
  for (const p of payload.patients || []) {
    const saved = await api.savePatient({ ...p, id: undefined }, householdId);
    patientMap.set(p.id, saved.id);
  }

  onProgress('Importando órdenes médicas…');
  for (const o of payload.orders || []) {
    const patientId = patientMap.get(o.patientId);
    if (!patientId) continue; // orden de un paciente no incluido: no debería pasar
    await api.saveOrder({
      ...o, id: undefined,
      medicoId: o.medicoId ? doctorMap.get(o.medicoId) || null : null,
      medicoId_cita: o.medicoId_cita ? doctorMap.get(o.medicoId_cita) || null : null,
      auth_centroId: o.auth_centroId ? centerMap.get(o.auth_centroId) || null : null,
    }, householdId, patientId);
  }

  onProgress('Importando medicamentos…');
  // Las versiones encadenan medicamento_padre_id: insertar padres antes que
  // hijos, en pasadas sucesivas. Si quedara una referencia irresoluble (no
  // debería), se importa sin el vínculo en vez de perder el medicamento.
  let pending = (payload.meds || []).slice();
  while (pending.length) {
    const ready = pending.filter(m =>
      !m.medicamentoPadreId || medMap.has(m.medicamentoPadreId));
    const batch = ready.length ? ready : pending.map(m => ({ ...m, medicamentoPadreId: null }));
    for (const m of batch) {
      const patientId = patientMap.get(m.patientId);
      if (!patientId) continue;
      const saved = await api.insertMed({
        ...m, id: undefined,
        medicamentoPadreId: m.medicamentoPadreId
          ? medMap.get(m.medicamentoPadreId) || null : null,
      }, householdId, patientId);
      medMap.set(m.id, saved.id);
    }
    pending = ready.length
      ? pending.filter(m => !ready.includes(m))
      : [];
  }

  onProgress('Importando signos vitales…');
  for (const v of payload.vitals || []) {
    const patientId = patientMap.get(v.patientId);
    if (!patientId) continue;
    await api.saveVital({ ...v, id: undefined }, householdId, patientId);
  }

  return summarizePayload(payload);
}

// ─────────────────────────────────────────
// Archivo: descarga y lectura
// ─────────────────────────────────────────
export function downloadEnvelope(envelope) {
  const date = new Date().toISOString().slice(0, 10);
  const blob = new Blob([JSON.stringify(envelope)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `saludfamilia-${date}${FILE_EXTENSION}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return a.download;
}

export async function readEnvelopeFile(file) {
  const text = await file.text();
  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch {
    throw new Error('El archivo no es una exportación de SaludFamilia.');
  }
  return envelope;
}
