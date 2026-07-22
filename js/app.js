/* ============================================================
   Bolsillo · app.js
   Bootstrap: navegación por hash entre vistas, FAB/sheet,
   siembra de cuentas, materialización de recurrentes y SW.
   ============================================================ */

import dashboard from './views/dashboard.js';
import movimientos from './views/movimientos.js';
import ajustes from './views/ajustes.js';
import registrar from './views/registrar.js';
// Ocultas en el piloto (se re-agregan a ROUTES + tab bar cuando estén listas):
// import creditos from './views/creditos.js';  // CRUD real vive en Ajustes → Créditos
// import asesor from './views/asesor.js';       // chat IA, llega en otra tanda
import { abrirOnboarding, debeMostrarse } from './views/onboarding.js';
import { openDB, getConfig, saveConfig, getAll, bulkPut } from './db.js';
import { materializarMes } from './recurring.js';
import { migrarIngresos, ingresoNecesitaMigracion, crearMovimiento } from './model.js';
import { aplicarPersonalizacion } from './categories.js';
import { parseCOP, formatCOP } from './money.js';
import { bindMontosVivos } from './money-input.js';
import { hoja } from './overlay.js';
import { esc } from './html.js';

const CUENTAS_SEMILLA = ['Efectivo', 'Nequi', 'Bancolombia'];

const ROUTES = {
  hoy: dashboard,
  movimientos,
  ajustes,
  // creditos, asesor: ocultas en el piloto. Sin entrada aquí, sus hashes
  // (#/creditos, #/asesor) caen a DEFAULT_ROUTE en routeFromHash() → nunca rompen.
};

const DEFAULT_ROUTE = 'hoy';
const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const stage = document.getElementById('view-stage');
const tabbar = document.getElementById('tabbar');

let currentRoute = null;

/* ---- routing ---- */
function routeFromHash() {
  const raw = (location.hash || '').replace(/^#\/?/, '').trim();
  return ROUTES[raw] ? raw : DEFAULT_ROUTE;
}

function buildView(routeId) {
  const mod = ROUTES[routeId];
  const el = document.createElement('section');
  el.className = 'view';
  el.dataset.route = routeId;
  el.setAttribute('role', 'tabpanel');
  el.setAttribute('aria-label', mod.label || routeId);

  const inner = document.createElement('div');
  inner.className = 'view-inner';
  inner.innerHTML = mod.render();
  el.appendChild(inner);

  if (typeof mod.mount === 'function') mod.mount(inner);
  return el;
}

function navigate(routeId, { replace = false } = {}) {
  if (routeId === currentRoute) return;

  const incoming = buildView(routeId);
  const outgoing = stage.querySelector('.view.is-active');

  // entra desde abajo
  incoming.classList.add('is-entering');
  stage.appendChild(incoming);

  // reflow para asegurar la transición
  void incoming.offsetWidth;

  incoming.classList.remove('is-entering');
  incoming.classList.add('is-active');
  incoming.scrollTop = 0;

  if (outgoing) {
    outgoing.classList.remove('is-active');
    outgoing.classList.add('is-leaving');
    const cleanup = () => outgoing.remove();
    if (prefersReduced) {
      cleanup();
    } else {
      outgoing.addEventListener('transitionend', cleanup, { once: true });
      // salvaguarda por si no dispara transitionend
      setTimeout(cleanup, 500);
    }
  }

  currentRoute = routeId;
  syncTabbar(routeId);

  if (replace) {
    history.replaceState(null, '', '#/' + routeId);
  }
  document.title = 'Bolsillo · ' + (ROUTES[routeId].label || routeId);
}

function syncTabbar(routeId) {
  tabbar.querySelectorAll('.tab').forEach((tab) => {
    const active = tab.dataset.route === routeId;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-current', active ? 'page' : 'false');
  });
}

/* Re-renderiza en sitio la vista activa (tras guardar/borrar/materializar). */
function refreshActive(routeId) {
  if (currentRoute !== routeId) return;
  const view = stage.querySelector('.view.is-active');
  const inner = view && view.querySelector('.view-inner');
  const mod = ROUTES[routeId];
  if (!inner || !mod) return;
  inner.innerHTML = mod.render();
  if (typeof mod.mount === 'function') mod.mount(inner);
}

/* ---- tab bar ---- */
function initTabbar() {
  tabbar.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      location.hash = '#/' + tab.dataset.route;
    });
  });
}

