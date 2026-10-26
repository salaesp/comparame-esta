// Comparame esta: la app (sin framework ni build). Arranca con boot(): /api/boot trae
// quién sos, tus amigos y lo que ven entre todos de los últimos meses; las pantallas se
// arman en memoria con eso. El sistema visual es el "Suave" de Gastienzos
// (styles.css = su capa genérica; app.css = los componentes propios de esta app).
//
// Las pantallas: Inicio (lo último y lo que cambió), Productos (buscar y ver dónde está
// más barato), Lugares y Ajustes. El "+" carga un ticket: fotos → Claude las lee →
// revisión → guardar.

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const VERSION = new URL(import.meta.url).searchParams.get('v') || '';

// ---------- Formatos ----------
function fmtMoney(n, { sign = false } = {}) {
  if (n == null || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const dec = Math.abs(abs - Math.round(abs)) >= 0.005;
  const s = abs.toLocaleString('es-AR', dec ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 0 });
  const pre = n < 0 ? '−' : sign && n > 0 ? '+' : '';
  return `${pre}$${s}`;
}
// "6 × $4.999" o "0,305 kg a $46.435".
function cantLabel(cant, unidad, precio) {
  if (unidad === 'kg') return `${fmtNum(cant)} kg${precio ? ` a ${fmtMoney(precio)}` : ''}`;
  return `${fmtNum(cant)}${precio ? ` × ${fmtMoney(precio)}` : ' u'}`;
}
const fmtNum = (n) => (n == null ? '' : Number(n).toLocaleString('es-AR', { maximumFractionDigits: 3 }));
// "YYYY-MM-DD" del día de HOY en la zona del teléfono (nunca toISOString: da el día en UTC).
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const hoyIso = () => isoDate(new Date());
const diasDesde = (iso) => Math.round((Date.parse(hoyIso()) - Date.parse(iso)) / 864e5);
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function fmtFecha(iso) {
  if (!iso) return '';
  const d = diasDesde(iso);
  if (d === 0) return 'hoy';
  if (d === 1) return 'ayer';
  if (d > 1 && d < 7) return `hace ${d} días`;
  const [y, m, dd] = iso.split('-').map(Number);
  return `${dd} ${MESES[m - 1]}${y !== new Date().getFullYear() ? ` ${y}` : ''}`;
}
// "25 oct 2026": la fecha entera, sin "ayer" (donde se comparan fechas, "ayer" al lado de
// "25 oct 2025" confundía: era el mismo día de otro año).
function fmtFechaLarga(iso) {
  if (!iso) return '';
  const [y, m, dd] = iso.split('-').map(Number);
  return `${dd} ${MESES[m - 1]} ${y}`;
}
// La medida como se lee: "500 g", "1 kg", "1,5 L", "4 u" (misma cuenta que lib/productos.mjs).
function medidaLabel(medida, unidad) {
  if (!(medida > 0)) return '';
  const n = (v) => String(Math.round(v * 100) / 100).replace('.', ',');
  if (unidad === 'g') return medida >= 1000 ? `${n(medida / 1000)} kg` : `${n(medida)} g`;
  if (unidad === 'ml') return medida >= 1000 ? `${n(medida / 1000)} L` : `${n(medida)} ml`;
  if (unidad === 'u') return `${n(medida)} u`;
  return '';
}

// Colores del usuario con el tono de cada tema (como en Gastienzos: nunca el hex directo).
const inkOf = (c) => `oklch(from ${c} var(--tone-ink) c h)`;
const fillOf = (c) => `oklch(from ${c} var(--tone-fill) c h)`;
const PERSON_COLORS = ['#5E51B5', '#2E8B7A', '#C2185B', '#E07A2E', '#3D7DD8', '#8A6D3B', '#6D9E1F', '#B5523B'];
function personColor(id) {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PERSON_COLORS[h % PERSON_COLORS.length];
}
const inicial = (name) => (String(name || '?').trim()[0] || '?').toUpperCase();

