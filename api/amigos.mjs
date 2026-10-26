// Amigos por link de invitación (sólo con sesión).
//   GET    /api/amigos                -> { amigos, links } (links: los vivos que creaste)
//   POST   /api/amigos/link           -> crea un link (el token se ve una sola vez)
//   DELETE /api/amigos/link/:id       -> lo revoca
//   GET    /api/amigos/aceptar?token= -> quién te invita, antes de aceptar
//   POST   /api/amigos/aceptar {token}-> acepta: quedan amigos y el link no sirve más
//   DELETE /api/amigos/:id            -> deja de ser tu amigo (los dos dejan de verse)
import { randomBytes } from 'node:crypto';
import { json, error, readJson, segs } from '../lib/http.mjs';
import { sessionUser, sha256hex } from '../lib/auth.mjs';
import { sql, txBatch } from '../lib/db.mjs';
import { par, LINK_DIAS, LINKS_MAX } from '../lib/amigos.mjs';

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
// Un link que todavía sirve: ni revocado, ni usado, ni vencido.
const vivo = (t = '') => `${t}revocado_at is null and ${t}aceptado_por is null and ${t}expires_at > ${NOW}`;
const VIVO = vivo();

export default async function (req) {
  const me = await sessionUser(req);
  if (!me) return error('no autenticado', 401);
  const [, , s2, s3] = segs(req);
  const m = req.method;
  if (!s2 && m === 'GET') return list(me.userId);
  if (s2 === 'link' && !s3 && m === 'POST') return crearLink(req, me.userId);
  if (s2 === 'link' && s3 && m === 'DELETE') return revocar(me.userId, s3);
  if (s2 === 'aceptar' && m === 'GET') return ver(new URL(req.url).searchParams.get('token'), me.userId);
  if (s2 === 'aceptar' && m === 'POST') return aceptar((await readJson(req))?.token, me.userId);
  if (s2 && s2 !== 'link' && s2 !== 'aceptar' && !s3 && m === 'DELETE') return quitar(me.userId, s2);
  return error('método no permitido', 405);
}

async function list(userId) {
  const [amigos, links] = await txBatch([
    [`select u.id, u.name, u.email, u.picture, a.created_at as desde
        from amistades a join users u on u.id = case when a.user_a = ?1 then a.user_b else a.user_a end
       where ?1 in (a.user_a, a.user_b)
       order by u.name collate nocase`, [userId]],
    [`select id, created_at, expires_at from links_amigo where user_id = ?1 and ${VIVO} order by created_at desc`, [userId]],
  ]);
  return json({ ok: true, amigos, links });
}

async function crearLink(req, userId) {
  const [{ n }] = await sql(`select count(*) as n from links_amigo where user_id = ?1 and ${VIVO}`, [userId]);
  if (n >= LINKS_MAX) return error(`Tenés ${LINKS_MAX} links sin usar. Revocá alguno para crear otro.`, 429);
  const token = 'amg_' + randomBytes(24).toString('base64url');
  const [row] = await sql(
    `insert into links_amigo (user_id, token_hash, expires_at)
     values (?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+${LINK_DIAS} days'))
     returning id, created_at, expires_at`,
    [userId, sha256hex(token)],
  );
  const link = `${new URL(req.url).origin}/?amigo=${token}`;
  return json({ ok: true, link: { ...row, url: link } }, 201);
}

async function revocar(userId, id) {
  const r = await sql(`update links_amigo set revocado_at = ${NOW} where id = ?1 and user_id = ?2 and ${VIVO} returning id`, [id, userId]);
  return r[0] ? json({ ok: true }) : error('no encontrado', 404);
}

async function linkVivo(token) {
  if (!token || typeof token !== 'string') return null;
  const [row] = await sql(
    `select l.id, l.user_id, u.name, u.picture from links_amigo l join users u on u.id = l.user_id
      where l.token_hash = ?1 and ${vivo('l.')}`,
    [sha256hex(token.trim())],
  );
  return row || null;
}

const yaAmigos = async (a, b) => {
  const [x, y] = par(a, b);
  return (await sql('select 1 from amistades where user_a = ?1 and user_b = ?2', [x, y])).length > 0;
};

async function ver(token, userId) {
  const l = await linkVivo(token);
  if (!l) return error('El link venció o ya se usó. Pedile otro.', 404);
  return json({ ok: true, de: { name: l.name, picture: l.picture }, propio: l.user_id === userId, ya: l.user_id !== userId && await yaAmigos(l.user_id, userId) });
}

async function aceptar(token, userId) {
  const l = await linkVivo(token);
  if (!l) return error('El link venció o ya se usó. Pedile otro.', 404);
  if (l.user_id === userId) return error('Es tu propio link: mandáselo a tu amigo.', 422);
  const [a, b] = par(l.user_id, userId);
  await txBatch([
    ['insert into amistades (user_a, user_b) values (?1, ?2) on conflict do nothing', [a, b]],
    [`update links_amigo set aceptado_por = ?2, aceptado_at = ${NOW} where id = ?1`, [l.id, userId]],
  ]);
  return json({ ok: true, amigo: { id: l.user_id, name: l.name, picture: l.picture } });
}

async function quitar(userId, otroId) {
  const [a, b] = par(userId, otroId);
  const r = await sql('delete from amistades where user_a = ?1 and user_b = ?2 returning user_a', [a, b]);
  return r[0] ? json({ ok: true }) : error('no encontrado', 404);
}

export const config = {
  path: ['/api/amigos', '/api/amigos/link', '/api/amigos/link/:id', '/api/amigos/aceptar', '/api/amigos/:id'],
};
