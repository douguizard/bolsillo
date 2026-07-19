/* ============================================================
   Bolsillo · model.js
   Tipos del dominio, validadores y FACTORIES INMUTABLES.
   Todo objeto que sale de aquí es NUEVO y está Object.freeze.
   Nunca se muta el input. Sin DOM ni IndexedDB (testeable en Node).
   El "now" es inyectable para pruebas deterministas.
   ============================================================ */

/* ---- enums / constantes ---- */
export const TIPOS_MOVIMIENTO = Object.freeze(['gasto', 'ingreso', 'pago_credito', 'transferencia']);
export const FUENTES_MOVIMIENTO = Object.freeze(['manual', 'foto', 'pdf', 'recurrente']);
export const FUENTES_INGRESO = Object.freeze(['empleo', 'negocio1', 'negocio2']);
export const MODOS_RECURRENTE = Object.freeze(['auto', 'confirmar']);
export const UMBRAL_HORMIGA_DEFAULT = 20_000;
export const CONFIG_ID = 'config';

/* ---- utilidades internas ---- */
export function nowISO(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  return d.toISOString();
}
function nuevoId() {
  return crypto.randomUUID();
}
function esTextoNoVacio(v) {
  return typeof v === 'string' && v.trim() !== '';
}
function esDiaDelMes(v) {
  return Number.isInteger(v) && v >= 1 && v <= 31;
}
function esFechaISO(v) {
  if (typeof v !== 'string' || v.trim() === '') return false;
  if (!/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(v)) return false;
  return Number.isFinite(Date.parse(v));
}
// Coerce a entero de pesos; si no se puede, devuelve `def`.
function aEntero(v, def = 0) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : def;
}
function montoEntero(v) {
  return Number.isInteger(v) ? v : aEntero(v, NaN);
}
/* --- opcionales: "" / null / undefined => null ("dato pendiente").
   Si viene algo pero es basura => NaN, para que el validador lo diga. --- */
function montoOpcional(v) {
  if (v == null || v === '') return null;
  return montoEntero(v);
}
function numeroOpcional(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}
function diaOpcional(v) {
  if (v == null || v === '') return null;
  const n = Number.isInteger(v) ? v : parseInt(v, 10);
  return Number.isInteger(n) ? n : NaN;
}
// Envuelve una base con id + timestamps y la congela.
function conMetadatos(base, { now = new Date(), id } = {}) {
  const ts = nowISO(now);
  return Object.freeze({ id: id ?? nuevoId(), ...base, creadoEn: ts, actualizadoEn: ts });
}

/* ============================================================
   MOVIMIENTO
   ============================================================ */
/**
 * @param {object} datos
 * @param {{now?:Date, config?:object}} [opts]
 * @returns {Readonly<object>} movimiento congelado
 * @throws {Error} si los datos no son válidos (fail-fast)
 */
export function crearMovimiento(datos = {}, { now = new Date(), config } = {}) {
  const base = {
    fecha: typeof datos.fecha === 'string' && datos.fecha ? datos.fecha : nowISO(now).slice(0, 10),
    monto: montoEntero(datos.monto),
    tipo: datos.tipo ?? 'gasto',
    categoria: typeof datos.categoria === 'string' ? datos.categoria : '',
    comercio: typeof datos.comercio === 'string' ? datos.comercio : '',
    cuenta: typeof datos.cuenta === 'string' ? datos.cuenta.trim() : '',
    fuente: datos.fuente ?? 'manual',
    esFijo: datos.esFijo === true,
    notas: typeof datos.notas === 'string' ? datos.notas : '',
    adjuntoId: datos.adjuntoId ?? null,
    aiMeta: datos.aiMeta ?? null,
    dedupKey: datos.dedupKey ?? null,
    // Vínculo al recurrente que lo materializó (null si es manual/foto/pdf).
    recurrenteId: datos.recurrenteId ?? null,
  };
  base.esHormiga = derivarEsHormiga(base, config ?? configDefault());

  const v = validarMovimiento(base);
  if (!v.ok) throw new Error('Movimiento inválido: ' + v.errores.join(' '));
  return conMetadatos(base, { now, id: datos.id });
}

