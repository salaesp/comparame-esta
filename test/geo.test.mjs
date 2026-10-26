// lib/geo.mjs: el punto en el mapa de un lugar con Georef (falso: los tests no salen a la
// red). Las respuestas tienen la forma de las de verdad (apis.datos.gob.ar/georef).
import assert from 'node:assert/strict';
import test, { before } from 'node:test';
import { baseNueva, usuario, pedir } from './helpers/d1.mjs';
import { elegirPunto, geocodificar, setGeoFetch, metros } from '../lib/geo.mjs';

const dir = (lat, lon, localidad, departamento, provincia) => ({
  ubicacion: { lat, lon }, localidad_censal: { nombre: localidad }, departamento: { nombre: departamento }, provincia: { nombre: provincia },
});
const CABA = 'Ciudad Autónoma de Buenos Aires';
const CABILDO = dir(-34.5610854118172, -58.4575068804582, CABA, 'Comuna 13', CABA);

test('elegirPunto: una dirección sola, sí; varias lejos (una calle común sin ciudad), no', () => {
  assert.deepEqual(elegirPunto([CABILDO]), { lat: -34.561085, lon: -58.457507, ciudad: 'CABA' });
  assert.equal(elegirPunto([]), null);
  // "San Martín 500": Las Colonias, Escobar… a cientos de km.
  assert.equal(elegirPunto([dir(-31.75, -61.31, 'Las Colonias', 'Las Colonias', 'Santa Fe'), dir(-34.41, -58.75, 'Escobar', 'Escobar', 'Buenos Aires')]), null);
  // Av. Maipú 1200 en Vicente López: tres puntos a 3 km. No se sabe cuál.
  assert.equal(elegirPunto([dir(-34.5268, -58.4820, 'Vicente López', 'Vicente López', 'Buenos Aires'), dir(-34.5053, -58.4936, 'Vicente López', 'Vicente López', 'Buenos Aires')]), null);
  // Dos tramos de la misma cuadra: vale el primero.
  assert.equal(elegirPunto([CABILDO, dir(-34.5611, -58.4576, CABA, 'Comuna 13', CABA)]).lat, -34.561085);
  // Con ciudad, sólo las que caen ahí (por localidad, departamento o, en CABA, provincia).
  const sm = [dir(-31.75, -61.31, 'Las Colonias', 'Las Colonias', 'Santa Fe'), dir(-34.41, -58.75, 'Belén de Escobar', 'Escobar', 'Buenos Aires')];
  assert.equal(elegirPunto(sm, 'Escobar').lat, -34.41);
  assert.equal(elegirPunto([CABILDO], 'CABA').ciudad, 'CABA');
  assert.equal(elegirPunto([CABILDO], 'Rosario'), null);
  assert.ok(Math.abs(metros({ lat: -34.6, lon: -58.4 }, { lat: -34.6, lon: -58.39 }) - 917) < 5);
});

test('geocodificar: con la ciudad pregunta en esa localidad y, si no está, en todo el país', async () => {
  const urls = [];
  setGeoFetch(async (url) => {
    urls.push(new URL(url).searchParams);
    const q = urls.at(-1);
    return Response.json({ direcciones: q.get('localidad') ? [] : [dir(-34.41, -58.75, 'Belén de Escobar', 'Escobar', 'Buenos Aires')] });
  });
  assert.equal((await geocodificar({ direccion: 'San Martín 500', ciudad: 'Escobar' })).lat, -34.41);
  assert.equal(urls[0].get('localidad'), 'Escobar');
  assert.equal(urls[1].get('localidad'), null);
  assert.equal(await geocodificar({ direccion: '', ciudad: 'CABA' }), null);
  setGeoFetch(async () => new Response('caído', { status: 503 }));
  await assert.rejects(geocodificar({ direccion: 'Av. Cabildo 2200' }));
});

