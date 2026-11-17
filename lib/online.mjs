// Los precios de las tiendas online de los súper, consultados en el momento: al abrir la
// ficha de un producto con EAN, se le pregunta a cada cadena (su buscador público de
// VTEX, el mismo que usa su web) y la respuesta se guarda ONLINE_FRESCO_HORAS. La prueba,
// test/online.test.mjs (los tests nunca salen a las tiendas: setOnlineFetch).
//
// Es aparte de los tickets: el precio online es el de la web (puede variar con la
// sucursal o el código postal) y no es de nadie.
//
//   online_productos   uno por cadena + sku, con su precio, visto_at (la última vez que
//                      la tienda lo devolvió) y cambio_at (desde cuándo tiene ese precio)
//   online_historial   un renglón por cada precio distinto (sólo cuando cambia)
//   online_consultas   cuándo se le preguntó a cada cadena por cada EAN (aunque no lo
//                      tuviera: así no se le vuelve a preguntar en cada ficha). Un error
//                      de red no anota nada: se pregunta de nuevo la próxima vez.
import { sql, txBatch } from './db.mjs';
import { eanValido, medidaDe, medidaLabel, precioMedida, tidyNombre, candidatos } from './productos.mjs';

// Las cadenas que se consultan. `nombre` es como se guarda y se muestra. Todas VTEX: sumar
// otra es sumar su renglón (y probar cómo vienen el tachado y la medida).
//   lista     de dónde sale el precio tachado. En Jumbo, Disco y Vea (Cencosud, la misma
//             web) el ListPrice no es un precio (una leche de $3.031 trae 250.496): sólo
//             vale PriceWithoutDiscount.
//   gramaje   si el "Gramaje de unidad de consumo" es el contenido (en Carrefour: 200 GRS
//             las Pepitas de 200 g). En ChangoMás es la unidad del precio por medida (1 KG
//             el dulce de leche de 400 g): ahí la medida sale del nombre.
const LISTA_VTEX = ['ListPrice', 'PriceWithoutDiscount'];
const LISTA_CENCOSUD = ['PriceWithoutDiscount'];
export const CADENAS_ONLINE = [
  { nombre: 'Carrefour', base: 'https://www.carrefour.com.ar', lista: LISTA_VTEX, gramaje: true },
  { nombre: 'Jumbo', base: 'https://www.jumbo.com.ar', lista: LISTA_CENCOSUD },
  { nombre: 'Disco', base: 'https://www.disco.com.ar', lista: LISTA_CENCOSUD },
  { nombre: 'Vea', base: 'https://www.vea.com.ar', lista: LISTA_CENCOSUD },
  { nombre: 'ChangoMás', base: 'https://www.masonline.com.ar', lista: LISTA_VTEX },
  { nombre: 'DIA', base: 'https://diaonline.supermercadosdia.com.ar', lista: LISTA_VTEX },
];
// Un tachado de más de LISTA_MAX veces el precio es un dato roto, no una oferta.
export const LISTA_MAX = 5;
export const ONLINE_FRESCO_HORAS = 24;
export const ONLINE_TIMEOUT_MS = 3000;

let _fetch = (...a) => fetch(...a);
// Para los tests: unas tiendas falsas.
export function setOnlineFetch(fn) { _fetch = fn; }

const round2 = (n) => Math.round(n * 100) / 100;
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const primero = (v) => (Array.isArray(v) ? v[0] : v);
const texto = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// Cómo escriben las unidades las tiendas → la unidad de medidaDe.
const UNIDADES_VTEX = { grm: 'g', grs: 'g', gr: 'g', g: 'g', kgm: 'kg', kgs: 'kg', kg: 'kg', cm3: 'ml', ml: 'ml', mlt: 'ml', cc: 'ml',
  ltr: 'l', lts: 'l', lt: 'l', l: 'l', uni: 'u', un: 'u', u: 'u' };

// La medida de un texto: "1 Lts", "300 Grs", "Leche Bot 1l", "Yerba 1,5 Kg". La última
// que aparezca (en "Serenisima 3 - 1 Lt", el 1 Lt). null si no dice.
const MEDIDA_RE = /(\d+(?:[.,]\d+)?)\s*(kgm|kgs|kg|grm|grs|gr|g|cm3|mlt|ml|cc|ltr|lts|lt|l|uni|un|u)(?![a-z])/gi;
export function medidaDeTexto(s) {
  const ms = [...norm(s).matchAll(MEDIDA_RE)];
  const m = ms[ms.length - 1];
  return m ? medidaDe(m[1].replace(',', '.'), UNIDADES_VTEX[m[2]]) : null;
}

