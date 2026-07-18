import test from 'node:test';
import assert from 'node:assert/strict';
import { diasDesde, respaldoVencido } from '../js/views/cfg-respaldo.js';

const AHORA = new Date('2026-07-18T12:00:00.000Z');
const haceDias = (n) => new Date(AHORA.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

/* ---- diasDesde (PURA) ---- */

test('diasDesde: cuenta los días transcurridos', () => {
  assert.equal(diasDesde(haceDias(0), AHORA), 0);
  assert.equal(diasDesde(haceDias(1), AHORA), 1);
  assert.equal(diasDesde(haceDias(30), AHORA), 30);
});

test('diasDesde: sin respaldo previo devuelve null', () => {
  assert.equal(diasDesde(null, AHORA), null);
  assert.equal(diasDesde('', AHORA), null);
  assert.equal(diasDesde('   ', AHORA), null);
  assert.equal(diasDesde(undefined, AHORA), null);
});

test('diasDesde: fecha ilegible devuelve null en vez de NaN', () => {
  assert.equal(diasDesde('no es fecha', AHORA), null);
});

/* ---- respaldoVencido (PURA) ---- */

test('respaldoVencido: nunca respaldado cuenta como vencido', () => {
  assert.equal(respaldoVencido(null, AHORA), true);
});

test('respaldoVencido: dentro de los 7 días no avisa', () => {
  assert.equal(respaldoVencido(haceDias(0), AHORA), false);
  assert.equal(respaldoVencido(haceDias(6), AHORA), false);
  assert.equal(respaldoVencido(haceDias(7), AHORA), false); // el día 7 exacto aún pasa
});

test('respaldoVencido: pasados más de 7 días avisa', () => {
  assert.equal(respaldoVencido(haceDias(8), AHORA), true);
  assert.equal(respaldoVencido(haceDias(45), AHORA), true);
});
