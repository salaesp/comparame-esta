// Tickets (sólo con sesión).
//   POST   /api/tickets/leer {fotos, hoy} -> lo que Claude leyó, cruzado con el catálogo (no guarda nada)
//   POST   /api/tickets {fecha, lugar, total, renglones, …} -> guarda el ticket revisado
//   GET    /api/tickets/:id    -> un ticket con sus renglones (tuyo o de un amigo)
//   PATCH  /api/tickets/:id {lugar} -> le cambia el lugar a uno tuyo (lib/catalogo.mjs moverTicketStmts)
//   DELETE /api/tickets/:id    -> borra uno tuyo
import Anthropic from '@anthropic-ai/sdk';
import { json, error, readJson, segs } from '../lib/http.mjs';
import { sessionUser } from '../lib/auth.mjs';
import { sql, txBatch } from '../lib/db.mjs';
import { visibles } from '../lib/amigos.mjs';
import { fotosError, leerTicket, lectorConfig, costoUsd } from '../lib/lector.mjs';
import { validarTicket, lugarLimpio } from '../lib/ticket.mjs';
import { cruzarLectura, guardarStmts, moverTicketStmts } from '../lib/catalogo.mjs';
import { ubicarLugares, enSegundoPlano } from '../lib/geo.mjs';

export default async function (req, env, ctx) {
  const me = await sessionUser(req);
  if (!me) return error('no autenticado', 401);
  const [, , s2, s3] = segs(req);
  if (s2 === 'leer' && !s3 && req.method === 'POST') return leer(req, me.userId);
  if (!s2 && req.method === 'POST') return guardar(req, me.userId, ctx);
  if (s2 && !s3 && req.method === 'GET') return uno(me.userId, s2);
  if (s2 && !s3 && req.method === 'PATCH') return cambiarLugar(req, me.userId, s2, ctx);
  if (s2 && !s3 && req.method === 'DELETE') return borrar(me.userId, s2);
  return error('método no permitido', 405);
}

// El cliente de Anthropic. La URL base es la de la API salvo que se pase otra (por
// ejemplo, la de Cloudflare AI Gateway en ANTHROPIC_BASE_URL_LECTOR).
let _client = null;
export function anthropic() {
  if (!_client) {
    _client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseURL: process.env.ANTHROPIC_BASE_URL_LECTOR || 'https://api.anthropic.com',
      maxRetries: 1,
      timeout: 120_000,
    });
  }
  return _client;
}
// Para los tests: un cliente falso que contesta lo que se le diga.
export function setAnthropic(c) { _client = c; }

async function leer(req, userId) {
  if (!process.env.ANTHROPIC_API_KEY && !_client) return error('La lectura de tickets no está configurada.', 503);
  const body = await readJson(req);
  const err = fotosError(body?.fotos);
  if (err) return error(err, 422);
  const hoy = /^\d{4}-\d{2}-\d{2}$/.test(body.hoy || '') ? body.hoy : new Date().toISOString().slice(0, 10);
  const { modelo, esfuerzo } = lectorConfig();
  const anotar = (r, ok, msg = '') => sql(
    `insert into lecturas (user_id, modelo, esfuerzo, fotos, renglones, input_tokens, output_tokens, costo_usd, ms, ok, error)
     values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
    [userId, r?.modelo || modelo, esfuerzo, body.fotos.length, r?.lectura?.renglones?.length || 0,
      r?.usage?.input_tokens || 0, r?.usage?.output_tokens || 0, costoUsd(r?.modelo || modelo, r?.usage), r?.ms || 0, ok, msg],
  ).catch((e) => console.error('[lecturas]', e?.message || e));
  let r;
  try {
    r = await leerTicket(anthropic(), body.fotos, { modelo, esfuerzo, hoy });
  } catch (e) {
    await anotar({ usage: e.usage, ms: e.ms }, 0, String(e?.message || e).slice(0, 300));
    if (e.motivo) return error(e.message, 422, { motivo: e.motivo });
    if (e instanceof Anthropic.RateLimitError) return error('Hay muchas lecturas a la vez. Probá en un rato.', 429);
    if (e instanceof Anthropic.APIError) {
      console.error('[lector]', e.status, String(e.message || '').slice(0, 300));
      return error('No pude leer el ticket. Probá de nuevo.', 502);
    }
    throw e;
  }
  await anotar(r, 1);
  console.log(`[lector] fotos=${body.fotos.length} renglones=${r.lectura.renglones.length} modelo=${r.modelo} ${r.ms}ms`);
  return json({ ok: true, lectura: await cruzarLectura(r.lectura), modelo: r.modelo, ms: r.ms });
}

async function guardar(req, userId, ctx) {
  const v = validarTicket(await readJson(req));
  if (v.error) return error(v.error, 422);
  const g = await guardarStmts(userId, v);
  if (g.error) return error(g.error, g.status, g.duplicado ? { duplicado: g.duplicado } : undefined);
  await txBatch(g.stmts);
  // El punto en el mapa del lugar (si es nuevo o le cambió la dirección), sin hacer esperar.
  await enSegundoPlano(ctx, ubicarLugares([g.lugarId]));
  return json({ ok: true, id: g.ticketId }, 201);
}

async function cambiarLugar(req, userId, id, ctx) {
  const b = await readJson(req);
  const m = await moverTicketStmts(userId, id, lugarLimpio(b?.lugar || {}));
  if (m.error) return error(m.error, m.status);
  if (m.stmts.length) await txBatch(m.stmts);
  await enSegundoPlano(ctx, ubicarLugares([m.lugarId]));
  return json({ ok: true, lugar_id: m.lugarId });
}

async function uno(userId, id) {
  const [[t], renglones] = await txBatch([
    [`select t.id, t.user_id, t.lugar_id, t.fecha, t.total, t.pagado, t.n_fotos, t.n_renglones, t.created_at
        from tickets t where t.id = ?2 and t.user_id in ${visibles('?1')}`, [userId, id]],
    [`select p.id, p.producto_id, p.orden, p.texto, p.cantidad, p.unidad, p.precio_lista, p.importe, p.descuento,
             p.pagado, p.precio_unit, p.precio_medida
        from precios p where p.ticket_id = ?2 and p.user_id in ${visibles('?1')} order by p.orden`, [userId, id]],
  ]);
  return t ? json({ ok: true, ticket: { ...t, renglones } }) : error('no encontrado', 404);
}

async function borrar(userId, id) {
  const r = await sql('delete from tickets where id = ?1 and user_id = ?2 returning id', [id, userId]);
  return r[0] ? json({ ok: true }) : error('no encontrado', 404);
}

export const config = { path: ['/api/tickets', '/api/tickets/leer', '/api/tickets/:id'] };
