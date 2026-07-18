/* ============================================================
   Bolsillo · views/sueldo-sheet.js
   Formulario MÍNIMO del sueldo (lo que el semáforo necesita ya).
   Bottom-sheet que reusa overlay.js. Crea/actualiza de forma
   inmutable el ingreso {fuente:'empleo'} y, opcional, los umbrales.
   El resto de Ajustes (cuentas, categorías, créditos, API) es T5.
   ============================================================ */

import { hoja } from '../overlay.js';
import { getAll, put, getConfig, saveConfig } from '../db.js';
import { crearIngreso } from '../model.js';
import { parseCOP, formatCOP } from '../money.js';
import { toast } from '../toast.js';

const ICON_WALLET =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5A2.5 2.5 0 0 1 5.5 6H18a2 2 0 0 1 2 2v1"/><path d="M3 8.5V17a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2"/><path d="M21 11h-4a2 2 0 0 0 0 4h4a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1Z"/></svg>';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (m) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]
));

function formularioHTML({ montoStr, dia, hormigaStr, amarillo }) {
  return `
    <div class="ov-grip" aria-hidden="true"></div>
    <div class="sueldo-head">
      <span class="sueldo-head__ic">${ICON_WALLET}</span>
      <div>
        <h3 class="ov-title">Tu sueldo de empleado</h3>
        <p class="sueldo-hint">Es la base del semáforo. Tus datos no salen del dispositivo.</p>
      </div>
    </div>

    <form class="sueldo-form" id="sueldo-form" novalidate>
      <label class="field">
        <span class="field__label">Sueldo mensual</span>
        <input class="field__input" id="sueldo-monto" type="text" inputmode="numeric"
          autocomplete="off" placeholder="3.000.000" value="${esc(montoStr)}" />
      </label>

      <label class="field">
        <span class="field__label">Día de pago (opcional)</span>
        <input class="field__input" id="sueldo-dia" type="number" min="1" max="31"
          inputmode="numeric" placeholder="Ej. 30" value="${esc(dia)}" />
      </label>

      <button type="button" class="detalles-toggle" id="sueldo-adv-toggle" aria-expanded="false">
        <span>Ajustes finos del semáforo</span>
        <span class="detalles-toggle__chev">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
        </span>
      </button>

      <div class="sueldo-adv" id="sueldo-adv" hidden>
        <label class="field">
          <span class="field__label">Umbral gasto hormiga</span>
          <input class="field__input" id="sueldo-hormiga" type="text" inputmode="numeric"
            autocomplete="off" placeholder="20.000" value="${esc(hormigaStr)}" />
          <span class="sueldo-hint">Gastos variables por debajo de este monto se marcan como “hormiga”.</span>
        </label>
        <label class="field">
          <span class="field__label">Sensibilidad de alerta (${esc(amarillo)}×)</span>
          <input class="field__input" id="sueldo-amarillo" type="number" min="1.05" max="2" step="0.05"
            inputmode="decimal" placeholder="1.25" value="${esc(amarillo)}" />
          <span class="sueldo-hint">Qué tan rápido pasa de ámbar a rojo. Más bajo = más estricto.</span>
        </label>
      </div>

      <button type="submit" class="btn btn--primary btn--block btn--save" id="sueldo-guardar">
        Guardar sueldo
      </button>
    </form>`;
}

/**
 * Abre el bottom-sheet del sueldo. Precarga los valores actuales.
 * @param {{onSaved?: () => void}} [opts]
 */
export async function abrirSueldo({ onSaved } = {}) {
  let ingresos = [];
  let config = {};
  try {
    [ingresos, config] = await Promise.all([getAll('ingresos'), getConfig()]);
  } catch (err) {
    console.warn('[Bolsillo] no se pudo leer el sueldo actual:', err);
    toast('No se pudo abrir la configuración');
    return;
  }

  const empleo = ingresos.find((i) => i && i.fuente === 'empleo') || null;
  const amarilloActual = (config.umbralesSemaforo && config.umbralesSemaforo.amarillo) || 1.25;

  const html = formularioHTML({
    montoStr: empleo ? formatCOP(empleo.monto).replace('$', '') : '',
    dia: empleo && empleo.diaDelMes ? empleo.diaDelMes : '',
    hormigaStr: Number.isInteger(config.umbralHormiga) ? formatCOP(config.umbralHormiga).replace('$', '') : '',
    amarillo: amarilloActual,
  });

  hoja(html, (panel, cerrar) => {
    const $ = (sel) => panel.querySelector(sel);
    const form = $('#sueldo-form');
    const advToggle = $('#sueldo-adv-toggle');
    const adv = $('#sueldo-adv');

    advToggle.addEventListener('click', () => {
      const abierto = !adv.hidden;
      adv.hidden = abierto;
      advToggle.classList.toggle('is-open', !abierto);
      advToggle.setAttribute('aria-expanded', String(!abierto));
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const monto = parseCOP($('#sueldo-monto').value);
      if (!Number.isInteger(monto) || monto <= 0) {
        toast('Escribe un sueldo válido');
        $('#sueldo-monto').focus();
        return;
      }

      // día de pago: opcional; si no es válido, conserva el previo o usa 1.
      let dia = parseInt($('#sueldo-dia').value, 10);
      if (!Number.isInteger(dia) || dia < 1 || dia > 31) dia = (empleo && empleo.diaDelMes) || 1;

      try {
        // crea o ACTUALIZA de forma inmutable (preserva id si ya existía).
        const ingreso = crearIngreso({ fuente: 'empleo', monto, diaDelMes: dia, id: empleo ? empleo.id : undefined });
        await put('ingresos', ingreso);

        // config opcional (umbral hormiga + sensibilidad del semáforo).
        const patch = {};
        const hormiga = parseCOP($('#sueldo-hormiga').value);
        if (Number.isInteger(hormiga) && hormiga >= 0) patch.umbralHormiga = hormiga;
        const amarillo = parseFloat($('#sueldo-amarillo').value);
        if (Number.isFinite(amarillo) && amarillo > 1) patch.umbralesSemaforo = { amarillo };
        if (Object.keys(patch).length) await saveConfig(patch);

        cerrar(true);
        toast('Sueldo guardado');
        if (typeof onSaved === 'function') onSaved();
      } catch (err) {
        console.warn('[Bolsillo] guardar sueldo falló:', err);
        toast('No se pudo guardar');
      }
    });

    // foco inicial en el monto para captura rápida.
    requestAnimationFrame(() => $('#sueldo-monto').focus());
  });
}
