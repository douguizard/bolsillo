/* Tests de voz-gasto.js — funciones puras + interpretarVoz con fetch inyectado.
   La llamada a Claude es I/O (no se testea contra la red real); aquí se prueba
   la parte PURA (construcción de la petición, extracción del tool_use y
   normalización del resultado) y el manejo de errores con fetch simulado. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  construirPeticionVoz, extraerToolUse, normalizarTipo, normalizarResultado,
  interpretarVoz, TOOL_REGISTRO, MODELO_VOZ_DEFAULT, UMBRAL_CONFIANZA,
} from '../js/voz-gasto.js';
import { ANTHROPIC_MESSAGES_URL } from '../js/foto-gasto.js';

const CATS = [
  { id: 'mercado', label: 'Supermercado' },
  { id: 'transporte', label: 'Auto' },
  { id: 'otros', label: 'Otros' },
];
const CUENTAS = ['Efectivo', 'Banco'];

/* ---- construirPeticionVoz ---- */
test('construirPeticionVoz fuerza el uso de la herramienta y pasa el texto', () => {
  const body = construirPeticionVoz({ texto: 'cincuenta mil en el mercado', categorias: CATS, cuentas: CUENTAS });
  assert.equal(body.model, MODELO_VOZ_DEFAULT);
  assert.deepEqual(body.tool_choice, { type: 'tool', name: TOOL_REGISTRO.name });
  assert.equal(body.tools[0].name, 'registrar_gasto');
  assert.equal(body.messages[0].role, 'user');
  assert.equal(body.messages[0].content, 'cincuenta mil en el mercado');
});

test('construirPeticionVoz incluye categorías y cuentas reales en el system', () => {
  const body = construirPeticionVoz({ texto: 'x', categorias: CATS, cuentas: CUENTAS });
  assert.match(body.system, /mercado \(Supermercado\)/);
  assert.match(body.system, /Efectivo, Banco/);
});

test('construirPeticionVoz respeta el modelo elegido', () => {
  const body = construirPeticionVoz({ texto: 'x', modelo: 'claude-x', categorias: CATS, cuentas: CUENTAS });
  assert.equal(body.model, 'claude-x');
});

