/**
 * Recorte de imagen antes de subir (auditoría 2026-07-17): tanto la foto de
 * perfil del paciente como el carnet de una póliza necesitan poder
 * recortarse y encuadrarse antes de guardarse — hasta ahora se subían tal
 * cual (o, en el caso de las pólizas, se convertían a PDF sin más).
 *
 * Ventana sobrepuesta propia (no reutiliza #overlay/#modal), mismo criterio
 * que src/lib/viewer.js: puede abrirse encima del modal de ficha de
 * paciente, que sigue abierto detrás. Interacción: arrastrar para
 * encuadrar + botones de zoom (mismo lenguaje visual que el visor de
 * adjuntos). El resultado siempre es una imagen (nunca PDF) — la forma del
 * marco (círculo o rectángulo) es solo una guía visual: el archivo
 * guardado es siempre rectangular; el círculo del avatar lo aplica el CSS
 * (border-radius) al mostrarlo, igual que ya se hacía antes de este cambio.
 */

const ZOOM_MIN = 1;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.15;

let activeClose = null;

function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('No se pudo leer la imagen'));
    img.src = src;
  });
}

/**
 * Abre el recortador sobre `dataUrl` (una imagen ya leída como data-URL) y
 * devuelve una Promise con la imagen recortada como data-URL JPEG, o `null`
 * si el usuario cancela.
 *
 * Opciones:
 *  - shape: 'rect' | 'circle' — solo cambia el marco guía, no el archivo.
 *  - aspect: ancho/alto del marco (ignorado si shape es 'circle', que
 *    siempre usa 1:1).
 *  - outputWidth: ancho en px de la imagen final (el alto sale de aspect).
 *  - quality: calidad JPEG (0–1).
 *  - title: texto de la barra superior.
 */
