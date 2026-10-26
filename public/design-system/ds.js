// Las muestras del sistema de diseño, pintadas por las funciones de app.js con datos de
// ejemplo. Al crear o cambiar un componente de la app, sumalo acá (nunca copies su HTML).
const c = window.comparame;
const $ = (id) => document.getElementById(id);
const hoy = new Date();
const dia = (n) => { const d = new Date(hoy); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// Datos de ejemplo: vos y Juli, Carrefour y Coto, unos productos.
c.setData({
  user: { id: 'yo', name: 'Ana Pérez', email: 'ana@ejemplo.com', picture: '' },
  amigos: [{ id: 'juli', name: 'Juli Gómez', email: 'juli@ejemplo.com', picture: '' }],
  lugares: [{ id: 'l1', cadena: 'Carrefour', sucursal: '', direccion: 'Av. Cabildo 2200' }, { id: 'l2', cadena: 'Coto', sucursal: 'Cabildo', direccion: 'Av. Cabildo 545' }],
  productos: [{ id: 'p1', nombre: 'Fideos tirabuzón sin TACC', marca: 'Matarazzo', medida: 500, medida_unidad: 'g' }, { id: 'p2', nombre: 'Banana', marca: '', medida: null, medida_unidad: '' }],
  tickets: [{ id: 't1', user_id: 'yo', lugar_id: 'l1', fecha: dia(1), pagado: 208263.5, n_renglones: 19 }, { id: 't2', user_id: 'juli', lugar_id: 'l2', fecha: dia(3), pagado: 45300, n_renglones: 4 }],
  precios: [
    { id: 'a', ticket_id: 't1', user_id: 'yo', lugar_id: 'l1', producto_id: 'p1', fecha: dia(1), cantidad: 6, unidad: 'u', precio_unit: 4999, precio_medida: 9998, pagado: 29994 },
    { id: 'b', ticket_id: 't2', user_id: 'juli', lugar_id: 'l2', producto_id: 'p1', fecha: dia(3), cantidad: 2, unidad: 'u', precio_unit: 4450, precio_medida: 8900, pagado: 8900 },
    { id: 'c', ticket_id: 't0', user_id: 'yo', lugar_id: 'l1', producto_id: 'p1', fecha: dia(20), cantidad: 1, unidad: 'u', precio_unit: 4500, precio_medida: 9000, pagado: 4500 },
    { id: 'd', ticket_id: 't1', user_id: 'yo', lugar_id: 'l1', producto_id: 'p2', fecha: dia(1), cantidad: 0.66, unidad: 'kg', precio_unit: 2299, precio_medida: 2299, pagado: 1517.34 },
  ],
  links: 0, lector: true,
});
const st = c.state;
const resumen = (pid) => {
  const prs = st.precios.filter((p) => p.producto_id === pid);
  const lugares = [...new Map(prs.sort((a, b) => (a.fecha < b.fecha ? 1 : -1)).map((p) => [p.lugar_id, p])).values()]
    .reverse().map((p) => ({ lugar_id: p.lugar_id, precio: p, fresco: true })).sort((a, b) => a.precio.precio_medida - b.precio.precio_medida);
  return { producto: st.productos.get(pid), lugares, mejor: lugares[0], ultimo: prs[0] };
};
const renglon = (x) => ({ k: 0, foto: 1, texto: 'FIDEOS S TACC TIRABUZON MATARAZZO X 500', cantidad: 6, unidad: 'u', precio_unitario: 4999, importe: 29994, descuento: 0,
  nombre: 'Fideos tirabuzón sin TACC', marca: 'Matarazzo', medida: 500, medida_unidad: 'g', producto: null, elegido: 'nuevo', sugeridos: [], ...x });

const TOKENS = ['--bg', '--card', '--card-deep', '--surface-high', '--text', '--muted', '--faint', '--accent', '--accent-ink', '--neg', '--outline', '--yellow'];
const sec = (titulo, texto, cuerpo) => `<section class="ds__sec"><h2>${titulo}</h2>${texto ? `<p>${texto}</p>` : ''}${cuerpo}</section>`;

function pintar() {
  c.setRev({ total: 36200, subtotal: null, ahorro: null, renglones: [renglon({ importe: 29994 }), renglon({ k: 1, importe: 6200, texto: 'BANANA X KG', cantidad: 0.66, unidad: 'kg', precio_unitario: 2299 })] });
  const controlOk = c.controlHtml();
  c.setRev({ total: 40000, renglones: [renglon({})] });
  const controlNo = c.controlHtml();
  c.setRev({ total: null, renglones: [renglon({})] });
  const controlSin = c.controlHtml();
  $('ds-body').innerHTML = [
    sec('Color', 'Roles al estilo Material 3, con su versión clara y oscura. El lima es el único acento; el coral, desaturado, marca lo que no da.',
      `<div class="ds__swatches">${TOKENS.map((t) => `<div class="ds__sw"><i style="background:var(${t})"></i><code>${t}</code></div>`).join('')}</div>`),
    sec('Tipografía', 'Una sola familia, Figtree, con los números en tabular-nums.',
      `<div class="tcard ds__type"><p style="font-size:var(--t-display-m);font-weight:800;letter-spacing:var(--tracking-tight)">$8.900</p><p style="font-size:var(--t-headline-s);font-weight:700">¿Dónde está más barato?</p><p style="font-size:var(--t-body-l)">Fideos tirabuzón sin TACC · 500 g</p><p class="lbl">Últimos tickets</p></div>`),
    sec('Un ticket', '<code>ticketRowHtml</code>: el lugar, quién lo cargó, cuántos productos y cuándo; a la derecha lo pagado.',
      `<div class="tcard ds__phone">${st.tickets.map(c.ticketRowHtml).join('')}</div>`),
    sec('Un producto', '<code>productoRowHtml</code>: dónde está más barato (sólo si hay con qué comparar) y el precio por kg, litro o unidad.',
      `<div class="tcard ds__phone">${c.productoRowHtml(resumen('p1'))}${c.productoRowHtml(resumen('p2'))}</div>`),
    sec('Lo que cambió', '<code>cambioRowHtml</code>: el último precio en un lugar contra el anterior en el mismo lugar.',
      `<div class="tcard ds__phone">${c.cambioRowHtml({ ultimo: st.precios[0], antes: st.precios[2], pct: 0.111 })}</div>`),
    sec('La revisión de un ticket', 'Cada renglón leído (<code>revRowHtml</code>): reconocido, nuevo, con una sugerencia o que no cierra.',
      `<div class="tcard ds__phone">${[
        c.revRowHtml(renglon({ producto: st.productos.get('p1'), elegido: 'existe', via: 'alias' })),
        c.revRowHtml(renglon({ k: 1, sugeridos: [st.productos.get('p1')] })),
        c.revRowHtml(renglon({ k: 2, texto: 'CAFE NESCAFE GOLD', nombre: 'Café instantáneo', marca: 'Nescafé', medida: null, cantidad: 2, precio_unitario: 22479, importe: 44958, descuento: 11239.5 })),
        c.revRowHtml(renglon({ k: 3, cantidad: 1, no_cierra: true })),
      ].join('')}</div>`),
    sec('El control contra el total', '<code>controlHtml</code>: lima si la suma da el total del ticket, coral si no, gris si no se encontró el total.',
      `<div class="ds__phone">${controlOk}${controlNo}${controlSin}</div>`),
    sec('Chips', 'Atributos de una fila. El más barato va tonal (el lima lleno es de las acciones).',
      `<div class="tcard"><div class="movchips" style="justify-content:flex-start;flex-wrap:wrap"><span class="chip chip--best">Más barato en Coto</span><span class="chip">2 lugares</span><span class="chip chip--warn">¿Ya existe?</span><span class="chip chip--neg">No cierra</span>${c.whoChip('juli')}<span class="trendpill trendpill--neg">+11%</span><span class="trendpill trendpill--pos">−8%</span></div></div>`),
    sec('Botones', 'La píldora lima a lo ancho para la acción principal; tonal para lo secundario.',
      `<div class="tcard ds__phone" style="display:flex;flex-direction:column;gap:12px"><button type="button" class="mvf__submit">Guardar el ticket</button><button type="button" class="set__btn">${c.ic('edit', 18)} Corregir el producto</button><div class="dangerfoot"><button type="button" class="dangerfoot__btn">Borrar este ticket</button></div></div>`),
    sec('Las fotos de un ticket', 'Numeradas en orden, con su ✕, y los botones punteados para sumar otra.',
      `<div class="ds__phone"><div class="fotos" style="margin-bottom:0"><figure class="fotos__item"><figcaption>1</figcaption></figure><figure class="fotos__item"><figcaption>2</figcaption></figure><button type="button" class="fotos__add">${c.ic('camera', 28)}<span>Otra foto</span></button></div></div>`),
    sec('La medida de un producto', '<code>medidaFieldsHtml</code>: el número y la unidad en un riel de opciones.',
      `<div class="tcard ds__phone"><div class="accf">${c.medidaFieldsHtml('ds', 1000, 'g')}</div></div>`),
    sec('Vacío', '<code>emptyState</code>: qué falta y la acción para empezar.',
      `<div class="tcard ds__phone">${c.emptyState('Cargá tu primer ticket', 'Sacale una foto y la app lee cada producto con su precio.', [{ label: 'Sacar una foto', attr: '' }])}</div>`),
    sec('Avisos', 'Un solo toast para toda la app.',
      `<div style="display:flex;gap:10px;flex-wrap:wrap"><button type="button" class="set__btn" id="ds-toast">Ticket guardado</button><button type="button" class="set__btn" id="ds-toast-err">Un error</button><button type="button" class="set__btn" id="ds-confirm">Un diálogo</button></div>`),
  ].join('');
  c.wireOptrail($('ds-body'));
  $('ds-toast').onclick = () => c.toast('19 productos de Carrefour', { lead: 'Ticket guardado', icon: 'ok' });
  $('ds-toast-err').onclick = () => c.toast('No pude leer el ticket. Probá de nuevo.', { icon: 'error', action: 'Probar de nuevo' });
  $('ds-confirm').onclick = () => c.askConfirm('¿Borrar este ticket?', { text: 'Se borran sus precios para vos y tus amigos.', ok: 'Borrar', danger: true });
}
$('ds-theme').addEventListener('click', (e) => {
  const b = e.target.closest('[data-t]'); if (!b) return;
  if (b.dataset.t) document.documentElement.dataset.theme = b.dataset.t; else delete document.documentElement.dataset.theme;
  $('ds-theme').querySelectorAll('.choice__opt').forEach((o) => { o.classList.toggle('active', o === b); o.setAttribute('aria-pressed', String(o === b)); });
});
pintar();
