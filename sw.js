const CACHE = 'axontech-v66';
const STATIC = [
  './', './index.html', './admin.html', './app.css', './app.js', 
  './manifest.json', './productos.json', './categorias.json',
  './iconos/favicon-96.png', './iconos/icon-192.png', './iconos/icon-512.png',
  './offline.html', './catalogo.html'
];

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
  
  // For navigation requests, use network-first with offline fallback
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res && res.status === 200) {
            const resClone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, resClone));
          }
          return res;
        })
        .catch(() => {
          return caches.match(e.request).then(cached => {
            return cached || caches.match('./offline.html');
          });
        })
    );
    return;
  }
  
  // For other requests: network-first strategy
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
        return caches.match(e.request);
      })
  );
});
