import { esc, debounce } from './utils.js';
import { positionAnchored, followAnchor } from './popover.js';

/**
 * Patrón transversal "Búsqueda en vivo" — auditoría móvil 2026-07-25, Fase 1.
 *
 * Campo de texto que va mostrando coincidencias mientras se escribe, en vez
 * de un desplegable con todas las opciones cargadas de antemano. Está pensado
 * para las listas que no caben en un `<select>`: médicos (privados +
 * directorio público), medicamentos (los de la familia + el INVIMA) y
 * síntomas.
 *
 * Sigue la misma convención que el resto de campos compuestos de la app
 * (`geo.js`, `dateRange.js`), identificando el campo por `prefix`:
 *  - `liveSearchFieldHtml(prefix, opts)` → HTML para el formulario.
 *  - `wireLiveSearch(prefix, opts)`      → lo conecta.
 *  - `fillLiveSearch(prefix, sel)`       → carga un valor ya guardado.
 *  - `readLiveSearch(prefix)`            → { id, label, texto }.
 *
 * Quien lo usa solo aporta una función `buscar(query)` que devuelve
 * `[{ id, label, sub?, etiqueta? }]`; de dónde salgan esos datos es asunto
 * suyo (ver `searchSources.js`).
 *
 * El valor elegido viaja en un `<input type="hidden">` con el id
 * seleccionado, igual que haría un `<select>`, para que los formularios que
 * ya guardaban un id no tengan que cambiar cómo leen el dato.
 */

let abierto = null; // { prefix, pop, desmontar } del desplegable visible

function cerrarAbierto() {
  if (!abierto) return;
  abierto.desmontar?.();
  abierto.pop.remove();
  abierto = null;
}

/**
 * Cierra el desplegable de resultados si hay alguno abierto. Lo llama
 * `closeModal()`, porque el desplegable vive en `document.body` y no
 * desaparece solo al cerrarse el formulario que lo abrió.
 */
export function closeLiveSearchDropdown() {
  cerrarAbierto();
}

/**
 * @param {string} prefix
 * @param {object} [opts]
 * @param {string} [opts.label]
 * @param {string} [opts.placeholder]
 * @param {boolean} [opts.span] - ocupar las dos columnas del formulario.
 * @param {string} [opts.hint] - texto de ayuda debajo del campo.
 */
export function liveSearchFieldHtml(prefix, { label = 'Buscar', placeholder = 'Escribe para buscar…', span = false, hint = '' } = {}) {
  return `
    <div class="form-field${span ? ' span2' : ''}">
      <label class="fl">${esc(label)}</label>
      <div class="ls-field">
        <input class="fi" id="${prefix}-input" type="text" placeholder="${esc(placeholder)}"
               autocomplete="off" role="combobox" aria-expanded="false" aria-autocomplete="list"/>
        <input type="hidden" id="${prefix}-id"/>
        <button type="button" class="ls-clear hidden" id="${prefix}-clear" title="Limpiar" aria-label="Limpiar">×</button>
      </div>
      ${hint ? `<div class="ls-hint">${esc(hint)}</div>` : ''}
    </div>`;
}

/**
 * @param {string} prefix
 * @param {object} opts
 * @param {(query: string) => Promise<{resultados: object[], omitidasPorConexion?: number}|object[]>} opts.buscar
 * @param {(sel: {id: string, label: string}|null) => void} [opts.onSelect]
 * @param {number} [opts.minChars] - mínimo de letras antes de buscar.
 * @param {boolean} [opts.permitirLibre] - ofrecer "usar lo escrito" cuando no
 *   hay coincidencia exacta (equivalente al "Otro" de los desplegables).
 * @param {string} [opts.textoLibre] - cómo se ofrece esa opción.
 */
