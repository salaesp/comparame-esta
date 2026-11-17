// lib/online.mjs: los precios de las tiendas online, consultados al abrir la ficha de un
// producto. Las respuestas son de Carrefour y Jumbo de verdad, recortadas
// (test/fixtures/vtex-*.json); los tests nunca salen a la red (setOnlineFetch).
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { baseNueva, usuario, pedir } from './helpers/d1.mjs';
import { normalizarVtex, medidaDeTexto, setOnlineFetch, CADENAS_ONLINE, ONLINE_FRESCO_HORAS } from '../lib/online.mjs';

const fixture = (f) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url)));
const VTEX = fixture('vtex-carrefour.json');
const JUMBO = fixture('vtex-jumbo.json');
const copia = (x) => JSON.parse(JSON.stringify(x));
const porNombre = (n, de = VTEX) => copia(de.find((p) => p.productName.startsWith(n)));
const cadena = (n) => CADENAS_ONLINE.find((c) => c.nombre === n);
const PEPITAS = '7798133500605';
const TODAS = ['Carrefour', 'Jumbo', 'Disco', 'Vea', 'ChangoMás', 'DIA'];
const HOSTS = ['diaonline.supermercadosdia.com.ar', 'www.carrefour.com.ar', 'www.disco.com.ar', 'www.jumbo.com.ar', 'www.masonline.com.ar', 'www.vea.com.ar'];
// Abrir la ficha como la app: lo guardado enseguida y, si hay cadenas por consultar, …/online.
async function abrir(worker, u, id) {
  const ficha = await pedir(worker, u, 'GET', `/api/productos/${id}`);
  assert.equal(ficha.status, 200);
  if (!ficha.data.online_buscando.length) return { buscando: [], online: ficha.data.online, ficha };
  const o = await pedir(worker, u, 'GET', `/api/productos/${id}/online`);
  assert.equal(o.status, 200);
  return { buscando: ficha.data.online_buscando, online: o.data.online, ficha };
}
const LECHE = '7790742363008';
// Unas tiendas falsas: cada host contesta lo suyo ([] si no tiene nada) y se anotan los pedidos.
function tiendas(porHost) {
  const pedidos = [];
  setOnlineFetch(async (url) => {
    const u = new URL(url);
    pedidos.push(u.hostname);
    const r = porHost[u.hostname];
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r || []));
  });
  return pedidos;
}

test('normalizarVtex: precio, tachado, medida, por kg y sin las promos de tarjeta', () => {
  const [pepitas] = normalizarVtex(porNombre('Pepitas'));
  assert.deepEqual(pepitas, {
    sku: '50140', ean: PEPITAS, nombre: 'Pepitas artesanales dulce de leche', marca: '', medida: 200, medida_unidad: 'g',
    unidad: 'u', categoria: 'Panadería', url: 'https://www.carrefour.com.ar/pepitas-artesanales-dulce-de-leche-50140/p',
    precio: 3999, precio_lista: 5699, precio_medida: 19995, promos: '', disponible: 1, imagen: '',
  });
  // La leche: 1000 cm3 → 1 litro.
  const [leche] = normalizarVtex(porNombre('Leche La serenisima clásica'));
  assert.equal(leche.medida, 1000);
  assert.equal(leche.medida_unidad, 'ml');
  assert.equal(leche.precio_medida, leche.precio);
  assert.equal(leche.precio_lista, null);
  // La cebolla va por kg: el precio es el del kg y su código (empieza con 2) no es un EAN.
  const [cebolla] = normalizarVtex(porNombre('Cebolla'));
  assert.equal(cebolla.unidad, 'kg');
  assert.equal(cebolla.medida, null);
  assert.equal(cebolla.precio_medida, 2499);
  assert.equal(cebolla.ean, '');
  // Una promo para todos sí va; sin precio, el item no va.
  const licor = porNombre('Licor');
  licor.items[0].sellers[0].commertialOffer.PromotionTeasers.push({ Name: '2do al 70%', Conditions: { Parameters: [] } });
  assert.equal(normalizarVtex(licor)[0].promos, '2do al 70%');
  licor.items[0].sellers[0].commertialOffer.Price = 0;
  assert.deepEqual(normalizarVtex(licor), []);
});

