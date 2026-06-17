const CACHE = 'axontech-v41';
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
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }
  
  e.respondWith(
    caches.match(e.request).then(cached => {
      const networkFetch = fetch(e.request).then(r => {
        if (!r || r.status !== 200 || r.type !== 'basic') {
          return r;
        }
        const responseToCache = r.clone();
        caches.open(CACHE).then(c => {
          c.put(e.request, responseToCache);
        });
        return r;
      });
      return cached || networkFetch;
    })
  );
});
