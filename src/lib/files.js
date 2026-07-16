import { supabase } from './supabaseClient.js';

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
  const mime = (head.match(/^data:([^;]+);base64$/) || [])[1] || 'application/octet-stream';
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

/**
 * Abre un adjunto en una pestaña nueva: con URL firmada si vive en
 * Storage, o vía blob temporal si es del formato viejo (base64).
 */
export async function openAttachment(att) {
  if (isStored(att)) {
    const url = await getSignedUrl(att.path, 300);
    window.open(url, '_blank', 'noopener');
  } else if (att && att.data) {
    const blob = dataUrlToBlob(att.data);
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}
