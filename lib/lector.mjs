// La lectura de un ticket con Claude: el pedido (todas las fotos juntas), la forma fija
// de la respuesta (structured outputs) y la limpieza de lo que contesta. La llamada
// misma vive en leerTicket(); lo demás es puro y lo prueba test/lector.test.mjs.
//
// Claude NO decide nada que se guarde: lo que devuelve se valida acá (un número que no
// es un monto se cae), el server lo controla contra el total (lib/ticket.mjs) y la
// persona lo revisa antes de guardar.
import { ciudadLimpia, pvLimpio } from './productos.mjs';

// Los modelos y su precio por millón de tokens (US$, entrada / salida). El que usa la
// app sale de la variable LECTOR_MODELO del Worker (se cambia sin deploy); se elige
// midiendo con scripts/medir-modelos.mjs: con Carrefour y dos facturas de Nini los tres leen
// bien y Haiku con esfuerzo bajo sale 10 a 25 veces más barato (docs/diseno.md, la medición).
export const MODELOS = {
  'claude-opus-5-5': { in: 4, out: 20, fallbacks: true },
  'claude-sonnet-5-5': { in: 2, out: 10, fallbacks: true },
  'claude-haiku-5-5': { in: 0.10, out: 0.50, fallbacks: false },
};
export const MODELO_DEFAULT = 'claude-haiku-5-5';
export const ESFUERZOS = ['low', 'medium', 'high'];
export const ESFUERZO_DEFAULT = 'low';

export function lectorConfig(env = process.env) {
  const modelo = MODELOS[env.LECTOR_MODELO] ? env.LECTOR_MODELO : MODELO_DEFAULT;
  const esfuerzo = ESFUERZOS.includes(env.LECTOR_ESFUERZO) ? env.LECTOR_ESFUERZO : ESFUERZO_DEFAULT;
  return { modelo, esfuerzo };
}

// Cuántas fotos entran en un ticket y cuánto puede pesar cada una (el teléfono las
// achica a ~1600 px en JPEG, ~300 KB; el tope es por si llega una sin achicar).
export const FOTOS_MAX = 6;
export const FOTO_MAX_BYTES = 3_000_000;
export const IMAGE_RE = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/;
// Con streaming (leerTicket): un ticket largo con el razonamiento del modelo pasa los 16.000.
export const LECTOR_MAX_TOKENS = 32000;

export function costoUsd(modelo, usage = {}) {
  const p = MODELOS[modelo];
  if (!p) return 0;
  const inTok = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) * 1.25 + (usage.cache_read_input_tokens || 0) * 0.1;
  return Math.round(((inTok * p.in + (usage.output_tokens || 0) * p.out) / 1e6) * 1e6) / 1e6;
}

const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
const NUM = { type: 'number' };
const STR = { type: 'string' };
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });

// La forma de la respuesta. Todo campo es obligatorio (structured outputs lo exige):
// lo que no se lee va en null.
export const RESPUESTA_SCHEMA = obj({
  lugar: obj({
    cadena: nullable(STR),
    sucursal: nullable(STR),
    direccion: nullable(STR),
    ciudad: nullable(STR),
    punto_venta: nullable(STR),
    cuit: nullable(STR),
  }),
  fecha: nullable(STR),
  total: nullable(NUM),
  subtotal: nullable(NUM),
  ahorro: nullable(NUM),
  recargos: nullable(NUM),
  iva_aparte: { type: 'boolean' },
  columnas: { type: 'array', items: STR },
  renglones: {
    type: 'array',
    items: obj({
      foto: { type: 'integer' },
      texto: STR,
      cantidad: NUM,
      unidad: { type: 'string', enum: ['u', 'kg'] },
      precio_unitario: nullable(NUM),
      importe: NUM,
      descuento: NUM,
      iva: nullable(NUM),
      ean: nullable(STR),
      marca: nullable(STR),
      nombre: STR,
      medida_cantidad: nullable(NUM),
      medida_unidad: nullable({ type: 'string', enum: ['g', 'kg', 'ml', 'l', 'u'] }),
    }),
  },
  descartados: {
    type: 'array',
    items: obj({
      foto: { type: 'integer' },
      texto: STR,
      importe: nullable(NUM),
      motivo: { type: 'string', enum: ['repetido', 'informativo', 'no_es_producto'] },
    }),
  },
  avisos: { type: 'array', items: STR },
});