let db, worker, ana, setAnthropic;
before(async () => {
  db = await baseNueva();
  worker = (await import('../worker/index.js')).default;
  ({ setAnthropic } = await import('../api/tickets.mjs'));
  ana = await usuario(db.sql, 'ana@x.com', 'Ana');
});
let n = 0;
async function cargar(lugar) {
  const total = 2000 + ++n;
  const respuesta = {
    lugar: { cadena: 'Carrefour', sucursal: null, direccion: null, ciudad: null, punto_venta: null, cuit: '30-68731043-4', ...lugar },
    fecha: '2026-10-20', total, subtotal: null, ahorro: null, recargos: null, iva_aparte: false, columnas: [],
    renglones: [{ foto: 1, texto: `COSA ${n}`, cantidad: 1, unidad: 'u', precio_unitario: total, importe: total, descuento: 0, iva: null, ean: null, marca: null, nombre: `Cosa ${n}`, medida_cantidad: null, medida_unidad: null }],
    descartados: [], avisos: [],
  };
  const stream = (p) => ({ finalMessage: async () => ({ model: p.model, stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'text', text: JSON.stringify(respuesta) }] }) });
  setAnthropic({ messages: { stream }, beta: { messages: { stream } } });
  const { data: { lectura } } = await pedir(worker, ana, 'POST', '/api/tickets/leer', { fotos: ['data:image/jpeg;base64,AAAA'] });
  const r = await pedir(worker, ana, 'POST', '/api/tickets', {
    fecha: lectura.fecha, total, lugar: lectura.lugar, renglones: lectura.renglones.map((x) => ({ ...x, producto_id: null, nuevo: { nombre: x.nombre } })),
  });
  assert.equal(r.status, 201);
  return (await db.sql('select l.* from tickets t join lugares l on l.id = t.lugar_id where t.id = ?1', [r.data.id]))[0];
}

test('al guardar un ticket con dirección, el lugar queda con su punto (y la ciudad que dice Georef)', async () => {
  setGeoFetch(async () => Response.json({ direcciones: [CABILDO] }));
  const l = await cargar({ direccion: 'Av. Cabildo 2200' });
  assert.equal(l.lat, -34.561085);
  assert.equal(l.ciudad, 'CABA');
  assert.ok(l.geo_at);
});

test('sin dirección no se busca; si Georef no contesta, queda para el próximo boot', async () => {
  let llamadas = 0;
  setGeoFetch(async () => { llamadas++; throw new Error('sin red'); });
  const sinDir = await cargar({ punto_venta: '0101' });
  assert.equal(llamadas, 0);
  assert.equal(sinDir.geo_at, null);
  const l = await cargar({ direccion: 'Mitre 10', ciudad: 'Rosario', cuit: null, cadena: 'Día' });
  assert.equal(l.geo_at, null); // no se anotó: se reintenta
  setGeoFetch(async () => Response.json({ direcciones: [dir(-32.94, -60.64, 'Rosario', 'Rosario', 'Santa Fe')] }));
  const b = await pedir(worker, ana, 'GET', '/api/boot');
  assert.equal(b.status, 200);
  assert.equal((await db.sql('select lat from lugares where id = ?1', [l.id]))[0].lat, -32.94);
});

test('poner la dirección desde la ficha busca el punto antes de contestar; si no la encuentra, lo dice', async () => {
  const [l] = await db.sql("select id from lugares where punto_venta = '101'");
  setGeoFetch(async () => Response.json({ direcciones: [dir(-34.5, -58.5, CABA, 'Comuna 12', CABA)] }));
  const r = await pedir(worker, ana, 'PATCH', `/api/lugares/${l.id}`, { direccion: 'Av. Cabildo 4000', ciudad: 'CABA' });
  assert.equal(r.status, 200);
  assert.equal(r.data.lugar.lat, -34.5);
  // Otra dirección que Georef no tiene: sin punto, pero anotado que se buscó.
  setGeoFetch(async () => Response.json({ direcciones: [] }));
  const r2 = await pedir(worker, ana, 'PATCH', `/api/lugares/${l.id}`, { direccion: 'Calle Inventada 1' });
  assert.equal(r2.data.lugar.lat, null);
  assert.ok(r2.data.lugar.geo_at);
  // Cambiar sólo la sucursal no la vuelve a buscar.
  let llamadas = 0;
  setGeoFetch(async () => { llamadas++; return Response.json({ direcciones: [] }); });
  await pedir(worker, ana, 'PATCH', `/api/lugares/${l.id}`, { sucursal: 'Cabildo' });
  assert.equal(llamadas, 0);
});
