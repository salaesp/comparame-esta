// GET /api/boot — todo lo que la app necesita para arrancar, en una vuelta: quién sos,
// tus amigos y lo que ven entre todos de los últimos BOOT_DIAS días (tickets, precios y
// los productos y lugares de esos precios). Las pantallas se arman en el cliente con
// esto; el historial más viejo de un producto se pide al abrirlo (/api/productos/:id).
// 401 sin sesión: la app muestra el login.
import { json, error } from '../lib/http.mjs';
import { sessionUser } from '../lib/auth.mjs';
import { txBatch } from '../lib/db.mjs';
import { visibles } from '../lib/amigos.mjs';

export const BOOT_DIAS = 180;

export default async function (req) {
  if (req.method !== 'GET') return error('método no permitido', 405);
  const me = await sessionUser(req);
  if (!me) return error('no autenticado', 401);
  const desde = new Date(Date.now() - BOOT_DIAS * 864e5).toISOString().slice(0, 10);
  const V = visibles('?1');
  const [users, tickets, precios, productos, lugares, links] = await txBatch([
    [`select id, name, email, picture from users where id in ${V}`, [me.userId]],
    [`select id, user_id, lugar_id, fecha, total, pagado, n_renglones, created_at from tickets
       where user_id in ${V} and fecha >= ?2 order by fecha desc, created_at desc`, [me.userId, desde]],
    [`select id, ticket_id, user_id, lugar_id, producto_id, fecha, orden, texto, cantidad, unidad, precio_lista, importe,
             descuento, pagado, precio_unit, precio_medida
        from precios where user_id in ${V} and fecha >= ?2`, [me.userId, desde]],
    [`select id, nombre, marca, medida, medida_unidad, ean, creado_por from productos
       where id in (select producto_id from precios where user_id in ${V} and fecha >= ?2)`, [me.userId, desde]],
    [`select id, cadena, sucursal, direccion, ciudad, punto_venta, cuit, creado_por from lugares
       where id in (select lugar_id from tickets where user_id in ${V} and fecha >= ?2)`, [me.userId, desde]],
    [`select count(*) as n from links_amigo where user_id = ?1 and revocado_at is null and aceptado_por is null
        and expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`, [me.userId]],
  ]);
  const yo = users.find((u) => u.id === me.userId);
  if (!yo) return error('no autenticado', 401); // la cuenta se borró
  return json({
    ok: true,
    user: yo,
    amigos: users.filter((u) => u.id !== me.userId),
    links: links[0]?.n || 0,
    desde,
    tickets, precios, productos, lugares,
    lector: !!process.env.ANTHROPIC_API_KEY,
  });
}

export const config = { path: '/api/boot' };