test('Jumbo, Disco y Vea: el ListPrice roto no es un tachado y la medida sale del contenido o del nombre', () => {
  const j = cadena('Jumbo');
  const [leche] = normalizarVtex(porNombre('Leche Uat Serenisima', JUMBO), j);
  assert.equal(leche.precio, 3031);
  assert.equal(leche.precio_lista, null); // ListPrice 250.496
  assert.equal(leche.marca, 'La Serenisima'); // venía en mayúsculas
  assert.equal(leche.medida, 1000); // "Contenido Neto": "1 Lts"
  assert.equal(leche.medida_unidad, 'ml');
  // Sin "Contenido Neto", del nombre ("Bot 1l").
  assert.equal(normalizarVtex(porNombre('Leche La Serenisima Liviana', JUMBO), j)[0].medida, 1000);
  // El contenido gana al nombre ("X 4 Un", 268 Gr).
  const [panq] = normalizarVtex(porNombre('Panqueques', JUMBO), j);
  assert.deepEqual([panq.medida, panq.medida_unidad], [268, 'g']);
  // Por kg, como en Carrefour.
  const [banana] = normalizarVtex(porNombre('Banana Ecuador', JUMBO), j);
  assert.deepEqual([banana.unidad, banana.precio_medida, banana.precio_lista], ['kg', 3499, null]);
  // Aunque se lea el ListPrice, uno de más de 5 veces el precio no vale.
  assert.equal(normalizarVtex(porNombre('Leche Uat Serenisima', JUMBO))[0].precio_lista, null);

  // ChangoMás: el "Gramaje" es la unidad del precio por medida (1 KG en un dulce de leche de
  // 400 g): la medida sale del nombre. Su ListPrice sí es el tachado.
  const CHANGO = fixture('vtex-changomas.json');
  const [dulce] = normalizarVtex(porNombre('Dulce De Leche Gandara', CHANGO), cadena('ChangoMás'));
  assert.deepEqual([dulce.medida, dulce.medida_unidad, dulce.precio, dulce.precio_lista], [400, 'g', 2399, 3699]);
  assert.equal(normalizarVtex(porNombre('Banana 1 Kg', CHANGO), cadena('ChangoMás'))[0].unidad, 'kg');
  // DIA: el 2x1 es una promo para todos.
  const DIA = fixture('vtex-dia.json');
  const [bananita] = normalizarVtex(porNombre('Nestle Bananita', DIA), cadena('DIA'));
  assert.deepEqual([bananita.promos, bananita.medida, bananita.ean], ['2x1', 30, '77988263']);
  assert.equal(normalizarVtex(porNombre('Leche Protein', DIA), cadena('DIA'))[0].medida, 1000);

  assert.deepEqual(medidaDeTexto('Leche Uat Serenisima 3 - 1 Lt'), { medida: 1000, unidad: 'ml' });
  assert.deepEqual(medidaDeTexto('Yerba Playadito 1,5 Kg'), { medida: 1500, unidad: 'g' });
  assert.deepEqual(medidaDeTexto('Barra Proteica Afa 43gr'), { medida: 43, unidad: 'g' });
  assert.equal(medidaDeTexto('Banana X Un'), null);
  assert.equal(medidaDeTexto('Leche Entera 3%'), null);
});

