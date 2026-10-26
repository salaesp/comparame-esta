// El schema de la base (D1 / SQLite). Todo es idempotente ("if not exists"): lib/db.mjs
// lo aplica solo cuando cambia (hash en schema_meta). Una columna nueva en una tabla
// que ya existe no entra con "create table if not exists": cuando haga falta, va
// también como un "alter table … add column" aparte (todavía no hubo ninguna).
//
// El catálogo (lugares, productos, alias) es de TODOS: son hechos ("la Playadito de
// 1 kg existe", "Carrefour Cabildo existe"), así el reconocimiento mejora con cada
// ticket de cualquiera. Los tickets y los precios son de quien los cargó y los ven
// sólo él y sus amigos (lib/amigos.mjs, VISIBLES).

const NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";
const ID = "(lower(hex(randomblob(16))))";

export const SCHEMA_STATEMENTS = [
  `create table if not exists schema_meta (
    id integer primary key check (id = 1),
    version text not null,
    applied_at text not null default ${NOW}
  )`,

  // ---------- Personas ----------
  `create table if not exists users (
    id text primary key default ${ID},
    email text not null unique,
    name text not null default '',
    picture text not null default '',
    created_at text not null default ${NOW},
    last_login_at text
  )`,
  // Pasan aunque la app esté llena (lib/cupo.mjs). Se siembran de ALLOWED_EMAILS.
  'create table if not exists allowed_emails (email text primary key)',
  // Quien quiso entrar con la app llena. No se muestra en la app.
  `create table if not exists lista_espera (
    email text primary key,
    name text not null default '',
    first_at text not null default ${NOW},
    last_at text not null default ${NOW}
  )`,

  // ---------- Amigos ----------
  // Una fila por par, con el id menor en user_a.
  `create table if not exists amistades (
    user_a text not null references users(id) on delete cascade,
    user_b text not null references users(id) on delete cascade,
    created_at text not null default ${NOW},
    primary key (user_a, user_b),
    check (user_a < user_b)
  )`,
  'create index if not exists amistades_b_idx on amistades (user_b)',
  // Un link de invitación: se guarda sólo el hash del token; sirve una vez.
  `create table if not exists links_amigo (
    id text primary key default ${ID},
    user_id text not null references users(id) on delete cascade,
    token_hash text not null unique,
    created_at text not null default ${NOW},
    expires_at text not null,
    aceptado_por text references users(id) on delete set null,
    aceptado_at text,
    revocado_at text
  )`,
  'create index if not exists links_amigo_user_idx on links_amigo (user_id, created_at)',

  // ---------- Catálogo (de todos) ----------
  // Una sucursal. lugar_key la reconoce en el próximo ticket (lib/productos.mjs lugarKey).
  `create table if not exists lugares (
    id text primary key default ${ID},
    cadena text not null default '',
    sucursal text not null default '',
    direccion text not null default '',
    cuit text not null default '',
    cadena_key text not null default '',
    lugar_key text not null unique,
    creado_por text references users(id) on delete set null,
    created_at text not null default ${NOW}
  )`,
  'create index if not exists lugares_cadena_idx on lugares (cadena_key)',
  // Un producto: marca + nombre + medida (500 g, 1 l, 4 u). El EAN, si se sabe.
  `create table if not exists productos (
    id text primary key default ${ID},
    nombre text not null,
    marca text not null default '',
    medida real,
    medida_unidad text not null default '' check (medida_unidad in ('', 'g', 'ml', 'u')),
    ean text not null default '',
    nombre_key text not null default '',
    creado_por text references users(id) on delete set null,
    created_at text not null default ${NOW},
    updated_at text not null default ${NOW}
  )`,
  'create index if not exists productos_ean_idx on productos (ean)',
  // Los códigos internos de una pieza pesada se guardaron como EAN hasta la 0.2.1
  // (lib/productos.mjs eanValido): se sacan. Idempotente.
  "update productos set ean = '' where ean like '2%'",
  'create index if not exists productos_key_idx on productos (nombre_key)',
  // Cómo escribe un producto el ticket de una cadena ("YERBA PLAYADITO 1KG" en Carrefour).
  `create table if not exists alias (
    cadena_key text not null,
    texto_key text not null,
    producto_id text not null references productos(id) on delete cascade,
    creado_por text references users(id) on delete set null,
    created_at text not null default ${NOW},
    primary key (cadena_key, texto_key)
  )`,
  'create index if not exists alias_producto_idx on alias (producto_id)',

  // ---------- Lo de cada uno (lo ven él y sus amigos) ----------
  `create table if not exists tickets (
    id text primary key default ${ID},
    user_id text not null references users(id) on delete cascade,
    lugar_id text references lugares(id) on delete set null,
    fecha text not null,
    total real,
    pagado real not null default 0,
    n_fotos integer not null default 1,
    n_renglones integer not null default 0,
    modelo text not null default '',
    created_at text not null default ${NOW}
  )`,
  'create index if not exists tickets_user_idx on tickets (user_id, fecha)',
  'create index if not exists tickets_lugar_idx on tickets (lugar_id, fecha)',
  // Un renglón del ticket. Se guarda todo: el precio de lista por unidad, lo impreso
  // (importe), el descuento y lo pagado. Para comparar: precio_unit (lo pagado por
  // unidad o por kg) y precio_medida (por kg, litro o unidad de la medida).
  `create table if not exists precios (
    id text primary key default ${ID},
    ticket_id text not null references tickets(id) on delete cascade,
    user_id text not null references users(id) on delete cascade,
    lugar_id text references lugares(id) on delete set null,
    producto_id text references productos(id) on delete set null,
    fecha text not null,
    orden integer not null default 0,
    texto text not null,
    cantidad real not null,
    unidad text not null default 'u' check (unidad in ('u', 'kg')),
    precio_lista real,
    importe real not null,
    descuento real not null default 0,
    pagado real not null,
    precio_unit real not null,
    precio_medida real,
    created_at text not null default ${NOW}
  )`,
  'create index if not exists precios_producto_idx on precios (producto_id, fecha)',
  'create index if not exists precios_user_idx on precios (user_id, fecha)',
  'create index if not exists precios_ticket_idx on precios (ticket_id, orden)',
  'create index if not exists precios_lugar_idx on precios (lugar_id, fecha)',

  // Cada lectura con Claude: para saber cuánto cuesta y cuánto tarda. No se muestra.
  `create table if not exists lecturas (
    id text primary key default ${ID},
    user_id text references users(id) on delete set null,
    modelo text not null,
    esfuerzo text not null default '',
    fotos integer not null,
    renglones integer not null default 0,
    input_tokens integer not null default 0,
    output_tokens integer not null default 0,
    costo_usd real not null default 0,
    ms integer not null default 0,
    ok integer not null default 1,
    error text not null default '',
    created_at text not null default ${NOW}
  )`,
  'create index if not exists lecturas_user_idx on lecturas (user_id, created_at)',
];
