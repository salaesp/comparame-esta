// El punto en el mapa de un lugar: la dirección (y la ciudad) pasan por Georef, la API
// de direcciones del gobierno (apis.datos.gob.ar/georef; gratis, sin key, sólo Argentina).
//
// Mejor ningún punto que uno mal: se guarda sólo si Georef da UNA dirección (o varias a
// menos de GEO_CERCA_M entre sí, los tramos de una misma calle). "San Martín 500" sin
// ciudad da cientos: no se guarda nada. Con la ciudad se le pregunta en esa localidad; si
// ahí no la encuentra (Georef no tiene todas las calles), en todo el país, quedándose con
// las que caen en esa ciudad.
//
// Se intenta una vez por dirección: lugares.geo_at dice cuándo (lat null = no se encontró)
// y vuelve a null cuando cambia la dirección o la ciudad. Un error de red no anota nada:
// se reintenta en el próximo /api/boot (ubicarPendientes).
import { sql, txBatch } from './db.mjs';
import { normTexto, ciudadLimpia, AR_BBOX, puntoValido } from './productos.mjs';

export { puntoValido };

export const GEOREF_URL = 'https://apis.datos.gob.ar/georef/api/direcciones';
export const GEO_CERCA_M = 300;
export const GEO_TIMEOUT_MS = 4000;
// Cuántos lugares sin ubicar se miran en cada /api/boot.
export const GEO_POR_VEZ = 5;

let _fetch = (...a) => fetch(...a);
// Para los tests: un Georef falso.
export function setGeoFetch(fn) { _fetch = fn; }