export function openImageCropper(dataUrl, opts = {}) {
  const {
    shape = 'rect',
    aspect = 1,
    outputWidth = 600,
    quality = 0.88,
    title = 'Ajustar imagen',
  } = opts;
  const frameAspect = shape === 'circle' ? 1 : aspect;

  return new Promise((resolve) => {
    activeClose?.(); // por seguridad, si quedó uno abierto de antes

    let settled = false;
    let zoom = 1;
    let baseScale = 1;
    let panX = 0, panY = 0;
    let naturalW = 0, naturalH = 0;
    let frameW = 0, frameH = 0;
    let imgEl = null;
    let dragging = false, dragStartX = 0, dragStartY = 0, panStartX = 0, panStartY = 0;

    const root = document.createElement('div');
    root.className = 'cropper-overlay';
    root.innerHTML = `
      <div class="cropper-bar">
        <div class="cropper-title">${title}</div>
        <div class="cropper-zoom">
          <button type="button" class="viewer-btn" id="crop-zoom-out" title="Alejar" disabled>−</button>
          <span class="viewer-zoom-pct" id="crop-zoom-pct">100%</span>
          <button type="button" class="viewer-btn" id="crop-zoom-in" title="Ampliar" disabled>+</button>
        </div>
        <div class="cropper-actions">
          <button type="button" class="btn btn-sm" id="crop-cancel-btn">Cancelar</button>
          <button type="button" class="btn btn-sm btn-primary" id="crop-save-btn" disabled>Recortar y guardar</button>
        </div>
      </div>
      <div class="cropper-stage" id="crop-stage">
        <div class="cropper-loading" id="crop-loading">Cargando…</div>
        <div class="cropper-frame ${shape === 'circle' ? 'is-circle' : ''}" id="crop-frame"></div>
      </div>`;
    document.body.appendChild(root);

    const stage = root.querySelector('#crop-stage');
    const frame = root.querySelector('#crop-frame');
    const zoomPct = root.querySelector('#crop-zoom-pct');
    const zoomInBtn = root.querySelector('#crop-zoom-in');
    const zoomOutBtn = root.querySelector('#crop-zoom-out');
    const saveBtn = root.querySelector('#crop-save-btn');
    const cancelBtn = root.querySelector('#crop-cancel-btn');

    function finish(result) {
      if (settled) return;
      settled = true;
      close();
      resolve(result);
    }

    function close() {
      document.removeEventListener('keydown', onKeydown);
      root.remove();
      activeClose = null;
    }
    activeClose = () => finish(null);

    function onKeydown(e) { if (e.key === 'Escape') finish(null); }
    document.addEventListener('keydown', onKeydown);
    cancelBtn.addEventListener('click', () => finish(null));
    root.addEventListener('click', (e) => { if (e.target === root) finish(null); });

    function applyImgTransform() {
      const scale = baseScale * zoom;
      imgEl.style.width = `${naturalW * scale}px`;
      imgEl.style.height = `${naturalH * scale}px`;
      imgEl.style.transform = `translate(calc(-50% + ${panX}px), calc(-50% + ${panY}px))`;
    }

    // Igual que en viewer.js: el arrastre nunca debe poder sacar el marco
    // de encuadre fuera de la imagen. Como el encuadre siempre "cubre" el
    // marco (baseScale se calculó para eso), el sobrante en cada eje es
    // como mucho la diferencia entre el tamaño mostrado y el del marco.
    function clampPan() {
      const scale = baseScale * zoom;
      const dispW = naturalW * scale, dispH = naturalH * scale;
      const extraW = Math.max(0, (dispW - frameW) / 2);
      const extraH = Math.max(0, (dispH - frameH) / 2);
      panX = Math.max(-extraW, Math.min(extraW, panX));
      panY = Math.max(-extraH, Math.min(extraH, panY));
    }

    // Los botones de zoom empiezan deshabilitados (arriba, en el HTML
    // inicial) y solo se habilitan tras cargar la imagen; este guard extra
    // evita un TypeError si de todos modos llegara a dispararse un click
    // antes de tiempo (p.ej. Enter sobre el botón enfocado, justo mientras
    // la imagen todavía se está decodificando).
    function setZoom(next) {
      if (!imgEl) return;
      zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, next));
      zoomPct.textContent = `${Math.round(zoom * 100)}%`;
      clampPan();
      applyImgTransform();
      zoomOutBtn.disabled = zoom <= ZOOM_MIN;
      zoomInBtn.disabled = zoom >= ZOOM_MAX;
    }
    zoomInBtn.addEventListener('click', () => setZoom(zoom + ZOOM_STEP));
    zoomOutBtn.addEventListener('click', () => setZoom(zoom - ZOOM_STEP));
    stage.addEventListener('wheel', (e) => {
      if (!imgEl) return;
      e.preventDefault();
      setZoom(zoom - e.deltaY * 0.0015);
    }, { passive: false });

    function onPointerDown(e) {
      if (!imgEl) return;
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
      applyImgTransform();
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

    // El recorte final: qué rectángulo del archivo ORIGINAL (en px reales,
    // no los px mostrados en pantalla) cae dentro del marco ahora mismo.
    function cropToDataUrl() {
      const scale = baseScale * zoom;
      const dispW = naturalW * scale, dispH = naturalH * scale;
      let srcX = (dispW / 2 - frameW / 2 - panX) / scale;
      let srcY = (dispH / 2 - frameH / 2 - panY) / scale;
      let srcW = frameW / scale;
      let srcH = frameH / scale;
      // Salvaguarda ante errores de redondeo: nunca pedir fuera de los
      // límites reales de la imagen.
      srcX = Math.max(0, Math.min(srcX, naturalW - srcW));
      srcY = Math.max(0, Math.min(srcY, naturalH - srcH));

      const outW = outputWidth;
      const outH = Math.round(outputWidth / frameAspect);
      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      canvas.getContext('2d').drawImage(imgEl, srcX, srcY, srcW, srcH, 0, 0, outW, outH);
      return canvas.toDataURL('image/jpeg', quality);
    }
    saveBtn.addEventListener('click', () => finish(cropToDataUrl()));

    // El marco tiene tamaño fijo en pantalla (no depende de la imagen) —
    // se calcula apenas se abre, dejando margen para la barra superior.
    const availW = Math.min(window.innerWidth * 0.9, 520);
    const availH = Math.min(window.innerHeight - 180, 520);
    frameW = availW;
    frameH = frameW / frameAspect;
    if (frameH > availH) { frameH = availH; frameW = frameH * frameAspect; }
    frame.style.width = `${frameW}px`;
    frame.style.height = `${frameH}px`;

    loadImage(dataUrl).then(img => {
      naturalW = img.naturalWidth;
      naturalH = img.naturalHeight;
      // "cover": a zoom 1 la imagen ya cubre el marco por completo en
      // ambos ejes (igual que background-size:cover).
      baseScale = Math.max(frameW / naturalW, frameH / naturalH);

      root.querySelector('#crop-loading')?.remove();
      imgEl = document.createElement('img');
      imgEl.className = 'cropper-img';
      imgEl.draggable = false;
      imgEl.src = dataUrl;
      stage.insertBefore(imgEl, frame);

      panX = 0; panY = 0;
      saveBtn.disabled = false;
      setZoom(1);
    }).catch(() => {
      stage.innerHTML = '<div class="cropper-loading">No se pudo cargar la imagen.</div>';
    });
  });
}
