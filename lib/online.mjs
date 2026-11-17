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
import { eanValido, medidaDe, precioMedida, tidyNombre } from './productos.mjs';

// Las cadenas que se consultan. `nombre` es como se guarda y se muestra. Todas VTEX:
// sumar Jumbo, Disco, Vea, Changomás o DIA es sumar su renglón (y probarlo).
export const CADENAS_ONLINE = [
  { nombre: 'Carrefour', base: 'https://www.carrefour.com.ar' },
];
export const ONLINE_FRESCO_HORAS = 24;
export const ONLINE_TIMEOUT_MS = 3000;

let _fetch = (...a) => fetch(...a);
// Para los tests: unas tiendas falsas.
export function setOnlineFetch(fn) { _fetch = fn; }

const round2 = (n) => Math.round(n * 100) / 100;
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const primero = (v) => (Array.isArray(v) ? v[0] : v);
const texto = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// "Gramaje de unidad de medida" de VTEX → la unidad de medidaDe.
const UNIDADES_VTEX = { grm: 'g', grs: 'g', gr: 'g', g: 'g', kgm: 'kg', kgs: 'kg', kg: 'kg', cm3: 'ml', ml: 'ml', mlt: 'ml', cc: 'ml',
  ltr: 'l', lts: 'l', lt: 'l', l: 'l', uni: 'u', un: 'u', u: 'u' };

// Las promos que valen para todos (las de una tarjeta o un banco traen RestrictionsBins).
function promosDe(offer) {
  const ts = offer?.PromotionTeasers || [];
  const generales = ts.filter((t) => !(t?.Conditions?.Parameters || []).some((p) => p?.Name === 'RestrictionsBins'));
  return texto([...new Set(generales.map((t) => String(t?.Name || '').trim()).filter(Boolean))].join(' · '), 200);
}

// Un producto de VTEX → un renglón por cada item (sku) con precio. El precio es el de la
// web con sus promos para todos; precio_lista, el tachado (si es más).
export function normalizarVtex(p) {
  const out = [];
  const marca = norm(p.brand) === 'generico' ? '' : texto(p.brand, 60);
  const categoria = texto(String(primero(p.categories) || '').split('/').filter(Boolean)[0], 60);
  const uni = UNIDADES_VTEX[norm(primero(p['Gramaje de unidad de medida']))];
  const url = /^https:\/\/[^\s"<>]+$/.test(String(p.link || '')) ? String(p.link).slice(0, 300) : '';
  for (const it of p.items || []) {
    const seller = (it.sellers || []).find((s) => s.sellerDefault) || it.sellers?.[0];
    const o = seller?.commertialOffer;
    const precio = Number(o?.Price);
    if (!(precio > 0) || !it.itemId) continue;
    const unidad = it.measurementUnit === 'kg' ? 'kg' : 'u';
    const m = unidad === 'kg' ? null : medidaDe(primero(p['Gramaje de unidad de consumo']), uni);
    const lista = Math.max(Number(o.ListPrice) || 0, Number(o.PriceWithoutDiscount) || 0);
    out.push({
      sku: texto(it.itemId, 40),
      ean: eanValido(it.ean),
      nombre: tidyNombre(texto(it.nameComplete || it.name || p.productName, 160)),
      marca,
      medida: m?.medida ?? null,
      medida_unidad: m?.unidad ?? '',
      unidad,
      categoria,
      url,
      precio: round2(precio),
      precio_lista: lista > precio ? round2(lista) : null,
      precio_medida: precioMedida({ precio_unit: precio, unidad, medida: m?.medida, medida_unidad: m?.unidad }),
      promos: promosDe(o),
      disponible: o.AvailableQuantity > 0 || o.IsAvailable === true ? 1 : 0,
    });
  }
  return out;
}

// Lo que tiene una cadena con esos EAN (uno o varios en un mismo pedido). Tira si la
// tienda no contesta.
export async function buscarEnVtex(cadena, eans) {
  const fq = eans.map((e) => `fq=alternateIds_Ean:${encodeURIComponent(e)}`).join('&');
  const res = await _fetch(`${cadena.base}/api/catalog_system/pub/products/search?${fq}`, {
    signal: AbortSignal.timeout(ONLINE_TIMEOUT_MS),
    headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; comparame-esta)' },
  });
  if (!res.ok && res.status !== 206) throw new Error(`${cadena.nombre} ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error(`${cadena.nombre}: respuesta rara`);
  return data.flatMap(normalizarVtex).filter((it) => eans.includes(it.ean));
}

const COLS = ['sku', 'ean', 'nombre', 'marca', 'medida', 'medida_unidad', 'unidad', 'categoria', 'url',
  'precio', 'precio_lista', 'precio_medida', 'promos', 'disponible'];
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

// Pregunta a las cadenas que no se consultaron en las últimas ONLINE_FRESCO_HORAS por
// ese EAN y lo guarda. Todas a la vez; la que no contesta queda para la próxima.
// `consultas` (las filas de online_consultas de ese EAN) si ya se leyeron; si no, las busca.
export const CONSULTAS_SQL = 'select cadena, consultado_at from online_consultas where ean = ?1';
export function cadenasPorConsultar(consultas, ahora = new Date()) {
  const desde = new Date(ahora.getTime() - ONLINE_FRESCO_HORAS * 3600_000).toISOString();
  const frescas = new Set(consultas.filter((r) => r.consultado_at > desde).map((r) => r.cadena));
  return CADENAS_ONLINE.filter((c) => !frescas.has(c.nombre));
}
export async function actualizarOnline(ean, { consultas = null, ahora = new Date() } = {}) {
  if (!eanValido(ean)) return 0;
  const toca = cadenasPorConsultar(consultas ?? await sql(CONSULTAS_SQL, [ean]), ahora);
  if (!toca.length) return 0;
  const res = await Promise.all(toca.map((c) => buscarEnVtex(c, [ean]).then((items) => ({ c, items }), (e) => {
    console.error('[online]', c.nombre, ean, e?.message || e);
    return null;
  })));
  const iso = ahora.toISOString();
  const stmts = [];
  for (const { c, items } of res.filter(Boolean)) {
    if (items.length) stmts.push(...guardarOnlineStmts(c.nombre, items, iso));
    stmts.push([`insert into online_consultas (cadena, ean, consultado_at, encontrados) values (?1, ?2, ?3, ?4)
                 on conflict (cadena, ean) do update set consultado_at = excluded.consultado_at, encontrados = excluded.encontrados`,
    [c.nombre, ean, iso, items.length]]);
  }
  if (stmts.length) await txBatch(stmts);
  return stmts.length;
}
