// ── Versiones de la app y del SW (deben coincidir en cada release) ──
const APP_VERSION  = '97';
const CACHE = 'axontech-v97';
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
      // Borra TODAS las cachés anteriores (v89, v90, v91, v92, v93, etc.)
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => {
      // Notificar a todas las pestañas abiertas que hay una versión nueva
      return self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    }).then(clients => {
      clients.forEach(client => {
        client.postMessage({ type: 'SW_UPDATED', version: APP_VERSION });
      });
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (!e.request.url.startsWith(self.location.origin) || e.request.method !== 'GET') return;

  // For navigation requests: network-first with offline fallback
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

  // ── BUGFIX: NO usar ignoreSearch:true para app.js y app.css ──
  // Antes usábamos ignoreSearch:true que trataba app.js?v=89 y app.js?v=94
  // como la MISMA entrada de caché. Eso hacía que los usuarios con v89
  // cacheada siguieran viendo v89 aunque el HTML pidiera v94.
  // Ahora respetamos el query string para app.js/app.css/index.html/admin.html
  // (que cambian con cada release) y solo ignoramos el query en imágenes
  // (que no cambian entre versiones).
  const url = new URL(e.request.url);
  const esEstatico = /\.(css|js|png|jpe?g|gif|webp|woff2?|ttf|svg|ico)$/.test(url.pathname);
  if (esEstatico) {
    // Archivos que cambian con cada release → respetar el query string
    const respetaQuery = /\.(css|js)$/.test(url.pathname) ||
                         /\/(index|admin|catalogo|offline)\.html$/i.test(url.pathname);
    const cacheOpts = respetaQuery ? undefined : { ignoreSearch: true };
    e.respondWith(
      caches.match(e.request, cacheOpts).then(cached => {
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