export function validarMovimiento(obj = {}) {
  const errores = [];
  if (!obj || typeof obj !== 'object') return { ok: false, errores: ['El movimiento no es un objeto.'] };
  if (!Number.isInteger(obj.monto) || obj.monto <= 0) {
    errores.push('El monto debe ser un entero de pesos mayor a 0.');
  }
  if (!TIPOS_MOVIMIENTO.includes(obj.tipo)) {
    errores.push(`Tipo inválido: "${obj.tipo}". Use uno de: ${TIPOS_MOVIMIENTO.join(', ')}.`);
  }
  if (!esTextoNoVacio(obj.cuenta)) {
    errores.push('La cuenta es obligatoria.');
  }
  if (!esFechaISO(obj.fecha)) {
    errores.push('La fecha debe ser una fecha ISO válida (YYYY-MM-DD).');
  }
  if (!FUENTES_MOVIMIENTO.includes(obj.fuente)) {
    errores.push(`Fuente inválida: "${obj.fuente}". Use uno de: ${FUENTES_MOVIMIENTO.join(', ')}.`);
  }
  if (typeof obj.categoria !== 'string') errores.push('La categoría debe ser texto.');
  if (typeof obj.comercio !== 'string') errores.push('El comercio debe ser texto.');
  if (typeof obj.esFijo !== 'boolean') errores.push('esFijo debe ser booleano.');

  return errores.length ? { ok: false, errores } : { ok: true, value: obj };
}

/** true si es un gasto VARIABLE (no fijo) por debajo del umbral hormiga. */
export function derivarEsHormiga(mov = {}, config = configDefault()) {
  const umbral = Number.isInteger(config?.umbralHormiga) ? config.umbralHormiga : UMBRAL_HORMIGA_DEFAULT;
  return mov.tipo === 'gasto' && mov.esFijo !== true && Number.isInteger(mov.monto) && mov.monto < umbral;
}

/* ============================================================
   RECURRENTE
   ============================================================ */
export function crearRecurrente(datos = {}, { now = new Date() } = {}) {
  const base = {
    nombre: typeof datos.nombre === 'string' ? datos.nombre.trim() : '',
    monto: montoEntero(datos.monto),
    diaDelMes: datos.diaDelMes,
    categoria: typeof datos.categoria === 'string' ? datos.categoria : '',
    cuenta: typeof datos.cuenta === 'string' ? datos.cuenta.trim() : '',
    modo: datos.modo ?? 'confirmar',
    activo: datos.activo !== false,
    excepciones: datos.excepciones && typeof datos.excepciones === 'object' ? { ...datos.excepciones } : {},
  };
  const v = validarRecurrente(base);
  if (!v.ok) throw new Error('Recurrente inválido: ' + v.errores.join(' '));
  return conMetadatos(base, { now, id: datos.id });
}

export function validarRecurrente(obj = {}) {
  const errores = [];
  if (!obj || typeof obj !== 'object') return { ok: false, errores: ['El recurrente no es un objeto.'] };
  if (!esTextoNoVacio(obj.nombre)) errores.push('El nombre es obligatorio.');
  if (!Number.isInteger(obj.monto) || obj.monto <= 0) errores.push('El monto debe ser un entero de pesos mayor a 0.');
  if (!esDiaDelMes(obj.diaDelMes)) errores.push('El día del mes debe estar entre 1 y 31.');
  if (!esTextoNoVacio(obj.cuenta)) errores.push('La cuenta es obligatoria.');
  if (!MODOS_RECURRENTE.includes(obj.modo)) errores.push(`Modo inválido: "${obj.modo}". Use auto o confirmar.`);
  if (typeof obj.activo !== 'boolean') errores.push('activo debe ser booleano.');
  if (!obj.excepciones || typeof obj.excepciones !== 'object') errores.push('excepciones debe ser un objeto.');
  return errores.length ? { ok: false, errores } : { ok: true, value: obj };
}

/* ============================================================
   CRÉDITO
   ============================================================ */
/** Convierte tasa Efectiva Anual (%) a Mensual Vencida (%). */
export function tasaEAaMV(ea) {
  const eaDec = Number(ea) / 100;
  if (!Number.isFinite(eaDec)) return 0;
  return (Math.pow(1 + eaDec, 1 / 12) - 1) * 100;
}

function normalizarDesglose(d = {}) {
  return {
    mes: typeof d.mes === 'string' ? d.mes : '',
    capital: aEntero(d.capital, 0),
    interes: aEntero(d.interes, 0),
    comisiones: aEntero(d.comisiones, 0),
    seguros: aEntero(d.seguros, 0),
  };
}

