/* ============================================================
   Bolsillo · overlay.js
   Diálogos ligeros (confirmar / menú de acciones) como bottom-sheet.
   Independiente del sheet de Registrar. Promesas. Sin estilos inline.
   Cierra con scrim, Escape o botón. Devuelve el valor elegido.
   ============================================================ */

const ICON_X =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg>';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (m) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]
));

function montar(contenidoHTML, onBind) {
  return new Promise((resolve) => {
    const scrim = document.createElement('div');
    scrim.className = 'ov-scrim';
    const panel = document.createElement('div');
    panel.className = 'ov-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.innerHTML = contenidoHTML;
    scrim.appendChild(panel);
    document.body.appendChild(scrim);

    void scrim.offsetWidth;
    scrim.classList.add('is-open');

    let cerrado = false;
    const cerrar = (valor) => {
      if (cerrado) return;
      cerrado = true;
      scrim.classList.remove('is-open');
      document.removeEventListener('keydown', onKey);
      const quitar = () => scrim.remove();
      panel.addEventListener('transitionend', quitar, { once: true });
      setTimeout(quitar, 320);
      resolve(valor);
    };
    const onKey = (e) => { if (e.key === 'Escape') cerrar(undefined); };
    document.addEventListener('keydown', onKey);
    scrim.addEventListener('click', (e) => { if (e.target === scrim) cerrar(undefined); });

    onBind(panel, cerrar);
  });
}

/**
 * Hoja inferior genérica (bottom-sheet) con contenido a medida.
 * Reusa el mismo scrim/panel/Escape que confirmar y menu.
 * @param {string} contenidoHTML
 * @param {(panel:HTMLElement, cerrar:(v?:any)=>void)=>void} onBind
 * @returns {Promise<any>} el valor con que se cerró
 */
export function hoja(contenidoHTML, onBind) {
  return montar(contenidoHTML, onBind);
}

/**
 * Diálogo de confirmación. Resuelve true/false.
 * @param {{title:string, text?:string, okText?:string, cancelText?:string, danger?:boolean}} o
 */
export function confirmar({ title, text = '', okText = 'Confirmar', cancelText = 'Cancelar', danger = false } = {}) {
  const html = `
    <div class="ov-grip" aria-hidden="true"></div>
    <h3 class="ov-title">${esc(title)}</h3>
    ${text ? `<p class="ov-text">${esc(text)}</p>` : ''}
    <div class="ov-actions">
      <button type="button" class="btn btn--ghost btn--block" data-ov="cancel">${esc(cancelText)}</button>
      <button type="button" class="btn ${danger ? 'btn--danger' : 'btn--primary'} btn--block" data-ov="ok">${esc(okText)}</button>
    </div>`;
  return montar(html, (panel, cerrar) => {
    panel.querySelector('[data-ov="ok"]').addEventListener('click', () => cerrar(true));
    panel.querySelector('[data-ov="cancel"]').addEventListener('click', () => cerrar(false));
  });
}

/**
 * Menú de acciones. items: [{value, label, icon?, danger?}]. Resuelve el value elegido (o undefined).
 * @param {{title?:string, items:Array}} o
 */
export function menu({ title = '', items = [] } = {}) {
  const filas = items.map((it) => `
    <button type="button" class="ov-item${it.danger ? ' ov-item--danger' : ''}" data-val="${esc(it.value)}">
      ${it.icon ? `<span class="ov-item__ic">${it.icon}</span>` : ''}
      <span class="ov-item__label">${esc(it.label)}</span>
    </button>`).join('');
  const html = `
    <div class="ov-grip" aria-hidden="true"></div>
    <button type="button" class="icon-btn ov-close" data-ov="close" aria-label="Cerrar">${ICON_X}</button>
    ${title ? `<h3 class="ov-title ov-title--menu">${esc(title)}</h3>` : ''}
    <div class="ov-list">${filas}</div>`;
  return montar(html, (panel, cerrar) => {
    panel.querySelector('[data-ov="close"]').addEventListener('click', () => cerrar(undefined));
    panel.querySelectorAll('[data-val]').forEach((b) => {
      b.addEventListener('click', () => cerrar(b.dataset.val));
    });
  });
}
