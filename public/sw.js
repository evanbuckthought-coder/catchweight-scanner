/**
 * Minimal app-shell service worker for installability + offline launch.
 *
 * Strategy: cache-first for same-origin GET requests, falling back to the
 * network and caching successful responses. This is intentionally simple — the
 * app holds all state in localStorage and has no backend to be stale against.
 * Bump CACHE_VERSION to invalidate after a deploy.
 */
const CACHE_VERSION = 'catchweight-v1';

self.addEventListener('install', (event) => {
  // Activate the new SW immediately on next load.
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_VERSION));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) {
    return; // don't touch cross-origin or non-GET (e.g. camera, no requests anyway)
  }
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE_VERSION);
          cache.put(request, response.clone());
        }
        return response;
      } catch (err) {
        // Offline and not cached — let the failure surface.
        throw err;
      }
    })(),
  );
});
