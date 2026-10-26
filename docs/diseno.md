# Comparame esta: diseño de la primera versión

> Estado: **borrador para revisar**. Todavía no hay código. Lo marcado con **❓** está
> sin decidir y espera una respuesta antes de escribirse.

## El pedido

Una app para comparar precios entre lugares. Le sacás fotos a un ticket y la app lee los
productos con su precio; tus amigos ven tus precios y vos los de ellos, así entre todos
saben dónde sale más barata cada cosa.

- Login con Google (cliente OAuth nuevo, propio de esta app).
- Fotos leídas por la IA de Anthropic (Claude), con la API key del Worker.
- Un ticket puede necesitar varias fotos, y una foto puede repetir los últimos renglones de
  la anterior.
- Amigos por link de invitación. Un amigo ve **todos** tus precios: si es tu amigo es porque
  querés compartirlos.
- El mismo design system de Gastienzos ("Suave").

Se toma de referencia el módulo Precios que tuvo gastos-app y se sacó (commit `478996f` de
gastos-app; su diseño estaba en `docs/diseno-precios.md` y lo que se midió de cada modelo en
`docs/analisis-lectura-facturas.md`). Lo que se aprendió ahí y se conserva:

- Lo leído **nunca se guarda solo**: siempre pasa por una pantalla de revisión.
- El **control contra el total** del ticket es lo que detecta una lectura mala.
- Los renglones repetidos en el borde de dos fotos son el error más común con varias fotos.
- Los descuentos van restados al producto del que hablan, no como un renglón suelto.
- **Nunca se juntan solos** dos productos de lugares distintos: la app sugiere y la persona
  confirma.

## La base técnica (igual que Gastienzos)

- **Un Worker de Cloudflare + D1 + static assets**, sin framework ni build step, instalable
  como PWA. Proyecto nuevo en la misma cuenta de Cloudflare.
- Carpetas sin la herencia de Netlify de gastos: `worker/index.js` (rutas), `api/` (un handler
  por recurso, `(Request) → Response`), `lib/` (lógica pura con tests), `public/` (la app).
- El schema se aplica solo en el primer request, como en gastos (`ensureSchema`, versión por
  hash).
- Secrets del Worker: `SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
  `OAUTH_REDIRECT_URI`, `ANTHROPIC_API_KEY`.
- **Igual que en gastos:** `novedades.json` + VERSION semver en `sw.js` + el hook que exige
  la novedad; ramas con `pre-release` → `main`; el design system publicado en
  `/design-system`, con la skill que lo mantiene; los tests con `node --test`.
- ❓ **Dominio.** ¿Tiene uno propio o arranca en `*.workers.dev`?
- ❓ **Quién puede entrar.** ¿Cualquiera con Google, un tope de usuarios como en gastos
  (`MAX_USERS`) o una lista de emails?

## Lo que se reusa de Gastienzos (copiado, no compartido)

No hay código compartido entre los dos repos: se copia y se adapta.

| De gastos-app | Para qué |
|---|---|
| `public/styles.css` (tokens, componentes M3, claro/oscuro) | Toda la UI. Se copian los tokens enteros y sólo los componentes que se usan. |
| `netlify/lib/auth.mjs`, `auth-login`, `auth-callback`, `auth-logout` | Sesión con JWT en cookie + login con Google. |
| `netlify/lib/db.mjs` (binding D1, `txBatch`, `runChecked`) | Acceso a la base. Sin la traducción del dialecto pg: acá se escribe SQLite directo. |
| `netlify/functions/friends.mjs` (links `frd_…`, aceptar) | Amigos por link, sin los "amigos sin cuenta" ni los saldos. |
| El achique de la foto en el teléfono (1600 px, JPEG 0,8) | Que cada foto pese ~300 KB. |
| Toast, diálogos, `trapFocus`, gesto atrás, `apiFetch`, el SW | La experiencia transversal. |

## Los datos

```
users            id, email, name, picture, created_at
friendships      user_a, user_b, created_at                 (a < b, una fila por par)
friend_invites   inviter_id, token_hash, expires_at, accepted_by, …

lugares          id, cadena, sucursal, direccion, cuit, creado_por
productos        id, nombre, marca, medida, unidad_medida (g|kg|ml|l|u), ean, creado_por
alias            cadena, texto_ticket → producto_id         (cómo lo escribe el ticket de esa cadena)

