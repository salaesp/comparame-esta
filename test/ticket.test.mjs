// lib/ticket.mjs: lo pagado por renglón, el control contra el total, los renglones que
// no cierran y la validación de lo que se guarda. Con el ticket de Carrefour en tres
// fotos (test/fixtures/carrefour-3-fotos.json).
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { pagadoDe, controlTotal, noCierra, cantidadSugerida, validarTicket, preciosDe } from '../lib/ticket.mjs';

const carrefour = JSON.parse(readFileSync(new URL('./fixtures/carrefour-3-fotos.json', import.meta.url)));

test('el ticket de Carrefour en tres fotos da lo que se pagó, contra subtotal − ahorro', () => {
  const r = carrefour.respuesta;
  assert.equal(r.renglones.length, 19);
  const c = controlTotal(r);
  assert.equal(c.estado, 'ok');
  assert.equal(c.contra, 'subtotal_ahorro');
  assert.equal(c.esperado, carrefour.pagado);
  assert.equal(c.suma, carrefour.pagado);
});

test('si un renglón del borde se cuenta dos veces, no da y dice por cuánto', () => {
  const r = carrefour.respuesta;
  const conRepetido = [...r.renglones, { ...r.renglones[12] }]; // la banana dos veces
  const c = controlTotal({ ...r, renglones: conRepetido });
  assert.equal(c.estado, 'no_da');
  assert.equal(c.diferencia, 1517.34);
});

test('contra el total, y vale también si el total no restó los descuentos', () => {
  const renglones = [{ importe: 1000, descuento: 100 }, { importe: 500, descuento: 0 }];
  assert.equal(controlTotal({ renglones, total: 1400 }).estado, 'ok');
  assert.equal(controlTotal({ renglones, total: 1500 }).estado, 'ok');
  assert.equal(controlTotal({ renglones, total: 1300 }).estado, 'no_da');
  assert.equal(controlTotal({ renglones }).estado, 'sin_total');
  assert.equal(controlTotal({ renglones, subtotal: 1500 }).estado, 'ok');
});

test('los recargos que no son productos (impuestos internos, percepciones) se descuentan del total', () => {
  // Nini 1117-00007940: los productos con IVA dan 104.151,34; el agua paga $329,82 de impuestos internos.
  const renglones = [{ importe: 104151.34, descuento: 0 }];
  assert.equal(controlTotal({ renglones, total: 104481.16 }).estado, 'no_da');
  const c = controlTotal({ renglones, total: 104481.16, recargos: 329.82 });
  assert.equal(c.estado, 'ok');
  assert.equal(c.esperado, 104151.34);
});

test('pagado, no cierra y "Son n"', () => {
  assert.equal(pagadoDe({ importe: 44958, descuento: 11239.5 }), 33718.5);
  assert.equal(noCierra({ cantidad: 1, precio_unitario: 4999, importe: 29994 }), true);
  assert.equal(noCierra({ cantidad: 6, precio_unitario: 4999, importe: 29994 }), false);
  assert.equal(noCierra({ cantidad: 2, precio_unitario: 100, importe: 150 }), false); // una promo baja
  assert.equal(cantidadSugerida({ cantidad: 1, precio_unitario: 4999, importe: 29994 }), 6);
  assert.equal(cantidadSugerida({ cantidad: 6, precio_unitario: 4999, importe: 29994 }), null);
});

test('validarTicket: pide fecha, lugar y productos, y limpia lo que llega', () => {
  assert.match(validarTicket({}).error, /fecha/);
  assert.match(validarTicket({ fecha: '2026-10-25', renglones: [] }).error, /lugar/);
  assert.match(validarTicket({ fecha: '2026-10-25', lugar: { cadena: 'Coto' }, renglones: [] }).error, /productos/);
  const v = validarTicket({
    fecha: '2026-10-25', lugar: { cadena: ' Coto ' }, total: 1000,
    renglones: [{ texto: 'YERBA PLAYADITO 1KG', cantidad: 2, importe: 1000, descuento: 2000, nuevo: { nombre: 'YERBA MATE', marca: 'playadito', medida: 1, medida_unidad: 'kg', ean: '123' } }],
  });
  assert.equal(v.error, undefined);
  assert.equal(v.ticket.lugar.cadena, 'Coto');
  const [r] = v.renglones;
  assert.equal(r.descuento, 1000); // nunca más que lo impreso
  assert.deepEqual(r.nuevo, { nombre: 'Yerba Mate', marca: 'playadito', medida: 1000, medida_unidad: 'g', ean: '' });
  assert.match(validarTicket({ fecha: '2026-10-25', lugar: { cadena: 'Coto' }, renglones: [{ texto: 'x', cantidad: 0, importe: 1 }] }).error, /cantidad/);
});

test('preciosDe: lo pagado por unidad y por kg', () => {
  assert.deepEqual(preciosDe({ cantidad: 6, unidad: 'u', importe: 29994, descuento: 0 }, { medida: 500, medida_unidad: 'g' }),
    { pagado: 29994, precio_unit: 4999, precio_medida: 9998 });
  assert.deepEqual(preciosDe({ cantidad: 0.305, unidad: 'kg', precio_lista: 46435, importe: 14162.68, descuento: 0 }, {}),
    { pagado: 14162.68, precio_unit: 46435, precio_medida: 46435 });
  // Sin el precio impreso, la cuenta.
  assert.equal(preciosDe({ cantidad: 0.305, unidad: 'kg', importe: 14162.68, descuento: 0 }, {}).precio_unit, 46435.02);
  // Con descuento, el precio impreso con el descuento repartido: 2 × 22479 − 11239,5.
  assert.equal(preciosDe({ cantidad: 2, unidad: 'u', precio_lista: 22479, importe: 44958, descuento: 11239.5 }, {}).precio_unit, 16859.25);
});
