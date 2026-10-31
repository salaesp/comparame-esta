// Lógica pura del catálogo (sin I/O; la prueba test/productos.test.mjs): las claves
// que reconocen un lugar y un producto, la medida y el precio por kg, litro o unidad,
// y los candidatos para "¿Es el mismo?".

const sinAcentos = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const round2 = (n) => Math.round(n * 100) / 100;

// Clave de un texto: sin acentos, minúsculas, sólo letras y números, con el número
// separado de la unidad ("1kg" = "1 kg"). "UNIÓN yerba 1kg." y "Union  Yerba 1 KG" dan lo mismo.
export function normTexto(s) {
  return sinAcentos(s).toLowerCase()
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .slice(0, 160);
}

export const cadenaKey = (cadena) => normTexto(cadena);
const soloDigitos = (s) => String(s ?? '').replace(/\D/g, '');

// Las claves con que se reconoce una sucursal (tabla lugar_claves; un lugar puede tener
// varias). Adelante va quién es: el CUIT (dos cadenas pueden compartir nombre, no CUIT) o,
// sin CUIT, la cadena. Después, en orden de confianza: la dirección; el punto de venta (con
// el CUIT, AFIP lo ata a un domicilio, pero una sucursal tiene varios —uno por caja—: por
// eso se suman todos los que aparezcan); sin ninguno de los dos, la cadena entera (todas
// sus sucursales son una). La ciudad no entra: se lee a veces sí y a veces no.
export function lugarKeys({ cuit, cadena, direccion, punto_venta } = {}) {
  const c = soloDigitos(cuit);
  const quien = c.length === 11 ? `cuit ${c}` : cadenaKey(cadena);
  const dir = normTexto(direccion);
  const pv = pvLimpio(punto_venta);
  const keys = [];
  if (dir) keys.push(`${quien}|${dir}`);
  if (pv) keys.push(`${quien}|pv ${pv}`);
  if (!keys.length) keys.push(`${quien}|`);
  return keys;
}
// La principal (lugares.lugar_key, la de cuando se creó).
export const lugarKey = (l) => lugarKeys(l)[0];

// El punto de venta: sólo los dígitos, sin los ceros de adelante ("0101" → "101"). Hasta 5
// dígitos (los de AFIP); '' si no hay o si no es un número.
export function pvLimpio(pv) {
  const d = soloDigitos(pv).replace(/^0+/, '');
  return d && d.length <= 5 ? d : '';
}
// "PV 0101": como se lee en una factura.
export const pvLabel = (pv) => (pv ? `PV ${String(pv).padStart(4, '0')}` : '');

// La ciudad, con un nombre para cada una: "Capital Federal", "C.A.B.A." y "Ciudad Autónoma
// de Buenos Aires" son CABA, así el filtro por ciudad no las separa.
const CABA = new Set(['caba', 'c a b a', 'capital federal', 'cap fed', 'ciudad autonoma de buenos aires', 'ciudad de buenos aires', 'ciudad autonoma bs as', 'ciudad autonoma de bs as']);
export function ciudadLimpia(ciudad) {
  const t = tidyNombre(String(ciudad ?? '').replace(/\s+/g, ' ').trim().slice(0, 60));
  if (!t) return '';
  return CABA.has(normTexto(t)) ? 'CABA' : t;
}

// Un punto en Argentina (el de un local elegido en el buscador, lib/geo.mjs buscarLocales).
// AR_BBOX: [oeste, sur, este, norte].
export const AR_BBOX = [-73.6, -55.1, -53.6, -21.7];
export const puntoValido = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon)
  && lon >= AR_BBOX[0] && lon <= AR_BBOX[2] && lat >= AR_BBOX[1] && lat <= AR_BBOX[3];

export function cuitValido(cuit) {
  const c = soloDigitos(cuit);
  return c.length === 11 ? `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}` : '';
}

// La medida en la unidad que se guarda (g, ml, u). Acepta kg/l/cc del modelo o de quien
// edita: "1 kg" → { medida: 1000, unidad: 'g' }. null si no hay medida.
const UNIDADES = { g: ['g', 1], kg: ['g', 1000], ml: ['ml', 1], cc: ['ml', 1], l: ['ml', 1000], u: ['u', 1] };
export function medidaDe(cantidad, unidad) {
  const n = Number(cantidad);
  const u = UNIDADES[String(unidad ?? '').trim().toLowerCase()];
  if (!u || !(n > 0) || n > 1e6) return null;
  return { medida: round2(n * u[1]), unidad: u[0] };
}

