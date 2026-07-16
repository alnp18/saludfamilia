import { getSignedUrl, isStored } from './files.js';
import { showToast } from './modal.js';
import { esc } from './utils.js';
import { Icons } from './icons.js';

/**
 * Visor de adjuntos (imágenes y PDF) en una ventana sobrepuesta — nunca una
 * pestaña nueva. Reemplaza al viejo files.openAttachment() (window.open),
 * que abría el archivo fuera de la app.
 *
 * Requisitos (P1.5, cambio transversal): barra superior fija con botones de
 * descarga y cierre que nunca se mueven; ampliación dentro de la misma
 * ventana, limitada a 300%; y desplazamiento del documento ampliado
 * arrastrando con el mouse/dedo.
 */

const ZOOM_MIN = 100;
const ZOOM_MAX = 300;
const ZOOM_STEP = 25;

let activeClose = null;

export async function openAttachmentViewer(att) {
  if (!att) return;
  activeClose?.(); // por seguridad, si quedó uno abierto de antes

  const name = att.name || 'Documento';
  const isImg = (att.type || '').startsWith('image/');

  const root = document.createElement('div');
  root.className = 'viewer-overlay';
  root.innerHTML = `
    <div class="viewer-bar">
      <div class="viewer-name" title="${esc(name)}">${esc(name)}</div>
      <div class="viewer-zoom">
        <button type="button" class="viewer-btn" id="viewer-zoom-out" title="Alejar">−</button>
        <span class="viewer-zoom-pct" id="viewer-zoom-pct">100%</span>
        <button type="button" class="viewer-btn" id="viewer-zoom-in" title="Ampliar">+</button>
      </div>
      <div class="viewer-actions">
        <button type="button" class="viewer-btn" id="viewer-download" title="Descargar">${Icons.download}</button>
        <button type="button" class="viewer-btn" id="viewer-close" title="Cerrar">${Icons.x}</button>
      </div>
    </div>
    <div class="viewer-stage" id="viewer-stage">
      <div class="viewer-loading" id="viewer-loading">Cargando…</div>
    </div>`;
  document.body.appendChild(root);

  const stage = root.querySelector('#viewer-stage');
  const zoomPct = root.querySelector('#viewer-zoom-pct');
  const zoomInBtn = root.querySelector('#viewer-zoom-in');
  const zoomOutBtn = root.querySelector('#viewer-zoom-out');

  let zoom = 100;
  let panX = 0, panY = 0;
  let dragging = false, dragStartX = 0, dragStartY = 0, panStartX = 0, panStartY = 0;
  let content = null;
  let resolvedUrl = null;

  function applyTransform() {
    if (content) content.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom / 100})`;
  }

  // Evita que el arrastre saque el documento completamente de la vista: el
  // desplazamiento máximo depende de cuánto sobra de contenido ampliado
  // respecto al tamaño visible del escenario.
  function clampPan() {
    if (!content) return;
    const scale = zoom / 100;
    const rect = stage.getBoundingClientRect();
    const extraW = (rect.width * scale - rect.width) / 2;
    const extraH = (rect.height * scale - rect.height) / 2;
    panX = Math.max(-extraW, Math.min(extraW, panX));
    panY = Math.max(-extraH, Math.min(extraH, panY));
  }

  function setZoom(next) {
    zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, next));
    zoomPct.textContent = `${zoom}%`;
    if (zoom === ZOOM_MIN) { panX = 0; panY = 0; }
    clampPan();
    applyTransform();
    stage.classList.toggle('zoomed', zoom > ZOOM_MIN);
    zoomOutBtn.disabled = zoom <= ZOOM_MIN;
    zoomInBtn.disabled = zoom >= ZOOM_MAX;
  }
  zoomInBtn.addEventListener('click', () => setZoom(zoom + ZOOM_STEP));
  zoomOutBtn.addEventListener('click', () => setZoom(zoom - ZOOM_STEP));

  // El arrastre solo mueve el documento cuando está ampliado (>100%); a
  // 100% un PDF conserva su propio scroll nativo (varias páginas, etc).
  function onPointerDown(e) {
    if (zoom <= ZOOM_MIN) return;
    dragging = true;
    dragStartX = e.clientX; dragStartY = e.clientY;
    panStartX = panX; panStartY = panY;
    stage.classList.add('dragging');
    stage.setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e) {
    if (!dragging) return;
    panX = panStartX + (e.clientX - dragStartX);
    panY = panStartY + (e.clientY - dragStartY);
    clampPan();
    applyTransform();
  }
  function onPointerUp(e) {
    dragging = false;
    stage.classList.remove('dragging');
    stage.releasePointerCapture?.(e.pointerId);
  }
  stage.addEventListener('pointerdown', onPointerDown);
  stage.addEventListener('pointermove', onPointerMove);
  stage.addEventListener('pointerup', onPointerUp);
  stage.addEventListener('pointerleave', onPointerUp);

  function onKeydown(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKeydown);

  function close() {
    document.removeEventListener('keydown', onKeydown);
    root.remove();
    activeClose = null;
  }
  activeClose = close;
  root.querySelector('#viewer-close').addEventListener('click', close);
  // Cerrar al tocar fuera del documento (la barra y el escenario cubren
  // todo el overlay, así que esto solo dispara si el click cae justo en
  // el fondo, nunca en medio de un arrastre).
  root.addEventListener('click', (e) => { if (e.target === root) close(); });

  async function resolveUrl() {
    if (!resolvedUrl) resolvedUrl = isStored(att) ? await getSignedUrl(att.path, 300) : att.data;
    return resolvedUrl;
  }

  const downloadBtn = root.querySelector('#viewer-download');
  downloadBtn.addEventListener('click', async () => {
    downloadBtn.disabled = true;
    try {
      const url = await resolveUrl();
      const blob = await (await fetch(url)).blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
    } catch {
      showToast('No se pudo descargar el archivo', 'err');
    } finally {
      downloadBtn.disabled = false;
    }
  });

  try {
    const url = await resolveUrl();
    root.querySelector('#viewer-loading')?.remove();

    const wrap = document.createElement('div');
    wrap.className = 'viewer-content';
    if (isImg) {
      const img = document.createElement('img');
      img.src = url;
      img.draggable = false;
      wrap.appendChild(img);
    } else {
      const iframe = document.createElement('iframe');
      iframe.src = url;
      iframe.title = name;
      wrap.appendChild(iframe);
    }
    stage.appendChild(wrap);
    content = wrap;
    setZoom(100);
  } catch (err) {
    stage.innerHTML = '<div class="viewer-error">No se pudo cargar el archivo.</div>';
    showToast(err?.message || 'No se pudo cargar el archivo', 'err');
  }
}
