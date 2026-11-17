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
    precio: 3999, precio_lista: 5699, precio_medida: 19995, promos: '', disponible: 1,
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

  assert.deepEqual(medidaDeTexto('Leche Uat Serenisima 3 - 1 Lt'), { medida: 1000, unidad: 'ml' });
  assert.deepEqual(medidaDeTexto('Yerba Playadito 1,5 Kg'), { medida: 1500, unidad: 'g' });
  assert.deepEqual(medidaDeTexto('Barra Proteica Afa 43gr'), { medida: 43, unidad: 'g' });
  assert.equal(medidaDeTexto('Banana X Un'), null);
  assert.equal(medidaDeTexto('Leche Entera 3%'), null);
});

test('la ficha de un producto con EAN trae lo de Carrefour, lo guarda un día y sigue el historial', async () => {
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
  const pedidos = { get length() { return urls.filter((u) => u.includes('carrefour')).length; } };

  let r = await pedir(worker, ana, 'GET', `/api/productos/${p.id}`);
  assert.equal(r.status, 200);
  assert.deepEqual(urls.map((u) => new URL(u).hostname).sort(), ['www.carrefour.com.ar', 'www.disco.com.ar', 'www.jumbo.com.ar', 'www.vea.com.ar']);
  assert.ok(urls.includes('https://www.carrefour.com.ar/api/catalog_system/pub/products/search?fq=alternateIds_Ean:7798133500605'));
  assert.equal(r.data.online.length, 1);
  assert.equal(r.data.online[0].cadena, 'Carrefour');
  assert.equal(r.data.online[0].precio, 3999);
  assert.equal(r.data.online[0].precio_lista, 5699);

  // Otra vez enseguida: no se le vuelve a preguntar. Sin EAN, nunca.
  r = await pedir(worker, ana, 'GET', `/api/productos/${p.id}`);
  assert.equal(pedidos.length, 1);
  assert.equal(r.data.online[0].precio, 3999);
  r = await pedir(worker, ana, 'GET', `/api/productos/${sinEan.id}`);
  assert.equal(pedidos.length, 1);
  assert.deepEqual(r.data.online, []);

  // Pasado un día, sí; con otro precio: se actualiza y queda en el historial.
  const viejo = new Date(Date.now() - (ONLINE_FRESCO_HORAS + 1) * 3600_000).toISOString();
  await sql('update online_consultas set consultado_at = ?1', [viejo]);
  await sql('update online_productos set cambio_at = ?1, visto_at = ?1', [viejo]);
  respuesta = [porNombre('Pepitas')];
  respuesta[0].items[0].sellers[0].commertialOffer.Price = 4299;
  r = await pedir(worker, ana, 'GET', `/api/productos/${p.id}`);
  assert.equal(pedidos.length, 2);
  assert.equal(r.data.online[0].precio, 4299);
  assert.ok(r.data.online[0].cambio_at > viejo);
  const hist = await sql('select precio from online_historial order by desde');
  assert.deepEqual(hist.map((h) => h.precio), [3999, 4299]);

  // El mismo precio otra vez: visto_at avanza, cambio_at y el historial no.
  await sql('update online_consultas set consultado_at = ?1', [viejo]);
  const [antes] = await sql('select cambio_at from online_productos');
  r = await pedir(worker, ana, 'GET', `/api/productos/${p.id}`);
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
  let r = await pedir(worker, ana, 'GET', `/api/productos/${p.id}`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.online, []);
  assert.equal(pedidos.length, 4);
  // La próxima, sólo a Jumbo.
  r = await pedir(worker, ana, 'GET', `/api/productos/${p.id}`);
  assert.deepEqual(pedidos.slice(4), ['www.jumbo.com.ar']);

  pedidos = tiendas({});
  await pedir(worker, ana, 'GET', `/api/productos/${p.id}`);
  await pedir(worker, ana, 'GET', `/api/productos/${p.id}`);
  assert.deepEqual(pedidos, ['www.jumbo.com.ar']);
  const cs = (await sql('select cadena, encontrados from online_consultas order by cadena')).map((x) => ({ ...x }));
  assert.deepEqual(cs, ['Carrefour', 'Disco', 'Jumbo', 'Vea'].map((c) => ({ cadena: c, encontrados: 0 })));
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
  const r = await pedir(worker, ana, 'GET', `/api/productos/${p.id}`);
  assert.deepEqual(r.data.online.map((o) => [o.cadena, o.precio]), [['Vea', 2990], ['Disco', 3031], ['Jumbo', 3031]]);
  assert.equal(r.data.online[0].url, 'https://www.vea.com.ar/leche-uat-serenisima-3-1-lt/p');
  // El mismo sku en dos cadenas son dos productos distintos.
  assert.equal((await sql('select count(*) as n from online_productos'))[0].n, 3);
});
