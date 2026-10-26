// El flujo entero del server contra una base real (SQLite vía node:sqlite y el shim de
// D1): amigos por link, leer un ticket (con un Claude falso), guardarlo, quién ve qué,
// el alias que reconoce el producto en el próximo ticket, corregir y borrar.
import assert from 'node:assert/strict';
import test, { before } from 'node:test';
import { readFileSync } from 'node:fs';
import { baseNueva, usuario, pedir } from './helpers/d1.mjs';

const carrefour = JSON.parse(readFileSync(new URL('./fixtures/carrefour-3-fotos.json', import.meta.url)));
const FOTO = 'data:image/jpeg;base64,AAAA';

let db, worker, ana, beto, caro, setAnthropic;
before(async () => {
  db = await baseNueva();
  worker = (await import('../worker/index.js')).default;
  ({ setAnthropic } = await import('../api/tickets.mjs'));
  ana = await usuario(db.sql, 'ana@x.com', 'Ana');
  beto = await usuario(db.sql, 'beto@x.com', 'Beto');
  caro = await usuario(db.sql, 'caro@x.com', 'Caro');
});

const claude = (respuesta) => {
  const stream = (p) => ({ finalMessage: async () => ({ model: p.model, stop_reason: 'end_turn', usage: { input_tokens: 9000, output_tokens: 3000 }, content: [{ type: 'text', text: JSON.stringify(respuesta) }] }) });
  setAnthropic({ messages: { stream }, beta: { messages: { stream } } });
};

// Lo que mandaría la revisión sin tocar nada: cada renglón con su producto o uno nuevo.
const revisado = (lectura, extra = {}) => ({
  fecha: lectura.fecha || '2026-10-25',
  lugar: lectura.lugar.existe ? { id: lectura.lugar.id } : lectura.lugar,
  total: lectura.total,
  n_fotos: 3,
  renglones: lectura.renglones.map((r) => ({
    ...r,
    producto_id: r.producto?.id || null,
    nuevo: r.producto ? null : { nombre: r.nombre, marca: r.marca, medida: r.medida, medida_unidad: r.medida_unidad, ean: r.ean },
  })),
  ...extra,
});

test('sin sesión, 401', async () => {
  assert.equal((await pedir(worker, null, 'GET', '/api/boot')).status, 401);
  assert.equal((await pedir(worker, null, 'POST', '/api/tickets/leer', { fotos: [FOTO] })).status, 401);
});

test('amigos por link: se ve quién invita, se acepta una vez, el propio no', async () => {
  const { data: { link } } = await pedir(worker, ana, 'POST', '/api/amigos/link');
  const token = new URL(link.url).searchParams.get('amigo');
  assert.ok(token.startsWith('amg_'));
  assert.equal((await pedir(worker, ana, 'POST', '/api/amigos/aceptar', { token })).status, 422);
  const v = await pedir(worker, beto, 'GET', `/api/amigos/aceptar?token=${token}`);
  assert.equal(v.data.de.name, 'Ana');
  assert.equal(v.data.ya, false);
  assert.equal((await pedir(worker, beto, 'POST', '/api/amigos/aceptar', { token })).status, 200);
  assert.equal((await pedir(worker, caro, 'POST', '/api/amigos/aceptar', { token })).status, 404); // ya se usó
  const l = await pedir(worker, beto, 'GET', '/api/amigos');
  assert.deepEqual(l.data.amigos.map((a) => a.name), ['Ana']);
});

