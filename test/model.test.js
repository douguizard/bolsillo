import test from 'node:test';
import assert from 'node:assert/strict';
import {
  crearMovimiento,
  crearRecurrente,
  crearCredito,
  crearIngreso,
  validarMovimiento,
  validarCredito,
  actualizar,
  derivarEsHormiga,
  configDefault,
  tasaEAaMV,
} from '../js/model.js';

const movBase = {
  monto: 15000,
  tipo: 'gasto',
  cuenta: 'Nequi',
  fecha: '2026-07-01',
  categoria: 'Mercado',
  comercio: 'D1',
};

/* ---------------- factories inmutables ---------------- */

test('crearMovimiento: devuelve objeto congelado con id y timestamps', () => {
  const m = crearMovimiento(movBase);
  assert.ok(Object.isFrozen(m));
  assert.ok(typeof m.id === 'string' && m.id.length > 0);
  assert.ok(m.creadoEn && m.actualizadoEn);
  assert.equal(m.creadoEn, m.actualizadoEn);
});

test('crearMovimiento: NO muta el input', () => {
  const input = { ...movBase };
  const copia = { ...movBase };
  crearMovimiento(input);
  assert.deepEqual(input, copia);
  assert.ok(!Object.isFrozen(input));
});

test('crearMovimiento: fecha usa el gasto real, no la de captura', () => {
  const m = crearMovimiento(movBase, { now: new Date('2026-09-30T10:00:00Z') });
  assert.equal(m.fecha, '2026-07-01');
});

test('actualizar: copia nueva, original intacto, actualizadoEn cambia', () => {
  const m = crearMovimiento(movBase, { now: new Date('2026-01-01T00:00:00Z') });
  const m2 = actualizar(m, { monto: 20000 }, new Date('2026-02-01T00:00:00Z'));
  assert.notEqual(m2, m);
  assert.equal(m.monto, 15000); // original intacto
  assert.equal(m2.monto, 20000);
  assert.notEqual(m2.actualizadoEn, m.actualizadoEn);
  assert.equal(m2.creadoEn, m.creadoEn);
  assert.ok(Object.isFrozen(m2));
});

/* ---------------- validadores ---------------- */

test('validarMovimiento: rechaza monto <= 0', () => {
  assert.equal(validarMovimiento({ ...movBase, monto: 0 }).ok, false);
  assert.equal(validarMovimiento({ ...movBase, monto: -5 }).ok, false);
  assert.equal(validarMovimiento({ ...movBase, monto: 1500.5 }).ok, false);
});

test('validarMovimiento: rechaza cuenta vacía', () => {
  const r = validarMovimiento({ ...movBase, cuenta: '   ' });
  assert.equal(r.ok, false);
  assert.ok(r.errores.some((e) => /cuenta/i.test(e)));
});

test('validarMovimiento: rechaza tipo inválido', () => {
  assert.equal(validarMovimiento({ ...movBase, tipo: 'xxx' }).ok, false);
});

test('validarMovimiento: acepta un movimiento válido', () => {
  const r = validarMovimiento({ ...movBase, fuente: 'manual', esFijo: false });
  assert.equal(r.ok, true);
  assert.equal(r.value.monto, 15000);
});

/* ---------------- derivarEsHormiga ---------------- */

test('derivarEsHormiga: un gasto fijo NUNCA es hormiga', () => {
  assert.equal(derivarEsHormiga({ tipo: 'gasto', esFijo: true, monto: 5000 }, configDefault()), false);
});

test('derivarEsHormiga: gasto variable bajo el umbral sí es hormiga', () => {
  assert.equal(derivarEsHormiga({ tipo: 'gasto', esFijo: false, monto: 5000 }, configDefault()), true);
});

test('derivarEsHormiga: gasto variable sobre el umbral no es hormiga', () => {
  assert.equal(derivarEsHormiga({ tipo: 'gasto', esFijo: false, monto: 50000 }, configDefault()), false);
});

test('crearMovimiento: deriva esHormiga automáticamente', () => {
  const chico = crearMovimiento({ ...movBase, monto: 5000 });
  const grande = crearMovimiento({ ...movBase, monto: 50000 });
  assert.equal(chico.esHormiga, true);
  assert.equal(grande.esHormiga, false);
});

/* ---------------- otras entidades ---------------- */

test('crearIngreso / crearRecurrente / crearCredito congelan y validan', () => {
  const ing = crearIngreso({ fuente: 'empleo', monto: 2000000, diaDelMes: 30 });
  assert.ok(Object.isFrozen(ing));

  const rec = crearRecurrente({ nombre: 'Arriendo', monto: 1200000, diaDelMes: 5, cuenta: 'Bancolombia', modo: 'auto' });
  assert.ok(Object.isFrozen(rec));
  assert.equal(rec.activo, true);

  const cre = crearCredito({ entidad: 'Bancolombia', tipo: 'libre inversión', saldo: 5000000, cuotaMensual: 300000, tasaEA: 24, diaPago: 15 });
  assert.ok(Object.isFrozen(cre));
  assert.ok(cre.tasaMV > 0); // derivada de la EA
});

test('crearIngreso: rechaza fuente inválida (fail-fast)', () => {
  assert.throws(() => crearIngreso({ fuente: 'loteria', monto: 100, diaDelMes: 1 }), /Ingreso inválido/);
});

