/* ============================================================
   Bolsillo · budget.js
   MOTOR PURO del semáforo financiero. Sin db ni window ni DOM
   en el top-level: importable y testeable en Node.
   El "hoy" es SIEMPRE inyectable (Date o ISO) — nunca Date.now()
   dentro de la matemática. Dinero en enteros de pesos.

   Idea central: el color NO mira cuánto llevas gastado en bruto,
   sino tu RITMO relativo al día del mes. Gastar 90% del bolsillo
   variable el día 28 va bien; gastar 80% el día 10 es alerta.
   ============================================================ */

/* Umbral de la banda ámbar→rojo (razón ritmo/avance). Configurable. */
export const UMBRAL_AMARILLO_DEFAULT = 1.25;

const CATEGORIA_FALLBACK = 'otros';

const ETIQUETAS = Object.freeze({
  verde: 'Vas bien',
  ambar: 'Cuidado',
  rojo: 'Alerta',
  'sin-config': 'Sin configurar',
});

const MENSAJES = Object.freeze({
  verde: 'Vas al ritmo del mes',
  ambar: 'Vas un poco rápido, ojo',
  rojo: 'Gastando más rápido que el mes',
  'sin-config': 'Configura tu sueldo para empezar',
  fijosSuperan: 'Tus gastos fijos ya se comen todo tu sueldo',
});

/* ---- helpers de fecha (puros) ---- */