// ---------- Íconos (línea, 24×24) ----------
const IC = {
  home: '<path d="M4 11l8-7 8 7"/><path d="M6 10v10h12V10"/>',
  homeFill: '<path d="M12 3.5l8.5 7.4V21h-6v-6h-5v6h-6V10.9z" fill="currentColor" stroke="none"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/>',
  tagFill: '<path d="M2 3h9.4L22 13.6 13.6 22 2 10.4zM7.5 6.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" fill="currentColor" stroke="none"/>',
  store: '<path d="M4 9l1.5-5h13L20 9"/><path d="M4 9h16v2a3 3 0 0 1-5.3 2 3 3 0 0 1-5.4 0A3 3 0 0 1 4 11z"/><path d="M5.5 14v6h13v-6"/>',
  storeFill: '<path d="M5 3.5h14l2 5.5v2a3.4 3.4 0 0 1-5.6 2.6 3.4 3.4 0 0 1-6.8 0A3.4 3.4 0 0 1 3 11V9zM5 15.2a4.8 4.8 0 0 0 2.4.3 4.8 4.8 0 0 0 2.3-.9 4.8 4.8 0 0 0 4.6 0 4.8 4.8 0 0 0 4.7.6V21H5z" fill="currentColor" stroke="none"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  gallery: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M20.5 16l-5-5-8 8.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  receipt: '<path d="M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4L6 21z"/><path d="M9 8h6M9 12h6"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  edit: '<path d="M4 20h4l10-10-4-4L4 16v4z"/><path d="M13 7l4 4"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  friend: '<circle cx="10" cy="8" r="3.5"/><path d="M3.5 20a6.5 6.5 0 0 1 13 0"/><path d="M19 8v6M16 11h6"/>',
  logout: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M10 16l-4-4 4-4"/><path d="M6 12h10"/>',
  warn: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><path d="M12 16h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.8h.01"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  map: '<path d="M9 4L3.5 6v14L9 18l6 2 5.5-2V4L15 6z"/><path d="M9 4v14M15 6v14"/>',
  mapFill: '<path d="M8.2 3.3v15.4l-5.5 2.1V5.4zM9.8 3.3l4.4 1.5v15.4l-4.4-1.5zM15.8 4.7l5.5-1.9v15.4l-5.5 1.9z" fill="currentColor" stroke="none"/>',
  loc: '<circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="2.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>',
  pin: '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  out: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  google: '',
};
function ic(name, size = 24) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[name] || ''}</svg>`;
}
const GOOGLE_G = '<svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.5z"/></svg>';
function hydrateIcons(root = document) {
  root.querySelectorAll('[data-ic]').forEach((el) => { el.outerHTML = ic(el.dataset.ic); });
}

// ---------- API ----------
const NET_ERR_MSG = 'No hay conexión. Probá de nuevo en un rato.';
async function apiFetch(path, { method = 'GET', body, signal } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method, signal, credentials: 'same-origin',
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    throw Object.assign(new Error(NET_ERR_MSG), { net: true });
  }
  let data = null;
  try { data = await res.json(); } catch { /* sin cuerpo */ }
  if (res.status === 401) { showLogin(); throw Object.assign(new Error('no autenticado'), { status: 401 }); }
  if (!res.ok) throw Object.assign(new Error(data?.error || `Algo falló (${res.status}).`), { status: res.status, data });
  return data;
}

// ---------- Estado ----------
const state = {
  user: null, amigos: [], users: new Map(), links: 0, desde: '', lector: false,
  tickets: [], precios: [], productos: new Map(), lugares: new Map(),
  view: 'inicio', q: '', ciudad: '',
};
const FRESCO_DIAS = 30; // un precio más viejo no compara (la inflación): se ve gris

function setData(d) {
  state.user = d.user;
  state.amigos = d.amigos || [];
  state.users = new Map([[d.user.id, d.user], ...state.amigos.map((a) => [a.id, a])]);
  state.links = d.links || 0;
  state.desde = d.desde;
  state.lector = !!d.lector;
  state.tickets = d.tickets || [];
  state.precios = d.precios || [];
  state.productos = new Map((d.productos || []).map((p) => [p.id, p]));
  state.lugares = new Map((d.lugares || []).map((l) => [l.id, l]));
}

const quien = (uid) => (uid === state.user?.id ? 'Vos' : state.users.get(uid)?.name?.split(' ')[0] || 'Alguien');
function lugarNombre(l) {
  if (!l) return 'Sin lugar';
  return [l.cadena || 'Sin nombre', l.sucursal].filter(Boolean).join(' · ');
}
const lugarDe = (id) => state.lugares.get(id);
// "PV 0101": el punto de venta como se lee en una factura (lib/productos.mjs pvLabel).
const pvLabel = (pv) => (pv ? `PV\u00a0${String(pv).padStart(4, '0')}` : '');
// Dónde queda: la dirección y la ciudad; sin dirección, el punto de venta que la distingue.
function lugarDonde(l) {
  if (!l) return '';
  return [l.direccion || pvLabel(l.punto_venta), l.ciudad].filter(Boolean).join(', ');
}

// ---------- La ciudad ----------
// Con lugares de más de una ciudad, Productos y Lugares se filtran por una (la del
// teléfono: localStorage['cmp:ciudad']). Los lugares sin ciudad sólo se ven en "Todas".
const CIUDAD_KEY = 'cmp:ciudad';
function ciudadGuardada() { try { return localStorage.getItem(CIUDAD_KEY) || ''; } catch { return ''; } }
function setCiudad(c) {
  state.ciudad = c;
  try { if (c) localStorage.setItem(CIUDAD_KEY, c); else localStorage.removeItem(CIUDAD_KEY); } catch { /* sin storage */ }
}
// Las ciudades de los lugares que se ven, de la que más tickets tiene a la que menos.
function ciudades() {
  const n = new Map();
  for (const t of state.tickets) {
    const c = lugarDe(t.lugar_id)?.ciudad;
    if (c) n.set(c, (n.get(c) || 0) + 1);
  }
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([c]) => c);
}
// La ciudad elegida, si sigue habiendo más de una (si no, no se filtra).
function ciudadActiva() {
  const cs = ciudades();
  return cs.length > 1 && cs.includes(state.ciudad) ? state.ciudad : '';
}
const enCiudad = (lugarId, ciudad = ciudadActiva()) => !ciudad || lugarDe(lugarId)?.ciudad === ciudad;
function ciudadesHtml() {
  const cs = ciudades();
  if (cs.length < 2) return '';
  const act = ciudadActiva();
  const b = (c, label) => `<button type="button" class="ciudad${act === c ? ' active' : ''}" data-ciudad="${esc(c)}" aria-pressed="${act === c}">${esc(label)}</button>`;
  return `<div class="ciudades" role="group" aria-label="Ciudad">${b('', 'Todas')}${cs.map((c) => b(c, c)).join('')}</div>`;
}
function productoNombre(p) {
  if (!p) return '';
  return [p.marca, p.nombre].filter(Boolean).join(' ') || p.nombre;
}
const productoSub = (p) => medidaLabel(p?.medida, p?.medida_unidad);
// El precio para comparar entre lugares y tamaños: por kg, litro o unidad de la medida si
// se sabe; si no, lo pagado por unidad.
const comparable = (pr) => pr.precio_medida ?? pr.precio_unit;
function porQue(pr, p) {
  if (pr.unidad === 'kg' || (pr.precio_medida != null && p?.medida_unidad === 'g')) return 'el kg';
  if (pr.precio_medida != null && p?.medida_unidad === 'ml') return 'el litro';
  if (pr.precio_medida != null && p?.medida_unidad === 'u') return 'la unidad';
  return 'c/u';
}

// Lo último de cada producto en cada lugar: [{ lugar_id, precio (el renglón), fresco }],
// del más barato al más caro (los frescos primero).
function porLugar(precios) {
  const last = new Map();
  for (const pr of precios) {
    const k = pr.lugar_id || '-';
    const cur = last.get(k);
    if (!cur || pr.fecha > cur.fecha || (pr.fecha === cur.fecha && pr.id > cur.id)) last.set(k, pr);
  }
  return [...last.values()]
    .map((pr) => ({ lugar_id: pr.lugar_id, precio: pr, fresco: diasDesde(pr.fecha) <= FRESCO_DIAS }))
    .sort((a, b) => (b.fresco - a.fresco) || (comparable(a.precio) - comparable(b.precio)));
}
const preciosDe = (pid) => state.precios.filter((pr) => pr.producto_id === pid);

// Cada producto con lo que se sabe: el más barato fresco, en cuántos lugares, lo último.
function resumenProductos(ciudad = '') {
  const by = new Map();
  for (const pr of state.precios) {
    if (!pr.producto_id || !enCiudad(pr.lugar_id, ciudad)) continue;
    if (!by.has(pr.producto_id)) by.set(pr.producto_id, []);
    by.get(pr.producto_id).push(pr);
  }
  return [...by.entries()].map(([pid, prs]) => {
    const lugares = porLugar(prs);
    const ultimo = prs.reduce((a, b) => (b.fecha > a.fecha ? b : a));
    return { producto: state.productos.get(pid), lugares, mejor: lugares.find((l) => l.fresco) || null, ultimo };
  }).filter((r) => r.producto);
}

// Lo que cambió: el último precio de un producto en un lugar contra el anterior en el
// mismo lugar (los dos de los últimos FRESCO_DIAS), si se movió 5% o más.
function cambios() {
  const by = new Map();
  for (const pr of state.precios) {
    if (!pr.producto_id || !pr.lugar_id) continue;
    const k = `${pr.producto_id}|${pr.lugar_id}`;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(pr);
  }
  const out = [];
  for (const prs of by.values()) {
    if (prs.length < 2) continue;
    prs.sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));
    const [a, b] = prs;
    if (diasDesde(a.fecha) > FRESCO_DIAS || a.fecha === b.fecha) continue;
    const pct = (comparable(a) - comparable(b)) / comparable(b);
    if (Math.abs(pct) >= 0.05) out.push({ ultimo: a, antes: b, pct });
  }
  return out.sort((x, y) => (y.ultimo.fecha > x.ultimo.fecha ? 1 : -1) || Math.abs(y.pct) - Math.abs(x.pct));
}

// ---------- Capas (modal, hojas, diálogos) y el gesto atrás ----------
// Cada capa que se abre apila una entrada en el historial: "atrás" cierra la de arriba
// y no sale de la app. Cerrar con la ✕ hace history.back() y el popstate la cierra.
const layers = [];
let focusTraps = [];
function pushLayer(close) {
  layers.push(close);
  history.pushState({ capa: layers.length }, '');
}
function closeLayer() {
  if (layers.length) history.back();
}
window.addEventListener('popstate', () => {
  const close = layers.pop();
  if (close) close();
});
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
function syncInert() {
  const top = focusTraps[focusTraps.length - 1];
  for (const id of ['shell', 'tabbar', 'fab']) { const el = $(id); if (el) el.inert = !!top; }
  document.documentElement.classList.toggle('pop-open', !!top);
}
function trapFocus(panel) {
  focusTraps.push({ panel, prev: document.activeElement });
  if (!panel.hasAttribute('tabindex')) panel.setAttribute('tabindex', '-1');
  syncInert();
  try { panel.focus({ preventScroll: true }); } catch { /* sin foco */ }
}
function untrapFocus(panel) {
  const i = focusTraps.findIndex((t) => t.panel === panel);
  if (i < 0) return;
  const [t] = focusTraps.splice(i, 1);
  syncInert();
  try { t.prev?.focus?.({ preventScroll: true }); } catch { /* nada */ }
}
document.addEventListener('keydown', (e) => {
  const top = focusTraps[focusTraps.length - 1];
  if (!top) return;
  if (e.key === 'Escape' && layers.length && !document.querySelector('.cdlg')) { e.preventDefault(); closeLayer(); return; }
  if (e.key !== 'Tab') return;
  const els = [...top.panel.querySelectorAll(FOCUSABLE)].filter((el) => el.getClientRects().length);
  if (!els.length) { e.preventDefault(); return; }
  const first = els[0], last = els[els.length - 1], a = document.activeElement;
  if (!top.panel.contains(a)) { e.preventDefault(); first.focus(); }
  else if (e.shiftKey && a === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
});

// El modal: una pantalla encima (en el celular, una hoja a lo alto). `render` pinta el
// panel; se puede volver a llamar (repaint) sin apilar otra capa.
let modalState = null;
function openModal({ render, full = false, onClose = null }) {
  const modal = $('modal'), panel = $('modal-panel');
  const was = !!modalState;
  modalState = { render, onClose };
  modal.classList.toggle('modal--full', full);
  panel.innerHTML = render();
  hydrateIcons(panel);
  panel.scrollTop = 0;
  modal.hidden = false;
  if (!was) {
    trapFocus(panel);
    pushLayer(() => hideModal());
  }
  return panel;
}
function repaintModal() {
  if (!modalState) return;
  const panel = $('modal-panel');
  const top = panel.scrollTop;
  panel.innerHTML = modalState.render();
  hydrateIcons(panel);
  panel.scrollTop = top;
}
function hideModal() {
  if (!modalState) return;
  const { onClose } = modalState;
  modalState = null;
  $('modal').hidden = true;
  $('modal-panel').innerHTML = '';
  untrapFocus($('modal-panel'));
  onClose?.();
}
$('modal').addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) closeLayer();
});
function modalHead(title, sub = '') {
  return `<div class="modal__head modal__head--x">
    <button type="button" class="sheet__grab" data-close aria-label="Cerrar"></button>
    ${sub ? `<div class="modal__ttl"><h2 id="modal-title">${esc(title)}</h2><span class="modal__sub">${esc(sub)}</span></div>` : `<h2 id="modal-title">${esc(title)}</h2>`}
    <button type="button" class="modal__x" data-close aria-label="Cerrar">✕</button>
  </div>`;
}

// Una hoja de abajo sobre lo que haya (shell .catpick). Devuelve { el, close }.
function openSheet({ title, body, foot = '', onMount = null, onClose = null }) {
  const el = document.createElement('div');
  el.className = 'catpick mvsheet';
  el.innerHTML = `<div class="catpick__scrim" data-sheet-close></div>
    <div class="catpick__sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <button type="button" class="sheet__grab" data-sheet-close aria-label="Cerrar"></button>
      <div class="catpick__head"><span class="lbl">${esc(title)}</span><button type="button" class="modal__x" data-sheet-close aria-label="Cerrar">✕</button></div>
      <div class="mvsheet__body">${body}</div>
      ${foot ? `<div class="mvsheet__foot">${foot}</div>` : ''}
    </div>`;
  document.body.appendChild(el);
  hydrateIcons(el);
  requestAnimationFrame(() => el.classList.add('catpick--in'));
  const sheet = el.querySelector('.catpick__sheet');
  trapFocus(sheet);
  let open = true;
  const remove = () => {
    if (!open) return;
    open = false;
    el.remove();
    untrapFocus(sheet);
    onClose?.();
  };
  pushLayer(remove);
  el.addEventListener('click', (e) => { if (e.target.closest('[data-sheet-close]')) closeLayer(); });
  onMount?.(el);
  return { el, close: () => { if (open) closeLayer(); } };
}

// ---------- Toast y diálogos (los de Gastienzos) ----------
const TOAST_ICONS = { ok: ic('check', 20), error: ic('warn', 20), spin: '<span class="mvf__spin" aria-hidden="true"></span>', x: ic('x', 18) };
function toast(msg, { action = '', onAction = null, duration = 0, lead = '', icon = '', close = false } = {}) {
  let el = $('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; document.body.appendChild(el); }
  msg = String(msg ?? '');
  if (!icon && /^✓\s*/.test(msg)) { icon = 'ok'; msg = msg.replace(/^✓\s*/, ''); }
  el.setAttribute('role', icon === 'error' ? 'alert' : 'status');
  el.setAttribute('aria-live', icon === 'error' ? 'assertive' : 'polite');
  el.innerHTML = `${icon ? `<span class="toast__ic toast__ic--${icon}">${TOAST_ICONS[icon]}</span>` : ''}<span class="toast__msg">${lead ? `<span class="toast__lead">${esc(lead)}</span> ` : ''}<span class="toast__txt">${esc(msg)}</span></span>`
    + (action ? `<button type="button" class="toast__act">${esc(action)}</button>` : '')
    + (close ? `<button type="button" class="toast__x" aria-label="Cerrar aviso">${TOAST_ICONS.x}</button>` : '');
  el.classList.toggle('toast--tail', !!(action || close));
  const token = (toast._n = (toast._n || 0) + 1);
  const hide = () => { if (toast._n !== token) return; clearTimeout(toast._t); el.classList.remove('toast--show'); };
  el.querySelector('.toast__act')?.addEventListener('click', () => { hide(); onAction?.(); });
  el.querySelector('.toast__x')?.addEventListener('click', hide);
  el.classList.add('toast--show');
  clearTimeout(toast._t);
  const ms = duration || (icon === 'error' ? 8000 : action || close ? 5000 : 3000);
  if (Number.isFinite(ms)) toast._t = setTimeout(hide, ms);
  return { hide };
}
const DLG_ICONS = { trash: ic('trash'), warn: ic('warn'), friend: ic('friend'), edit: ic('edit'), logout: ic('logout'), info: ic('info') };
function openDialog({ title, text = '', ok = 'Aceptar', cancel = 'Cancelar', danger = false, icon = '' }) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'upd-dialog cdlg';
    el.innerHTML = `<div class="upd-dialog__scrim" data-cdlg-cancel></div>
      <section class="upd-dialog__panel cdlg__panel" role="alertdialog" aria-modal="true" aria-labelledby="cdlg-title"${text ? ' aria-describedby="cdlg-text"' : ''}>
        <span class="cdlg__ico${danger ? ' cdlg__ico--danger' : ''}" aria-hidden="true">${DLG_ICONS[icon] || DLG_ICONS[danger ? 'trash' : 'warn']}</span>
        <h2 class="cdlg__title" id="cdlg-title">${esc(title)}</h2>
        ${text ? `<p class="cdlg__text" id="cdlg-text">${esc(text)}</p>` : ''}
        <div class="cdlg__acts">
          ${cancel ? `<button type="button" class="cdlg__btn cdlg__btn--cancel" data-cdlg-cancel>${esc(cancel)}</button>` : ''}
          <button type="button" class="cdlg__btn cdlg__btn--ok${danger ? ' cdlg__btn--danger' : ''}" data-cdlg-ok>${esc(ok)}</button>
        </div>
      </section>`;
    const panel = el.querySelector('.cdlg__panel');
    const done = (v) => {
      document.removeEventListener('keydown', onKey, true);
      el.remove();
      untrapFocus(panel);
      resolve(v);
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); done(false); } };
    document.addEventListener('keydown', onKey, true);
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-cdlg-cancel]')) done(false);
      else if (e.target.closest('[data-cdlg-ok]')) done(true);
    });
    document.body.appendChild(el);
    trapFocus(panel);
    el.querySelector('[data-cdlg-ok]').focus();
  });
}
const askConfirm = (title, opts = {}) => openDialog({ title, ...opts });
const showError = (title, text = '') => openDialog({ title, text, ok: 'Entendido', cancel: '' });

// ---------- Login ----------
const LOGIN_ERRORS = {
  lleno: 'Por ahora la app está llena. Te anotamos en la lista de espera: cuando haya lugar, vas a poder entrar con este mismo email.',
  state: 'El login expiró. Probá de nuevo.',
  token: 'No se pudo completar el login con Google.',
  idtoken: 'No se pudo completar el login con Google.',
  verify: 'No se pudo verificar tu identidad. Probá de nuevo.',
  email: 'Tu cuenta de Google no tiene un email verificado.',
  access_denied: 'Cancelaste el acceso.',
};
function showLogin() {
  const params = new URLSearchParams(location.search);
  const err = params.get('login_error');
  const amigo = params.get('amigo');
  const next = amigo ? `/?amigo=${encodeURIComponent(amigo)}` : '';
  const msg = err ? { text: LOGIN_ERRORS[err] || 'No se pudo entrar. Probá de nuevo.', error: true }
    : amigo ? { text: 'Te invitaron a compartir precios. Entrá con Google para aceptar.' }
    : { text: 'Sacale fotos a tus tickets y mirá dónde está más barato cada cosa, con tus amigos.' };
  if (err) history.replaceState(null, '', amigo ? next : '/');
  $('shell').hidden = true;
  for (const id of ['tabbar', 'tabguard', 'fab']) $(id).hidden = true;
  const gate = $('login-gate');
  gate.hidden = false;
  gate.innerHTML = `<div class="login-card">
    <span class="login-card__logo" aria-hidden="true"></span>
    <h1 class="login-card__title">Comparame esta</h1>
    <p class="login-card__msg${msg.error ? ' login-card__msg--error' : ''}"${msg.error ? ' role="alert"' : ''}>${esc(msg.text)}</p>
    <a class="login-card__btn" href="/api/auth/login${next ? `?next=${encodeURIComponent(next)}` : ''}">${GOOGLE_G}Entrar con Google</a>
  </div>`;
}

// ---------- Navegación ----------
const VIEWS = [
  { id: 'inicio', label: 'Inicio', ic: 'home', icFill: 'homeFill' },
  { id: 'productos', label: 'Productos', ic: 'tag', icFill: 'tagFill' },
  { id: 'lugares', label: 'Lugares', ic: 'store', icFill: 'storeFill' },
  { id: 'mapa', label: 'Mapa', ic: 'map', icFill: 'mapFill' },
];
const TITLES = { inicio: 'Comparame esta', productos: 'Productos', lugares: 'Lugares', mapa: 'Mapa', ajustes: 'Ajustes' };
function navHtml() {
  const svgPair = (v) => `<svg class="ic--line" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[v.ic]}</svg><svg class="ic--fill" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">${IC[v.icFill]}</svg>`;
  $('tabbar').innerHTML = '<span class="tabbar__pill tabbar__pill--off" id="tabpill"></span>'
    + VIEWS.map((v) => `<button type="button" class="tabbar__tab" data-goto="${v.id}" aria-label="${v.label}">${svgPair(v)}<span aria-hidden="true">${v.label}</span></button>`).join('');
  $('rail-nav').innerHTML = VIEWS.map((v) => `<button type="button" class="rail__btn" data-goto="${v.id}">${svgPair(v)}<span class="rail__lbl">${v.label}</span></button>`).join('');
}
function avatarInner(u) {
  return u?.picture
    ? `<img class="avatar-btn__img" src="${esc(u.picture)}" alt="" referrerpolicy="no-referrer">`
    : `<span class="avatar-btn__fallback">${esc(inicial(u?.name || u?.email))}</span>`;
}
function showView(view, { scroll = true } = {}) {
  state.view = view;
  for (const id of ['inicio', 'productos', 'lugares', 'mapa', 'ajustes']) $(`view-${id}`).hidden = id !== view;
  document.querySelectorAll('[data-goto]').forEach((b) => {
    const on = b.dataset.goto === view;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  $('mhead-title').textContent = TITLES[view];
  $('topbar-title').textContent = view === 'inicio' ? 'Inicio' : TITLES[view];
  render();
  syncTabPill();
  if (scroll) window.scrollTo(0, 0);
}
function syncTabPill() {
  const pill = $('tabpill');
  const tab = document.querySelector(`.tabbar__tab[data-goto="${state.view}"]`);
  if (!pill) return;
  if (!tab) { pill.classList.add('tabbar__pill--off'); return; }
  pill.style.left = `${tab.offsetLeft + tab.offsetWidth / 2 - 28}px`;
  pill.classList.remove('tabbar__pill--off');
}
window.addEventListener('resize', syncTabPill);
window.addEventListener('scroll', () => { $('mhead')?.classList.toggle('mhead--compact', window.scrollY > 24); }, { passive: true });

function render() {
  const v = state.view;
  const el = $(`view-${v}`);
  if (mapa.map) { mapa.map.remove(); mapa.map = null; }
  el.innerHTML = v === 'inicio' ? inicioHtml() : v === 'productos' ? productosHtml() : v === 'lugares' ? lugaresHtml() : v === 'mapa' ? mapaHtml() : ajustesHtml();
  hydrateIcons(el);
  if (v === 'productos') wireBuscador();
  if (v === 'mapa') wireMapa();
}

// ---------- Piezas comunes ----------
function emptyState(title, text = '', actions = []) {
  return `<div class="empty"><span class="empty__ic" aria-hidden="true">${ic('receipt')}</span>
    <p class="empty__title">${esc(title)}</p>${text ? `<p>${esc(text)}</p>` : ''}
    ${actions.length ? `<div class="empty__acts">${actions.map((a) => `<button type="button" class="empty__btn${a.ghost ? ' empty__btn--ghost' : ''}" ${a.attr}>${esc(a.label)}</button>`).join('')}</div>` : ''}</div>`;
}
function whoChip(uid) {
  const u = state.users.get(uid);
  const name = quien(uid);
  return `<span class="chip chip--who"><span class="pava pava--chip" style="background:${fillOf(personColor(uid))};color:var(--on-tone)" aria-hidden="true">${esc(inicial(u?.name))}</span>${esc(name)}</span>`;
}
function lugarIc(l) {
  const c = personColor(l?.cadena || '?');
  return `<span class="mrow__ic" style="background:${fillOf(c)};color:var(--on-tone)" aria-hidden="true">${esc(inicial(l?.cadena))}</span>`;
}
// Un ticket como fila: el lugar, quién y cuántos productos; a la derecha lo pagado.
function ticketRowHtml(t) {
  const l = lugarDe(t.lugar_id);
  return `<button type="button" class="mrow txrow" data-ticket="${esc(t.id)}">
    ${lugarIc(l)}
    <span class="mrow__text"><span class="mrow__title">${esc(lugarNombre(l))}</span>
      <span class="row__meta"><span class="movchips">${whoChip(t.user_id)}<span class="chip">${t.n_renglones} productos</span><span class="chip">${esc(fmtFecha(t.fecha))}</span></span></span></span>
    <span class="mrow__right"><span class="mrow__amt">${fmtMoney(t.pagado)}</span></span>
  </button>`;
}
// Un producto como fila: dónde está más barato y cuánto.
function productoRowHtml(r) {
  const p = r.producto;
  const m = r.mejor;
  const sub = productoSub(p);
  const nFrescos = r.lugares.filter((x) => x.fresco).length;
  const cadena = esc(lugarDe(m?.lugar_id)?.cadena || '—');
  // "Más barato en" sólo si hay con qué comparar; con un lugar, dónde está.
  const meta = !m ? `<span class="chip">${esc(fmtFecha(r.ultimo.fecha))}</span>`
    : nFrescos > 1 ? `<span class="chip chip--best">Más barato en ${cadena}</span><span class="chip">${nFrescos} lugares</span>`
    : `<span class="chip">Sólo en ${cadena}</span>`;
  const pr = m ? m.precio : r.ultimo;
  return `<button type="button" class="mrow txrow" data-producto="${esc(p.id)}">
    <span class="mrow__ic" aria-hidden="true">${ic('tag', 20)}</span>
    <span class="mrow__text"><span class="mrow__title">${esc(productoNombre(p))}${sub ? ` <span class="prod__medida">${esc(sub)}</span>` : ''}</span>
      <span class="row__meta"><span class="movchips">${meta}</span></span></span>
    <span class="mrow__right"><span class="mrow__amt${m ? '' : ' amt-old'}">${fmtMoney(comparable(pr))}</span><span class="row__of">${esc(porQue(pr, p))}</span></span>
  </button>`;
}

// ---------- Inicio ----------
function inicioHtml() {
  if (!state.tickets.length) {
    return `<div class="tcard">${emptyState('Cargá tu primer ticket',
      'Sacale una foto (o varias, si es largo) y la app lee cada producto con su precio. Cuantos más tickets, más sabés dónde está más barato.',
      [{ label: 'Sacar una foto', attr: 'data-nuevo' }, ...(state.amigos.length ? [] : [{ label: 'Invitar a un amigo', attr: 'data-invitar', ghost: true }])])}</div>`;
  }
  const cmb = cambios().slice(0, 5);
  const tks = state.tickets.slice(0, 8);
  return `<button type="button" class="buscador buscador--btn" data-buscar>${ic('search', 20)}<span>Buscá un producto</span></button>
    ${cmb.length ? `<div class="tcard"><div class="tcard__head"><span class="lbl">Lo que cambió</span></div>
      ${cmb.map(cambioRowHtml).join('')}</div>` : ''}
    <div class="tcard"><div class="tcard__head"><span class="lbl">Últimos tickets</span></div>
      ${tks.map(ticketRowHtml).join('')}</div>
    ${state.amigos.length ? '' : `<button type="button" class="bknew bknew--row setnew" data-invitar><span class="bknew__ic">${ic('friend', 20)}</span><span class="bknew__txt"><span>Invitar a un amigo</span><small>Para ver sus precios y que vea los tuyos</small></span></button>`}`;
}
function cambioRowHtml(c) {
  const p = state.productos.get(c.ultimo.producto_id);
  const l = lugarDe(c.ultimo.lugar_id);
  const pct = Math.round(c.pct * 100);
  return `<button type="button" class="mrow txrow" data-producto="${esc(p?.id || '')}">
    <span class="mrow__ic" aria-hidden="true">${ic(pct > 0 ? 'up' : 'down', 20)}</span>
    <span class="mrow__text"><span class="mrow__title">${esc(productoNombre(p))}</span>
      <span class="row__meta"><span class="movchips"><span class="chip">${esc(l?.cadena || '—')}</span><span class="chip">antes ${fmtMoney(comparable(c.antes))}</span></span></span></span>
    <span class="mrow__right"><span class="mrow__amt">${fmtMoney(comparable(c.ultimo))}</span><span class="trendpill trendpill--${pct > 0 ? 'neg' : 'pos'}">${pct > 0 ? '+' : ''}${pct}%</span></span>
  </button>`;
}

// ---------- Productos ----------
const normQ = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function productosHtml() {
  const todos = resumenProductos();
  if (!todos.length) {
    return `<div class="tcard">${emptyState('Todavía no hay productos', 'Aparecen cuando vos o tus amigos cargan un ticket.', [{ label: 'Sacar una foto', attr: 'data-nuevo' }])}</div>`;
  }
  return `<label class="buscador"><span class="sr-only">Buscar un producto</span>${ic('search', 20)}
      <input type="search" id="buscar-q" placeholder="Buscá un producto" autocomplete="off" value="${esc(state.q)}"></label>
    ${ciudadesHtml()}
    <div class="tcard" id="prod-list">${productosListHtml()}</div>`;
}
function productosListHtml(todos = resumenProductos(ciudadActiva())) {
  const words = normQ(state.q).split(/\s+/).filter(Boolean);
  const hit = (r) => {
    const t = normQ(`${r.producto.marca} ${r.producto.nombre} ${productoSub(r.producto)}`);
    return words.every((w) => t.includes(w));
  };
  const rows = todos.filter(hit).sort((a, b) => (b.ultimo.fecha > a.ultimo.fecha ? 1 : b.ultimo.fecha < a.ultimo.fecha ? -1 : 0));
  if (!rows.length) return `<p class="note">${state.q ? `No hay ningún producto con «${esc(state.q)}»` : 'No hay productos'}${ciudadActiva() ? ` en ${esc(ciudadActiva())}` : ''}.</p>`;
  return rows.slice(0, 200).map(productoRowHtml).join('');
}
function wireBuscador() {
  const q = $('buscar-q');
  if (!q) return;
  q.addEventListener('input', () => {
    state.q = q.value;
    $('prod-list').innerHTML = productosListHtml();
    hydrateIcons($('prod-list'));
  });
}

// La ficha de un producto: ¿dónde está más barato? Con el historial entero del server.
async function openProducto(pid) {
  let data = { producto: state.productos.get(pid), precios: preciosDe(pid) };
  const paint = () => {
    const p = data.producto;
    if (!p) return `${modalHead('Producto')}<p class="note">No encontré el producto.</p>`;
    // Con una ciudad elegida, se compara ahí; lo de las otras va aparte, al pie.
    const ciudad = ciudadActiva();
    const ciudadDe = (pr) => lugarDe(pr.lugar_id)?.ciudad ?? pr.ciudad;
    const lugares = porLugar(data.precios.filter((pr) => !ciudad || ciudadDe(pr) === ciudad));
    const otras = ciudad ? porLugar(data.precios.filter((pr) => ciudadDe(pr) !== ciudad)) : [];
    const frescos = lugares.filter((l) => l.fresco);
    const viejos = lugares.filter((l) => !l.fresco);
    const mejor = frescos[0];
    const fila = (x, i) => {
      const pr = x.precio;
      const l = lugarDe(pr.lugar_id) || { cadena: pr.cadena, sucursal: pr.sucursal, direccion: pr.direccion, ciudad: pr.ciudad };
      const donde = lugarDonde(l);
      return `<button type="button" class="mrow txrow${x.fresco && !x.otra ? '' : ' mrow--old'}" data-ticket="${esc(pr.ticket_id)}">
        ${lugarIc(l)}
        <span class="mrow__text"><span class="mrow__title">${esc(lugarNombre(l))}</span>
          <span class="row__meta"><span class="movchips">${x.fresco && !x.otra && i === 0 && frescos.length > 1 ? '<span class="chip chip--best">Más barato</span>' : ''}${donde ? `<span class="chip">${esc(donde)}</span>` : ''}${whoChip(pr.user_id)}<span class="chip">${esc(fmtFecha(pr.fecha))}</span></span></span></span>
        <span class="mrow__right"><span class="mrow__amt">${fmtMoney(comparable(pr))}</span><span class="row__of">${esc(porQue(pr, p))}</span></span>
      </button>`;
    };
    const hist = [...data.precios].sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
    return `${modalHead(productoNombre(p), productoSub(p))}
      ${!mejor && otras.length ? `<p class="note">No hay precios de los últimos ${FRESCO_DIAS} días en ${esc(ciudad)}.</p>` : mejor ? `<div class="prodhero">
          <span class="lbl">${frescos.length > 1 ? 'Más barato hoy' : 'Último precio'}</span>
          <span class="prodhero__amt">${fmtMoney(comparable(mejor.precio))}</span>
          <span class="prodhero__sub">${esc(porQue(mejor.precio, p))} en ${esc(lugarNombre(lugarDe(mejor.precio.lugar_id) || mejor.precio))}${frescos.length > 1 ? ` · ${fmtMoney(comparable(frescos[frescos.length - 1].precio) - comparable(mejor.precio))} menos que en el más caro` : ''}</span>
        </div>` : `<p class="note">No hay precios de los últimos ${FRESCO_DIAS} días.</p>`}
      ${frescos.length ? `<span class="setsub">¿Dónde está más barato${ciudad ? ` en ${esc(ciudad)}` : ''}?</span><div class="gcard">${frescos.map(fila).join('')}</div>` : ''}
      ${viejos.length ? `<span class="setsub">Hace más de ${FRESCO_DIAS} días</span><div class="gcard">${viejos.map(fila).join('')}</div>` : ''}
      ${otras.length ? `<span class="setsub">En otras ciudades</span><div class="gcard">${otras.map((x, i) => fila({ ...x, otra: true }, i)).join('')}</div>` : ''}
      ${hist.length > 1 ? `<details class="hist"><summary>Todos los precios (${hist.length})</summary><div class="gcard">${hist.map((pr) => `<button type="button" class="hist__row hist__row--btn" data-ticket="${esc(pr.ticket_id)}"><span>${esc(fmtFechaLarga(pr.fecha))} · ${esc(lugarNombre(lugarDe(pr.lugar_id) || pr))} · ${esc(quien(pr.user_id))}</span><b>${fmtMoney(comparable(pr))}</b></button>`).join('')}</div></details>` : ''}
      <div class="prodfoot">
        ${p.ean ? `<span class="chip">Código ${esc(p.ean)}</span>` : ''}
        <button type="button" class="set__btn" data-prod-edit="${esc(p.id)}">${ic('edit', 18)} Corregir el producto</button>
      </div>`;
  };
  openModal({ render: paint });
  try {
    const d = await apiFetch(`/api/productos/${encodeURIComponent(pid)}`);
    data = { producto: d.producto, precios: d.precios };
    state.productos.set(pid, d.producto);
    if (modalState?.render === paint) repaintModal();
  } catch (e) {
    if (e.status !== 401 && !data.producto) toast(e.message, { icon: 'error' });
  }
}

const UNIDADES_MEDIDA = [['g', 'g'], ['kg', 'kg'], ['ml', 'ml'], ['l', 'L'], ['u', 'unidades']];
// Pasa una medida guardada (g, ml, u) a lo que se escribe: 1000 g → 1 kg.
function medidaEditable(medida, unidad) {
  if (!(medida > 0)) return { n: '', u: 'g' };
  if (unidad === 'g' && medida >= 1000) return { n: medida / 1000, u: 'kg' };
  if (unidad === 'ml' && medida >= 1000) return { n: medida / 1000, u: 'l' };
  return { n: medida, u: unidad || 'g' };
}
function medidaFieldsHtml(prefix, medida, unidad) {
  const m = medidaEditable(medida, unidad);
  return `<div class="medida">
    <label class="accf__field"><span>Medida del envase</span><input type="text" inputmode="decimal" id="${prefix}-medida" value="${esc(m.n === '' ? '' : String(m.n).replace('.', ','))}" placeholder="Sin medida"></label>
    <div class="optrail optrail--row" role="group" aria-label="Unidad" id="${prefix}-unidad">${UNIDADES_MEDIDA.map(([v, l]) => `<button type="button" class="optrail__opt${m.u === v ? ' active' : ''}" data-u="${v}" aria-pressed="${m.u === v}">${l}</button>`).join('')}</div>
  </div>`;
}
function wireOptrail(el) {
  el.querySelectorAll('.optrail').forEach((rail) => rail.addEventListener('click', (e) => {
    const b = e.target.closest('.optrail__opt'); if (!b) return;
    rail.querySelectorAll('.optrail__opt').forEach((o) => { o.classList.toggle('active', o === b); o.setAttribute('aria-pressed', String(o === b)); });
  }));
}
// Un monto como se escribe acá: "14.162,68", "14162,68", "14162.68" o "29.994".
function leerNum(s) {
  const t = String(s ?? '').trim().replace(/[$\s]/g, '');
  let v;
  if (t.includes(',')) v = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) v = t.replace(/\./g, ''); // puntos de miles
  else v = t;
  const n = Number(v);
  return t && Number.isFinite(n) ? n : NaN;
}
const leerDec = (s) => { const n = Number(String(s ?? '').trim().replace(',', '.')); return Number.isFinite(n) ? n : NaN; };
function leerMedida(el, prefix) {
  const raw = el.querySelector(`#${prefix}-medida`).value.trim();
  const u = el.querySelector(`#${prefix}-unidad .active`)?.dataset.u || 'g';
  if (!raw) return { medida: null, medida_unidad: null };
  const n = leerDec(raw);
  return Number.isFinite(n) && n > 0 ? { medida: n, medida_unidad: u } : { error: 'La medida no es un número.' };
}

function openProductoEdit(pid) {
  const p = state.productos.get(pid);
  if (!p) return;
  const sh = openSheet({
    title: 'Corregir el producto',
    body: `<div class="accf">
      <label class="accf__field"><span>Qué es</span><input type="text" id="pe-nombre" value="${esc(p.nombre)}" maxlength="100"></label>
      <label class="accf__field"><span>Marca</span><input type="text" id="pe-marca" value="${esc(p.marca)}" maxlength="60" placeholder="Sin marca"></label>
      ${medidaFieldsHtml('pe', p.medida, p.medida_unidad)}
      <label class="accf__field"><span>Código de barras</span><input type="text" inputmode="numeric" id="pe-ean" value="${esc(p.ean)}" maxlength="14" placeholder="Opcional"></label>
      <p class="accf__hint">El producto es el mismo para todos: lo corrige quien lo cargó.</p>
    </div>`,
    foot: '<button type="button" class="mvf__submit" id="pe-ok">Guardar</button>',
    onMount: (el) => {
      wireOptrail(el);
      el.querySelector('#pe-ok').addEventListener('click', async () => {
        const m = leerMedida(el, 'pe');
        if (m.error) { toast(m.error, { icon: 'error' }); return; }
        const btn = el.querySelector('#pe-ok');
        btn.classList.add('mvf__submit--busy'); btn.disabled = true;
        try {
          const d = await apiFetch(`/api/productos/${encodeURIComponent(pid)}`, {
            method: 'PATCH',
            body: { nombre: el.querySelector('#pe-nombre').value, marca: el.querySelector('#pe-marca').value, ...m, ean: el.querySelector('#pe-ean').value.trim() },
          });
          state.productos.set(pid, d.producto);
          sh.close();
          await reload();
          repaintModal();
          toast('✓ Producto corregido');
        } catch (e) {
          if (e.status !== 401) toast(e.message, { icon: 'error' });
          btn.classList.remove('mvf__submit--busy'); btn.disabled = false;
        }
      });
    },
  });
}

// ---------- Lugares ----------
function lugaresHtml() {
  const by = new Map();
  const ciudad = ciudadActiva();
  for (const t of state.tickets) {
    if (!t.lugar_id || !enCiudad(t.lugar_id, ciudad)) continue;
    const cur = by.get(t.lugar_id) || { n: 0, ultimo: '' };
    cur.n++; if (t.fecha > cur.ultimo) cur.ultimo = t.fecha;
    by.set(t.lugar_id, cur);
  }
  // En cuántos productos cada lugar es el más barato (entre los precios frescos).
  const gana = new Map();
  for (const r of resumenProductos(ciudad)) {
    const fr = r.lugares.filter((x) => x.fresco);
    if (fr.length > 1) gana.set(fr[0].lugar_id, (gana.get(fr[0].lugar_id) || 0) + 1);
  }
  const rows = [...by.entries()].sort((a, b) => (b[1].ultimo > a[1].ultimo ? 1 : -1));
  if (!rows.length && !state.tickets.length) return `<div class="tcard">${emptyState('Todavía no hay lugares', 'Cada ticket suma el lugar donde compraste.', [{ label: 'Sacar una foto', attr: 'data-nuevo' }])}</div>`;
  return `${ciudadesHtml()}<div class="tcard">${rows.map(([id, s]) => {
    const l = lugarDe(id);
    const donde = lugarDonde(l);
    return `<button type="button" class="mrow txrow" data-lugar="${esc(id)}">
      ${lugarIc(l)}
      <span class="mrow__text"><span class="mrow__title">${esc(lugarNombre(l))}</span>
        <span class="row__meta"><span class="movchips">${gana.get(id) ? `<span class="chip chip--best">${gana.get(id)} más ${gana.get(id) === 1 ? 'barato' : 'baratos'}</span>` : ''}${donde ? `<span class="chip">${esc(donde)}</span>` : ''}<span class="chip">${esc(fmtFecha(s.ultimo))}</span></span></span></span>
      <span class="mrow__right"><span class="mrow__amt">${s.n} ${s.n === 1 ? 'ticket' : 'tickets'}</span></span>
    </button>`;
  }).join('') || `<p class="note">No hay lugares en ${esc(ciudad)}.</p>`}</div>`;
}
// Lo corrige quien lo creó o quien cargó un ticket ahí (como en api/lugares.mjs).
const lugarEditable = (l) => !!l && (l.creado_por === state.user?.id || state.tickets.some((t) => t.lugar_id === l.id && t.user_id === state.user?.id));
function openLugar(id) {
  openModal({
    render: () => {
      const l = lugarDe(id);
      const tks = state.tickets.filter((t) => t.lugar_id === id);
      const aca = resumenProductos().filter((r) => r.lugares.some((x) => x.lugar_id === id));
      const masBarato = aca.filter((r) => { const fr = r.lugares.filter((x) => x.fresco); return fr.length > 1 && fr[0].lugar_id === id; });
      return `${modalHead(lugarNombre(l), [lugarDonde(l), l?.cuit ? `CUIT ${l.cuit}` : ''].filter(Boolean).join(' · '))}
      ${l?.direccion ? `<p class="lugardonde">${ic('pin', 18)}<span>${esc(lugarDonde(l))}${l.cuit ? ` · CUIT ${esc(l.cuit)}` : ''}</span></p>
        ${l.lat != null ? `<button type="button" class="set__btn lugarmapa" data-ver-mapa="${esc(id)}">${ic('map', 18)} Ver en el mapa</button>`
          : l.geo_at ? `<p class="note">No encontré esta dirección en el mapa: revisá que esté bien escrita y que tenga la ciudad.</p>` : ''}` : ''}
      ${l && !l.direccion ? `<div class="control">${ic('pin', 20)}<span><b>Todavía no tiene dirección.</b> ${l.punto_venta ? `Lo reconozco por su punto de venta (${esc(pvLabel(l.punto_venta))}).` : 'Sin ella, todas las sucursales de la cadena son una.'}
        ${lugarEditable(l) ? `<button type="button" class="set__btn control__btn" data-lugar-edit="${esc(id)}">Ponerle la dirección</button>` : ''}</span></div>` : ''}
      ${masBarato.length ? `<span class="setsub">Acá está más barato</span><div class="gcard">${masBarato.map(productoRowHtml).join('')}</div>` : ''}
      <span class="setsub">Tickets</span><div class="gcard">${tks.map(ticketRowHtml).join('')}</div>
      ${aca.length ? `<span class="setsub">Productos con precio acá (${aca.length})</span><div class="gcard">${aca.map(productoRowHtml).join('')}</div>` : ''}
      ${lugarEditable(l) && l.direccion ? `<div class="prodfoot prodfoot--end"><button type="button" class="set__btn" data-lugar-edit="${esc(id)}">${ic('edit', 18)} Corregir el lugar</button></div>` : ''}`;
    },
  });
}
// Corregir un lugar: sucursal, dirección y ciudad. Si con la dirección resulta que ya
// estaba (cargado por otro punto de venta, o sin dirección), se ofrece juntarlos.
function openLugarEdit(id) {
  const l = lugarDe(id);
  if (!l) return;
  const sh = openSheet({
    title: lugarNombre(l),
    body: `<div class="accf">
      <label class="accf__field"><span>Sucursal</span><input type="text" id="le-sucursal" value="${esc(l.sucursal || '')}" maxlength="60" placeholder="Opcional"></label>
      <label class="accf__field"><span>Dirección</span><input type="text" id="le-dir" value="${esc(l.direccion || '')}" maxlength="120" placeholder="Calle y altura"></label>
      <label class="accf__field"><span>Ciudad</span><input type="text" id="le-ciudad" value="${esc(l.ciudad || '')}" maxlength="60" placeholder="CABA, Rosario…"></label>
      <p class="accf__hint">El lugar es el mismo para todos: con la dirección se distingue una sucursal de otra.</p>
    </div>`,
    foot: '<button type="button" class="mvf__submit" id="le-ok">Guardar</button>',
    onMount: (el) => el.querySelector('#le-ok').addEventListener('click', async () => {
      const btn = el.querySelector('#le-ok');
      const body = { sucursal: el.querySelector('#le-sucursal').value, direccion: el.querySelector('#le-dir').value, ciudad: el.querySelector('#le-ciudad').value };
      btn.classList.add('mvf__submit--busy'); btn.disabled = true;
      const listo = async (d) => {
        sh.close();
        await reload();
        if (d.juntado) { openLugar(d.juntado); toast('✓ Quedaron en un solo lugar'); } else { repaintModal(); toast('✓ Lugar corregido'); }
      };
      try {
        await listo(await apiFetch(`/api/lugares/${encodeURIComponent(id)}`, { method: 'PATCH', body }));
      } catch (e) {
        btn.classList.remove('mvf__submit--busy'); btn.disabled = false;
        if (e.status === 409 && e.data?.otro) {
          const o = e.data.otro;
          const ok = await askConfirm('Ese lugar ya está', {
            text: `${lugarNombre(o)}${lugarDonde(o) ? `, ${lugarDonde(o)}` : ''}, ya está cargado. ¿Los junto? Los tickets de los dos quedan en uno solo.`,
            ok: 'Juntarlos', cancel: 'No', icon: 'warn',
          });
          if (!ok) return;
          try { await listo(await apiFetch(`/api/lugares/${encodeURIComponent(id)}`, { method: 'PATCH', body: { ...body, juntar: o.id } })); } catch (e2) { if (e2.status !== 401) toast(e2.message, { icon: 'error' }); }
          return;
        }
        if (e.status !== 401) toast(e.message, { icon: 'error' });
      }
    }),
  });
}

// ---------- Mapa ----------
// Los lugares con su punto (lib/geo.mjs) en un mapa de OpenStreetMap con Leaflet, que se
// carga de cdnjs recién al abrir la pantalla. Buscando un producto, cada punto dice su
// precio y el más barato va resaltado. "Cerca mío" usa el GPS (pide permiso) para centrar
// y ordenar por distancia. Debajo del mapa, la misma lista (el mapa solo no se lee con un
// lector de pantalla).
const LEAFLET = {
  js: ['https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js', 'sha512-puJW3E/qXDqYp9IfhAI54BJEaWIfloJ7JWs7OeD5i6ruC9JZL1gERT1wjtwXFlh7CjE7ZJ+/vcRZRkIYIb6p4g=='],
  css: ['https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css', 'sha512-h9FcoyWjHcOcmEVkxOfTLnmZFWIH0iZhZT1H2TbOq55xssQGEJHEaIm+PgoUaZbRvQTNTluNOEfb1ZRy6D3BOw=='],
};
let _leaflet = null;
function cargarLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  _leaflet ||= new Promise((ok, mal) => {
    const css = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: LEAFLET.css[0], integrity: LEAFLET.css[1], crossOrigin: 'anonymous' });
    const js = Object.assign(document.createElement('script'), { src: LEAFLET.js[0], integrity: LEAFLET.js[1], crossOrigin: 'anonymous' });
    js.onload = () => ok(window.L);
    js.onerror = () => { _leaflet = null; js.remove(); mal(new Error('No pude cargar el mapa. Revisá la conexión.')); };
    document.head.append(css, js);
  });
  return _leaflet;
}
// map: el de Leaflet; pos: dónde estás ({ lat, lon }, si diste permiso); prod: el producto buscado.
// foco: el lugar que se abrió desde su ficha ("Ver en el mapa"), para centrarlo.
const mapa = { map: null, pines: null, yo: null, pos: null, prod: '', q: '', centrado: false, foco: '' };
const ubicado = (l) => l && Number.isFinite(l.lat) && Number.isFinite(l.lon);
// Metros entre dos puntos (lib/geo.mjs metros).
function metros(a, b) {
  const rad = (x) => (x * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}
const distLabel = (m) => (m < 1000 ? `a ${Math.round(m / 10) * 10} m` : `a ${(Math.round(m / 100) / 10).toLocaleString('es-AR')} km`);

// Lo que va en el mapa: cada lugar ubicado ({ l, precio, fresco, dist }); con un producto,
// sólo los que lo tienen, del más barato al más caro (los viejos al final); sin él, del más
// cerca al más lejos si se sabe dónde estás.
function mapaPuntos() {
  const dist = (l) => (mapa.pos ? metros(mapa.pos, l) : null);
  if (mapa.prod) {
    const r = resumenProductos().find((x) => x.producto.id === mapa.prod);
    return (r?.lugares || []).map((x) => ({ l: lugarDe(x.lugar_id), precio: x.precio, fresco: x.fresco }))
      .filter((x) => ubicado(x.l)).map((x) => ({ ...x, dist: dist(x.l) }));
  }
  const pts = [...state.lugares.values()].filter(ubicado).map((l) => ({ l, precio: null, fresco: true, dist: dist(l) }));
  return pts.sort((a, b) => (a.dist ?? 0) - (b.dist ?? 0) || lugarNombre(a.l).localeCompare(lugarNombre(b.l)));
}
// Con un producto, sus lugares sin punto en el mapa (sin dirección o no encontrada): van
// en la lista, porque el más barato puede ser uno de ésos.
function mapaSinPunto() {
  if (!mapa.prod) return [];
  const r = resumenProductos().find((x) => x.producto.id === mapa.prod);
  return (r?.lugares || []).filter((x) => x.lugar_id && !ubicado(lugarDe(x.lugar_id)))
    .map((x) => ({ l: lugarDe(x.lugar_id), precio: x.precio, fresco: x.fresco, dist: null })).filter((x) => x.l);
}
// El más barato entre TODOS sus lugares (también los que no están en el mapa), y sólo si hay
// con qué comparar (dos precios frescos o más): el mismo que dice la lista de Productos.
function mapaMejor() {
  if (!mapa.prod) return null;
  const fr = (resumenProductos().find((x) => x.producto.id === mapa.prod)?.lugares || []).filter((x) => x.fresco);
  return fr.length > 1 ? fr[0].lugar_id : null;
}

// Un punto del mapa: la inicial del lugar en su color o, buscando un producto, su precio.
function mapPinHtml(pt, { mejor = false } = {}) {
  if (pt.precio) {
    return `<span class="mpin mpin--precio${mejor ? ' mpin--best' : ''}${pt.fresco ? '' : ' mpin--old'}">${fmtMoney(Math.round(comparable(pt.precio)))}</span>`;
  }
  return `<span class="mpin" style="background:${fillOf(personColor(pt.l.cadena || '?'))};color:var(--on-tone)">${esc(inicial(pt.l.cadena))}</span>`;
}
// Un lugar de la lista de abajo: dónde queda, a qué distancia y, con un producto, su precio.
function mapaRowHtml(pt, { mejor = false } = {}) {
  const l = pt.l;
  const donde = lugarDonde(l);
  const p = pt.precio ? state.productos.get(pt.precio.producto_id) : null;
  return `<button type="button" class="mrow txrow${pt.fresco ? '' : ' mrow--old'}" data-lugar="${esc(l.id)}">
    ${lugarIc(l)}
    <span class="mrow__text"><span class="mrow__title">${esc(lugarNombre(l))}</span>
      <span class="row__meta"><span class="movchips">${mejor ? '<span class="chip chip--best">Más barato</span>' : ''}${pt.dist != null ? `<span class="chip chip--dist">${esc(distLabel(pt.dist))}</span>` : ''}${donde ? `<span class="chip">${esc(donde)}</span>` : ''}</span></span></span>
    ${pt.precio ? `<span class="mrow__right"><span class="mrow__amt">${fmtMoney(comparable(pt.precio))}</span><span class="row__of">${esc(porQue(pt.precio, p))}</span></span>` : ''}
  </button>`;
}

function mapaHtml() {
  return `<div class="mapa__top" id="mapa-top">${mapaTopHtml()}</div>
    <div class="mapa__wrap">
      <div class="mapa__map" id="mapa-map" role="img" aria-label="Mapa de los lugares"><div class="mapa__load">${ic('map', 28)}<span>Cargando el mapa…</span></div></div>
      <button type="button" class="mapa__yo" data-mapa-yo aria-label="Cerca mío">${ic('loc', 20)}<span>Cerca mío</span></button>
    </div>
    <div id="mapa-list">${mapaListHtml()}</div>`;
}
// Arriba: el buscador de productos o, con uno elegido, cuál es y cómo sacarlo.
function mapaTopHtml() {
  const p = mapa.prod && state.productos.get(mapa.prod);
  if (p) {
    return `<div class="mapa__sel"><span class="mrow__ic" aria-hidden="true">${ic('tag', 20)}</span>
      <span class="mapa__selname">${esc(productoNombre(p))}${productoSub(p) ? ` <span class="prod__medida">${esc(productoSub(p))}</span>` : ''}</span>
      <button type="button" class="modal__x" data-mapa-prod="" aria-label="Ver todos los lugares">✕</button></div>`;
  }
  return `<label class="buscador"><span class="sr-only">Buscar un producto en el mapa</span>${ic('search', 20)}
      <input type="search" id="mapa-q" placeholder="¿Dónde está más barato…?" autocomplete="off" value="${esc(mapa.q)}"></label>
    <div class="gcard mapa__sug" id="mapa-sug"${mapa.q.trim() ? '' : ' hidden'}>${mapaSugHtml()}</div>`;
}
// Los productos que coinciden y tienen algún lugar en el mapa.
function mapaSugHtml() {
  const words = normQ(mapa.q).split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const rows = resumenProductos()
    .filter((r) => r.lugares.some((x) => ubicado(lugarDe(x.lugar_id))))
    .filter((r) => { const t = normQ(`${r.producto.marca} ${r.producto.nombre} ${productoSub(r.producto)}`); return words.every((w) => t.includes(w)); })
    .slice(0, 8);
  if (!rows.length) return `<p class="note">No hay ningún producto con «${esc(mapa.q)}» en lugares del mapa.</p>`;
  return rows.map((r) => `<button type="button" class="mrow txrow row--solo" data-mapa-prod="${esc(r.producto.id)}">
    <span class="mrow__ic" aria-hidden="true">${ic('tag', 20)}</span>
    <span class="mrow__text"><span class="mrow__title">${esc(productoNombre(r.producto))}${productoSub(r.producto) ? ` <span class="prod__medida">${esc(productoSub(r.producto))}</span>` : ''}</span></span>
  </button>`).join('');
}
function mapaListHtml() {
  const pts = mapaPuntos();
  const sin = mapaSinPunto();
  const mejor = mapaMejor();
  const sinPunto = [...state.lugares.values()].filter((l) => !ubicado(l)).length;
  const nota = sinPunto ? `<p class="note mapa__nota">${sinPunto === 1 ? 'Un lugar todavía no está' : `${sinPunto} lugares todavía no están`} en el mapa: les falta la dirección o no la encontré. <button type="button" class="linkbtn" data-goto="lugares">Ver los lugares</button></p>` : '';
  const sinHtml = sin.length ? `<span class="setsub">No están en el mapa</span><div class="gcard">${sin.map((pt) => mapaRowHtml(pt, { mejor: pt.l.id === mejor })).join('')}</div>` : '';
  if (!pts.length) {
    return `${mapa.prod ? `<p class="note">Este producto no tiene precios en lugares del mapa.</p>${sinHtml}` : `<div class="tcard">${emptyState('Todavía no hay lugares en el mapa', 'Aparecen cuando un ticket trae la dirección del local, o cuando se la ponés desde su ficha.', [{ label: 'Ver los lugares', attr: 'data-goto="lugares"' }])}</div>`}${nota}`;
  }
  const titulo = mapa.prod ? (mapa.pos ? '¿Dónde está más barato? · cerca tuyo' : '¿Dónde está más barato?') : mapa.pos ? 'Lo más cerca' : 'Los lugares';
  return `<span class="setsub">${titulo}</span><div class="gcard">${pts.map((pt) => mapaRowHtml(pt, { mejor: pt.l.id === mejor })).join('')}</div>${sinHtml}${mapa.prod ? '' : nota}`;
}

async function wireMapa() {
  if ($('mapa-q')) wireMapaQ();
  const el = $('mapa-map');
  let L;
  try { L = await cargarLeaflet(); } catch (e) {
    el.innerHTML = `<div class="mapa__load">${ic('warn', 28)}<span>${esc(e.message)}</span><button type="button" class="set__btn" data-mapa-retry>Probar de nuevo</button></div>`;
    return;
  }
  if (!el.isConnected || mapa.map) return; // se fue de la pantalla mientras cargaba
  el.innerHTML = '';
  mapa.map = L.map(el, { zoomControl: true, attributionControl: true }).setView([-34.6, -58.44], 11);
  mapa.map.attributionControl.setPrefix(false);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  }).addTo(mapa.map);
  mapa.pines = L.layerGroup().addTo(mapa.map);
  mapa.centrado = false;
  pintarMapa();
  // Si ya diste permiso, centra donde estás sin preguntar.
  try {
    if (!mapa.pos && (await navigator.permissions?.query({ name: 'geolocation' }))?.state === 'granted') ubicarme({ callado: true });
  } catch { /* sin Permissions API */ }
}
// Los puntos y la lista, sin volver a armar el mapa.
function pintarMapa() {
  const top = $('mapa-top');
  // El buscador no se vuelve a armar mientras se escribe en él.
  if (top && document.activeElement?.id !== 'mapa-q') { top.innerHTML = mapaTopHtml(); hydrateIcons(top); if ($('mapa-q')) wireMapaQ(); }
  const list = $('mapa-list');
  if (list) { list.innerHTML = mapaListHtml(); hydrateIcons(list); }
  if (!mapa.map) return;
  const L = window.L;
  const pts = mapaPuntos();
  const mejor = mapaMejor();
  mapa.pines.clearLayers();
  for (const pt of [...pts].reverse()) { // el más barato, arriba de todo
    L.marker([pt.l.lat, pt.l.lon], {
      icon: L.divIcon({ className: 'mpin-wrap', html: mapPinHtml(pt, { mejor: pt.l.id === mejor }), iconSize: null }),
      title: lugarNombre(pt.l), keyboard: true, riseOnHover: true,
    }).on('click', () => openLugar(pt.l.id)).addTo(mapa.pines);
  }
  mapa.yo?.remove();
  mapa.yo = mapa.pos ? L.circleMarker([mapa.pos.lat, mapa.pos.lon], { radius: 8, weight: 3, className: 'mapa__yopt' }).addTo(mapa.map) : null;
  if (!mapa.centrado) centrarMapa(pts);
}
function centrarMapa(pts) {
  const L = window.L;
  const foco = mapa.foco && lugarDe(mapa.foco);
  if (ubicado(foco)) {
    mapa.map.setView([foco.lat, foco.lon], 16);
  } else if (mapa.pos) {
    // Donde estás y los tres más cerca (o, con un producto, los tres más baratos).
    const cerca = [...pts].sort((a, b) => a.dist - b.dist).slice(0, 3);
    mapa.map.fitBounds(L.latLngBounds([[mapa.pos.lat, mapa.pos.lon], ...cerca.map((x) => [x.l.lat, x.l.lon])]), { padding: [40, 40], maxZoom: 15 });
  } else if (pts.length) {
    mapa.map.fitBounds(L.latLngBounds(pts.map((x) => [x.l.lat, x.l.lon])), { padding: [40, 40], maxZoom: 15 });
  } else return;
  mapa.centrado = true;
}
function wireMapaQ() {
  const q = $('mapa-q');
  q.addEventListener('input', () => {
    mapa.q = q.value;
    const sug = $('mapa-sug');
    sug.hidden = !mapa.q.trim();
    sug.innerHTML = mapaSugHtml();
    hydrateIcons(sug);
  });
}
// "Ver en el mapa" de la ficha de un lugar: la pantalla Mapa centrada en él.
function verEnMapa(id) {
  mapa.foco = id;
  mapa.prod = '';
  mapa.centrado = false;
  closeLayer();
  showView('mapa');
}
function elegirProductoMapa(pid) {
  mapa.foco = '';
  mapa.prod = pid;
  mapa.q = '';
  mapa.centrado = false;
  document.activeElement?.blur();
  pintarMapa();
}
function ubicarme({ callado = false } = {}) {
  if (!navigator.geolocation) { if (!callado) toast('Este teléfono no puede decir dónde estás.', { icon: 'error' }); return; }
  const btn = document.querySelector('[data-mapa-yo]');
  btn?.classList.add('mapa__yo--busy');
  navigator.geolocation.getCurrentPosition((p) => {
    btn?.classList.remove('mapa__yo--busy');
    mapa.pos = { lat: p.coords.latitude, lon: p.coords.longitude };
    mapa.foco = '';
    mapa.centrado = false;
    pintarMapa();
  }, () => {
    btn?.classList.remove('mapa__yo--busy');
    if (!callado) toast('No pude saber dónde estás: revisá el permiso de ubicación del navegador.', { icon: 'error' });
  }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 120000 });
}