tickets          id, user_id, lugar_id, fecha, total, n_fotos, created_at
precios          id, ticket_id, user_id, lugar_id, fecha, producto_id (null = sin juntar),
                 texto_ticket, cantidad, unidad (u|kg), precio_lista, descuento, pagado,
                 precio_por_medida (por kg/l/u, derivado), ean
```

- **Lugar.** Sale del ticket: la razón social, el CUIT, la dirección y, si la dice, la
  sucursal. Un lugar es **una sucursal** ("Carrefour · Av. Cabildo 2200"), y la `cadena`
  ("Carrefour") los agrupa. Así se puede comparar entre cadenas o entre sucursales. Si el CUIT
  y la dirección coinciden con uno que ya existe, es ese; si no, se crea y lo confirmás en la
  revisión.
- **El precio guarda todo** (lo pediste así): el de lista por unidad, la cantidad, el
  descuento y lo que pagaste. Para comparar se usa **lo que pagaste por unidad** y, en lo que
  tiene medida, **por kg o por litro** ("$4.200 el kg"), así un paquete de 500 g se compara con
  uno de 1 kg.
- Todo en **pesos** (no hay moneda).
- **Las fotos no se guardan.** Viven en el teléfono mientras se revisa el ticket y después se
  tiran.

### El mismo producto en dos lugares

Es lo difícil: "YERBA PLAYADITO 1KG" en Carrefour y "Yerba Playadito x1000" en Coto son lo
mismo. Hay tres maneras de reconocerlo, de más segura a menos:

1. **El código de barras (EAN).** Cuando dos renglones tienen el mismo EAN son el mismo
   producto, sin preguntar. ❓ **¿De dónde sale el EAN?** La mayoría de los tickets
   argentinos imprimen un código interno de la cadena y no el EAN. Opciones:
   - a) leerlo del ticket cuando aparece (pocos casos);
   - b) **escanearlo con la cámara** desde el producto, en la revisión o en su ficha. En
     Android Chrome está `BarcodeDetector`; en iPhone hace falta una librería (zxing).
     Necesita el producto en la mano.
   - c) las dos.
2. **El alias.** La primera vez que confirmás qué producto es "YERBA PLAYADITO 1KG" en
   Carrefour, queda anotado, y el próximo ticket de cualquier sucursal de Carrefour lo
   reconoce solo.
3. **La sugerencia.** Claude devuelve, además del texto del ticket, un nombre normalizado
   (marca + producto + medida). Con eso la app busca candidatos entre los productos que ya
   existen y te pregunta "¿Es la misma?". Se junta sólo si confirmás, como en gastos.

❓ **¿El catálogo es de todos o de cada grupo de amigos?** Me dijiste que se comparte entre
amigos, pero la amistad no es transitiva: si Juli es amiga tuya y de Marce, y Marce no es
amigo tuyo, ¿qué catálogo ven? Te propongo que **los productos, los lugares y los alias sean
de todos** (son hechos: "la Playadito de 1 kg existe", "Carrefour Cabildo existe") y que
**los precios los veas sólo vos y tus amigos**. Así el reconocimiento mejora con cada
ticket, de quien sea, y ningún precio le llega a un desconocido.

## Cargar un ticket

1. **El botón de la cámara** (el "+" de la app). Sacás la primera foto y la app pregunta
   **"¿Sigue el ticket?"** con *Otra foto* · *Listo*. Abajo van las miniaturas, para borrar una
   o cambiarlas de orden. También se puede elegir de la galería.
2. Cada foto se achica en el teléfono y **van todas juntas en un solo pedido** a
   `POST /api/tickets/leer`.
3. **Claude las lee de una.** La consigna dice que son partes seguidas de un mismo ticket, en
   orden, y que el principio de una puede repetir el final de la anterior: cada renglón se
   devuelve una vez. La respuesta es un JSON con forma fija (structured outputs,
   `output_config.format`):
   - el lugar (razón social, CUIT, dirección, sucursal), la fecha y el total;
   - los renglones: texto como está impreso, cantidad, unidad, precio por unidad, descuento,
     importe, EAN si figura, nombre normalizado, en qué foto está y si estaba repetido en el
     borde.
4. **El server controla** sin IA: que la suma de los renglones dé el total (o el subtotal),
   que cantidad × precio dé el importe, y que los descuentos estén restados. Lo que no cierra
   queda marcado.
5. **La revisión.** La lista de renglones, cada uno con el producto que reconoció (o la
   sugerencia, o "producto nuevo"), editable. Arriba: el lugar y "Da $208.263 de $208.263 ✓"
   (o cuánto falta). Los repetidos en el borde que sacó Claude se muestran plegados, con
   *Volver a ponerlo*. **Guardar** guarda el ticket y sus precios.

**Topes.** Por persona, N tickets por día. Para toda la app, un presupuesto por mes en
dólares (cada lectura anota los tokens que gastó). ❓ ¿Qué números te parecen bien?

### El modelo

Las tres opciones, con un ticket de 3 fotos de ~1600 px. Es una estimación: ~2.500 tokens de
entrada por foto + ~3.000 de salida. Se mide de verdad con tus fotos antes de elegir.

| Modelo | Entrada / salida por millón | Un ticket de 3 fotos (aprox.) |
|---|---|---|
| Claude Opus 5.5 (`claude-opus-5-5`) | US$ 4 / 20 | ~US$ 0,09 |
| Claude Sonnet 5.5 (`claude-sonnet-5-5`) | US$ 2 / 10 | ~US$ 0,045 |
| Claude Haiku 5.5 (`claude-haiku-5-5`) | US$ 0,10 / 0,50 | ~US$ 0,002 |

Te propongo armar un script de medición como el `medir-precios.mjs` de gastos: tus fotos más
la verdad pasada a mano (importes y cantidades bien leídos, total, tiempo, costo). Se corren los
tres modelos y elegís vos. ❓ ¿Tenés fotos de tickets para medir? Sirven las del ticket de
Carrefour en tres fotos y las dos facturas de Nini que usó gastos, si las tenés todavía (en el
repo quedó sólo la verdad, no las imágenes).

- Se llama con el SDK oficial (`@anthropic-ai/sdk`, que wrangler empaqueta en el Worker).
- ❓ ¿Pasa por Cloudflare AI Gateway, como en gastos, para medir tokens y costo? El gateway
  acepta Anthropic como proveedor.

## Pantallas (te sugiero estas)

Mobile primero, con la barra inferior de gastos.

1. **Inicio.** El buscador de productos arriba, los últimos tickets (tuyos y de tus amigos:
   "Juli · Coto Cabildo · ayer · 23 productos") y "Lo que cambió": productos que subieron o
   bajaron desde la última vez. El "+" abre la cámara.
2. **Un producto.** La pregunta es "¿dónde está más barato?". El **último precio en cada
   lugar**, ordenado del más barato al más caro, con fecha y quién lo cargó ("vos", "Juli"); el
   más barato marcado en lima; el precio por kg o litro. Debajo, el historial en un gráfico y
   *Escanear el código* para sumarle el EAN.
3. **Lugares.** La lista de lugares donde hay precios. Su ficha muestra sus productos y en
   cuáles es el más barato.
4. **Un ticket.** Lo que se leyó, con cada renglón linkeado a su producto. Se puede corregir o
   borrar.
5. **Ajustes.** Cuenta, Amigos (invitar por link, la lista, quitar), Apariencia (tema) e
   Instalar.

**Precios viejos.** Con la inflación, un precio de hace dos meses no compara contra uno de
hoy. Te propongo que en "¿dónde está más barato?" entren sólo los de los **últimos 30 días**;
los más viejos se ven grises, con su fecha, y no ganan "el más barato". ❓ ¿30 días te parece
bien?

## Etapas

1. **Base:** login, amigos por link, cargar un ticket (varias fotos → revisión → guardar),
   productos y lugares con alias, la ficha del producto con el precio en cada lugar, el
   buscador, Inicio. El design system copiado y publicado. Script de medición de modelos.
2. **Juntar mejor:** las sugerencias de "¿Es la misma?", juntar y separar desde la ficha,
   escanear el EAN, el historial con gráfico, Lugares.
3. **Después:** una **lista de compras** que te dice en qué lugar te sale más barata entera y
   cuánto ahorrás; **mandar el ticket a Gastienzos** como gasto (por la API con una key o el
   MCP; lo dejaste en "puede ser").

**Fuera de alcance:** cargar un precio sin ticket (a mano o con la foto de la góndola).

## Preguntas abiertas (resumen)

1. Dominio.
2. Quién puede entrar (cualquiera / tope / lista).
3. El EAN: del ticket, escaneado o las dos.
4. Catálogo de todos + precios sólo entre amigos: ¿sí?
5. Topes de lectura por persona y presupuesto por mes.
6. Fotos para medir los modelos, y si pasa por AI Gateway.
7. Precios viejos: ¿30 días?
