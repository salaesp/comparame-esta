// Sesión propia: un JWT firmado en una cookie HttpOnly, como en Gastienzos. El login
// de Google vive en api/auth-*.mjs; acá, los helpers comunes. No hay API keys (todavía
// no hay agente que cargue precios).
import { SignJWT, jwtVerify } from 'jose';
import { createHash, timingSafeEqual } from 'node:crypto';

const SESSION_COOKIE = 'cmp_session';
const STATE_COOKIE = 'cmp_oauth_state';
const NEXT_COOKIE = 'cmp_next';
const SESSION_TTL = '30d';
const SESSION_MAX_AGE = 30 * 24 * 60 * 60;

function secretKey() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET no configurado');
  return new TextEncoder().encode(s);
}

export async function signSession({ userId, email }) {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(SESSION_TTL)
    .sign(secretKey());
}

export async function verifySession(token) {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return payload;
  } catch {
    return null;
  }
}

export const sha256hex = (s) => createHash('sha256').update(s).digest('hex');

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// Sin `Secure` en localhost (wrangler dev va por http) para que la cookie no se descarte.
function cookieAttrs(req, maxAge) {
  const host = (() => { try { return new URL(req.url).hostname; } catch { return ''; } })();
  const attrs = ['Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (host !== 'localhost' && host !== '127.0.0.1') attrs.push('Secure');
  if (maxAge != null) attrs.push(`Max-Age=${maxAge}`);
  return attrs.join('; ');
}
const cookie = (name) => ({
  set: (req, v, maxAge) => `${name}=${encodeURIComponent(v)}; ${cookieAttrs(req, maxAge)}`,
  clear: (req) => `${name}=; ${cookieAttrs(req, 0)}`,
  get: (req) => parseCookies(req.headers.get('cookie'))[name] || null,
});
const session = cookie(SESSION_COOKIE);
const state = cookie(STATE_COOKIE);
const next = cookie(NEXT_COOKIE);

export const sessionCookie = (req, token) => session.set(req, token, SESSION_MAX_AGE);
export const clearSessionCookie = session.clear;
export const stateCookie = (req, v) => state.set(req, v, 600);
export const clearStateCookie = state.clear;
export const getStateCookie = state.get;
export const nextCookie = (req, v) => next.set(req, v, 600);
export const clearNextCookie = next.clear;
export const getNextCookie = next.get;

// Google exige que coincida EXACTO con lo registrado en la consola.
export function oauthRedirectUri(req) {
  return process.env.OAUTH_REDIRECT_URI || `${new URL(req.url).origin}/api/auth/callback`;
}

export function safeEqual(a, b) {
  const ab = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// Sólo un camino relativo de este sitio, y nunca la API (evita el open redirect:
// "//x" y "/\x" el browser los lee como otro sitio).
export function safeNext(n) {
  return typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\') && !n.startsWith('/api/')
    ? n : '/';
}

// { userId, email } de la cookie de sesión, o null.
export async function sessionUser(req) {
  const token = session.get(req);
  if (!token) return null;
  const p = await verifySession(token);
  return p?.sub ? { userId: p.sub, email: p.email } : null;
}