// ---------- Un ticket ----------
async function openTicket(id) {
  let t = state.tickets.find((x) => x.id === id);
  let renglones = state.precios.filter((pr) => pr.ticket_id === id).sort((a, b) => a.orden - b.orden);
  const paint = () => {
    if (!t) return `${modalHead('Ticket')}<p class="note">No encontré el ticket.</p>`;
    const l = lugarDe(t.lugar_id);
    const mio = t.user_id === state.user.id;
    return `${modalHead(lugarNombre(l), `${quien(t.user_id)} · ${fmtFecha(t.fecha)}`)}
      <div class="prodhero"><span class="lbl">Se pagó</span><span class="prodhero__amt">${fmtMoney(t.pagado)}</span>
        <span class="prodhero__sub">${t.n_renglones} productos${t.total && Math.abs(t.total - t.pagado) > 1 ? ` · el ticket dice ${fmtMoney(t.total)}` : ''}</span>
        ${mio ? gzBotonHtml(t) : ''}</div>
      <div class="gcard">${renglones.map((pr) => {
        const p = state.productos.get(pr.producto_id);
        return `<button type="button" class="mrow txrow" ${p ? `data-producto="${esc(p.id)}"` : 'disabled'}>
          <span class="mrow__ic" aria-hidden="true">${ic('tag', 20)}</span>
          <span class="mrow__text"><span class="mrow__title">${esc(p ? productoNombre(p) : pr.texto)}</span>
            <span class="row__meta"><span class="movchips"><span class="chip">${esc(cantLabel(pr.cantidad, pr.unidad, pr.precio_unit))}</span>${pr.descuento > 0 ? `<span class="chip chip--best">−${fmtMoney(pr.descuento)}</span>` : ''}</span></span></span>
          <span class="mrow__right"><span class="mrow__amt">${fmtMoney(pr.pagado)}</span></span>
        </button>`;
      }).join('')}</div>
      ${mio ? `<div class="dangerfoot"><button type="button" class="dangerfoot__btn" data-ticket-del="${esc(t.id)}">Borrar este ticket</button></div>` : ''}`;
  };
  openModal({ render: paint });
  if (!t || renglones.length !== t.n_renglones) {
    try {
      const d = await apiFetch(`/api/tickets/${encodeURIComponent(id)}`);
      t = d.ticket; renglones = d.ticket.renglones;
      if (modalState?.render === paint) repaintModal();
    } catch (e) { if (e.status !== 401) toast(e.message, { icon: 'error' }); }
  }
}
async function deleteTicket(id) {
  const ok = await askConfirm('¿Borrar este ticket?', { text: 'Se borran sus precios para vos y tus amigos. Los productos quedan.', ok: 'Borrar', danger: true });
  if (!ok) return;
  try {
    await apiFetch(`/api/tickets/${encodeURIComponent(id)}`, { method: 'DELETE' });
    closeLayer();
    await reload();
    toast('✓ Ticket borrado');
  } catch (e) { if (e.status !== 401) toast(e.message, { icon: 'error' }); }
}