test('la ficha se abre sin esperar a las webs; …/online trae lo de Carrefour, lo guarda un día y sigue el historial', async () => {
  const { sql } = await baseNueva();
  const worker = (await import('../worker/index.js')).default;
  const ana = await usuario(sql, 'ana@x.com');
  const [p] = await sql("insert into productos (nombre, ean, medida, medida_unidad, creado_por) values ('Pepitas', ?1, 200, 'g', ?2) returning id", [PEPITAS, ana.id]);
  const [sinEan] = await sql("insert into productos (nombre) values ('Banana') returning id");

  const urls = [];
  let respuesta = [porNombre('Pepitas')];
  // Sólo Carrefour lo tiene.
  setOnlineFetch(async (url) => {
    urls.push(String(url));
    return new Response(new URL(url).hostname === 'www.carrefour.com.ar' ? JSON.stringify(respuesta) : '[]');
  });
  const aCarrefour = () => urls.filter((u) => u.includes('carrefour')).length;

  // La ficha sola no sale a las webs: dice a cuáles hay que preguntarles.
  const ficha = await pedir(worker, ana, 'GET', `/api/productos/${p.id}`);
  assert.deepEqual(ficha.data.online, []);
  assert.deepEqual(ficha.data.online_buscando, TODAS);
  assert.equal(urls.length, 0);

  let r = await abrir(worker, ana, p.id);
  assert.deepEqual(urls.map((u) => new URL(u).hostname).sort(), HOSTS);
  assert.ok(urls.includes('https://www.carrefour.com.ar/api/catalog_system/pub/products/search?fq=alternateIds_Ean:7798133500605')); // uno solo: sin _from/_to
  assert.equal(r.online.length, 1);
  assert.equal(r.online[0].cadena, 'Carrefour');
  assert.equal(r.online[0].precio, 3999);
  assert.equal(r.online[0].precio_lista, 5699);

  // Otra vez enseguida: ya viene en la ficha y no se busca. Sin EAN, nunca.
  r = await abrir(worker, ana, p.id);
  assert.deepEqual(r.buscando, []);
  assert.equal(aCarrefour(), 1);
  assert.equal(r.online[0].precio, 3999);
  r = await abrir(worker, ana, sinEan.id);
  assert.deepEqual(r.buscando, []);
  assert.deepEqual(r.online, []);
  assert.equal((await pedir(worker, ana, 'GET', `/api/productos/${sinEan.id}/online`)).data.online.length, 0);
  assert.equal(aCarrefour(), 1);

  // Pasado un día, sí; con otro precio: se actualiza y queda en el historial.
  const viejo = new Date(Date.now() - (ONLINE_FRESCO_HORAS + 1) * 3600_000).toISOString();
  await sql('update online_consultas set consultado_at = ?1', [viejo]);
  await sql('update online_productos set cambio_at = ?1, visto_at = ?1', [viejo]);
  respuesta = [porNombre('Pepitas')];
  respuesta[0].items[0].sellers[0].commertialOffer.Price = 4299;
  r = await abrir(worker, ana, p.id);
  assert.equal(r.ficha.data.online[0].precio, 3999); // lo guardado, mientras busca
  assert.equal(aCarrefour(), 2);
  assert.equal(r.online[0].precio, 4299);
  assert.ok(r.online[0].cambio_at > viejo);
  const hist = await sql('select precio from online_historial order by desde');
  assert.deepEqual(hist.map((h) => h.precio), [3999, 4299]);

  // El mismo precio otra vez: visto_at avanza, cambio_at y el historial no.
  await sql('update online_consultas set consultado_at = ?1', [viejo]);
  const [antes] = await sql('select cambio_at from online_productos');
  await abrir(worker, ana, p.id);
  const [despues] = await sql('select cambio_at, visto_at from online_productos');
  assert.equal(despues.cambio_at, antes.cambio_at);
  assert.ok(despues.visto_at > antes.cambio_at);
  assert.equal((await sql('select count(*) as n from online_historial'))[0].n, 2);
});

test('si la tienda no lo tiene, se anota y no se pregunta de nuevo; si no contesta, sí', async () => {
  const { sql } = await baseNueva();
  const worker = (await import('../worker/index.js')).default;
  const ana = await usuario(sql, 'ana@x.com');
  const [p] = await sql("insert into productos (nombre, ean) values ('Pepitas', ?1) returning id", [PEPITAS]);

  // Jumbo no contesta; las otras no lo tienen.
  let pedidos = tiendas({ 'www.jumbo.com.ar': new Error('timeout') });
  let r = await abrir(worker, ana, p.id);
  assert.deepEqual(r.online, []);
  assert.equal(pedidos.length, 6);
  // La próxima, sólo a Jumbo.
  r = await abrir(worker, ana, p.id);
  assert.deepEqual(r.buscando, ['Jumbo']);
  assert.deepEqual(pedidos.slice(6), ['www.jumbo.com.ar']);

  pedidos = tiendas({});
  await abrir(worker, ana, p.id);
  r = await abrir(worker, ana, p.id);
  assert.deepEqual(r.buscando, []);
  assert.deepEqual(pedidos, ['www.jumbo.com.ar']);
  const cs = (await sql('select cadena, encontrados from online_consultas order by cadena')).map((x) => ({ ...x }));
  assert.deepEqual(cs, [...TODAS].sort().map((c) => ({ cadena: c, encontrados: 0 })));
});

