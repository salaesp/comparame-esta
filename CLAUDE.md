# comparame-esta

Comparar precios entre lugares a partir de las fotos de los tickets, compartiendo los precios
con amigos. Diseño y decisiones en `docs/diseno.md`; cómo ponerla en marcha en `docs/setup.md`.
Toda la UI y los textos van en castellano rioplatense.

## Qué hace

- **Login con Google** (cliente OAuth propio de esta app), con un **cupo** de `MAX_USERS` (50)
  personas, como Gastienzos (`lib/cupo.mjs`: `allowed_emails` pasan siempre, el resto a
  `lista_espera`).
- **Cargar un ticket**: el "+" (cámara) abre "Nuevo ticket"; se sacan una o varias fotos (hasta
  `FOTOS_MAX`, 6) o se eligen de la galería, se achican en el teléfono (1600 px, JPEG 0,8) y van
  **todas juntas en un solo pedido** a `POST /api/tickets/leer`, que las manda a **Claude**
  (`lib/lector.mjs`, SDK `@anthropic-ai/sdk`, structured outputs con `RESPUESTA_SCHEMA`). La consigna
  dice que son partes seguidas de un mismo ticket y que el principio de una foto puede repetir el
  final de la anterior: cada producto va una vez y lo repetido va en `descartados` (motivo
  `repetido`), igual que el bloque de descuentos del pie (`informativo`) y lo que no es un producto.
  Los descuentos de un producto van en su `descuento`; `importe` es lo impreso.
- **La revisión** (nada se guarda antes): el lugar, la fecha, el **control contra el total**
  (`controlTotal` en `lib/ticket.mjs`, la misma cuenta en `controlRev` del cliente: contra el total;
  sin total, contra subtotal − ahorro; con sólo subtotal, lo impreso) y cada renglón con su producto:
  **reconocido** (por el alias de la cadena o el EAN), **sugerido** ("¿Ya existe?", `candidatos` de
  `lib/productos.mjs`: palabras en común, misma marca y misma medida) o **nuevo**. Nunca se junta
  solo un producto de otro lugar: se elige en la hoja del renglón. Los repetidos se pueden "Volver a
  poner". `POST /api/tickets` guarda (`guardarStmts` en `lib/catalogo.mjs`, un batch).
- **Comparar**: Productos (buscador + lista con "Más barato en X" sólo si hay más de un lugar), la
  ficha de un producto ("¿Dónde está más barato?": el último precio de cada lugar, del más barato al
  más caro; los de más de `FRESCO_DIAS` (30) días, grises), Lugares y la ficha de un ticket. Se
  compara por **kg, litro o unidad de la medida** (`precio_medida`) cuando se sabe; si no, por unidad.
- **Los lugares** (`lib/catalogo.mjs` `buscarLugar`/`completarLugarStmts`): Claude copia la ciudad y
  el punto de venta (la parte de adelante del número de factura); un ticket se reconoce por la
  dirección y, sin ella, por el punto de venta (una sucursal puede tener varios, uno por caja: se
  suman todos), y cada ticket le completa al lugar lo que no tenga. Sin dirección, la revisión avisa
  (`sinDireccionHtml`). La ficha del lugar la corrige (`PATCH /api/lugares/:id`, quien lo creó o
  cargó ahí): con una dirección que ya es de otro, contesta 409 con `otro` y con `juntar` pasa sus
  tickets, precios y claves a ése. Con lugares de más de una ciudad, Productos y Lugares se filtran
  por una (`ciudadesHtml`, `localStorage['cmp:ciudad']`; la ficha del producto pone las otras al
  pie). La ciudad se escribe de una forma (`ciudadLimpia`: "Capital Federal" es CABA).