// ---------- Mandar a Gastienzos ----------
// Un ticket tuyo se puede mandar a Gastienzos como gasto: el link abre su alta con el monto
// (lo pagado), el título (la cadena: Gastienzos le pone la categoría de su historial) y la
// fecha ya puestos (?add=1&monto=&titulo=&fecha=, parseLaunchPrefill en gastos-app). Allá se
// elige cómo se pagó y se guarda; las cuentas no se conectan. Este teléfono recuerda cuáles
// mandaste (cmp:gastienzos), para decir "Ya lo mandaste".
const GASTIENZOS_URL = 'https://gastienzos.com.ar';
const GZ_KEY = 'cmp:gastienzos';
function gastienzosUrl(t, lugar) {
  const p = new URLSearchParams({ add: '1', monto: String(t.pagado) });
  if (lugar?.cadena) p.set('titulo', lugar.cadena);
  if (t.fecha) p.set('fecha', t.fecha);
  return `${GASTIENZOS_URL}/app?${p}`;
}
function gzMandados() {
  try { return JSON.parse(localStorage.getItem(GZ_KEY) || '[]'); } catch { return []; }
}
function gzMarcar(id) {
  try { localStorage.setItem(GZ_KEY, JSON.stringify([...gzMandados().filter((x) => x !== id), id].slice(-500))); } catch { /* sin storage */ }
}
function gzBotonHtml(t) {
  const ya = gzMandados().includes(t.id);
  return `<a class="set__btn gzbtn" href="${esc(gastienzosUrl(t, lugarDe(t.lugar_id)))}" target="_blank" rel="noopener" data-gz="${esc(t.id)}">${ic('out', 18)} ${ya ? 'Ya lo mandaste · Mandar de nuevo' : 'Mandar a Gastienzos'}</a>`;
}

