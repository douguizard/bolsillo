/* ============================================================
   Bolsillo · voz-gasto.js
   Interpreta un gasto DICTADO (texto en lenguaje natural) con Claude
   usando tool-use FORZADO y devuelve {monto, tipo, comercio, categoriaId,
   cuenta, nota, confianza} para prellenar la tarjeta de revisión de
   Registrar. Es el gemelo de foto-gasto.js: mismo patrón de red y de
   manejo de errores, cambiando solo la ENTRADA (texto en vez de imagen)
   y el CONTRATO de salida (una herramienta en vez de JSON suelto).

   SEGURIDAD (igual que anthropic.js / foto-gasto.js):
   - La clave viaja SOLO en el header `x-api-key`. Nunca en URL, query,
     cuerpo serializado ni logs.
   - Los mensajes de error son literales fijos: NO interpolan la clave.
   - `construirPeticionVoz`, `extraerToolUse`, `normalizarTipo` y
     `normalizarResultado` son PURAS (testeables en Node).
   - `interpretarVoz` recibe `fetchImpl` por inyección.

   Reutiliza `parseCOP` (money.js) para el monto y las constantes de red
   de foto-gasto.js (misma URL y versión de la API): cero duplicación.
   ============================================================ */

import { parseCOP } from './money.js';
import { ANTHROPIC_MESSAGES_URL, ANTHROPIC_VERSION } from './foto-gasto.js';

/* Modelo por defecto: Haiku (barato y suficiente para parsear texto). El
   usuario puede sobreescribirlo en config.modelos.voz. */
export const MODELO_VOZ_DEFAULT = 'claude-haiku-4-5-20251001';

/* Debajo de este valor de confianza, la captura se resalta para revisión
   (nunca se guarda a ciegas: el usuario siempre confirma). */
export const UMBRAL_CONFIANZA = 0.7;

/* Herramienta que el modelo DEBE llamar (tool_choice forzado). El esquema
   describe exactamente los campos que prellenan la tarjeta de revisión. */
export const TOOL_REGISTRO = Object.freeze({
  name: 'registrar_gasto',
  description:
    'Registra un movimiento de dinero interpretado de una frase que el usuario dictó en Colombia.',
  input_schema: {
    type: 'object',
    properties: {
      monto: {
        type: 'integer',
        description: 'Monto en pesos COP como entero, sin puntos ni símbolos. "50 mil" → 50000; "1 millón" → 1000000.',
      },
      tipo: {
        type: 'string',
        enum: ['gasto', 'pago', 'ingreso'],
        description: 'gasto por defecto; "pagué/abono" → pago; "me entró/me pagaron" → ingreso.',
      },
      comercio: {
        type: 'string',
        description: 'Nombre corto de dónde se gastó (máx 40 caracteres), o cadena vacía.',
      },
      categoria: {
        type: 'string',
        description: 'Uno de los id de categoría del usuario (no la etiqueta). "otros" si dudas.',
      },
      cuenta: {
        type: 'string',
        description: 'Una de las cuentas del usuario (nombre exacto), o cadena vacía si no la menciona.',
      },
      nota: {
        type: 'string',
        description: 'Detalle extra que ayude a recordar el gasto (o cadena vacía). "varios" va aquí.',
      },
      confianza: {
        type: 'number',
        description: 'Qué tan seguro estás de haber entendido la frase, de 0 a 1.',
      },
    },
    required: ['monto', 'tipo', 'confianza'],
  },
});

/**
 * Construye el cuerpo de /v1/messages para interpretar una frase dictada.
 * PURA. Fuerza el uso de la herramienta y pasa al modelo las categorías y
 * cuentas REALES del usuario más pistas colombianas.
 * @param {{texto:string, modelo?:string, categorias:Array<{id:string,label:string}>, cuentas:string[]}} p
 */
