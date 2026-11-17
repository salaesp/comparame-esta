// El schema de la base (D1 / SQLite). Todo es idempotente ("if not exists"): lib/db.mjs
// lo aplica solo cuando cambia (hash en schema_meta). Una columna nueva en una tabla
// que ya existe no entra con "create table if not exists": va en el create table (para
// las bases nuevas) y también en MIGRATIONS, que corre después tragándose sólo el
// "duplicate column name" (SQLite no tiene "add column if not exists").
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
  // Una sucursal. lugar_key es la clave con que se creó; para reconocerla en el próximo
  // ticket están todas las suyas en lugar_claves (lib/productos.mjs lugarKeys). La ciudad
  // va aparte de la dirección; punto_venta, el de la factura (sólo dígitos, sin ceros).
  // lat/lon: el punto en el mapa (lib/geo.mjs); geo_at, cuándo se buscó (lat null = no está).
  `create table if not exists lugares (
    id text primary key default ${ID},
    cadena text not null default '',
    sucursal text not null default '',
    direccion text not null default '',
    ciudad text not null default '',
    punto_venta text not null default '',
    cuit text not null default '',
    lat real,
    lon real,
    geo_at text,
    cadena_key text not null default '',
    lugar_key text not null unique,
    creado_por text references users(id) on delete set null,
    created_at text not null default ${NOW}
  )`,
  'create index if not exists lugares_cadena_idx on lugares (cadena_key)',
  // Todas las claves de cada lugar: la de su dirección, las de sus puntos de venta. Al
  // juntar dos lugares, las del que se va pasan al que queda.
  `create table if not exists lugar_claves (
    clave text primary key,
    lugar_id text not null references lugares(id) on delete cascade
  )`,
  'create index if not exists lugar_claves_lugar_idx on lugar_claves (lugar_id)',
  // Los lugares de antes de la 0.3.0 tenían una sola clave, lugar_key. Idempotente.
  'insert into lugar_claves (clave, lugar_id) select lugar_key, id from lugares where true on conflict (clave) do nothing',
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

  // ---------- Los precios online (de todos; lib/online.mjs) ----------
  // Uno por producto de la web de una cadena (imagen: su foto, la del producto en la app). visto_at: la última vez que la tienda lo
  // devolvió; cambio_at: desde cuándo tiene este precio. Se cruza con productos por el EAN.
  `create table if not exists online_productos (
    cadena text not null,
    sku text not null,
    ean text not null default '',
    nombre text not null,
    marca text not null default '',
    medida real,
    medida_unidad text not null default '' check (medida_unidad in ('', 'g', 'ml', 'u')),
    unidad text not null default 'u' check (unidad in ('u', 'kg')),
    categoria text not null default '',
    url text not null default '',
    precio real not null,
    precio_lista real,
    precio_medida real,
    promos text not null default '',
    disponible integer not null default 1,
    imagen text not null default '',
    visto_at text not null,
    cambio_at text not null,
    created_at text not null default ${NOW},
    primary key (cadena, sku)
  )`,
  "create index if not exists online_productos_ean_idx on online_productos (ean) where ean <> ''",
  // Cada precio distinto que tuvo (un renglón sólo cuando cambia).
  `create table if not exists online_historial (
    cadena text not null,
    sku text not null,
    precio real not null,
    precio_lista real,
    desde text not null,
    primary key (cadena, sku, desde)
  )`,
  // Los parecidos de un producto sin EAN ("¿Es alguno de estos?"), guardados PARECIDOS_DIAS:
  // q es lo que se buscó (si cambian el nombre, la marca o la medida, se busca de nuevo).
  `create table if not exists online_parecidos (
    producto_id text primary key references productos(id) on delete cascade,
    q text not null,
    buscado_at text not null,
    parecidos text not null default '[]'
  )`,
  // Cuándo se le preguntó a cada cadena por cada EAN y cuántos encontró (0: no lo tiene).
  `create table if not exists online_consultas (
    cadena text not null,
    ean text not null,
    consultado_at text not null,
    encontrados integer not null default 0,
    primary key (cadena, ean)
  )`,
];

// Las columnas que se sumaron a tablas que ya existían (también están en su create table).
export const MIGRATIONS = [
  "alter table lugares add column ciudad text not null default ''",
  "alter table lugares add column punto_venta text not null default ''",
  'alter table lugares add column lat real',
  'alter table lugares add column lon real',
  'alter table lugares add column geo_at text',
  "alter table online_productos add column imagen text not null default ''",
  // No es una columna: corre con cada versión nueva del schema. Lo que se consultó antes de
  // guardar las fotos (0.9.0) se vuelve a consultar, para que traiga la suya.
  "delete from online_consultas where ean in (select ean from online_productos where imagen = '')",
];
