// Service worker: la app es instalable (PWA) y el shell carga rápido. El shell va
// cache-first; /api/* SIEMPRE va a la red (los datos viven en el server). Al cambiar
// VERSION (semver, la sube scripts/bump-ui-version.mjs) el browser ve un SW nuevo,
// queda en "waiting" y la app ofrece actualizar.
const VERSION = '0.5.1';
const RELEASED = '2026-10-31T14:17:55.733Z';
const CACHE = `comparame-${VERSION}`;
const SHELL = [
  '/',
  `/styles.css?v=${VERSION}`,
  `/app.css?v=${VERSION}`,
  `/app.js?v=${VERSION}`,
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/logo.svg',
  '/icons/logo-light.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});

// GET_INFO: qué versión es este SW (la app lo muestra al ofrecer actualizar).
// SKIP_WAITING: "Actualizar" — activar ya el SW en waiting.
self.addEventListener('message', (e) => {
  if (e.data?.type === 'GET_INFO') e.ports[0]?.postMessage({ version: VERSION, released: RELEASED });
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/design-system')) return;
  // La página (con cualquier ?amigo=…) es SIEMPRE la de esta versión.
  if (e.request.mode === 'navigate') {
    e.respondWith(caches.match('/').then((r) => r || fetch(e.request)));
    return;
  }
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
