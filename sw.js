const CACHE = 'axontech-v60-fuego';
const STATIC = ['./', './index.html', './admin.html', './app.css?v=60', './app.js?v=60', './manifest.json'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c => {
      // Intenta guardar los archivos, pero si uno falla, no cancela la instalación
      return Promise.allSettled(STATIC.map(url => fetch(url).then(r => c.put(url, r))));
    })
  );
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
  if (!e.request.url.startsWith(self.location.origin) || e.request.method !== 'GET') return;
  
  // STRATEGY: NETWORK ALWAYS (Bypass Cache for HTML, JS, and CSS)
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const resClone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, resClone));
        }
        return res;
      })
      .catch(() => {
        // Only fallback to cache if there is NO INTERNET
        return caches.match(e.request);
      })
  );
});
