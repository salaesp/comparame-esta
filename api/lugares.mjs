// Lugares del catálogo (sólo con sesión). El catálogo es de todos; los tickets, de cada
// uno y sus amigos.
//   GET   /api/lugares/buscar?q=&lat=&lon= -> los locales que se llaman así (lib/geo.mjs
//         buscarLocales), para elegir uno en vez de escribir la dirección
//   PATCH /api/lugares/:id {sucursal, direccion, ciudad, lat?, lon?, juntar?} -> corregir un lugar
//
// Con la dirección nueva puede aparecer que el lugar ya existía (un Carrefour cargado sin
// dirección, por su punto de venta, y el mismo con dirección): contesta 409 con `otro` y,
// si se vuelve a mandar con `juntar` = el id de ése, éste se junta en aquél (sus tickets,
// precios y claves pasan al otro, que se completa con lo que no tenga) y se borra.
// Con otra dirección o ciudad se vuelve a buscar su punto en el mapa (lib/geo.mjs), antes de
// contestar: así la ficha ya lo muestra. Si viene con lat/lon (se eligió el local en el
// buscador), ése es su punto y no se busca.
import { json, error, readJson, segs } from '../lib/http.mjs';
import { sessionUser } from '../lib/auth.mjs';
import { sql, txBatch } from '../lib/db.mjs';
import { lugarKeys, ciudadLimpia } from '../lib/productos.mjs';
import { LUGAR_COLS } from '../lib/catalogo.mjs';
import { ubicarLugares, buscarLocales, puntoValido } from '../lib/geo.mjs';

const texto = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : null);

export default async function (req) {
  const me = await sessionUser(req);
  if (!me) return error('no autenticado', 401);
  const [, , id, s3] = segs(req);
  if (id === 'buscar' && !s3 && req.method === 'GET') return buscar(req);
  if (id && !s3 && req.method === 'PATCH') return editar(me.userId, id, await readJson(req));
  return error('método no permitido', 405);
}

async function buscar(req) {
  const u = new URL(req.url).searchParams;
  const num = (k) => (u.get(k) == null || u.get(k) === '' ? NaN : Number(u.get(k)));
  try {
    return json({ ok: true, locales: await buscarLocales({ q: u.get('q'), lat: num('lat'), lon: num('lon') }) });
  } catch (e) {
    console.error('[locales]', e?.message || e);
    return error('No pude buscar el local. Probá de nuevo o escribí la dirección.', 502);
  }
}

// Lo corrige quien lo creó o quien cargó algún ticket ahí (como un producto).
async function editar(userId, id, b) {
  const [l] = await sql(
    `select ${LUGAR_COLS} from lugares where id = ?1
        and (creado_por = ?2 or exists (select 1 from tickets where lugar_id = ?1 and user_id = ?2))`,
    [id, userId],
  );
  if (!l) return error('no encontrado', 404);
  const sucursal = texto(b?.sucursal, 60) ?? l.sucursal;
  const direccion = texto(b?.direccion, 120) ?? l.direccion;
  const ciudad = b?.ciudad != null ? ciudadLimpia(b.ciudad) : l.ciudad;
  const clave = direccion ? lugarKeys({ cuit: l.cuit, cadena: l.cadena, direccion })[0] : null;
  const [duenio] = clave ? await sql('select lugar_id from lugar_claves where clave = ?1', [clave]) : [];

  if (duenio && duenio.lugar_id !== id) {
    const [otro] = await sql(`select ${LUGAR_COLS} from lugares where id = ?1`, [duenio.lugar_id]);
    if (b?.juntar !== otro.id) return error('Ya hay un lugar con esa dirección.', 409, { otro: { ...otro, cadena_key: undefined } });
    // Lo que el otro no tiene, lo pone éste (con lo recién escrito).
    const LLENAR = ['sucursal', 'ciudad', 'punto_venta', 'cuit'];
    const punto = puntoValido(b?.lat, b?.lon) ? [b.lat, b.lon] : [null, null];
    const [, , , , [row]] = await txBatch([
      ['update tickets set lugar_id = ?1 where lugar_id = ?2', [otro.id, id]],
      ['update precios set lugar_id = ?1 where lugar_id = ?2', [otro.id, id]],
      ['update lugar_claves set lugar_id = ?1 where lugar_id = ?2', [otro.id, id]],
      ['delete from lugares where id = ?1', [id]],
      // Y si el otro no tenía punto y éste se eligió en el buscador, se lo pone.
      [`update lugares set ${LLENAR.map((c, i) => `${c} = case when ${c} = '' then ?${i + 2} else ${c} end`).join(', ')},
           geo_at = case when lat is null and ?6 is not null then strftime('%Y-%m-%dT%H:%M:%fZ', 'now') else geo_at end,
           lat = coalesce(lat, ?6), lon = case when lat is null then ?7 else lon end
         where id = ?1 returning ${LUGAR_COLS}`, [otro.id, sucursal, ciudad, l.punto_venta, l.cuit, ...punto]],
    ]);
    return json({ ok: true, lugar: { ...row, cadena_key: undefined }, juntado: otro.id });
  }

  const punto = direccion && puntoValido(b?.lat, b?.lon) ? [b.lat, b.lon] : null;
  const geo = punto ? `, lat = ?5, lon = ?6, geo_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
    : direccion !== l.direccion || ciudad !== l.ciudad ? ', lat = null, lon = null, geo_at = null' : '';
  const stmts = [[`update lugares set sucursal = ?2, direccion = ?3, ciudad = ?4${geo} where id = ?1 returning ${LUGAR_COLS}`,
    [id, sucursal, direccion, ciudad, ...(punto || [])]]];
  // La clave vieja queda: si otro ticket trae la dirección como estaba, sigue siendo éste.
  if (clave) stmts.push(['insert into lugar_claves (clave, lugar_id) values (?1, ?2) on conflict (clave) do nothing', [clave, id]]);
  let [[row]] = await txBatch(stmts);
  if (geo && !punto && direccion) {
    await ubicarLugares([id]).catch((e) => console.error('[geo]', e?.message || e));
    [row] = await sql(`select ${LUGAR_COLS} from lugares where id = ?1`, [id]);
  }
  return json({ ok: true, lugar: { ...row, cadena_key: undefined } });
}

export const config = { path: ['/api/lugares/buscar', '/api/lugares/:id'] };