test('leer un ticket de tres fotos: lo cruza con el catálogo y controla el total', async () => {
  claude(carrefour.respuesta);
  const r = await pedir(worker, ana, 'POST', '/api/tickets/leer', { fotos: [FOTO, FOTO, FOTO], hoy: '2026-10-26' });
  assert.equal(r.status, 200);
  const { lectura } = r.data;
  assert.equal(lectura.renglones.length, 19);
  assert.equal(lectura.control.estado, 'ok');
  assert.equal(lectura.lugar.existe, false);
  assert.ok(lectura.renglones.every((x) => x.producto === null));
  assert.equal(lectura.renglones[0].medida, 500);
  assert.equal(lectura.renglones[17].medida, 1000); // 1 l de alcohol → 1000 ml
  const [{ n, costo }] = await db.sql('select count(*) as n, sum(costo_usd) as costo from lecturas');
  assert.equal(n, 1);
  assert.equal(costo, 0.0024);

  const g = await pedir(worker, ana, 'POST', '/api/tickets', revisado(lectura));
  assert.equal(g.status, 201);
  const [t] = await db.sql('select pagado, n_renglones from tickets where id = ?1', [g.data.id]);
  assert.deepEqual({ ...t }, { pagado: carrefour.pagado, n_renglones: 19 });
  // Los tres quesos son un solo producto nuevo.
  const quesos = await db.sql("select distinct producto_id from precios where texto like 'QUESO%'");
  assert.equal(quesos.length, 1);
  assert.equal((await db.sql('select count(*) as n from productos'))[0].n, 17);
});

test('el amigo ve el ticket; quien no es amigo, no', async () => {
  const b = await pedir(worker, beto, 'GET', '/api/boot');
  assert.equal(b.data.tickets.length, 1);
  assert.equal(b.data.precios.length, 19);
  assert.equal(b.data.lugares[0].cadena, 'Carrefour');
  assert.deepEqual(b.data.amigos.map((a) => a.name), ['Ana']);
  const c = await pedir(worker, caro, 'GET', '/api/boot');
  assert.equal(c.data.tickets.length, 0);
  assert.equal(c.data.precios.length, 0);
  const id = b.data.tickets[0].id;
  assert.equal((await pedir(worker, beto, 'GET', `/api/tickets/${id}`)).data.ticket.renglones.length, 19);
  assert.equal((await pedir(worker, caro, 'GET', `/api/tickets/${id}`)).status, 404);
  assert.equal((await pedir(worker, beto, 'DELETE', `/api/tickets/${id}`)).status, 404); // no es suyo
});

test('el mismo ticket otra vez (aunque con otra fecha): avisa, y se guarda sólo si se insiste', async () => {
  claude({ ...carrefour.respuesta, fecha: '2025-10-25' });
  const { data: { lectura } } = await pedir(worker, ana, 'POST', '/api/tickets/leer', { fotos: [FOTO, FOTO, FOTO], hoy: '2026-10-26' });
  const r = await pedir(worker, ana, 'POST', '/api/tickets', revisado(lectura));
  assert.equal(r.status, 409);
  assert.equal(r.data.duplicado.fecha, '2026-10-25'); // el que ya estaba, con su fecha
  const f = await pedir(worker, ana, 'POST', '/api/tickets', revisado(lectura, { forzar: true }));
  assert.equal(f.status, 201);
  assert.equal((await pedir(worker, ana, 'DELETE', `/api/tickets/${f.data.id}`)).status, 200);
});

test('los códigos de las piezas pesadas guardados de antes se borran con el schema', async () => {
  await db.sql("insert into productos (id, nombre, ean) values ('pz', 'Queso', '2506434002651')");
  const { SCHEMA_STATEMENTS } = await import('../lib/schema.mjs');
  for (const st of SCHEMA_STATEMENTS) db.sqlite.exec(st);
  assert.equal((await db.sql("select ean from productos where id = 'pz'"))[0].ean, '');
  await db.sql("delete from productos where id = 'pz'");
});