- **El punto en el mapa** (`lib/geo.mjs`): la dirección y la ciudad pasan por **Georef**
  (apis.datos.gob.ar/georef, la API de direcciones del gobierno: gratis, sin key, sólo Argentina)
  y se guardan `lat`/`lon` en el lugar. Mejor ningún punto que uno mal: sólo si Georef da una
  dirección (o varias a menos de `GEO_CERCA_M`, 300 m); con la ciudad pregunta en esa localidad y,
  si no está, en todo el país quedándose con las de esa ciudad. Se busca una vez por dirección
  (`geo_at`; lat null = no se encontró), vuelve a buscarse si cambian la dirección o la ciudad, y
  si Georef no contesta queda para el próximo `/api/boot` (`ubicarLugares`, en segundo plano con
  `ctx.waitUntil`; al guardar un ticket también, y al corregir el lugar antes de contestar). La
  ficha del lugar lleva "Ver en el mapa" (OpenStreetMap). Tests en `test/geo.test.mjs` (los tests
  nunca salen a Georef: `setGeoFetch`).
- **Mandar a Gastienzos**: en la ficha de un ticket propio (`gzBotonHtml`) y como acción del toast al
  guardarlo, un link a `https://gastienzos.com.ar/app?add=1&monto=&titulo=&fecha=` (`gastienzosUrl`:
  lo pagado, la cadena, la fecha) que abre el alta de Gastienzos completada (allá lo lee
  `parseLaunchPrefill`); se elige cómo se pagó y se guarda allá. Las cuentas no se conectan. El
  teléfono recuerda cuáles mandaste (`localStorage['cmp:gastienzos']`). Tests en `test/gastienzos.test.mjs`.
- **Amigos por link** (`/?amigo=amg_…`, sirve una vez y vence a los 7 días, `LINKS_MAX` 5 vivos).
  Un amigo ve **todos** tus precios y vos los suyos; la amistad no se hereda.

## Los datos (`lib/schema.mjs`)

- **El catálogo es de todos**: `lugares` (una sucursal, con `ciudad` y `punto_venta` aparte de la
  dirección), `lugar_claves` (todas las claves de cada lugar, `lugarKeys` de `lib/productos.mjs`:
  CUIT —o, sin él, la cadena— + la dirección y + cada punto de venta que apareció; sin ninguno de
  los dos, la cadena entera; la ciudad no entra), `productos` (nombre, marca, medida en g/ml/u, EAN) y `alias` (cómo escribe cada
  cadena un producto: `cadena_key` + `texto_key` → producto; lo último que se confirmó gana).
- **Lo de cada uno**: `tickets` y `precios` (un renglón: cantidad, unidad u/kg, `precio_lista`,
  `importe`, `descuento`, `pagado`, `precio_unit`, `precio_medida`). Los ve quien los cargó y sus
  amigos: `visibles()` de `lib/amigos.mjs` en cada consulta.
- `lecturas`: cada lectura con Claude, con tokens, costo (`costoUsd`) y tiempo. No se muestra.
- Las fotos **no se guardan**.

## Claude

`lectorConfig()`: el modelo sale de `LECTOR_MODELO` (default `claude-haiku-5-5`; también
`claude-sonnet-5-5` y `claude-opus-5-5`) y el esfuerzo de `LECTOR_ESFUERZO` (default `low`), sin
deploy. Se eligió midiendo (docs/diseno.md): los tres leen bien Carrefour y Nini, y Haiku bajo cuesta
~US$ 0,005 por ticket contra 0,05 de Sonnet y 0,10 de Opus. El modelo sólo COPIA lo impreso (números,
% de IVA, títulos de columnas): las cuentas las hace `limpiarRespuesta` (sumar el IVA de una factura
sin IVA —se reconoce también por una columna "PRECIO SIN I.V.A."—, corregir la cantidad que no cierra
con el importe) y el control de una factura sin IVA va contra su subtotal sin IVA. Opus y Sonnet van con `fallbacks: 'default'` (beta `server-side-fallback-2026-07-01`):
si un clasificador rechaza por error, la API reintenta con otro modelo. Un rechazo, una respuesta
cortada o rota se contestan con su `motivo` (422). La elección del modelo se hace midiendo con
`scripts/medir-modelos.mjs` (fotos reales + `verdad.json`). La key es el secret `ANTHROPIC_API_KEY`.

