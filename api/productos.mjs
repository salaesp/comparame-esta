// Productos del catálogo (sólo con sesión). El catálogo es de todos; los precios, de
// cada uno y sus amigos.
//   GET   /api/productos?q=     -> buscar en el catálogo (para elegir uno en la revisión)
//   GET   /api/productos/:id    -> el producto y TODOS sus precios que ves (el historial entero)
//   PATCH /api/productos/:id    -> corregir nombre, marca, medida o EAN
import { json, error, readJson, segs } from '../lib/http.mjs';
import { sessionUser } from '../lib/auth.mjs';
import { sql, txBatch } from '../lib/db.mjs';
import { visibles } from '../lib/amigos.mjs';
import { normTexto, nombreKey, medidaDe, eanValido, tidyNombre } from '../lib/productos.mjs';

const COLS = 'id, nombre, marca, medida, medida_unidad, ean, creado_por';

export default async function (req) {
  const me = await sessionUser(req);
  if (!me) return error('no autenticado', 401);
  const [, , id, s3] = segs(req);
  if (!id && req.method === 'GET') return buscar(new URL(req.url).searchParams.get('q'));
  if (id && !s3 && req.method === 'GET') return uno(me.userId, id);
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

async function uno(userId, id) {
  const [[p], precios] = await txBatch([
    [`select ${COLS} from productos where id = ?1`, [id]],
    [`select pr.id, pr.ticket_id, pr.user_id, pr.lugar_id, pr.fecha, pr.texto, pr.cantidad, pr.unidad, pr.precio_lista,
             pr.importe, pr.descuento, pr.pagado, pr.precio_unit, pr.precio_medida,
             l.cadena, l.sucursal, l.direccion, l.ciudad
        from precios pr left join lugares l on l.id = pr.lugar_id
       where pr.producto_id = ?1 and pr.user_id in ${visibles('?2')}
       order by pr.fecha desc`, [id, userId]],
  ]);
  return p ? json({ ok: true, producto: p, precios }) : error('no encontrado', 404);
}

// Lo corrige quien lo creó o quien tiene algún precio cargado de él (el catálogo es de
// todos: no lo cambia cualquiera).
async function editar(userId, id, b) {
  const [p] = await sql(
    `select ${COLS} from productos where id = ?1
        and (creado_por = ?2 or exists (select 1 from precios where producto_id = ?1 and user_id = ?2))`,
    [id, userId],
  );
  if (!p) return error('no encontrado', 404);
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

export const config = { path: ['/api/productos', '/api/productos/:id'] };
