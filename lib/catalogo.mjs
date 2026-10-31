// Lo que cruza la lectura de un ticket con el catálogo (con I/O): qué lugar es, qué
// producto es cada renglón (por alias, por EAN o, si no, candidatos para preguntar) y,
// al guardar, el batch que crea lo nuevo y anota cómo escribe cada cadena sus productos.
import { randomBytes } from 'node:crypto';
import { sql } from './db.mjs';
import { normTexto, cadenaKey, lugarKeys, cuitValido, candidatos, eanValido, nombreKey, medidaDe, tidyNombre } from './productos.mjs';
import { noCierra, cantidadSugerida, controlTotal, preciosDe } from './ticket.mjs';

export const nuevoId = () => randomBytes(16).toString('hex');
const PRODUCTO_COLS = 'id, nombre, marca, medida, medida_unidad, ean';
export const LUGAR_COLS = 'id, cadena, sucursal, direccion, ciudad, punto_venta, cuit, lat, lon, geo_at, cadena_key';
// Lo que se puede completar de un lugar que ya existe con lo que trae un ticket nuevo.
const COMPLETABLES = ['sucursal', 'direccion', 'ciudad', 'punto_venta', 'cuit'];
// Hasta cuántos productos del catálogo se miran para sugerir (alcanza para empezar; si
// el catálogo crece mucho, esto pasa a una búsqueda por palabras).
const CATALOGO_MAX = 5000;

// La lectura limpia (lib/lector.mjs) + el catálogo: el lugar que ya existe, el producto
// de cada renglón y lo que hay que revisar.
// El lugar de un ticket, por la primera de sus claves que ya exista (la dirección antes
// que el punto de venta). null si es nuevo.
export async function buscarLugar(l) {
  if (!l.cadena && !l.cuit) return null;
  const keys = lugarKeys(l);
  const rows = await sql(
    `select c.clave, ${LUGAR_COLS.split(', ').map((x) => `l.${x}`).join(', ')}
       from lugar_claves c join lugares l on l.id = c.lugar_id where c.clave in (select value from json_each(?1))`,
    [JSON.stringify(keys)],
  );
  for (const k of keys) {
    const r = rows.find((x) => x.clave === k);
    if (r) { const { clave, ...lugar } = r; return lugar; }
  }
  return null;
}