## Arquitectura

Igual que Gastienzos, sin la herencia de Netlify: un **Worker de Cloudflare** (`worker/index.js`)
rutea `/api/*` a los handlers de `api/` (`(Request) → Response`, cada uno con su
`export const config = { path }`), la lógica pura vive en `lib/` y `public/` se sirve como assets.
**D1** (`lib/db.mjs`: `sql`, `txBatch`; SQLite directo con `?1`), el schema se aplica solo (hash en
`schema_meta`, la guarda viaja en el primer batch). Una columna nueva en una tabla que ya existe va
en su create table y también en `MIGRATIONS` (las ALTER que faltan corren con la versión). `/api/boot` trae todo lo de los últimos
`BOOT_DIAS` (180) días y las pantallas se arman en memoria; la ficha de un producto pide su
historial entero.

```
public/   index.html (la app en "/"), app.js, styles.css (la capa genérica de "Suave"),
          app.css (lo propio), sw.js, manifest, novedades.json, design-system/
api/      auth-login, auth-callback, auth-logout, boot, amigos, tickets, productos, lugares
lib/      http, db, schema, auth, cupo, amigos, lector, ticket, productos, catalogo, geo
scripts/  bump-ui-version.mjs, medir-modelos.mjs
test/     node --test; los de server contra SQLite real (test/helpers/d1.mjs)
```

## Sistema visual

El de Gastienzos ("Suave"): dark bento, un solo acento lima, Figtree, tarjetas sin borde, radios
grandes, claro/oscuro (sigue al sistema; Ajustes ▸ Apariencia lo fija en
`localStorage['cmp:theme']`). `public/styles.css` es su **capa genérica**, copiada de
`gastos-app/public/styles.css` (tokens, shell mobile con header por vista + tab bar + FAB, rail en
la compu, `.mrow.txrow`, modal/hoja `.catpick`, toast, diálogos `.cdlg`, Ajustes, la capa M3); lo
propio va en `public/app.css`. Reglas: todo por token (nada de hex fuera de `:root`), sin `font-size`
en px, lo elegido nunca en lima lleno (el lima lleno es de las acciones: el "más barato" es
`.chip--best`, tonal), los colores de una persona o un lugar pasan por `fillOf`/`inkOf`.

**El sistema de diseño está publicado en `/design-system`**: carga el mismo `app.js` con
`window.__DS__` (no arranca y deja sus funciones en `window.comparame`) y `ds.js` pinta cada
componente con su función real y datos de ejemplo. **Al crear o cambiar un componente, sumalo a
`public/design-system/ds.js`** (nunca copies su HTML).

## Convenciones

- **Novedad obligatoria**: todo commit que toca `public/` (salvo `novedades.json`) necesita arriba de
  `public/novedades.json` una entrada pendiente `{ "version": "next", "fecha": "", "notas": [...] }`
  (`next` = patch, `next:minor`, `next:major`). Lo exige el pre-commit (`.githooks/pre-commit`,
  `npm run hooks` una vez por clon). Notas cortas, para quien usa la app.
- **VERSION** (semver) en `public/sw.js` y los `?v=` de `index.html`. **Los cambios van directo a
  `main`** (no hay `pre-release`: ese flujo es de Gastienzos) y Cloudflare despliega cada push a
  `main`; por eso, en `main`, el pre-commit **numera la versión en el mismo commit** (junta las
  pendientes con su nivel). En otra rama sólo exige la novedad; `npm run bump -- patch|minor|major`
  la numera a mano. `test/version.test.mjs` verifica que todo esté sincronizado. Un SW nuevo queda en
  waiting y la app ofrece "Actualizar" en un toast.
- **Fechas**: el día del ticket es el de la zona del teléfono (`hoyIso()`, nunca
  `toISOString().slice(0, 10)`).
- `askConfirm` sólo para lo irreversible (borrar un ticket, quitar un amigo, guardar con la suma que
  no da).
- Tests: `npm test`. Un cambio de server lleva su test contra SQLite real (`test/flujo.test.mjs`).
