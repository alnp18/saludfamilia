import * as api from './api.js';
import * as files from './files.js';

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
 * Devuelve el adjunto con su contenido embebido en base64. Los que viven
 * en Storage (formato {path}) se descargan primero: el archivo exportado
 * debe ser autocontenido, sin depender del bucket de la familia origen.
 */
async function embedAttachment(att) {
  if (files.isStored(att)) {
    return { name: att.name, type: att.type, data: await files.downloadAsDataUrl(att.path) };
  }
  return att || null; // formato viejo (ya embebido) o sin adjunto
}

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
    for (const o of po) {
      orders.push({
        ...o,
        patientId: p.id,
        orden_archivo: await embedAttachment(o.orden_archivo),
        solicitud_imagen: await embedAttachment(o.solicitud_imagen),
        auth_imagen: await embedAttachment(o.auth_imagen),
      });
    }
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
// Validación del payload (antes de escribir nada)
// ─────────────────────────────────────────
const COLLECTION_KEYS = ['patients', 'doctors', 'centers', 'orders', 'meds', 'vitals'];

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Valida la FORMA del payload descifrado ANTES de escribir nada en la base.
 * Un archivo .sfam corrupto o manipulado se rechaza acá, así no deja datos a
 * medias ni intenta insertar basura. No valida cada campo de texto (el render
 * ya escapa con esc()), sino la estructura: que las colecciones sean arrays de
 * objetos y que los ids sean primitivos. Lanza Error con mensaje claro si algo
 * no cuadra; devuelve true si el payload es válido.
 */
export function validatePayload(payload) {
  if (!isPlainObject(payload)) {
    throw new Error('El archivo no contiene datos válidos de SaludFamilia.');
  }
  for (const key of COLLECTION_KEYS) {
    const coll = payload[key];
    if (coll === undefined || coll === null) continue; // opcional → se trata como []
    if (!Array.isArray(coll)) {
      throw new Error(`El archivo está dañado: "${key}" debería ser una lista.`);
    }
    for (const item of coll) {
      if (!isPlainObject(item)) {
        throw new Error(`El archivo está dañado: hay un elemento inválido en "${key}".`);
      }
      const t = typeof item.id;
      if (item.id !== undefined && t !== 'string' && t !== 'number') {
        throw new Error(`El archivo está dañado: un elemento de "${key}" tiene un id inválido.`);
      }
    }
  }
  return true;
}

// ─────────────────────────────────────────
// Importar (escribe vía API → RLS del household destino)
// ─────────────────────────────────────────
const DELETE_BY_TYPE = {
  center: api.deleteCenter,
  doctor: api.deleteDoctor,
  patient: api.deletePatient,
  order: api.deleteOrder,
  med: api.deleteMed,
  vital: api.deleteVital,
};

/**
 * Revierte lo creado por un import fallido. Borra en orden INVERSO al de
 * creación (hijos antes que padres, respetando las FK) y limpia de Storage los
 * adjuntos que ya se habían subido. Es best-effort: si un borrado falla, sigue
 * con el resto y devuelve false para avisar que la reversión quedó incompleta.
 */
async function rollbackImport(created, uploadedPaths = [], onProgress = () => {}) {
  let allOk = true;
  onProgress('Revirtiendo lo importado…');
  for (let i = created.length - 1; i >= 0; i--) {
    const { type, id } = created[i];
    const del = DELETE_BY_TYPE[type];
    if (!del) { allOk = false; continue; }
    try {
      await del(id);
    } catch {
      allOk = false; // seguimos borrando el resto igual
    }
  }
  // Adjuntos ya subidos al bucket: se borran para no dejar objetos huérfanos.
  // removeAttachments es best-effort y no lanza (un huérfano es inaccesible
  // para otras familias igualmente), así que no afecta a allOk.
  if (uploadedPaths.length) await files.removeAttachments(uploadedPaths);
  return allOk;
}

/**
 * Crea todo el contenido del payload dentro del household destino, con IDs
 * nuevos y referencias remapeadas. Orden: centros → médicos → pacientes →
 * órdenes → medicamentos (padres antes que hijos) → signos vitales.
 * `onProgress(texto)` es opcional, para feedback en la UI.
 *
 * Antes de escribir valida la forma del payload (validatePayload). Si algo
 * falla a mitad del proceso, revierte automáticamente todo lo ya creado, de
 * modo que el import es "todo o nada" desde el punto de vista de la familia
 * destino (recuperable, sin dejar datos parciales).
 */