/** Normaliza un Date o ISO a 'YYYY-MM-DD'. Falla fuerte si es inválido. */
function aFechaISO(fecha) {
  if (fecha instanceof Date) {
    if (Number.isNaN(fecha.getTime())) throw new Error('calcularEstado: "hoy" es una fecha inválida.');
    return fecha.toISOString().slice(0, 10);
  }
  if (typeof fecha === 'string' && fecha.trim() !== '') {
    if (/^\d{4}-\d{2}-\d{2}/.test(fecha)) return fecha.slice(0, 10);
    const d = new Date(fecha);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  throw new Error('calcularEstado: "hoy" debe ser un Date o una fecha ISO válida.');
}

/** Partes de una fecha (Date/ISO): año, mes 1-based, día y prefijo 'YYYY-MM'. */
function partes(fecha) {
  const iso = aFechaISO(fecha);
  return {
    anio: Number(iso.slice(0, 4)),
    mes: Number(iso.slice(5, 7)),
    dia: Number(iso.slice(8, 10)),
    prefijo: iso.slice(0, 7),
  };
}

/** Días del mes calendario de `fecha` (Date/ISO). Ej: febrero 2026 → 28. */
export function diasEnMes(fecha) {
  const { anio, mes } = partes(fecha);
  // new Date(anio, mes, 0) = último día del mes 1-based; getDate() es TZ-independiente.
  return new Date(anio, mes, 0).getDate();
}

/* ---- helpers de dominio (puros) ---- */

const esEntero = (n) => Number.isInteger(n);
const redondear = (n) => (Number.isFinite(n) ? Math.round(n) : 0);

/** ¿La fecha del movimiento cae en el mes `prefijo` ('YYYY-MM')? */
function enMes(mov, prefijo) {
  return mov && typeof mov.fecha === 'string' && mov.fecha.slice(0, 7) === prefijo;
}

/** Umbral amarillo desde config, con default seguro. */
function leerUmbralAmarillo(config) {
  const raw = config && config.umbralesSemaforo && config.umbralesSemaforo.amarillo;
  return Number.isFinite(raw) && raw > 0 ? raw : UMBRAL_AMARILLO_DEFAULT;
}

/** Color del presupuesto de una categoría según cuánto de él lleva gastado. */
function colorPresupuesto(total, presupuesto) {
  if (!(presupuesto > 0)) return null;
  const r = total / presupuesto;
  if (r > 1) return 'rojo';
  if (r > 0.85) return 'ambar';
  return 'verde';
}

/**
 * Gasto variable por categoría del mes (solo gasto no-fijo).
 * Devuelve [{categoriaId, total, pct, presupuesto?, color?}] ordenado desc.
 */
function desglosarCategorias(variables, variableGastado, config) {
  const presupuestos = (config && config.presupuestos) || {};
  const acum = new Map();
  for (const m of variables) {
    const id = typeof m.categoria === 'string' && m.categoria.trim() !== '' ? m.categoria : CATEGORIA_FALLBACK;
    acum.set(id, (acum.get(id) || 0) + m.monto);
  }
  const filas = [];
  for (const [categoriaId, total] of acum) {
    const fila = {
      categoriaId,
      total: redondear(total),
      pct: variableGastado > 0 ? total / variableGastado : 0,
    };
    const presupuesto = presupuestos[categoriaId];
    if (esEntero(presupuesto) && presupuesto > 0) {
      fila.presupuesto = presupuesto;
      fila.color = colorPresupuesto(total, presupuesto);
    }
    filas.push(Object.freeze(fila));
  }
  filas.sort((a, b) => b.total - a.total);
  return Object.freeze(filas);
}

/**
 * Fijos comprometidos del mes SIN doble conteo:
 *  (A) movimientos con esFijo===true del mes, MÁS
 *  (B) recurrentes activos aún NO materializados este mes (compromiso pendiente),
 *      respetando excepciones["YYYY-MM"] (saltar→no cuenta, monto→ese monto).
 */
function calcularFijos(movimientos, recurrentes, prefijo) {
  // (A) fijos ya registrados (materializados o capturados a mano).
  let fijosMaterializados = 0;
  const recIdsMaterializados = new Set();
  for (const m of movimientos) {
    if (!enMes(m, prefijo)) continue;
    if (m.esFijo === true) {
      fijosMaterializados += m.monto;
      if (m.recurrenteId) recIdsMaterializados.add(m.recurrenteId);
    }
  }

  // (B) recurrentes activos pendientes (sin movimiento propio este mes).
  let fijosPendientes = 0;
  for (const rec of recurrentes) {
    if (!rec || rec.activo !== true) continue;
    if (recIdsMaterializados.has(rec.id)) continue; // ya contado en (A): no duplicar
    const exc = rec.excepciones && rec.excepciones[prefijo];
    if (exc && exc.saltar === true) continue; // saltado este mes: no compromete
    const monto = exc && esEntero(exc.monto) ? exc.monto : rec.monto;
    if (esEntero(monto)) fijosPendientes += monto;
  }

  return redondear(fijosMaterializados + fijosPendientes);
}

/**
 * calcularEstado — corazón del semáforo. PURO y de solo lectura.
 *
 * @param {object} args
 * @param {number|null} args.ingresoEmpleo  sueldo mensual (entero de pesos)
 * @param {object[]}    args.movimientos    movimientos del usuario
 * @param {object[]}    args.recurrentes    gastos fijos definidos
 * @param {Date|string} args.hoy            fecha de referencia (inyectable)
 * @param {object}      args.config         config (umbrales, presupuestos)
 * @returns {Readonly<object>} estado congelado con color + números del mes
 */
export function calcularEstado({ ingresoEmpleo, movimientos = [], recurrentes = [], hoy, config = {} } = {}) {
  const movs = Array.isArray(movimientos) ? movimientos.filter(Boolean) : [];
  const recs = Array.isArray(recurrentes) ? recurrentes.filter(Boolean) : [];

  const { dia, prefijo } = partes(hoy);
  const diasMes = diasEnMes(hoy);
  const diasRestantes = diasMes - dia + 1; // hoy cuenta
  const avance = dia / diasMes; // fracción de mes transcurrida (dia>=1 ⇒ >0)

  // Gasto VARIABLE del mes: gasto y NO fijo (excluye ingresos, pagos, transfers, fijos).
  const variables = movs.filter((m) => m.tipo === 'gasto' && m.esFijo === false && enMes(m, prefijo));
  const variableGastado = redondear(variables.reduce((s, m) => s + m.monto, 0));

  const fijosDelMes = calcularFijos(movs, recs, prefijo);
  const totalHormiga = redondear(
    movs.filter((m) => m.esHormiga === true && enMes(m, prefijo)).reduce((s, m) => s + m.monto, 0),
  );
  const porCategoria = desglosarCategorias(variables, variableGastado, config);

  const proyeccionVariable = redondear(variableGastado / avance);
  const proyeccionTotal = fijosDelMes + proyeccionVariable;

  const base = {
    diasMes,
    dia,
    diasRestantes,
    avance,
    variableGastado,
    fijosDelMes,
    totalHormiga,
    porCategoria,
    proyeccionVariable,
    proyeccionTotal,
  };

  // --- Sin sueldo configurado: nada de NaN ni divisiones por cero ---
  const ingreso = esEntero(ingresoEmpleo) ? ingresoEmpleo : (Number.isFinite(ingresoEmpleo) ? Math.round(ingresoEmpleo) : 0);
  if (!(ingreso > 0)) {
    return Object.freeze({
      ...base,
      configurado: false,
      color: 'sin-config',
      etiqueta: ETIQUETAS['sin-config'],
      mensaje: MENSAJES['sin-config'],
      ingresoEmpleo: 0,
      baseVariable: null,
      ritmo: null,
      razon: null,
      porcentajeIngreso: null,
      disponibleRestante: null,
      disponiblePorDia: null,
      fijosSuperanIngreso: false,
    });
  }

  const baseVariable = ingreso - fijosDelMes;
  const porcentajeIngreso = variableGastado / ingreso;

  // --- Los fijos igualan o superan el sueldo: rojo, sin dividir por cero ---
  if (baseVariable <= 0) {
    const disponibleRestante = baseVariable - variableGastado;
    return Object.freeze({
      ...base,
      configurado: true,
      color: 'rojo',
      etiqueta: ETIQUETAS.rojo,
      mensaje: MENSAJES.fijosSuperan,
      ingresoEmpleo: ingreso,
      baseVariable,
      ritmo: null,
      razon: null,
      porcentajeIngreso,
      disponibleRestante,
      disponiblePorDia: redondear(disponibleRestante / diasRestantes),
      fijosSuperanIngreso: true,
    });
  }

  // --- Caso normal ---
  const ritmo = variableGastado / baseVariable;
  const razon = ritmo / avance;
  const amarillo = leerUmbralAmarillo(config);

  let color;
  if (razon > amarillo || ritmo >= 1) color = 'rojo';
  else if (razon > 1) color = 'ambar';
  else color = 'verde';

  const disponibleRestante = baseVariable - variableGastado;

  return Object.freeze({
    ...base,
    configurado: true,
    color,
    etiqueta: ETIQUETAS[color],
    mensaje: MENSAJES[color],
    ingresoEmpleo: ingreso,
    baseVariable,
    ritmo,
    razon,
    porcentajeIngreso,
    disponibleRestante,
    disponiblePorDia: redondear(disponibleRestante / diasRestantes),
    fijosSuperanIngreso: false,
  });
}