/* ---- extraerToolUse ---- */
test('extraerToolUse devuelve el input del bloque tool_use', () => {
  const cuerpo = { content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', name: 'registrar_gasto', input: { monto: 1 } }] };
  assert.deepEqual(extraerToolUse(cuerpo), { monto: 1 });
});

test('extraerToolUse tolera formas raras → null', () => {
  assert.equal(extraerToolUse({ content: [{ type: 'text', text: 'x' }] }), null);
  assert.equal(extraerToolUse({ content: [{ type: 'tool_use' }] }), null);
  assert.equal(extraerToolUse(null), null);
  assert.equal(extraerToolUse({}), null);
});

/* ---- normalizarTipo ---- */
test('normalizarTipo mapea gasto/pago/ingreso y cae en gasto por defecto', () => {
  assert.equal(normalizarTipo('gasto'), 'gasto');
  assert.equal(normalizarTipo('PAGO'), 'pago');
  assert.equal(normalizarTipo(' ingreso '), 'ingreso');
  assert.equal(normalizarTipo('otra-cosa'), 'gasto');
  assert.equal(normalizarTipo(null), 'gasto');
});

/* ---- normalizarResultado ---- */
const IDS = new Set(CATS.map((c) => c.id));

test('normalizarResultado lee un input limpio', () => {
  const r = normalizarResultado(
    { monto: 50000, tipo: 'gasto', comercio: 'Mercado', categoria: 'mercado', cuenta: 'Efectivo', nota: 'varios', confianza: 0.9 },
    { idsValidos: IDS, cuentasValidas: CUENTAS },
  );
  assert.deepEqual(r, { monto: 50000, tipo: 'gasto', comercio: 'Mercado', categoriaId: 'mercado', cuenta: 'Efectivo', nota: 'varios', confianza: 0.9 });
});

test('normalizarResultado normaliza monto en texto ("50 mil", "$120.000")', () => {
  assert.equal(normalizarResultado({ monto: '50 mil', confianza: 1 }, { idsValidos: IDS }).monto, 50000);
  assert.equal(normalizarResultado({ monto: '$120.000', confianza: 1 }, { idsValidos: IDS }).monto, 120000);
});

test('normalizarResultado con monto no positivo o basura → null', () => {
  assert.equal(normalizarResultado({ monto: 0 }, { idsValidos: IDS }).monto, null);
  assert.equal(normalizarResultado({ monto: -5 }, { idsValidos: IDS }).monto, null);
  assert.equal(normalizarResultado({ comercio: 'x' }, { idsValidos: IDS }).monto, null);
});

test('normalizarResultado descarta categoría inválida → ""', () => {
  assert.equal(normalizarResultado({ monto: 1, categoria: 'inexistente' }, { idsValidos: IDS }).categoriaId, '');
  assert.equal(normalizarResultado({ monto: 1, categoria: 'transporte' }, { idsValidos: IDS }).categoriaId, 'transporte');
});

test('normalizarResultado empareja cuenta sin distinguir mayúsculas y devuelve el nombre exacto', () => {
  assert.equal(normalizarResultado({ monto: 1, cuenta: 'efectivo' }, { idsValidos: IDS, cuentasValidas: CUENTAS }).cuenta, 'Efectivo');
  assert.equal(normalizarResultado({ monto: 1, cuenta: 'Ahorros' }, { idsValidos: IDS, cuentasValidas: CUENTAS }).cuenta, '');
});

test('normalizarResultado clampa la confianza a [0,1] y la desconocida → 0.5', () => {
  assert.equal(normalizarResultado({ monto: 1, confianza: 1.7 }, { idsValidos: IDS }).confianza, 1);
  assert.equal(normalizarResultado({ monto: 1, confianza: -3 }, { idsValidos: IDS }).confianza, 0);
  assert.equal(normalizarResultado({ monto: 1 }, { idsValidos: IDS }).confianza, 0.5);
});

test('normalizarResultado conserva tipo pago/ingreso', () => {
  assert.equal(normalizarResultado({ monto: 1, tipo: 'pago' }, { idsValidos: IDS }).tipo, 'pago');
  assert.equal(normalizarResultado({ monto: 1, tipo: 'ingreso' }, { idsValidos: IDS }).tipo, 'ingreso');
});

test('normalizarResultado con basura no lanza y devuelve seguros', () => {
  const r = normalizarResultado(null, { idsValidos: IDS, cuentasValidas: CUENTAS });
  assert.deepEqual(r, { monto: null, tipo: 'gasto', comercio: '', categoriaId: '', cuenta: '', nota: '', confianza: 0.5 });
});

/* ---- interpretarVoz (fetch inyectado) ---- */
test('interpretarVoz con texto vacío → vacio (no hace red)', async () => {
  let llamado = false;
  const r = await interpretarVoz(
    { texto: '   ', apiKey: 'k', categorias: CATS, cuentas: CUENTAS },
    { fetchImpl: async () => { llamado = true; return {}; } },
  );
  assert.equal(r.estado, 'vacio');
  assert.equal(llamado, false);
});

test('interpretarVoz sin clave → sin-clave (no hace red)', async () => {
  let llamado = false;
  const r = await interpretarVoz(
    { texto: 'cincuenta mil en mercado', apiKey: '', categorias: CATS, cuentas: CUENTAS },
    { fetchImpl: async () => { llamado = true; return {}; } },
  );
  assert.equal(r.estado, 'sin-clave');
  assert.equal(llamado, false);
});

test('interpretarVoz camino feliz: manda la clave en header, tool_choice forzado y normaliza', async () => {
  let capturado = null;
  const fetchImpl = async (url, opts) => {
    capturado = { url, opts };
    return {
      ok: true, status: 200,
      json: async () => ({
        content: [{ type: 'tool_use', name: 'registrar_gasto', input: {
          monto: 50000, tipo: 'gasto', comercio: 'Mercado', categoria: 'mercado', cuenta: 'Efectivo', nota: 'varios', confianza: 0.9,
        } }],
      }),
    };
  };
  const r = await interpretarVoz(
    { texto: 'cincuenta mil en el mercado, varios', apiKey: 'sk-ant-secreta', categorias: CATS, cuentas: CUENTAS },
    { fetchImpl },
  );
  assert.equal(r.estado, 'ok');
  assert.equal(r.monto, 50000);
  assert.equal(r.categoriaId, 'mercado');
  assert.equal(r.cuenta, 'Efectivo');
  assert.equal(r.confianza, 0.9);
  assert.equal(capturado.url, ANTHROPIC_MESSAGES_URL);
  assert.equal(capturado.opts.headers['x-api-key'], 'sk-ant-secreta');
  assert.ok(!capturado.url.includes('sk-ant-secreta')); // la clave NUNCA en la URL
  const enviado = JSON.parse(capturado.opts.body);
  assert.deepEqual(enviado.tool_choice, { type: 'tool', name: 'registrar_gasto' });
});

test('interpretarVoz 401 → invalida (mensaje sin la clave)', async () => {
  const r = await interpretarVoz(
    { texto: 'algo', apiKey: 'sk-secreta', categorias: CATS, cuentas: CUENTAS },
    { fetchImpl: async () => ({ ok: false, status: 401 }) },
  );
  assert.equal(r.estado, 'invalida');
  assert.ok(!r.mensaje.includes('sk-secreta'));
});

test('interpretarVoz con fallo de red → red', async () => {
  const r = await interpretarVoz(
    { texto: 'algo', apiKey: 'k', categorias: CATS, cuentas: CUENTAS },
    { fetchImpl: async () => { throw new Error('boom'); } },
  );
  assert.equal(r.estado, 'red');
});

test('interpretarVoz sin bloque tool_use en la respuesta → error', async () => {
  const r = await interpretarVoz(
    { texto: 'algo', apiKey: 'k', categorias: CATS, cuentas: CUENTAS },
    { fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'no llamé la herramienta' }] }) }) },
  );
  assert.equal(r.estado, 'error');
});

test('UMBRAL_CONFIANZA es 0.7', () => {
  assert.equal(UMBRAL_CONFIANZA, 0.7);
});
