// Lógica pura de un ticket (sin I/O; la prueba test/ticket.test.mjs): lo que se pagó
// por cada renglón, el control contra el total del ticket, los renglones que no cierran
// y la validación de lo que se guarda.
import { medidaDe, precioMedida, eanValido, tidyNombre } from './productos.mjs';

const round2 = (n) => Math.round(n * 100) / 100;

// Lo que se pagó por un renglón: lo impreso menos sus descuentos.
export const pagadoDe = ({ importe, descuento = 0 }) => round2(importe - (descuento || 0));
// Por unidad o por kg.
export const precioUnitDe = (r) => (r.cantidad > 0 ? round2(pagadoDe(r) / r.cantidad) : null);

// Un renglón no cierra si lo impreso es MÁS que cantidad × precio (un descuento sólo
// puede bajarlo): el modelo tomó otra columna o leyó mal la cantidad. Se marca.
export function noCierra({ cantidad, precio_unitario, importe }) {
  return precio_unitario > 0 && cantidad > 0 && importe > cantidad * precio_unitario * 1.005 + 0.05;
}

// Si el importe es justo n veces el precio (n ≥ 2), lo mal leído es la cantidad: se
// ofrece "Son n" con un toque. null si no es eso.
export function cantidadSugerida({ cantidad, precio_unitario, importe }) {
  if (!(precio_unitario > 0 && importe > 0)) return null;
  const n = Math.round(importe / precio_unitario);
  return n >= 2 && n <= 100 && n !== cantidad && Math.abs(importe - n * precio_unitario) <= importe * 0.002 + 0.05 ? n : null;
}

// ¿Da la suma? Contra el total; sin total, contra subtotal − ahorro; con sólo el
// subtotal, la suma de lo impreso (antes de los descuentos). Una diferencia de hasta
// $1 o el 0,1% es redondeo.
// { estado: 'ok' | 'no_da' | 'sin_total', contra, esperado, suma, diferencia }
export function controlTotal({ renglones = [], total = null, subtotal = null, ahorro = null }) {
  const pagado = round2(renglones.reduce((s, r) => s + pagadoDe(r), 0));
  const impreso = round2(renglones.reduce((s, r) => s + r.importe, 0));
  let contra = null, esperado = null, suma = pagado;
  if (total > 0) { contra = 'total'; esperado = total; }
  else if (subtotal > 0 && ahorro > 0) { contra = 'subtotal_ahorro'; esperado = round2(subtotal - ahorro); }
  else if (subtotal > 0) { contra = 'subtotal'; esperado = subtotal; suma = impreso; }
  if (contra == null) return { estado: 'sin_total', contra, esperado, suma: pagado, diferencia: null };
  const diferencia = round2(suma - esperado);
  // Hay tickets cuyo TOTAL ya trae los descuentos y otros no: si contra el total no da
  // pero lo impreso sí, también vale.
  const tol = Math.max(1, esperado * 0.001);
  if (Math.abs(diferencia) <= tol) return { estado: 'ok', contra, esperado, suma, diferencia };
  if (contra === 'total' && Math.abs(impreso - esperado) <= tol) return { estado: 'ok', contra, esperado, suma: impreso, diferencia: round2(impreso - esperado) };
  return { estado: 'no_da', contra, esperado, suma, diferencia };
}

// ---------- Guardar ----------
export const RENGLONES_MAX = 300;
const montoOk = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e9);
const texto = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

// Lo que manda la revisión. Devuelve { error } o { ticket, renglones } limpios. Cada
// renglón trae `producto_id` (uno que ya existe) o `nuevo` ({ nombre, marca, medida,
// medida_unidad, ean }), que el server crea.
export function validarTicket(body) {
  const b = body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.fecha || '') || Number.isNaN(Date.parse(b.fecha))) return { error: 'Falta la fecha del ticket.' };
  const lugar = b.lugar || {};
  if (!lugar.id && !texto(lugar.cadena, 60)) return { error: 'Falta el lugar del ticket.' };
  if (!Array.isArray(b.renglones) || !b.renglones.length) return { error: 'El ticket no tiene productos.' };
  if (b.renglones.length > RENGLONES_MAX) return { error: `Son ${RENGLONES_MAX} productos como mucho.` };
  const renglones = [];
  for (const [i, r] of b.renglones.entries()) {
    const t = texto(r?.texto, 160);
    if (!t) return { error: `Al producto ${i + 1} le falta el nombre.` };
    if (!(typeof r.cantidad === 'number' && r.cantidad > 0 && r.cantidad <= 1000)) return { error: `«${t}»: la cantidad no es válida.` };
    if (!montoOk(r.importe) || !(r.importe > 0)) return { error: `«${t}»: el importe no es válido.` };
    const descuento = montoOk(r.descuento) ? Math.min(r.descuento, r.importe) : 0;
    let nuevo = null;
    if (!r.producto_id) {
      const n = r.nuevo || {};
      const nombre = tidyNombre(texto(n.nombre, 100) || t);
      const m = medidaDe(n.medida, n.medida_unidad);
      nuevo = { nombre, marca: tidyNombre(texto(n.marca, 60)), medida: m?.medida ?? null, medida_unidad: m?.unidad ?? '', ean: eanValido(n.ean) };
    }
    renglones.push({
      orden: i,
      texto: t,
      cantidad: Math.round(r.cantidad * 1000) / 1000,
      unidad: r.unidad === 'kg' ? 'kg' : 'u',
      precio_lista: montoOk(r.precio_unitario) && r.precio_unitario > 0 ? round2(r.precio_unitario) : null,
      importe: round2(r.importe),
      descuento: round2(descuento),
      producto_id: typeof r.producto_id === 'string' ? r.producto_id : null,
      nuevo,
    });
  }
  return {
    ticket: {
      fecha: b.fecha,
      total: montoOk(b.total) && b.total > 0 ? round2(b.total) : null,
      n_fotos: Number.isInteger(b.n_fotos) && b.n_fotos > 0 ? Math.min(b.n_fotos, 20) : 1,
      modelo: texto(b.modelo, 40),
      lugar: lugar.id ? { id: String(lugar.id) } : {
        cadena: texto(lugar.cadena, 60), sucursal: texto(lugar.sucursal, 60), direccion: texto(lugar.direccion, 120), cuit: texto(lugar.cuit, 20),
      },
    },
    renglones,
  };
}

// Los números que se guardan de un renglón, con el producto ya resuelto.
export function preciosDe(r, producto) {
  const pagado = pagadoDe(r);
  // Si el precio impreso cierra con lo impreso, manda él (14162,68 / 0,305 kg da 46435,02;
  // el ticket dice 46435), con el descuento repartido; si no, la cuenta.
  const cierra = r.precio_lista > 0 && Math.abs(r.cantidad * r.precio_lista - r.importe) <= Math.max(0.05, r.importe * 0.001);
  const precio_unit = round2(cierra ? r.precio_lista * (pagado / r.importe) : pagado / r.cantidad);
  return {
    pagado,
    precio_unit,
    precio_medida: precioMedida({ precio_unit, unidad: r.unidad, medida: producto?.medida, medida_unidad: producto?.medida_unidad }),
  };
}
