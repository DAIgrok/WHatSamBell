/* ============================================================================
   NOSSO MUNDO ♡ — SERVICE WORKER OTIMIZADO PARA GALAXY J5
   Estratégias de cache leves:
   - Navegação (HTML): Network-First com fallback offline
   - CSS / JS / SDK Supabase CDN: Stale-While-Revalidate (abertura instantânea)
   - Ícones e Manifesto: Cache-First (zero espera de rede)
   - Suporte completo a eventos Push e clique em notificações
   ============================================================================ */

const CACHE_SHELL = 'nosso-mundo-shell-v9';
const CACHE_STATIC = 'nosso-mundo-static-v9';

const PRECACHE_SHELL = ['/', '/index.html', '/style.css', '/app.js'];
const PRECACHE_STATIC = [
  '/manifest.webmanifest',
  '/icon.svg',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_SHELL).then((cache) => cache.addAll(PRECACHE_SHELL).catch(() => {})),
      caches.open(CACHE_STATIC).then((cache) => cache.addAll(PRECACHE_STATIC).catch(() => {}))
    ])
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  const validCaches = new Set([CACHE_SHELL, CACHE_STATIC]);
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => !validCaches.has(key)).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (request.headers.has('range')) return;

  const url = new URL(request.url);

  // Nunca interceptar API, Storage ou Realtime WebSocket do Supabase
  if (url.hostname.endsWith('supabase.co')) {
    return;
  }

  // Permitir cache Stale-While-Revalidate do SDK Supabase na CDN para arranque rápido no J5
  const isSupabaseCdn =
    url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('@supabase/supabase-js');

  if (url.origin !== self.location.origin && !isSupabaseCdn) {
    return;
  }

  // 1. Navegação HTML -> Network-First (sempre tenta pegar HTML atualizado)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_SHELL).then((cache) => cache.put('/index.html', copy));
          }
          return response;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // 2. Ícones / Manifesto -> Cache-First
  if (/\.(png|svg|ico|webmanifest)$/i.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response && response.ok) {
              const copy = response.clone();
              caches.open(CACHE_STATIC).then((cache) => cache.put(request, copy));
            }
            return response;
          })
      )
    );
    return;
  }

  // 3. CSS, JS e CDN Supabase -> Stale-While-Revalidate (responde do cache em <5ms)
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_SHELL).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);

      return cached || networkFetch;
    })
  );
});

// ============================================================================
// NOTIFICAÇÕES PUSH EM SEGUNDO PLANO
// ============================================================================
self.addEventListener('push', (event) => {
  let payload = {
    title: 'Nosso Mundo ♡',
    body: 'Nova mensagem recebida',
    tag: 'nosso-mundo-push',
    url: '/'
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      payload = { ...payload, ...parsed };
    } catch (_) {
      payload.body = event.data.text() || payload.body;
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      vibrate: [220, 100, 220],
      renotify: true,
      data: { url: payload.url || '/' }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsList) => {
      for (const client of clientsList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    })
  );
});