// Lo que le falta a un lugar que ya existe y trae el ticket: los UPDATE y las claves nuevas.
export function completarLugarStmts(lugar, l) {
  const stmts = [];
  const set = COMPLETABLES.filter((c) => !lugar[c] && l[c]).map((c) => [c, c === 'cuit' ? cuitValido(l.cuit) : l[c]]).filter(([, v]) => v);
  // El punto del local elegido en el buscador: si el lugar no tenía o cambia de dirección.
  const nuevaDir = set.some(([c]) => c === 'direccion' || c === 'ciudad');
  const punto = l.lat != null && (lugar.lat == null || nuevaDir) ? [l.lat, l.lon] : null;
  if (set.length || punto) {
    // Con otra dirección o ciudad, el punto en el mapa se vuelve a buscar (lib/geo.mjs).
    const n = set.length + 2;
    const geo = punto ? `${set.length ? ', ' : ''}lat = ?${n}, lon = ?${n + 1}, geo_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
      : nuevaDir ? ', lat = null, lon = null, geo_at = null' : '';
    stmts.push([`update lugares set ${set.map(([c], i) => `${c} = ?${i + 2}`).join(', ')}${geo} where id = ?1`,
      [lugar.id, ...set.map(([, v]) => v), ...(punto || [])]]);
  }
  // Las claves se arman con quién es el lugar guardado (su CUIT o su cadena), no lo leído.
  for (const k of lugarKeys({ cuit: lugar.cuit || l.cuit, cadena: lugar.cadena || l.cadena, direccion: l.direccion, punto_venta: l.punto_venta })) {
    stmts.push(['insert into lugar_claves (clave, lugar_id) values (?1, ?2) on conflict (clave) do nothing', [k, lugar.id]]);
  }
  return stmts;
}

export async function cruzarLectura(lectura) {
  const l = lectura.lugar;
  const ck = cadenaKey(l.cadena);
  const textos = [...new Set(lectura.renglones.map((r) => normTexto(r.texto)))];
  const eans = [...new Set(lectura.renglones.map((r) => eanValido(r.ean)).filter(Boolean))];
  const [lugar, alias, porEan, catalogo] = await Promise.all([
    buscarLugar(l),
    ck && textos.length
      ? sql(`select a.texto_key, p.${PRODUCTO_COLS.split(', ').join(', p.')} from alias a join productos p on p.id = a.producto_id
              where a.cadena_key = ?1 and a.texto_key in (select value from json_each(?2))`, [ck, JSON.stringify(textos)])
      : [],
    eans.length ? sql(`select ${PRODUCTO_COLS} from productos where ean in (select value from json_each(?1))`, [JSON.stringify(eans)]) : [],
    sql(`select ${PRODUCTO_COLS} from productos order by updated_at desc limit ${CATALOGO_MAX}`),
  ]);
  const porAlias = new Map(alias.map(({ texto_key, ...p }) => [texto_key, p]));
  const eanMap = new Map(porEan.map((p) => [p.ean, p]));
  const renglones = lectura.renglones.map((r) => {
    const ean = eanValido(r.ean);
    const m = medidaDe(r.medida_cantidad, r.medida_unidad);
    const base = {
      ...r,
      ean: ean || null,
      medida: m?.medida ?? null,
      medida_unidad: m?.unidad ?? '',
      nombre: tidyNombre(r.nombre),
      marca: tidyNombre(r.marca || ''),
      no_cierra: noCierra(r),
      son: cantidadSugerida(r),
    };
    const p = porAlias.get(normTexto(r.texto)) || (ean && eanMap.get(ean));
    if (p) return { ...base, producto: p, via: porAlias.has(normTexto(r.texto)) ? 'alias' : 'ean', sugeridos: [] };
    const sug = candidatos({ marca: base.marca, nombre: base.nombre, medida: base.medida, medida_unidad: base.medida_unidad }, catalogo)
      .map((c) => c.producto);
    return { ...base, producto: null, via: null, sugeridos: sug };
  });
  return {
    ...lectura,
    // El que ya existe, con lo que el ticket le agrega (se le completa al guardar).
    lugar: lugar
      ? { ...l, ...Object.fromEntries(Object.entries(lugar).filter(([, v]) => v)), cadena_key: undefined, existe: true }
      : { ...l, cuit: cuitValido(l.cuit) || l.cuit, existe: false },
    renglones,
    control: controlTotal(lectura),
  };
}

// El batch que guarda un ticket ya validado (lib/ticket.mjs validarTicket). Devuelve
// { stmts, ticketId } o { error, status }.
export async function guardarStmts(userId, { ticket, renglones }) {
  const stmts = [];
  let lugar = ticket.lugar.id
    ? (await sql(`select ${LUGAR_COLS} from lugares where id = ?1`, [ticket.lugar.id]))[0]
    : await buscarLugar(ticket.lugar);
  if (ticket.lugar.id && !lugar) return { error: 'El lugar no existe.', status: 404 };
  const lugarNuevo = !lugar;
  if (lugar) {
    stmts.push(...completarLugarStmts(lugar, ticket.lugar));
  } else {
    const l = ticket.lugar;
    const keys = lugarKeys(l);
    lugar = { id: nuevoId(), cadena_key: cadenaKey(l.cadena) };
    // Con el punto del local elegido en el buscador, ya está ubicado (no pasa por Georef).
    stmts.push([`insert into lugares (id, cadena, sucursal, direccion, ciudad, punto_venta, cuit, cadena_key, lugar_key, creado_por, lat, lon, geo_at)
                 values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, case when ?11 is null then null else strftime('%Y-%m-%dT%H:%M:%fZ', 'now') end)`,
    [lugar.id, l.cadena, l.sucursal, l.direccion, l.ciudad, l.punto_venta, cuitValido(l.cuit), lugar.cadena_key, keys[0], userId, l.lat ?? null, l.lon ?? null]]);
    for (const k of keys) stmts.push(['insert into lugar_claves (clave, lugar_id) values (?1, ?2) on conflict (clave) do nothing', [k, lugar.id]]);
  }
  // Los productos elegidos tienen que existir (para su medida y para no colgar un precio de la nada).
  const ids = [...new Set(renglones.map((r) => r.producto_id).filter(Boolean))];
  const existentes = ids.length
    ? await sql(`select ${PRODUCTO_COLS} from productos where id in (select value from json_each(?1))`, [JSON.stringify(ids)])
    : [];
  const prods = new Map(existentes.map((p) => [p.id, p]));
  if (prods.size !== ids.length) return { error: 'Uno de los productos ya no existe. Volvé a elegirlo.', status: 409 };

  // Un producto nuevo por renglón, salvo que dos renglones del mismo ticket sean el
  // mismo producto nuevo (tres quesos al peso): ésos se crean una vez.
  const nuevos = new Map();
  for (const r of renglones) {
    if (r.producto_id) continue;
    const k = `${nombreKey(r.nuevo)}|${r.nuevo.ean}`;
    if (!nuevos.has(k)) {
      const p = { id: nuevoId(), ...r.nuevo };
      nuevos.set(k, p);
      stmts.push([`insert into productos (id, nombre, marca, medida, medida_unidad, ean, nombre_key, creado_por)
                   values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      [p.id, p.nombre, p.marca, p.medida, p.medida_unidad, p.ean, nombreKey(p), userId]]);
    }
    r.producto_id = nuevos.get(k).id;
    prods.set(r.producto_id, nuevos.get(k));
  }

  const ticketId = nuevoId();
  const fil = renglones.map((r) => ({ ...r, ...preciosDe(r, prods.get(r.producto_id)) }));
  const pagado = Math.round(fil.reduce((s, r) => s + r.pagado, 0) * 100) / 100;
  // ¿Ya está cargado? El mismo lugar, el mismo total y la misma cantidad de productos, con
  // cualquier fecha (la fecha puede haberse leído mal, como un año de dos dígitos). Se avisa
  // y se guarda igual sólo si la persona lo pide (forzar).
  if (!ticket.forzar && !lugarNuevo) {
    const [dup] = await sql(
      `select id, fecha from tickets where user_id = ?1 and lugar_id = ?2 and n_renglones = ?3 and abs(pagado - ?4) < 0.01
        order by created_at desc limit 1`,
      [userId, lugar.id, fil.length, pagado],
    );
    if (dup) return { error: 'Ya cargaste este ticket.', status: 409, duplicado: dup };
  }
  stmts.push([`insert into tickets (id, user_id, lugar_id, fecha, total, pagado, n_fotos, n_renglones, modelo)
               values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
  [ticketId, userId, lugar.id, ticket.fecha, ticket.total, pagado, ticket.n_fotos, fil.length, ticket.modelo]]);
  for (const r of fil) {
    stmts.push([`insert into precios (ticket_id, user_id, lugar_id, producto_id, fecha, orden, texto, cantidad, unidad,
                   precio_lista, importe, descuento, pagado, precio_unit, precio_medida)
                 values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)`,
    [ticketId, userId, lugar.id, r.producto_id, ticket.fecha, r.orden, r.texto, r.cantidad, r.unidad,
      r.precio_lista, r.importe, r.descuento, r.pagado, r.precio_unit, r.precio_medida]]);
    // Cómo lo escribe esta cadena: la próxima vez se reconoce solo. Lo último que se
    // confirmó gana.
    const tk = normTexto(r.texto);
    if (lugar.cadena_key && tk) {
      stmts.push([`insert into alias (cadena_key, texto_key, producto_id, creado_por) values (?1, ?2, ?3, ?4)
                   on conflict (cadena_key, texto_key) do update set producto_id = excluded.producto_id`,
      [lugar.cadena_key, tk, r.producto_id, userId]]);
    }
  }
  return { stmts, ticketId, lugarId: lugar.id };
}

// Cambiar el lugar de un ticket ya guardado (el que se reconoció mal, o el que no tenía
// dirección). l: { cadena, sucursal, direccion, ciudad, lat?, lon? } (lib/ticket.mjs lugarLimpio).
//  - Si con esa dirección ya hay un lugar, el ticket (y sus precios) pasan a ése, que se
//    completa con lo que no tenga.
//  - Si no hay y el ticket es el único del lugar, se corrige el lugar ahí mismo (no queda
//    uno vacío dando vueltas).
//  - Si no, se crea el lugar nuevo y el ticket pasa ahí: los otros tickets del lugar viejo
//    no cambian.
// Devuelve { stmts, lugarId } o { error, status }.
export async function moverTicketStmts(userId, ticketId, l) {
  const [t] = await sql('select id, lugar_id from tickets where id = ?1 and user_id = ?2', [ticketId, userId]);
  if (!t) return { error: 'no encontrado', status: 404 };
  if (!l.cadena) return { error: 'Falta el nombre del comercio.', status: 422 };
  if (!l.direccion) return { error: 'Falta la dirección: buscá el local o escribila.', status: 422 };
  const [viejo] = t.lugar_id ? await sql(`select ${LUGAR_COLS} from lugares where id = ?1`, [t.lugar_id]) : [];
  // Mismo comercio: se reconoce con lo que el lugar ya sabe (su CUIT).
  const cuit = viejo && cadenaKey(viejo.cadena) === cadenaKey(l.cadena) ? viejo.cuit : '';
  const nuevo = { ...l, cuit, punto_venta: '' };
  const destino = await buscarLugar(nuevo);
  const mover = (id) => [
    ['update tickets set lugar_id = ?1 where id = ?2', [id, ticketId]],
    ['update precios set lugar_id = ?1 where ticket_id = ?2', [id, ticketId]],
  ];
  if (destino) {
    if (destino.id === viejo?.id) return { stmts: completarLugarStmts(destino, nuevo), lugarId: destino.id };
    return { stmts: [...completarLugarStmts(destino, nuevo), ...mover(destino.id)], lugarId: destino.id };
  }
  const [{ otros }] = viejo
    ? await sql('select count(*) as otros from tickets where lugar_id = ?1 and id <> ?2', [viejo.id, ticketId])
    : [{ otros: 1 }];
  const keys = lugarKeys(nuevo);
  if (!otros) {
    // El único ticket del lugar: se corrige el lugar (sus claves viejas quedan, como al corregirlo desde la ficha).
    const punto = l.lat != null ? [l.lat, l.lon] : [null, null];
    // Otro comercio no lleva el CUIT del de antes.
    const stmts = [[`update lugares set cadena = ?2, cadena_key = ?3, sucursal = ?4, direccion = ?5, ciudad = ?6, lat = ?7, lon = ?8,
        geo_at = case when ?7 is null then null else strftime('%Y-%m-%dT%H:%M:%fZ', 'now') end, cuit = ?9 where id = ?1`,
    [viejo.id, l.cadena, cadenaKey(l.cadena), l.sucursal || viejo.sucursal, l.direccion, l.ciudad || (l.direccion === viejo.direccion ? viejo.ciudad : ''), ...punto, cuitValido(cuit)]]];
    for (const k of keys) stmts.push(['insert into lugar_claves (clave, lugar_id) values (?1, ?2) on conflict (clave) do nothing', [k, viejo.id]]);
    return { stmts, lugarId: viejo.id };
  }
  const id = nuevoId();
  const stmts = [[`insert into lugares (id, cadena, sucursal, direccion, ciudad, punto_venta, cuit, cadena_key, lugar_key, creado_por, lat, lon, geo_at)
                 values (?1, ?2, ?3, ?4, ?5, '', ?6, ?7, ?8, ?9, ?10, ?11, case when ?10 is null then null else strftime('%Y-%m-%dT%H:%M:%fZ', 'now') end)`,
  [id, l.cadena, l.sucursal, l.direccion, l.ciudad, cuitValido(cuit), cadenaKey(l.cadena), keys[0], userId, l.lat ?? null, l.lon ?? null]]];
  for (const k of keys) stmts.push(['insert into lugar_claves (clave, lugar_id) values (?1, ?2) on conflict (clave) do nothing', [k, id]]);
  return { stmts: [...stmts, ...mover(id)], lugarId: id };
}