export function wireLiveSearch(prefix, {
  buscar,
  onSelect,
  minChars = 2,
  permitirLibre = false,
  textoLibre = 'Usar lo escrito',
} = {}) {
  const input = document.getElementById(`${prefix}-input`);
  const hidden = document.getElementById(`${prefix}-id`);
  const clearBtn = document.getElementById(`${prefix}-clear`);
  if (!input || !hidden) return;

  let resultados = [];
  let resaltado = -1;
  let omitidasPorConexion = 0;
  let cargando = false;
  // Cada búsqueda lleva número: si vuelve una respuesta vieja después de una
  // nueva (las fuentes remotas no responden en orden), se descarta.
  let corrida = 0;

  const actualizarClear = () => clearBtn?.classList.toggle('hidden', !input.value);

  function limpiarSeleccion() {
    if (!hidden.value) return;
    hidden.value = '';
    onSelect?.(null);
  }

  function elegir(r) {
    if (!r) return;
    input.value = r.label;
    hidden.value = r.id ?? '';
    actualizarClear();
    cerrar();
    onSelect?.({ id: hidden.value, label: r.label, item: r.item });
  }

  function cerrar() {
    if (abierto?.prefix === prefix) cerrarAbierto();
    input.setAttribute('aria-expanded', 'false');
    resaltado = -1;
  }

  function abrir() {
    if (abierto?.prefix !== prefix) {
      cerrarAbierto();
      const pop = document.createElement('div');
      pop.className = 'ls-dropdown';
      document.body.appendChild(pop);
      // Se ancla al campo entero (no al input) para que el ancho calce.
      const ancla = input.closest('.ls-field') || input;
      pop.style.width = `${ancla.getBoundingClientRect().width}px`;
      abierto = { prefix, pop, desmontar: followAnchor(pop, ancla) };
      positionAnchored(pop, ancla);
    }
    input.setAttribute('aria-expanded', 'true');
    pintar();
  }

  function pintar() {
    if (abierto?.prefix !== prefix) return;
    const { pop } = abierto;
    const query = input.value.trim();

    const avisoConexion = omitidasPorConexion
      ? '<div class="ls-note">Sin conexión: se busca solo en tu información guardada.</div>'
      : '';

    let cuerpo;
    if (cargando) {
      cuerpo = '<div class="ls-empty">Buscando…</div>';
    } else if (resultados.length) {
      // Nombre y detalle van en renglones distintos: los nombres del INVIMA
      // son largos ("LOSARTAN 100 MG + HIDROCLOROTIAZIDA 12.5 MG") y en una
      // sola línea se pisaban con el detalle.
      cuerpo = resultados.map((r, i) => `
        <div class="ls-item${i === resaltado ? ' ls-item-active' : ''}" data-i="${i}" role="option">
          <div class="ls-item-top">
            <span class="ls-item-label">${esc(r.label)}</span>
            ${r.etiqueta ? `<span class="ls-item-tag">${esc(r.etiqueta)}</span>` : ''}
          </div>
          ${r.sub ? `<span class="ls-item-sub">${esc(r.sub)}</span>` : ''}
        </div>`).join('');
    } else {
      cuerpo = '<div class="ls-empty">Sin coincidencias.</div>';
    }

    // "Usar lo escrito" solo aparece si lo tecleado no es ya un resultado:
    // si no, se ofrecería crear un duplicado de algo que existe.
    const yaEstá = resultados.some(r => r.label.toLowerCase() === query.toLowerCase());
    const libre = (permitirLibre && query && !yaEstá && !cargando)
      ? `<div class="ls-item ls-item-free" data-libre="1" role="option">
           <div class="ls-item-top"><span class="ls-item-label">${esc(textoLibre)}: “${esc(query)}”</span></div>
         </div>`
      : '';

    pop.innerHTML = avisoConexion + cuerpo + libre;
    pop.querySelectorAll('[data-i]').forEach(el =>
      // `mousedown` y no `click`: el click llega después del blur del input,
      // que ya habría cerrado el desplegable.
      el.addEventListener('mousedown', (e) => { e.preventDefault(); elegir(resultados[Number(el.dataset.i)]); }));
    pop.querySelector('[data-libre]')?.addEventListener('mousedown', (e) => {
      e.preventDefault();
      elegir({ id: '', label: query, item: null });
    });
    positionAnchored(pop, input.closest('.ls-field') || input);
  }

  const lanzarBusqueda = debounce(async (query) => {
    const mia = ++corrida;
    cargando = true;
    pintar();
    let salida;
    try {
      salida = await buscar(query);
    } catch {
      salida = { resultados: [] }; // que falle la búsqueda no debe romper el formulario
    }
    if (mia !== corrida) return; // llegó tarde: ya hay una búsqueda más nueva
    const normalizada = Array.isArray(salida) ? { resultados: salida } : (salida || { resultados: [] });
    resultados = normalizada.resultados || [];
    omitidasPorConexion = normalizada.omitidasPorConexion || 0;
    resaltado = -1;
    cargando = false;
    pintar();
  }, 250);

  input.addEventListener('input', () => {
    actualizarClear();
    // Escribir encima de una selección la deshace: el texto visible y el id
    // guardado no pueden quedar diciendo cosas distintas.
    limpiarSeleccion();
    const query = input.value.trim();
    if (query.length < minChars) {
      lanzarBusqueda.cancel();
      resultados = [];
      cargando = false;
      if (permitirLibre && query) { abrir(); } else { cerrar(); }
      return;
    }
    abrir();
    lanzarBusqueda(query);
  });

  input.addEventListener('focus', () => {
    if (input.value.trim().length >= minChars) { abrir(); lanzarBusqueda(input.value.trim()); }
  });

  input.addEventListener('blur', () => {
    // A diferencia de los modales (que no se cierran al hacer click afuera),
    // un desplegable de sugerencias sí debe irse al salir del campo: es una
    // ayuda momentánea, no una ventana con información que se pueda perder.
    setTimeout(cerrar, 120);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { cerrar(); return; }
    if (abierto?.prefix !== prefix) return;
    const total = resultados.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!total) return;
      resaltado = e.key === 'ArrowDown'
        ? (resaltado + 1) % total
        : (resaltado - 1 + total) % total;
      pintar();
    } else if (e.key === 'Enter') {
      if (resaltado >= 0) { e.preventDefault(); elegir(resultados[resaltado]); }
      else if (permitirLibre && input.value.trim()) { e.preventDefault(); elegir({ id: '', label: input.value.trim() }); }
    }
  });

  clearBtn?.addEventListener('click', () => {
    input.value = '';
    hidden.value = '';
    resultados = [];
    actualizarClear();
    cerrar();
    onSelect?.(null);
    input.focus();
  });

  actualizarClear();
}

/** Carga un valor ya guardado (edición). */
export function fillLiveSearch(prefix, sel) {
  const input = document.getElementById(`${prefix}-input`);
  const hidden = document.getElementById(`${prefix}-id`);
  if (!input || !hidden) return;
  input.value = sel?.label || '';
  hidden.value = sel?.id || '';
  document.getElementById(`${prefix}-clear`)?.classList.toggle('hidden', !input.value);
}

/**
 * Estado actual del campo.
 * `id` es el elegido de la lista (vacío si se escribió algo libre) y `texto`
 * es lo que se ve escrito — quien guarda decide cuál de los dos necesita.
 */
export function readLiveSearch(prefix) {
  const texto = document.getElementById(`${prefix}-input`)?.value.trim() || '';
  const id = document.getElementById(`${prefix}-id`)?.value || '';
  return { id, label: texto, texto };
}
