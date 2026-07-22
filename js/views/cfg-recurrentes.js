/* ============================================================
   Bolsillo · views/cfg-recurrentes.js
   Gastos fijos (recurrentes): alta / edición / borrado
   + EXCEPCIONES del mes en curso (saltar o monto distinto).

   Las excepciones se escriben en recurrente.excepciones["YYYY-MM"];
   recurring.js y budget.js ya las respetan.
   ============================================================ */

import { getAll, put, del, getConfig } from '../db.js';
import { crearRecurrente, actualizar } from '../model.js';
import { parseCOP, formatCOP } from '../money.js';
import { catalogoVisible, categoriaPorId } from '../categories.js';
import { confirmar } from '../overlay.js';
import { toast } from '../toast.js';
import { esc } from '../html.js';
import {
  hojaNav, cabecera, bindCabecera, filaCfg, vacioCfg, notaCfg,
  botonAgregar, leerMonto, leerDia, mesActual, mesLegible,
} from './cfg-sheet.js';

/**
 * Abre la hoja de gastos fijos.
 * @param {{onSaved?: () => void}} [opts]
 */
export async function abrirRecurrentes({ onSaved } = {}) {
  let recurrentes = [];
  let cuentas = [];

  async function recargar() {
    const [recs, cfg] = await Promise.all([getAll('recurrentes'), getConfig()]);
    recurrentes = recs.slice().sort((a, b) => (a.diaDelMes || 0) - (b.diaDelMes || 0));
    cuentas = Array.isArray(cfg.cuentas) ? cfg.cuentas : [];
  }

  try {
    await recargar();
  } catch (err) {
    console.warn('[Bolsillo] no se pudieron leer los gastos fijos:', err);
    toast('No se pudieron cargar tus gastos fijos');
    return;
  }

  const avisar = () => { if (typeof onSaved === 'function') onSaved(); };

  return hojaNav((api) => {
    /* ---- lista ---- */
    function pantallaLista() {
      const mes = mesActual();
      const filas = recurrentes.length
        ? recurrentes.map((r) => {
          const exc = r.excepciones && r.excepciones[mes];
          let meta = `Día ${r.diaDelMes} · ${categoriaPorId(r.categoria).label}`;
          if (r.esVariable) meta += ' · valor variable';
          if (!r.activo) meta += ' · pausado';
          else if (exc && exc.saltar === true) meta += ' · saltado este mes';
          else if (exc && Number.isInteger(exc.monto)) meta += ` · este mes ${formatCOP(exc.monto)}`;
          // Un variable no tiene monto fijo: muestra su estimado (≈) o "Variable".
          const valor = r.esVariable
            ? (Number.isInteger(r.montoEstimado) ? '≈ ' + formatCOP(r.montoEstimado) : 'Variable')
            : formatCOP(r.monto);
          return filaCfg({ id: r.id, titulo: r.nombre, meta, valor, accion: 'editar' });
        }).join('')
        : vacioCfg('Aún no registras gastos fijos (arriendo, colegio, seguros…).');

      const total = recurrentes
        .filter((r) => r.activo)
        .reduce((s, r) => s + (r.monto || 0), 0);

      const html = `
        ${cabecera('Gastos fijos', {
    sub: recurrentes.length ? `Comprometido al mes: <strong class="num">${esc(formatCOP(total))}</strong>` : '',
  })}
        <div class="cfg-list">${filas}</div>
        ${botonAgregar('Agregar gasto fijo')}`;

      api.pintar(html, (panel) => {
        bindCabecera(panel, { cerrar: () => api.cerrar() });
        panel.querySelectorAll('[data-act="editar"]').forEach((b) => {
          b.addEventListener('click', () => {
            const r = recurrentes.find((x) => x.id === b.dataset.id);
            if (r) pantallaForm(r);
          });
        });
        panel.querySelector('[data-act="nuevo"]').addEventListener('click', () => pantallaForm(null));
      });
    }

    /* ---- formulario ---- */
    function pantallaForm(rec) {
      const esNuevo = !rec;
      const mes = mesActual();
      const exc = (rec && rec.excepciones && rec.excepciones[mes]) || null;
      const saltado = !!(exc && exc.saltar === true);
      const montoMes = exc && Number.isInteger(exc.monto) ? exc.monto : null;
      const esVar = !!(rec && rec.esVariable);
      // El campo monto muestra el estimado si es variable, o el monto si es exacto.
      const montoInicial = esVar ? (rec ? rec.montoEstimado : null) : (rec ? rec.monto : null);

      const cats = catalogoVisible().map((c) => `
        <option value="${esc(c.id)}"${rec && rec.categoria === c.id ? ' selected' : ''}>${esc(c.label)}</option>`).join('');
      const cuentasOpt = cuentas.map((c) => `
        <option value="${esc(c)}"${rec && rec.cuenta === c ? ' selected' : ''}>${esc(c)}</option>`).join('');

      const html = `
        ${cabecera(esNuevo ? 'Nuevo gasto fijo' : 'Editar gasto fijo', { atras: true })}
        <form class="sueldo-form" id="rec-form" novalidate>
          <label class="field">
            <span class="field__label">Nombre</span>
            <input class="field__input" id="rec-nombre" type="text" autocomplete="off"
              placeholder="Arriendo" value="${esc(rec ? rec.nombre : '')}" />
          </label>
          <div class="field">
            <span class="field__label">¿Su valor es siempre igual o cambia?</span>
            <div class="seg" role="tablist" id="rec-tipo-seg" aria-label="Tipo de valor del gasto fijo">
              <button type="button" class="seg__opt${esVar ? '' : ' is-on'}" role="tab"
                aria-selected="${!esVar}" data-var="0">Fijo exacto</button>
              <button type="button" class="seg__opt${esVar ? ' is-on' : ''}" role="tab"
                aria-selected="${esVar}" data-var="1">Valor variable</button>
            </div>
            <span class="sueldo-hint" id="rec-tipo-hint">${esVar
    ? 'Su monto cambia cada mes (luz, agua, gasolina…). Bolsillo te preguntará el valor real cada mes.'
    : 'Su monto es siempre el mismo (arriendo, colegio, seguros…).'}</span>
          </div>
          <div class="field field--split">
            <label class="field__col">
              <span class="field__label" id="rec-monto-label">${esVar ? '¿Cuánto suele ser? (opcional)' : 'Monto'}</span>
              <input class="field__input" id="rec-monto" type="text" data-monto inputmode="numeric" autocomplete="off"
                placeholder="${esVar ? 'Opcional' : '1.800.000'}" value="${esc(montoInicial != null ? formatCOP(montoInicial).replace('$', '') : '')}" />
            </label>
            <label class="field__col">
              <span class="field__label">Día del mes</span>
              <input class="field__input" id="rec-dia" type="number" min="1" max="31" inputmode="numeric"
                placeholder="5" value="${esc(rec ? rec.diaDelMes : '')}" />
            </label>
          </div>
          <label class="field">
            <span class="field__label">Categoría</span>
            <select class="field__input field__select" id="rec-categoria">${cats}</select>
          </label>
          <label class="field">
            <span class="field__label">Cuenta</span>
            <select class="field__input field__select" id="rec-cuenta">${cuentasOpt}</select>
          </label>
          <label class="field" id="rec-modo-wrap"${esVar ? ' hidden' : ''}>
            <span class="field__label">Cómo registrarlo</span>
            <select class="field__input field__select" id="rec-modo">
              <option value="confirmar"${!rec || rec.modo === 'confirmar' ? ' selected' : ''}>Preguntarme cada mes</option>
              <option value="auto"${rec && rec.modo === 'auto' ? ' selected' : ''}>Registrarlo automáticamente</option>
            </select>
          </label>
          <label class="field toggle-row">
            <span class="field__label">Activo</span>
            <span class="switch${!rec || rec.activo ? ' is-on' : ''}" role="switch"
              aria-checked="${!rec || rec.activo}" tabindex="0" data-act="activo"><span class="switch__dot"></span></span>
          </label>

          ${esNuevo ? '' : `
          <div class="cfg-sep"></div>
          <p class="field__label field__label--section">Solo por ${esc(mesLegible())}</p>
          <label class="field toggle-row">
            <span class="field__label">Saltar este mes</span>
            <span class="switch${saltado ? ' is-on' : ''}" role="switch"
              aria-checked="${saltado}" tabindex="0" data-act="saltar"><span class="switch__dot"></span></span>
          </label>
          <label class="field" id="rec-exc-monto-wrap"${saltado ? ' hidden' : ''}>
            <span class="field__label">Monto distinto este mes (opcional)</span>
            <input class="field__input" id="rec-exc-monto" type="text" data-monto inputmode="numeric" autocomplete="off"
              placeholder="Déjalo vacío para usar el de siempre" value="${esc(montoMes != null ? formatCOP(montoMes).replace('$', '') : '')}" />
            <span class="sueldo-hint">Aplica únicamente a ${esc(mesLegible())}; los demás meses siguen igual.</span>
          </label>`}

          <button type="submit" class="btn btn--primary btn--block btn--save">Guardar</button>
          ${esNuevo ? '' : '<button type="button" class="btn btn--danger btn--block cfg-danger" data-act="borrar">Eliminar gasto fijo</button>'}
        </form>`;

      api.pintar(html, (panel) => {
        bindCabecera(panel, { atras: pantallaLista, cerrar: () => api.cerrar() });

        // segmented Fijo exacto / Valor variable: cambia si el monto es obligatorio.
        let esVariable = esVar;
        const seg = panel.querySelector('#rec-tipo-seg');
        seg.querySelectorAll('.seg__opt').forEach((opt) => {
          opt.addEventListener('click', () => {
            const quiereVar = opt.dataset.var === '1';
            if (quiereVar === esVariable) return;
            esVariable = quiereVar;
            seg.querySelectorAll('.seg__opt').forEach((o) => {
              const on = o === opt;
              o.classList.toggle('is-on', on);
              o.setAttribute('aria-selected', String(on));
            });
            panel.querySelector('#rec-monto-label').textContent = esVariable ? '¿Cuánto suele ser? (opcional)' : 'Monto';
            const inp = panel.querySelector('#rec-monto');
            inp.placeholder = esVariable ? 'Opcional' : '1.800.000';
            panel.querySelector('#rec-tipo-hint').textContent = esVariable
              ? 'Su monto cambia cada mes (luz, agua, gasolina…). Bolsillo te preguntará el valor real cada mes.'
              : 'Su monto es siempre el mismo (arriendo, colegio, seguros…).';
            // El modo "auto/preguntar" no aplica a los variables (siempre preguntan).
            const modoWrap = panel.querySelector('#rec-modo-wrap');
            if (modoWrap) modoWrap.hidden = esVariable;
          });
        });

        // switches (activo / saltar este mes)
        panel.querySelectorAll('.switch[data-act]').forEach((sw) => {
          const alternar = () => {
            const on = !sw.classList.contains('is-on');
            sw.classList.toggle('is-on', on);
            sw.setAttribute('aria-checked', String(on));
            if (sw.dataset.act === 'saltar') {
              const wrap = panel.querySelector('#rec-exc-monto-wrap');
              if (wrap) wrap.hidden = on; // saltar y "monto distinto" son excluyentes
            }
          };
          sw.addEventListener('click', alternar);
          sw.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); alternar(); }
          });
        });

        panel.querySelector('#rec-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const nombre = panel.querySelector('#rec-nombre').value.trim();
          if (!nombre) { toast('Escribe un nombre'); panel.querySelector('#rec-nombre').focus(); return; }
          // Exacto: el monto es obligatorio. Variable: es solo referencia (opcional).
          const montoCampo = leerMonto(panel, '#rec-monto', parseCOP);
          if (!esVariable && montoCampo == null) { toast('Escribe un monto válido'); panel.querySelector('#rec-monto').focus(); return; }
          const dia = leerDia(panel, '#rec-dia');
          if (dia == null) { toast('El día debe estar entre 1 y 31'); panel.querySelector('#rec-dia').focus(); return; }
          const cuenta = panel.querySelector('#rec-cuenta').value;
          if (!cuenta) { toast('Necesitas al menos una cuenta. Créala en Ajustes → Cuentas.', { icono: false, ms: 3600 }); return; }

          const activo = panel.querySelector('.switch[data-act="activo"]').classList.contains('is-on');
          const campos = {
            nombre,
            esVariable,
            // exacto: el monto; variable: sin monto fijo (no reserva).
            monto: esVariable ? null : montoCampo,
            // variable: el campo es el estimado de referencia (opcional).
            montoEstimado: esVariable ? montoCampo : null,
            diaDelMes: dia,
            categoria: panel.querySelector('#rec-categoria').value,
            cuenta,
            // El modo no aplica a variables (siempre preguntan): forzamos 'confirmar'.
            modo: esVariable ? 'confirmar' : panel.querySelector('#rec-modo').value,
            activo,
          };

          try {
            let guardado;
            if (esNuevo) {
              guardado = crearRecurrente(campos);
            } else {
              // excepciones del mes en curso (copia inmutable del mapa)
              const excepciones = { ...(rec.excepciones || {}) };
              const swSaltar = panel.querySelector('.switch[data-act="saltar"]');
              const quiereSaltar = swSaltar && swSaltar.classList.contains('is-on');
              const montoExc = parseCOP(panel.querySelector('#rec-exc-monto').value);
              if (quiereSaltar) {
                excepciones[mes] = { saltar: true };
              } else if (Number.isInteger(montoExc) && montoExc > 0) {
                excepciones[mes] = { monto: montoExc };
              } else {
                delete excepciones[mes];
              }
              guardado = actualizar(rec, { ...campos, excepciones });
            }
            await put('recurrentes', guardado);
            await recargar();
            toast(esNuevo ? 'Gasto fijo agregado' : 'Gasto fijo actualizado');
            avisar();
            pantallaLista();
          } catch (err) {
            toast('No se pudo guardar: ' + err.message, { icono: false, ms: 3200 });
          }
        });

        const borrar = panel.querySelector('[data-act="borrar"]');
        if (borrar) borrar.addEventListener('click', async () => {
          const detalle = rec.esVariable
            ? (Number.isInteger(rec.montoEstimado) ? '≈ ' + formatCOP(rec.montoEstimado) : 'valor variable')
            : formatCOP(rec.monto);
          const ok = await confirmar({
            title: '¿Eliminar este gasto fijo?',
            text: `${rec.nombre} · ${detalle}. Los movimientos ya registrados no se borran.`,
            okText: 'Eliminar', danger: true,
          });
          if (!ok) return;
          try {
            await del('recurrentes', rec.id);
            await recargar();
            toast('Gasto fijo eliminado');
            avisar();
            pantallaLista();
          } catch (err) {
            toast('No se pudo eliminar: ' + err.message, { icono: false });
          }
        });

        requestAnimationFrame(() => panel.querySelector('#rec-nombre').focus());
      });
    }

    pantallaLista();
  });
}