export const SISTEMA = `Sos un lector de tickets de compra argentinos (supermercados, almacenes, farmacias, mayoristas). \
Leés las fotos de UN ticket y devolvés sus productos con sus precios, exactamente como están impresos. \
No inventes nada: lo que no se lee va en null.`;

// La consigna, después de las fotos. `n` = cuántas fotos son.
export function consigna({ n, hoy = '' }) {
  const varias = n > 1
    ? `Son ${n} fotos de un MISMO ticket largo, en orden: la foto 1 es el principio y la ${n} el final. \
Al sacarlas se pisan: el principio de una foto puede repetir los últimos renglones de la anterior. \
Cada producto va UNA sola vez en "renglones", en la foto donde aparece primero; sus repeticiones van en \
"descartados" con motivo "repetido". Un renglón cortado por el borde de la foto (por ejemplo "1 x 6900,00" sin \
nombre, o "1 x 0.660 x 2299.00") que corresponde a un producto de la foto anterior también es "repetido". \
Pero dos renglones iguales seguidos DENTRO de una misma foto (tres quesos al peso uno abajo del otro) son \
compras distintas: van los dos.`
    : 'Es una foto de un ticket (puede ser sólo una parte, si es largo).';
  return `${varias}

Reglas:
- "renglones": un elemento por producto comprado, en el orden del ticket. "foto" es el número de la foto (desde 1).
- "texto": el renglón del producto tal cual está impreso (marca, producto y tamaño), sin el código interno.
- "cantidad": cuántas unidades o cuántos kilos se llevaron (no el precio). "unidad": "kg" si se vende por peso, si no "u". \
En "1 x 0.305 x 46435.00" son 0.305 kg a 46435 el kg. Si hay columnas "CANTIDAD" y "U.B." (unidades por bulto), \
la cantidad son las unidades: CANTIDAD × U.B. (1 bulto de 6 son 6).
- "precio_unitario": el precio por unidad (o por kg) impreso en el renglón, o null.
- "importe": el importe impreso en el renglón del producto, ANTES de sus descuentos.
- Los descuentos ("2do50%-NESCAF", "MC TOSTADAS", "25%dto-DOWNY", "Promoción", un importe negativo) no son productos: \
sumá su valor (positivo) en "descuento" del producto al que se refieren (casi siempre el de arriba) y no los listes. \
Si no tiene descuento, 0. Si al pie se repiten todos los descuentos juntos (un bloque "DESCUENTOS"), esos van en \
"descartados" con motivo "informativo".
- No hagas cuentas: copiá cada número como está impreso. La app hace las cuentas.
- El IVA: en un ticket común los precios ya lo traen, aunque el renglón diga "(21,00%)": "iva_aparte": false. Pero si \
la factura lista los precios SIN IVA (tiene columnas como "PRECIO SIN I.V.A." y "%I.V.A." y el IVA se suma aparte al \
pie; pasa en mayoristas aunque la factura sea B), "iva_aparte": true y en cada renglón: "importe" el de la columna \
TOTAL tal cual (sin IVA) y "precio_unitario" el de la columna "PRECIO SIN I.V.A.". La app le suma el IVA.
- "iva": el % de IVA impreso en el renglón (21, 10.5), en cualquier ticket; null si no figura.
- "columnas": los títulos de las columnas de los productos tal como están impresos ("CANTIDAD", "DESCRIPCION", \
"PRECIO SIN I.V.A."…); vacío si el ticket no tiene columnas con título.
- Una promoción que ya está aplicada en el importe del renglón (por ejemplo, un renglón "Promoción 184820" debajo del \
producto con el precio de promo, y el TOTAL del renglón ya rebajado) no es un descuento aparte: descuento 0. Los \
descuentos que se listan al pie y ya están aplicados en los importes van en "descartados" con motivo "informativo".
- Impuestos internos ("Imp. Interno"), percepciones, recargos, bolsas, redondeos, vuelto, medios de pago y subtotales no \
son productos: van en "descartados" con motivo "no_es_producto" si tienen importe.
- "recargos": la suma de lo que se cobra en el TOTAL y no es un producto NI el IVA: impuestos internos, percepciones \
(IIBB, municipales), recargos. El IVA ("I.V.A. INSC.") nunca va acá. null si no hay.
- "ean": sólo si al lado del producto hay impreso un código de barras de 8 o 13 dígitos; si no, null.
- "marca", "nombre", "medida_cantidad" y "medida_unidad": el producto normalizado, para reconocerlo en otros tickets. \
"nombre" es qué es, en castellano y sin la marca ni el tamaño ("Yerba mate", "Fideos tirabuzón sin TACC", \
"Queso reggianito"). "marca" la marca si se sabe ("Playadito", "Matarazzo"; "Carrefour" si es la marca propia). \
La medida del envase si figura ("X 500" en fideos son 500 g; "1 LT" es 1 l; "4 X" en papel higiénico son 4 u). \
Lo que va por peso no tiene medida: null.
- "lugar": "cadena" es el nombre comercial corto ("Carrefour", "Coto", "Día", "Jumbo", no la razón social), \
"sucursal" si el ticket la nombra, "direccion" sólo la calle y altura de la sucursal (no la de la sede fiscal si \
figuran las dos; sin la ciudad ni el código postal), "ciudad" la localidad de esa dirección ("CABA", "Rosario", \
"Villa Allende"; null si no figura), "punto_venta" el número de punto de venta ("P.V. Nro.", "Pto. Vta.", o los \
primeros 4 o 5 dígitos del número de comprobante: en "0101-00012345" es "0101"; null si no figura), "cuit" el CUIT \
del comercio.
- "total": el TOTAL a pagar. "subtotal": el subtotal impreso: en un ticket común, el de antes de los descuentos; con \
"iva_aparte": true, el SUBTOTAL sin IVA (la suma de la columna TOTAL, el primer número del resumen del pie, aunque \
el renglón esté corrido). "ahorro": el total de descuentos o "AHORRO", si está y si no está ya aplicado en los \
importes. null si no aparece en ninguna foto.
- "fecha" en formato YYYY-MM-DD (en el ticket está como día/mes/año). Con el año en dos dígitos, es del 2000: \
"25/10/26" es 2026-10-25. Hoy es ${hoy || 'desconocido'}: un ticket no puede ser de después de hoy.
- En Argentina "12.430,50" es 12430.50: los números van con punto decimal y sin separador de miles.
- "avisos": frases cortas en castellano si algo no se pudo leer bien (una foto borrosa, un renglón tapado, \
fotos que no son del mismo ticket). Vacío si está todo bien.`;
}