// ---------- Cargar un ticket: las fotos ----------
// Cada foto se achica en el teléfono (lado mayor FOTO_MAX_PX, JPEG) antes de subirla.
const FOTO_MAX_PX = 1600;
const FOTO_JPEG_Q = 0.8;
const FOTOS_MAX = 6;
async function shrinkPhoto(file) {
  let src, w, h;
  try {
    src = await createImageBitmap(file, { imageOrientation: 'from-image' });
    w = src.width; h = src.height;
  } catch {
    const url = URL.createObjectURL(file);
    try { src = new Image(); src.src = url; await src.decode(); w = src.naturalWidth; h = src.naturalHeight; } finally { URL.revokeObjectURL(url); }
  }
  if (!w || !h) throw new Error('imagen vacía');
  const k = Math.min(1, FOTO_MAX_PX / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, 0, 0, c.width, c.height);
  src.close?.();
  return c.toDataURL('image/jpeg', FOTO_JPEG_Q);
}

const carga = { fotos: [], leyendo: null };
function nuevoTicket() {
  if (!state.lector) { showError('Todavía no se pueden leer tickets', 'Falta configurar la lectura con IA en el server.'); return; }
  carga.fotos = [];
  openModal({ render: fotosHtml, full: true, onClose: () => { carga.leyendo?.abort(); carga.leyendo = null; } });
  $('foto-cam').click();
}
function fotosHtml() {
  const n = carga.fotos.length;
  if (carga.leyendo) {
    return `${modalHead('Leyendo el ticket')}
      <div class="leyendo"><div class="spinner" aria-hidden="true"></div>
        <p class="leyendo__t">Leyendo ${n === 1 ? 'la foto' : `las ${n} fotos`}…</p>
        <p class="note">Puede tardar unos segundos. ${n > 1 ? 'Junto las fotos y saco lo que se repite en los bordes.' : ''}</p>
        <button type="button" class="set__btn" data-cancelar-lectura>Cancelar</button></div>`;
  }
  return `${modalHead('Nuevo ticket', n ? `${n} ${n === 1 ? 'foto' : 'fotos'}` : '')}
    <p class="modal__lead">${n ? '¿Sigue el ticket? Sacale otra foto a la parte que falta. Que se pise un poco con la anterior.' : 'Sacale una foto al ticket. Si es largo, sacale varias, de arriba hacia abajo.'}</p>
    <div class="fotos">${carga.fotos.map((f, i) => `<figure class="fotos__item"><img src="${f}" alt="Foto ${i + 1}"><figcaption>${i + 1}</figcaption>
        <button type="button" class="fotos__x" data-foto-x="${i}" aria-label="Sacar la foto ${i + 1}">${ic('x', 16)}</button></figure>`).join('')}
      ${n < FOTOS_MAX ? `<button type="button" class="fotos__add" data-foto-cam>${ic('camera', 28)}<span>${n ? 'Otra foto' : 'Sacar foto'}</span></button>
        <button type="button" class="fotos__add fotos__add--ghost" data-foto-gal>${ic('gallery', 28)}<span>De la galería</span></button>` : ''}
    </div>
    ${n ? `<div class="mvf__foot"><button type="button" class="mvf__submit" data-leer>Leer el ticket</button></div>` : ''}`;
}
async function addFotos(files) {
  const list = [...(files || [])].filter((f) => f.type.startsWith('image/'));
  if (!list.length) return;
  if (!modalState) openModal({ render: fotosHtml, full: true, onClose: () => { carga.leyendo?.abort(); carga.leyendo = null; } });
  for (const f of list) {
    if (carga.fotos.length >= FOTOS_MAX) { toast(`Son ${FOTOS_MAX} fotos como mucho.`, { icon: 'error' }); break; }
    try { carga.fotos.push(await shrinkPhoto(f)); } catch { toast('No pude abrir esa foto.', { icon: 'error' }); }
  }
  repaintModal();
}
$('foto-cam').addEventListener('change', (e) => { addFotos(e.target.files); e.target.value = ''; });
$('foto-gal').addEventListener('change', (e) => { addFotos(e.target.files); e.target.value = ''; });