// "500 g", "1 kg", "1,5 L", "4 u". '' sin medida.
const num = (n) => String(round2(n)).replace('.', ',');
export function medidaLabel(medida, unidad) {
  if (!(medida > 0)) return '';
  if (unidad === 'g') return medida >= 1000 ? `${num(medida / 1000)} kg` : `${num(medida)} g`;
  if (unidad === 'ml') return medida >= 1000 ? `${num(medida / 1000)} L` : `${num(medida)} ml`;
  if (unidad === 'u') return `${num(medida)} u`;
  return '';
}

// Clave de un producto para buscarlo: marca + nombre + medida.
export function nombreKey({ marca = '', nombre = '', medida = null, medida_unidad = '' } = {}) {
  return normTexto(`${marca} ${nombre} ${medidaLabel(medida, medida_unidad)}`);
}

// El precio para comparar entre tamaños: por kg (lo que va por peso o viene en gramos),
// por litro o por unidad de la medida (un pack de 4 rollos: el rollo). null si no se sabe.
export function precioMedida({ precio_unit, unidad, medida, medida_unidad }) {
  if (!(precio_unit > 0)) return null;
  if (unidad === 'kg') return round2(precio_unit);
  if (!(medida > 0)) return null;
  if (medida_unidad === 'g' || medida_unidad === 'ml') return round2(precio_unit / (medida / 1000));
  if (medida_unidad === 'u') return round2(precio_unit / medida);
  return null;
}
// Por qué es ese precio: "el kg", "el litro", "la unidad".
export function porQue({ unidad, medida_unidad }) {
  if (unidad === 'kg' || medida_unidad === 'g') return 'kg';
  if (medida_unidad === 'ml') return 'litro';
  if (medida_unidad === 'u') return 'unidad';
  return '';
}

// Palabras que no ayudan a reconocer un producto.
const VACIAS = new Set(['x', 'de', 'del', 'la', 'el', 'en', 'con', 'sin', 'y', 'para', 'un', 'u', 'g', 'gr', 'kg', 'ml', 'l', 'lt', 'cc']);
const palabras = (key) => new Set(key.split(' ').filter((w) => w.length > 1 && !VACIAS.has(w) && !/^\d+$/.test(w)));

// Candidatos para "¿Es el mismo?": los productos que comparten más palabras con el
// renglón (Jaccard sobre marca + nombre) y, si los dos dicen su medida, con la MISMA
// medida (una Playadito de 500 g no es la de 1 kg) y la misma marca. Nunca se junta solo: esto sólo
// sugiere. Devuelve hasta `max` { producto, score } de más a menos parecido.
export function candidatos(renglon, productos, { max = 3, min = 0.5 } = {}) {
  const a = palabras(normTexto(`${renglon.marca || ''} ${renglon.nombre || ''}`));
  if (!a.size) return [];
  const out = [];
  for (const p of productos) {
    if (renglon.medida > 0 && p.medida > 0 && (renglon.medida !== p.medida || renglon.medida_unidad !== p.medida_unidad)) continue;
    // Las dos con marca y distinta: otro producto (una Taragüí no es una Playadito).
    if (renglon.marca && p.marca && normTexto(renglon.marca) !== normTexto(p.marca)) continue;
    const b = palabras(normTexto(`${p.marca || ''} ${p.nombre || ''}`));
    let inter = 0;
    for (const w of a) if (b.has(w)) inter++;
    const score = inter / (a.size + b.size - inter);
    if (score >= min) out.push({ producto: p, score: round2(score) });
  }
  return out.sort((x, y) => y.score - x.score).slice(0, max);
}

// El nombre como se muestra: lo que viene en MAYÚSCULAS del ticket pasa a nombre propio.
export function tidyNombre(s) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!t || t !== t.toUpperCase()) return t;
  return t.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, sp, c) => sp + c.toUpperCase());
}

// El EAN que vale: 8, 12, 13 o 14 dígitos con el dígito verificador bien. Los que empiezan
// con 2 son de uso interno del local (GS1 20–29: una pieza pesada lleva su peso o su precio
// en el código, como el reggianito de Carrefour, 2506434003054): cambian con cada pieza y no
// identifican el producto, así que no valen.
export function eanValido(s) {
  const d = soloDigitos(s);
  if (![8, 12, 13, 14].includes(d.length) || d[0] === '2') return '';
  const nums = [...d].map(Number);
  const check = nums.pop();
  const sum = nums.reverse().reduce((acc, n, i) => acc + n * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check ? d : '';
}
