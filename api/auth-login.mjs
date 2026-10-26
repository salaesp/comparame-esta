// GET /api/auth/login — arranca el login con Google: un `state` al azar (CSRF) en una
// cookie corta y a la pantalla de Google. ?next= es a dónde volver después (el link de
// un amigo: /?amigo=…), sólo un camino de este sitio.
import { randomBytes } from 'node:crypto';
import { redirect, error } from '../lib/http.mjs';
import { stateCookie, nextCookie, oauthRedirectUri, safeNext } from '../lib/auth.mjs';

export default async function (req) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return error('GOOGLE_CLIENT_ID no configurado', 500);
  const state = randomBytes(16).toString('hex');
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', oauthRedirectUri(req));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('access_type', 'online');
  url.searchParams.set('prompt', 'select_account');
  const cookies = [stateCookie(req, state)];
  const next = new URL(req.url).searchParams.get('next');
  if (next) cookies.push(nextCookie(req, safeNext(next)));
  return redirect(url.toString(), cookies);
}

export const config = { path: '/api/auth/login' };