/* ---- header: el engrane lleva a la vista Ajustes completa ---- */
function initHeader() {
  const settingsBtn = document.getElementById('open-ajustes');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      location.hash = '#/ajustes';
    });
  }
}

/* ---- bottom sheet: Registrar ---- */
function initSheet() {
  const scrim = document.getElementById('scrim');
  const sheet = document.getElementById('sheet');
  const fab = document.getElementById('fab');

  sheet.innerHTML = registrar.render();

  const open = () => {
    scrim.classList.add('is-open');
    sheet.classList.add('is-open');
    document.body.dataset.sheet = 'open';
  };
  const close = () => {
    scrim.classList.remove('is-open');
    sheet.classList.remove('is-open');
    delete document.body.dataset.sheet;
  };

  registrar.mount(sheet, { open, close, onSaved: () => refreshActive(currentRoute) });

  fab.addEventListener('click', () => registrar.abrir());
  scrim.addEventListener('click', () => registrar.cerrar());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sheet.classList.contains('is-open')) registrar.cerrar();
  });
}

/* ---- datos: siembra de cuentas + materialización de recurrentes ---- */
const ICON_BANG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8v5"/><circle cx="12" cy="16.5" r="1" fill="currentColor" stroke="none"/></svg>';

async function initData() {
  await openDB();
  let cfg = await getConfig();
  if (!Array.isArray(cfg.cuentas) || cfg.cuentas.length === 0) {
    cfg = await saveConfig({ cuentas: CUENTAS_SEMILLA });
  }

  // Migración retrocompatible de fuentes de ingreso (negocio1/negocio2 → negocio
  // con nombre legible). Idempotente: solo escribe si hay slots viejos.
  await migrarIngresosSiHace();

  // El catálogo de categorías refleja los renombres y las categorías propias.
  const personalizado = (cfg.categoriasPersonalizadas || []).length > 0
    || Object.keys(cfg.categoriasRenombradas || {}).length > 0;
  aplicarPersonalizacion(cfg);
  if (personalizado) refreshActive(currentRoute); // repinta con las etiquetas del usuario

  // Primer arranque: guía de inicio antes que nada.
  const ingresos = await getAll('ingresos');
  if (debeMostrarse(cfg, ingresos)) {
    abrirOnboarding({
      onDone: () => {
        refreshActive('hoy');
        correrRecurrentes().catch((err) => console.warn('[Bolsillo] recurrentes:', err));
      },
    });
    return; // no materializamos por debajo de la guía
  }

  await correrRecurrentes();
}

/* Migra solo las fuentes viejas (idempotente): no reescribe empleo ni las ya
   nuevas, así una recarga no vuelve a tocar los datos reales de el usuario. */
async function migrarIngresosSiHace() {
  try {
    const ingresos = await getAll('ingresos');
    const pendientes = ingresos.filter(ingresoNecesitaMigracion);
    if (!pendientes.length) return;
    const migrados = migrarIngresos(pendientes);
    await bulkPut('ingresos', migrados);
    console.info(`[Bolsillo] migradas ${migrados.length} fuente(s) de ingreso a la forma nueva.`);
    // La vista de Hoy pudo pintarse antes de migrar: repíntala con los datos nuevos.
    refreshActive(currentRoute);
  } catch (err) {
    console.warn('[Bolsillo] no se pudo migrar ingresos:', err);
  }
}

async function correrRecurrentes() {
  const now = new Date();
  const [recs, movs, cfg] = await Promise.all([
    getAll('recurrentes'), getAll('movimientos'), getConfig(),
  ]);
  const { auto, porConfirmar } = materializarMes(recs, movs, now.getFullYear(), now.getMonth() + 1, now, cfg);
  if (auto.length) {
    await bulkPut('movimientos', auto);
    refreshActive('movimientos');
  }
  if (porConfirmar.length) mostrarBannerConfirmar(porConfirmar);
}