export function construirPeticionVoz({ texto, modelo, categorias, cuentas }) {
  const lista = (categorias || []).map((c) => `${c.id} (${c.label})`).join(', ');
  const cuentasLimpias = (cuentas || []).filter((c) => typeof c === 'string' && c.trim() !== '');
  const listaCuentas = cuentasLimpias.join(', ');
  const cuentaDefault = cuentasLimpias[0] || '';

  const sistema = [
    'Eres el asistente de captura de gastos de una app de finanzas personales en Colombia.',
    'El usuario DICTA una frase corta y tú registras el movimiento llamando SIEMPRE a la herramienta registrar_gasto.',
    'Monto (pesos COP, entero, sin puntos ni símbolos): "cincuenta mil"/"50 mil" → 50000; "1 millón" → 1000000; "1,5 millones" → 1500000; "15 lucas" → 15000.',
    'Tipo: por defecto "gasto". Si dice "pagué/abono/aboné" → "pago". Si dice "me entró/me pagaron/recibí/me consignaron" → "ingreso".',
    `Categorías válidas (devuelve el id EXACTO, no la etiqueta): ${lista || '(ninguna)'}.`,
    'Si dudas de la categoría usa "otros". Pistas: D1/Ara/Éxito/Olímpica/Carulla/Jumbo → mercado; gasolina/peaje/taxi/bus/parqueadero → transporte; luz/agua/gas/internet/celular → servicios; droguería/EPS/médico → salud.',
    `Cuentas del usuario: ${listaCuentas || '(sin cuentas)'}. Usa el nombre EXACTO de una si la menciona; si no dice ninguna, usa "${cuentaDefault}".`,
    'comercio: dónde se gastó (corto) o vacío. Si dice "varios", deja comercio vacío y pon "varios" en nota.',
    'nota: detalle extra útil (o vacío). confianza: 0 a 1 según qué tan seguro estás de la frase.',
    'No inventes datos que la frase no diga.',
  ].join('\n');

  return {
    model: modelo || MODELO_VOZ_DEFAULT,
    max_tokens: 400,
    system: sistema,
    tools: [TOOL_REGISTRO],
    tool_choice: { type: 'tool', name: TOOL_REGISTRO.name },
    messages: [{ role: 'user', content: texto }],
  };
}

/**
 * Extrae el `input` del primer bloque tool_use de la respuesta. PURA y
 * tolerante: cualquier forma inesperada devuelve null (nunca lanza).
 * @param {object} cuerpo respuesta de /v1/messages
 * @returns {object|null}
 */
export function extraerToolUse(cuerpo) {
  const content = cuerpo && Array.isArray(cuerpo.content) ? cuerpo.content : [];
  for (const b of content) {
    if (b && b.type === 'tool_use' && b.input && typeof b.input === 'object') return b.input;
  }
  return null;
}

/** Mapea el tipo crudo del modelo a uno canónico. PURA. Default 'gasto'. */
export function normalizarTipo(raw) {
  const t = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return (t === 'ingreso' || t === 'pago') ? t : 'gasto';
}