// El contenido del mensaje: "Foto 1 de 3" + la imagen, una por una, y la consigna al final.
export function contenido(fotos, { hoy = '' } = {}) {
  const out = [];
  fotos.forEach((uri, i) => {
    const m = IMAGE_RE.exec(uri);
    out.push({ type: 'text', text: `Foto ${i + 1} de ${fotos.length}` });
    out.push({ type: 'image', source: { type: 'base64', media_type: `image/${m[1]}`, data: m[2] } });
  });
  out.push({ type: 'text', text: consigna({ n: fotos.length, hoy }) });
  return out;
}

// Las fotos que llegan del teléfono: data URIs de imagen, hasta FOTOS_MAX y FOTO_MAX_BYTES.
// Devuelve el mensaje de error o null.
export function fotosError(fotos) {
  if (!Array.isArray(fotos) || !fotos.length) return 'Falta la foto del ticket.';
  if (fotos.length > FOTOS_MAX) return `Son ${FOTOS_MAX} fotos como mucho por ticket.`;
  for (const f of fotos) {
    if (typeof f !== 'string' || !IMAGE_RE.test(f)) return 'Una de las fotos no es una imagen.';
    if (f.length > FOTO_MAX_BYTES) return 'Una de las fotos es demasiado grande.';
  }
  return null;
}

