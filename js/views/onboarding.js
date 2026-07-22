/* ============================================================
   Bolsillo · views/onboarding.js
   Primer arranque: bienvenida → sueldo → cuentas → gastos fijos → listo.

   Se muestra solo si no hay sueldo de empleado y el usuario no lo ha
   completado/saltado antes (config.onboardingCompletado). Es saltable
   en todo momento y relanzable desde Ajustes.
   ============================================================ */

import { getAll, put, getConfig, saveConfig } from '../db.js';
import { crearIngreso, crearRecurrente, actualizar } from '../model.js';
import { parseCOP, formatCOP } from '../money.js';
import { bindMontosVivos } from '../money-input.js';
import { catalogoVisible } from '../categories.js';
import { toast } from '../toast.js';
import { esc } from '../html.js';

const CUENTAS_SUGERIDAS = ['Efectivo', 'Nequi', 'Bancolombia'];
const TOTAL_PASOS = 5;

const IC = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18 9 12l6-6"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg>',
  escudo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5c0 4.4-3 8-7 10-4-2-7-5.6-7-10V6l7-3Z"/><path d="m9 12 2 2 4-4"/></svg>',
  fiesta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20 9 8l7 7-12 5Z"/><path d="M14 4.5c1 .5 1.4 1.6 1 2.6M18 3c1.6.8 2.3 2.6 1.7 4.2M17 10.5c1 .5 2.2.1 2.7-.9"/></svg>',
};

/** ¿Debe mostrarse el onboarding? PURA. */
export function debeMostrarse(config, ingresos = []) {
  if (config && config.onboardingCompletado === true) return false;
  const tieneSueldo = Array.isArray(ingresos) && ingresos.some((i) => i && i.fuente === 'empleo');
  return !tieneSueldo;
}

/**
 * Abre el onboarding a pantalla completa.
 * @param {{onDone?: () => void, forzado?: boolean}} [opts]
 */
