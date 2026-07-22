/* ============================================================
   Bolsillo · views/cfg-creditos.js
   CRUD de créditos. Un crédito es UN PRODUCTO de una entidad, no
   "un banco": una misma entidad puede tener libre inversión + tarjeta +
   vehículo a la vez. Por eso la lista va AGRUPADA por entidad.

   Solo se piden 3 datos: entidad, producto y la cuota de este mes.
   El saldo, la tasa E.A. y el día de pago son OPCIONALES: si no los
   tienes a la mano quedan como "dato pendiente" y los completa la AI
   cuando se le suba el extracto. Antes se exigían por adelantado y
   el único aviso era un toast que en el teléfono no se alcanza a ver.

   La tasa se captura como EA (%) y se muestra la MV derivada con
   tasaEAaMV() en vivo, que es como la cobra el banco cada mes.
   La vista de estrategias de pago (avalancha / bola de nieve) es T8.
   ============================================================ */

import { getAll, put, del } from '../db.js';
import { crearCredito, actualizar, validarCredito, tasaEAaMV } from '../model.js';
import { parseCOP, formatCOP } from '../money.js';
import { confirmar } from '../overlay.js';
import { toast } from '../toast.js';
import { esc } from '../html.js';
import {
  hojaNav, cabecera, bindCabecera, filaCfg, vacioCfg, notaCfg,
  botonAgregar, huecoError, limpiarErrores, pintarErrores, autoLimpiarErrores,
} from './cfg-sheet.js';

/** Alias frecuentes: son atajos para escribir, no una lista cerrada. */
const PRODUCTOS_SUGERIDOS = [
  'Libre inversión', 'Tarjeta de crédito', 'Vehículo', 'Hipotecario', 'Libranza',
];

/** Campos que viven dentro de la sección plegada de "datos del extracto". */
const CAMPOS_OPCIONALES = ['cre-saldo', 'cre-tasa', 'cre-dia'];

const IC_CHEV_ABAJO =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

const PENDIENTE = '—';

/** Formatea una tasa a 2 decimales con coma (es-CO). PURA. */
function fmtTasa(n) {
  return Number.isFinite(n) ? n.toFixed(2).replace('.', ',') : '0,00';
}

/** Nombre del producto. Retrocompat: los créditos viejos lo tenían en `tipo`. */
function productoDe(c, porDefecto = 'Crédito') {
  if (c && typeof c.producto === 'string' && c.producto.trim()) return c.producto.trim();
  if (c && typeof c.tipo === 'string' && c.tipo.trim()) return c.tipo.trim();
  return porDefecto;
}

