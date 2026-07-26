/**
 * Posicionamiento de ventanas flotantes ancladas a un elemento (el
 * calendario de rango de fechas y el desplegable de resultados de las
 * búsquedas en vivo).
 *
 * Ambas viven en `document.body` con `position: fixed`, no dentro del
 * formulario: los modales de la app tienen `overflow-y: auto`, así que un
 * hijo posicionado en absoluto se cortaría al llegar al borde del modal.
 */

/**
 * Coloca `pop` justo debajo de `anchor`, corrigiendo si se sale de la
 * pantalla: se pega al borde derecho si no cabe a lo ancho, y salta arriba
 * del ancla si no cabe abajo.
 */
export function positionAnchored(pop, anchor, { gap = 6, margin = 12 } = {}) {
  const rect = anchor.getBoundingClientRect();
  const ancho = pop.offsetWidth;
  const alto = pop.offsetHeight;

  let left = rect.left;
  if (left + ancho > window.innerWidth - margin) {
    left = Math.max(margin, window.innerWidth - ancho - margin);
  }
  pop.style.left = `${left}px`;

  const cabeAbajo = rect.bottom + alto + gap <= window.innerHeight;
  pop.style.top = cabeAbajo
    ? `${rect.bottom + gap}px`
    : `${Math.max(margin, rect.top - alto - gap)}px`;
}

/**
 * Mantiene una ventana flotante pegada a su ancla mientras la pantalla se
 * mueve. Devuelve la función para dejar de seguirla.
 *
 * El scroll se escucha en captura porque puede venir de un contenedor
 * interno (el cuerpo del modal), no solo de la ventana.
 */
export function followAnchor(pop, anchor, opts) {
  const reposicionar = () => positionAnchored(pop, anchor, opts);
  window.addEventListener('scroll', reposicionar, true);
  window.addEventListener('resize', reposicionar);
  return () => {
    window.removeEventListener('scroll', reposicionar, true);
    window.removeEventListener('resize', reposicionar);
  };
}
