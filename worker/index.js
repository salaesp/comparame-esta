// Entry del Worker (Cloudflare Workers + static assets). Un router que despacha a los
// handlers de api/, que son (Request) → Response y declaran sus rutas en
// `export const config = { path }`. Los segmentos `:param` matchean cualquier valor:
// cada handler re-parsea su URL. El Worker corre sólo para /api/* (run_worker_first);
// el resto lo sirven los assets.
import * as amigos from '../api/amigos.mjs';
import * as authCallback from '../api/auth-callback.mjs';
import * as authLogin from '../api/auth-login.mjs';
import * as authLogout from '../api/auth-logout.mjs';
import * as boot from '../api/boot.mjs';
import * as productos from '../api/productos.mjs';
import * as tickets from '../api/tickets.mjs';
import { setDbEnv } from '../lib/db.mjs';

const MODULES = [amigos, authCallback, authLogin, authLogout, boot, productos, tickets];

// [segmentos del patrón, handler]. Se arma una vez por isolate. Las rutas fijas antes
// que las de parámetro, así /api/tickets/leer no cae en /api/tickets/:id de otro handler.
export const ROUTES = MODULES.flatMap((m) => {
  const paths = Array.isArray(m.config?.path) ? m.config.path : [m.config?.path].filter(Boolean);
  return paths.map((p) => ({ segs: p.split('/').filter(Boolean), fn: m.default }));
}).sort((a, b) => a.segs.filter((s) => s.startsWith(':')).length - b.segs.filter((s) => s.startsWith(':')).length);

export function match(segs, pathname) {
  const parts = pathname.split('/').filter(Boolean);
  return parts.length === segs.length && segs.every((s, i) => s.startsWith(':') || s === parts[i]);
}

export default {
  async fetch(request, env) {
    setDbEnv(env);
    const pathname = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
    const route = ROUTES.find((r) => match(r.segs, pathname));
    if (route) {
      try {
        return await route.fn(request, env);
      } catch (e) {
        console.error('[api]', pathname, e?.stack || e);
        return new Response(JSON.stringify({ ok: false, error: 'Algo falló. Probá de nuevo.' }), {
          status: 500, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
        });
      }
    }
    if (pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ ok: false, error: 'no encontrado' }), {
        status: 404, headers: { 'content-type': 'application/json' },
      });
    }
    return env.ASSETS.fetch(request);
  },
};