/** Agrupa por entidad SIN mutar la lista original. PURA. */
function agruparPorEntidad(lista) {
  const mapa = new Map();
  lista.forEach((c) => {
    const clave = (c.entidad || 'Sin entidad').trim() || 'Sin entidad';
    mapa.set(clave, [...(mapa.get(clave) || []), c]);
  });
  return [...mapa.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'));
}

/** Línea secundaria de un producto: deja ver qué falta por completar. */
function metaCredito(c) {
  const partes = [`cuota ${formatCOP(c.cuotaMensual)}`];
  partes.push(c.diaPago != null ? `día ${c.diaPago}` : 'día pendiente');
  if (c.tasaEA == null) partes.push('tasa pendiente');
  return partes.join(' · ');
}

/** ¿A este crédito le falta algún dato del extracto? PURA. */
function tienePendientes(c) {
  return c.saldo == null || c.tasaEA == null || c.diaPago == null;
}

/**
 * Abre la hoja de créditos.
 * @param {{onSaved?: () => void}} [opts]
 */
export async function abrirCreditos({ onSaved } = {}) {
  let creditos = [];

  async function recargar() {
    creditos = await getAll('creditos');
  }

  try {
    await recargar();
  } catch (err) {
    console.warn('[Bolsillo] no se pudieron leer los créditos:', err);
    toast('No se pudieron cargar tus créditos');
    return;
  }

  const avisar = () => { if (typeof onSaved === 'function') onSaved(); };

  return hojaNav((api) => {
    /* ---- lista agrupada por entidad ---- */
    function pantallaLista() {
      const grupos = agruparPorEntidad(creditos);

      const bloques = grupos.map(([entidad, items]) => {
        const cuotaGrupo = items.reduce((s, c) => s + (c.cuotaMensual || 0), 0);
        const filas = items.map((c) => filaCfg({
          id: c.id,
          titulo: productoDe(c),
          meta: metaCredito(c),
          valor: c.saldo != null ? formatCOP(c.saldo) : PENDIENTE,
          accion: 'editar',
        })).join('');

        return `
          <section class="cfg-group">
            <header class="cfg-group__head">
              <h4 class="cfg-group__title">${esc(entidad)}</h4>
              <span class="cfg-group__meta">${items.length === 1 ? '1 producto' : `${items.length} productos`} · <span class="num">${esc(formatCOP(cuotaGrupo))}</span>/mes</span>
            </header>
            <div class="cfg-list">${filas}</div>
          </section>`;
      }).join('');

      const totalCuota = creditos.reduce((s, c) => s + (c.cuotaMensual || 0), 0);
      const conSaldo = creditos.filter((c) => c.saldo != null);
      const totalSaldo = conSaldo.reduce((s, c) => s + c.saldo, 0);

      const sub = creditos.length
        ? `Cuotas <strong class="num">${esc(formatCOP(totalCuota))}</strong>/mes${
          conSaldo.length ? ` · saldo conocido <strong class="num">${esc(formatCOP(totalSaldo))}</strong>` : ''}`
        : 'Registra cada producto que pagas: banco, cuál es y cuánto pagas este mes.';

      const html = `
        ${cabecera('Créditos', { sub })}
        ${creditos.length ? bloques : `<div class="cfg-list">${vacioCfg('Aún no registras créditos.')}</div>`}
        ${creditos.some(tienePendientes)
    ? notaCfg(`Lo que aparece como <strong>${PENDIENTE}</strong> o “pendiente” lo completará la AI cuando le subas el extracto de ese crédito.`)
    : ''}
        ${botonAgregar('Agregar crédito')}`;

      api.pintar(html, (panel) => {
        bindCabecera(panel, { cerrar: () => api.cerrar() });
        panel.querySelectorAll('[data-act="editar"]').forEach((b) => {
          b.addEventListener('click', () => {
            const c = creditos.find((x) => x.id === b.dataset.id);
            if (c) pantallaForm(c);
          });
        });
        panel.querySelector('[data-act="nuevo"]').addEventListener('click', () => pantallaForm(null));
      });
    }

    /* ---- formulario ---- */
    function pantallaForm(cre) {
      const esNuevo = !cre;
      const sugerencias = PRODUCTOS_SUGERIDOS.map((p) => `
        <button type="button" class="acct-chip" data-sugerencia="${esc(p)}">${esc(p)}</button>`).join('');
      // Si el crédito ya trae algún dato del extracto, la sección arranca abierta.
      const abreOpcionales = !!cre && (cre.saldo != null || cre.tasaEA != null || cre.diaPago != null);

      const html = `
        ${cabecera(esNuevo ? 'Nuevo crédito' : 'Editar crédito', { atras: true })}
        <form class="sueldo-form" id="cre-form" novalidate>
          <label class="field">
            <span class="field__label">Entidad</span>
            <input class="field__input" id="cre-entidad" type="text" autocomplete="off"
              placeholder="Ej. Bancolombia" value="${esc(cre ? cre.entidad : '')}" />
            ${huecoError('cre-entidad')}
          </label>

          <label class="field">
            <span class="field__label">Producto</span>
            <input class="field__input" id="cre-producto" type="text" autocomplete="off"
              placeholder="Libre inversión" value="${esc(cre ? productoDe(cre, '') : '')}" />
            ${huecoError('cre-producto')}
            <span class="sueldo-hint">El nombre con el que TÚ lo reconoces. Si tienes varios en el mismo banco, esto los diferencia.</span>
          </label>
          <div class="acct-row acct-row--sug">${sugerencias}</div>

          <label class="field">
            <span class="field__label">Cuota de este mes</span>
            <input class="field__input" id="cre-cuota" type="text" data-monto inputmode="numeric" autocomplete="off"
              placeholder="850.000" value="${esc(cre ? formatCOP(cre.cuotaMensual).replace('$', '') : '')}" />
            ${huecoError('cre-cuota')}
          </label>

          <button type="button" class="detalles-toggle${abreOpcionales ? ' is-open' : ''}"
            id="cre-adv-toggle" aria-expanded="${abreOpcionales}" aria-controls="cre-adv">
            <span>Datos del extracto · opcional</span>
            <span class="detalles-toggle__chev">${IC_CHEV_ABAJO}</span>
          </button>

          <div class="sueldo-adv" id="cre-adv"${abreOpcionales ? '' : ' hidden'}>
            ${notaCfg('Déjalos vacíos si no los tienes a la mano: quedan como <strong>dato pendiente</strong> y la AI los completa cuando le subas el extracto de este crédito.')}
            <label class="field">
              <span class="field__label">Saldo actual</span>
              <input class="field__input" id="cre-saldo" type="text" data-monto inputmode="numeric" autocomplete="off"
                placeholder="Lo completa la AI" value="${esc(cre && cre.saldo != null ? formatCOP(cre.saldo).replace('$', '') : '')}" />
              ${huecoError('cre-saldo')}
            </label>
            <div class="field field--split">
              <label class="field__col">
                <span class="field__label">Tasa E.A. (%)</span>
                <input class="field__input" id="cre-tasa" type="number" min="0" max="100" step="0.01"
                  inputmode="decimal" placeholder="26.5" value="${esc(cre && cre.tasaEA != null ? cre.tasaEA : '')}" />
                ${huecoError('cre-tasa')}
              </label>
              <label class="field__col">
                <span class="field__label">Día de pago</span>
                <input class="field__input" id="cre-dia" type="number" min="1" max="31" inputmode="numeric"
                  placeholder="15" value="${esc(cre && cre.diaPago != null ? cre.diaPago : '')}" />
                ${huecoError('cre-dia')}
              </label>
            </div>
            <p class="cfg-tasa">Mensual vencida equivalente: <strong class="num" id="cre-mv">${
  esc(cre && cre.tasaEA != null ? fmtTasa(tasaEAaMV(cre.tasaEA)) + '%' : PENDIENTE)
}</strong></p>
          </div>

          <button type="submit" class="btn btn--primary btn--block btn--save">Guardar</button>
          ${esNuevo ? '' : '<button type="button" class="btn btn--danger btn--block cfg-danger" data-act="borrar">Eliminar crédito</button>'}
        </form>`;

      api.pintar(html, (panel) => {
        bindCabecera(panel, { atras: pantallaLista, cerrar: () => api.cerrar() });
        autoLimpiarErrores(panel);

        const inputProducto = panel.querySelector('#cre-producto');
        const inputTasa = panel.querySelector('#cre-tasa');
        const salidaMV = panel.querySelector('#cre-mv');
        const avanzados = panel.querySelector('#cre-adv');
        const toggle = panel.querySelector('#cre-adv-toggle');

        function abrirAvanzados(abrir) {
          avanzados.hidden = !abrir;
          toggle.classList.toggle('is-open', abrir);
          toggle.setAttribute('aria-expanded', String(abrir));
        }
        toggle.addEventListener('click', () => abrirAvanzados(avanzados.hidden));

        // Atajos de producto: rellenan el campo, no lo encierran en una lista.
        panel.querySelectorAll('[data-sugerencia]').forEach((chip) => {
          chip.addEventListener('click', () => {
            inputProducto.value = chip.dataset.sugerencia;
            inputProducto.dispatchEvent(new Event('input', { bubbles: true }));
            inputProducto.focus();
          });
        });

        // MV derivada en vivo mientras se escribe la EA.
        inputTasa.addEventListener('input', () => {
          const ea = parseFloat(inputTasa.value);
          salidaMV.textContent = Number.isFinite(ea) ? fmtTasa(tasaEAaMV(ea)) + '%' : PENDIENTE;
        });

        panel.querySelector('#cre-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          limpiarErrores(panel);

          /* --- obligatorios: lo que el usuario sí sabe de memoria --- */
          const errores = [];
          const entidad = panel.querySelector('#cre-entidad').value.trim();
          if (!entidad) errores.push(['cre-entidad', 'Escribe el banco o la entidad.']);

          const producto = inputProducto.value.trim();
          if (!producto) errores.push(['cre-producto', 'Ponle un nombre al producto. Ej.: Libre inversión.']);

          const cuota = parseCOP(panel.querySelector('#cre-cuota').value);
          if (!Number.isInteger(cuota) || cuota <= 0) {
            errores.push(['cre-cuota', 'Escribe cuánto vas a pagar este mes.']);
          }

          /* --- opcionales: vacío = pendiente; escrito pero ilegible = error --- */
          const brutoSaldo = panel.querySelector('#cre-saldo').value.trim();
          let saldo = null;
          if (brutoSaldo !== '') {
            saldo = parseCOP(brutoSaldo);
            if (!Number.isInteger(saldo) || saldo < 0) {
              errores.push(['cre-saldo', 'No entendí ese saldo. Puedes dejarlo vacío.']);
            }
          }

          const brutoTasa = inputTasa.value.trim();
          let ea = null;
          if (brutoTasa !== '') {
            ea = parseFloat(brutoTasa);
            if (!Number.isFinite(ea) || ea < 0) {
              errores.push(['cre-tasa', 'Esa tasa no se entiende. Puedes dejarla vacía.']);
            }
          }

          const brutoDia = panel.querySelector('#cre-dia').value.trim();
          let dia = null;
          if (brutoDia !== '') {
            dia = parseInt(brutoDia, 10);
            if (!Number.isInteger(dia) || dia < 1 || dia > 31) {
              errores.push(['cre-dia', 'El día debe estar entre 1 y 31.']);
            }
          }

          if (errores.length) {
            // Si lo que falla está plegado, se abre: nadie corrige lo que no ve.
            if (errores.some(([id]) => CAMPOS_OPCIONALES.includes(id))) abrirAvanzados(true);
            pintarErrores(panel, errores);
            toast('Revisa los campos marcados', { icono: false });
            return;
          }

          const campos = {
            entidad,
            producto,
            tipo: producto, // espejo del campo viejo, por compatibilidad
            saldo,
            cuotaMensual: cuota,
            tasaEA: ea,
            tasaMV: ea != null ? tasaEAaMV(ea) : null,
            diaPago: dia,
          };

          try {
            let guardado;
            if (esNuevo) {
              guardado = crearCredito(campos);
            } else {
              guardado = actualizar(cre, campos);
              const v = validarCredito(guardado);
              if (!v.ok) throw new Error(v.errores.join(' '));
            }
            await put('creditos', guardado);
            await recargar();
            toast(esNuevo ? 'Crédito agregado' : 'Crédito actualizado');
            avisar();
            pantallaLista();
          } catch (err) {
            toast('No se pudo guardar: ' + err.message, { icono: false, ms: 3200 });
          }
        });

        const borrar = panel.querySelector('[data-act="borrar"]');
        if (borrar) borrar.addEventListener('click', async () => {
          const ok = await confirmar({
            title: '¿Eliminar este crédito?',
            text: `${cre.entidad} · ${productoDe(cre)} · cuota ${formatCOP(cre.cuotaMensual)}.`,
            okText: 'Eliminar', danger: true,
          });
          if (!ok) return;
          try {
            await del('creditos', cre.id);
            await recargar();
            toast('Crédito eliminado');
            avisar();
            pantallaLista();
          } catch (err) {
            toast('No se pudo eliminar: ' + err.message, { icono: false });
          }
        });

        requestAnimationFrame(() => panel.querySelector('#cre-entidad').focus());
      });
    }

    pantallaLista();
  });
}