test('el próximo ticket de la misma cadena reconoce el producto solo (alias), aunque lo cargue otro', async () => {
  const r1 = carrefour.respuesta.renglones[0];
  claude({ ...carrefour.respuesta, fecha: '2026-10-26', subtotal: null, ahorro: null, total: 5200,
    renglones: [{ ...r1, cantidad: 1, importe: 5200, precio_unitario: 5200, nombre: 'otra cosa', marca: null }, { ...r1, texto: 'LECHE ENTERA LA SERENISIMA 1L', nombre: 'Leche entera', marca: 'La Serenísima', importe: 1500, cantidad: 1, precio_unitario: 1500 }] });
  const { data: { lectura } } = await pedir(worker, caro, 'POST', '/api/tickets/leer', { fotos: [FOTO] });
  assert.equal(lectura.lugar.existe, true);
  assert.equal(lectura.renglones[0].via, 'alias');
  assert.equal(lectura.renglones[0].producto.nombre, 'Fideos tirabuzón sin TACC');
  assert.equal(lectura.renglones[1].producto, null);
  assert.equal(lectura.control.estado, 'no_da'); // 6700 contra 5200
  assert.equal((await pedir(worker, caro, 'POST', '/api/tickets', revisado(lectura, { fecha: '2026-10-26' }))).status, 201);
  // Caro no es amiga de Ana: cada una ve sólo lo suyo, aunque el producto sea el mismo.
  const fid = lectura.renglones[0].producto.id;
  const pa = await pedir(worker, ana, 'GET', `/api/productos/${fid}`);
  assert.deepEqual(pa.data.precios.map((p) => p.precio_unit), [4999]);
  const pc = await pedir(worker, caro, 'GET', `/api/productos/${fid}`);
  assert.deepEqual(pc.data.precios.map((p) => p.precio_unit), [5200]);
});

test('buscar en el catálogo y corregir un producto (sólo quien lo creó o lo cargó)', async () => {
  const s = await pedir(worker, beto, 'GET', '/api/productos?q=fideos matarazzo');
  assert.equal(s.data.productos.length, 1);
  const id = s.data.productos[0].id;
  assert.equal((await pedir(worker, beto, 'PATCH', `/api/productos/${id}`, { nombre: 'Otro' })).status, 404);
  const e = await pedir(worker, ana, 'PATCH', `/api/productos/${id}`, { medida: 1, medida_unidad: 'kg', ean: '7790387000108' });
  assert.equal(e.status, 200);
  assert.equal(e.data.producto.medida, 1000);
  // El precio por kg de sus precios se recalcula con la medida nueva.
  const pm = await db.sql('select precio_unit, precio_medida from precios where producto_id = ?1 order by fecha', [id]);
  assert.deepEqual(pm.map((p) => p.precio_medida), [4999, 5200]);
  assert.equal((await pedir(worker, ana, 'PATCH', `/api/productos/${id}`, { ean: '123' })).status, 422);
});

test('borrar un ticket propio se lleva sus precios; quitar un amigo deja de mostrar los suyos', async () => {
  const { data: { tickets } } = await pedir(worker, ana, 'GET', '/api/boot');
  assert.equal((await pedir(worker, ana, 'DELETE', `/api/tickets/${tickets[0].id}`)).status, 200);
  assert.equal((await db.sql('select count(*) as n from precios where user_id = ?1', [ana.id]))[0].n, 0);
  assert.equal((await pedir(worker, ana, 'DELETE', `/api/amigos/${beto.id}`)).status, 200);
  assert.deepEqual((await pedir(worker, beto, 'GET', '/api/boot')).data.amigos, []);
});

test('con la lectura fallida responde con el motivo y anota la lectura', async () => {
  const stream = () => ({ finalMessage: async () => ({ model: 'claude-opus-5-5', stop_reason: 'refusal', usage: { input_tokens: 10, output_tokens: 0 }, content: [] }) });
  setAnthropic({ messages: { stream }, beta: { messages: { stream } } });
  const r = await pedir(worker, ana, 'POST', '/api/tickets/leer', { fotos: [FOTO] });
  assert.equal(r.status, 422);
  assert.equal(r.data.motivo, 'rechazo');
  assert.equal((await db.sql('select count(*) as n from lecturas where ok = 0'))[0].n, 1);
});
