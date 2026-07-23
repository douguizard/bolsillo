import test from 'node:test';
import assert from 'node:assert/strict';
import {
  crearMovimiento,
  crearRecurrente,
  crearCredito,
  crearIngreso,
  validarMovimiento,
  validarRecurrente,
  validarCredito,
  validarIngreso,
  actualizar,
  derivarEsHormiga,
  configDefault,
  crearConfig,
  tasaEAaMV,
  migrarIngresos,
  ingresoNecesitaMigracion,
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

test('crearMovimiento: acepta fuente "voz" (gasto por voz)', () => {
  const m = crearMovimiento({ ...movBase, fuente: 'voz' });
  assert.equal(m.fuente, 'voz');
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

/* ---------------- ingresos con nombre propio (fuentes) ---------------- */

test('crearIngreso empleo: el sueldo va en monto; sin montoEsperado ni crédito', () => {
  const emp = crearIngreso({ fuente: 'empleo', monto: 17_000_000, diaDelMes: 30 });
  assert.equal(emp.fuente, 'empleo');
  assert.equal(emp.monto, 17_000_000);
  assert.equal(emp.montoEsperado, null);
  assert.equal(emp.creditoId, null);
});

test('crearIngreso negocio: nombre libre, montoEsperado opcional y crédito vinculado', () => {
  const neg = crearIngreso({ fuente: 'negocio', nombre: 'Tierra Querida', diaDelMes: 15, montoEsperado: 1_500_000, creditoId: 'cred-1' });
  assert.equal(neg.fuente, 'negocio');
  assert.equal(neg.nombre, 'Tierra Querida');
  assert.equal(neg.montoEsperado, 1_500_000);
  assert.equal(neg.creditoId, 'cred-1');
  assert.equal(neg.monto, null); // el negocio no usa monto; cuenta lo recibido
});

test('crearIngreso negocio: montoEsperado y crédito son OPCIONALES (quedan null)', () => {
  const neg = crearIngreso({ fuente: 'negocio', nombre: 'Arriendo apto', diaDelMes: 1 });
  assert.equal(neg.montoEsperado, null);
  assert.equal(neg.creditoId, null);
});

test('crearIngreso negocio: exige nombre (fail-fast)', () => {
  assert.throws(() => crearIngreso({ fuente: 'negocio', diaDelMes: 15 }), /nombre del ingreso es obligatorio/i);
});

test('validarIngreso negocio: rechaza montoEsperado no entero', () => {
  const r = validarIngreso({ fuente: 'negocio', nombre: 'X', diaDelMes: 5, montoEsperado: 1500.5, creditoId: null });
  assert.equal(r.ok, false);
});

/* ---------------- MIGRACIÓN retrocompatible negocio1/negocio2 ---------------- */

test('migrarIngresos: un negocio1 viejo migra a negocio SIN perder el monto (→ montoEsperado)', () => {
  // Arrange: registro viejo tal cual quedó en IndexedDB antes de esta tanda.
  const viejo = {
    id: 'ing-1', fuente: 'negocio1', monto: 1_500_000, diaDelMes: 15, nombre: '',
    creadoEn: '2026-01-01T00:00:00.000Z', actualizadoEn: '2026-01-01T00:00:00.000Z',
  };
  // Act
  const [m] = migrarIngresos([viejo], { now: new Date('2026-07-22T00:00:00Z') });
  // Assert: nada se pierde, todo queda en la forma nueva.
  assert.equal(m.fuente, 'negocio');
  assert.equal(m.nombre, 'Negocio 1'); // nombre por defecto legible
  assert.equal(m.montoEsperado, 1_500_000); // el viejo monto se conserva como esperado
  assert.equal(m.monto, null);
  assert.equal(m.creditoId, null);
  assert.equal(m.id, 'ing-1'); // mismo id: no se pierde el registro
  assert.equal(m.creadoEn, '2026-01-01T00:00:00.000Z'); // se conserva
  assert.ok(Object.isFrozen(m));
});

test('migrarIngresos: respeta un nombre ya puesto y migra negocio2 con su etiqueta', () => {
  const conNombre = { id: 'a', fuente: 'negocio1', monto: 800_000, diaDelMes: 5, nombre: 'DC Medical' };
  const sinNombre = { id: 'b', fuente: 'negocio2', monto: 400_000, diaDelMes: 10, nombre: '' };
  const [a, b] = migrarIngresos([conNombre, sinNombre]);
  assert.equal(a.nombre, 'DC Medical');
  assert.equal(b.nombre, 'Negocio 2');
});

test('migrarIngresos: es IDEMPOTENTE (correrla dos veces no cambia nada)', () => {
  const viejo = { id: 'ing-1', fuente: 'negocio1', monto: 1_500_000, diaDelMes: 15, nombre: '' };
  const now = new Date('2026-07-22T00:00:00Z');
  const uno = migrarIngresos([viejo], { now });
  const dos = migrarIngresos(uno, { now });
  // La segunda pasada ve una fuente ya nueva y la deja intacta (misma referencia).
  assert.equal(dos[0], uno[0]);
  assert.deepEqual(dos[0], uno[0]);
});

test('migrarIngresos: NO toca empleo ni las fuentes ya nuevas', () => {
  const empleo = crearIngreso({ fuente: 'empleo', monto: 17_000_000, diaDelMes: 30 });
  const negocioNuevo = crearIngreso({ fuente: 'negocio', nombre: 'Tierra Querida', diaDelMes: 15 });
  const [e, n] = migrarIngresos([empleo, negocioNuevo]);
  assert.equal(e, empleo); // misma referencia: no se tocó
  assert.equal(n, negocioNuevo);
});

test('ingresoNecesitaMigracion: solo los slots viejos', () => {
  assert.equal(ingresoNecesitaMigracion({ fuente: 'negocio1' }), true);
  assert.equal(ingresoNecesitaMigracion({ fuente: 'negocio2' }), true);
  assert.equal(ingresoNecesitaMigracion({ fuente: 'negocio' }), false);
  assert.equal(ingresoNecesitaMigracion({ fuente: 'empleo' }), false);
});

/* ---------------- recurrente: valor variable (esVariable) ---------------- */

const recExacto = { nombre: 'Arriendo', monto: 1_200_000, diaDelMes: 5, cuenta: 'Bancolombia', modo: 'auto' };

test('crearRecurrente exacto: esVariable false por defecto y monto obligatorio', () => {
  const r = crearRecurrente(recExacto);
  assert.equal(r.esVariable, false);
  assert.equal(r.monto, 1_200_000);
  assert.equal(r.montoEstimado, null);
});

test('crearRecurrente exacto: SIN monto sigue fallando (retrocompat estricta)', () => {
  assert.throws(() => crearRecurrente({ nombre: 'Arriendo', diaDelMes: 5, cuenta: 'Bancolombia' }), /Recurrente inválido/);
});

test('crearRecurrente variable: se guarda SIN monto (antes no dejaba)', () => {
  const r = crearRecurrente({ nombre: 'Luz', esVariable: true, diaDelMes: 10, cuenta: 'Bancolombia' });
  assert.equal(r.esVariable, true);
  assert.equal(r.monto, null); // no reserva un estimado inventado
  assert.equal(r.montoEstimado, null);
  assert.ok(Object.isFrozen(r));
});

test('crearRecurrente variable: acepta montoEstimado OPCIONAL como referencia', () => {
  const r = crearRecurrente({ nombre: 'Gasolina', esVariable: true, diaDelMes: 15, cuenta: 'Nequi', montoEstimado: 300_000 });
  assert.equal(r.esVariable, true);
  assert.equal(r.monto, null);
  assert.equal(r.montoEstimado, 300_000);
});

test('validarRecurrente variable: NO exige monto>0; sí rechaza estimado basura', () => {
  const okSinMonto = validarRecurrente({
    nombre: 'Agua', esVariable: true, monto: null, montoEstimado: null,
    diaDelMes: 8, cuenta: 'Bancolombia', modo: 'confirmar', activo: true, excepciones: {},
  });
  assert.equal(okSinMonto.ok, true);
  const malEstimado = validarRecurrente({
    nombre: 'Agua', esVariable: true, monto: null, montoEstimado: 1500.5,
    diaDelMes: 8, cuenta: 'Bancolombia', modo: 'confirmar', activo: true, excepciones: {},
  });
  assert.equal(malEstimado.ok, false);
});

test('validarRecurrente: un recurrente viejo SIN esVariable se valida como exacto', () => {
  const viejo = {
    nombre: 'Arriendo', monto: 1_200_000, diaDelMes: 5,
    cuenta: 'Bancolombia', modo: 'confirmar', activo: true, excepciones: {},
  };
  assert.equal(validarRecurrente(viejo).ok, true); // undefined esVariable → exacto
  // y sin monto un viejo-exacto sí falla:
  assert.equal(validarRecurrente({ ...viejo, monto: null }).ok, false);
});

/* ---------------- crédito: activo (retrocompat) ---------------- */

test('crearCredito: nace activo por defecto y puede marcarse inactivo', () => {
  assert.equal(crearCredito(creditoMinimo).activo, true);
  assert.equal(crearCredito({ ...creditoMinimo, activo: false }).activo, false);
});

test('validarCredito: un crédito viejo SIN campo activo sigue siendo válido', () => {
  const viejo = {
    entidad: 'AV Villas', producto: 'Libre inversión', tipo: 'Libre inversión',
    saldo: null, cuotaMensual: 850_000, tasaEA: null, tasaMV: null, diaPago: null, desgloses: [],
  };
  assert.equal(validarCredito(viejo).ok, true);
});

test('crearMovimiento: preserva ingresoId y creditoId (vínculos), null por defecto', () => {
  const suelto = crearMovimiento({ ...movBase, tipo: 'gasto' });
  assert.equal(suelto.ingresoId, null);
  assert.equal(suelto.creditoId, null);
  const ingreso = crearMovimiento({ monto: 500_000, tipo: 'ingreso', cuenta: 'Nequi', fecha: '2026-07-01', ingresoId: 'f-1' });
  assert.equal(ingreso.ingresoId, 'f-1');
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

test('configDefault: trae las nuevas llaves de categorías vacías', () => {
  const c = configDefault();
  assert.deepEqual(c.categoriasEstilo, {});
  assert.deepEqual(c.categoriasOcultas, []);
  assert.deepEqual(c.categoriasOrden, []);
});

test('crearConfig: categoriasEstilo se fusiona sobre lo existente', () => {
  const c = crearConfig({
    categoriasEstilo: { persona1: { icono: 'corazon', tint: 'salud' } },
  });
  assert.deepEqual(c.categoriasEstilo.persona1, { icono: 'corazon', tint: 'salud' });
  assert.ok(Object.isFrozen(c.categoriasEstilo));
});

test('crearConfig: categoriasOcultas y categoriasOrden se reemplazan (no mutan el input)', () => {
  const ocultas = ['negocios', 'comisiones'];
  const orden = ['yo', 'persona1'];
  const c = crearConfig({ categoriasOcultas: ocultas, categoriasOrden: orden });
  assert.deepEqual(c.categoriasOcultas, ['negocios', 'comisiones']);
  assert.deepEqual(c.categoriasOrden, ['yo', 'persona1']);
  assert.notEqual(c.categoriasOcultas, ocultas); // copia, no la misma referencia
  assert.ok(Object.isFrozen(c.categoriasOrden));
});

test('crearConfig: sin las nuevas llaves quedan como arreglos/objeto vacíos', () => {
  const c = crearConfig({ tema: 'dark' });
  assert.deepEqual(c.categoriasEstilo, {});
  assert.deepEqual(c.categoriasOcultas, []);
  assert.deepEqual(c.categoriasOrden, []);
});