async function leerFotos() {
  const ctl = new AbortController();
  carga.leyendo = ctl;
  repaintModal();
  try {
    const d = await apiFetch('/api/tickets/leer', { method: 'POST', body: { fotos: carga.fotos, hoy: hoyIso() }, signal: ctl.signal });
    carga.leyendo = null;
    abrirRevision(d.lectura, { modelo: d.modelo, nFotos: carga.fotos.length });
  } catch (e) {
    carga.leyendo = null;
    if (e.name === 'AbortError' || e.status === 401) { repaintModal(); return; }
    repaintModal();
    toast(e.message, { icon: 'error', action: 'Probar de nuevo', onAction: leerFotos });
  }
}

// ---------- La revisión ----------
// Lo leído se revisa antes de guardar: el lugar, la fecha, cada producto (el reconocido,
// uno sugerido o uno nuevo) y el control contra el total. Nada se guarda hasta Guardar.
let rev = null;
function abrirRevision(lectura, { modelo, nFotos }) {
  rev = {
    modelo, nFotos,
    lugar: { ...lectura.lugar },
    fecha: lectura.fecha || hoyIso(),
    total: lectura.total, subtotal: lectura.subtotal, ahorro: lectura.ahorro, recargos: lectura.recargos, ivaAparte: !!lectura.iva_aparte,
    avisos: lectura.avisos || [],
    renglones: lectura.renglones.map((r, i) => ({ ...r, k: i, producto: r.producto || null, elegido: r.producto ? 'existe' : 'nuevo' })),
    descartados: lectura.descartados.map((d, i) => ({ ...d, k: i })),
  };
  modalState.render = revisionHtml;
  repaintModal();
}
const pagadoDe = (r) => Math.round((r.importe - (r.descuento || 0)) * 100) / 100;
// La misma cuenta que lib/ticket.mjs controlTotal.
function controlRev() {
  const pagado = Math.round(rev.renglones.reduce((s, r) => s + pagadoDe(r), 0) * 100) / 100;
  const impreso = Math.round(rev.renglones.reduce((s, r) => s + r.importe, 0) * 100) / 100;
  // Una factura sin IVA: contra su subtotal sin IVA (lib/ticket.mjs, controlTotal).
  if (rev.ivaAparte && rev.subtotal > 0 && rev.renglones.every((r) => r.importe_sin_iva != null)) {
    const sinIva = Math.round(rev.renglones.reduce((s, r) => s + r.importe_sin_iva - (r.descuento_sin_iva || 0), 0) * 100) / 100;
    const dif = Math.round((sinIva - rev.subtotal) * 100) / 100;
    return Math.abs(dif) <= Math.max(1, rev.subtotal * 0.001)
      ? { estado: 'ok', suma: pagado, sinIva, esperado: rev.subtotal }
      : { estado: 'no_da', suma: sinIva, esperado: rev.subtotal, diferencia: dif, sinIva: true };
  }
  let esperado = null, suma = pagado;
  if (rev.total > 0) esperado = Math.round((rev.total - (rev.recargos > 0 && rev.recargos < rev.total ? rev.recargos : 0)) * 100) / 100;
  else if (rev.subtotal > 0 && rev.ahorro > 0) esperado = Math.round((rev.subtotal - rev.ahorro) * 100) / 100;
  else if (rev.subtotal > 0) { esperado = rev.subtotal; suma = impreso; }
  if (esperado == null) return { estado: 'sin_total', suma: pagado };
  const tol = Math.max(1, esperado * 0.001);
  if (Math.abs(suma - esperado) <= tol) return { estado: 'ok', suma, esperado };
  if (rev.total > 0 && Math.abs(impreso - esperado) <= tol) return { estado: 'ok', suma: impreso, esperado };
  return { estado: 'no_da', suma, esperado, diferencia: Math.round((suma - esperado) * 100) / 100 };
}
function controlHtml() {
  const c = controlRev();
  const rec = rev.total > 0 && rev.recargos > 0 ? ` (más ${fmtMoney(rev.recargos)} de impuestos y recargos)` : '';
  if (c.estado === 'ok' && c.sinIva) return `<div class="control control--ok">${ic('check', 20)}<span><b>Da ${fmtMoney(c.sinIva)} sin IVA</b>, lo mismo que el subtotal de la factura. Con IVA, ${fmtMoney(c.suma)}.</span></div>`;
  if (c.estado === 'ok') return `<div class="control control--ok">${ic('check', 20)}<span><b>Da ${fmtMoney(c.suma)}</b>, lo mismo que el ticket${rec}.</span></div>`;
  if (c.estado === 'sin_total') return `<div class="control">${ic('info', 20)}<span>No encontré el total del ticket: revisá que estén todos. Suman <b>${fmtMoney(c.suma)}</b>.</span></div>`;
  const d = c.diferencia;
  return `<div class="control control--no">${ic('warn', 20)}<span><b>${d > 0 ? `Sobran ${fmtMoney(d)}` : `Faltan ${fmtMoney(-d)}`}</b>: suman ${fmtMoney(c.suma)}${c.sinIva ? ' sin IVA' : ''} y ${c.sinIva ? 'el subtotal' : 'el ticket'} dice ${fmtMoney(c.esperado)}${c.sinIva ? '' : rec}. ${d > 0 ? 'Puede haber un producto repetido.' : 'Puede faltar un producto o una foto.'}</span></div>`;
}
function revRowHtml(r) {
  const p = r.elegido === 'existe' ? r.producto : null;
  const nombre = p ? productoNombre(p) : [r.marca, r.nombre].filter(Boolean).join(' ');
  const sub = p ? productoSub(p) : medidaLabel(r.medida, r.medida_unidad);
  const estado = p ? (r.via === 'alias' || r.via === 'ean' ? '<span class="chip chip--best">Reconocido</span>' : '<span class="chip chip--best">Elegido</span>')
    : r.sugeridos?.length ? '<span class="chip chip--warn">¿Ya existe?</span>' : '<span class="chip">Nuevo</span>';
  return `<button type="button" class="mrow txrow${r.no_cierra ? ' mrow--warn' : ''}" data-rev="${r.k}">
    <span class="mrow__ic" aria-hidden="true">${ic('tag', 20)}</span>
    <span class="mrow__text"><span class="mrow__title">${esc(nombre)}${sub ? ` <span class="prod__medida">${esc(sub)}</span>` : ''}</span>
      <span class="row__meta"><span class="movchips">${estado}${r.no_cierra ? '<span class="chip chip--neg">No cierra</span>' : ''}<span class="chip">${esc(cantLabel(r.cantidad, r.unidad, r.precio_unitario))}</span></span></span></span>
    <span class="mrow__right"><span class="mrow__amt">${fmtMoney(pagadoDe(r))}</span>${r.descuento > 0 ? `<span class="row__of">de ${fmtMoney(r.importe)}</span>` : ''}</span>
  </button>`;
}
// Una fecha de hace más de FECHA_RARA_DIAS es rara para un ticket que se acaba de sacar: se
// pregunta. Si cambiándole el año a éste queda en los últimos días (un "25/10/26" leído como
// 2025), se ofrece con un toque.
const FECHA_RARA_DIAS = 60;
function fechaRaraHtml(f) {
  if (!f || diasDesde(f) <= FECHA_RARA_DIAS) return '';
  const hoy = hoyIso();
  const esteAnio = `${hoy.slice(0, 4)}${f.slice(4)}`;
  const arreglo = esteAnio <= hoy && diasDesde(esteAnio) <= FECHA_RARA_DIAS ? esteAnio : '';
  return `<div class="control control--no">${ic('warn', 20)}<span><b>La fecha es del ${esc(fmtFechaLarga(f))}</b>, hace ${diasDesde(f)} días. ¿Está bien?
    ${arreglo ? `<button type="button" class="set__btn fecha-fix" data-fecha-fix="${esc(arreglo)}">Es del ${esc(fmtFechaLarga(arreglo))}</button>` : ''}</span></div>`;
}
// Sin la dirección no se sabe qué sucursal es: se avisa, con cómo arreglarlo.
function sinDireccionHtml(l) {
  if (!l.cadena || l.direccion) return '';
  return `<div class="control">${ic('pin', 20)}<span><b>No encontré la dirección del local.</b> Sacale una foto también a la parte de arriba del ticket, o escribila: con ella se distingue una sucursal de otra.${l.punto_venta ? ` Mientras tanto la reconozco por su punto de venta (${esc(pvLabel(l.punto_venta))}).` : ''}
    <button type="button" class="set__btn control__btn" data-rev-lugar>Escribir la dirección</button></span></div>`;
}
function revisionHtml() {
  const l = rev.lugar;
  const rep = rev.descartados.filter((d) => d.motivo === 'repetido');
  const otros = rev.descartados.filter((d) => d.motivo !== 'repetido');
  return `${modalHead('Revisá el ticket', `${rev.renglones.length} productos`)}
    <div class="gcard">
      <button type="button" class="mrow txrow" data-rev-lugar>
        ${lugarIc(l)}
        <span class="mrow__text"><span class="mrow__title">${esc(l.cadena ? lugarNombre(l) : 'Falta el lugar')}</span>
          <span class="row__meta"><span class="movchips">${l.existe ? '<span class="chip chip--best">Ya está</span>' : l.cadena ? '<span class="chip">Nuevo lugar</span>' : '<span class="chip chip--neg">Tocá para ponerlo</span>'}${lugarDonde(l) ? `<span class="chip">${esc(lugarDonde(l))}</span>` : ''}</span></span></span>
        <span class="mrow__right">${ic('edit', 18)}</span>
      </button>
      <label class="mrow txrow revfecha"><span class="mrow__ic" aria-hidden="true">${ic('receipt', 20)}</span>
        <span class="mrow__text"><span class="mrow__title">Fecha</span></span>
        <input type="date" id="rev-fecha" value="${esc(rev.fecha)}" max="${hoyIso()}"></label>
    </div>
    ${sinDireccionHtml(l)}
    ${fechaRaraHtml(rev.fecha)}
    ${controlHtml()}
    ${rev.avisos.length ? `<ul class="avisos">${rev.avisos.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
    <div class="gcard">${rev.renglones.map(revRowHtml).join('') || '<p class="note">No quedó ningún producto.</p>'}</div>
    ${rep.length ? `<details class="hist"><summary>${rep.length} ${rep.length === 1 ? 'renglón repetido' : 'renglones repetidos'} en el borde de las fotos</summary>
      <div class="gcard">${rep.map(descRowHtml).join('')}</div></details>` : ''}
    ${otros.length ? `<details class="hist"><summary>${otros.length} ${otros.length === 1 ? 'renglón que no es un producto' : 'renglones que no son productos'}</summary>
      <div class="gcard">${otros.map(descRowHtml).join('')}</div></details>` : ''}
    <div class="mvf__foot"><button type="button" class="mvf__submit" data-rev-guardar>Guardar el ticket</button></div>`;
}
function descRowHtml(d) {
  return `<div class="hist__row"><span>Foto ${d.foto} · ${esc(d.texto)}${d.importe != null ? ` · ${fmtMoney(d.importe)}` : ''}</span>
    ${d.motivo === 'repetido' ? `<button type="button" class="set__btn" data-desc-vuelve="${d.k}">${ic('undo', 16)} Volver a ponerlo</button>` : ''}</div>`;
}
// Un renglón descartado vuelve como producto (Claude lo tomó por repetido y no lo era).
function volverAPoner(k) {
  const i = rev.descartados.findIndex((d) => d.k === k);
  if (i < 0) return;
  const [d] = rev.descartados.splice(i, 1);
  const kk = Math.max(-1, ...rev.renglones.map((r) => r.k)) + 1;
  rev.renglones.push({ k: kk, foto: d.foto, texto: d.texto, cantidad: 1, unidad: 'u', precio_unitario: d.importe, importe: Math.abs(d.importe || 0), descuento: 0, nombre: d.texto, marca: '', medida: null, medida_unidad: '', ean: null, producto: null, elegido: 'nuevo', sugeridos: [] });
  repaintModal();
  editRenglon(kk);
}

function editLugar() {
  const l = rev.lugar;
  const sh = openSheet({
    title: 'El lugar',
    body: `<div class="accf">
      <label class="accf__field"><span>Comercio</span><input type="text" id="lg-cadena" value="${esc(l.cadena || '')}" maxlength="60" placeholder="Carrefour, Coto, Día…"></label>
      <label class="accf__field"><span>Sucursal</span><input type="text" id="lg-sucursal" value="${esc(l.sucursal || '')}" maxlength="60" placeholder="Opcional"></label>
      <label class="accf__field"><span>Dirección</span><input type="text" id="lg-dir" value="${esc(l.direccion || '')}" maxlength="120" placeholder="Calle y altura"></label>
      <label class="accf__field"><span>Ciudad</span><input type="text" id="lg-ciudad" value="${esc(l.ciudad || '')}" maxlength="60" placeholder="CABA, Rosario…"></label>
      <p class="accf__hint">Con la dirección se distingue una sucursal de otra.${l.punto_venta ? ` Sin ella, la reconozco por el punto de venta del ticket (${esc(pvLabel(l.punto_venta))}).` : ''}</p>
    </div>`,
    foot: '<button type="button" class="mvf__submit" id="lg-ok">Listo</button>',
    onMount: (el) => el.querySelector('#lg-ok').addEventListener('click', () => {
      const cadena = el.querySelector('#lg-cadena').value.trim();
      if (!cadena) { toast('Falta el nombre del comercio.', { icon: 'error' }); return; }
      const nuevo = { cadena, sucursal: el.querySelector('#lg-sucursal').value.trim(), direccion: el.querySelector('#lg-dir').value.trim(), ciudad: el.querySelector('#lg-ciudad').value.trim() };
      // Otro comercio u otra dirección ya no es el lugar que se encontró: el server lo busca
      // o lo crea. La sucursal o la ciudad sólo le completan lo que no tenga.
      const otro = nuevo.cadena !== l.cadena || nuevo.direccion !== (l.direccion || '');
      rev.lugar = { ...l, ...nuevo, ...(otro ? { id: undefined, existe: false } : {}) };
      sh.close();
      repaintModal();
    }),
  });
}

function editRenglon(k) {
  const r = rev.renglones.find((x) => x.k === k);
  if (!r) return;
  let busq = null;
  const prodOpts = () => {
    const opts = [];
    if (r.producto && r.via) opts.push({ p: r.producto, sub: r.via === 'alias' ? 'Así lo escribe este comercio' : 'Por el código de barras' });
    for (const s of r.sugeridos || []) if (!opts.some((o) => o.p.id === s.id)) opts.push({ p: s, sub: '¿Es éste?' });
    if (r.elegido === 'existe' && r.producto && !opts.some((o) => o.p.id === r.producto.id)) opts.unshift({ p: r.producto, sub: 'Elegido' });
    return opts;
  };
  const choiceHtml = () => `<div class="choice choice--wrap" role="group" aria-label="Qué producto es" id="re-choice">
      ${prodOpts().map((o) => `<button type="button" class="choice__opt${r.elegido === 'existe' && r.producto?.id === o.p.id ? ' active' : ''}" data-elegir="${esc(o.p.id)}" aria-pressed="${r.elegido === 'existe' && r.producto?.id === o.p.id}">
        <span class="choice__ic">${ic('tag', 20)}</span><b>${esc(productoNombre(o.p))}${productoSub(o.p) ? ` · ${esc(productoSub(o.p))}` : ''}</b><small>${esc(o.sub)}</small></button>`).join('')}
      <button type="button" class="choice__opt${r.elegido === 'nuevo' ? ' active' : ''}" data-elegir="" aria-pressed="${r.elegido === 'nuevo'}">
        <span class="choice__ic">${ic('plus', 20)}</span><b>Un producto nuevo</b><small>Con el nombre de abajo</small></button>
    </div>`;
  const sh = openSheet({
    title: r.texto,
    body: `<span class="setsub">¿Qué producto es?</span>
      <div id="re-choice-wrap">${choiceHtml()}</div>
      <label class="buscador buscador--in"><span class="sr-only">Buscar otro producto</span>${ic('search', 18)}<input type="search" id="re-q" placeholder="Buscar otro producto" autocomplete="off"></label>
      <div id="re-res"></div>
      <div class="accf" id="re-nuevo"${r.elegido === 'nuevo' ? '' : ' hidden'}>
        <label class="accf__field"><span>Qué es</span><input type="text" id="re-nombre" value="${esc(r.nombre || '')}" maxlength="100"></label>
        <label class="accf__field"><span>Marca</span><input type="text" id="re-marca" value="${esc(r.marca || '')}" maxlength="60" placeholder="Sin marca"></label>
        ${medidaFieldsHtml('re', r.medida, r.medida_unidad)}
      </div>
      <span class="setsub">Lo que dice el ticket</span>
      <div class="accf">
        <div class="accf__row">
          <label class="accf__field"><span>${r.unidad === 'kg' ? 'Kilos' : 'Cantidad'}</span><input type="text" inputmode="decimal" id="re-cant" value="${esc(String(r.cantidad).replace('.', ','))}"></label>
          <label class="accf__field"><span>Importe</span><input type="text" inputmode="decimal" id="re-imp" value="${esc(String(r.importe).replace('.', ','))}"></label>
          <label class="accf__field"><span>Descuento</span><input type="text" inputmode="decimal" id="re-desc" value="${r.descuento ? esc(String(r.descuento).replace('.', ',')) : ''}" placeholder="0"></label>
        </div>
        ${r.son ? `<button type="button" class="set__btn" id="re-son">Son ${r.son}, no ${fmtNum(r.cantidad)}</button>` : ''}
        ${r.no_cierra && !r.son ? `<p class="accf__hint accf__hint--err">El importe es más que ${fmtNum(r.cantidad)} × ${fmtMoney(r.precio_unitario)}. Revisá la cantidad o el importe.</p>` : ''}
      </div>
      <div class="dangerfoot"><button type="button" class="dangerfoot__btn" id="re-del">Sacar este renglón</button></div>`,
    foot: '<button type="button" class="mvf__submit" id="re-ok">Listo</button>',
    onMount: (el) => {
      wireOptrail(el);
      const elegir = (pid) => {
        if (!pid) { r.elegido = 'nuevo'; }
        else {
          const o = prodOpts().find((x) => x.p.id === pid)?.p || busq?.find((x) => x.id === pid);
          if (o) { r.producto = o; r.elegido = 'existe'; }
        }
        el.querySelector('#re-choice-wrap').innerHTML = choiceHtml();
        hydrateIcons(el.querySelector('#re-choice-wrap'));
        el.querySelector('#re-nuevo').hidden = r.elegido !== 'nuevo';
      };
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-elegir]');
        if (b) elegir(b.dataset.elegir);
      });
      let tmr = null;
      el.querySelector('#re-q').addEventListener('input', (e) => {
        clearTimeout(tmr);
        const q = e.target.value.trim();
        if (q.length < 2) { el.querySelector('#re-res').innerHTML = ''; return; }
        tmr = setTimeout(async () => {
          try {
            const d = await apiFetch(`/api/productos?q=${encodeURIComponent(q)}`);
            busq = d.productos;
            el.querySelector('#re-res').innerHTML = busq.length
              ? `<div class="choice choice--wrap">${busq.map((p) => `<button type="button" class="choice__opt" data-elegir="${esc(p.id)}"><span class="choice__ic">${ic('tag', 20)}</span><b>${esc(productoNombre(p))}${productoSub(p) ? ` · ${esc(productoSub(p))}` : ''}</b><small>Del catálogo</small></button>`).join('')}</div>`
              : '<p class="note">No hay ninguno así en el catálogo.</p>';
          } catch { /* sin conexión: se queda como está */ }
        }, 250);
      });
      el.querySelector('#re-son')?.addEventListener('click', () => { el.querySelector('#re-cant').value = String(r.son); });
      el.querySelector('#re-del').addEventListener('click', () => {
        rev.renglones = rev.renglones.filter((x) => x.k !== k);
        sh.close();
        repaintModal();
      });
      el.querySelector('#re-ok').addEventListener('click', () => {
        const cant = leerDec(el.querySelector('#re-cant').value);
        const imp = leerNum(el.querySelector('#re-imp').value);
        const descRaw = el.querySelector('#re-desc').value.trim();
        const desc = descRaw ? leerNum(descRaw) : 0;
        if (!(cant > 0)) { toast('La cantidad no es un número.', { icon: 'error' }); return; }
        if (!(imp > 0)) { toast('El importe no es un número.', { icon: 'error' }); return; }
        if (!(desc >= 0) || desc > imp) { toast('El descuento no puede ser más que el importe.', { icon: 'error' }); return; }
        if (r.elegido === 'nuevo') {
          const nombre = el.querySelector('#re-nombre').value.trim();
          if (!nombre) { toast('Falta qué es el producto.', { icon: 'error' }); return; }
          const m = leerMedida(el, 're');
          if (m.error) { toast(m.error, { icon: 'error' }); return; }
          const g = m.medida_unidad === 'kg' ? ['g', 1000] : m.medida_unidad === 'l' ? ['ml', 1000] : [m.medida_unidad, 1];
          Object.assign(r, { nombre, marca: el.querySelector('#re-marca').value.trim(), medida: m.medida ? m.medida * g[1] : null, medida_unidad: m.medida ? g[0] : '' });
        }
        // En una factura sin IVA lo que se edita es con IVA: lo sin IVA del control se recalcula.
        if (r.importe_sin_iva != null && r.iva) {
          const k = 1 + r.iva / 100;
          Object.assign(r, { importe_sin_iva: Math.round((imp / k) * 100) / 100, descuento_sin_iva: Math.round((desc / k) * 100) / 100 });
        }
        Object.assign(r, { cantidad: cant, importe: imp, descuento: desc });
        r.no_cierra = r.precio_unitario > 0 && imp > cant * r.precio_unitario * 1.005 + 0.05;
        r.son = null;
        sh.close();
        repaintModal();
      });
    },
  });
}

async function guardarRevision(btn, forzar = false) {
  const fecha = $('rev-fecha')?.value || rev.fecha;
  if (!rev.lugar.cadena && !rev.lugar.id) { toast('Falta el lugar del ticket.', { icon: 'error' }); editLugar(); return; }
  if (!rev.renglones.length) { toast('El ticket no tiene productos.', { icon: 'error' }); return; }
  const c = controlRev();
  if (c.estado === 'no_da') {
    const ok = await askConfirm('La suma no da el total', {
      text: `Suman ${fmtMoney(c.suma)} y el ticket dice ${fmtMoney(c.esperado)}. ¿Lo guardo igual?`, ok: 'Guardar igual', cancel: 'Revisar', icon: 'warn',
    });
    if (!ok) return;
  }
  const body = {
    fecha,
    // Con id, el que ya existe; lo demás le completa lo que no tenga.
    lugar: {
      ...(rev.lugar.existe ? { id: rev.lugar.id } : {}),
      cadena: rev.lugar.cadena || '', sucursal: rev.lugar.sucursal || '', direccion: rev.lugar.direccion || '',
      ciudad: rev.lugar.ciudad || '', punto_venta: rev.lugar.punto_venta || '', cuit: rev.lugar.cuit || '',
    },
    total: rev.total, n_fotos: rev.nFotos, modelo: rev.modelo,
    ...(forzar ? { forzar: true } : {}),
    renglones: rev.renglones.map((r) => ({
      texto: r.texto, cantidad: r.cantidad, unidad: r.unidad, precio_unitario: r.precio_unitario, importe: r.importe, descuento: r.descuento,
      producto_id: r.elegido === 'existe' ? r.producto.id : null,
      nuevo: r.elegido === 'existe' ? null : { nombre: r.nombre, marca: r.marca, medida: r.medida, medida_unidad: r.medida_unidad, ean: r.ean },
    })),
  };
  btn.classList.add('mvf__submit--busy'); btn.disabled = true;
  try {
    const { id } = await apiFetch('/api/tickets', { method: 'POST', body });
    rev = null;
    closeLayer();
    await reload();
    showView('inicio');
    navigator.vibrate?.(30);
    const t = state.tickets.find((x) => x.id === id);
    toast(`${body.renglones.length} productos de ${body.lugar.cadena || lugarNombre(lugarDe(body.lugar.id))}`, {
      lead: 'Ticket guardado', icon: 'ok',
      ...(t ? { action: 'Mandar a Gastienzos', onAction: () => { gzMarcar(t.id); window.open(gastienzosUrl(t, lugarDe(t.lugar_id)), '_blank', 'noopener'); } } : {}),
    });
  } catch (e) {
    btn.classList.remove('mvf__submit--busy'); btn.disabled = false;
    if (e.status === 409 && e.data?.duplicado) {
      const d = e.data.duplicado;
      const ok = await askConfirm('Ya cargaste este ticket', {
        text: `Tenés uno del mismo lugar, con el mismo total y los mismos ${body.renglones.length} productos, del ${fmtFechaLarga(d.fecha)}.`,
        ok: 'Guardar igual', cancel: 'No guardar', icon: 'warn',
      });
      if (ok) guardarRevision(btn, true);
      return;
    }
    if (e.status !== 401) toast(e.message, { icon: 'error' });
  }
}

// ---------- Amigos ----------
async function invitar() {
  try {
    const d = await apiFetch('/api/amigos/link', { method: 'POST' });
    state.links++;
    const url = d.link.url;
    const texto = `${state.user.name?.split(' ')[0] || 'Te'} te invita a compartir precios en Comparame esta`;
    const sh = openSheet({
      title: 'Invitar a un amigo',
      body: `<p class="modal__lead">Mandale este link. Cuando lo abra y entre, van a ver los precios del otro. Sirve una vez y vence en 7 días.</p>
        <div class="setgroup setgroup--row"><code class="code">${esc(url)}</code><button type="button" class="copybtn" id="inv-copy">Copiar</button></div>`,
      foot: navigator.share ? '<button type="button" class="mvf__submit" id="inv-share">Mandarle el link</button>' : '',
      onMount: (el) => {
        el.querySelector('#inv-copy').addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(url); toast('✓ Link copiado'); } catch { toast('No pude copiarlo: seleccionalo a mano.', { icon: 'error' }); }
        });
        el.querySelector('#inv-share')?.addEventListener('click', async () => {
          try { await navigator.share({ title: 'Comparame esta', text: texto, url }); sh.close(); } catch { /* cancelado */ }
        });
      },
    });
    if (state.view === 'ajustes') render();
  } catch (e) { if (e.status !== 401) toast(e.message, { icon: 'error' }); }
}
// El link de un amigo (/?amigo=…): quién invita y aceptar.
async function aceptarInvitacion(token) {
  history.replaceState(null, '', '/');
  try {
    const v = await apiFetch(`/api/amigos/aceptar?token=${encodeURIComponent(token)}`);
    if (v.propio) { showError('Es tu propio link', 'Mandáselo a tu amigo para que lo abra él.'); return; }
    if (v.ya) { toast(`Ya sos amigo de ${v.de.name}`); return; }
    const ok = await askConfirm(`${v.de.name} te invita a compartir precios`, { text: 'Van a ver los precios que carga el otro.', ok: 'Aceptar', cancel: 'Ahora no', icon: 'friend' });
    if (!ok) return;
    await apiFetch('/api/amigos/aceptar', { method: 'POST', body: { token } });
    await reload();
    toast(`✓ Ahora sos amigo de ${v.de.name}`);
  } catch (e) { if (e.status !== 401) showError('No pude aceptar la invitación', e.message); }
}
async function quitarAmigo(id) {
  const a = state.users.get(id);
  const ok = await askConfirm(`¿Quitar a ${a?.name || 'tu amigo'}?`, { text: 'Dejan de ver los precios del otro. Para volver, hace falta otro link.', ok: 'Quitar', danger: true, icon: 'friend' });
  if (!ok) return;
  try {
    await apiFetch(`/api/amigos/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await reload();
    toast('✓ Ya no son amigos');
  } catch (e) { if (e.status !== 401) toast(e.message, { icon: 'error' }); }
}

