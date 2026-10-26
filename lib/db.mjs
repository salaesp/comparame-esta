// Acceso a la base (Cloudflare D1, SQLite). El browser nunca toca esto: todo pasa
// por los handlers de api/, que scopean cada consulta por usuario.
//
//   setDbEnv(env)        el Worker inyecta el binding (env.DB) en cada request.
//   sql(text, params)    una consulta; devuelve las filas. Placeholders ?1, ?2…
//   txBatch(statements)  [[text, params], …] en un batch atómico (D1 no tiene
//                        transacciones interactivas: un batch corre todo o nada).
//                        Devuelve las filas de cada sentencia (para los RETURNING).
//
// Los booleans van como 1/0 y undefined como null (D1 no acepta otra cosa).
//
// El schema se aplica solo, como en Gastienzos: schema_meta guarda un hash de
// SCHEMA_STATEMENTS y el chequeo viaja como primera sentencia del batch de la
// primera consulta del isolate (schemaGuard): si la versión no coincide, el batch
// falla entero, se aplica el schema y se reintenta. Así no es una vuelta aparte.
// Aplicarlo son tres vueltas: el DDL; qué columnas tienen las tablas de MIGRATIONS; y
// las ALTER que faltan junto con la versión.

let _db = null;
export function setDbEnv(env) {
  if (env?.DB) _db = env.DB;
}
function db() {
  if (!_db) throw new Error('Base no configurada: falta el binding D1 (env.DB, ver wrangler.toml)');
  return _db;
}

const bindable = (params = []) => params.map((p) => {
  if (p === undefined) return null;
  if (typeof p === 'boolean') return p ? 1 : 0;
  return p;
});
const prep = (text, params = []) => {
  const s = db().prepare(text);
  return params.length ? s.bind(...bindable(params)) : s;
};

let _schemaOk = false;
let _version = null;
async function schemaVersion() {
  if (_version) return _version;
  const { SCHEMA_STATEMENTS, MIGRATIONS } = await import('./schema.mjs');
  const { createHash } = await import('node:crypto');
  _version = createHash('sha256').update([...SCHEMA_STATEMENTS, ...MIGRATIONS].join(';\n')).update(allowedEmails().join(',')).digest('hex');
  return _version;
}
const allowedEmails = () => (process.env.ALLOWED_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
// json('x') tira "malformed JSON": así una condición hace fallar el batch sin escribir nada.
const schemaGuard = (version) => prep(
  "select json(case when (select version from schema_meta where id = 1) = ?1 then '1' else 'schema viejo' end) as ok",
  [version],
);

// "alter table lugares add column ciudad …" → ['lugares', 'ciudad'].
const ALTER_RE = /^alter table (\w+) add column (\w+)/i;
async function applySchema() {
  const { SCHEMA_STATEMENTS, MIGRATIONS } = await import('./schema.mjs');
  const version = await schemaVersion();
  try {
    const r = await prep('select version from schema_meta where id = 1').all();
    if (r.results?.[0]?.version === version) return false;
  } catch { /* schema_meta todavía no existe (base vacía) */ }
  await db().batch([
    ...SCHEMA_STATEMENTS.map((s) => db().prepare(s)),
    ...allowedEmails().map((e) => prep('insert into allowed_emails (email) values (?1) on conflict (email) do nothing', [e])),
  ]);
  const tablas = [...new Set(MIGRATIONS.map((m) => m.match(ALTER_RE)?.[1]).filter(Boolean))];
  const cols = tablas.length
    ? (await prep(`select m.name as t, p.name as c from sqlite_master m join pragma_table_info(m.name) p
                    where m.type = 'table' and m.name in (select value from json_each(?1))`, [JSON.stringify(tablas)]).all()).results || []
    : [];
  const hay = new Set(cols.map((r) => `${r.t}.${r.c}`));
  const faltan = MIGRATIONS.filter((m) => { const x = m.match(ALTER_RE); return !x || !hay.has(`${x[1]}.${x[2]}`); });
  const setVersion = prep(`insert into schema_meta (id, version) values (1, ?1)
          on conflict (id) do update set version = excluded.version, applied_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`, [version]);
  try {
    await db().batch([...faltan.map((m) => db().prepare(m)), setVersion]);
  } catch (e) {
    // Otro request las agregó a la par: de a una, tragándose las que ya están.
    if (!/duplicate column name/i.test(String(e?.message || e))) throw e;
    for (const m of faltan) {
      try { await db().prepare(m).all(); } catch (e2) { if (!/duplicate column name/i.test(String(e2?.message || e2))) throw e2; }
    }
    await setVersion.all();
  }
  return true;
}

const runPlain = async (stmts) => (stmts.length === 1 ? [await stmts[0].all()] : db().batch(stmts));
async function runChecked(build) {
  if (_schemaOk) return runPlain(build());
  const guard = schemaGuard(await schemaVersion());
  try {
    const r = await db().batch([guard, ...build()]);
    _schemaOk = true;
    return r.slice(1);
  } catch (e) {
    const applied = await applySchema();
    _schemaOk = true;
    if (applied) return runPlain(build());
    throw e; // la versión estaba bien: el error es de la consulta
  }
}

export async function sql(text, params = []) {
  const [r] = await runChecked(() => [prep(text, params)]);
  return r?.results || [];
}

export async function txBatch(statements) {
  const rs = await runChecked(() => statements.map(([t, p]) => prep(t, p)));
  return rs.map((r) => r.results || []);
}

// Para los tests: que la próxima consulta vuelva a mirar el schema.
export function resetSchemaCheck() {
  _schemaOk = false;
}
