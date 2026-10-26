// GET /api/auth/callback — vuelta de Google. Valida el state, cambia el code por el
// ID token, lo verifica contra las claves de Google, da de alta a la persona si hay
// lugar (lib/cupo.mjs) y pone la cookie de sesión. Ante cualquier fallo vuelve a
// /?login_error=… (la tarjeta de login dice el motivo).
import { jwtVerify, createRemoteJWKSet } from 'jose';
import { redirect, error } from '../lib/http.mjs';
import {
  getStateCookie, clearStateCookie, safeEqual, oauthRedirectUri, signSession, sessionCookie,
  getNextCookie, clearNextCookie, safeNext,
} from '../lib/auth.mjs';
import { admitir } from '../lib/cupo.mjs';
import { txBatch } from '../lib/db.mjs';

const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

const fail = (req, reason) => redirect(`/?login_error=${encodeURIComponent(reason)}`, [clearStateCookie(req), clearNextCookie(req)]);

export default async function (req) {
  const url = new URL(req.url);
  if (url.searchParams.get('error')) return fail(req, url.searchParams.get('error'));
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code) return error('falta code', 400);
  const expected = getStateCookie(req);
  if (!expected || !state || !safeEqual(expected, state)) return fail(req, 'state');

  const clientId = process.env.GOOGLE_CLIENT_ID, clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return error('OAuth no configurado', 500);
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: clientId, client_secret: clientSecret,
      redirect_uri: oauthRedirectUri(req), grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) return fail(req, 'token');
  const idToken = (await tokenRes.json()).id_token;
  if (!idToken) return fail(req, 'idtoken');

  let payload;
  try {
    ({ payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: clientId,
    }));
  } catch {
    return fail(req, 'verify');
  }
  const email = String(payload.email || '').toLowerCase();
  if (!email || payload.email_verified === false) return fail(req, 'email');

  const res = await admitir(txBatch, { email, name: String(payload.name || ''), picture: String(payload.picture || '') });
  if (res.lleno) return fail(req, 'lleno');
  const token = await signSession({ userId: res.user.id, email: res.user.email });
  return redirect(safeNext(getNextCookie(req)), [clearStateCookie(req), clearNextCookie(req), sessionCookie(req, token)]);
}

export const config = { path: '/api/auth/callback' };
