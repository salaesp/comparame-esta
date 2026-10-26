// Un binding D1 sobre SQLite real (node:sqlite), para probar los handlers contra una
// base de verdad. Mismo comportamiento que D1 en lo que usa la app: prepare/bind/all y
// batch atómico.
import { DatabaseSync } from 'node:sqlite';

export function makeD1(sqlite) {
  const mk = (text, bound) => ({
    bind: (...a) => mk(text, a),
    async all() {
      const st = sqlite.prepare(text);
      return { results: st.all(...(bound || [])) };
    },
    async run() { return this.all(); },
  });
  return {
    prepare: (text) => mk(text),
    async batch(stmts) {
      sqlite.exec('begin');
      try {
        const out = [];
        for (const s of stmts) out.push(await s.all());
        sqlite.exec('commit');
        return out;
      } catch (e) {
        sqlite.exec('rollback');
        throw e;
      }
    },
  };
}

// Una base vacía con el schema aplicado por lib/db.mjs (como en producción).
export async function baseNueva() {
  process.env.SESSION_SECRET ||= 'test-secret-para-los-tests-32bytes!!';
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('pragma foreign_keys = on');
  const db = await import('../../lib/db.mjs');
  db.setDbEnv({ DB: makeD1(sqlite) });
  db.resetSchemaCheck();
  await db.sql('select 1');
  return { sqlite, ...db };
}

// Un usuario con su cookie de sesión.
export async function usuario(sql, email, name = email.split('@')[0]) {
  const { signSession } = await import('../../lib/auth.mjs');
  const [u] = await sql('insert into users (email, name) values (?1, ?2) returning id', [email, name]);
  const token = await signSession({ userId: u.id, email });
  return { id: u.id, email, name, cookie: `cmp_session=${encodeURIComponent(token)}` };
}

// Un pedido al Worker entero, como lo haría la app.
export async function pedir(worker, u, method, path, body) {
  const headers = { cookie: u?.cookie || '' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await worker.fetch(new Request(`https://comparame.test${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  }), { ASSETS: { fetch: async () => new Response('asset') } });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
}