// La medida de un producto: el "Gramaje" (Carrefour), el "Contenido Neto" (Cencosud) o el nombre.
function medidaVtex(p, nombre, cadena) {
  const uni = UNIDADES_VTEX[norm(primero(p['Gramaje de unidad de medida']))];
  return (cadena.gramaje ? medidaDe(primero(p['Gramaje de unidad de consumo']), uni) : null)
    || medidaDeTexto(primero(p['Contenido Neto']))
    || medidaDeTexto(nombre);
}

// Las promos que valen para todos (las de una tarjeta o un banco traen RestrictionsBins).
function promosDe(offer) {
  const ts = offer?.PromotionTeasers || [];
  const generales = ts.filter((t) => !(t?.Conditions?.Parameters || []).some((p) => p?.Name === 'RestrictionsBins'));
  return texto([...new Set(generales.map((t) => String(t?.Name || '').trim()).filter(Boolean))].join(' · '), 200);
}

// Un producto de VTEX → un renglón por cada item (sku) con precio. El precio es el de la
// web con sus promos para todos; precio_lista, el tachado (si es más, de los campos de
// `cadena.lista`).
export function normalizarVtex(p, cadena = CADENAS_ONLINE[0]) {
  const out = [];
  const marca = norm(p.brand) === 'generico' ? '' : tidyNombre(texto(p.brand, 60));
  const categoria = texto(String(primero(p.categories) || '').split('/').filter(Boolean)[0], 60);
  const url = /^https:\/\/[^\s"<>]+$/.test(String(p.link || '')) ? String(p.link).slice(0, 300) : '';
  for (const it of p.items || []) {
    const seller = (it.sellers || []).find((s) => s.sellerDefault) || it.sellers?.[0];
    const o = seller?.commertialOffer;
    const precio = Number(o?.Price);
    if (!(precio > 0) || !it.itemId) continue;
    const unidad = it.measurementUnit === 'kg' ? 'kg' : 'u';
    const nombre = tidyNombre(texto(it.nameComplete || it.name || p.productName, 160));
    const m = unidad === 'kg' ? null : medidaVtex(p, nombre, cadena);
    const lista = Math.max(0, ...(cadena.lista || LISTA_VTEX).map((k) => Number(o[k]) || 0));
    out.push({
      sku: texto(it.itemId, 40),
      ean: eanValido(it.ean),
      nombre,
      marca,
      medida: m?.medida ?? null,
      medida_unidad: m?.unidad ?? '',
      unidad,
      categoria,
      url,
      precio: round2(precio),
      precio_lista: lista > precio && lista <= precio * LISTA_MAX ? round2(lista) : null,
      precio_medida: precioMedida({ precio_unit: precio, unidad, medida: m?.medida, medida_unidad: m?.unidad }),
      promos: promosDe(o),
      disponible: o.AvailableQuantity > 0 || o.IsAvailable === true ? 1 : 0,
      // La foto: la del producto en la app y para elegir entre los parecidos.
      imagen: /^https:\/\/[^\s"<>]+$/.test(String(it.images?.[0]?.imageUrl || '')) ? String(it.images[0].imageUrl).slice(0, 300) : '',
    });
  }
  return out;
}

// Lo que tiene una cadena con esos EAN (uno o varios en un mismo pedido). Tira si la
// tienda no contesta.
export async function buscarEnVtex(cadena, eans) {
  // Sin _from/_to, VTEX devuelve hasta 10: con varios EAN se le piden todos (hasta 50).
  const fq = eans.map((e) => `fq=alternateIds_Ean:${encodeURIComponent(e)}`).join('&');
  const data = await vtex(cadena, eans.length > 1 ? `${fq}&_from=0&_to=${Math.min(49, eans.length * 2 - 1)}` : fq);
  return data.flatMap((p) => normalizarVtex(p, cadena)).filter((it) => eans.includes(it.ean));
}

// Un pedido al buscador de una cadena. Tira si la tienda no contesta.
async function vtex(cadena, query) {
  const res = await _fetch(`${cadena.base}/api/catalog_system/pub/products/search?${query}`, {
    signal: AbortSignal.timeout(ONLINE_TIMEOUT_MS),
    headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; comparame-esta)' },
  });
  if (!res.ok && res.status !== 206) throw new Error(`${cadena.nombre} ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error(`${cadena.nombre}: respuesta rara`);
  return data;
}

// ---------- Un producto sin EAN: "¿Es alguno de estos?" ----------
// Se lo busca por texto (marca + nombre + medida) en todas las cadenas y se ofrecen los
// PARECIDOS_MAX más parecidos con EAN: misma marca y misma medida si las dos la dicen, y
// palabras en común (candidatos de lib/productos.mjs, como "¿Ya existe?" en la revisión).
// Nunca se elige solo: quien lo confirma le pone ese EAN al producto (PATCH /api/productos/:id)
// y desde ahí se compara por el código en todas.
export const PARECIDOS_MAX = 3;
export const PARECIDOS_POR_CADENA = 10;
export const PARECIDOS_MIN = 0.34;
export const textoBusqueda = (p) => texto(`${p.marca || ''} ${p.nombre || ''} ${medidaLabel(p.medida, p.medida_unidad)}`, 120);

export async function parecidosOnline(p) {
  const q = textoBusqueda(p);
  if (!q) return [];
  const query = `ft=${encodeURIComponent(q)}&_from=0&_to=${PARECIDOS_POR_CADENA - 1}`;
  const res = await Promise.all(CADENAS_ONLINE.map((c) => vtex(c, query).then(
    (data) => data.flatMap((x) => normalizarVtex(x, c)).map((it) => ({ ...it, cadena: c.nombre })),
    (e) => { console.error('[online] parecidos', c.nombre, e?.message || e); return []; },
  )));
  // Uno por EAN (el mismo producto en varias cadenas), con las cadenas donde hay stock. El
  // precio no va: el de lo que no tiene stock es el de cuando se vendía.
  const porEan = new Map();
  for (const it of res.flat()) {
    if (!it.ean || it.unidad === 'kg') continue;
    const ya = porEan.get(it.ean) || porEan.set(it.ean, { ...it, cadenas: [] }).get(it.ean);
    if (it.disponible && !ya.cadenas.includes(it.cadena)) ya.cadenas.push(it.cadena);
    if (!ya.imagen) ya.imagen = it.imagen;
  }
  const orden = new Map(CADENAS_ONLINE.map((c, i) => [c.nombre, i]));
  return candidatos(p, [...porEan.values()], { max: PARECIDOS_MAX, min: PARECIDOS_MIN }).map(({ producto: x, score }) => ({
    ean: x.ean, nombre: x.nombre, marca: x.marca, medida: x.medida, medida_unidad: x.medida_unidad,
    imagen: x.imagen, cadenas: x.cadenas.sort((a, b) => orden.get(a) - orden.get(b)), score,
  }));
}

const COLS = ['sku', 'ean', 'nombre', 'marca', 'medida', 'medida_unidad', 'unidad', 'categoria', 'url',
  'precio', 'precio_lista', 'precio_medida', 'promos', 'disponible', 'imagen'];
// Los items como tabla: (select json_extract(value, '$.sku') as sku, …) j
const TABLA = `(select ${COLS.map((c) => `json_extract(value, '$.${c}') as ${c}`).join(', ')} from json_each(?2)) j`;
const CAMBIO = 'p.precio <> j.precio or ifnull(p.precio_lista, -1) <> ifnull(j.precio_lista, -1)';

// Guardar lo que devolvió una cadena: el historial de los que son nuevos o cambiaron de
// precio y el upsert (en este orden: el historial mira el precio de antes).
export function guardarOnlineStmts(cadena, items, ahora) {
  const params = [cadena, JSON.stringify(items), ahora];
  return [
    [`insert into online_historial (cadena, sku, precio, precio_lista, desde)
      select ?1, j.sku, j.precio, j.precio_lista, ?3
        from ${TABLA} left join online_productos p on p.cadena = ?1 and p.sku = j.sku
       where p.sku is null or ${CAMBIO}
      on conflict (cadena, sku, desde) do update set precio = excluded.precio, precio_lista = excluded.precio_lista`, params],
    [`insert into online_productos (cadena, ${COLS.join(', ')}, visto_at, cambio_at)
      select ?1, ${COLS.map((c) => `j.${c}`).join(', ')}, ?3, ?3 from ${TABLA} where true
      on conflict (cadena, sku) do update set
        ${COLS.filter((c) => c !== 'sku').map((c) => `${c} = excluded.${c}`).join(', ')},
        cambio_at = case when online_productos.precio <> excluded.precio
                           or ifnull(online_productos.precio_lista, -1) <> ifnull(excluded.precio_lista, -1)
                         then excluded.cambio_at else online_productos.cambio_at end,
        visto_at = excluded.visto_at`, params],
  ];
}

// La foto de un producto: la de las webs con su EAN (primero de una con stock). Va en los
// select de productos: `select …, ${FOTO_SQL} from productos`.
export const FOTO_SQL = `(select o.imagen from online_productos o where productos.ean <> '' and o.ean = productos.ean and o.imagen <> ''
  order by o.disponible desc limit 1) as foto`;

// Las cadenas a las que no se les preguntó por un EAN en las últimas ONLINE_FRESCO_HORAS,
// según sus filas de online_consultas (CONSULTAS_SQL).
export const CONSULTAS_SQL = 'select cadena, consultado_at from online_consultas where ean = ?1';
const desdeFresco = (ahora) => new Date(ahora.getTime() - ONLINE_FRESCO_HORAS * 3600_000).toISOString();
export function cadenasPorConsultar(consultas, ahora = new Date()) {
  const desde = desdeFresco(ahora);
  const frescas = new Set(consultas.filter((r) => r.consultado_at > desde).map((r) => r.cadena));
  return CADENAS_ONLINE.filter((c) => !frescas.has(c.nombre));
}

// Cuántos EAN por vez (van todos en un mismo pedido a cada cadena: VTEX acepta 40 sin problema).
export const ONLINE_POR_VEZ = 30;

// Pregunta por esos EAN (uno o varios) a las cadenas que no se consultaron hace poco y lo
// guarda: un pedido por cadena con los que le faltan, todas a la vez. La que no contesta
// queda para la próxima. Los EAN ya consultados en todas se saltean; de los otros, hasta
// ONLINE_POR_VEZ. Devuelve cuántos EAN se consultaron.
export async function actualizarOnline(eans, { ahora = new Date() } = {}) {
  const lista = [...new Set((Array.isArray(eans) ? eans : [eans]).map((e) => eanValido(e)).filter(Boolean))];
  if (!lista.length) return 0;
  const desde = desdeFresco(ahora);
  const frescas = await sql(`select ean, cadena from online_consultas
                              where ean in (select value from json_each(?1)) and consultado_at > ?2`, [JSON.stringify(lista), desde]);
  const fresca = new Set(frescas.map((r) => `${r.cadena}|${r.ean}`));
  const faltan = (c, e) => !fresca.has(`${c.nombre}|${e}`);
  const toca = lista.filter((e) => CADENAS_ONLINE.some((c) => faltan(c, e))).slice(0, ONLINE_POR_VEZ);
  if (!toca.length) return 0;
  const res = await Promise.all(CADENAS_ONLINE.map((c) => {
    const es = toca.filter((e) => faltan(c, e));
    if (!es.length) return null;
    return buscarEnVtex(c, es).then((items) => ({ c, es, items }), (e) => {
      console.error('[online]', c.nombre, es.join(','), e?.message || e);
      return null;
    });
  }));
  const iso = ahora.toISOString();
  const stmts = [];
  for (const { c, es, items } of res.filter(Boolean)) {
    if (items.length) stmts.push(...guardarOnlineStmts(c.nombre, items, iso));
    for (const e of es) {
      stmts.push([`insert into online_consultas (cadena, ean, consultado_at, encontrados) values (?1, ?2, ?3, ?4)
                   on conflict (cadena, ean) do update set consultado_at = excluded.consultado_at, encontrados = excluded.encontrados`,
      [c.nombre, e, iso, items.filter((it) => it.ean === e).length]]);
    }
  }
  if (stmts.length) await txBatch(stmts);
  return toca.length;
}
