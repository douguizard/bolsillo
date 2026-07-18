/* ============================================================
   Bolsillo · views/dashboard.js  (vista HOY, funcional)
   Lee db → corre calcularEstado → pinta el semáforo del mes.
   El anillo se llena según el RITMO (no el bruto): gastar 90% el
   día 28 va bien; 80% el día 10 es alerta. Marca de "avance" para
   ver si vas por delante o por detrás del calendario.
   Anima solo el llenado (stroke-dashoffset) y ancho de barras;
   honra prefers-reduced-motion. Sin config → estado vacío + CTA.
   ============================================================ */

import { getAll, getConfig } from '../db.js';
import { calcularEstado } from '../budget.js';
import { formatCOP } from '../money.js';
import { categoriaPorId } from '../categories.js';
import { abrirSueldo } from './sueldo-sheet.js';

const R = 42;
const CIRC = 2 * Math.PI * R; // circunferencia del aro
const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const ICON_WALLET =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5A2.5 2.5 0 0 1 5.5 6H18a2 2 0 0 1 2 2v1"/><path d="M3 8.5V17a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2"/><path d="M21 11h-4a2 2 0 0 0 0 4h4a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1Z"/></svg>';
const ICON_DOWN =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="m6 13 6 6 6-6"/></svg>';
const ICON_UP =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="m6 11 6-6 6 6"/></svg>';
const ICON_PIN =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21v-4l7-7"/><path d="m14 4 6 6-4 1-3 3-3-3 3-3 1-4Z"/></svg>';

const CLASE_MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (m) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]
  ));
}

function pct(frac) {
  if (frac == null || !Number.isFinite(frac)) return '—';
  return Math.round(frac * 100) + '%';
}

function greetHTML() {
  const hoy = new Date();
  const mes = CLASE_MES[hoy.getMonth()];
  return `
    <header class="view-greet">
      <p class="view-greet__eyebrow">Tu bolsillo · ${mes}.</p>
      <h1 class="view-greet__title">Hoy</h1>
    </header>`;
}

/* ---- estado vacío (sin sueldo configurado) ---- */
function sinConfigHTML() {
  return `
    <section class="card gauge-card" aria-labelledby="gauge-hint">
      <div class="gauge" role="img" aria-label="Balance del mes sin configurar">
        <svg class="gauge__svg" viewBox="0 0 100 100" aria-hidden="true">
          <circle class="gauge__track" cx="50" cy="50" r="42"></circle>
          <circle class="gauge__arc" cx="50" cy="50" r="42"></circle>
        </svg>
        <div class="gauge__center">
          <span class="gauge__hint" id="gauge-hint">Balance del mes</span>
          <span class="gauge__value gauge__value--muted num">—</span>
          <span class="gauge__caption">Configura tu sueldo para empezar</span>
        </div>
      </div>
      <div class="legend" aria-hidden="true">
        <span class="legend__item"><span class="legend__dot legend__dot--verde"></span>Vas bien</span>
        <span class="legend__item"><span class="legend__dot legend__dot--ambar"></span>Cuidado</span>
        <span class="legend__item"><span class="legend__dot legend__dot--rojo"></span>Alerta</span>
      </div>
      <button class="btn btn--primary btn--block" id="cta-sueldo" type="button">
        ${ICON_WALLET} Configurar mi sueldo
      </button>
    </section>`;
}

/* ---- anillo + estado (configurado) ---- */
function gaugeCardHTML(e) {
  const projClase = e.color === 'verde' ? '' : ` gauge-proj--${e.color}`;
  return `
    <section class="card gauge-card">
      <div class="gauge gauge--${e.color}" role="img"
        aria-label="Llevas ${pct(e.porcentajeIngreso)} de tu sueldo gastado. Estado: ${esc(e.etiqueta)}.">
        <svg class="gauge__svg" viewBox="0 0 100 100" aria-hidden="true">
          <circle class="gauge__track" cx="50" cy="50" r="42"></circle>
          <circle class="gauge__arc gauge__arc--fill" cx="50" cy="50" r="42"></circle>
          <circle class="gauge__tick" cx="50" cy="8" r="3"></circle>
        </svg>
        <div class="gauge__center">
          <span class="gauge__hint">Del sueldo</span>
          <span class="gauge__value gauge__value--pct num">${pct(e.porcentajeIngreso)}</span>
          <span class="gauge__caption">${esc(e.mensaje)}</span>
        </div>
      </div>

      <span class="pill pill--${e.color} gauge-state"><span class="pill__dot"></span>${esc(e.etiqueta)}</span>

      <p class="gauge-proj${projClase}">
        Vas a cerrar el mes en <strong class="num">${formatCOP(e.proyeccionTotal)}</strong>
      </p>
    </section>`;
}

function statRowHTML(e) {
  const disp = e.disponibleRestante;
  const dispClase = disp != null && disp < 0 ? ' stat__value--neg' : '';
  return `
    <div class="stat-row">
      <div class="card stat">
        <span class="stat__label">${ICON_DOWN} Disponible</span>
        <span class="stat__value${dispClase} num">${formatCOP(disp)}</span>
        <span class="stat__sub num">${formatCOP(e.disponiblePorDia)} por día</span>
      </div>
      <div class="card stat">
        <span class="stat__label">${ICON_UP} Gastado</span>
        <span class="stat__value num">${formatCOP(e.variableGastado)}</span>
        <span class="stat__sub">variable este mes</span>
      </div>
    </div>`;
}

