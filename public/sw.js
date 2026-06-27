/**
 * App-shell service worker for installability + offline launch.
 *
 * Strategy:
 *   - HTML / navigation requests -> NETWORK-FIRST (fall back to cache offline).
 *     This is the important bit: the index.html is what references the hashed
 *     JS/CSS bundles, so always fetching it fresh means a new deploy is picked
 *     up immediately instead of being pinned to a stale cached shell.
 *   - Hashed static assets (/assets/*) and other GETs -> CACHE-FIRST (they are
 *     content-hashed and immutable, so this is safe and fast/offline-friendly).
 *
 * Bump CACHE_VERSION on deploys that must hard-evict old caches.
 */
const CACHE_VERSION = 'catchweight-v2';

self.addEventListener('install', (event) => {
  // Take over as soon as possible so updates apply on the next load.
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_VERSION));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop every cache that isn't the current version (clears stale shells).
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) {
    return; // ignore cross-origin / non-GET
  }

  const isDocument = request.mode === 'navigate' || request.destination === 'document';

  if (isDocument) {
    // Network-first: always try the network so new deploys load; cache as backup.
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(CACHE_VERSION);
          cache.put(request, fresh.clone());
          return fresh;
        } catch {
          const cached = await caches.match(request);
          return cached ?? Response.error();
        }
      })(),
    );
    return;
  }

  // Cache-first for hashed/static assets.
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const fresh = await fetch(request);
      if (fresh.ok) {
        const cache = await caches.open(CACHE_VERSION);
        cache.put(request, fresh.clone());
      }
      return fresh;
    })(),
  );
});
