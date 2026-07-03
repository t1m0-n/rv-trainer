// ─── Version hier hochzählen bei jedem Deployment ───────────────────────────
const CACHE_VERSION = 8;
const CACHE_NAME = `rv-trainer-v${CACHE_VERSION}`;

// Nur statische Assets die sich selten ändern bekommen cache-first
const IMMUTABLE_ASSETS = [
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

// App-Shell: network-first, Cache nur als Offline-Fallback
const PRECACHE_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/drill.js',
  './js/session.js',
  './js/arv.js',
  './js/journal.js',
  './js/target-provider.js',
  './js/journal-store.js',
  './js/toast.js',
  './js/wakelock.js',
  './js/lightbox.js',
  './js/version.js',
];

// ── Install ───────────────────────────────────────────────────────────────────
// Alle Assets vorab in den Cache legen (Fehler bei einzelnen Assets werden
// toleriert, z.B. fehlende Icons beim ersten Build).
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll([...PRECACHE_SHELL, ...IMMUTABLE_ASSETS])
        .catch(err => console.warn('[SW] Pre-cache partial failure:', err))
      )
      // Neuen SW sofort aktivieren — der Update-Banner im Client
      // fragt den Nutzer, ob er neu laden will.
      .then(() => self.skipWaiting())
  );
});

// ── Activate ──────────────────────────────────────────────────────────────────
// Alte Caches löschen, dann alle offenen Clients übernehmen.
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k.startsWith('rv-trainer-') && k !== CACHE_NAME)
          .map(k => {
            console.log('[SW] Deleting old cache:', k);
            return caches.delete(k);
          })
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  // Nur GET-Anfragen behandeln
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Externe Anfragen (CDN, picsum, Anthropic) — network only, kein Caching
  if (url.origin !== self.location.origin) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response('', { status: 503, statusText: 'Offline' })
      )
    );
    return;
  }

  // Icons & andere statische Assets — cache-first (ändern sich nie ohne neue URL)
  if (IMMUTABLE_ASSETS.some(a => url.pathname.endsWith(a.replace('./', '/')))) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response.ok) {
            caches.open(CACHE_NAME).then(c => c.put(event.request, response.clone()));
          }
          return response;
        });
      })
    );
    return;
  }

  // App-Shell (HTML, JS, CSS, manifest) — network-first, Cache als Fallback
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Nur erfolgreiche Responses cachen
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return response;
      })
      .catch(() =>
        // Offline: aus Cache bedienen
        caches.match(event.request).then(cached =>
          cached ?? new Response('Offline', { status: 503, statusText: 'Offline' })
        )
      )
  );
});

// ── Message-Handler ───────────────────────────────────────────────────────────
// Der Update-Banner im Client schickt 'SKIP_WAITING' wenn der Nutzer
// "Neu laden" klickt — dann übernimmt der wartende SW sofort.
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