// ---------- Ajustes ----------
const THEMES = [['', 'Sistema'], ['light', 'Claro'], ['dark', 'Oscuro']];
function themeNow() { try { return localStorage.getItem('cmp:theme') || ''; } catch { return ''; } }
function setTheme(t) {
  try { if (t) localStorage.setItem('cmp:theme', t); else localStorage.removeItem('cmp:theme'); } catch { /* sin localStorage */ }
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
}
function ajustesHtml() {
  const u = state.user;
  const t = themeNow();
  return `<div class="setwrap setwrap--simple">
    <div class="tcard set__acct">
      <div class="set__acct-go">${u.picture ? `<img src="${esc(u.picture)}" alt="" referrerpolicy="no-referrer">` : `<span class="set__acct-ava">${esc(inicial(u.name))}</span>`}
        <span class="set__acct-info"><b>${esc(u.name || u.email)}</b><span>${esc(u.email)}</span></span></div>
      <button type="button" class="set__out" data-salir>${ic('logout', 20)}<span>Salir</span></button>
    </div>
    <div class="tcard setcard">
      <div class="setcard__head"><span class="lbl">Amigos</span></div>
      <p class="setcard__lead">Ven todos tus precios y vos los suyos.</p>
      <div class="setrows">${state.amigos.map((a) => `<button type="button" class="frd-row" data-amigo="${esc(a.id)}">
          <span class="frd-row__ava" style="background:${fillOf(personColor(a.id))};color:var(--on-tone)">${esc(inicial(a.name))}</span>
          <span class="frd-row__txt"><span class="frd-row__nm">${esc(a.name || a.email)}</span><span class="frd-row__sub">${esc(a.email)}</span></span>
          <span class="frd-row__chev" aria-hidden="true">›</span></button>`).join('')}</div>
      <button type="button" class="bknew bknew--row setnew" data-invitar><span class="bknew__ic">${ic('plus', 20)}</span><span class="bknew__txt"><span>Invitar a un amigo</span><small>${state.links ? `${state.links} ${state.links === 1 ? 'link sin usar' : 'links sin usar'}` : 'Con un link que sirve una vez'}</small></span></button>
    </div>
    <div class="tcard setcard">
      <div class="setcard__head"><span class="lbl">Apariencia</span></div>
      <div class="setpick setpick--3" role="group" aria-label="Tema">${THEMES.map(([v, l]) => `<button type="button" class="setpick__opt${t === v ? ' active' : ''}" data-theme-pick="${v}" aria-pressed="${t === v}">
        <span class="setpick__box">${v === '' ? '<span class="thp thp--light"><i></i><i></i><i></i></span><span class="thp thp--dark"><i></i><i></i><i></i></span>' : `<span class="thp thp--${v}"><i></i><i></i><i></i></span>`}</span><span>${l}</span></button>`).join('')}</div>
    </div>
    <div class="setfoot"><span class="setfoot__ver">Versión ${esc(VERSION)}</span></div>
  </div>`;
}
function openAmigo(id) {
  const a = state.users.get(id);
  if (!a) return;
  const n = state.tickets.filter((t) => t.user_id === id).length;
  openSheet({
    title: a.name || a.email,
    body: `<p class="modal__lead">${esc(a.email)} · ${n ? `${n} ${n === 1 ? 'ticket' : 'tickets'} en los últimos meses` : 'todavía no cargó tickets'}.</p>
      <div class="dangerfoot"><button type="button" class="dangerfoot__btn" data-quitar-amigo="${esc(id)}">Quitar de mis amigos</button></div>`,
  });
}

