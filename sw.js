const CACHE = 'axontech-v6';
const STATIC = ['./', './index.html', './admin.html', './app.css', './app.js', './manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (!e.request.url.startsWith(self.location.origin)) return;
  const url = new URL(e.request.url);
  const isHTML = url.pathname.endsWith('.html') || url.pathname === '/' || url.pathname === '';
  if (isHTML) {
    // HTML siempre de red; sin conexión usa caché
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }
  // CSS / JS / assets: caché primero, actualiza en segundo plano
  e.respondWith(
    caches.match(e.request).then(cached => {
      const networkFetch = fetch(e.request).then(r => {
        if (r.ok) caches.open(CACHE).then(c => c.put(e.request, r.clone()));
        return r;
      });
      return cached || networkFetch;
    })
  );
});
