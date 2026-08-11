import { showToast } from './modal.js';
import { liveSearchFieldHtml, wireLiveSearch, fillLiveSearch, readLiveSearch } from './liveSearch.js';
import { buscarMedicos } from './searches.js';
import { wireInlineNewDoctor, copiarMedicoPublico } from './inlineDirectory.js';

/**
 * Campo "médico tratante": buscador en vivo sobre los médicos de la familia y
 * el directorio público, con alta manual en el "+".
 *
 * Estaba escrito dentro de `orders.js` con el prefijo `of-medico` incrustado
 * en siete sitios. Con la consulta como entidad (migración 0035) el campo se
 * necesita en dos formularios distintos, así que el prefijo pasa a ser un
 * parámetro. Es el mismo código, movido.
 */

export function etiquetaMedico(d) {
  return d?.nombre ? d.nombre + (d.especialidad ? ' — ' + d.especialidad : '') : '';
}

export function doctorFieldHtml(prefijo, { label = 'Médico tratante', span = false } = {}) {
  return `
    ${liveSearchFieldHtml(prefijo, {
      label,
      span,
      placeholder: 'Busca por nombre o especialidad…',
      hint: 'Busca entre tus médicos y en el directorio público. Si no está, escríbelo y lo registras.',
      accion: { id: `${prefijo}-add-btn`, title: 'Agregar médico al directorio', label: '+' },
    })}
    <div class="form-field span2 hidden" id="${prefijo}-newform"></div>`;
}

/**
 * Conecta el campo. `onCopiado` recibe el médico recién copiado del directorio
 * público, para que el formulario pueda sumarlo a otros selectores suyos.
 */
export function wireDoctorField(prefijo, { specialties, otherSelectIds = [], onCopiado } = {}) {
  const altaMedico = wireInlineNewDoctor({
    otherSelectIds,
    addBtnId: `${prefijo}-add-btn`,
    formContainerId: `${prefijo}-newform`,
    specialties,
    onSaved: (saved) => fillLiveSearch(prefijo, { id: saved.id, label: etiquetaMedico(saved) }),
  });

  wireLiveSearch(prefijo, {
    buscar: buscarMedicos,
    permitirLibre: true,
    textoLibre: 'Registrar médico nuevo',
    onSelect: (sel) => onSeleccion(sel, prefijo, altaMedico, onCopiado),
  });

  return altaMedico;
}

/**
 * Qué hacer con lo elegido en el buscador — Fase 3.
 *
 * Son tres casos y solo uno es directo, porque la consulta guarda el médico
 * por clave foránea contra la tabla privada del household:
 *
 *  · Médico propio  → el id ya sirve, no hay nada que hacer.
 *  · Del directorio → hay que copiarlo primero al directorio de la familia y
 *                     quedarse con el id de ESA copia, no con el público.
 *  · "Otro"         → no existe en ningún lado: se abre el alta manual con el
 *                     nombre ya escrito, y el campo queda sin selección hasta
 *                     que se guarde (si no, apuntaría a un id vacío).
 */
async function onSeleccion(sel, prefijo, altaMedico, onCopiado) {
  if (!sel) return;

  if (!sel.id) {
    fillLiveSearch(prefijo, { label: sel.label });
    // Si el alta ya estaba abierta, solo se le pasa el nombre: reconstruirla
    // borraría la especialidad y el centro que ya se hubieran elegido.
    const yaAbierta = document.getElementById(`${prefijo}-newform-nombre`);
    if (yaAbierta) yaAbierta.value = sel.label;
    else await altaMedico.abrir(sel.label);
    showToast('Completa los datos del médico para registrarlo', 'warn');
    return;
  }

  if (!sel.id.startsWith('pub:')) return;

  try {
    const { saved, centroVinculado } = await copiarMedicoPublico(sel.item);
    fillLiveSearch(prefijo, { id: saved.id, label: etiquetaMedico(saved) });
    onCopiado?.(saved);
    showToast(centroVinculado
      ? 'Médico copiado a tu directorio (centro vinculado por nombre)'
      : 'Médico copiado a tu directorio');
  } catch (err) {
    // Si la copia falla, se limpia la selección: dejar el nombre visible con un
    // id público guardado haría fallar el guardado más tarde, en un punto donde
    // el error ya no se entendería.
    fillLiveSearch(prefijo, { label: '' });
    showToast(err.message || 'No se pudo copiar el médico a tu directorio', 'err');
  }
}

/**
 * Lee el campo y devuelve un id utilizable, o lanza con un mensaje para el
 * usuario. Centraliza las dos trampas que ya habían mordido antes: un nombre
 * escrito a mano que nunca se registró (queda sin id, y guardar así dejaría el
 * registro sin médico mientras la pantalla muestra un nombre), y un id público
 * todavía sin copiar (la base lo rechazaría con un error incomprensible).
 */
export function leerDoctorField(prefijo) {
  const { id, texto } = readLiveSearch(prefijo);
  if (texto && !id) {
    throw new Error('Registra al médico con el botón + o elígelo de la lista');
  }
  if (id && id.startsWith('pub:')) {
    throw new Error('Espera un momento: se está copiando el médico a tu directorio');
  }
  return id || '';
}

export { fillLiveSearch as fillDoctorField };
