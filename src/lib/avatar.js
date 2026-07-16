import { getSignedUrl } from './files.js';

/**
 * MI AUDITORIA #1 — foto de perfil del paciente.
 *
 * Las fotos viven en el bucket privado de Storage, así que mostrarlas
 * requiere una URL firmada (async). Los avatares (iniciales + color) se
 * siguen renderizando de forma síncrona en cada módulo como hasta ahora —
 * esto solo se encarga de "hidratarlos" después con la foto real, si el
 * paciente tiene una. Las URLs firmadas se cachean en memoria por sesión
 * para no pedir una nueva por cada re-render de la misma foto.
 */
const urlCache = new Map(); // path -> { url, exp }

async function resolveUrl(foto) {
  if (!foto?.path) return null;
  const cached = urlCache.get(foto.path);
  if (cached && cached.exp > Date.now() + 30_000) return cached.url;
  try {
    const url = await getSignedUrl(foto.path, 3600);
    urlCache.set(foto.path, { url, exp: Date.now() + 3600 * 1000 });
    return url;
  } catch {
    return null;
  }
}

/** Invalida la URL cacheada de una foto (tras reemplazarla o borrarla). */
export function invalidateAvatarCache(foto) {
  if (foto?.path) urlCache.delete(foto.path);
}

/**
 * Reemplaza visualmente el placeholder de iniciales de `el` por la foto
 * real del paciente, si tiene una. No hace nada si el paciente no tiene
 * foto o si `el` ya no está en el DOM (re-render más rápido que la red).
 */
export async function hydrateAvatar(el, patient) {
  if (!el || !patient?.foto?.path) return;
  const url = await resolveUrl(patient.foto);
  if (!url || !el.isConnected) return;
  el.style.backgroundImage = `url("${url}")`;
  el.style.backgroundSize = 'cover';
  el.style.backgroundPosition = 'center';
  el.textContent = '';
}

/** Hidrata todos los `[data-avatar-id]` de `root` contra una lista de pacientes. */
export function hydrateAvatarsIn(root, patients) {
  if (!root) return;
  root.querySelectorAll('[data-avatar-id]').forEach(el => {
    const p = patients.find(x => x.id === el.dataset.avatarId);
    if (p?.foto) hydrateAvatar(el, p);
  });
}