test('la misma leche en varias cadenas: una por cadena, de la más barata a la más cara', async () => {
  const { sql } = await baseNueva();
  const worker = (await import('../worker/index.js')).default;
  const ana = await usuario(sql, 'ana@x.com');
  const [p] = await sql("insert into productos (nombre, ean, medida, medida_unidad) values ('Leche', ?1, 1000, 'ml') returning id", [LECHE]);
  const leche = porNombre('Leche Uat Serenisima', JUMBO);
  const enVea = copia(leche);
  enVea.items[0].sellers[0].commertialOffer.Price = 2990;
  enVea.link = 'https://www.vea.com.ar/leche-uat-serenisima-3-1-lt/p';
  tiendas({ 'www.jumbo.com.ar': [leche], 'www.disco.com.ar': [leche], 'www.vea.com.ar': [enVea] });
  const r = await abrir(worker, ana, p.id);
  assert.deepEqual(r.online.map((o) => [o.cadena, o.precio]), [['Vea', 2990], ['Disco', 3031], ['Jumbo', 3031]]);
  assert.equal(r.online[0].url, 'https://www.vea.com.ar/leche-uat-serenisima-3-1-lt/p');
  // El mismo sku en dos cadenas son dos productos distintos.
  assert.equal((await sql('select count(*) as n from online_productos'))[0].n, 3);
});

