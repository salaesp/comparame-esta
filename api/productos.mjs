// Productos del catálogo (sólo con sesión). El catálogo es de todos; los precios, de
// cada uno y sus amigos.
//   GET   /api/productos?q=     -> buscar en el catálogo (para elegir uno en la revisión)
//   GET   /api/productos/:id    -> el producto, TODOS sus precios que ves (el historial entero),
//                                  lo guardado de las tiendas online por su EAN (lib/online.mjs) y
//                                  `online_buscando`: las cadenas a las que hay que preguntarles
//   GET   /api/productos/:id/online -> les pregunta a esas cadenas y devuelve lo online
//   GET   /api/productos/web?q=     -> buscar en las webs de los súper (lib/online.mjs buscarEnWebs)
//   GET   /api/productos/web/:ean   -> lo de cada cadena con ese EAN (les pregunta a las que falten)
//   GET   /api/productos/:id/parecidos -> sin EAN: los de las webs que se le parecen, para elegir
//                                  cuál es (y ponerle su EAN con PATCH). La ficha trae los guardados
//                                  (`parecidos`) o `parecidos_buscar` si hay que buscarlos. Lo que va
//                                  por peso no se busca (no tiene código).
//   PATCH /api/productos/:id    -> corregir nombre, marca, medida o EAN
import { json, error, readJson, segs } from '../lib/http.mjs';
import { sessionUser } from '../lib/auth.mjs';
import { sql, txBatch } from '../lib/db.mjs';
import { visibles } from '../lib/amigos.mjs';
import { normTexto, nombreKey, medidaDe, eanValido, tidyNombre } from '../lib/productos.mjs';
import { actualizarOnline, cadenasPorConsultar, CONSULTAS_SQL, FOTO_SQL, parecidosGuardados, buscarParecidos, buscarEnWebs, ONLINE_EAN_SQL, CADENAS_ONLINE } from '../lib/online.mjs';

const COLS = 'id, nombre, marca, medida, medida_unidad, ean, creado_por';

export default async function (req) {
  const me = await sessionUser(req);
  if (!me) return error('no autenticado', 401);
  const [, , id, s3] = segs(req);
  if (!id && req.method === 'GET') return buscar(new URL(req.url).searchParams.get('q'));
  if (id === 'web' && !s3 && req.method === 'GET') {
    const resultados = await buscarEnWebs(String(new URL(req.url).searchParams.get('q') || '').slice(0, 100));
    return json({ ok: true, resultados, cadenas: CADENAS_ONLINE.map((c) => c.nombre) });
  }
  if (id === 'web' && s3 && req.method === 'GET') return web(s3);
  if (id && !s3 && req.method === 'GET') return uno(me.userId, id);
  if (id && s3 === 'online' && req.method === 'GET') return online(id);
  if (id && s3 === 'parecidos' && req.method === 'GET') return parecidos(id, new URL(req.url).searchParams.get('de_nuevo') === '1');
  if (id && !s3 && req.method === 'PATCH') return editar(me.userId, id, await readJson(req));
  return error('método no permitido', 405);
}

// Todas las palabras tienen que estar (en cualquier orden). Hasta 20.
async function buscar(q) {
  const words = normTexto(q).split(' ').filter(Boolean).slice(0, 6);
  if (!words.length) return json({ ok: true, productos: [] });
  const where = words.map((_, i) => `instr(nombre_key, ?${i + 1}) > 0`).join(' and ');
  const productos = await sql(`select ${COLS} from productos where ${where} order by length(nombre_key) limit 20`, words);
  return json({ ok: true, productos });
}

const ONLINE_SQL = `select cadena, sku, nombre, url, unidad, medida, medida_unidad, precio, precio_lista, precio_medida, promos, disponible, imagen, visto_at, cambio_at
    from online_productos
   where ean <> '' and ean = (select ean from productos where id = ?1)
   order by disponible desc, coalesce(precio_medida, precio), cadena`;

async function uno(userId, id) {
  const [[p], precios, online, consultas, [guardados]] = await txBatch([
    [`select ${COLS}, ${FOTO_SQL} from productos where id = ?1`, [id]],
    [`select pr.id, pr.ticket_id, pr.user_id, pr.lugar_id, pr.fecha, pr.texto, pr.cantidad, pr.unidad, pr.precio_lista,
             pr.importe, pr.descuento, pr.pagado, pr.precio_unit, pr.precio_medida,
             l.cadena, l.sucursal, l.direccion, l.ciudad
        from precios pr left join lugares l on l.id = pr.lugar_id
       where pr.producto_id = ?1 and pr.user_id in ${visibles('?2')}
       order by pr.fecha desc`, [id, userId]],
    // Lo de las tiendas online (lib/online.mjs), por el EAN, y cuándo se les preguntó. Lo sin
    // stock va al final: VTEX lo devuelve con el precio de cuando se vendía.
    [ONLINE_SQL, [id]],
    [CONSULTAS_SQL.replace('?1', '(select ean from productos where id = ?1)'), [id]],
    ['select q, buscado_at, parecidos from online_parecidos where producto_id = ?1', [id]],
  ]);
  if (!p) return error('no encontrado', 404);
  // A las que no se les preguntó hace poco, la app les pregunta aparte (GET …/online) mientras
  // muestra "Buscando en…": así la ficha no espera a las tiendas.
  const online_buscando = p.ean ? cadenasPorConsultar(consultas).map((c) => c.nombre) : [];
  // Sin código (y si no va por peso): los parecidos guardados o que hay que buscarlos.
  const buscable = !p.ean && !porPeso(precios);
  const parecidos = buscable ? parecidosGuardados(guardados, p) : null;
  // parecidos: null si no se busca (tiene código o va por peso); [] si se buscó y no hubo nada.
  return json({ ok: true, producto: p, precios, online, online_buscando, parecidos: buscable ? parecidos || [] : null, parecidos_buscar: buscable && !parecidos });
}