// ---------- Clicks ----------
document.addEventListener('click', (e) => {
  const t = e.target;
  const go = t.closest('[data-goto]');
  if (go) { showView(go.dataset.goto); return; }
  if (t.closest('[data-nuevo]')) { nuevoTicket(); return; }
  if (t.closest('[data-buscar]')) { showView('productos'); setTimeout(() => $('buscar-q')?.focus(), 30); return; }
  if (t.closest('[data-invitar]')) { invitar(); return; }
  if (t.closest('[data-salir]')) {
    askConfirm('¿Salir de la cuenta?', { ok: 'Salir', icon: 'logout' }).then((ok) => { if (ok) location.href = '/api/auth/logout'; });
    return;
  }
  const tp = t.closest('[data-theme-pick]');
  if (tp) { setTheme(tp.dataset.themePick); render(); return; }
  // Desde una ficha abierta, la otra ficha la reemplaza en la misma capa: "atrás" cierra.
  const prod = t.closest('[data-producto]');
  if (prod && prod.dataset.producto) { openProducto(prod.dataset.producto); return; }
  const tk = t.closest('[data-ticket]');
  if (tk) { openTicket(tk.dataset.ticket); return; }
  const mp = t.closest('[data-mapa-prod]');
  if (mp) { elegirProductoMapa(mp.dataset.mapaProd); return; }
  if (t.closest('[data-mapa-yo]')) { ubicarme(); return; }
  const vm = t.closest('[data-ver-mapa]');
  if (vm) { verEnMapa(vm.dataset.verMapa); return; }
  if (t.closest('[data-mapa-retry]')) { render(); return; }
  const le = t.closest('[data-lugar-edit]');
  if (le) { openLugarEdit(le.dataset.lugarEdit); return; }
  const cd = t.closest('[data-ciudad]');
  if (cd) { setCiudad(cd.dataset.ciudad); render(); return; }
  const lg = t.closest('[data-lugar]');
  if (lg) { openLugar(lg.dataset.lugar); return; }
  // El link a Gastienzos se abre solo (es un <a>); acá sólo se anota que se mandó.
  const gz = t.closest('[data-gz]');
  if (gz) { gzMarcar(gz.dataset.gz); setTimeout(repaintModal, 300); return; }
  const td = t.closest('[data-ticket-del]');
  if (td) { deleteTicket(td.dataset.ticketDel); return; }
  const pe = t.closest('[data-prod-edit]');
  if (pe) { openProductoEdit(pe.dataset.prodEdit); return; }
  const am = t.closest('[data-amigo]');
  if (am) { openAmigo(am.dataset.amigo); return; }
  const qa = t.closest('[data-quitar-amigo]');
  if (qa) { const id = qa.dataset.quitarAmigo; closeLayer(); setTimeout(() => quitarAmigo(id), 0); return; }
  // La carga de un ticket.
  if (t.closest('[data-foto-cam]')) { $('foto-cam').click(); return; }
  if (t.closest('[data-foto-gal]')) { $('foto-gal').click(); return; }
  const fx = t.closest('[data-foto-x]');
  if (fx) { carga.fotos.splice(Number(fx.dataset.fotoX), 1); repaintModal(); return; }
  if (t.closest('[data-leer]')) { leerFotos(); return; }
  if (t.closest('[data-cancelar-lectura]')) { carga.leyendo?.abort(); return; }
  // La revisión.
  const rv = t.closest('[data-rev]');
  if (rv) { editRenglon(Number(rv.dataset.rev)); return; }
  if (t.closest('[data-rev-lugar]')) { editLugar(); return; }
  const ff = t.closest('[data-fecha-fix]');
  if (ff && rev) { rev.fecha = ff.dataset.fechaFix; repaintModal(); return; }
  const dv = t.closest('[data-desc-vuelve]');
  if (dv) { volverAPoner(Number(dv.dataset.descVuelve)); return; }
  const gd = t.closest('[data-rev-guardar]');
  if (gd) { guardarRevision(gd); return; }
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'rev-fecha' && rev) { rev.fecha = e.target.value; repaintModal(); }
});

// ---------- Arranque ----------
async function reload() {
  const d = await apiFetch('/api/boot');
  setData(d);
  render();
}
function skeletonHtml() {
  return `<div class="loading"><div class="skel"><div class="skel__card"><i class="skel__lbl"></i>
    ${'<div class="skel__row"><i class="skel__ic"></i><div class="skel__lines"><i style="width:60%"></i><i class="skel__sub"></i></div><i class="skel__amt"></i></div>'.repeat(4)}
    </div></div><p class="loading__txt">Cargando…</p></div>`;
}
async function boot() {
  hydrateIcons();
  navHtml();
  $('shell').hidden = false;
  for (const id of ['tabbar', 'tabguard', 'fab']) $(id).hidden = false;
  $('view-inicio').hidden = false;
  $('view-inicio').innerHTML = skeletonHtml();
  let d;
  try {
    d = await apiFetch('/api/boot');
  } catch (e) {
    if (e.status === 401) return;
    $('view-inicio').innerHTML = `<div class="tcard">${emptyState('No pude cargar la app', e.message, [{ label: 'Reintentar', attr: 'data-reintentar' }])}</div>`;
    $('view-inicio').querySelector('[data-reintentar]')?.addEventListener('click', () => location.reload());
    return;
  }
  setData(d);
  state.ciudad = ciudadGuardada();
  document.querySelectorAll('.avatar-btn').forEach((b) => { b.innerHTML = avatarInner(state.user); });
  showView('inicio', { scroll: false });
  const amigo = new URLSearchParams(location.search).get('amigo');
  if (amigo) aceptarInvitacion(amigo);
  registerSW();
}

// ---------- Versión nueva ----------
// El SW nuevo queda en "waiting": se ofrece actualizar con un toast que no interrumpe.
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').then((reg) => {
    const offer = (w) => {
      if (!w || !navigator.serviceWorker.controller) return;
      toast('Hay una versión nueva de la app.', { action: 'Actualizar', duration: Infinity, close: true, onAction: () => w.postMessage({ type: 'SKIP_WAITING' }) });
    };
    if (reg.waiting) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed') offer(w); });
    });
  }).catch(() => { /* sin SW: la app anda igual */ });
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading) { reloading = true; location.reload(); } });
}

// El sistema de diseño (/design-system) carga este mismo archivo sin arrancar la app y
// pinta cada componente con su función de verdad (public/design-system/ds.js).
if (window.__DS__) {
  window.comparame = {
    state, setData, ic, fmtMoney, fmtFecha, cantLabel, ticketRowHtml, productoRowHtml, cambioRowHtml, revRowHtml,
    controlHtml, emptyState, whoChip, lugaresHtml, ciudadesHtml, sinDireccionHtml, setCiudad, openLugar, openLugarEdit, mapPinHtml, mapaRowHtml, toast, askConfirm, openSheet, medidaFieldsHtml, wireOptrail, hydrateIcons, gzBotonHtml,
    setRev: (r) => { rev = r; },
  };
} else {
  boot();
}
