const CACHE_NAME = 'jaran-school-v1';

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const scope = self.registration.scope;
    const indexUrl = new URL('index.html', scope).href;
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll([
      new URL('./', scope).href,
      indexUrl,
      new URL('manifest.webmanifest', scope).href,
      new URL('jaran-logo.jpeg', scope).href,
      new URL('icons/icon-192.png', scope).href,
      new URL('icons/icon-512.png', scope).href,
      new URL('icons/apple-touch-icon.png', scope).href
    ]);

    const index = await cache.match(indexUrl);
    const html = await index.text();
    const assets = [...html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))["']/g)]
      .map(([, path]) => new URL(path, scope).href);
    await cache.addAll(assets);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(key => key.startsWith('jaran-school-') && key !== CACHE_NAME)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(new URL('index.html', self.registration.scope), response.clone());
        }
        return response;
      } catch {
        const cached = await caches.match(new URL('index.html', self.registration.scope));
        if (cached) return cached;
        throw new Error('The app is not available offline yet.');
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  })());
});
