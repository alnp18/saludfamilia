import * as files from './files.js';
import { openImageCropper } from './imageCropper.js';
import { openAttachmentViewer } from './viewer.js';
import { showToast } from './modal.js';

/**
 * Campo de adjunto reutilizable: subir un archivo o tomar una foto con la
 * cámara del dispositivo, con recorte y conversión automática a PDF.
 *
 * Vivía suelto dentro de `orders.js`, con el estado en dos objetos de módulo
 * (`orderFiles` / `orderPages`) indexados por un nombre de slot fijo. Eso
 * alcanzaba mientras los campos de adjunto fueran cuatro y estuvieran
 * definidos de antemano. Con el asistente de consulta (migración 0035) hay
 * UNO POR ORDEN y las órdenes se agregan y se quitan en vivo: ya no hay lista
 * fija de slots que indexar.
 *
 * Así que cada campo se vuelve un objeto con su propio estado. Misma conducta
 * de siempre — es el mismo código, movido, no reescrito.
 *
 * Uso:
 *   const campo = createAttachmentField({ id: 'hc', nombreArchivo: 'historia-clinica' });
 *   contenedor.innerHTML = campo.html();
 *   campo.wire();                 // después de insertar el HTML en el DOM
 *   campo.set(adjuntoGuardado);   // precargar uno que ya está en Storage
 *   campo.get();                  // {name,type,data} nuevo, o {name,type,size,path} ya guardado, o null
 */

/** Proporción de una hoja carta vertical. El recortador necesita un marco fijo;
 *  el de una hoja es el que sirve para encuadrar el papel y dejar fuera la mesa. */
const HOJA_ASPECT = 8.5 / 11;

const CAMERA_ICON = '<svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h3.5l1.5-2h6l1.5 2H21a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>';

const DOC_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/></svg>';

export function createAttachmentField({
  id,
  nombreArchivo = 'documento',
  dropText = 'Haz clic para subir un archivo (PDF o foto)',
  accept = 'application/pdf,image/*',
} = {}) {
  // Adjunto actual: {name,type,data} recién elegido, o {name,type,size,path} si
  // ya vive en Storage. null = no hay.
  let adjunto = null;
  // Hojas fotografiadas EN ESTA SESIÓN. Una historia clínica de tres hojas es
  // un documento de tres páginas, no tres adjuntos sueltos, así que el PDF se
  // rearma entero cada vez que se suma o se quita una. Vive aparte porque a un
  // PDF ya guardado en Storage no se le pueden anexar páginas desde el
  // navegador — por eso "Agregar otra hoja" solo aparece si esta lista tiene algo.
  let paginas = [];
  let onChange = null;

  const el = (sufijo) => document.getElementById(`${id}-${sufijo}`);

  function html() {
    return `
      <div class="file-drop-row">
        <div class="file-drop" id="${id}-drop">${dropText}</div>
        <button type="button" class="btn btn-sm btn-icon" id="${id}-cam-btn" title="Tomar foto">${CAMERA_ICON}</button>
      </div>
      <input type="file" id="${id}-file" accept="${accept}" style="display:none"/>
      <input type="file" id="${id}-cam" accept="image/*" capture="environment" style="display:none"/>
      <div id="${id}-preview"></div>`;
  }

  function renderPreview() {
    const cont = el('preview');
    if (!cont) return;
    if (!adjunto) { cont.innerHTML = ''; return; }

    const esImagen = (adjunto.type || '').startsWith('image/');
    const hojas = paginas.length;
    cont.innerHTML = `<div class="file-preview">
      ${esImagen
        ? `<img id="${id}-thumb" ${adjunto.data ? `src="${adjunto.data}"` : ''} style="width:32px;height:32px;object-fit:cover;border-radius:4px"/>`
        : `<div class="fp-icon">${DOC_ICON}</div>`}
      <div class="fp-name" data-abrir title="Ver archivo">${escapar(adjunto.name)}${hojas > 1 ? ` · ${hojas} hojas` : ''}</div>
      <span class="fp-remove" data-quitar><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span>
    </div>
    ${hojas ? `<button type="button" class="btn btn-sm" data-anexar style="margin-top:6px">${CAMERA_ICON} Agregar otra hoja</button>` : ''}`;

    // Miniatura de un adjunto ya en Storage: hay que pedir una URL firmada.
    if (esImagen && !adjunto.data && files.isStored(adjunto)) {
      files.getSignedUrl(adjunto.path).then(url => {
        const img = el('thumb');
        if (img) img.src = url;
      }).catch(() => {});
    }

    cont.querySelector('[data-abrir]')?.addEventListener('click', () => openAttachmentViewer(adjunto));
    cont.querySelector('[data-quitar]')?.addEventListener('click', () => {
      adjunto = null; paginas = [];
      renderPreview();
      onChange?.(null);
    });
    cont.querySelector('[data-anexar]')?.addEventListener('click', () => {
      const input = el('cam');
      input.dataset.anexar = '1';
      input.click();
    });
  }

  /**
   * Un PDF entra tal cual. Una foto pasa primero por el recortador, con marco
   * de hoja carta: la cámara del teléfono captura la mesa, la mano y el papel
   * torcido, y antes todo eso quedaba guardado como "la historia clínica".
   * Cancelar el recorte no guarda nada — cancelar significa "esta foto no", no
   * "guárdala como salga".
   */
  async function manejarArchivo(inputEl, { anexar = false } = {}) {
    const file = inputEl.files[0];
    inputEl.value = ''; // permite volver a elegir el mismo archivo
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      const procesado = await files.processUploadFile(file);
      if (!procesado) return; // ya se avisó (archivo demasiado grande, etc.)
      paginas = [];
      adjunto = procesado;
      renderPreview();
      onChange?.(adjunto);
      return;
    }

    if (!files.validateImageFile(file)) return;
    const dataUrl = await files.blobToDataUrl(file);
    const recortada = await openImageCropper(dataUrl, {
      shape: 'rect',
      aspect: HOJA_ASPECT,
      outputWidth: 1400, // legible: es un documento para leer, no una miniatura
      title: anexar ? 'Ajustar la hoja siguiente' : 'Ajustar la hoja',
    });
    if (!recortada) return;

    const nuevas = anexar ? [...paginas, recortada] : [recortada];
    try {
      const pdf = await files.imagesToPdfDataUrl(nuevas);
      paginas = nuevas;
      adjunto = {
        name: `${nombreArchivo}-${nuevas.length}-hoja${nuevas.length !== 1 ? 's' : ''}.pdf`,
        type: 'application/pdf',
        data: pdf,
      };
    } catch {
      showToast('No se pudo armar el PDF con la foto', 'err');
      return;
    }
    renderPreview();
    onChange?.(adjunto);
  }

  function wire(opciones = {}) {
    onChange = opciones.onChange || null;
    el('drop')?.addEventListener('click', () => el('file').click());
    el('file')?.addEventListener('change', function () { manejarArchivo(this); });
    el('cam-btn')?.addEventListener('click', () => {
      const input = el('cam');
      delete input.dataset.anexar;
      input.click();
    });
    el('cam')?.addEventListener('change', function () {
      const anexar = this.dataset.anexar === '1';
      delete this.dataset.anexar;
      manejarArchivo(this, { anexar });
    });
    renderPreview();
  }

  return {
    html,
    wire,
    get: () => adjunto,
    /** Precarga un adjunto ya guardado. No cuenta como "hojas de esta sesión". */
    set: (att) => { adjunto = att || null; paginas = []; renderPreview(); },
    clear: () => { adjunto = null; paginas = []; renderPreview(); },
  };
}

function escapar(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
