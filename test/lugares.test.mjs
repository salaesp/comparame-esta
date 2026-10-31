// Los lugares: reconocer la sucursal por la dirección o por el punto de venta, completarle
// lo que falte con cada ticket, corregirla desde su ficha (y juntarla con otra si ya
// existía) y la migración de las bases de antes de la 0.3.0. Contra una base real.
import assert from 'node:assert/strict';
import test, { before } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { baseNueva, usuario, pedir, makeD1 } from './helpers/d1.mjs';

const FOTO = 'data:image/jpeg;base64,AAAA';
const CUIT = '30-68731043-4';
let db, worker, ana, beto, setAnthropic;
before(async () => {
  db = await baseNueva();
  worker = (await import('../worker/index.js')).default;
  ({ setAnthropic } = await import('../api/tickets.mjs'));
  ana = await usuario(db.sql, 'ana@x.com', 'Ana');
  beto = await usuario(db.sql, 'beto@x.com', 'Beto');
});

// Un ticket de un renglón en el lugar que se diga; cada uno con otro total, así no es repetido.
let n = 0;
async function cargar(u, lugar) {
  const total = 1000 + ++n;
  const respuesta = {
    lugar: { cadena: 'Carrefour', sucursal: null, direccion: null, ciudad: null, punto_venta: null, cuit: CUIT, ...lugar },
    fecha: '2026-10-20', total, subtotal: null, ahorro: null, recargos: null, iva_aparte: false, columnas: [],
    renglones: [{ foto: 1, texto: `PRODUCTO ${n}`, cantidad: 1, unidad: 'u', precio_unitario: total, importe: total, descuento: 0, iva: null, ean: null, marca: null, nombre: `Producto ${n}`, medida_cantidad: null, medida_unidad: null }],
    descartados: [], avisos: [],
  };
  const stream = (p) => ({ finalMessage: async () => ({ model: p.model, stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: 'text', text: JSON.stringify(respuesta) }] }) });
  setAnthropic({ messages: { stream }, beta: { messages: { stream } } });
  const { data: { lectura } } = await pedir(worker, u, 'POST', '/api/tickets/leer', { fotos: [FOTO] });
  const r = await pedir(worker, u, 'POST', '/api/tickets', {
    fecha: lectura.fecha, total: lectura.total, lugar: lectura.lugar,
    renglones: lectura.renglones.map((x) => ({ ...x, producto_id: null, nuevo: { nombre: x.nombre } })),
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const [t] = await db.sql('select lugar_id from tickets where id = ?1', [r.data.id]);
  return { lectura, lugarId: t.lugar_id };
}
const lugar = async (id) => (await db.sql('select * from lugares where id = ?1', [id]))[0];

test('sin dirección, el punto de venta distingue la sucursal; con la dirección, se le completa', async () => {
  const a = await cargar(ana, { punto_venta: '08188' });
  assert.equal(a.lectura.lugar.existe, false);
  assert.equal((await lugar(a.lugarId)).punto_venta, '8188');
  // Otro ticket del mismo punto de venta: el mismo lugar.
  const b = await cargar(ana, { punto_venta: '8188' });
  assert.equal(b.lectura.lugar.existe, true);
  assert.equal(b.lugarId, a.lugarId);
  // Otro punto de venta, sin dirección: otra sucursal.
  const c = await cargar(ana, { punto_venta: '0101' });
  assert.notEqual(c.lugarId, a.lugarId);
  // Con la dirección y el punto de venta de la primera: es ella, y queda con su dirección y su ciudad.
  const d = await cargar(ana, { punto_venta: '8188', direccion: 'Av. Cabildo 2200', ciudad: 'C.A.B.A.' });
  assert.equal(d.lectura.lugar.existe, true);
  assert.equal(d.lugarId, a.lugarId);
  const l = await lugar(a.lugarId);
  assert.equal(l.direccion, 'Av. Cabildo 2200');
  assert.equal(l.ciudad, 'CABA');
  // Ahora la reconoce sólo por la dirección, aunque el ticket no traiga el punto de venta.
  const e = await cargar(ana, { direccion: 'AV CABILDO 2200' });
  assert.equal(e.lugarId, a.lugarId);
  // El boot trae la ciudad y el punto de venta.
  const boot = await pedir(worker, ana, 'GET', '/api/boot');
  const lb = boot.data.lugares.find((x) => x.id === a.lugarId);
  assert.equal(lb.ciudad, 'CABA');
  assert.equal(lb.punto_venta, '8188');
});

test('corregir un lugar desde su ficha: sólo quien cargó ahí; con una dirección que ya existe, se junta', async () => {
  const [{ lugar_id: cabildo }] = await db.sql("select lugar_id from lugar_claves where clave = 'cuit 30687310434|pv 8188'");
  const [{ lugar_id: pv101 }] = await db.sql("select lugar_id from lugar_claves where clave = 'cuit 30687310434|pv 101'");
  assert.equal((await pedir(worker, beto, 'PATCH', `/api/lugares/${pv101}`, { ciudad: 'Rosario' })).status, 404);
  // Sin chocar con otro: se corrige y queda la clave nueva.
  const r1 = await pedir(worker, ana, 'PATCH', `/api/lugares/${pv101}`, { ciudad: 'caba', sucursal: 'Cabildo' });
  assert.equal(r1.status, 200);
  assert.equal(r1.data.lugar.ciudad, 'CABA');
  // La dirección de la otra: avisa con cuál es, y con juntar se junta.
  const r2 = await pedir(worker, ana, 'PATCH', `/api/lugares/${pv101}`, { direccion: 'Av. Cabildo 2200' });
  assert.equal(r2.status, 409);
  assert.equal(r2.data.otro.id, cabildo);
  const antes = (await db.sql('select count(*) as n from tickets where lugar_id in (?1, ?2)', [cabildo, pv101]))[0].n;
  const r3 = await pedir(worker, ana, 'PATCH', `/api/lugares/${pv101}`, { direccion: 'Av. Cabildo 2200', juntar: cabildo });
  assert.equal(r3.status, 200);
  assert.equal(r3.data.juntado, cabildo);
  assert.equal(r3.data.lugar.sucursal, 'Cabildo'); // la otra no tenía sucursal: se la pone ésta
  assert.equal(await lugar(pv101), undefined);
  assert.equal((await db.sql('select count(*) as n from tickets where lugar_id = ?1', [cabildo]))[0].n, antes);
  assert.equal((await db.sql('select count(*) as n from precios where lugar_id = ?1', [pv101]))[0].n, 0);
  // El punto de venta del que se fue ahora reconoce al que quedó.
  const f = await cargar(ana, { punto_venta: '0101' });
  assert.equal(f.lugarId, cabildo);
});

test('cambiar el lugar de un ticket: a uno que ya existe, corrigiendo el lugar si es su único ticket, o a uno nuevo', async () => {
  const tk = async (lugarId) => (await db.sql('select id from tickets where lugar_id = ?1 order by created_at desc limit 1', [lugarId]))[0].id;
  // Un Día sin dirección, con un solo ticket: se le corrige el lugar ahí mismo (con el punto elegido).
  const dia = await cargar(ana, { cadena: 'Día', cuit: null, punto_venta: '0555' });
  const t1 = await tk(dia.lugarId);
  assert.equal((await pedir(worker, beto, 'PATCH', `/api/tickets/${t1}`, { lugar: { cadena: 'Día', direccion: 'Medrano 1235' } })).status, 404);
  assert.equal((await pedir(worker, ana, 'PATCH', `/api/tickets/${t1}`, { lugar: { cadena: 'Día' } })).status, 422);
  const r1 = await pedir(worker, ana, 'PATCH', `/api/tickets/${t1}`, { lugar: { cadena: 'Día', direccion: 'Avenida Medrano 1235', ciudad: 'CABA', lat: -34.6, lon: -58.42 } });
  assert.equal(r1.status, 200);
  assert.equal(r1.data.lugar_id, dia.lugarId);
  const l1 = await lugar(dia.lugarId);
  assert.deepEqual([l1.direccion, l1.ciudad, l1.lat], ['Avenida Medrano 1235', 'CABA', -34.6]);
  // Otro ticket de Día, mal reconocido en ese local: pasa a uno nuevo y el de Medrano queda igual.
  const otro = await cargar(ana, { cadena: 'Día', cuit: null, punto_venta: '0555' });
  assert.equal(otro.lugarId, dia.lugarId);
  const t2 = await tk(dia.lugarId);
  const r2 = await pedir(worker, ana, 'PATCH', `/api/tickets/${t2}`, { lugar: { cadena: 'Día', direccion: 'Rivadavia 7850', ciudad: 'CABA' } });
  assert.notEqual(r2.data.lugar_id, dia.lugarId);
  assert.equal((await lugar(dia.lugarId)).direccion, 'Avenida Medrano 1235');
  assert.equal((await db.sql('select count(*) as n from precios where ticket_id = ?1 and lugar_id = ?2', [t2, r2.data.lugar_id]))[0].n, 1);
  // Y de vuelta a Medrano: encuentra el que ya existe (no crea otro).
  const r3 = await pedir(worker, ana, 'PATCH', `/api/tickets/${t2}`, { lugar: { cadena: 'Día', direccion: 'Avenida Medrano 1235' } });
  assert.equal(r3.data.lugar_id, dia.lugarId);
});

test('una base de antes de la 0.3.0: suma las columnas y las claves de los lugares que ya estaban', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`create table lugares (id text primary key, cadena text not null default '', sucursal text not null default '',
    direccion text not null default '', cuit text not null default '', cadena_key text not null default '',
    lugar_key text not null unique, creado_por text, created_at text not null default '')`);
  sqlite.exec("insert into lugares (id, cadena, lugar_key) values ('viejo', 'Coto', 'coto|')");
  const dbm = await import('../lib/db.mjs');
  dbm.setDbEnv({ DB: makeD1(sqlite) });
  dbm.resetSchemaCheck();
  try {
    const [l] = await dbm.sql("select ciudad, punto_venta from lugares where id = 'viejo'");
    assert.deepEqual({ ...l }, { ciudad: '', punto_venta: '' });
    assert.deepEqual((await dbm.sql('select clave, lugar_id from lugar_claves')).map((r) => ({ ...r })), [{ clave: 'coto|', lugar_id: 'viejo' }]);
    // Otra vez no hace nada (ni se queja de las columnas que ya están).
    dbm.resetSchemaCheck();
    sqlite.exec('update schema_meta set version = 0');
    await dbm.sql('select 1');
  } finally {
    dbm.setDbEnv({ DB: makeD1(db.sqlite) });
  }
});
