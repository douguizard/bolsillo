/* ============================================================
   Bolsillo · app.js
   Bootstrap: navegación por hash entre vistas, FAB/sheet,
   siembra de cuentas, materialización de recurrentes y SW.
   ============================================================ */

import dashboard from './views/dashboard.js';
import movimientos from './views/movimientos.js';
import creditos from './views/creditos.js';
import asesor from './views/asesor.js';
import ajustes from './views/ajustes.js';
import registrar from './views/registrar.js';
import { abrirSueldo } from './views/sueldo-sheet.js';
import { openDB, getConfig, saveConfig, getAll, bulkPut } from './db.js';
import { materializarMes } from './recurring.js';

const CUENTAS_SEMILLA = ['Efectivo', 'Nequi', 'Bancolombia'];

const ROUTES = {
  hoy: dashboard,
  movimientos,
  creditos,
  asesor,
  ajustes,
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

/* ---- header: engrane abre el sueldo (lo mínimo de Ajustes en T4) ---- */
function initHeader() {
  const settingsBtn = document.getElementById('open-ajustes');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      abrirSueldo({ onSaved: () => refreshActive('hoy') });
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
  const cfg = await getConfig();
  if (!Array.isArray(cfg.cuentas) || cfg.cuentas.length === 0) {
    await saveConfig({ cuentas: CUENTAS_SEMILLA });
  }
  await correrRecurrentes();
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
    try { await bulkPut('movimientos', pendientes); refreshActive('movimientos'); } catch (err) { console.warn('[Bolsillo] confirmar recurrentes:', err); }
    quitar();
  });
  b.querySelector('[data-b="no"]').addEventListener('click', quitar);
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