test('sin EAN: "¿Es alguno de estos?" busca en las webs por texto; elegir uno le pone el código', async () => {
  const { sql } = await baseNueva();
  const worker = (await import('../worker/index.js')).default;
  const ana = await usuario(sql, 'ana@x.com');
  const [p] = await sql("insert into productos (nombre, marca, medida, medida_unidad, creado_por) values ('Yerba mate suave', 'Playadito', 1000, 'g', ?1) returning id", [ana.id]);
  const YERBA = fixture('vtex-buscar-yerba.json');
  // En Jumbo, la misma Playadito sin stock (con el precio viejo).
  const sinStock = copia(YERBA[0]);
  Object.assign(sinStock.items[0].sellers[0].commertialOffer, { AvailableQuantity: 0, IsAvailable: false });
  const urls = [];
  setOnlineFetch(async (url) => {
    urls.push(String(url));
    const h = new URL(url).hostname;
    return new Response(JSON.stringify(h === 'www.carrefour.com.ar' ? YERBA : h === 'www.jumbo.com.ar' ? [sinStock] : []));
  });

  const r = await pedir(worker, ana, 'GET', `/api/productos/${p.id}/parecidos`);
  assert.equal(r.status, 200);
  assert.equal(urls.length, 6);
  assert.ok(urls.includes('https://www.carrefour.com.ar/api/catalog_system/pub/products/search?ft=Playadito%20Yerba%20mate%20suave%201%20kg&_from=0&_to=9'));
  // Sólo la Playadito: las otras son de otra marca (Romance, Unión, Amanda…).
  assert.deepEqual(r.data.parecidos.map((x) => x.ean), ['7793704000928']);
  const [x] = r.data.parecidos;
  assert.deepEqual(x.cadenas, ['Carrefour']); // en Jumbo no hay stock
  assert.equal(x.medida, 1000);
  assert.match(x.imagen, /^https:\/\/carrefourar\.vteximg\.com\.br\//);
  assert.equal(x.precio, undefined);

  // Elegirlo es ponerle el EAN: desde ahí la ficha busca por el código en todas.
  const e = await pedir(worker, ana, 'PATCH', `/api/productos/${p.id}`, { ean: x.ean });
  assert.equal(e.status, 200);
  assert.equal(e.data.producto.ean, '7793704000928');
  const f = await pedir(worker, ana, 'GET', `/api/productos/${p.id}`);
  assert.deepEqual(f.data.online_buscando, TODAS);
  // Con EAN ya no ofrece parecidos.
  assert.deepEqual((await pedir(worker, ana, 'GET', `/api/productos/${p.id}/parecidos`)).data.parecidos, []);
});

test('lo sin stock va al final aunque su precio (el de cuando se vendía) sea el más bajo', async () => {
  const { sql } = await baseNueva();
  const worker = (await import('../worker/index.js')).default;
  const ana = await usuario(sql, 'ana@x.com');
  const [p] = await sql("insert into productos (nombre, ean) values ('Leche', ?1) returning id", [LECHE]);
  const leche = porNombre('Leche Uat Serenisima', JUMBO);
  const vieja = copia(leche);
  Object.assign(vieja.items[0].sellers[0].commertialOffer, { Price: 700, AvailableQuantity: 0, IsAvailable: false });
  tiendas({ 'www.jumbo.com.ar': [leche], 'www.vea.com.ar': [vieja] });
  const r = await abrir(worker, ana, p.id);
  assert.deepEqual(r.online.map((o) => [o.cadena, o.precio, o.disponible]), [['Jumbo', 3031, 1], ['Vea', 700, 0]]);
});

test('al abrir la app, los productos con código y sin foto se buscan solos: un pedido por cadena con todos', async () => {
  const { sql } = await baseNueva();
  const worker = (await import('../worker/index.js')).default;
  const ana = await usuario(sql, 'ana@x.com');
  const hoy = new Date().toISOString().slice(0, 10);
  const conFoto = (n) => { const x = porNombre(n); x.items[0].images = [{ imageUrl: `https://carrefourar.vteximg.com.br/arquivos/ids/1/${x.items[0].ean}.jpg` }]; return x; };
  // Dos productos con código en un ticket de Ana (los que trae /api/boot) y uno sin código.
  const [t] = await sql("insert into tickets (user_id, fecha) values (?1, ?2) returning id", [ana.id, hoy]);
  const prods = [];
  for (const [nombre, ean] of [['Pepitas', PEPITAS], ['Leche', LECHE], ['Banana', '']]) {
    const [p] = await sql('insert into productos (nombre, ean) values (?1, ?2) returning id', [nombre, ean]);
    await sql("insert into precios (ticket_id, user_id, producto_id, fecha, texto, cantidad, importe, pagado, precio_unit) values (?1, ?2, ?3, ?4, 'x', 1, 100, 100, 100)", [t.id, ana.id, p.id, hoy]);
    prods.push(p);
  }
  const urls = [];
  setOnlineFetch(async (url) => {
    urls.push(String(url));
    const u = new URL(url);
    return new Response(JSON.stringify(u.hostname === 'www.carrefour.com.ar' ? [conFoto('Pepitas')] : u.hostname === 'www.jumbo.com.ar' ? [porNombre('Leche Uat Serenisima', JUMBO)] : []));
  });

  let b = await pedir(worker, ana, 'GET', '/api/boot');
  assert.equal(b.status, 200);
  assert.equal(urls.length, 6); // uno por cadena, con los dos códigos
  const aCarrefour = new URL(urls.find((u) => u.includes('carrefour')));
  assert.deepEqual(aCarrefour.searchParams.getAll('fq').sort(), [`alternateIds_Ean:${LECHE}`, `alternateIds_Ean:${PEPITAS}`]);
  assert.equal(aCarrefour.searchParams.get('_to'), '3');
  // Lo de Jumbo (sin foto) y lo de Carrefour (con foto) quedó guardado; las consultas, por EAN.
  assert.equal((await sql('select count(*) as n from online_productos'))[0].n, 2);
  const cs = await sql("select ean, encontrados from online_consultas where cadena = 'Jumbo' order by ean");
  assert.deepEqual(cs.map((x) => [x.ean, x.encontrados]), [[LECHE, 1], [PEPITAS, 0]].sort());

  // En el próximo boot, las Pepitas ya tienen foto y no se vuelven a buscar (la leche se
  // consultó hace nada en todas: tampoco, aunque no tenga foto).
  b = await pedir(worker, ana, 'GET', '/api/boot');
  assert.equal(urls.length, 6);
  const foto = Object.fromEntries(b.data.productos.map((p) => [p.nombre, p.foto]));
  assert.equal(foto.Pepitas, `https://carrefourar.vteximg.com.br/arquivos/ids/1/${PEPITAS}.jpg`);
  assert.equal(foto.Leche, null);
  assert.equal(foto.Banana, null);
  // La ficha también trae la foto.
  assert.equal((await pedir(worker, ana, 'GET', `/api/productos/${prods[0].id}`)).data.producto.foto, foto.Pepitas);
});

test('lo consultado antes de guardar las fotos se vuelve a consultar (con la versión nueva del schema)', async () => {
  const { sql } = await baseNueva();
  const { MIGRATIONS } = await import('../lib/schema.mjs');
  const ahora = new Date().toISOString();
  await sql("insert into online_productos (cadena, sku, ean, nombre, precio, visto_at, cambio_at) values ('Carrefour', '1', ?1, 'Pepitas', 3999, ?2, ?2)", [PEPITAS, ahora]);
  await sql("insert into online_productos (cadena, sku, ean, nombre, precio, imagen, visto_at, cambio_at) values ('Jumbo', '2', ?1, 'Leche', 3031, 'https://x/y.jpg', ?2, ?2)", [LECHE, ahora]);
  for (const c of ['Carrefour', 'Jumbo']) for (const e of [PEPITAS, LECHE]) await sql('insert into online_consultas (cadena, ean, consultado_at) values (?1, ?2, ?3)', [c, e, ahora]);
  await sql(MIGRATIONS.find((m) => m.startsWith('delete from online_consultas')));
  assert.deepEqual((await sql('select distinct ean from online_consultas')).map((r) => r.ean), [LECHE]);
});

test('el código de un producto sin código se lo pone también un amigo que lo ve; lo demás, no', async () => {
  const { sql } = await baseNueva();
  const worker = (await import('../worker/index.js')).default;
  const ana = await usuario(sql, 'ana@x.com');
  const beto = await usuario(sql, 'beto@x.com');
  const carla = await usuario(sql, 'carla@x.com');
  const [a, b] = ana.id < beto.id ? [ana.id, beto.id] : [beto.id, ana.id];
  await sql('insert into amistades (user_a, user_b) values (?1, ?2)', [a, b]);
  const hoy = new Date().toISOString().slice(0, 10);
  const [t] = await sql('insert into tickets (user_id, fecha) values (?1, ?2) returning id', [ana.id, hoy]);
  const [p] = await sql("insert into productos (nombre, creado_por) values ('Yerba', ?1) returning id", [ana.id]);
  await sql("insert into precios (ticket_id, user_id, producto_id, fecha, texto, cantidad, importe, pagado, precio_unit) values (?1, ?2, ?3, ?4, 'x', 1, 100, 100, 100)", [t.id, ana.id, p.id, hoy]);

  // Carla no lo ve: nada. Beto (amigo) no le cambia el nombre…
  assert.equal((await pedir(worker, carla, 'PATCH', `/api/productos/${p.id}`, { ean: '7793704000928' })).status, 404);
  assert.equal((await pedir(worker, beto, 'PATCH', `/api/productos/${p.id}`, { nombre: 'Otra' })).status, 404);
  assert.equal((await pedir(worker, beto, 'PATCH', `/api/productos/${p.id}`, { ean: '7793704000928', nombre: 'Otra' })).status, 404);
  // …pero sí le pone el código que le falta.
  const r = await pedir(worker, beto, 'PATCH', `/api/productos/${p.id}`, { ean: '7793704000928' });
  assert.equal(r.status, 200);
  assert.equal(r.data.producto.ean, '7793704000928');
  assert.equal(r.data.producto.nombre, 'Yerba');
  // Uno que ya tiene código no lo pisa (Ana, que lo cargó, sí lo corrige).
  assert.equal((await pedir(worker, beto, 'PATCH', `/api/productos/${p.id}`, { ean: '7798133500605' })).status, 404);
  assert.equal((await pedir(worker, ana, 'PATCH', `/api/productos/${p.id}`, { ean: '7798133500605' })).status, 200);
});

test('la tarea programada busca sola los productos con código: primero los sin foto, después los de precio viejo', async () => {
  const { sql } = await baseNueva();
  const worker = (await import('../worker/index.js')).default;
  const { completarOnline } = await import('../lib/online.mjs');
  const viejo = new Date(Date.now() - (ONLINE_FRESCO_HORAS + 1) * 3600_000).toISOString();
  const muyViejo = new Date(Date.now() - 3 * 864e5).toISOString();
  // Tres productos del catálogo (de nadie en particular): la leche ya tiene foto y se
  // consultó hace 3 días; la yerba, sin foto y hace un día; las pepitas, nunca.
  for (const [n, e] of [['Leche', LECHE], ['Yerba', '7793704000928'], ['Pepitas', PEPITAS], ['Banana', '']]) await sql('insert into productos (nombre, ean) values (?1, ?2)', [n, e]);
  await sql("insert into online_productos (cadena, sku, ean, nombre, precio, imagen, visto_at, cambio_at) values ('Jumbo', '1', ?1, 'Leche', 3031, 'https://x/l.jpg', ?2, ?2)", [LECHE, muyViejo]);
  for (const c of TODAS) {
    await sql('insert into online_consultas (cadena, ean, consultado_at) values (?1, ?2, ?3)', [c, LECHE, muyViejo]);
    await sql('insert into online_consultas (cadena, ean, consultado_at) values (?1, ?2, ?3)', [c, '7793704000928', viejo]);
  }
  const pedidos = [];
  setOnlineFetch(async (url) => { pedidos.push(new URL(url).searchParams.getAll('fq').map((f) => f.split(':')[1])); return new Response('[]'); });

  // De a uno: las pepitas (nunca), la yerba (sin foto), la leche (con foto, aunque sea la más vieja).
  assert.equal(await completarOnline({ max: 1 }), 1);
  assert.deepEqual(pedidos.pop(), [PEPITAS]);
  assert.equal(await completarOnline({ max: 1 }), 1);
  assert.deepEqual(pedidos.pop(), ['7793704000928']);
  assert.equal(await completarOnline({ max: 1 }), 1);
  assert.deepEqual(pedidos.pop(), [LECHE]);
  assert.equal(await completarOnline(), 0); // todo fresco

  // El Worker lo corre en su handler `scheduled`.
  await sql('update online_consultas set consultado_at = ?1', [viejo]);
  const espera = [];
  pedidos.length = 0;
  await worker.scheduled({ cron: '23 */3 * * *' }, {}, { waitUntil: (p) => espera.push(p) });
  await Promise.all(espera);
  assert.equal(pedidos.length, TODAS.length); // un pedido por cadena, con los tres códigos
  assert.equal(pedidos[0].length, 3);
});

test('los parecidos se buscan una vez y quedan guardados; cambiar el nombre los vuelve a buscar; lo por peso, nunca', async () => {
  const { sql } = await baseNueva();
  const worker = (await import('../worker/index.js')).default;
  const ana = await usuario(sql, 'ana@x.com');
  const hoy = new Date().toISOString().slice(0, 10);
  const [t] = await sql('insert into tickets (user_id, fecha) values (?1, ?2) returning id', [ana.id, hoy]);
  const [yerba] = await sql("insert into productos (nombre, marca, medida, medida_unidad, creado_por) values ('Yerba mate suave', 'Playadito', 1000, 'g', ?1) returning id", [ana.id]);
  const [banana] = await sql("insert into productos (nombre, creado_por) values ('Banana', ?1) returning id", [ana.id]);
  const precio = (pid, unidad) => sql("insert into precios (ticket_id, user_id, producto_id, fecha, texto, cantidad, unidad, importe, pagado, precio_unit) values (?1, ?2, ?3, ?4, 'x', 1, ?5, 100, 100, 100)", [t.id, ana.id, pid, hoy, unidad]);
  await precio(yerba.id, 'u');
  await precio(banana.id, 'kg');
  const YERBA = fixture('vtex-buscar-yerba.json');
  let n = 0;
  setOnlineFetch(async (url) => { n++; return new Response(JSON.stringify(new URL(url).hostname === 'www.carrefour.com.ar' ? YERBA : [])); });

  // La ficha dice que hay que buscarlos; buscarlos los guarda.
  let f = await pedir(worker, ana, 'GET', `/api/productos/${yerba.id}`);
  assert.equal(f.data.parecidos_buscar, true);
  assert.deepEqual(f.data.parecidos, []);
  let r = await pedir(worker, ana, 'GET', `/api/productos/${yerba.id}/parecidos`);
  assert.deepEqual(r.data.parecidos.map((x) => x.ean), ['7793704000928']);
  assert.equal(n, 6);
  // La próxima, vienen en la ficha y no se sale a las webs.
  f = await pedir(worker, ana, 'GET', `/api/productos/${yerba.id}`);
  assert.equal(f.data.parecidos_buscar, false);
  assert.deepEqual(f.data.parecidos.map((x) => x.ean), ['7793704000928']);
  r = await pedir(worker, ana, 'GET', `/api/productos/${yerba.id}/parecidos`);
  assert.equal(n, 6);
  // Con otro nombre, se busca de nuevo; pasada una semana, también.
  await pedir(worker, ana, 'PATCH', `/api/productos/${yerba.id}`, { nombre: 'Yerba mate suave con palo' });
  assert.equal((await pedir(worker, ana, 'GET', `/api/productos/${yerba.id}`)).data.parecidos_buscar, true);
  await pedir(worker, ana, 'GET', `/api/productos/${yerba.id}/parecidos`);
  assert.equal(n, 12);
  await sql("update online_parecidos set buscado_at = '2020-01-01T00:00:00.000Z'");
  assert.equal((await pedir(worker, ana, 'GET', `/api/productos/${yerba.id}`)).data.parecidos_buscar, true);

  // La banana va por peso: ni se ofrece buscarla ni se busca.
  f = await pedir(worker, ana, 'GET', `/api/productos/${banana.id}`);
  assert.equal(f.data.parecidos_buscar, false);
  assert.deepEqual((await pedir(worker, ana, 'GET', `/api/productos/${banana.id}/parecidos`)).data.parecidos, []);
  assert.equal(n, 12);
});

test('buscar en las webs: uno por código, con el más barato con stock; se guarda unas horas y los precios quedan', async () => {
  const { sql } = await baseNueva();
  const worker = (await import('../worker/index.js')).default;
  const ana = await usuario(sql, 'ana@x.com');
  const YERBA = fixture('vtex-buscar-yerba.json');
  const enJumbo = copia(YERBA[0]); // la Playadito de 1 kg, más barata en Jumbo
  enJumbo.items[0].sellers[0].commertialOffer.Price = 4990;
  const urls = [];
  setOnlineFetch(async (url) => {
    urls.push(String(url));
    const h = new URL(url).hostname;
    return new Response(JSON.stringify(h === 'www.carrefour.com.ar' ? YERBA : h === 'www.jumbo.com.ar' ? [enJumbo] : []));
  });

  // Con menos de 3 letras, nada.
  assert.deepEqual((await pedir(worker, ana, 'GET', '/api/productos/web?q=ye')).data.resultados, []);
  assert.equal(urls.length, 0);

  const r = await pedir(worker, ana, 'GET', `/api/productos/web?q=${encodeURIComponent('yerba playadito')}`);
  assert.equal(r.status, 200);
  assert.equal(urls.length, 6);
  assert.ok(urls.some((u) => u.includes('ft=yerba%20playadito')));
  assert.deepEqual(r.data.cadenas, TODAS);
  const [primero, ...resto] = r.data.resultados;
  // Primero el que tiene las dos palabras; en dos cadenas, desde lo de Jumbo.
  assert.equal(primero.ean, '7793704000928');
  assert.equal(primero.desde, 4990);
  assert.equal(primero.cadenas, 2);
  assert.deepEqual(primero.ofertas.map((o) => [o.cadena, o.precio]), [['Jumbo', 4990], ['Carrefour', YERBA[0].items[0].sellers[0].commertialOffer.Price]]);
  assert.equal(resto.length, YERBA.length - 1);
  // Lo que trajo quedó como precio online (la ficha y la foto ya están).
  assert.equal((await sql('select count(*) as n from online_productos'))[0].n, YERBA.length + 1);

  // La misma búsqueda escrita distinto, enseguida: no sale a las webs.
  const r2 = await pedir(worker, ana, 'GET', `/api/productos/web?q=${encodeURIComponent('  Yerba PLAYADITO ')}`);
  assert.equal(urls.length, 6);
  assert.deepEqual(r2.data.resultados.map((x) => x.ean), r.data.resultados.map((x) => x.ean));

  // La ficha de la web: les pregunta a las que faltan y devuelve todo, con stock primero.
  urls.length = 0;
  const f = await pedir(worker, ana, 'GET', '/api/productos/web/7793704000928');
  assert.equal(f.status, 200);
  assert.equal(urls.length, 6); // ninguna se había consultado por el código
  assert.deepEqual(f.data.online.map((o) => o.cadena), ['Jumbo', 'Carrefour']);
  assert.equal((await pedir(worker, ana, 'GET', '/api/productos/web/123')).status, 422);
});
