// Quién ve qué. Un amigo ve TODOS tus precios (si es tu amigo es porque querés
// compartirlos) y vos los suyos. La amistad no se hereda: el amigo de un amigo no ve
// nada tuyo. El catálogo (productos, lugares, alias) es de todos.

// Los ids que ve el usuario del parámetro `p` ('?1', '?2'…): él y sus amigos. Para usar
// adentro de un `in (…)`.
export const visibles = (p = '?1') => `(select ${p} union all select user_b from amistades where user_a = ${p}
  union all select user_a from amistades where user_b = ${p})`;

// El par ordenado como se guarda en amistades (user_a < user_b).
export const par = (a, b) => (a < b ? [a, b] : [b, a]);

// Cuánto vale un link y cuántos puede tener vivos una persona a la vez.
export const LINK_DIAS = 7;
export const LINKS_MAX = 5;
