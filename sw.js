const CACHE_NAME = 'rv-trainer-v2';

const PRECACHE_ASSETS = [
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
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

// Install: pre-cache all app assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(PRECACHE_ASSETS).catch(err => {
        // Some assets (icons) may not exist yet — ignore individual failures
        console.warn('[SW] Pre-cache partial failure:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Activate: clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch: cache-first for app assets, network-first for external resources
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // External requests (CDN, picsum) — network first, no cache
  if (url.origin !== self.location.origin) {
    event.respondWith(
      fetch(event.request).catch(() => {
        // Return a minimal fallback for image requests
        if (event.request.destination === 'image') {
          return new Response('', { status: 503, statusText: 'Offline' });
        }
        return new Response('Offline', { status: 503 });
      })
    );
    return;
  }

  // App assets — cache first, then network
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      });
    })
  );
});
