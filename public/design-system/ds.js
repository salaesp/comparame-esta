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
  lugares: [{ id: 'l1', cadena: 'Carrefour', sucursal: '', direccion: 'Av. Cabildo 2200', ciudad: 'CABA', lat: -34.561085, lon: -58.457507, geo_at: '2026-10-26' }, { id: 'l2', cadena: 'Coto', sucursal: 'Cabildo', direccion: 'Av. Cabildo 545', ciudad: 'CABA' },
    { id: 'l3', cadena: 'Carrefour', sucursal: '', direccion: '', ciudad: 'Rosario', punto_venta: '8188' }],
  productos: [{ id: 'p1', nombre: 'Fideos tirabuzón sin TACC', marca: 'Matarazzo', medida: 500, medida_unidad: 'g', ean: '7790070336224', foto: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="white"/><rect x="12" y="6" width="16" height="28" rx="3" fill="#e8b33c"/><rect x="12" y="14" width="16" height="8" fill="#2b5fa8"/></svg>') }, { id: 'p2', nombre: 'Banana', marca: '', medida: null, medida_unidad: '' }],
  tickets: [{ id: 't1', user_id: 'yo', lugar_id: 'l1', fecha: dia(1), pagado: 208263.5, n_renglones: 19 }, { id: 't2', user_id: 'juli', lugar_id: 'l2', fecha: dia(3), pagado: 45300, n_renglones: 4 }, { id: 't3', user_id: 'yo', lugar_id: 'l3', fecha: dia(9), pagado: 12800, n_renglones: 3 }],
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
    sec('Un producto', '<code>productoRowHtml</code>: dónde está más barato (sólo si hay con qué comparar) y el precio por kg, litro o unidad. Con la foto de las webs de los súper (<code>prodIcHtml</code>, la de un producto con código que se buscó online), en lugar del ícono.',
      `<div class="tcard ds__phone">${c.productoRowHtml(resumen('p1'))}${c.productoRowHtml(resumen('p2'))}</div>`),
    sec('Lugares', '<code>lugaresHtml</code>: cada lugar con dónde queda (<code>lugarDonde</code>: la dirección y la ciudad; sin dirección, su punto de venta). Con lugares de más de una ciudad, arriba el filtro (<code>ciudadesHtml</code>): la elegida tonal con aro.',
      `<div class="ds__phone" style="display:flex;flex-direction:column;gap:14px">${c.lugaresHtml()}</div>`),
    sec('Es el mismo que otro', '<code>lugarJuntarHtml</code>: desde la ficha de un lugar, los otros lugares (primero los de la misma cadena) para elegir cuál es el mismo local; tocar uno los junta (<code>POST /api/lugares/:id/juntar</code>).',
      `<div class="ds__phone" style="display:flex;flex-direction:column;gap:14px">${c.lugarJuntarHtml('l3')}</div>`),
    sec('El mapa', 'Los puntos de la pantalla Mapa (<code>mapPinHtml</code>): la inicial del lugar en su color; buscando productos (uno o varios: «Todos los de agua»), el precio del más barato de ellos en cada lugar (el más barato tonal con aro, uno de hace más de 30 días apagado). Arriba, los productos elegidos (<code>mapaProdsHtml</code>, tocar uno lo saca). Debajo del mapa, la misma lista (<code>mapaRowHtml</code>), con la distancia si se sabe dónde estás y, con varios productos, cuál es.',
      `<div class="tcard ds__phone"><div class="ds__pins">${[
        [14, { l: st.lugares.get('l1') }], [34, { l: st.lugares.get('l2') }],
        [56, { l: st.lugares.get('l2'), precio: st.precios[1], fresco: true }, true], [78, { l: st.lugares.get('l1'), precio: st.precios[0], fresco: true }],
      ].map(([x, pt, mejor]) => `<span style="position:absolute;left:${x}%;top:50%">${c.mapPinHtml(pt, { mejor })}</span>`).join('')}</div>
      ${c.mapaProdsHtml(['p1', 'p2'])}
      ${c.mapaRowHtml({ l: st.lugares.get('l2'), precio: st.precios[1], fresco: true, dist: 1400 }, { mejor: true, conProd: true })}${c.mapaRowHtml({ l: st.lugares.get('l1'), precio: st.precios[0], fresco: true, dist: 600 })}</div>`),
    sec('Buscar el local', 'En la revisión, en la ficha del lugar y al cambiar el lugar de un ticket (<code>lugarFormHtml</code>), el local se busca como en Google Maps (<code>localBuscadorHtml</code> + <code>wireLocalBuscador</code>): sólo el buscador y el mapa. Los locales encontrados son puntos (<code>localPinHtml</code>, el elegido tonal con aro); al tocar uno se completan la dirección, la ciudad y su punto, y debajo del mapa queda cuál es (<code>localSelHtml</code>). Si no aparece, «Escribí la dirección» abre los campos.',
      `<div class="tcard ds__phone"><div class="ds__pins">${[[20, true], [45], [70]].map(([x, on]) => `<span style="position:absolute;left:${x}%;top:50%">${c.localPinHtml({ elegido: on })}</span>`).join('')}</div>
      ${c.localSelHtml({ nombre: 'Carrefour Market', direccion: 'Avenida Cabildo 2441', ciudad: 'CABA', lat: -34.5586, lon: -58.4593 })}
      ${c.localSelHtml(null, 'Tocá tu local en el mapa.')}</div>`),
    sec('En las webs de los súper', '<code>onlineRowHtml</code>: en la ficha de un producto con código de barras, el precio de la web de cada cadena (consultado en el momento, <code>lib/online.mjs</code>): el tachado, la promo para todos, si no hay stock (apagado) y cuándo lo mostró la web. Tocarlo abre el producto en su web (el ícono de «abrir afuera» al lado de la cadena lo dice: sirve para mostrarlo en la góndola). Mientras se les pregunta a las que no se consultaron hace poco, <code>onlineBuscandoHtml</code>.',
      `<div class="tcard ds__phone">${[
        { cadena: 'Carrefour', url: 'https://www.carrefour.com.ar/', unidad: 'u', precio: 3999, precio_lista: 5699, precio_medida: 7998, promos: '', disponible: 1, visto_at: new Date().toISOString() },
        { cadena: 'Jumbo', url: 'https://www.jumbo.com.ar/', unidad: 'u', precio: 4450, precio_lista: null, precio_medida: 8900, promos: '2do al 70%', disponible: 0, visto_at: new Date(Date.now() - 3 * 864e5).toISOString() },
      ].map((o) => c.onlineRowHtml(o, st.productos.get('p1'))).join('')}${c.onlineBuscandoHtml(['Vea', 'ChangoMás', 'DIA'])}</div>`),
    sec('¿Es alguno de estos?', 'Un producto sin código de barras, en su ficha (<code>parecidosHtml</code>): se lo busca solo por el nombre en las webs (el server guarda lo encontrado una semana; lo que va por peso no se busca) y se ofrecen los parecidos de la misma marca y medida (<code>parecidoRowHtml</code>, con su foto y dónde hay stock). Elegir uno le pone su código y desde ahí se compara solo; «No es ninguno» no lo vuelve a ofrecer en ese teléfono. Sin nada parecido, no se muestra.',
      `<div class="tcard ds__phone">${c.parecidosHtml('buscando')}</div><div class="tcard ds__phone" style="margin-top:12px">${c.parecidosHtml([
        { ean: '7793704000928', nombre: 'Yerba mate Playadito suave con palo 1 kg.', medida: 1000, medida_unidad: 'g', imagen: '', cadenas: ['Carrefour', 'Jumbo', 'Disco', 'Vea', 'ChangoMás', 'DIA'] },
        { ean: '7793704000010', nombre: 'Yerba Playadito Suave 1 Kg', medida: 1000, medida_unidad: 'g', imagen: '', cadenas: [] },
      ])}</div>`),
    sec('Buscar en las webs', 'En el buscador de Productos, debajo de los tuyos (<code>webBusquedaHtml</code>): cuando dejás de escribir se busca en las webs de los súper, un producto por código (<code>webRowHtml</code>: su foto, la medida, en cuántas webs hay stock y desde cuánto). Tocarlo abre su ficha: la tuya si ya lo cargaste; si no, la de la web.',
      `<div class="ds__phone">${c.webBusquedaHtml('buscando', 'yerba playadito')}${c.webBusquedaHtml([
        { ean: '7793704000928', nombre: 'Yerba mate Playadito suave con palo 1 kg.', medida: 1000, medida_unidad: 'g', imagen: '', desde: 5190, cadenas: 6, ofertas: [{ cadena: 'Vea' }] },
        { ean: '7793704000010', nombre: 'Yerba mate Playadito con palo 500 g.', medida: 500, medida_unidad: 'g', imagen: '', desde: 2690, cadenas: 1, ofertas: [{ cadena: 'DIA' }] },
        { ean: '7793704000034', nombre: 'Yerba mate Playadito lata 500 g.', medida: 500, medida_unidad: 'g', imagen: '', desde: null, cadenas: 0, ofertas: [] },
      ])}</div>`),
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
    sec('Falta la dirección', '<code>sinDireccionHtml</code>: en la revisión, cuando el ticket no trae la dirección del local; con el punto de venta, dice que lo reconoce por él.',
      `<div class="ds__phone">${c.sinDireccionHtml({ cadena: 'Carrefour', direccion: '', punto_venta: '8188' })}</div>`),
    sec('Chips', 'Atributos de una fila. El más barato va tonal (el lima lleno es de las acciones).',
      `<div class="tcard"><div class="movchips" style="justify-content:flex-start;flex-wrap:wrap"><span class="chip chip--best">Más barato en Coto</span><span class="chip">2 lugares</span><span class="chip chip--warn">¿Ya existe?</span><span class="chip chip--neg">No cierra</span>${c.whoChip('juli')}<span class="trendpill trendpill--neg">+11%</span><span class="trendpill trendpill--pos">−8%</span></div></div>`),
    sec('Botones', 'La píldora lima a lo ancho para la acción principal; tonal para lo secundario (también el link «Mandar a Gastienzos» de un ticket tuyo, <code>gzBotonHtml</code>).',
      `<div class="tcard ds__phone" style="display:flex;flex-direction:column;gap:12px"><button type="button" class="mvf__submit">Guardar el ticket</button><button type="button" class="set__btn">${c.ic('edit', 18)} Corregir el producto</button>${c.gzBotonHtml(st.tickets[0])}<div class="dangerfoot"><button type="button" class="dangerfoot__btn">Borrar este ticket</button></div></div>`),
    sec('Las fotos de un ticket', 'Numeradas en orden, con su ✕, y el botón punteado para sumar otra parte. Un PDF va con su ícono.',
      `<div class="ds__phone"><div class="fotos" style="margin-bottom:0"><figure class="fotos__item"><figcaption>1</figcaption></figure><figure class="fotos__item"><figcaption>2</figcaption></figure>${c.fotoItemHtml('data:application/pdf;base64,', 2)}${c.fotosAddHtml(3)}</div></div>`),
    sec('Nuevo ticket, vacío', 'Un solo botón: el teléfono ofrece la cámara, la galería o los archivos. En la compu, también arrastrar.',
      `<div class="ds__phone"><div class="fotos" style="margin-bottom:0">${c.fotosAddHtml(0)}</div></div>`),
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
