/**
 * Miljöbeslut Service Worker
 *
 * Hanterar:
 *   - Offline-cache av UI-tillgångar (Cache-First för statiska filer)
 *   - Network-First för API-anrop med fallback till cache
 *   - Bakgrundssynkronisering av fältdata
 *   - Push-notifikationer
 */

const _CACHE_NAME = 'miljobeslut-v1';
const STATIC_CACHE_NAME = 'miljobeslut-static-v1';
const API_CACHE_NAME = 'miljobeslut-api-v1';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/index.css',
  '/design-system.css',
  '/logo.png',
  '/manifest.json',
];

// ─── Install ──────────────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS.map((url) => new Request(url, { cache: 'reload' })));
    }).then(() => self.skipWaiting())
  );
});

// ─── Activate ─────────────────────────────────────────────────────────────────

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== STATIC_CACHE_NAME && k !== API_CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ─── Fetch ────────────────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET and cross-origin requests
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // API calls: Network-First with cache fallback
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstWithCache(event.request, API_CACHE_NAME));
    return;
  }

  // Static assets: Cache-First
  event.respondWith(cacheFirstWithNetwork(event.request, STATIC_CACHE_NAME));
});

async function networkFirstWithCache(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response(
      JSON.stringify({ ok: false, error: 'Offline — använder cachad data', offline: true }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

async function cacheFirstWithNetwork(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // If HTML is requested and we have the root cached, return that (SPA fallback)
    if (request.headers.get('accept')?.includes('text/html')) {
      const rootCached = await caches.match('/');
      if (rootCached) return rootCached;
    }
    return new Response('Offline', { status: 503 });
  }
}

// ─── Background Sync ──────────────────────────────────────────────────────────

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-field-data') {
    event.waitUntil(syncPendingFieldData());
  }
});

async function syncPendingFieldData() {
  try {
    const pending = await getPendingFieldDataFromIDB();
    for (const item of pending) {
      await fetch('/api/projects/' + item.projectId + '/field-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + item.token },
        body: JSON.stringify(item.data),
      });
      await removePendingFieldDataFromIDB(item.id);
    }
  } catch {
    // Will retry on next sync opportunity
  }
}

// Placeholder IDB helpers (implementation in app layer)
async function getPendingFieldDataFromIDB() { return []; }
async function removePendingFieldDataFromIDB(_id) { }

// ─── Push Notifications ───────────────────────────────────────────────────────

self.addEventListener('push', (event) => {
  if (!event.data) return;

  try {
    const data = event.data.json();
    event.waitUntil(
      self.registration.showNotification(data.title || 'Miljöbeslut', {
        body: data.body || '',
        icon: '/logo.png',
        badge: '/logo.png',
        data: data.url ? { url: data.url } : undefined,
        tag: data.tag || 'miljobeslut-notification',
      })
    );
  } catch {
    // Ignore malformed push data
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      const existing = clients.find((c) => c.url === url && 'focus' in c);
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    })
  );
});
