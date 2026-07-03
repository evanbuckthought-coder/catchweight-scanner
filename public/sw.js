/**
 * App-shell service worker for installability + offline launch.
 *
 * Strategy:
 *   - HTML / navigation requests -> NETWORK-FIRST (fall back to cache offline),
 *     so a new deploy is picked up immediately.
 *   - Everything else same-origin (hashed /assets, /tesseract engine files,
 *     icons) -> CACHE-FIRST with runtime caching.
 *
 * WEBKIT-CRITICAL: never use Response.clone() to tee a body into the cache.
 * Safari stalls BOTH branches of a cloned response once the body exceeds its
 * stream buffer (multi-MB files like the OCR wasm core / language data hang
 * silently, mid-transfer, with no error — observed on installed iOS PWAs).
 * Instead the body is read ONCE into an ArrayBuffer and two fresh Responses
 * are constructed from it (read-once pattern below).
 *
 * Bump CACHE_VERSION on strategy changes: activation deletes every older
 * cache, so no runtime-cached byte from a previous SW generation can survive
 * an update (lazy chunks and engine assets included).
 */
const CACHE_VERSION = 'catchweight-v3';

self.addEventListener('install', (event) => {
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

/**
 * Read-once cache write: consume the body a single time, then build separate
 * Responses for the cache and the caller. No clone(), no WebKit stream stall.
 * Returns the Response to hand back to the page.
 */
async function cacheAndRespond(request, response) {
  const buf = await response.arrayBuffer();
  const init = {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  };
  try {
    const cache = await caches.open(CACHE_VERSION);
    await cache.put(request, new Response(buf.slice(0), init));
  } catch (err) {
    // Cache write failure (quota, etc.) must never break the request itself.
  }
  return new Response(buf, init);
}

async function networkFirst(request) {
  try {
    const fresh = await fetch(request);
    if (!fresh.ok) return fresh;
    return await cacheAndRespond(request, fresh);
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  if (!fresh.ok) return fresh;
  try {
    return await cacheAndRespond(request, fresh);
  } catch (err) {
    // Body buffering failed for some reason — fall back to a plain refetch so
    // the caller still gets a working (uncached) response.
    return fetch(request);
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return; // never touch cross-origin

  const isDocument = request.mode === 'navigate' || request.destination === 'document';
  event.respondWith(isDocument ? networkFirst(request) : cacheFirst(request));
});