// ---------- La limpieza de la respuesta ----------
const round2 = (n) => Math.round(n * 100) / 100;
const round3 = (n) => Math.round(n * 1000) / 1000;
const montoOk = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e9 ? round2(v) : null);
const texto = (v, max = 160) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const IVAS = [2.5, 5, 10.5, 21, 27];
// Lo impreso sin IVA, con el IVA del renglón sumado (default 21%).
const conIva = (v, iva) => (v == null ? v : round2(v * (1 + iva / 100)));
const fechaOk = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);

// Si cantidad × precio no da el importe, la cantidad se leyó mal (estaba tapada, o se
// tomó la columna de los bultos y no la de las unidades): lo que va por kilo pasa a
// importe / precio; lo que va por unidad, a n si el importe es justo n veces el precio
// (si no es un número entero, es una promo: queda como está y la revisión lo marca).
function cantidadQueCierra(cantidad, unidad, precio, importe, descuento) {
  if (!(precio > 0) || descuento > 0) return cantidad;
  if (Math.abs(cantidad * precio - importe) <= Math.max(1, importe * 0.005)) return cantidad;
  const q = importe / precio;
  if (unidad === 'kg') return q > 0 && q <= 1000 ? round3(q) : cantidad;
  const n = Math.round(q);
  return n >= 1 && n <= 100 && Math.abs(importe - n * precio) <= importe * 0.002 + 0.05 ? n : cantidad;
}

// Una columna "PRECIO SIN I.V.A." dice que la factura lista los precios sin IVA, aunque el
// modelo no lo haya marcado (pasaba con una hoja cortada de Nini).
const SIN_IVA_RE = /sin\s*i\.?\s*v\.?\s*a/i;
// Una fecha del futuro no es la del ticket (se leyó mal): mejor sin fecha, que la revisión
// complete con hoy.
const fechaHasta = (f, hoy) => (f && hoy && f > hoy ? null : f);
export function limpiarRespuesta(r, { nFotos = 1, hoy = '' } = {}) {
  const fotoOk = (f) => (Number.isInteger(f) && f >= 1 && f <= nFotos ? f : 1);
  const columnas = (Array.isArray(r?.columnas) ? r.columnas : []).map((c) => texto(c, 40)).filter(Boolean).slice(0, 12);
  const ivaAparte = r?.iva_aparte === true || columnas.some((c) => SIN_IVA_RE.test(c));
  const renglones = [];
  for (const x of Array.isArray(r?.renglones) ? r.renglones : []) {
    const impreso = montoOk(x?.importe);
    let cantidad = typeof x?.cantidad === 'number' && x.cantidad > 0 && x.cantidad <= 1000 ? round3(x.cantidad) : null;
    const t = texto(x?.texto);
    if (impreso == null || !(impreso > 0) || cantidad == null || !t) continue;
    const unidad = x.unidad === 'kg' ? 'kg' : 'u';
    const desc = Math.min(montoOk(x?.descuento) || 0, impreso);
    // Con los precios sin IVA, la app le suma el IVA de cada renglón (el modelo sólo copia).
    const iva = ivaAparte ? (IVAS.includes(x.iva) ? x.iva : 21) : null;
    // El precio en la misma base que el importe (sin IVA): si el que vino es el de la
    // columna con IVA (cantidad × precio da el importe con IVA), se le saca.
    let precio = montoOk(x.precio_unitario) || null;
    if (iva && precio && Math.abs(cantidad * precio - impreso * (1 + iva / 100)) <= Math.max(1, impreso * 0.005)
      && Math.abs(cantidad * precio - impreso) > Math.max(1, impreso * 0.005)) precio = round2(precio / (1 + iva / 100));
    cantidad = cantidadQueCierra(cantidad, unidad, precio, impreso, desc);
    const importe = iva ? conIva(impreso, iva) : impreso;
    const descuento = iva ? conIva(desc, iva) : desc;
    renglones.push({
      foto: fotoOk(x.foto),
      texto: t,
      cantidad,
      unidad,
      precio_unitario: iva ? conIva(precio, iva) : precio,
      importe,
      descuento,
      iva,
      // Lo impreso, sin IVA: el control lo compara con el subtotal de una factura sin IVA.
      ...(iva ? { importe_sin_iva: impreso, descuento_sin_iva: desc } : {}),
      ean: texto(x.ean, 20) || null,
      marca: texto(x.marca, 60) || null,
      nombre: texto(x.nombre, 100) || t,
      medida_cantidad: typeof x.medida_cantidad === 'number' && x.medida_cantidad > 0 ? x.medida_cantidad : null,
      medida_unidad: ['g', 'kg', 'ml', 'l', 'u'].includes(x.medida_unidad) ? x.medida_unidad : null,
    });
  }
  const descartados = (Array.isArray(r?.descartados) ? r.descartados : [])
    .map((x) => ({ foto: fotoOk(x?.foto), texto: texto(x?.texto), importe: typeof x?.importe === 'number' ? round2(x.importe) : null, motivo: ['repetido', 'informativo', 'no_es_producto'].includes(x?.motivo) ? x.motivo : 'no_es_producto' }))
    .filter((x) => x.texto);
  const l = r?.lugar || {};
  return {
    lugar: { cadena: texto(l.cadena, 60), sucursal: texto(l.sucursal, 60), direccion: texto(l.direccion, 120), ciudad: ciudadLimpia(l.ciudad), punto_venta: pvLimpio(l.punto_venta), cuit: texto(l.cuit, 20) },
    fecha: fechaHasta(fechaOk(r?.fecha), hoy),
    total: montoOk(r?.total),
    subtotal: montoOk(r?.subtotal),
    ahorro: montoOk(r?.ahorro),
    recargos: montoOk(r?.recargos),
    iva_aparte: ivaAparte,
    columnas,
    renglones,
    descartados,
    avisos: (Array.isArray(r?.avisos) ? r.avisos : []).map((a) => texto(a, 200)).filter(Boolean).slice(0, 5),
  };
}

