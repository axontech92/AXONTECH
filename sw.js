const CACHE = 'axontech-v88';
const STATIC = [
  './', './index.html', './admin.html', './app.css', './app.js',
  './manifest.json', './productos.json',
  './iconos/favicon-96.png', './iconos/icon-192.png', './iconos/icon-512.png',
  './iconos/icon-192-maskable.png', './iconos/icon-512-maskable.png', './iconos/icon-1024-maskable.png',
  './offline.html', './catalogo.html', './data.json'
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

  // For static assets (CSS, JS, images, fonts): cache-first + revalidación en segundo plano.
  // En 3G esto evita varios segundos de pantalla en blanco al arranque.
  // Ver AUDITORIA-AXONTECH.md MEDIO 15.
  const url = new URL(e.request.url);
  const esEstatico = /\.(css|js|png|jpe?g|gif|webp|woff2?|ttf|svg|ico)$/.test(url.pathname);
  if (esEstatico) {
    e.respondWith(
      caches.match(e.request, {ignoreSearch: true}).then(cached => {
        // Revalidar en segundo plano sin bloquear la respuesta
        const net = fetch(e.request).then(res => {
          if (res && res.status === 200 && res.type === 'basic') {
            const resClone = res.clone();
            caches.open(CACHE).then(k => k.put(e.request, resClone));
          }
          return res;
        }).catch(() => cached);
        return cached || net;
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

// Allow page to trigger immediate SW activation when a new version is waiting
self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