export async function importPayload(payload, householdId, onProgress = () => {}) {
  validatePayload(payload);

  const centerMap = new Map();
  const doctorMap = new Map();
  const patientMap = new Map();
  const medMap = new Map();

  // Registro de lo creado, en orden, para poder revertir si algo falla.
  const created = [];
  const track = (type, id) => created.push({ type, id });
  // Rutas de adjuntos subidos al Storage, para limpiarlas si hay que revertir.
  const uploadedPaths = [];

  try {
    onProgress('Importando centros médicos…');
    for (const c of payload.centers || []) {
      // publicSourceId (procedencia del directorio público, pieza A) no viaja
      // entre familias: en el archivo puede venir un id que ya no exista en el
      // directorio (la FK rechazaría el insert) y es metadato local, no dato
      // clínico. Se quita la CLAVE (no basta ponerla en undefined: la capa de
      // api solo escribe la columna si la clave está presente).
      const { publicSourceId: _omitC, ...cRest } = c;
      const saved = await api.saveCenter({ ...cRest, id: undefined }, householdId);
      track('center', saved.id);
      centerMap.set(c.id, saved.id);
    }

    onProgress('Importando médicos…');
    for (const d of payload.doctors || []) {
      const { publicSourceId: _omitD, ...dRest } = d;
      const saved = await api.saveDoctor({
        ...dRest, id: undefined,
        centroId: d.centroId ? centerMap.get(d.centroId) || null : null,
      }, householdId);
      track('doctor', saved.id);
      doctorMap.set(d.id, saved.id);
    }

    onProgress('Importando pacientes…');
    for (const p of payload.patients || []) {
      const saved = await api.savePatient({ ...p, id: undefined }, householdId);
      track('patient', saved.id);
      patientMap.set(p.id, saved.id);
    }

    onProgress('Importando órdenes médicas…');
    // Los adjuntos vienen embebidos en el archivo (base64); acá se suben al
    // Storage del household destino. Vale también para archivos exportados
    // antes de la migración a Storage: importan igual y quedan en el bucket.
    const SLOT_BY_FIELD = { orden_archivo: 'orden', solicitud_imagen: 'solicitud', auth_imagen: 'autorizacion' };
    for (const o of payload.orders || []) {
      const patientId = patientMap.get(o.patientId);
      if (!patientId) continue; // orden de un paciente no incluido: no debería pasar
      const base = {
        ...o, id: undefined,
        medicoId: o.medicoId ? doctorMap.get(o.medicoId) || null : null,
        medicoId_cita: o.medicoId_cita ? doctorMap.get(o.medicoId_cita) || null : null,
        auth_centroId: o.auth_centroId ? centerMap.get(o.auth_centroId) || null : null,
        orden_archivo: null, solicitud_imagen: null, auth_imagen: null,
      };
      const saved = await api.saveOrder(base, householdId, patientId);
      track('order', saved.id);
      let hasFiles = false;
      for (const [field, slot] of Object.entries(SLOT_BY_FIELD)) {
        const att = o[field];
        if (att && att.data) {
          const uploaded = await files.uploadAttachment(householdId, saved.id, slot, att);
          if (uploaded && uploaded.path) uploadedPaths.push(uploaded.path);
          base[field] = uploaded;
          hasFiles = true;
        }
      }
      if (hasFiles) {
        base.id = saved.id;
        await api.saveOrder(base, householdId, patientId);
      }
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
        track('med', saved.id);
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
      const saved = await api.saveVital({ ...v, id: undefined }, householdId, patientId);
      track('vital', saved.id);
    }

    return summarizePayload(payload);
  } catch (err) {
    // Algo falló a mitad del import: revertir todo lo ya creado para no dejar
    // la familia destino con datos parciales.
    const rollbackOk = await rollbackImport(created, uploadedPaths, onProgress);
    if (!rollbackOk) {
      throw new Error(
        'La importación falló y no se pudo revertir todo automáticamente. ' +
        'Revisá los módulos: puede haber quedado contenido parcial.'
      );
    }
    throw new Error(
      'La importación falló y se revirtió por completo: no quedó nada a medias.' +
      (err && err.message ? ` (${err.message})` : '')
    );
  }
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
