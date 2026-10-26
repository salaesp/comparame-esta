# Cómo ponerla en marcha

La app es un Worker de Cloudflare con assets estáticos y una base D1, como Gastienzos. No
hay build: se despliega el repo tal cual.

## 1. La base

```sh
npx wrangler d1 create comparame-db
```

Copiá el `database_id` que devuelve en `wrangler.toml` (reemplaza a
`REEMPLAZAR-CON-EL-ID-DE-wrangler-d1-create`). Las tablas se crean solas en el primer pedido
(`lib/db.mjs`).

## 2. El login con Google

En Google Cloud Console ▸ APIs y servicios ▸ Credenciales ▸ Crear credenciales ▸ ID de cliente
de OAuth (tipo "Aplicación web"):

- **Orígenes de JavaScript autorizados:** `https://comparame-esta.<tu-subdominio>.workers.dev`
- **URI de redireccionamiento autorizados:** `https://comparame-esta.<tu-subdominio>.workers.dev/api/auth/callback`

(Para probar en local, sumá también `http://localhost:8787` y `http://localhost:8787/api/auth/callback`.)

## 3. Los secrets del Worker

```sh
npx wrangler secret put SESSION_SECRET        # 32+ caracteres al azar: openssl rand -base64 32
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put OAUTH_REDIRECT_URI    # la URI de redireccionamiento de arriba, exacta
npx wrangler secret put ANTHROPIC_API_KEY     # la key de console.anthropic.com
```

Opcionales (variables del Worker; se cambian desde el panel sin deploy):

| Variable | Para qué | Default |
|---|---|---|
| `MAX_USERS` | Cuántas personas pueden entrar | 50 |
| `ALLOWED_EMAILS` | Emails que entran aunque esté llena, separados por coma | — |
| `LECTOR_MODELO` | `claude-opus-5-5`, `claude-sonnet-5-5` o `claude-haiku-5-5` | `claude-opus-5-5` |
| `LECTOR_ESFUERZO` | `low`, `medium` o `high` | `medium` |
| `ANTHROPIC_BASE_URL_LECTOR` | Otra URL para la API de Anthropic (por ejemplo, la de Cloudflare AI Gateway) | `https://api.anthropic.com` |

## 4. Desplegar

Desde el panel de Cloudflare (Workers & Pages ▸ Crear ▸ Importar un repositorio) conectando
`salaesp/comparame-esta`, o a mano:

```sh
npm run deploy
```

## Probar en local

`npm run preview` (= `wrangler dev`, en `localhost:8787`) corre el Worker con una D1 local. Los
secrets van en `.dev.vars` (no se sube al repo):

```
SESSION_SECRET=algo-largo-para-local
GOOGLE_CLIENT_ID=…
GOOGLE_CLIENT_SECRET=…
ANTHROPIC_API_KEY=…
```

## Medir los modelos

Con fotos de un ticket en una carpeta (en orden: `1.jpg`, `2.jpg`…) y, si se puede, un
`verdad.json` con lo que dice el ticket pasado a mano:

```sh
ANTHROPIC_API_KEY=… npm run medir -- <carpeta> --modelos opus,sonnet,haiku --esfuerzos low,medium
```

Dice por modelo cuánto tardó, cuánto costó, cuántos importes y cantidades leyó bien y si la
suma da lo pagado. Gasta tokens de verdad.