// Distancia en metros entre dos puntos (haversine).
export function metros(a, b) {
  const R = 6371000, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ¿La dirección de Georef cae en esa ciudad? Por su localidad, su departamento (partido o
// comuna) o, para CABA, su provincia.
function enCiudad(d, ciudad) {
  const c = normTexto(ciudad);
  if (!c) return true;
  return [d.localidad_censal?.nombre, d.departamento?.nombre, d.provincia?.nombre]
    .some((n) => n && (normTexto(ciudadLimpia(n)) === c || normTexto(n) === c));
}

// De lo que contestó Georef, el punto (si es uno solo) y la ciudad que dice.
// { lat, lon, ciudad } o null.
export function elegirPunto(direcciones, ciudad = '') {
  const ds = (direcciones || []).filter((d) => Number.isFinite(d?.ubicacion?.lat) && Number.isFinite(d?.ubicacion?.lon) && enCiudad(d, ciudad));
  if (!ds.length) return null;
  const p = ds[0].ubicacion;
  if (ds.some((d) => metros(p, d.ubicacion) > GEO_CERCA_M)) return null;
  return { lat: Math.round(p.lat * 1e6) / 1e6, lon: Math.round(p.lon * 1e6) / 1e6, ciudad: ciudadLimpia(ds[0].localidad_censal?.nombre || '') };
}

async function georef(params) {
  const url = `${process.env.GEOREF_URL || GEOREF_URL}?${new URLSearchParams({ ...params, max: '10' })}`;
  const res = await _fetch(url, { signal: AbortSignal.timeout(GEO_TIMEOUT_MS), headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`georef ${res.status}`);
  const d = await res.json();
  return d?.direcciones || [];
}

// { lat, lon, ciudad } si se encontró, null si no; tira si Georef no contestó.
export async function geocodificar({ direccion, ciudad = '' }) {
  if (!direccion) return null;
  if (ciudad) {
    const p = elegirPunto(await georef({ direccion, localidad: ciudad }), ciudad);
    if (p) return p;
  }
  return elegirPunto(await georef({ direccion }), ciudad);
}

// Ubica los lugares que se le pasen (o los pendientes, hasta GEO_POR_VEZ) y lo guarda. Si
// Georef dice la ciudad y el lugar no la tenía, se la pone.
export async function ubicarLugares(ids = null) {
  const lugares = ids
    ? await sql(`select id, direccion, ciudad from lugares where id in (select value from json_each(?1)) and direccion <> '' and geo_at is null`, [JSON.stringify(ids)])
    : await sql(`select id, direccion, ciudad from lugares where direccion <> '' and geo_at is null order by created_at desc limit ${GEO_POR_VEZ}`);
  // Todos a la vez: con Georef caído, cada uno espera su timeout y no uno detrás de otro.
  const puntos = await Promise.all(lugares.map((l) => geocodificar(l).then((p) => ({ l, p }), (e) => {
    console.error('[geo]', l.id, e?.message || e);
    return null;
  })));
  const stmts = [];
  for (const { l, p } of puntos.filter(Boolean)) {
    // Sólo si la dirección sigue siendo la misma (otro request pudo cambiarla mientras tanto).
    stmts.push([`update lugares set lat = ?2, lon = ?3, geo_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                   ciudad = case when ciudad = '' then ?4 else ciudad end
                 where id = ?1 and direccion = ?5 and ciudad = ?6`, [l.id, p?.lat ?? null, p?.lon ?? null, p?.ciudad || '', l.direccion, l.ciudad]]);
  }
  if (stmts.length) await txBatch(stmts);
  return lugares.length;
}

// ---------- Buscar el local, como en Google Maps ----------
// "Carrefour Cabildo" → los locales que se llaman así, con su dirección y su punto, para
// elegir uno en la revisión o en la ficha del lugar (y no escribir la dirección a mano).
// Sale de Photon (photon.komoot.io: OpenStreetMap, gratis, sin key), con la búsqueda
// sesgada hacia donde estás (o hacia los lugares de esa ciudad) y acotada a Argentina.
export const LOCALES_URL = 'https://photon.komoot.io/api/';
export const LOCALES_MAX = 8;
const redondo = (x) => Math.round(x * 1e6) / 1e6;

// Lo que contestó Photon → [{ nombre, direccion, ciudad, lat, lon, tipo }] (sin repetidos).
export function localesDe(features) {
  const out = [];
  for (const f of features || []) {
    const p = f?.properties || {};
    const [lon, lat] = f?.geometry?.coordinates || [];
    if (p.countrycode && p.countrycode !== 'AR') continue;
    if (!puntoValido(lat, lon)) continue;
    const calle = p.street || (p.osm_key === 'highway' ? p.name : '') || '';
    const direccion = [calle, p.housenumber].filter(Boolean).join(' ').slice(0, 120);
    const esLocal = ['shop', 'amenity'].includes(p.osm_key);
    const nombre = (esLocal ? p.name : '') || direccion || p.name || '';
    if (!nombre) continue;
    const loc = { nombre: nombre.slice(0, 80), direccion, ciudad: ciudadLimpia(p.city || p.district || p.county || p.state || ''),
      lat: redondo(lat), lon: redondo(lon), tipo: esLocal ? 'local' : 'direccion' };
    if (out.some((o) => o.nombre === loc.nombre && o.direccion === loc.direccion && o.ciudad === loc.ciudad)) continue;
    out.push(loc);
  }
  return out.slice(0, LOCALES_MAX);
}

// Tira si Photon no contestó.
export async function buscarLocales({ q, lat, lon }) {
  const texto = String(q || '').replace(/\s+/g, ' ').trim().slice(0, 100);
  if (texto.length < 2) return [];
  const params = new URLSearchParams({ q: texto, limit: String(LOCALES_MAX * 2), lang: 'default', bbox: AR_BBOX.join(',') });
  if (puntoValido(lat, lon)) { params.set('lat', String(lat)); params.set('lon', String(lon)); }
  const res = await _fetch(`${process.env.LOCALES_URL || LOCALES_URL}?${params}`, {
    signal: AbortSignal.timeout(GEO_TIMEOUT_MS), headers: { accept: 'application/json', 'user-agent': 'comparame-esta (precios entre amigos)' },
  });
  if (!res.ok) throw new Error(`locales ${res.status}`);
  return localesDe((await res.json())?.features);
}

// Corre algo después de contestar (ctx.waitUntil del Worker); sin ctx, lo espera.
export function enSegundoPlano(ctx, p) {
  const safe = p.catch((e) => console.error('[segundo plano]', e?.message || e));
  if (ctx?.waitUntil) ctx.waitUntil(safe);
  return ctx?.waitUntil ? Promise.resolve() : safe;
}