export async function abrirOnboarding({ onDone, forzado = false } = {}) {
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let config, ingresos, recurrentes;
  try {
    [config, ingresos, recurrentes] = await Promise.all([getConfig(), getAll('ingresos'), getAll('recurrentes')]);
  } catch (err) {
    console.warn('[Bolsillo] no se pudo abrir la guía de inicio:', err);
    return;
  }
  if (!forzado && !debeMostrarse(config, ingresos)) return;

  // Estado local del flujo (se persiste paso a paso, no al final).
  const st = {
    paso: 0,
    empleo: ingresos.find((i) => i && i.fuente === 'empleo') || null,
    cuentas: Array.isArray(config.cuentas) && config.cuentas.length ? config.cuentas.slice() : CUENTAS_SUGERIDAS.slice(),
    fijos: recurrentes.slice(),
    agregandoCuenta: false,
    agregandoFijo: false,
    fijoEsVar: false, // segmented del alta de fijo: false=exacto, true=valor variable
  };

  /* ---- montaje ---- */
  const raiz = document.createElement('div');
  raiz.className = 'ob';
  raiz.setAttribute('role', 'dialog');
  raiz.setAttribute('aria-modal', 'true');
  raiz.setAttribute('aria-label', 'Guía de inicio de Bolsillo');
  document.body.appendChild(raiz);
  document.body.dataset.ob = 'open';
  void raiz.offsetWidth;
  raiz.classList.add('is-open');

  function cerrar() {
    raiz.classList.remove('is-open');
    delete document.body.dataset.ob;
    const quitar = () => raiz.remove();
    if (prefersReduced) quitar();
    else { raiz.addEventListener('transitionend', quitar, { once: true }); setTimeout(quitar, 400); }
  }

  async function terminar() {
    try {
      await saveConfig({ cuentas: st.cuentas, onboardingCompletado: true });
    } catch (err) {
      console.warn('[Bolsillo] no se pudo marcar la guía como completada:', err);
    }
    cerrar();
    if (typeof onDone === 'function') onDone();
  }

  const ir = (n) => { st.paso = n; pintar(); };

  /* ---- pasos ---- */
  function pasoBienvenida() {
    return {
      html: `
        <span class="ob__ic">${IC.escudo}</span>
        <h1 class="ob__title">Tu bolsillo, en calma</h1>
        <p class="ob__text">Bolsillo te dice, de un vistazo, si vas bien con tu plata este mes. Sin cuentas, sin banco conectado, sin publicidad.</p>
        <ul class="ob__bullets">
          <li>Tus datos viven <strong>solo en tu iPhone</strong>.</li>
          <li>Funciona sin internet.</li>
          <li>Tú decides cuándo hacer un respaldo.</li>
        </ul>
        <div class="ob__actions">
          <button type="button" class="btn btn--primary btn--block" data-act="siguiente">Empecemos</button>
          <button type="button" class="ob__skip" data-act="saltar">Configurar después</button>
        </div>`,
      bind() {},
    };
  }

  function pasoSueldo() {
    const valor = st.empleo ? formatCOP(st.empleo.monto).replace('$', '') : '';
    const dia = st.empleo && st.empleo.diaDelMes ? st.empleo.diaDelMes : '';
    return {
      html: `
        <h1 class="ob__title">¿Cuánto te entra al mes?</h1>
        <p class="ob__text">Tu sueldo de empleado es la base del semáforo. Es el único dato imprescindible.</p>
        <label class="field">
          <span class="field__label">Sueldo mensual</span>
          <input class="field__input ob__input" id="ob-sueldo" type="text" data-monto inputmode="numeric"
            autocomplete="off" placeholder="3.000.000" value="${esc(valor)}" />
        </label>
        <label class="field">
          <span class="field__label">Día de pago</span>
          <input class="field__input" id="ob-dia" type="number" min="1" max="31" inputmode="numeric"
            placeholder="30" value="${esc(dia)}" />
        </label>
        <div class="ob__actions">
          <button type="button" class="btn btn--primary btn--block" data-act="siguiente">Continuar</button>
          <button type="button" class="ob__skip" data-act="saltar">Configurar después</button>
        </div>`,
      bind(cont) {
        const input = cont.querySelector('#ob-sueldo');
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); avanzar(); } });
        requestAnimationFrame(() => input.focus());
      },
    };
  }

  function pasoCuentas() {
    const chips = st.cuentas.map((c) => `
      <span class="ob__chip">
        <span>${esc(c)}</span>
        <button type="button" class="ob__chip-x" data-quitar="${esc(c)}" aria-label="Quitar ${esc(c)}">${IC.x}</button>
      </span>`).join('');

    const alta = st.agregandoCuenta
      ? `<div class="cfg-inline">
           <input type="text" class="field__input" id="ob-cuenta" placeholder="Nombre de la cuenta" autocomplete="off" />
           <button type="button" class="btn btn--primary btn--sm" data-act="add-cuenta">Agregar</button>
         </div>`
      : `<button type="button" class="ob__add" data-act="nueva-cuenta">${IC.plus}<span>Agregar otra</span></button>`;

    return {
      html: `
        <h1 class="ob__title">¿Dónde tienes tu plata?</h1>
        <p class="ob__text">Estas son las cuentas que usarás al registrar un gasto. Quita las que no uses.</p>
        <div class="ob__chips">${chips || '<p class="cfg-empty">Sin cuentas: agrega al menos una.</p>'}</div>
        ${alta}
        <div class="ob__actions">
          <button type="button" class="btn btn--primary btn--block" data-act="siguiente">Continuar</button>
        </div>`,
      bind(cont) {
        cont.querySelectorAll('[data-quitar]').forEach((b) => {
          b.addEventListener('click', () => {
            st.cuentas = st.cuentas.filter((c) => c !== b.dataset.quitar);
            pintar();
          });
        });
        const nueva = cont.querySelector('[data-act="nueva-cuenta"]');
        if (nueva) nueva.addEventListener('click', () => { st.agregandoCuenta = true; pintar(); });

        const add = cont.querySelector('[data-act="add-cuenta"]');
        const input = cont.querySelector('#ob-cuenta');
        if (add) add.addEventListener('click', agregarCuenta);
        if (input) {
          input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); agregarCuenta(); } });
          requestAnimationFrame(() => input.focus());
        }

        function agregarCuenta() {
          const nombre = (input.value || '').trim();
          if (!nombre) { st.agregandoCuenta = false; pintar(); return; }
          if (st.cuentas.some((c) => c.toLowerCase() === nombre.toLowerCase())) { toast('Esa cuenta ya está'); return; }
          st.cuentas = [...st.cuentas, nombre];
          st.agregandoCuenta = false;
          pintar();
        }
      },
    };
  }

  function pasoFijos() {
    const lista = st.fijos.length
      ? `<div class="ob__chips">${st.fijos.map((f) => {
        const val = f.esVariable
          ? (Number.isInteger(f.montoEstimado) ? '≈ ' + formatCOP(f.montoEstimado) : 'variable')
          : formatCOP(f.monto);
        return `<span class="ob__chip ob__chip--dato">${esc(f.nombre)} · <span class="num">${esc(val)}</span></span>`;
      }).join('')}</div>`
      : '';

    const cats = catalogoVisible().map((c) => `<option value="${esc(c.id)}"${c.id === 'vivienda' ? ' selected' : ''}>${esc(c.label)}</option>`).join('');
    const esVar = st.fijoEsVar;

    const form = st.agregandoFijo
      ? `<div class="ob__form">
           <label class="field">
             <span class="field__label">Nombre</span>
             <input class="field__input" id="ob-fijo-nombre" type="text" placeholder="${esVar ? 'Luz' : 'Arriendo'}" autocomplete="off" />
           </label>
           <div class="field">
             <span class="field__label">¿Su valor es siempre igual o cambia?</span>
             <div class="seg" role="tablist" id="ob-fijo-seg" aria-label="Tipo de valor del gasto fijo">
               <button type="button" class="seg__opt${esVar ? '' : ' is-on'}" role="tab" aria-selected="${!esVar}" data-var="0">Fijo exacto</button>
               <button type="button" class="seg__opt${esVar ? ' is-on' : ''}" role="tab" aria-selected="${esVar}" data-var="1">Valor variable</button>
             </div>
           </div>
           <div class="field field--split">
             <label class="field__col">
               <span class="field__label" id="ob-fijo-monto-label">${esVar ? '¿Cuánto suele ser? (opcional)' : 'Monto'}</span>
               <input class="field__input" id="ob-fijo-monto" type="text" data-monto inputmode="numeric" placeholder="${esVar ? 'Opcional' : '1.800.000'}" autocomplete="off" />
             </label>
             <label class="field__col">
               <span class="field__label">Día</span>
               <input class="field__input" id="ob-fijo-dia" type="number" min="1" max="31" inputmode="numeric" placeholder="5" />
             </label>
           </div>
           <label class="field">
             <span class="field__label">Categoría</span>
             <select class="field__input field__select" id="ob-fijo-cat">${cats}</select>
           </label>
           <button type="button" class="btn btn--ghost btn--block cfg-cta" data-act="add-fijo">Agregar gasto fijo</button>
         </div>`
      : `<button type="button" class="ob__add" data-act="nuevo-fijo">${IC.plus}<span>Agregar un gasto fijo</span></button>`;

    return {
      html: `
        <h1 class="ob__title">¿Qué pagas <em>sí o sí</em> cada mes?</h1>
        <p class="ob__text">Tu checklist de gastos fijos: arriendo, colegio, seguros, suscripciones… y también los que cambian de valor (luz, agua, gasolina, celular). Bolsillo los tiene en cuenta al calcular lo que te queda.</p>
        <p class="ob__text ob__text--sm">Si el monto es siempre igual, ponlo. Si cambia cada mes, márcalo como <strong>valor variable</strong> y Bolsillo te preguntará el valor real cada mes. Este paso es opcional, puedes saltarlo.</p>
        ${lista}
        ${form}
        <div class="ob__actions">
          <button type="button" class="btn btn--primary btn--block" data-act="siguiente">
            ${st.fijos.length ? 'Continuar' : 'Lo hago después'}
          </button>
        </div>`,
      bind(cont) {
        const nuevo = cont.querySelector('[data-act="nuevo-fijo"]');
        if (nuevo) nuevo.addEventListener('click', () => { st.agregandoFijo = true; st.fijoEsVar = false; pintar(); });

        // segmented Fijo exacto / Valor variable (muta el DOM sin re-pintar para no
        // perder lo tecleado en nombre/día).
        const seg = cont.querySelector('#ob-fijo-seg');
        if (seg) seg.querySelectorAll('.seg__opt').forEach((opt) => {
          opt.addEventListener('click', () => {
            const quiereVar = opt.dataset.var === '1';
            if (quiereVar === st.fijoEsVar) return;
            st.fijoEsVar = quiereVar;
            seg.querySelectorAll('.seg__opt').forEach((o) => {
              const on = o === opt;
              o.classList.toggle('is-on', on);
              o.setAttribute('aria-selected', String(on));
            });
            cont.querySelector('#ob-fijo-monto-label').textContent = quiereVar ? '¿Cuánto suele ser? (opcional)' : 'Monto';
            cont.querySelector('#ob-fijo-monto').placeholder = quiereVar ? 'Opcional' : '1.800.000';
          });
        });

        const add = cont.querySelector('[data-act="add-fijo"]');
        if (add) add.addEventListener('click', async () => {
          const nombre = (cont.querySelector('#ob-fijo-nombre').value || '').trim();
          const montoCampo = parseCOP(cont.querySelector('#ob-fijo-monto').value);
          const dia = parseInt(cont.querySelector('#ob-fijo-dia').value, 10);
          const esVariable = st.fijoEsVar;
          if (!nombre) { toast('Escribe un nombre'); return; }
          // Exacto: monto obligatorio. Variable: opcional (solo referencia).
          if (!esVariable && (!Number.isInteger(montoCampo) || montoCampo <= 0)) { toast('Escribe un monto válido'); return; }
          if (!Number.isInteger(dia) || dia < 1 || dia > 31) { toast('El día debe estar entre 1 y 31'); return; }
          const cuenta = st.cuentas[0];
          if (!cuenta) { toast('Necesitas al menos una cuenta'); return; }

          try {
            const rec = crearRecurrente({
              nombre, diaDelMes: dia,
              esVariable,
              monto: esVariable ? null : montoCampo,
              montoEstimado: esVariable ? montoCampo : null,
              categoria: cont.querySelector('#ob-fijo-cat').value,
              cuenta, modo: 'confirmar', activo: true,
            });
            await put('recurrentes', rec);
            st.fijos = [...st.fijos, rec];
            st.agregandoFijo = false;
            st.fijoEsVar = false;
            toast('Gasto fijo agregado');
            pintar();
          } catch (err) {
            toast('No se pudo agregar: ' + err.message, { icono: false, ms: 3200 });
          }
        });

        const primero = cont.querySelector('#ob-fijo-nombre');
        if (primero) requestAnimationFrame(() => primero.focus());
      },
    };
  }

  function pasoListo() {
    const sueldo = st.empleo ? formatCOP(st.empleo.monto) : '—';
    const fijos = st.fijos.filter((f) => f.activo).reduce((s, f) => s + (f.monto || 0), 0);
    return {
      html: `
        <span class="ob__ic ob__ic--ok">${IC.fiesta}</span>
        <h1 class="ob__title">Listo, ya puedes empezar</h1>
        <p class="ob__text">Con esto el semáforo ya sabe calcular tu ritmo del mes.</p>
        <div class="ob__resumen">
          <div class="ob__resumen-row"><span>Sueldo</span><strong class="num">${esc(sueldo)}</strong></div>
          <div class="ob__resumen-row"><span>Cuentas</span><strong>${esc(String(st.cuentas.length))}</strong></div>
          <div class="ob__resumen-row"><span>Gastos fijos</span><strong class="num">${esc(fijos ? formatCOP(fijos) : 'Ninguno')}</strong></div>
        </div>
        <p class="ob__text ob__text--sm">Toca el botón <strong>+</strong> para registrar tu primer gasto. Todo lo demás lo cambias en Ajustes.</p>
        <div class="ob__actions">
          <button type="button" class="btn btn--primary btn--block" data-act="terminar">Ir a mi bolsillo</button>
        </div>`,
      bind() {},
    };
  }

  const PASOS = [pasoBienvenida, pasoSueldo, pasoCuentas, pasoFijos, pasoListo];

  /* ---- avanzar (con persistencia del paso actual) ---- */
  async function avanzar() {
    if (st.paso === 1) {
      const cont = raiz.querySelector('.ob__step');
      const monto = parseCOP(cont.querySelector('#ob-sueldo').value);
      if (!Number.isInteger(monto) || monto <= 0) {
        toast('Escribe tu sueldo para continuar');
        cont.querySelector('#ob-sueldo').focus();
        return;
      }
      let dia = parseInt(cont.querySelector('#ob-dia').value, 10);
      if (!Number.isInteger(dia) || dia < 1 || dia > 31) dia = (st.empleo && st.empleo.diaDelMes) || 30;
      try {
        const ingreso = st.empleo
          ? actualizar(st.empleo, { monto, diaDelMes: dia })
          : crearIngreso({ fuente: 'empleo', monto, diaDelMes: dia });
        await put('ingresos', ingreso);
        st.empleo = ingreso;
      } catch (err) {
        toast('No se pudo guardar el sueldo: ' + err.message, { icono: false, ms: 3200 });
        return;
      }
    }

    if (st.paso === 2) {
      if (!st.cuentas.length) { toast('Agrega al menos una cuenta'); return; }
      try {
        await saveConfig({ cuentas: st.cuentas });
      } catch (err) {
        toast('No se pudieron guardar las cuentas: ' + err.message, { icono: false });
        return;
      }
    }

    ir(Math.min(st.paso + 1, TOTAL_PASOS - 1));
  }

  /* ---- pintado ---- */
  function pintar() {
    const { html, bind } = PASOS[st.paso]();
    const puntos = Array.from({ length: TOTAL_PASOS }, (_, i) =>
      `<span class="ob__dot${i === st.paso ? ' is-on' : ''}${i < st.paso ? ' is-done' : ''}"></span>`).join('');

    raiz.innerHTML = `
      <div class="ob__bar">
        ${st.paso > 0 && st.paso < TOTAL_PASOS - 1
    ? `<button type="button" class="icon-btn ob__back" data-act="atras" aria-label="Volver">${IC.back}</button>`
    : '<span class="ob__back-spacer"></span>'}
        <div class="ob__dots" role="progressbar" aria-valuenow="${st.paso + 1}" aria-valuemin="1"
          aria-valuemax="${TOTAL_PASOS}" aria-label="Paso ${st.paso + 1} de ${TOTAL_PASOS}">${puntos}</div>
        <span class="ob__back-spacer"></span>
      </div>
      <div class="ob__scroll"><div class="ob__step">${html}</div></div>`;

    const cont = raiz.querySelector('.ob__step');
    if (!prefersReduced) {
      requestAnimationFrame(() => cont.classList.add('is-in'));
    } else {
      cont.classList.add('is-in');
    }

    const atras = raiz.querySelector('[data-act="atras"]');
    if (atras) atras.addEventListener('click', () => ir(Math.max(0, st.paso - 1)));

    const sig = raiz.querySelector('[data-act="siguiente"]');
    if (sig) sig.addEventListener('click', avanzar);

    const fin = raiz.querySelector('[data-act="terminar"]');
    if (fin) fin.addEventListener('click', terminar);

    raiz.querySelectorAll('[data-act="saltar"]').forEach((b) => b.addEventListener('click', terminar));

    // Máscara de miles: cubre el sueldo (paso 1) y el gasto fijo (paso 3).
    bindMontosVivos(cont);
    if (typeof bind === 'function') bind(cont);
  }

  pintar();
}
