import { supabase } from './supabaseClient.js';
import { showToast } from './modal.js';

/**
 * Adjuntos en Supabase Storage (bucket privado "adjuntos").
 *
 * Formato persistido en las columnas jsonb de medical_orders:
 *   nuevo:  { name, type, size, path }   ← el archivo vive en Storage
 *   viejo:  { name, type, data }         ← data-URL base64 embebida
 * El formato viejo se sigue LEYENDO (archivos .sfam antiguos, datos
 * previos a la migración 0006) pero ya no se escribe.
 *
 * Ruta de cada objeto: <household_id>/<order_id>/<slot>-<ts>-<nombre>.
 * Las políticas de Storage validan el primer segmento con
 * is_household_member(), igual que la RLS de las tablas.
 */

export const BUCKET = 'adjuntos';
export const MAX_FILE_MB = 10;

/** ¿El adjunto ya vive en Storage? (vs. base64 embebido, formato viejo) */
export function isStored(att) {
  return !!(att && att.path);
}

function sanitizeName(name) {
  // Solo el nombre base, sin rutas, con caracteres seguros para una URL.
  const base = String(name || 'archivo').split(/[\\/]/).pop();
  return base.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'archivo';
}

function dataUrlToBlob(dataUrl) {
  const [head, b64] = String(dataUrl).split(',');
  // El header puede traer parámetros extra entre el mime type y ";base64"
  // — por ejemplo, el datauristring que genera jsPDF viene como
  // "data:application/pdf;filename=generado.pdf;base64". Antes el regex
  // exigía que ";base64" viniera pegado al mime type y fallaba en ese
  // caso, dejando el Blob con type "application/octet-stream" — Supabase
  // Storage usa el .type real del Blob (ignora la opción `contentType`
  // cuando se sube un Blob) y el bucket rechazaba ese mime type. Ahora
  // solo se toma lo que hay antes del primer ";" o ",".
  const mime = (head.match(/^data:([^;,]+)/) || [])[1] || 'application/octet-stream';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function blobToDataUrl(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

/**
 * Sube un adjunto en memoria ({name, type, data: dataURL}) y devuelve el
 * objeto persistible {name, type, size, path}.
 */
export async function uploadAttachment(householdId, orderId, slot, att) {
  const blob = dataUrlToBlob(att.data);
  const path = `${householdId}/${orderId}/${slot}-${Date.now()}-${sanitizeName(att.name)}`;
  const { error } = await supabase.storage.from(BUCKET)
    .upload(path, blob, { contentType: att.type || blob.type, upsert: false });
  if (error) throw error;
  return { name: att.name, type: att.type || blob.type, size: blob.size, path };
}

/** URL firmada temporal para ver/descargar un adjunto del bucket privado. */
export async function getSignedUrl(path, expiresInSeconds = 3600) {
  const { data, error } = await supabase.storage.from(BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}

/** Descarga el contenido de un adjunto como data-URL (para exportaciones). */
export async function downloadAsDataUrl(path) {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error) throw error;
  return blobToDataUrl(data);
}

/**
 * Borra adjuntos por ruta. Mejor esfuerzo: se usa al reemplazar/quitar un
 * archivo o eliminar una orden; si falla, queda un objeto huérfano en el
 * bucket (inaccesible para otros households igualmente).
 */
export async function removeAttachments(paths) {
  const list = (Array.isArray(paths) ? paths : [paths]).filter(Boolean);
  if (!list.length) return;
  try {
    await supabase.storage.from(BUCKET).remove(list);
  } catch { /* huérfano tolerado */ }
}

/** Rutas de todos los adjuntos en Storage de una orden (para limpieza). */
export function attachmentPathsOfOrder(order) {
  return [order?.orden_archivo, order?.solicitud_imagen, order?.auth_imagen]
    .filter(isStored)
    .map(a => a.path);
}

function loadImage(dataUrl) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('No se pudo leer la imagen'));
    img.src = dataUrl;
  });
}

/**
 * Convierte una imagen (data-URL) en un PDF de una sola página (carta,
 * imagen centrada y ajustada con márgenes). Se usa en la sección "Historia
 * clínica" de la orden (P1.5): el usuario puede subir una foto directamente
 * y queda guardada como PDF, igual que si hubiera subido uno ya existente.
 */