function fijosCardHTML(e) {
  return `
    <div class="card fijos-card">
      <div>
        <span class="fijos-card__label">Fijos del mes</span>
        <span class="fijos-card__hint">No entran al ritmo variable</span>
      </div>
      <span class="fijos-card__val num">${formatCOP(e.fijosDelMes)}</span>
    </div>`;
}

function categoriasHTML(e) {
  if (!e.porCategoria.length) return '';
  const top = e.porCategoria.slice(0, 5);
  const maxTotal = top[0].total || 1;
  const filas = top.map((c) => {
    const cat = categoriaPorId(c.categoriaId);
    const w = Math.max(4, Math.round((c.total / maxTotal) * 100));
    return `
      <div class="catbar ${cat.cls}">
        <span class="catbar__ic">${cat.icon}</span>
        <div class="catbar__body">
          <span class="catbar__label">${esc(cat.label)}</span>
          <span class="catbar__track"><span class="catbar__fill" data-w="${w}"></span></span>
        </div>
        <span class="catbar__amt num">${formatCOP(c.total)}</span>
      </div>`;
  }).join('');
  return `
    <div class="cat-break">
      <div class="section-head"><span class="section-head__title">En qué se va</span></div>
      <div class="catbar-list">${filas}</div>
    </div>`;
}

function hormigaHTML(e) {
  if (!e.totalHormiga) return '';
  return `
    <div class="hormiga-note">
      <span class="hormiga-note__ic">${categoriaPorId('hormiga').icon}</span>
      <span class="hormiga-note__txt">Gasto hormiga del mes</span>
      <span class="hormiga-note__val num">${formatCOP(e.totalHormiga)}</span>
    </div>`;
}

function contenidoHTML(e) {
  return gaugeCardHTML(e) + statRowHTML(e) + fijosCardHTML(e) + categoriasHTML(e) + hormigaHTML(e)
    // (Próximas cuotas de crédito → T8; ingresos de negocios → T5.)
    + '';
}

/* ---- animaciones (solo transform/opacity/stroke-dashoffset/width) ---- */
function animarAnillo(body, e) {
  const arc = body.querySelector('.gauge__arc--fill');
  if (arc) {
    let fill;
    if (e.fijosSuperanIngreso) fill = 1;
    else if (e.ritmo == null) fill = 0;
    else fill = Math.max(0, Math.min(1, e.ritmo)); // clamp visual a 1
    const target = String(CIRC * (1 - fill));
    arc.style.strokeDasharray = String(CIRC);
    if (prefersReduced) {
      arc.style.strokeDashoffset = target;
    } else {
      arc.style.strokeDashoffset = String(CIRC); // arranca vacío
      void arc.getBoundingClientRect();           // fuerza reflow
      requestAnimationFrame(() => { arc.style.strokeDashoffset = target; });
    }
  }

  // marca de avance: dónde "deberías ir" según el día del mes.
  const tick = body.querySelector('.gauge__tick');
  if (tick && Number.isFinite(e.avance)) {
    const ang = e.avance * 2 * Math.PI; // 0 = arriba (svg rotado -90)
    tick.setAttribute('cx', String(50 + R * Math.cos(ang)));
    tick.setAttribute('cy', String(50 + R * Math.sin(ang)));
  }
}

function aplicarBarras(body) {
  body.querySelectorAll('.catbar__fill').forEach((fill) => {
    const w = fill.dataset.w || '0';
    if (prefersReduced) { fill.style.width = w + '%'; return; }
    requestAnimationFrame(() => { fill.style.width = w + '%'; });
  });
}

/* ---- carga + pintado (async, tolerante a cambios de ruta) ---- */
async function pintar(root) {
  const body = root.querySelector('#hoy-body');
  if (!body) return;

  let estado;
  try {
    const [ingresos, movimientos, recurrentes, config] = await Promise.all([
      getAll('ingresos'), getAll('movimientos'), getAll('recurrentes'), getConfig(),
    ]);
    const empleo = ingresos.find((i) => i && i.fuente === 'empleo');
    estado = calcularEstado({
      ingresoEmpleo: empleo ? empleo.monto : 0,
      movimientos, recurrentes, hoy: new Date(), config,
    });
  } catch (err) {
    console.warn('[Bolsillo] no se pudo calcular el estado de Hoy:', err);
    body.innerHTML = '<p class="hoy-error">No se pudieron cargar tus datos. Reintenta.</p>';
    return;
  }

  if (!root.isConnected) return; // el usuario ya cambió de vista

  if (!estado.configurado) {
    body.innerHTML = sinConfigHTML();
    const cta = body.querySelector('#cta-sueldo');
    if (cta) cta.addEventListener('click', () => abrirSueldo({ onSaved: () => pintar(root) }));
    return;
  }

  body.innerHTML = contenidoHTML(estado);
  animarAnillo(body, estado);
  aplicarBarras(body);
}

export default {
  label: 'Hoy',

  render() {
    return `${greetHTML()}<div class="hoy-body" id="hoy-body"><div class="hoy-skeleton" aria-hidden="true"></div></div>`;
  },

  mount(root) {
    pintar(root); // async, no bloquea el primer render
  },
};
