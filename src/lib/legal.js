/**
 * Aviso médico y de privacidad (P2 #12). SaludFamilia es una herramienta
 * personal para organizar información médica familiar, no un producto
 * comercial con una entidad legal detrás — el texto se mantiene simple y
 * honesto en vez de simular un aviso corporativo que no corresponde.
 *
 * Se muestra tanto desde la pantalla de login (#auth-screen, z-index 1000)
 * como desde dentro de la app ya autenticada (vista Familia). Por eso NO
 * reutiliza el modal genérico (#overlay, z-index 500): reusarlo dejaría el
 * aviso invisible detrás de #auth-screen antes de iniciar sesión. Es un
 * overlay propio y autocontenido, con z-index por encima de ambos
 * contextos, igual en espíritu a src/lib/viewer.js.
 */

const LEGAL_HTML = `
  <p><strong>Esto no es atención médica.</strong>
  SaludFamilia es una herramienta para organizar y llevar el registro de
  la historia clínica de tu familia — no reemplaza el criterio ni la
  atención de un profesional de la salud. Ninguna información que
  guardes o veas acá constituye diagnóstico ni recomendación médica.
  Ante cualquier síntoma, duda o urgencia, consulta a tu médico o a los
  servicios de emergencia de tu ciudad.</p>

  <p><strong>Dónde vive tu información.</strong>
  Los datos de cada familia (pacientes, órdenes, medicamentos, signos
  vitales, adjuntos) se guardan en una base de datos privada (Supabase),
  aislada por grupo familiar: solo las personas que forman parte de tu
  familia dentro de la app pueden verlos. Los archivos adjuntos (fotos,
  PDFs) viven en un bucket de almacenamiento privado con las mismas
  reglas de acceso.</p>

  <p><strong>Tu control sobre los datos.</strong>
  Podés exportar la información de cualquier paciente en cualquier
  momento como un archivo cifrado con una contraseña que vos elegís
  (sección Familia → Exportar/Importar). Si querés eliminar información,
  podés borrarla directamente desde cada módulo (pacientes, órdenes,
  medicamentos, etc.).</p>

  <p class="legal-fineprint">Este es un proyecto personal, no un producto
  comercial con una entidad legal registrada — este aviso es una
  explicación simple y directa de cómo funciona, no un contrato.</p>
`;

let activeClose = null;

export function showLegalModal() {
  activeClose?.();

  const root = document.createElement('div');
  root.className = 'legal-overlay';
  root.innerHTML = `
    <div class="legal-card">
      <div class="legal-hd">
        <h2>Aviso médico y de privacidad</h2>
        <button type="button" class="modal-close" id="legal-close-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="legal-body">${LEGAL_HTML}</div>
      <div class="legal-ft"><button type="button" class="btn btn-primary" id="legal-ok-btn">Cerrar</button></div>
    </div>`;
  document.body.appendChild(root);

  function close() {
    document.removeEventListener('keydown', onKeydown);
    root.remove();
    activeClose = null;
  }
  function onKeydown(e) { if (e.key === 'Escape') close(); }

  activeClose = close;
  document.addEventListener('keydown', onKeydown);
  root.querySelector('#legal-close-btn').addEventListener('click', close);
  root.querySelector('#legal-ok-btn').addEventListener('click', close);
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
}