export async function imageToPdfDataUrl(dataUrl) {
  // Carga perezosa: jsPDF (+ sus dependencias de compresión/decodificación
  // PNG) solo se descarga si de verdad se sube una foto para este campo —
  // la mayoría de las órdenes suben un PDF ya existente y nunca la necesitan.
  const [{ jsPDF }, img] = await Promise.all([import('jspdf'), loadImage(dataUrl)]);
  const orientation = img.width > img.height ? 'landscape' : 'portrait';
  const doc = new jsPDF({ orientation, unit: 'pt', format: 'letter' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 24;
  const maxW = pageW - margin * 2, maxH = pageH - margin * 2;
  const ratio = Math.min(maxW / img.width, maxH / img.height, 1);
  const w = img.width * ratio, h = img.height * ratio;
  const x = (pageW - w) / 2, y = (pageH - h) / 2;
  const format = (/^data:image\/(\w+);/.exec(dataUrl)?.[1] || 'jpeg').toUpperCase();
  doc.addImage(dataUrl, format === 'JPG' ? 'JPEG' : format, x, y, w, h);
  return doc.output('datauristring');
}

const AVATAR_MAX_DIM = 640; // px, lado más largo — suficiente para avatares circulares/miniaturas

/**
 * Procesa una foto de perfil de paciente (MI AUDITORIA #1): a diferencia de
 * processUploadFile, esto NUNCA convierte a PDF — la foto se muestra tal
 * cual como imagen. Solo valida tipo/tamaño y la redimensiona en el cliente
 * si es más grande que AVATAR_MAX_DIM, para no acumular fotos pesadas en
 * Storage. Devuelve {name, type, data} listo para uploadAttachment, o null
 * si el archivo no es válido (ya se avisó con un toast).
 */
export async function processAvatarFile(file) {
  if (!file.type.startsWith('image/')) {
    showToast('La foto de perfil debe ser una imagen', 'err');
    return null;
  }
  if (file.size > MAX_FILE_MB * 1024 * 1024) {
    showToast(`Archivo muy grande (máx. ${MAX_FILE_MB}MB)`, 'err');
    return null;
  }
  const dataUrl = await blobToDataUrl(file);
  try {
    const img = await loadImage(dataUrl);
    if (img.width <= AVATAR_MAX_DIM && img.height <= AVATAR_MAX_DIM) {
      return { name: file.name, type: file.type, data: dataUrl };
    }
    const ratio = AVATAR_MAX_DIM / Math.max(img.width, img.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * ratio);
    canvas.height = Math.round(img.height * ratio);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const resized = canvas.toDataURL('image/jpeg', 0.85);
    const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return { name, type: 'image/jpeg', data: resized };
  } catch {
    // Si por algún motivo no se pudo redimensionar, se sube la imagen tal
    // cual en vez de bloquear al usuario.
    return { name: file.name, type: file.type, data: dataUrl };
  }
}

/**
 * Procesa un archivo recién elegido para CUALQUIER campo de adjunto de la
 * app (subido desde archivos o tomado con la cámara — ver <input capture>
 * en cada formulario) — cambio transversal P1.5: toda foto se guarda como
 * PDF, nunca como imagen suelta, para no acumular adjuntos pesados. Valida
 * el tamaño máximo y, si es una imagen, la convierte con imageToPdfDataUrl.
 * Un PDF subido directamente pasa sin tocar. Devuelve {name, type, data}
 * listo para subir a Storage al guardar el formulario, o null si el
 * archivo no es válido (ya se avisó con un toast).
 */
export async function processUploadFile(file) {
  if (file.size > MAX_FILE_MB * 1024 * 1024) {
    showToast(`Archivo muy grande (máx. ${MAX_FILE_MB}MB)`, 'err');
    return null;
  }
  let dataUrl = await blobToDataUrl(file);
  let name = file.name, type = file.type;
  if (type.startsWith('image/')) {
    try {
      dataUrl = await imageToPdfDataUrl(dataUrl);
      type = 'application/pdf';
      name = name.replace(/\.[^.]+$/, '') + '.pdf';
    } catch {
      showToast('No se pudo convertir la foto a PDF; se guardará tal cual', 'warn');
    }
  }
  return { name, type, data: dataUrl };
}