/** Confianza a [0,1]. Desconocida → 0.5 (queda por debajo del umbral → se revisa). PURA. */
function normalizarConfianza(v) {
  const n = typeof v === 'number' ? v : (typeof v === 'string' ? parseFloat(v) : NaN);
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

/**
 * Normaliza el `input` de la herramienta a la forma canónica que consume la
 * tarjeta de revisión. PURA y tolerante: nunca lanza, campos inválidos caen
 * en vacíos. Reutiliza parseCOP para tolerar montos en texto ("50 mil").
 *
 * @param {object} input  input del tool_use del modelo
 * @param {{idsValidos?:(Set<string>|string[]), cuentasValidas?:(string[]|Set<string>)}} [opts]
 * @returns {{monto:(number|null), tipo:string, comercio:string, categoriaId:string, cuenta:string, nota:string, confianza:number}}
 */
export function normalizarResultado(input, { idsValidos, cuentasValidas } = {}) {
  const validos = idsValidos instanceof Set ? idsValidos : new Set(idsValidos || []);
  const cuentas = Array.isArray(cuentasValidas) ? cuentasValidas : [...(cuentasValidas || [])];
  const obj = input && typeof input === 'object' ? input : {};

  // monto: entero de pesos > 0. Acepta número o texto ("$50.000", "50 mil").
  let monto = obj.monto;
  if (typeof monto === 'string') monto = parseCOP(monto);
  else if (typeof monto === 'number') monto = Number.isFinite(monto) ? Math.round(monto) : null;
  else monto = null;
  if (!Number.isInteger(monto) || monto <= 0) monto = null;

  const tipo = normalizarTipo(obj.tipo);

  const comercio = typeof obj.comercio === 'string' ? obj.comercio.trim().slice(0, 60) : '';
  const nota = typeof obj.nota === 'string' ? obj.nota.trim().slice(0, 140) : '';

  let categoriaId = typeof obj.categoria === 'string' ? obj.categoria.trim().toLowerCase() : '';
  if (!validos.has(categoriaId)) categoriaId = '';

  // cuenta: solo si coincide (sin distinguir mayúsculas) con una del usuario;
  // devuelve el nombre EXACTO guardado para que el chip la seleccione bien.
  let cuenta = '';
  if (typeof obj.cuenta === 'string' && obj.cuenta.trim() !== '') {
    const buscada = obj.cuenta.trim().toLowerCase();
    const match = cuentas.find((c) => typeof c === 'string' && c.trim().toLowerCase() === buscada);
    if (match) cuenta = match;
  }

  const confianza = normalizarConfianza(obj.confianza);

  return { monto, tipo, comercio, categoriaId, cuenta, nota, confianza };
}

/**
 * Llama a Claude (tool-use forzado) para interpretar la frase dictada.
 * IMPURA (red). `fetchImpl` inyectable. Espeja el manejo de errores de
 * analizarRecibo: distingue sin-clave / vacío / clave inválida / red / error.
 *
 * @param {{texto:string, apiKey:string, modelo?:string, categorias:Array, cuentas:string[]}} p
 * @param {{fetchImpl?: typeof fetch}} [opts]
 * @returns {Promise<{estado:'ok'|'vacio'|'sin-clave'|'invalida'|'red'|'error', mensaje?:string, monto?:(number|null), tipo?:string, comercio?:string, categoriaId?:string, cuenta?:string, nota?:string, confianza?:number}>}
 */
export async function interpretarVoz(
  { texto, apiKey, modelo, categorias, cuentas },
  { fetchImpl } = {},
) {
  const frase = typeof texto === 'string' ? texto.trim() : '';
  if (frase === '') {
    return { estado: 'vacio', mensaje: 'Dime el gasto: por ejemplo "cincuenta mil en el mercado".' };
  }

  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (key === '') {
    return { estado: 'sin-clave', mensaje: 'Configura tu clave de Anthropic en Ajustes → Conexión con IA.' };
  }

  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) return { estado: 'error', mensaje: 'Este entorno no puede hacer peticiones de red.' };

  const body = construirPeticionVoz({
    texto: frase, modelo, categorias: categorias || [], cuentas: cuentas || [],
  });

  let res;
  try {
    res = await doFetch(ANTHROPIC_MESSAGES_URL, {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch {
    // Sin detalles del error: podrían arrastrar la petición (y la clave) a un log.
    return { estado: 'red', mensaje: 'No se pudo interpretar: revisa tu conexión e intenta de nuevo.' };
  }

  if (res.status === 401 || res.status === 403) {
    return { estado: 'invalida', mensaje: 'Clave inválida. Revísala en Ajustes.' };
  }
  if (!res.ok) {
    return { estado: 'error', mensaje: `No se pudo interpretar (HTTP ${res.status}).` };
  }

  let cuerpo;
  try { cuerpo = await res.json(); } catch { return { estado: 'error', mensaje: 'La respuesta no se pudo leer.' }; }

  const input = extraerToolUse(cuerpo);
  if (!input) return { estado: 'error', mensaje: 'No entendí el gasto. Intenta decirlo de otra forma.' };

  const idsValidos = new Set((categorias || []).map((c) => c.id));
  const datos = normalizarResultado(input, { idsValidos, cuentasValidas: cuentas || [] });
  return { estado: 'ok', ...datos };
}