// ---------- La llamada ----------
// `client` es un `new Anthropic(...)`. Devuelve { lectura, usage, ms, modelo, esfuerzo }
// o tira un Error con `.motivo` ('rechazo' | 'cortado' | 'formato').
export async function leerTicket(client, fotos, { modelo = MODELO_DEFAULT, esfuerzo = ESFUERZO_DEFAULT, hoy = '' } = {}) {
  const params = {
    model: modelo,
    max_tokens: LECTOR_MAX_TOKENS,
    system: SISTEMA,
    messages: [{ role: 'user', content: contenido(fotos, { hoy }) }],
    output_config: { effort: esfuerzo, format: { type: 'json_schema', schema: RESPUESTA_SCHEMA } },
  };
  const t0 = Date.now();
  // Opus y Sonnet: si un clasificador de seguridad rechaza por error, la API reintenta
  // sola con otro modelo (server-side fallback). Haiku no lo tiene.
  // Streaming: con max_tokens alto el SDK no deja esperar la respuesta entera de una vez.
  const res = MODELOS[modelo]?.fallbacks
    ? await client.beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }).finalMessage()
    : await client.messages.stream(params).finalMessage();
  const ms = Date.now() - t0;
  const falla = (motivo, msg) => Object.assign(new Error(msg), { motivo, usage: res.usage, ms });
  if (res.stop_reason === 'refusal') throw falla('rechazo', 'El modelo no quiso leer la foto.');
  if (res.stop_reason === 'max_tokens') throw falla('cortado', 'El ticket es demasiado largo para leerlo de una vez.');
  const txt = (res.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  let data;
  try { data = JSON.parse(txt); } catch { throw falla('formato', 'La respuesta no vino en el formato esperado.'); }
  return { lectura: limpiarRespuesta(data, { nFotos: fotos.length, hoy }), usage: res.usage || {}, ms, modelo: res.model || modelo, esfuerzo };
}
