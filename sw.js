const CACHE_NAME = 'lyrics-encoder-v7';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './favicon.svg',
  './icon-192.svg',
  './icon-512.svg',
  './styles.css'
];

// Install â€” cache all assets
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activate â€” delete old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch â€” serve from cache, fallback to network
self.addEventListener('fetch', e => {
  // Skip non-GET and cross-origin requests (ads, fonts, APIs)
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