// Les pregunta (a la vez, con timeout) a las cadenas que no se consultaron hace poco y
// devuelve todo lo online del producto.
async function online(id) {
  const [p] = await sql('select ean from productos where id = ?1', [id]);
  if (!p) return error('no encontrado', 404);
  if (p.ean) await actualizarOnline(p.ean);
  return json({ ok: true, online: await sql(ONLINE_SQL, [id]) });
}

async function web(ean) {
  const e = eanValido(ean);
  if (!e) return error('El código no es válido.', 422);
  await actualizarOnline(e);
  return json({ ok: true, online: await sql(ONLINE_EAN_SQL, [e]) });
}

// Lo que va por peso (todos sus precios en kg): fruta, verdura, fiambre. No tiene código.
const porPeso = (precios) => precios.length > 0 && precios.every((pr) => pr.unidad === 'kg');

// ?de_nuevo=1: sin lo guardado ("Buscar de nuevo").
async function parecidos(id, deNuevo = false) {
  const [[p], unidades, [guardados]] = await txBatch([
    [`select ${COLS} from productos where id = ?1`, [id]],
    ['select distinct unidad from precios where producto_id = ?1', [id]],
    ['select q, buscado_at, parecidos from online_parecidos where producto_id = ?1', [id]],
  ]);
  if (!p) return error('no encontrado', 404);
  if (p.ean || porPeso(unidades)) return json({ ok: true, parecidos: null });
  return json({ ok: true, parecidos: (!deNuevo && parecidosGuardados(guardados, p)) || await buscarParecidos(p) });
}

// Lo corrige quien lo creó o quien tiene algún precio cargado de él (el catálogo es de
// todos: no lo cambia cualquiera). El código de barras de uno que no lo tiene ("¿Es alguno
// de estos?") se lo pone también quien lo ve (con un precio suyo o de un amigo): suma, no pisa.
const soloEan = (b) => b && typeof b === 'object' && Object.keys(b).length === 1 && 'ean' in b;
async function editar(userId, id, b) {
  const [p] = await sql(
    `select ${COLS},
            (creado_por = ?2 or exists (select 1 from precios where producto_id = ?1 and user_id = ?2)) as suyo,
            exists (select 1 from precios where producto_id = ?1 and user_id in ${visibles('?2')}) as lo_ve
       from productos where id = ?1`,
    [id, userId],
  );
  if (!p || !(p.suyo || (p.lo_ve && soloEan(b) && !p.ean && b.ean))) return error('no encontrado', 404);
  const nombre = b?.nombre != null ? tidyNombre(String(b.nombre).slice(0, 100)) : p.nombre;
  if (!nombre) return error('Falta el nombre.', 422);
  const marca = b?.marca != null ? tidyNombre(String(b.marca).slice(0, 60)) : p.marca;
  let { medida, medida_unidad } = p;
  if (b && 'medida' in b) {
    const m = b.medida == null || b.medida === '' ? null : medidaDe(b.medida, b.medida_unidad);
    if (b.medida != null && b.medida !== '' && !m) return error('La medida no es válida.', 422);
    medida = m?.medida ?? null;
    medida_unidad = m?.unidad ?? '';
  }
  let ean = p.ean;
  if (b && 'ean' in b) {
    ean = b.ean ? eanValido(b.ean) : '';
    if (b.ean && !ean) return error('El código de barras no es válido.', 422);
  }
  // Con otra medida cambia el precio por kg, litro o unidad de todos sus precios
  // (la misma cuenta que precioMedida de lib/productos.mjs).
  const [[row]] = await txBatch([
    [`update productos set nombre = ?2, marca = ?3, medida = ?4, medida_unidad = ?5, ean = ?6, nombre_key = ?7,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       where id = ?1 returning ${COLS}`,
    [id, nombre, marca, medida, medida_unidad, ean, nombreKey({ nombre, marca, medida, medida_unidad })]],
    [`update precios set precio_medida = case
         when unidad = 'kg' then round(precio_unit, 2)
         when ?2 in ('g', 'ml') and ?1 > 0 then round(precio_unit / (?1 / 1000.0), 2)
         when ?2 = 'u' and ?1 > 0 then round(precio_unit / ?1, 2)
         else null end
       where producto_id = ?3`, [medida, medida_unidad, id]],
  ]);
  return json({ ok: true, producto: row });
}


export const config = { path: ['/api/productos', '/api/productos/web', '/api/productos/web/:ean', '/api/productos/:id', '/api/productos/:id/online', '/api/productos/:id/parecidos'] };
