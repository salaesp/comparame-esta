// Quién ve qué. Un amigo ve TODOS tus precios de productos (si es tu amigo es porque querés
// compartirlos) y vos los suyos, pero NO los tickets: ni el ticket, ni lo pagado, ni qué más
// se compró con eso. Los tickets los ve sólo quien los cargó. La amistad no se hereda: el amigo de un amigo no ve
// nada tuyo. El catálogo (productos, lugares, alias) es de todos.

// Los ids que ve el usuario del parámetro `p` ('?1', '?2'…): él y sus amigos. Para usar
// adentro de un `in (…)`.
export const visibles = (p = '?1') => `(select ${p} union all select user_b from amistades where user_a = ${p}
  union all select user_a from amistades where user_b = ${p})`;

// Las columnas de `precios` que ve el usuario `p`: de los suyos, todo; de los de un amigo, lo
// que hace falta para comparar el precio (sin el ticket, el orden, la cantidad ni lo pagado).
// `t` es el alias de la tabla ('' o 'pr.').
export const PRECIOS_COLS = (p = '?1', t = '') => {
  const mio = (c) => `case when ${t}user_id = ${p} then ${t}${c} end as ${c}`;
  return [`${t}id`, mio('ticket_id'), `${t}user_id`, `${t}lugar_id`, `${t}producto_id`, `${t}fecha`, mio('orden'),
    `${t}texto`, mio('cantidad'), `${t}unidad`, `${t}precio_lista`, mio('importe'), `${t}descuento`, mio('pagado'),
    `${t}precio_unit`, `${t}precio_medida`].join(', ');
};

// El par ordenado como se guarda en amistades (user_a < user_b).
export const par = (a, b) => (a < b ? [a, b] : [b, a]);

// Cuánto vale un link y cuántos puede tener vivos una persona a la vez.
export const LINK_DIAS = 7;
export const LINKS_MAX = 5;