function mostrarBannerConfirmar(pendientes) {
  const prev = document.getElementById('rec-banner');
  if (prev) prev.remove();
  const shell = document.querySelector('.app-shell');
  if (!shell) return;
  const b = document.createElement('div');
  b.id = 'rec-banner';
  b.className = 'rec-banner';
  b.setAttribute('role', 'status');
  b.innerHTML = `
    <span class="rec-banner__ic">${ICON_BANG}</span>
    <p class="rec-banner__msg">Tienes <strong>${pendientes.length}</strong> gasto${pendientes.length > 1 ? 's' : ''} fijo${pendientes.length > 1 ? 's' : ''} por registrar este mes.</p>
    <div class="rec-banner__actions">
      <button type="button" class="btn btn--primary btn--sm" data-b="ok">Registrar</button>
      <button type="button" class="btn btn--ghost btn--sm" data-b="no" aria-label="Ahora no">Ahora no</button>
    </div>`;
  shell.appendChild(b);
  requestAnimationFrame(() => b.classList.add('is-show'));
  const quitar = () => { b.classList.remove('is-show'); setTimeout(() => b.remove(), 300); };
  b.querySelector('[data-b="ok"]').addEventListener('click', async () => {
    quitar();
    await confirmarPendientes(pendientes);
  });
  b.querySelector('[data-b="no"]').addEventListener('click', quitar);
}

/**
 * Confirma la tanda pendiente del mes:
 *  - EXACTOS (movimientos ya armados) → se guardan directo.
 *  - VALOR VARIABLE (solicitudes con pediMonto:true) → se pregunta el valor real
 *    de este mes (pre-llenado con el estimado) y recién ahí se crea el movimiento.
 */
async function confirmarPendientes(pendientes) {
  const directos = pendientes.filter((p) => p.pediMonto !== true);
  const variables = pendientes.filter((p) => p.pediMonto === true);
  try {
    if (directos.length) await bulkPut('movimientos', directos);
    for (const sol of variables) {
      const monto = await pedirMontoVariable(sol);
      if (!Number.isInteger(monto) || monto <= 0) continue; // omitido este mes
      const mov = crearMovimiento({
        fecha: sol.fecha, monto, tipo: 'gasto',
        categoria: sol.categoria || '', comercio: sol.comercio || '',
        cuenta: sol.cuenta, fuente: 'recurrente', esFijo: true,
        recurrenteId: sol.recurrenteId,
      });
      await bulkPut('movimientos', [mov]);
    }
    refreshActive('movimientos');
    refreshActive('hoy');
  } catch (err) {
    console.warn('[Bolsillo] confirmar recurrentes:', err);
  }
}

/**
 * Mini-hoja "¿Cuánto fue [nombre] este mes?" para un fijo de valor variable.
 * Resuelve el entero de pesos tecleado, o null si el usuario lo omite.
 */
function pedirMontoVariable(sol) {
  const nombre = sol.comercio || 'este gasto fijo';
  const sugerido = Number.isInteger(sol.montoEstimado) && sol.montoEstimado > 0
    ? formatCOP(sol.montoEstimado).replace('$', '') : '';
  const html = `
    <div class="ov-grip" aria-hidden="true"></div>
    <h3 class="ov-title">¿Cuánto fue ${esc(nombre)} este mes?</h3>
    <p class="ov-text">Escribe el valor real de este mes. Puedes omitirlo si aún no lo sabes.</p>
    <label class="field">
      <span class="field__label">Monto de este mes</span>
      <input class="field__input" id="rec-var-monto" type="text" data-monto inputmode="numeric"
        autocomplete="off" placeholder="${sugerido ? '' : 'Ej. 120.000'}" value="${esc(sugerido)}" />
    </label>
    <div class="ov-actions">
      <button type="button" class="btn btn--ghost btn--block" data-ov="skip">Omitir</button>
      <button type="button" class="btn btn--primary btn--block" data-ov="save">Guardar</button>
    </div>`;
  return hoja(html, (panel, cerrar) => {
    bindMontosVivos(panel);
    const input = panel.querySelector('#rec-var-monto');
    requestAnimationFrame(() => input && input.focus());
    const guardar = () => {
      const v = parseCOP(input.value);
      cerrar(Number.isInteger(v) && v > 0 ? v : null);
    };
    panel.querySelector('[data-ov="save"]').addEventListener('click', guardar);
    panel.querySelector('[data-ov="skip"]').addEventListener('click', () => cerrar(null));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); guardar(); } });
  });
}

/* ---- Service Worker (ruta relativa, funciona bajo subpath) ---- */
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then(
      (reg) => console.info('[Bolsillo] SW registrado, scope:', reg.scope),
      (err) => console.warn('[Bolsillo] SW no registrado:', err),
    );
  });
}

/* ---- init ---- */
function boot() {
  initTabbar();
  initHeader();
  initSheet();

  window.addEventListener('hashchange', () => navigate(routeFromHash()));

  const start = routeFromHash();
  navigate(start, { replace: true });

  registerSW();

  // datos (async, no bloquea el primer render)
  initData().catch((err) => console.warn('[Bolsillo] initData falló:', err));
}

boot();
