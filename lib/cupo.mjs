// Cupo de la app, como en Gastienzos: entra cualquiera con Google hasta MAX_USERS
// personas (variable del Worker, default 50; se cambia sin deploy). Quien ya tiene
// cuenta entra siempre, y los emails de allowed_emails pasan aunque esté llena. Con la
// app llena el email queda en lista_espera; al subir el tope, esa persona entra con el
// mismo email y sale de la lista.
export const MAX_USERS_DEFAULT = 50;

export function maxUsers(env = process.env) {
  const n = parseInt(env.MAX_USERS, 10);
  return n > 0 ? n : MAX_USERS_DEFAULT;
}

// Un solo batch atómico: el alta (o el refresco de nombre y foto de quien ya está)
// sólo corre si hay lugar, así dos altas a la par no pasan el tope. Devuelve
// { user } o { lleno: true }.
export async function admitir(txBatch, { email, name = '', picture = '' }, max = maxUsers()) {
  const [users] = await txBatch([
    [`insert into users (email, name, picture, last_login_at)
        select ?1, ?2, ?3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         where exists (select 1 from users where email = ?1)
            or exists (select 1 from allowed_emails where lower(email) = ?1)
            or (select count(*) from users) < ?4
      on conflict (email) do update
        set name = excluded.name, picture = excluded.picture, last_login_at = excluded.last_login_at
      returning id, email`,
    [email, name, picture, max]],
    [`insert into lista_espera (email, name)
        select ?1, ?2 where not exists (select 1 from users where email = ?1)
      on conflict (email) do update set name = excluded.name, last_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    [email, name]],
    ['delete from lista_espera where email = ?1 and exists (select 1 from users where email = ?1)', [email]],
  ]);
  return users[0] ? { user: users[0] } : { lleno: true };
}