/**
 * Un crédito es UN PRODUCTO de una entidad, no "un banco": el mismo
 * banco puede tener varios (libre inversión, tarjeta, vehículo…).
 *
 * Obligatorios: entidad + producto + cuotaMensual (lo que el usuario sí
 * sabe de memoria). `saldo`, `tasaEA` y `diaPago` son OPCIONALES y
 * quedan en null como "dato pendiente" hasta que la AI lea el extracto.
 */
export function crearCredito(datos = {}, { now = new Date() } = {}) {
  // Retrocompat: antes el producto se guardaba en `tipo`.
  const producto = esTextoNoVacio(datos.producto)
    ? datos.producto.trim()
    : (esTextoNoVacio(datos.tipo) ? datos.tipo.trim() : '');
  const tasaEA = numeroOpcional(datos.tasaEA);
  const tasaMVDada = numeroOpcional(datos.tasaMV);
  const tasaMV = tasaMVDada != null && Number.isFinite(tasaMVDada)
    ? tasaMVDada
    : (tasaEA != null && Number.isFinite(tasaEA) ? tasaEAaMV(tasaEA) : null);
  const base = {
    entidad: typeof datos.entidad === 'string' ? datos.entidad.trim() : '',
    producto,
    tipo: typeof datos.tipo === 'string' ? datos.tipo : '', // se conserva por compatibilidad
    saldo: montoOpcional(datos.saldo),
    cuotaMensual: Number.isInteger(datos.cuotaMensual) ? datos.cuotaMensual : aEntero(datos.cuotaMensual, 0),
    tasaEA,
    tasaMV,
    diaPago: diaOpcional(datos.diaPago),
    desgloses: Array.isArray(datos.desgloses) ? datos.desgloses.map(normalizarDesglose) : [],
  };
  const v = validarCredito(base);
  if (!v.ok) throw new Error('Crédito inválido: ' + v.errores.join(' '));
  return conMetadatos(base, { now, id: datos.id });
}

export function validarCredito(obj = {}) {
  const errores = [];
  if (!obj || typeof obj !== 'object') return { ok: false, errores: ['El crédito no es un objeto.'] };
  if (!esTextoNoVacio(obj.entidad)) errores.push('La entidad es obligatoria.');
  if (!esTextoNoVacio(obj.producto)) errores.push('El producto es obligatorio.');
  if (!Number.isInteger(obj.cuotaMensual) || obj.cuotaMensual < 0) errores.push('La cuota mensual debe ser un entero ≥ 0.');
  // Opcionales: null = "lo completa la AI con el extracto". Basura sí se rechaza.
  if (obj.saldo != null && (!Number.isInteger(obj.saldo) || obj.saldo < 0)) {
    errores.push('El saldo debe ser un entero de pesos ≥ 0, o quedar vacío.');
  }
  if (obj.tasaEA != null && (!Number.isFinite(obj.tasaEA) || obj.tasaEA < 0)) {
    errores.push('La tasa EA debe ser un número ≥ 0, o quedar vacía.');
  }
  if (obj.diaPago != null && !esDiaDelMes(obj.diaPago)) {
    errores.push('El día de pago debe estar entre 1 y 31, o quedar vacío.');
  }
  if (!Array.isArray(obj.desgloses)) errores.push('desgloses debe ser un arreglo.');
  return errores.length ? { ok: false, errores } : { ok: true, value: obj };
}

/* ============================================================
   INGRESO
   ============================================================ */
export function crearIngreso(datos = {}, { now = new Date() } = {}) {
  const base = {
    fuente: datos.fuente,
    monto: montoEntero(datos.monto),
    diaDelMes: datos.diaDelMes,
    // Etiqueta editable (solo para negocios; el empleo no la necesita).
    nombre: typeof datos.nombre === 'string' ? datos.nombre.trim() : '',
  };
  const v = validarIngreso(base);
  if (!v.ok) throw new Error('Ingreso inválido: ' + v.errores.join(' '));
  return conMetadatos(base, { now, id: datos.id });
}

export function validarIngreso(obj = {}) {
  const errores = [];
  if (!obj || typeof obj !== 'object') return { ok: false, errores: ['El ingreso no es un objeto.'] };
  if (!FUENTES_INGRESO.includes(obj.fuente)) errores.push(`Fuente inválida: "${obj.fuente}". Use uno de: ${FUENTES_INGRESO.join(', ')}.`);
  if (!Number.isInteger(obj.monto) || obj.monto <= 0) errores.push('El monto debe ser un entero de pesos mayor a 0.');
  if (!esDiaDelMes(obj.diaDelMes)) errores.push('El día del mes debe estar entre 1 y 31.');
  if (obj.nombre != null && typeof obj.nombre !== 'string') errores.push('El nombre debe ser texto.');
  return errores.length ? { ok: false, errores } : { ok: true, value: obj };
}

