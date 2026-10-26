// lib/lector.mjs: el pedido a Claude (todas las fotos juntas, la consigna de las
// repeticiones en el borde), la forma fija de la respuesta y la limpieza.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  RESPUESTA_SCHEMA, contenido, consigna, limpiarRespuesta, leerTicket, fotosError, costoUsd, lectorConfig, FOTOS_MAX,
} from '../lib/lector.mjs';

const carrefour = JSON.parse(readFileSync(new URL('./fixtures/carrefour-3-fotos.json', import.meta.url)));
const FOTO = 'data:image/jpeg;base64,AAAA';

test('el schema cumple lo que pide structured outputs: todo objeto cerrado y con todo obligatorio', () => {
  const visitar = (s, camino = 'raíz') => {
    if (s.type === 'object') {
      assert.equal(s.additionalProperties, false, `${camino}: additionalProperties`);
      assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort(), `${camino}: required`);
      for (const [k, v] of Object.entries(s.properties)) visitar(v, `${camino}.${k}`);
    }
    if (s.items) visitar(s.items, `${camino}[]`);
    for (const x of s.anyOf || []) visitar(x, camino);
    for (const k of ['minimum', 'maximum', 'minLength', 'maxLength']) assert.ok(!(k in s), `${camino}: ${k} no se soporta`);
  };
  visitar(RESPUESTA_SCHEMA);
});

test('una foto con su número antes, y la consigna al final; con varias, la regla del borde', () => {
  const c = contenido([FOTO, 'data:image/png;base64,BBBB'], { hoy: '2026-10-26' });
  assert.deepEqual(c.slice(0, 4).map((b) => b.type), ['text', 'image', 'text', 'image']);
  assert.equal(c[0].text, 'Foto 1 de 2');
  assert.deepEqual(c[3].source, { type: 'base64', media_type: 'image/png', data: 'BBBB' });
  assert.match(c[4].text, /Son 2 fotos de un MISMO ticket/);
  assert.match(c[4].text, /"repetido"/);
  assert.match(c[4].text, /Hoy es 2026-10-26/);
  assert.doesNotMatch(consigna({ n: 1 }), /Son 1 fotos/);
});

test('fotosError: hace falta al menos una, hasta FOTOS_MAX, y que sean imágenes', () => {
  assert.match(fotosError([]), /Falta/);
  assert.match(fotosError(Array(FOTOS_MAX + 1).fill(FOTO)), /como mucho/);
  assert.match(fotosError(['hola']), /no es una imagen/);
  assert.equal(fotosError([FOTO]), null);
});

test('limpiarRespuesta: se queda con lo que es un número y un texto, y nunca más descuento que lo impreso', () => {
  const l = limpiarRespuesta({
    lugar: { cadena: '  Coto ', sucursal: null, direccion: 'Cabildo 1', cuit: null },
    fecha: '25/10/2026', total: 1500.555, subtotal: null, ahorro: null,
    renglones: [
      { foto: 2, texto: 'YERBA', cantidad: 2, unidad: 'u', precio_unitario: 500, importe: 1000, descuento: 5000, ean: null, marca: null, nombre: '', medida_cantidad: null, medida_unidad: 'kg' },
      { foto: 9, texto: 'SIN IMPORTE', cantidad: 1, unidad: 'u', precio_unitario: null, importe: -3, descuento: 0 },
      { foto: 1, texto: '', cantidad: 1, unidad: 'u', importe: 10, descuento: 0 },
    ],
    descartados: [{ foto: 7, texto: 'BOLSA', importe: 20, motivo: 'otra cosa' }],
    avisos: ['La foto 2 está borrosa', ''],
  }, { nFotos: 2 });
  assert.equal(l.lugar.cadena, 'Coto');
  assert.equal(l.fecha, null); // no está en YYYY-MM-DD
  assert.equal(l.total, 1500.56);
  assert.equal(l.renglones.length, 1);
  assert.equal(l.renglones[0].descuento, 1000);
  assert.equal(l.renglones[0].nombre, 'YERBA');
  assert.equal(l.renglones[0].foto, 2);
  assert.deepEqual(l.descartados, [{ foto: 1, texto: 'BOLSA', importe: 20, motivo: 'no_es_producto' }]);
  assert.deepEqual(l.avisos, ['La foto 2 está borrosa']);
});

// Un cliente de Anthropic falso: anota el pedido y contesta lo que se le diga.
function clienteFalso(respuesta, extra = {}) {
  const calls = [];
  const contestar = async (params) => {
    calls.push(params);
    return { model: params.model, stop_reason: 'end_turn', usage: { input_tokens: 9000, output_tokens: 3000 }, content: [{ type: 'text', text: JSON.stringify(respuesta) }], ...extra };
  };
  return { calls, messages: { create: contestar }, beta: { messages: { create: contestar } } };
}

test('leerTicket: manda las fotos con el schema y el esfuerzo; Opus y Sonnet con fallbacks, Haiku sin', async () => {
  const c = clienteFalso(carrefour.respuesta);
  const r = await leerTicket(c, [FOTO, FOTO, FOTO], { modelo: 'claude-opus-5-5', esfuerzo: 'low', hoy: '2026-10-26' });
  assert.equal(r.lectura.renglones.length, 19);
  assert.equal(c.calls[0].output_config.effort, 'low');
  assert.equal(c.calls[0].output_config.format.type, 'json_schema');
  assert.equal(c.calls[0].fallbacks, 'default');
  assert.deepEqual(c.calls[0].betas, ['server-side-fallback-2026-07-01']);
  assert.equal(c.calls[0].messages[0].content.filter((b) => b.type === 'image').length, 3);
  const h = clienteFalso(carrefour.respuesta);
  await leerTicket(h, [FOTO], { modelo: 'claude-haiku-5-5' });
  assert.equal(h.calls[0].fallbacks, undefined);
});

test('leerTicket: un rechazo, una respuesta cortada o rota se dicen con su motivo', async () => {
  await assert.rejects(leerTicket(clienteFalso({}, { stop_reason: 'refusal' }), [FOTO]), { motivo: 'rechazo' });
  await assert.rejects(leerTicket(clienteFalso({}, { stop_reason: 'max_tokens' }), [FOTO]), { motivo: 'cortado' });
  await assert.rejects(leerTicket(clienteFalso({}, { content: [{ type: 'text', text: '{roto' }] }), [FOTO]), { motivo: 'formato' });
});

test('costo y configuración', () => {
  assert.equal(costoUsd('claude-opus-5-5', { input_tokens: 1e6, output_tokens: 1e6 }), 24);
  assert.equal(costoUsd('claude-haiku-5-5', { input_tokens: 10000, output_tokens: 2000 }), 0.002);
  assert.deepEqual(lectorConfig({}), { modelo: 'claude-opus-5-5', esfuerzo: 'medium' });
  assert.deepEqual(lectorConfig({ LECTOR_MODELO: 'claude-haiku-5-5', LECTOR_ESFUERZO: 'low' }), { modelo: 'claude-haiku-5-5', esfuerzo: 'low' });
  assert.deepEqual(lectorConfig({ LECTOR_MODELO: 'gpt', LECTOR_ESFUERZO: 'max' }), { modelo: 'claude-opus-5-5', esfuerzo: 'medium' });
});