test('tasaEAaMV: 24% EA equivale a ~1,81% MV', () => {
  const mv = tasaEAaMV(24);
  assert.ok(Math.abs(mv - 1.8088) < 0.01);
});

/* ---------------- crédito: producto + datos pendientes ---------------- */

const creditoMinimo = { entidad: 'AV Villas', producto: 'Libre inversión', cuotaMensual: 850000 };

test('crearCredito: guarda con saldo, tasa y día VACÍOS (los completa la AI)', () => {
  // El caso exacto que le falló a Doug: registró el crédito y no se agregó nada.
  const c = crearCredito(creditoMinimo);
  assert.equal(c.entidad, 'AV Villas');
  assert.equal(c.producto, 'Libre inversión');
  assert.equal(c.cuotaMensual, 850000);
  assert.equal(c.saldo, null);
  assert.equal(c.tasaEA, null);
  assert.equal(c.tasaMV, null);
  assert.equal(c.diaPago, null);
  assert.ok(Object.isFrozen(c));
});

test('crearCredito: los opcionales también aceptan cadena vacía como "pendiente"', () => {
  const c = crearCredito({ ...creditoMinimo, saldo: '', tasaEA: '', diaPago: '' });
  assert.equal(c.saldo, null);
  assert.equal(c.tasaEA, null);
  assert.equal(c.diaPago, null);
});

test('crearCredito: exige producto (fail-fast, no guarda a medias)', () => {
  assert.throws(
    () => crearCredito({ entidad: 'AV Villas', cuotaMensual: 850000 }),
    /producto es obligatorio/i,
  );
});

test('crearCredito: exige entidad', () => {
  assert.throws(
    () => crearCredito({ producto: 'Tarjeta Visa', cuotaMensual: 320000 }),
    /entidad es obligatoria/i,
  );
});

test('crearCredito: varios productos de la MISMA entidad conviven', () => {
  const libre = crearCredito({ entidad: 'AV Villas', producto: 'Libre inversión', cuotaMensual: 850000 });
  const visa = crearCredito({ entidad: 'AV Villas', producto: 'Tarjeta Visa', cuotaMensual: 320000 });
  assert.notEqual(libre.id, visa.id);
  assert.equal(libre.entidad, visa.entidad);
  assert.notEqual(libre.producto, visa.producto);

  const delBanco = [libre, visa].filter((c) => c.entidad === 'AV Villas');
  assert.equal(delBanco.length, 2);
  assert.equal(delBanco.reduce((s, c) => s + c.cuotaMensual, 0), 1170000);
});

test('crearCredito: retrocompat, un crédito viejo sin producto usa su `tipo`', () => {
  const viejo = crearCredito({ entidad: 'Bancolombia', tipo: 'Vehículo', saldo: 5000000, cuotaMensual: 300000, tasaEA: 24, diaPago: 15 });
  assert.equal(viejo.producto, 'Vehículo');
  assert.ok(viejo.tasaMV > 0); // la MV se sigue derivando de la EA
});

test('validarCredito: acepta un crédito viejo ya guardado (sin romperlo)', () => {
  const yaGuardado = {
    entidad: 'Bancolombia', producto: 'Tarjeta de crédito', tipo: 'Tarjeta de crédito',
    saldo: 5000000, cuotaMensual: 300000, tasaEA: 24, tasaMV: 1.81, diaPago: 15, desgloses: [],
  };
  assert.equal(validarCredito(yaGuardado).ok, true);
});

test('validarCredito: rechaza cuota no entera (nada de floats en pesos)', () => {
  const r = validarCredito({ ...creditoMinimo, cuotaMensual: 850000.5, desgloses: [] });
  assert.equal(r.ok, false);
  assert.ok(r.errores.some((e) => /cuota/i.test(e)));
});

test('validarCredito: un opcional escrito pero ilegible sí se rechaza', () => {
  const base = { ...creditoMinimo, desgloses: [], saldo: null, tasaEA: null, diaPago: null };
  assert.equal(validarCredito({ ...base, saldo: NaN }).ok, false);
  assert.equal(validarCredito({ ...base, tasaEA: NaN }).ok, false);
  assert.equal(validarCredito({ ...base, diaPago: 42 }).ok, false);
  assert.equal(validarCredito({ ...base, saldo: -1 }).ok, false);
  // …pero null (vacío) pasa sin problema:
  assert.equal(validarCredito(base).ok, true);
});

test('actualizar: completar después la tasa deriva la MV y no toca el original', () => {
  const c = crearCredito(creditoMinimo);
  const conTasa = actualizar(c, { tasaEA: 26.5, tasaMV: tasaEAaMV(26.5) });
  assert.equal(c.tasaEA, null); // original intacto
  assert.equal(conTasa.tasaEA, 26.5);
  assert.ok(conTasa.tasaMV > 0);
  assert.equal(validarCredito(conTasa).ok, true);
});

test('configDefault: singleton con id fijo y apiKey null', () => {
  const c = configDefault();
  assert.equal(c.id, 'config');
  assert.equal(c.apiKey, null);
  assert.equal(c.umbralHormiga, 20000);
  assert.ok(Object.isFrozen(c));
});