/* ============================================================
   CONFIG (singleton, id fijo "config")
   ============================================================ */
export function configDefault() {
  return Object.freeze({
    id: CONFIG_ID,
    umbralHormiga: UMBRAL_HORMIGA_DEFAULT,
    umbralesSemaforo: Object.freeze({ amarillo: 1.25 }),
    presupuestos: Object.freeze({}),
    // Cuentas del usuario (se siembran en el primer arranque desde app.js).
    cuentas: Object.freeze([]),
    // Overrides de categorización que el usuario "enseñó" (comercioNorm→categoríaId).
    categoriasAprendidas: Object.freeze({}),
    // Categorías propias del usuario: [{id, label}]. Los ids son estables
    // (los movimientos guardan categoriaId) y nunca chocan con los canónicos.
    categoriasPersonalizadas: Object.freeze([]),
    // Renombres de las categorías canónicas: {categoriaId: 'Nuevo nombre'}.
    categoriasRenombradas: Object.freeze({}),
    apiKey: null,
    modelos: Object.freeze({ vision: 'claude-haiku-4-5', extractos: 'claude-sonnet-4-5' }),
    tema: 'dark',
    fechaUltimoBackup: null,
    onboardingCompletado: false,
  });
}

/** Merge inmutable sobre el default (el id siempre queda fijo). */
export function crearConfig(datos = {}) {
  const d = configDefault();
  return Object.freeze({
    ...d,
    ...datos,
    id: CONFIG_ID,
    umbralesSemaforo: Object.freeze({ ...d.umbralesSemaforo, ...(datos.umbralesSemaforo || {}) }),
    modelos: Object.freeze({ ...d.modelos, ...(datos.modelos || {}) }),
    presupuestos: Object.freeze({ ...d.presupuestos, ...(datos.presupuestos || {}) }),
    // cuentas: reemplazo (no merge) — al agregar una cuenta se pasa el arreglo completo.
    cuentas: Object.freeze(Array.isArray(datos.cuentas) ? datos.cuentas.slice() : d.cuentas.slice()),
    // categoriasAprendidas: merge sobre lo existente (el llamante pasa el mapa completo).
    categoriasAprendidas: Object.freeze({ ...d.categoriasAprendidas, ...(datos.categoriasAprendidas || {}) }),
    // categoriasPersonalizadas: reemplazo (el llamante pasa el arreglo completo).
    categoriasPersonalizadas: Object.freeze(
      Array.isArray(datos.categoriasPersonalizadas)
        ? datos.categoriasPersonalizadas.map((c) => Object.freeze({ ...c }))
        : d.categoriasPersonalizadas.slice(),
    ),
    categoriasRenombradas: Object.freeze({ ...d.categoriasRenombradas, ...(datos.categoriasRenombradas || {}) }),
    onboardingCompletado: datos.onboardingCompletado === true,
  });
}

export function validarConfig(obj = {}) {
  const errores = [];
  if (!obj || typeof obj !== 'object') return { ok: false, errores: ['La config no es un objeto.'] };
  if (!Number.isInteger(obj.umbralHormiga) || obj.umbralHormiga < 0) errores.push('umbralHormiga debe ser un entero ≥ 0.');
  if (!(obj.apiKey === null || typeof obj.apiKey === 'string')) errores.push('apiKey debe ser texto o null.');
  if (typeof obj.tema !== 'string') errores.push('tema debe ser texto.');
  return errores.length ? { ok: false, errores } : { ok: true, value: obj };
}

/* ============================================================
   ACTUALIZAR genérico (inmutable)
   ============================================================ */
/**
 * Devuelve una COPIA nueva y congelada con los cambios y actualizadoEn nuevo.
 * Nunca muta la entidad original.
 */
export function actualizar(entidad, cambios = {}, now = new Date()) {
  if (!entidad || typeof entidad !== 'object') throw new Error('actualizar requiere una entidad.');
  return Object.freeze({ ...entidad, ...cambios, actualizadoEn: nowISO(now) });
}
