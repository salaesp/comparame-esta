// Helpers HTTP de los handlers (Web Request/Response). Respuestas JSON con no-store:
// los datos son de cada usuario y nunca se cachean.

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

export function json(data, status = 200, extraHeaders) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...(extraHeaders || {}) } });
}

export function error(message, status = 400, extra) {
  return json({ ok: false, error: message, ...(extra || {}) }, status);
}

// 302 que puede setear cookies (Response.redirect no deja agregar headers).
export function redirect(location, cookies = []) {
  const headers = new Headers({ location });
  for (const c of cookies) headers.append('set-cookie', c);
  return new Response(null, { status: 302, headers });
}

// El body puede venir vacío o mal formado: no explota, devuelve null.
export async function readJson(req) {
  try {
    const text = await req.text();
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

// Los segmentos del camino: "/api/productos/abc" → ['api', 'productos', 'abc'].
export const segs = (req) => new URL(req.url).pathname.split('/').filter(Boolean);
