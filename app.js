// ══════════════════════════════════════════
//  PAGE CONTEXT
// ══════════════════════════════════════════
const IS_ADMIN = document.body.dataset.page === 'admin';

// ══════════════════════════════════════════
//  APP VERSION  (debe coincidir con sw.js APP_VERSION y version.json)
// ══════════════════════════════════════════
//  Sistema de versiones reiniciado a v3. El badge superior muestra esta versión.
//  checkVersion() consulta version.json periódicamente; si detecta una versión
//  mayor, muestra el banner "Nueva versión disponible" con botón Recargar.
const APP_VERSION = 13;
const VERSION_STR = 'v' + APP_VERSION;

// Estado del chequeo de versión
let _updateDismissed = false;       // el usuario pospuso la actualización
let _lastRemoteVersion = null;       // caché en memoria de la última versión remota vista
const _VERSION_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutos

// Inicializa el badge de versión con la versión local.
function _initVersionBadge() {
  const badge = document.getElementById('versionBadge');
  if (badge) badge.textContent = VERSION_STR;
}

// Compara dos versiones numéricas. Devuelve true si `remote` > `local`.
function _isNewerVersion(remote, local) {
  const r = parseInt(remote, 10);
  const l = parseInt(local, 10);
  if (isNaN(r) || isNaN(l)) return false;
  return r > l;
}

// Hash local de la build actual (se inyecta automáticamente desde build.py vía
// version.json cacheado en el SW; si no está disponible, queda null y solo se
// compara por número de versión).
let _LOCAL_BUILD_HASH = 'f7490926b3b90dc0';

// Verifica contra version.json si hay una versión más nueva disponible.
// `manual=true` fuerza mostrar un toast incluso si no hay novedades (caso del tap en el badge).
async function checkVersion(manual) {
  try {
    // Cache-busting: agregamos un timestamp para evitar caché del SW/HTTP.
    const url = './version.json?t=' + Date.now();
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      if (manual) showToast('No se pudo verificar la versión (sin conexión)');
      return;
    }
    const data = await res.json();
    const remoteVersion = parseInt(data.version, 10);
    if (isNaN(remoteVersion)) {
      if (manual) showToast('version.json inválido');
      return;
    }
    _lastRemoteVersion = remoteVersion;
    const remoteStr = data.versionStr || ('v' + remoteVersion);
    const remoteHash = data.hash || null;

    // Criterio de "hay actualización":
    //  1. La versión remota es mayor que la local, O
    //  2. El hash remoto existe, es distinto de null, y es distinto del hash local
    //     (este caso cubre escenarios donde la versión se reinició o se republicó
    //     la misma versión con cambios).
    const isNewer = _isNewerVersion(remoteVersion, APP_VERSION);
    const hashChanged = remoteHash && remoteHash !== _LOCAL_BUILD_HASH;
    const hasUpdate = isNewer || hashChanged;

    if (hasUpdate) {
      // Hay una versión nueva — mostrar banner (salvo que el usuario ya lo haya pospuesto
      // para esta sesión y no sea una verificación manual).
      if (manual || !_updateDismissed) {
        _showUpdateBanner(remoteStr, data.changelog);
      }
    } else {
      // Estamos al día
      if (manual) showToast('Ya tienes la última versión (' + VERSION_STR + ') ✓');
      _hideUpdateBanner();
    }
  } catch (e) {
    console.warn('checkVersion error:', e);
    if (manual) showToast('No se pudo verificar la versión');
  }
}

// Muestra el banner flotante de actualización disponible.
function _showUpdateBanner(remoteStr, changelog) {
  const banner = document.getElementById('updateBanner');
  if (!banner) return;
  const text = document.getElementById('updateBannerText');
  if (text) {
    const note = (changelog && changelog.length) ? ' · ' + changelog[0] : '';
    text.textContent = '🔄 Nueva versión disponible: ' + remoteStr + note;
  }
  banner.style.display = 'flex';
}

// Oculta el banner de actualización.
function _hideUpdateBanner() {
  const banner = document.getElementById('updateBanner');
  if (banner) banner.style.display = 'none';
}

// El usuario pulsó "Más tarde" — ocultar hasta la próxima verificación.
function dismissUpdate() {
  _updateDismissed = true;
  _hideUpdateBanner();
}

// El usuario pulsó "Recargar ahora" — forzar recarga limpia saltando la caché.
function applyUpdate() {
  // 1. Si hay un SW esperando, activarlo.
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage('SKIP_WAITING');
  }
  // 2. Recargar sin caché después de un pequeño delay para dar tiempo al SW.
  setTimeout(() => {
    // Usar location.reload(true) si existe, sino location.reload()
    // Agregar un cache-buster al HTML para forzar al navegador a pedir la versión nueva.
    window.location.href = window.location.pathname + '?v=' + (_lastRemoteVersion || APP_VERSION) + (window.location.hash || '');
  }, 400);
}

// ══════════════════════════════════════════
//  SECURITY UTILS
// ══════════════════════════════════════════
function escapeHTML(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
// escapeAttr is now a true alias of escapeHTML — escapeHTML already escapes single quotes
// which is what attribute-context safety requires.
function escapeAttr(str) { return escapeHTML(str); }

// ── UTF-8 safe base64 (replaces deprecated btoa(unescape(encodeURIComponent(...)))) ──
function utf8ToBase64(str) {
  try {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    bytes.forEach(b => binary += String.fromCharCode(b));
    return btoa(binary);
  } catch(e) {
    // Fallback for very old browsers
    return btoa(unescape(encodeURIComponent(str)));
  }
}
function base64ToUtf8(b64) {
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch(e) {
    return decodeURIComponent(escape(atob(b64)));
  }
}

// ══════════════════════════════════════════
//  SUPABASE DATA LAYER (v31)
// ══════════════════════════════════════════
// POR QUÉ SUPABASE:
// Firestore (firestore.googleapis.com) está bloqueado desde Cuba sin VPN
// — confirmado con diagnostico-supabase.html el 2026-08-09. Supabase
// (gdzsqwyedzrfituewdtt.supabase.co) SÍ responde desde Cuba, latencia
// ~1 segundo a la API REST. Supabase es Postgres + PostgREST (API REST
// automática sobre las tablas) + Realtime (WebSockets con fallback).
// Modelo de datos: cada tabla tiene (id bigint primary key, data jsonb).
// El objeto completo del vale/gestor/producto va dentro de `data` —
// mismo modelo mental que un documento de Firestore, pero sobre Postgres.
// Esto permite usar upsert atómico por id y select por id sin tener que
// traducir cada campo a una columna distinta.

const SUPABASE_URL  = 'https://gdzsqwyedzrfituewdtt.supabase.co';
const SUPABASE_KEY  = 'sb_publishable_Ftyw83d2WPU7TtC7JacCRw_uQuqFXdW';
const _SB_REST      = SUPABASE_URL + '/rest/v1';
const _SB_AUTH_HDRS = {
  'apikey':       SUPABASE_KEY,
  'Authorization': 'Bearer ' + SUPABASE_KEY,
  'Content-Type':  'application/json',
  'Prefer':        'resolution=merge-duplicates',  // UPSERT en PostgREST
};

let _syncCount = 0;
const isSyncingFromFirebase = () => _syncCount > 0;

// ── Mapeo de nodos singleton (como en Firestore) ──
// En Firestore: meta/{config,notifs,estafa,ranking_summary} (un doc por nombre)
// En Supabase: tabla `meta` con primary key `name` (una fila por nombre)
const _SB_SINGLETON_ROWS = ['config', 'notifs', 'estafa', 'ranking_summary'];
// Estos guardaban un array envuelto en {items:[...]} en Firestore. En
// Supabase guardamos el array DIRECTO en data (jsonb acepta arrays como
// valor raíz). Al leer, ya no hay que desenvolver nada.
const _SB_ARRAY_SINGLETONS = new Set(['notifs', 'estafa', 'ranking_summary']);

// ── Helpers REST para Supabase ──
// Lee una colección completa (tabla). Devuelve array de objetos JS
// (ya con el contenido de `data` desenvuelto).
async function _sbRestGetCollection(collName) {
  // PostgREST: GET /rest/v1/{tabla}?select=data
  // Como cada fila tiene (id, data), pedimos solo la columna `data`.
  // Si la tabla está vacía devuelve [] (no error).
  const url = `${_SB_REST}/${encodeURIComponent(collName)}?select=data&order=id.asc`;
  const res = await fetch(url, { headers: _SB_AUTH_HDRS });
  if (!res.ok) {
    if (res.status === 404) return []; // tabla no existe todavía
    throw new Error(`Supabase GET ${collName} ${res.status}: ${(await res.text()).slice(0,150)}`);
  }
  const rows = await res.json();
  // Cada fila es {data: {...}} — desenvolver
  return (rows || []).map(r => r.data).filter(x => x != null);
}

// Lee un documento singleton (tabla `meta`, fila por nombre).
async function _sbRestGetMeta(name) {
  const url = `${_SB_REST}/meta?select=data&name=eq.${encodeURIComponent(name)}`;
  const res = await fetch(url, { headers: _SB_AUTH_HDRS });
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`Supabase GET meta/${name} ${res.status}`);
  }
  const rows = await res.json();
  if (!rows || rows.length === 0) return null;
  return rows[0].data;
}

// UPSERT de una fila por id (inserta si no existe, actualiza si existe).
// `value` es el objeto JS completo a guardar dentro de la columna `data`.
// v31: usa return=representation para detectar RLS bloqueando.
async function _sbRestUpsert(collName, id, value) {
  const url = `${_SB_REST}/${encodeURIComponent(collName)}`;
  const body = JSON.stringify([{ id: id, data: value }]);
  const res = await fetch(url, {
    method: 'POST',
    headers: { ..._SB_AUTH_HDRS, 'Prefer': 'resolution=merge-duplicates,return=representation' },
    body: body,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Supabase UPSERT ${collName}/${id} ${res.status}: ${t.slice(0,150)}`);
  }
  // Verificar que realmente se guardó
  const rows = await res.json().catch(() => []);
  if (Array.isArray(rows) && rows.length === 0) {
    console.error(`[supabase] RLS bloqueó el UPSERT de ${collName}/${id} — revisa supabase_schema.sql`);
  }
}

// UPSERT de múltiples filas en una sola petición (más eficiente que hacer
// N requests separados — importante a 10 Kbit/s).
// v31: usa `return=representation` para que Supabase devuelva las filas
// afectadas. Si devuelve vacío, es señal de que RLS bloqueó el write
// silenciosamente — la promesa resuelve con la lista de ids efectivamente
// guardados, para que el caller pueda detectar fallos.
async function _sbRestUpsertBatch(collName, items) {
  // items: [{id, value}, ...]
  if (!items || items.length === 0) return [];
  const savedIds = [];
  // Partir en chunks de 500 (límite recomendado por PostgREST)
  const CHUNK = 500;
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    const url = `${_SB_REST}/${encodeURIComponent(collName)}`;
    const body = JSON.stringify(chunk.map(it => ({ id: it.id, data: it.value })));
    const res = await fetch(url, {
      method: 'POST',
      headers: { ..._SB_AUTH_HDRS, 'Prefer': 'resolution=merge-duplicates,return=representation' },
      body: body,
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Supabase UPSERT batch ${collName} ${res.status}: ${t.slice(0,150)}`);
    }
    // v31: verificar que las filas realmente se guardaron.
    // PostgREST devuelve un array con las filas afectadas si return=representation.
    // Si devuelve vacío, las políticas RLS bloquearon silenciosamente.
    const rows = await res.json().catch(() => []);
    if (Array.isArray(rows)) {
      rows.forEach(r => { if (r && r.id != null) savedIds.push(Number(r.id)); });
    }
    // Si rows está vacío o tiene menos elementos de los esperados, las
    // políticas RLS pueden estar bloqueando. Lo registramos pero NO lanzamos
    // error — el listener del gestor se encargará de reintentar.
    if (Array.isArray(rows) && rows.length < chunk.length) {
      console.error(`[supabase] RLS posiblemente bloqueando writes en '${collName}': enviados=${chunk.length} guardados=${rows.length}. Revisa que las políticas RLS estén creadas (supabase_schema.sql).`);
    }
  }
  return savedIds;
}

// Borra un documento por id (DELETE /rest/v1/{tabla}?id=eq.X)
async function _sbRestDelete(collName, id) {
  const url = `${_SB_REST}/${encodeURIComponent(collName)}?id=eq.${encodeURIComponent(id)}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: _SB_AUTH_HDRS,
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Supabase DELETE ${collName}/${id} ${res.status}`);
  }
}

// Borra toda una colección (DELETE sin filtro).
async function _sbRestDeleteAll(collName) {
  const url = `${_SB_REST}/${encodeURIComponent(collName)}?id=gte.0`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { ..._SB_AUTH_HDRS, 'Prefer': 'return=minimal' },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Supabase DELETE-ALL ${collName} ${res.status}`);
  }
}

// Borra varios ids a la vez (más eficiente que N DELETEs separados).
async function _sbRestDeleteBatch(collName, ids) {
  if (!ids || ids.length === 0) return;
  // PostgREST permite `?id=in.(1,2,3)` para filtrar por lista.
  const CHUNK = 500;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const url = `${_SB_REST}/${encodeURIComponent(collName)}?id=in.(${chunk.map(x => encodeURIComponent(String(x))).join(',')})`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { ..._SB_AUTH_HDRS, 'Prefer': 'return=minimal' },
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`Supabase DELETE batch ${collName} ${res.status}`);
    }
  }
}

// UPSERT de un documento singleton en la tabla `meta`.
async function _sbRestMetaUpsert(name, value) {
  const url = `${_SB_REST}/meta`;
  const body = JSON.stringify([{ name: name, data: value }]);
  const res = await fetch(url, {
    method: 'POST',
    headers: { ..._SB_AUTH_HDRS, 'Prefer': 'resolution=merge-duplicates,return=representation' },
    body: body,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Supabase META UPSERT ${name} ${res.status}: ${t.slice(0,150)}`);
  }
  // Verificar que realmente se guardó
  const rows = await res.json().catch(() => []);
  if (Array.isArray(rows) && rows.length === 0) {
    console.error(`[supabase] RLS bloqueó el META UPSERT de ${name} — revisa supabase_schema.sql`);
  }
}

// Borra un documento singleton por nombre.
async function _sbRestMetaDelete(name) {
  const url = `${_SB_REST}/meta?name=eq.${encodeURIComponent(name)}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: _SB_AUTH_HDRS,
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Supabase META DELETE ${name} ${res.status}`);
  }
}

// ── Constructor de snapshots falsos ──
// Mantiene la MISMA forma que devolvía _fakeSnap() en Firestore, así los
// listeners (window._handleValesSnap, window._handleMyValesSnap) no cambian.
function _fakeSnap(arr) {
  const docs = (arr || []).map(o => ({
    id: String(o && o.id != null ? o.id : ''),
    data: () => o,
    metadata: { hasPendingWrites: false }, // viene del servidor: ya confirmado
  }));
  return { docs, empty: docs.length === 0, size: docs.length, forEach: fn => docs.forEach(fn) };
}

// ══════════════════════════════════════════════════════════════════════
//  SONDEO POR HTTPS — fuente principal de sincronización (Cuba)
// ══════════════════════════════════════════════════════════════════════
// En v30 esto era un "respaldo" del streaming de Firestore. En v31 es la
// FUENTE PRINCIPAL — Supabase Realtime también usa WebSockets y puede
// sufrir el mismo bloqueo que Firestore. HTTPS simple (REST) es lo más
// robusto y quedó confirmado por el diagnóstico desde Cuba (latencia ~1s).
// Frecuencia: cada 5s (vs 12s de v30) — los vales pesan 600 bytes, no hay
// razón para esperar 12s para que el admin vea uno nuevo.
let _restPollTimer = null;
let _restPollInFlight = false;
const _REST_POLL_MS = 5000;

async function _doRestPoll() {
  if (_restPollInFlight) return;
  if (!navigator.onLine) return;
  if (document.hidden) return; // no gastar datos con la app en segundo plano
  _restPollInFlight = true;
  try {
    // ── Vales ── (lo crítico: es lo que no llegaba al admin)
    if (IS_ADMIN) {
      const vales = await _sbRestGetCollection('vales');
      if (typeof window._handleValesSnap === 'function') window._handleValesSnap(_fakeSnap(vales));
    } else if (activeGestorId != null) {
      const all = await _sbRestGetCollection('vales');
      // v32: comparación flexible con == en vez de === porque el gestorId puede
      // venir como número o como string de Supabase JSONB según cómo se guardó.
      // Number(v.gestorId) === Number(activeGestorId) es más seguro.
      const gid = Number(activeGestorId);
      const mine = all.filter(v => v && v.gestorId != null && Number(v.gestorId) === gid);
      if (typeof window._handleMyValesSnap === 'function') window._handleMyValesSnap(_fakeSnap(mine));
    }
    // ── Entidades (gestores/mensajeros/productos/categorias) ──
    // Mismo criterio que antes: un resultado vacío NO borra lo local
    // (puede ser que la tabla aún no exista, no que esté realmente vacía).
    for (const node of ['gestores', 'mensajeros', 'productos', 'categorias']) {
      try {
        const arr = await _sbRestGetCollection(node);
        if (arr.length > 0) {
          _syncCount++;
          try {
            try { localStorage.setItem('axon_'+node, JSON.stringify(arr)); } catch(e) {}
            if(node==='gestores'){_gestoresCache=arr;_gestoresDirty=false;}
            else if(node==='mensajeros'){_mensajerosCache=arr;_mensajerosDirty=false;}
            else if(node==='productos'){_productosCache=arr;_productosDirty=false;}
            else if(node==='categorias'){_categoriasCache=arr;_categoriasDirty=false;}
          } finally { _syncCount--; }
        }
      } catch(e) { /* una tabla puntual puede fallar; seguir con las demás */ }
    }
    // ── Documentos únicos (config/notifs/estafa/ranking_summary) ──
    for (const node of _SB_SINGLETON_ROWS) {
      try {
        const val = await _sbRestGetMeta(node);
        if (val) {
          _syncCount++;
          try {
            try { localStorage.setItem('axon_'+node, JSON.stringify(val)); } catch(e) {}
            if(node==='config'){_configCache=val;_configDirty=false;}
            else if(node==='notifs'){_notifsCache=val;_notifsDirty=false;}
            else if(node==='estafa'){_estafaCache=val;_estafaDirty=false;}
          } finally { _syncCount--; }
        }
      } catch(e) { /* idem */ }
    }
    refreshUI();
  } catch(e) {
    console.warn('[rest-poll] error:', e && e.message);
  } finally {
    _restPollInFlight = false;
  }
}
function _startRestPolling() {
  if (_restPollTimer) return; // ya está corriendo
  _doRestPoll(); // primera pasada inmediata
  _restPollTimer = setInterval(_doRestPoll, _REST_POLL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) _doRestPoll(); });
  window.addEventListener('online', () => _doRestPoll());
}

// ── Detección de conectividad ──
// Supabase no tiene un equivalente directo a '.info/connected'. Usamos
// navigator.onLine + los eventos online/offline del navegador como proxy.
// _processFBQueue ya tiene su timeout adaptativo y reintentos con backoff
// como red de seguridad.
let _fbConnected = navigator.onLine;
window.addEventListener('online', () => {
  if (_fbConnected) return;
  _fbConnected = true;
  setTimeout(() => { _ensurePendingValesEnqueued(); _processFBQueue(); }, 100);
  _updateSyncIndicator();
});
window.addEventListener('offline', () => {
  _fbConnected = false;
  _updateSyncIndicator();
});

// ══════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════
let activeGestorId    = null;
let activeMensajeroId = null;
let adminActive       = false;
let selectedValeId    = null;
let inboxFilter       = 'pending';
let adminGestorFilter = null;
let shareTargetId     = null;
let currentAdminTab   = 'vales';
let stockCatFilter    = null;
let editingProductId  = null;
let pickerSelected    = {};
let pickerCatFilter   = null;
let catalogCatFilter  = null;
let expandedCatalogId = null;
let adminCatalogCatFilter = null;
let selectedProductsUI= [];
let currentValeProductos = [];
let pendingGestorId      = null;
let activeComisionGestorId = null;
let gestoresTabDirty = true;
let statsTabDirty    = true;
let rankingCache = null;
let confirmActionCb  = null;
let adminGestorMenuExpanded = false;
let mensajeroManagerExpanded = true; // open by default
let pendingCobroExpanded = false;

// ══════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════
const GESTOR_COLORS = ['#2563EB','#7C3AED','#059669','#DC2626','#D97706','#0891B2','#BE185D','#1D4ED8'];

// ── Cache Map para productoOf / gestorOf / mensajeroOf ──
// Antes: cada llamada a productoOf(id) hacía find() en el array completo de
// productos. En un render de 50 vales con 3 productos cada uno, eran 150
// find() — cada uno O(n) sobre el array de productos. Con 100 productos,
// eran 15000 comparaciones por render.
// Ahora: mantenemos un Map(id → objeto) que se reconstruye solo cuando el
// array subyacente cambia (dirty flag). Lookup es O(1).
// BUGFIX: la invalidación por "dirty flag" (_productosDirty/etc.) nunca
// disparaba en la práctica — ese flag lo usa getProductos() para saber si
// debe releer localStorage, y CUALQUIER escritura (local o desde Firestore)
// lo deja en `false` inmediatamente después de refrescar el array. Como
// resultado, este Map se construía UNA sola vez por sesión y nunca más se
// reconstruía, aunque getProductos() sí devolviera datos frescos. Un
// producto agregado por el admin después del primer productoOf() de la
// sesión quedaba invisible para el picker de cantidad/precio (el grid sí lo
// mostraba, porque lee getProductos() directo) hasta recargar la página.
// Con los listeners en tiempo real de Firestore empujando catálogo nuevo a
// sesiones de gestor que quedan abiertas por horas, esto pasaba todo el
// tiempo. Fix: comparar la REFERENCIA del array contra la última usada para
// construir el Map — getProductos()/getGestores()/getMensajeros() siempre
// devuelven un array nuevo cuando el contenido cambió (tanto en saves
// locales como en el listener de Firestore), así que esta comparación es
// un invalidado correcto y barato (O(1) en el caso común de "no cambió").
let _productosMap = null, _productosMapSrc = null;
let _gestoresMap = null, _gestoresMapSrc = null;
let _mensajerosMap = null, _mensajerosMapSrc = null;
function _getProductosMap() {
  const src = getProductos();
  if (!_productosMap || _productosMapSrc !== src) {
    _productosMap = new Map();
    src.forEach(p => _productosMap.set(p.id, p));
    _productosMapSrc = src;
  }
  return _productosMap;
}
function _getGestoresMap() {
  const src = getGestores();
  if (!_gestoresMap || _gestoresMapSrc !== src) {
    _gestoresMap = new Map();
    src.forEach(g => _gestoresMap.set(g.id, g));
    _gestoresMapSrc = src;
  }
  return _gestoresMap;
}
function _getMensajerosMap() {
  const src = getMensajeros();
  if (!_mensajerosMap || _mensajerosMapSrc !== src) {
    _mensajerosMap = new Map();
    src.forEach(m => _mensajerosMap.set(m.id, m));
    _mensajerosMapSrc = src;
  }
  return _mensajerosMap;
}
const gestorOf    = id => _getGestoresMap().get(id);
const mensajeroOf = id => _getMensajerosMap().get(id);
const productoOf  = id => _getProductosMap().get(id);
const todayStr    = () => new Date().toDateString();

// ══════════════════════════════════════════
//  GESTOR AVATAR HELPER (foto de perfil o iniciales)
//  Devuelve el HTML interno del avatar. Si el gestor tiene foto,
//  muestra <img> dentro de un wrapper circular; si no, las iniciales.
//  El wrapper .g-avatar-img-wrap se encarga del clipping (overflow:hidden + border-radius),
//  dejando al padre .g-avatar libre de overflow:hidden para que el botón 📷 cámara
//  (position:absolute, desborda 4px) NO sea recortado.
// ══════════════════════════════════════════
function gestorAvatarInner(g) {
  if (!g) return '?';
  const initials = escapeHTML(g.initials || '?');
  if (g.photo && /^(https?:|data:image|photos\/|\.\/photos\/)/i.test(g.photo)) {
    // Wrapper con overflow:hidden para que la imagen respete el círculo.
    // El botón cámara vive FUERA de este wrapper (como hijo directo de #bannerAvatar).
    return `<span class="g-avatar-img-wrap"><img src="${escapeAttr(g.photo)}" alt="" onerror="this.parentElement.style.display='none';this.parentElement.parentElement.textContent='${initials}'"></span>`;
  }
  return initials;
}

// Fecha local YYYY-MM-DD (no UTC). Cuba está en UTC-4/-5, así que si guardamos
// vales con new Date().toISOString() (UTC), una venta a las 21:00 local se guarda
// como 01:00 del día siguiente en UTC. Usar localDay() en todos los filtros de
// fecha para que Estadísticas, Historial y el dashboard cuenten el mismo día.
// Ver AUDITORIA-AXONTECH.md ALTO 5.
const localDay = d => {
  const x = (d instanceof Date) ? d : new Date(d);
  if (isNaN(x.getTime())) return '';
  return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;
};
const timeStr     = ts => new Date(ts).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'});
function nowDateTime() {
  const d=new Date();
  const dd=String(d.getDate()).padStart(2,'0');
  const mm=String(d.getMonth()+1).padStart(2,'0');
  const yy=d.getFullYear();
  const hh=d.getHours().toString().padStart(2,'0');
  const mi=d.getMinutes().toString().padStart(2,'0');
  return `${dd}/${mm}/${yy} ${hh}:${mi}`;
}
function timeAgo(dateString) {
  if(!dateString)return '—';
  const d=new Date(dateString);
  if(isNaN(d.getTime()))return '—';
  const now=new Date();const diffMs=now-d;
  if(isNaN(diffMs))return '—';
  const diffMins=Math.floor(diffMs/60000);
  if(diffMins<1)return 'Ahora';
  if(diffMins<60)return diffMins+'m';
  const diffHours=Math.floor(diffMins/60);
  if(diffHours<24)return diffHours+'h';
  const diffDays=Math.floor(diffHours/24);
  return diffDays+'d';
}
const pendingCount= () => getVales().filter(v=>v.status==='pending').length;
const pendingOf   = gId=> { const n=Number(gId); return getVales().filter(v=>v&&v.gestorId!=null&&Number(v.gestorId)===n&&v.status==='pending').length; };
const todayValesOf= gId=> { const n=Number(gId); return getVales().filter(v=>v&&v.gestorId!=null&&Number(v.gestorId)===n&&new Date(v.ts).toDateString()===todayStr()).length; };



// ══════════════════════════════════════════
//  FIREBASE WRITE QUEUE — prevents data loss with persistence + retries
// ══════════════════════════════════════════
const _fbWriteQueue = [];
let _fbProcessing = false;
const _FAILED_WRITES_LIMIT = 100;
// Último error real de un write a Firestore (código + mensaje), para el
// panel de diagnóstico (tocar el indicador de sync) — antes esta
// información solo quedaba en la consola del navegador, invisible en un
// teléfono, lo que hacía muy difícil saber POR QUÉ algo se quedaba
// "pegado" sin pedirle capturas de pantalla de la consola al dueño.
let _lastSyncError = null;
// ── In-Flight Merge Buffer (v13) ──
// Cuando un write a Firebase está EN PROCESO (op in flight), no está en
// _fbWriteQueue — fue shift()ado. Si llega otro saveVales con más vales
// mientras tanto, ANTES se creaba un segundo item encolado. Eso causaba:
//   - Si el primer write tarda 8s (timeout), el segundo espera 8s+ para empezar.
//   - Si el gestor manda 5 vales en 5s, se acumulan 5 items encolados, cada uno
//     con su versión parcial del estado, todos esperando al primero.
// Ahora: si el path que llega coincide con el path que está EN PROCESO,
// fusionamos el nuevo value en _fbInFlightPending[path]. Cuando el write
// actual termina (éxito, fallo, o timeout), el buffer se encola
// automáticamente como un NUEVO write, y se procesa después.
// Resultado: como máximo 1 write encolado esperando, sin importar cuántos
// saveVales se llamen durante el procesamiento.
const _fbInFlightPending = {};  // { path: { value, method } }

// Persist queue to localStorage so it survives reloads / tab closes
function _persistQueue() {
  try {
    // Only persist non-callback items (callbacks are not serializable).
    // chunked se persiste también — si no, un chunk sobreviviente a un
    // reload perdería su protección contra re-fusionarse con otro write
    // (ver comentario en _enqueueFB sobre por qué existe este flag).
    const serializable = _fbWriteQueue.map(({path, value, method, retries, chunked}) => ({path, value, method, retries, chunked}));
    localStorage.setItem('axon_pending_writes', JSON.stringify(serializable));
  } catch(e) {/* storage full or unavailable */}
  _updateSyncIndicator();
}

// ── v17: Estimación adaptativa del throughput efectivo ──
// Antes se asumía 6 KB/s fijos (50 Kbit/s). En 10 Kbit/s reales (~1.2 KB/s
// efectivos con overhead WS+TLS), los timeouts eran demasiado cortos para
// writes medianos → reintentos → saturación del enlace → "vales que no llegan".
// Ahora usamos navigator.connection.downlink (si disponible) para estimar
// el throughput real, con un floor conservador de 500 B/s (conexión muy mala)
// y un techo de 20 KB/s (no tiene sentido asumir más para Firebase RTDB).
const _fbEncoder = (typeof TextEncoder !== 'undefined') ? new TextEncoder() : null;
let _currentWriteTimeout = 8000; // último timeout calculado — accesible desde el indicador
function _estimateEffectiveThroughputBytesPerSec() {
  // Default conservador: 1.5 KB/s (cubre 10 Kbit/s con overhead)
  let bps = 1500;
  try {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn) {
      if (conn.downlink && conn.downlink > 0) {
        // downlink viene en Mbps. Convertir a bytes/s efectivos.
        // Factor 0.4 = overhead WS + TLS + JSON en el wire (~60% perdido).
        bps = Math.max(500, Math.min(conn.downlink * 1000000 / 8 * 0.4, 20000));
      } else if (conn.effectiveType) {
        const map = { 'slow-2g':500, '2g':1000, '3g':3000, '4g':8000 };
        bps = map[conn.effectiveType] || 1500;
      }
    }
  } catch(_) {}
  return bps;
}
// Calcula el tamaño real del payload en bytes UTF-8 (no chars JS).
// Los caracteres no-ASCII (acentos, ñ, emojis) ocupan 1-4 bytes en el wire.
function _payloadBytes(value) {
  if (value === null || value === undefined) return 0;
  try {
    const s = JSON.stringify(value);
    if (_fbEncoder) return _fbEncoder.encode(s).length;
    return s.length; // fallback para navegadores viejos
  } catch(_) { return 0; }
}

// ── Traducción de operaciones de la cola (RTDB-shaped) a Firestore ──
// La cola (_fbWriteQueue) sigue hablando en términos de "path" + "value" +
// "method" tal como se diseñó para RTDB — eso deja intacta toda la lógica de
// reintentos/timeout/backoff/buffer-in-flight de _processFBQueue, que no le
// importa CÓMO se hace el write, solo que devuelva una Promise. Esta función
// es el único punto que traduce esa forma a llamadas reales de Firestore.
//
// Dos formas de "path" llegan aquí:
//  - Nodos singleton (config/notifs/estafa/ranking_summary): un solo
//    documento en meta/{nodo}. method 'set' reemplaza el doc completo,
//    'update' hace merge de campos, 'remove' lo borra.
//  - Colecciones de entidades (gestores/mensajeros/productos/categorias/
//    vales) y 'backups/...': 'value' es un objeto {id: entidad|null, ...}
//    (method 'update', construido por _buildCollectionUpdates — ver saveX())
//    que se traduce a un batched write: cada entrada no-null es un
//    set(...,{merge:true}) de ese documento, cada null es un delete().
const _FS_SINGLETON_DOCS = {
  config: 'config',
  notifs: 'notifs',
  estafa: 'estafa',
  ranking_summary: 'ranking_summary',
};
// En Supabase el JSONB acepta arrays directamente como valor raíz, así que
// ya no hace falta envolver en {items:[...]}. Set vacío por compatibilidad.
const _FS_ARRAY_SINGLETONS = new Set([]);

// ── v31: Traduce operaciones de la cola (forma RTDB/Firestore) a Supabase ──
// La cola _fbWriteQueue sigue hablando en términos de "path" + "value" +
// "method" — eso deja intacta toda la lógica de reintentos/timeout/backoff
// de _processFBQueue, que no le importa CÓMO se hace el write, solo que
// devuelva una Promise. Esta función es el único punto que traduce esa
// forma a llamadas reales de Supabase REST.
function _supabaseOpFor(path, value, method) {
  const _tooLarge = v => { try { return JSON.stringify(v).length > 900000; } catch(e) { return false; } };
  const skipped = [];

  // ── Singleton (config/notifs/estafa/ranking_summary) → meta/{name} ──
  if (_FS_SINGLETON_DOCS[path]) {
    const name = _FS_SINGLETON_DOCS[path];
    if (method === 'remove') return _sbRestMetaDelete(name);
    return _sbRestMetaUpsert(name, value);
  }

  // ── backups/{key}: doc único con path ya armado ──
  if (path.startsWith('backups/')) {
    const key = path.split('/').slice(1).join('/');
    if (!key) return Promise.resolve();
    if (method === 'remove') {
      const url = `${_SB_REST}/backups?name=eq.${encodeURIComponent(key)}`;
      return fetch(url, { method: 'DELETE', headers: _SB_AUTH_HDRS })
        .then(r => { if (!r.ok && r.status !== 404) throw new Error(`Supabase DELETE backups/${key} ${r.status}`); });
    }
    const url = `${_SB_REST}/backups`;
    const body = JSON.stringify([{ name: key, data: value }]);
    return fetch(url, {
      method: 'POST',
      headers: { ..._SB_AUTH_HDRS, 'Prefer': 'resolution=merge-duplicates' },
      body: body,
    }).then(r => {
      if (!r.ok) return r.text().then(t => { throw new Error(`Supabase BACKUPS UPSERT ${key} ${r.status}: ${t.slice(0,150)}`); });
    });
  }

  // ── Colección de entidades (gestores, mensajeros, productos, categorias, vales) ──
  const collName = path.split('/')[0];

  if (method === 'remove') {
    const docId = path.includes('/') ? path.split('/').pop() : null;
    if (!docId) return Promise.resolve();
    return _sbRestDelete(collName, docId);
  }

  if (Array.isArray(value)) {
    const items = [];
    value.forEach(item => {
      if (!item || item.id == null) return;
      if (_tooLarge(item)) { skipped.push(String(item.id)); return; }
      items.push({ id: Number(item.id), value: item });
    });
    if (skipped.length > 0) {
      console.error(`[supabase] ${skipped.length} doc(s) omitido(s) en '${collName}' por exceder ~900KB:`, skipped);
      showToast(`⚠️ ${skipped.length} elemento(s) de ${collName} no se pudieron subir (demasiado grande) — usa "☁️ Fotos a GitHub" en Stock`);
    }
    return _sbRestUpsertBatch(collName, items);
  }

  if (value && typeof value === 'object') {
    const upsertItems = [];
    const deleteIds = [];
    Object.entries(value).forEach(([key, val]) => {
      const docId = key.includes('/') ? key.split('/').pop() : key;
      if (val === null) { if (!isNaN(Number(docId))) deleteIds.push(Number(docId)); return; }
      if (_tooLarge(val)) { skipped.push(docId); return; }
      const idNum = (val && typeof val === 'object' && val.id != null) ? Number(val.id) : Number(docId);
      if (!isNaN(idNum)) upsertItems.push({ id: idNum, value: val });
    });
    if (skipped.length > 0) {
      console.error(`[supabase] ${skipped.length} doc(s) omitido(s) en '${collName}' por exceder ~900KB:`, skipped);
      showToast(`⚠️ ${skipped.length} elemento(s) de ${collName} no se pudieron subir (demasiado grande) — usa "☁️ Fotos a GitHub" en Stock`);
    }
    const ops = [];
    if (upsertItems.length > 0) ops.push(_sbRestUpsertBatch(collName, upsertItems));
    if (deleteIds.length > 0) ops.push(_sbRestDeleteBatch(collName, deleteIds));
    if (ops.length === 0) return Promise.resolve();
    return Promise.all(ops).then(() => {});
  }

  console.warn('[supabase] _supabaseOpFor: operación no reconocida:', { path, method, valueType: typeof value });
  return Promise.resolve();
}
// Alias retrocompatible: _processFBQueue sigue llamando a _firestoreOpFor.
const _firestoreOpFor = _supabaseOpFor;

function _processFBQueue() {
  // v14: Si Firebase NO está conectado (_fbConnected === false), NO intentar
  // hacer el write. En redes muy malas, el WebSocket de Firebase puede tardar
  // 5-10s en establecerse, y cada write intentado fallaría tras el timeout
  // de 8s. En su lugar, dejamos los items en la cola y esperamos a que el
  // evento 'online' del navegador dispare _processFBQueue() cuando vuelva la
  // conexión. El indicador muestra "Sin conexión a la nube" para que el
  // usuario sepa que sus vales están guardados localmente.
  if (_fbProcessing || _fbWriteQueue.length === 0) {
    _updateSyncIndicator();
    return;
  }
  if (!_fbConnected) {
    // Firebase desconectado — NO intentar writes. Los items se quedan en
    // la cola (persistida en localStorage). El evento 'online' del navegador
    // llamará a _processFBQueue() cuando se reconecte.
    _updateSyncIndicator();
    return;
  }
  _fbProcessing = true;
  _updateSyncIndicator();
  const item = _fbWriteQueue.shift();
  item.retries = (item.retries || 0) + 1;
  const {path, method, callback, chunked} = item;
  let value = item.value;  // v15: mutable, podemos filtrarle vales ya synced

  // ── v15 BUGFIX: filtrar vales ya synced del payload ANTES de enviar ──
  // Si este item fue reencolado tras un timeout (que en realidad SÍ subió los
  // datos a Firebase pero no recibimos el ack a tiempo), los vales que contiene
  // pueden ya estar marcados como synced:true en localStorage. Volver a mandarlos
  // es desperdicio de ancho de banda en redes lentas y causa la sensación de
  // "vuelve a sincronizar todos". Aquí filtramos esos vales antes del write.
  // Solo aplica a writes de vales (path 'vales' o 'vales/{gestorId}'), method 'update'.
  //
  // v40 FIX CRÍTICO: ANTES este filtro se aplicaba a TODOS los writes, no solo
  // a retries. Como el polling del admin marca TODOS los vales con synced:true,
  // cualquier patchVale posterior (cambiar status, seenByAdmin, etc.) era
  // DROPEADO silenciosamente → los cambios nunca llegaban a Supabase → el
  // gestor nunca veía "Visto por admin", "Con mensajero", "Venta confirmada".
  // Ahora solo filtramos en retries (item.retries > 1), que era la intención
  // original del comentario.
  if (item.retries > 1 && method === 'update' && value && typeof value === 'object' &&
      (path === 'vales' || path.startsWith('vales/'))) {
    const syncedIds = new Set(
      getVales()
        .filter(v => v.synced === true)
        .map(v => String(v.id))
    );
    if (syncedIds.size > 0) {
      const filtered = {};
      let dropped = 0;
      Object.entries(value).forEach(([k, v]) => {
        if (v === null) { filtered[k] = null; return; }  // borrados siempre se mandan
        // La key ya es siempre el id plano del vale (colección 'vales' plana
        // en Firestore) — se prefiere v.id cuando el valor trae uno propio.
        const objVid = (v && typeof v === 'object' && v.id != null) ? String(v.id) : k;
        if (syncedIds.has(objVid)) { dropped++; return; }
        filtered[k] = v;
      });
      if (dropped > 0) {
        console.log(`[sync] Filtering ${dropped} already-synced vale(s) from retry of ${path}`);
        value = filtered;
        item.value = filtered;  // mutar el item para que la persistencia también refleje el filtrado
        if (Object.keys(filtered).length === 0) {
          // Nada que escribir — todos los vales del item ya están synced.
          // Descartar el item y procesar el siguiente sin tocar Firebase.
          console.log(`[sync] All vales in retry item already synced — skipping write`);
          _fbProcessing = false;
          _persistQueue();
          // Procesar in-flight buffer por si llegaron cambios mientras tanto
          // (no debería porque no inicializamos el buffer todavía).
          _processFBQueue();
          return;
        }
      }
    }
  }

  // ── Inicializar buffer in-flight para este path ──
  // Si durante el procesamiento de este write llegan más saveVales al mismo
  // path, se acumularán en _fbInFlightPending[path]. Al terminar, los
  // flushearemos como un nuevo write.
  // !chunked: un chunk de _enqueueFBChunked NO abre buffer in-flight —
  // si lo hiciera, un write nuevo y no relacionado que llegue mientras este
  // chunk puntual está en el aire se fusionaría en él, volviendo a inflar
  // ese chunk por encima del tamaño por el que se troceó (ver comentario en
  // _enqueueFB). Los chunks hermanos siguientes ya se encolan como items
  // independientes (chunked:true), así que no necesitan este buffer.
  if (callback === null && !chunked && (method === 'set' || method === 'update')) {
    _fbInFlightPending[path] = { value: method === 'update' ? {} : null, method };
  }
  // _firestoreOpFor puede lanzar SÍNCRONAMENTE (ej. un campo con valor
  // undefined en algún objeto armado a mano, que Firestore rechaza antes de
  // tocar la red). Sin este try/catch, esa excepción se escapaba de
  // _processFBQueue() entero y dejaba _fbProcessing atascado en true para
  // siempre — congelando TODA sincronización futura hasta recargar la
  // página. Convertirlo en una promesa rechazada deja que el .then()/.catch()
  // de abajo lo trate exactamente igual que cualquier otro fallo de red
  // (reintento con backoff y, si persiste, descarte a axon_failed_writes sin
  // trabar la cola).
  let op;
  try {
    op = _firestoreOpFor(path, value, method);
  } catch (syncErr) {
    console.error('[firestore] error síncrono armando el write:', syncErr);
    op = Promise.reject(syncErr);
  }
  // Flag para que el .finally sepa si el catch ya reencoló el item (y por tanto
  // no debe liberar el candado ni arrancar un segundo consumidor).
  let requeued = false;
  let settled = false;  // evita doble procesamiento si el timeout dispara después del settle

  // ── Helper: flush del buffer in-flight ──
  // Si llegaron más actualizaciones al mismo path mientras este write estaba
  // en proceso, encolarlas como un nuevo item. Se llama desde los 3 caminos
  // de salida (éxito, fallo, timeout) ANTES de liberar el candado.
  function _flushInFlight() {
    const pending = _fbInFlightPending[path];
    delete _fbInFlightPending[path];
    if (!pending) return;
    if (pending.method === 'update' && pending.value && typeof pending.value === 'object' && Object.keys(pending.value).length > 0) {
      _fbWriteQueue.push({path, value: pending.value, method: 'update', callback: null, retries: 0});
    } else if (pending.method === 'set' && pending.value !== null) {
      _fbWriteQueue.push({path, value: pending.value, method: 'set', callback: null, retries: 0});
    }
    // Si pending.value es null (set con null) o {} (update vacío), no hay nada que escribir.
  }

  // ── Timeout de seguridad ADAPTATIVO (v15, refinado en v17) ──
  // ANTES (v13/v14): timeout fijo de 8s. En 3G cubano, un write exitoso tarda
  // 1-3s; si llega a 8s es que la red está caída.
  // PROBLEMA: en redes de 50Kbit/s (~6KB/s), un write de 50KB (p.ej. 100 vales
  // batched) tarda 8s solo en subirlo. El timeout disparaba ANTES de que el write
  // terminara, causando reintentos que mandaban el MISMO payload 4 veces
  // (166KB desperdiciados en un link de 50Kbit/s = 27s de airtime).
  // v15: timeout escalado al tamaño del payload con 6KB/s fijo.
  // v17: estimación REAL del throughput con navigator.connection.downlink.
  // A 10 Kbit/s reales, 6KB/s es optimista por 5x → timeouts demasiado cortos
  // → writes erroneamente reintentados → saturación del enlace.
  // v22 (Firestore): se forzó experimentalForceLongPolling porque Cuba corta
  // conexiones streaming de larga duración (WebSocket-like). Long-polling
  // (peticiones HTTP cortas repetidas) típicamente tiene MÁS latencia de ida
  // y vuelta que una conexión persistente, sobre todo con pérdida de
  // paquetes — el +3000ms de RTT calibrado para WebSocket se quedaba corto,
  // generando timeouts espurios (reintentos innecesarios) en writes que en
  // realidad iban a terminar bien, solo que un poco más lento.
  // Fórmula: timeout = (payloadBytes / effectiveBps) * 1.3 + 6000ms (RTT long-polling)
  // Cap máximo: 90s (antes 45s) para writes grandes en redes muy malas.
  // Cap mínimo: 12s para writes pequeños (evita falsos timeout en redes con
  // alta latencia inicial + varias peticiones HTTP de ida y vuelta).
  const payloadBytes = _payloadBytes(value);
  const effectiveBps = _estimateEffectiveThroughputBytesPerSec();
  // ×1.3 safety margin para overhead real (headers HTTP repetidos, JSON parsing, ack)
  const estimatedMs = Math.ceil((payloadBytes / effectiveBps) * 1000 * 1.3) + 6000;
  const adaptiveTimeout = Math.min(90000, Math.max(12000, estimatedMs));
  _currentWriteTimeout = adaptiveTimeout;  // exponer para el indicador de sync
  const timeoutId = setTimeout(() => {
    if (settled) return;
    settled = true;
    console.warn(`Firebase write TIMEOUT (${adaptiveTimeout}ms, payload=${payloadBytes}B, est=${effectiveBps}B/s):`, path);
    _lastSyncError = { code: 'timeout', msg: `sin respuesta tras ${Math.round(adaptiveTimeout/1000)}s`, ts: Date.now(), path };
    // Flush del buffer in-flight ANTES de reencolar el item.
    // Si el gestor mandó 5 vales mientras este write estaba colgado, esos 5
    // vales están en _fbInFlightPending[path] y deben encolarse como un nuevo
    // write, no perderse.
    _flushInFlight();
    if (item.retries < 4) {
      requeued = true;
      _fbWriteQueue.unshift(item);
      _persistQueue();
      // v17: Backoff exponencial con jitter para evitar thundering herd.
      // Si varios gestores están reintentando a la vez sobre el mismo enlace
      // saturado, backoffs sin jitter se sincronizan y empeoran la congestión.
      const base = Math.min(1000 * Math.pow(2, item.retries), 30000);
      const jitter = Math.random() * 500;
      const delay = base + jitter;
      setTimeout(() => { _fbProcessing = false; _processFBQueue(); }, delay);
    } else {
      // Demasiados reintentos — descartar y seguir con el siguiente.
      // El item se puede recuperar desde _ensurePendingValesEnqueued() cuando
      // vuelva la conexión (para vales), o desde axon_failed_writes (otros).
      _fbProcessing = false;
      _persistQueue();
      _processFBQueue();
    }
  }, adaptiveTimeout);

  op.then(() => {
      // ── v15 BUGFIX: si el timeout de 8s ya disparó y reencoló el item,
      // NO procesar el éxito del write original. El item ya está en la cola
      // esperando retry. Marcar vales como synced sería prematuro (el retry
      // podría fallar), y _flushInFlight ya fue llamado por el timeout.
      // ANTES este guard faltaba → si el write tardaba 9s en una red de 50Kbit/s,
      // el timeout disparaba a los 8s (reencolaba el item) Y el .then disparaba
      // a los 9s (marcaba vales synced, llamaba _markSyncSuccess). Resultado:
      // duplicate writes, indicador cambiando entre Sincronizando/En línea.
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      if(callback) callback();
      // Marcar vales como synced cuando su write a Firebase se confirma.
      // Esto funciona incluso tras recargar la página porque el `value` del
      // item encolado sí es serializable y se persiste en axon_pending_writes.
      _markValesSyncedFromUpdate(path, value);
      // Flush del buffer in-flight: si llegaron más cambios al mismo path
      // durante este write, encolarlos ahora.
      _flushInFlight();
      // Actualizar el indicador con timestamp de última sync exitosa.
      _markSyncSuccess();
      // Liberar el candado y procesar el siguiente item de la cola.
      _fbProcessing = false;
      _persistQueue();
      _processFBQueue();
    })
    .catch(e => {
      if (settled) return;  // el timeout o el .then ya manejaron este item
      settled = true;
      clearTimeout(timeoutId);
      console.error("Firebase write error:", e);
      _lastSyncError = { code: (e && e.code) ? e.code : 'desconocido', msg: (e && e.message) ? e.message : String(e), ts: Date.now(), path };
      // Mostrar el motivo real del error al usuario (antes solo quedaba en la
      // consola, invisible en un teléfono). 'permission-denied' es la causa
      // más común de un write que nunca sincroniza: las reglas de seguridad
      // de Firestore lo están bloqueando (typicamente porque la base se creó
      // en "modo producción" — deniega todo por defecto hasta pegar reglas).
      if (item.retries === 1 || item.retries >= 4) {
        const code = (e && e.code) ? e.code : 'desconocido';
        showToast(code === 'permission-denied'
          ? '⚠️ La nube rechazó el guardado (permisos) — avisa al admin, tu vale queda guardado en el teléfono'
          : `⚠️ Error de sincronización (${code}) — tu vale queda guardado localmente`);
      }
      // Flush del buffer in-flight antes de reencolar (igual que en timeout).
      _flushInFlight();
      if (item.retries < 4) {
        // Reencolar YA (no en el setTimeout) para que sobreviva a un cierre
        // de la app durante el backoff. Antes el item se perdía porque el
        // finally persistía la cola sin él.
        requeued = true;
        _fbWriteQueue.unshift(item);
        _persistQueue();
        // v17: backoff exponencial con jitter (igual que en timeout).
        // Antes Math.pow(1.5, retries) era demasiado corto en redes lentas y
        // sin jitter → si varios gestores reintentaban a la vez, saturaban.
        const base = Math.min(1000 * Math.pow(2, item.retries), 30000);
        const jitter = Math.random() * 500;
        const delay = base + jitter;
        setTimeout(() => { _fbProcessing = false; _processFBQueue(); }, delay);
        return;
      }
      console.error("Firebase write permanently failed:", path);
      try {
        const failed = JSON.parse(localStorage.getItem('axon_failed_writes') || '[]');
        failed.push({path, value, method, ts: new Date().toISOString()});
        if (failed.length > _FAILED_WRITES_LIMIT) failed.splice(0, failed.length - _FAILED_WRITES_LIMIT);
        localStorage.setItem('axon_failed_writes', JSON.stringify(failed));
      } catch(e2) {}
      // ── v15 BUGFIX: tras descarte permanente, liberar el candado y seguir
      // con el siguiente item. ANTES esto lo hacía el .finally, pero el guard
      // `if (settled) return` impedía que se ejecutara cuando el .catch ya había
      // seteado settled=true → el lock _fbProcessing se quedaba pillado para
      // siempre, bloqueando todos los writes futuros.
      _fbProcessing = false;
      _persistQueue();
      _processFBQueue();
    })
    .finally(() => {
      // .finally se ejecuta SIEMPRE después de .then o .catch. Pero como ambos
      // ya setearon settled=true y liberaron el candado (o programaron el
      // setTimeout para liberarlo tras backoff), aquí no hay nada que hacer.
      // El guard `if (settled) return` es defensa extra: si por algún edge case
      // ni el .then ni el .catch se ejecutaron (imposible en teoría), no hacer nada.
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      _flushInFlight();
      _fbProcessing = false;
      _persistQueue();
      _processFBQueue();
    });
}

// ══════════════════════════════════════════════════════════════════
//  ENQUEUE WITH MERGE (queue + in-flight)
// ══════════════════════════════════════════════════════════════════
// (El buffer _fbInFlightPending se declara arriba, junto con _fbWriteQueue.)
function _enqueueFB(path, value, method='set', callback=null, skipMerge=false) {
  // ── Batching para conexiones lentas ──
  // Antes: cada saveVales() encolaba un item separado. Si un gestor enviaba
  // 3 vales seguidos + editaba 1, habían 4 items encolados sobre paths
  // relacionados, cada uno → 1 HTTP request. En 3G cada write = 800ms–2s.
  // Ahora: si hay items pendientes al MISMO path (o path padre del mismo
  // método 'set'/'update'), los fusionamos. Solo importa el ÚLTIMO valor.
  // Caso típico: saveVales() del gestor encola 'update' en 'vales/{gestorId}'.
  // Si llegan 3 saveVales seguidos, los 3 updates se fusionan en 1 solo.
  // BUGFIX: _enqueueFBChunked() parte un update grande en varios chunks de
  // ~6KB CADA UNO A PROPÓSITO (para que un corte de red a medio camino solo
  // pierda un chunk, no todo el lote). Pero como cada chunk se encola con
  // esta MISMA función, el chunk #1 quedaba "in-flight" apenas se llamaba
  // _processFBQueue() (síncrono hasta el batch.commit()), y los chunks
  // #2..#N —encolados milisegundos después, en el mismo forEach— se
  // fusionaban de vuelta en el buffer in-flight del chunk #1 (ver
  // "In-Flight Merge Buffer" abajo). Al terminar el chunk #1, ese buffer
  // se re-encolaba como UN SOLO write con TODOS los chunks juntos —
  // deshaciendo el troceo por completo. Para un borrado grande (cientos de
  // vales), esto podía volver a superar el límite de 500 operaciones por
  // batch de Firestore, fallando siempre. `skipMerge=true` (usado solo por
  // _enqueueFBChunked) hace que cada chunk se encole como item
  // INDEPENDIENTE, sin fusionarse con otros chunks del mismo troceo.
  if (callback === null && !skipMerge) {
    // Solo fusionar items sin callback (los callbacks no son serializables
    // y normalmente corresponden a operaciones críticas que no se fusionan).
    const methodIsMergeable = (method === 'set' || method === 'update');
    if (methodIsMergeable) {
      // ── NUEVO v13: fusionar también con el buffer in-flight ──
      // Si hay un write EN PROCESO para el mismo path+method, meter el nuevo
      // value en el buffer. Se encolará cuando el write actual termine.
      // Así evitamos acumular items encolados mientras el primero tarda 8s.
      if (_fbProcessing && _fbInFlightPending[path] &&
          _fbInFlightPending[path].method === method) {
        if (method === 'update' && _fbInFlightPending[path].value &&
            typeof _fbInFlightPending[path].value === 'object' &&
            value && typeof value === 'object') {
          Object.assign(_fbInFlightPending[path].value, value);
        } else {
          _fbInFlightPending[path].value = value;
        }
        _updateSyncIndicator();
        return; // Ya está agendado para enviarse cuando termine el write actual.
      }
      // Buscar items pendientes con el mismo path y mismo método → reemplazar.
      // También fusionar: si llega 'set' para 'vales' y hay 'update' pendiente
      // para 'vales/X', el 'set' los sobreescribe a todos.
      for (let i = _fbWriteQueue.length - 1; i >= 0; i--) {
        const existing = _fbWriteQueue[i];
        // !existing.chunked: un chunk de _enqueueFBChunked nunca acepta que
        // OTRO write (chunk hermano o no) se le fusione encima — rompería
        // el límite de tamaño por el que se troceó en primer lugar.
        if (existing.path === path && (existing.method === method) && !existing.chunked) {
          // Mismo path, mismo método → fusionar valores (para 'update') o reemplazar (para 'set').
          if (method === 'update' && existing.value && typeof existing.value === 'object' && value && typeof value === 'object') {
            // Merge profundo de claves: el nuevo value gana sobre el existente.
            Object.assign(existing.value, value);
          } else {
            // 'set' o 'update' con value no-objeto: reemplazar el valor anterior.
            existing.value = value;
          }
          _persistQueue();
          _processFBQueue();
          return; // No agregar nuevo item.
        }
        // Caso: nuevo 'set' a un path padre invalida 'update'/'set' pendientes a subpaths.
        // Ej: nuevo set('vales', fullObj) invalida update('vales/gestorId', {...}) pendiente.
        // (Solo aplicable a 'set' — el set reemplaza todo el subtree.)
        if (method === 'set' && (existing.path === path + '/' || existing.path.startsWith(path + '/'))) {
          _fbWriteQueue.splice(i, 1);
        }
      }
    }
  }
  _fbWriteQueue.push({path, value, method, callback, chunked: skipMerge});
  _persistQueue();
  _processFBQueue();
}

// ── v17: Chunking automático para writes grandes ──
// En redes de 10 Kbit/s (~1.2 KB/s), un write de 30 KB (25 vales batched)
// tarda 25s en subir. Si la conexión se cae a mitad, TODO el batch se
// reintenta desde cero. Partir en chunks de ~6 KB permite que cada chunk
// se complete en ~5s y si uno falla, solo se reintenta ese, no todo el lote.
// Solo aplica a method 'update' (que es multi-clave por naturaleza).
function _enqueueFBChunked(path, updates, method='update') {
  if (method !== 'update' || !updates || typeof updates !== 'object') {
    // No es actualizable por chunks → pasar directo
    return _enqueueFB(path, updates, method);
  }
  const keys = Object.keys(updates);
  if (keys.length === 0) return;

  // Calcular tamaño total del payload
  let totalBytes;
  try { totalBytes = _payloadBytes(updates); } catch(_) { totalBytes = 0; }

  // Si el payload total es pequeño (≤ 6 KB), no partir
  const MAX_CHUNK_BYTES = 6000;
  if (totalBytes <= MAX_CHUNK_BYTES) {
    return _enqueueFB(path, updates, method);
  }

  // Partir en chunks respetando el límite de bytes por chunk.
  // Cada chunk es un subconjunto de claves del objeto updates original.
  let current = {};
  let currentSize = 0;
  const chunks = [];
  for (const k of keys) {
    const val = updates[k];
    // Estimar tamaño de esta clave+valor: longitud de la key + longitud del JSON del value + comillas y ":"
    let valSize;
    try { valSize = _payloadBytes(val) + k.length + 4; } catch(_) { valSize = 100; }
    // Si agregar este item excede el límite Y ya tenemos items en el chunk actual, cerrarlo
    if (currentSize + valSize > MAX_CHUNK_BYTES && Object.keys(current).length > 0) {
      chunks.push(current);
      current = {};
      currentSize = 0;
    }
    current[k] = val;
    currentSize += valSize;
  }
  if (Object.keys(current).length > 0) chunks.push(current);

  console.log(`[sync] Splitting ${keys.length} updates into ${chunks.length} chunks (~${MAX_CHUNK_BYTES}B each, total ${totalBytes}B)`);
  // skipMerge=true: cada chunk es su propio item de cola, nunca se
  // refusiona con otro chunk hermano (ver comentario en _enqueueFB).
  chunks.forEach(chunk => _enqueueFB(path, chunk, method, null, true));
}

// ══════════════════════════════════════════
//  SYNCED TRACKING — marca vales como realmente subidos a Firebase
// ══════════════════════════════════════════
// Cuando un gestor envía un vale en condiciones de red mala, el vale se guarda
// localmente con synced:false y se encola el write. Si la app se cierra antes
// de que el write se confirme, el vale queda "huérfano": el gestor lo ve como
// enviado pero el admin nunca lo recibe. Esta función se llama desde el .then()
// de _processFBQueue cuando el write se confirma, y marca los vales afectados
// como synced:true en localStorage (sin re-encolar otro write a Firebase).
function _markValesSyncedFromUpdate(path, value) {
  if (!value || typeof value !== 'object') return;
  // Solo nos interesan los writes a 'vales' o 'vales/{gestorId}'
  if (path !== 'vales' && !path.startsWith('vales/')) return;
  // Extraer los IDs de vales que se acaban de confirmar.
  // `value` puede ser:
  //   - Para 'set': { gestorId: { valeId: {...}, ... }, ... }
  //   - Para 'update' en 'vales': { 'gestorId/valeId': {...}, ... }
  //   - Para 'update' en 'vales/gestorId': { valeId: {...}, ... }
  let syncedIds = [];
  try {
    if (path === 'vales') {
      // update con claves 'gestorId/valeId'
      Object.entries(value).forEach(([k, v]) => {
        if (v && typeof v === 'object' && v.id) syncedIds.push(v.id);
        else if (v && typeof v === 'object') {
          // podría ser 'set' con estructura anidada {gestorId: {valeId: {...}}}
          Object.entries(v).forEach(([vid, vv]) => {
            if (vv && typeof vv === 'object' && vv.id) syncedIds.push(vv.id);
          });
        }
      });
    } else {
      // path = 'vales/gestorId', value = { valeId: {...}, ... }
      Object.entries(value).forEach(([k, v]) => {
        if (v && typeof v === 'object' && v.id) syncedIds.push(v.id);
      });
    }
  } catch (e) {
    console.warn('_markValesSyncedFromUpdate parse error:', e);
    return;
  }
  if (syncedIds.length === 0) return;
  // Actualizar el cache local SIN encolar otro write a Firebase.
  const all = getVales();
  let changed = false;
  for (let i = 0; i < all.length; i++) {
    if (syncedIds.includes(all[i].id) && all[i].synced !== true) {
      all[i].synced = true;
      changed = true;
    }
  }
  if (changed) {
    _safeSetLS('axon_vales', JSON.stringify(all));
    _valesCache = all;
    _valesDirty = false;
    _updatePendingSyncBanner();
    // Refrescar la lista de vales del gestor si está visible.
    if (typeof renderMyVales === 'function') {
      try { renderMyVales(); } catch (_) {}
    }
  }
}

// Cuenta cuántos vales del gestor activo (o todos si es admin) están pendientes
// de sincronizar (synced:false). Excluye los vales cancelados (no necesitan subirse).
function _countPendingSyncVales() {
  const all = getVales();
  return all.filter(v =>
    v.synced !== true &&
    v.status !== 'cancelled'
  ).length;
}

// Muestra/oculta el banner de "N vales pendientes de sincronizar".
// Se llama desde sendVale, _markValesSyncedFromUpdate, online/offline events,
// y al renderizar la lista de vales.
function _updatePendingSyncBanner() {
  const banner = document.getElementById('pendingSyncBanner');
  if (!banner) return;
  const count = _countPendingSyncVales();
  const txt = banner.querySelector('[data-pending-count]');
  if (count > 0) {
    if (txt) txt.textContent = count;
    banner.style.display = 'flex';
    // Cambiar el ícono/texto según si hay conexión o no
    const msg = banner.querySelector('[data-pending-msg]');
    if (msg) {
      msg.textContent = _onlineStatus
        ? `Subiendo ${count} vale${count === 1 ? '' : 's'} a la nube…`
        : `${count} vale${count === 1 ? '' : 's'} guardado${count === 1 ? '' : 's'} sin conexión · Se enviará${count === 1 ? '' : 'n'} al volver la conexión`;
    }
  } else {
    banner.style.display = 'none';
  }
  // También actualizar el indicador de sync estándar
  _updateSyncIndicator();
}

// On startup: re-enqueue persisted writes
try {
  const pending = JSON.parse(localStorage.getItem('axon_pending_writes') || '[]');
  if (Array.isArray(pending) && pending.length) {
    pending.forEach(item => _fbWriteQueue.push(item));
    // Clear persisted copy; will be re-persisted as queue processes
    localStorage.removeItem('axon_pending_writes');
    // Defer first attempt to give Firebase time to init
    setTimeout(_processFBQueue, 1500);
  }
} catch(e) {}

// ── Sync indicator (online/offline/pending) ──
let _onlineStatus = navigator.onLine;
let _lastSyncAt = 0;  // timestamp del último write exitoso
let _lastSyncAtStr = '';  // string formateado para mostrar
let _lastSyncCheckTs = 0;  // para actualizar el "hace Xs" cada 30s
function _updateSyncIndicator() {
  const ind = document.getElementById('syncIndicator');
  const lbl = document.getElementById('syncLabel');
  if (!ind || !lbl) return;
  const pendingCount = _fbWriteQueue.length;
  if (!_onlineStatus) {
    ind.className = 'offline';
    lbl.textContent = 'Sin conexión';
    ind.title = _lastSyncAtStr ? `Última sync: ${_lastSyncAtStr}` : 'Sin sincronización aún';
  } else if (!_fbConnected) {
    // v14: Navegador tiene internet, pero Firebase WebSocket NO conectó.
    // Esto pasa en redes muy malas (50Kbit/s con alta pérdida de paquetes).
    // Mostrar "Nube no disponible" en vez de "Sincronizando" para que el
    // usuario sepa que NO hay que esperar — los vales se guardarán localmente.
    ind.className = 'pending';
    lbl.textContent = pendingCount > 0 ? `Guardado local (${pendingCount})` : 'Nube no disponible';
    ind.title = pendingCount > 0
      ? `${pendingCount} vale(s) guardado(s) localmente.\nFirebase no responde — se enviarán automáticamente cuando mejore la conexión.`
      : 'Firebase no responde. Los vales se guardarán localmente y se enviarán cuando mejore la conexión.';
  } else if (pendingCount > 0) {
    // Si hay writes pendientes pero están siendo procesados, mostrar "Sincronizando".
    // Si llevan mucho tiempo sin procesarse (red muy lenta), el texto cambia a
    // "Guardando…" para que el usuario entienda que su vale ya está guardado localmente
    // y solo falta subirlo a la nube.
    ind.className = 'pending';
    // v17: el umbral de "stalled" ahora usa el último timeout adaptativo calculado
    // en lugar de un valor fijo de 8s. A 10 Kbit/s, un write válido puede tardar
    // 20-30s sin estar realmente "stalled". Mostrar "Guardando…" a los 8s genera
    // falsa alarma. Ahora se muestra solo si se excede el timeout adaptativo + 5s.
    const stalledThreshold = (_currentWriteTimeout || 8000) + 5000;
    const stalled = _fbProcessing && (Date.now() - _lastSyncAt > stalledThreshold);
    lbl.textContent = stalled ? 'Guardando… (red lenta)' : `Sincronizando (${pendingCount})`;
    ind.title = `${pendingCount} cambio(s) pendiente(s) de subir.\n` +
                (_lastSyncAtStr ? `Última sync exitosa: ${_lastSyncAtStr}` : 'Aún no se ha sincronizado nada.') +
                (stalled ? '\n⚠️ La red está lenta — tus datos están guardados localmente.' : '');
  } else {
    ind.className = 'online';
    lbl.textContent = 'En línea';
    // Solo actualizar _lastSyncAt si no estaba ya en 0 (evita marcar "synced" al cargar).
    // Realmente hay sync exitosa cuando se confirma un write en _processFBQueue.then().
    if (_lastSyncAt > 0) {
      const ago = _formatAgo(_lastSyncAt);
      ind.title = `✓ Sincronizado${ago ? ` (hace ${ago})` : ''}`;
    } else {
      ind.title = 'En línea — esperando primer cambio';
    }
  }
}
// ── Panel de diagnóstico (tocar el indicador de sync) ──
// El `title` (tooltip) no se ve al tocar en la mayoría de los navegadores
// de teléfono — por eso, pese a que _updateSyncIndicator ya arma un texto
// informativo, en la práctica era invisible en un teléfono. Este panel
// muestra lo mismo (y más: errores reales, versión, conteo de pendientes)
// en un alert() — sin depender de hover ni de long-press, y fácil de
// capturar en una captura de pantalla para mandarme si algo sigue mal.
function showSyncDiagnostics() {
  const pendingCount = _fbWriteQueue.length;
  const unsyncedVales = _countPendingSyncVales();
  const lines = [
    `AXONTECH v${typeof APP_VERSION !== 'undefined' ? APP_VERSION : '?'}`,
    `Rol: ${IS_ADMIN ? 'Admin' : 'Gestor'}`,
    `Conexión del navegador: ${_onlineStatus ? 'En línea' : 'Sin conexión'}`,
    `Supabase conectado: ${_fbConnected ? 'Sí' : 'No'}`,
    `Escrituras en cola: ${pendingCount}`,
    `Vales sin confirmar: ${unsyncedVales}`,
    `Última sync exitosa: ${_lastSyncAtStr || 'ninguna todavía'}`,
  ];
  if (_lastSyncError) {
    const secAgo = Math.round((Date.now() - _lastSyncError.ts) / 1000);
    lines.push('', `⚠️ Último error (hace ${secAgo}s, en "${_lastSyncError.path}"):`, `${_lastSyncError.code}: ${_lastSyncError.msg}`);
  }
  alert(lines.join('\n'));
}
// Formatea "hace Xs/m/h" para mostrar en el tooltip del indicador.
function _formatAgo(ts) {
  if (!ts) return '';
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5) return 'justo ahora';
  if (diff < 60) return diff + 's';
  if (diff < 3600) return Math.floor(diff / 60) + 'm';
  return Math.floor(diff / 3600) + 'h';
}
// Llamada cuando un write a Firebase se confirma exitosamente.
function _markSyncSuccess() {
  _lastSyncAt = Date.now();
  _lastSyncAtStr = new Date().toLocaleTimeString('es-ES', {hour:'2-digit', minute:'2-digit', second:'2-digit'});
  _updateSyncIndicator();
}
// Refrescar el tooltip cada 30s para que el "hace Xs" no se quede viejo.
setInterval(() => {
  if (_lastSyncAt > 0 && _fbWriteQueue.length === 0) _updateSyncIndicator();
}, 30000);
window.addEventListener('online', () => {
  _onlineStatus = true;
  _updatePendingSyncBanner();
  // Al volver la conexión, forzar el procesamiento de la cola de writes pendientes.
  // Si hay vales con synced:false que por alguna razón no están encolados (p.ej. el
  // item se descartó tras 5 reintentos), re-encolar un write de vales para ese gestor.
  _ensurePendingValesEnqueued();
  _processFBQueue();
  // v17: arrancar el poll de cola para iOS Safari (no soporta Background Sync).
  _startPollIfPending();
  // Toast informativo solo si hay pendientes
  const pendingCount = _countPendingSyncVales();
  if (pendingCount > 0) {
    showToast(`📡 Conexión restablecida · Enviando ${pendingCount} vale${pendingCount === 1 ? '' : 's'} pendiente${pendingCount === 1 ? '' : 's'}…`);
  }
});
window.addEventListener('offline', () => {
  _onlineStatus = false;
  _updatePendingSyncBanner();
  const pendingCount = _countPendingSyncVales();
  if (pendingCount > 0) {
    showToast(`📡 Sin conexión · ${pendingCount} vale${pendingCount === 1 ? '' : 's'} queda${pendingCount === 1 ? '' : 'n'} guardado${pendingCount === 1 ? '' : 's'} localmente`);
  }
});

// ── v15: visibilitychange — cuando el usuario vuelve a la pestaña ──
// Patrón típico móvil: gestor manda vale → switch a WhatsApp → vuelve a la app.
// Si el write falló mientras estaba backgrounded, el browser probablemente
// pausó el setTimeout del backoff. Al volver, forzamos un check inmediato.
// Esto NO puede ser reemplazado por el setInterval de 30s porque ese timer
// también se pausa cuando la pestaña no es visible.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  // Solo actuar si hay trabajo pendiente o Firebase parece desconectado
  if (_fbWriteQueue.length === 0 && _countPendingSyncVales() === 0 && _fbConnected) {
    _updateSyncIndicator();
    return;
  }
  // Verificar si hay vales huérfanos (synced:false no encolados) y procesar cola.
  _ensurePendingValesEnqueued();
  _processFBQueue();
  _updatePendingSyncBanner();
});

// ── v15: page freeze / resume (Page Lifecycle API en Chrome Android) ──
// Cuando el browser backgroundea la pestaña por mucho tiempo y luego la
// restaura, el WebSocket de Firebase puede haberse caído silenciosamente.
// Forzar un re-check al recibir el evento 'resume'.
if (document.addEventListener && 'onresume' in document) {
  document.addEventListener('resume', () => {
    _ensurePendingValesEnqueued();
    _processFBQueue();
  });
}

// ── v17: pagehide / beforeunload — persistir cola antes de cerrar ──
// iOS Safari y otros navegadores móviles pausan TODOS los setTimeout/setInterval
// cuando la pestaña se va a background. Si un write estaba en backoff y el
// usuario cambia a WhatsApp, el backoff nunca dispara. Al volver (si vuelve),
// el visibilitychange lo rescata. PERO si el usuario CIERRA la pestaña,
// el write puede haberse perdido del cache localStorage si _persistQueue()
// no llegó a correr.
// pagehide dispara SIEMPRE antes de cerrar (incluye refresh, navigate away,
// close tab). Es más confiable que beforeunload (que algunos browsers ignoran).
window.addEventListener('pagehide', () => {
  try {
    _persistQueue();  // asegura que axon_pending_writes está actualizado
  } catch(_) {}
});
// beforeunload como fallback (algunos navegadores disparan uno pero no el otro)
window.addEventListener('beforeunload', () => {
  try {
    _persistQueue();
  } catch(_) {}
});

// ── v17: Poll para iOS Safari — reintentar cola en background ──
// iOS Safari NO soporta Background Sync API. Cuando la pestaña pasa a
// background, setTimeout/setInterval se pausan. Cuando vuelve a estar
// visible, visibilitychange dispara. PERO si el usuario NO vuelve a la
// pestaña (se queda en WhatsApp 30 min), los writes encolados no se procesan.
// Solución: arrancar un poll cada 5s MIENTRAS haya pendientes. El poll
// solo se activa cuando hay trabajo, y se apaga solo cuando no hay.
let _pendingPollTimer = null;
function _startPollIfPending() {
  if (_pendingPollTimer) return; // ya está corriendo
  const tick = () => {
    if (_fbWriteQueue.length === 0 && _countPendingSyncVales() === 0) {
      // No hay trabajo — apagar el poll
      clearInterval(_pendingPollTimer);
      _pendingPollTimer = null;
      return;
    }
    // Re-encolar vales huérfanos y procesar cola
    _ensurePendingValesEnqueued();
    _processFBQueue();
  };
  _pendingPollTimer = setInterval(tick, 5000);
}

// Si hay vales con synced:false pero NO están encolados en _fbWriteQueue (puede pasar
// si el item se descartó tras 4 reintentos, o si la app se cerró y reabrió sin que
// el write se completara), re-encolar un write para ese gestor.
// ── v15 BUGFIX (re-sync-all bug): ANTES este función solo miraba _fbWriteQueue.
// Si el write del gestor estaba IN-FLIGHT (sacado de la cola, op en el aire),
// hasValesWriteQueued devolvía false → se encolaba un SEGUNDO write con los mismos
// vales. El in-flight merge buffer los fusionaba al primer write, y al terminar
// el primer write, el buffer se flusheaba como OTRO write con los mismos vales.
// Resultado: cada 30s (setInterval) el gestor veía "Sincronizando (3) → En línea
// → Sincronizando (3) → En línea" — exactamente el bug reportado:
// "vuelve a sincronizar todos en vez de solo el que falte".
// AHORA: si hay un write IN-FLIGHT para el path del gestor, también salimos.
// El in-flight buffer se flushéa solo cuando el write actual termina, y como los
// vales ya están siendo subidos, no hay nada nuevo que encolar.
function _ensurePendingValesEnqueued() {
  if (IS_ADMIN) return; // el admin no envía vales propios
  if (activeGestorId == null) return;
  // v34: comparación robusta con Number() — gestorId puede venir como string
  // de Supabase JSONB y la comparación === fallaba, haciendo que el vale
  // NUNCA se re-encolara para subir a la nube.
  const gidNum = Number(activeGestorId);
  const mine = getVales().filter(v =>
    v && v.gestorId != null &&
    Number(v.gestorId) === gidNum &&
    v.synced !== true &&
    v.status !== 'cancelled'
  );
  if (mine.length === 0) return;
  // BUGFIX: antes se encolaba al path legado 'vales/{gestorId}' (vestigio de
  // RTDB) mientras saveVales() usa el path plano 'vales' — dos formas de
  // path distintas para lo mismo, lo que rompía la fusión in-flight
  // (_fbInFlightPending) entre esta función y saveVales() y generaba
  // round-trips extra en redes ya lentas. Ahora usa el mismo path 'vales'
  // siempre, coincidiendo exactamente con saveVales().
  const hasValesWriteQueued = _fbWriteQueue.some(item => item.path === 'vales');
  if (hasValesWriteQueued) return; // ya hay uno en cola, no duplicar
  // ── v15: También salir si hay un write IN-FLIGHT para este path ──
  // Ese write ya está subiendo los vales pendientes. Si encolamos otro, el
  // in-flight merge lo fusionará al write actual (innecesario) Y al terminar
  // se flushéa como un nuevo write duplicado. Mejor no tocar nada.
  if (_fbProcessing && _fbInFlightPending['vales']) return;
  // Re-encolar un write con TODOS los vales pendientes de este gestor.
  // BUGFIX: antes armaba su PROPIO objeto "slim" a mano, que SÍ incluía
  // status/mensajeroId/confirmedTs/adminNotes tal cual estuvieran en la
  // copia local — bypaseando por completo el whitelist de slimValeGestor()
  // y reabriendo la condición de carrera (copia stale del gestor pisando
  // cambios del admin) que ese whitelist existe para cerrar. Ahora usa la
  // MISMA función que saveVales(), sin duplicar lógica.
  const updates = {};
  mine.forEach(v => { updates[String(v.id)] = slimValeGestor(v, !!v.valeText); });
  _enqueueFB('vales', updates, 'update');
  console.log(`[sync] Re-encolados ${mine.length} vales pendientes para gestor ${activeGestorId}`);
}

const setFB = (path, v) => {
  _enqueueFB(path, v, 'set');
};

// Construye un objeto {id: entidad|null, ...} comparando el array nuevo
// contra la copia anterior conocida — usado por saveGestores/saveMensajeros/
// saveProductos/saveCategorias para encolar solo lo que cambió (documento por
// documento en Firestore) en vez de reemplazar la colección entera a ciegas.
// Mismo patrón que ya usa saveVales, generalizado a cualquier colección
// simple de entidades con `.id`.
function _buildCollectionUpdates(newArr, prevArr) {
  const updates = {};
  newArr.forEach(x => { updates[String(x.id)] = x; });
  if (Array.isArray(prevArr)) {
    const kept = new Set(newArr.map(x => String(x.id)));
    prevArr.forEach(x => { if (!kept.has(String(x.id))) updates[String(x.id)] = null; });
  }
  return updates;
}

// ═══ In-memory cache layer ═══
let _gestoresCache = null, _gestoresDirty = true;
let _valesCache = null, _valesDirty = true;
let _mensajerosCache = null, _mensajerosDirty = true;
let _productosCache = null, _productosDirty = true;
let _categoriasCache = null, _categoriasDirty = true;
let _configCache = null, _configDirty = true;
let _notifsCache = null, _notifsDirty = true;

// Helper: localStorage setItem with quota-exceeded user feedback
function _safeSetLS(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch(e) {
    console.error('localStorage write error:', e);
    if (e.name === 'QuotaExceededError') {
      showToast('⚠️ Sin espacio de almacenamiento. Exporta/borra datos antiguos.');
    }
    return false;
  }
}

const getGestores   = () => { if (_gestoresDirty || !_gestoresCache) { try { const p = JSON.parse(localStorage.getItem('axon_gestores') || '[]'); _gestoresCache = Array.isArray(p) ? p.filter(v => v != null) : []; } catch(e) { _gestoresCache = []; } _gestoresDirty = false; } return _gestoresCache; };
const saveGestores  = v  => {
  const prev = _gestoresCache;
  _safeSetLS('axon_gestores', JSON.stringify(v)); _gestoresCache = v; _gestoresDirty = false;
  if (!isSyncingFromFirebase()) _enqueueFB('gestores', _buildCollectionUpdates(v, prev), 'update');
  _logAudit('gestores_update');
};

// ── Whitelist de campos que un GESTOR puede escribir en un vale ──
// PROBLEMA ORIGINAL: el gestor tenía una copia local del vale que podía estar
// desactualizada respecto a lo que el admin había cambiado (status,
// mensajeroId, confirmedTs, adminNotes). Cualquier saveVales() del gestor
// mandaba su copia local → pisaba los cambios del admin.
// AHORA: el gestor solo escribe los campos que le pertenecen (datos del
// cliente y productos). Los campos administrativos nunca se mandan desde el
// dispositivo del gestor, así no pueden pisar cambios del admin.
// A NIVEL DE MÓDULO (no dentro de saveVales) a propósito: _ensurePendingValesEnqueued()
// también necesita esta misma función. Antes tenía su PROPIA copia inline que
// NO aplicaba este whitelist (mandaba status/mensajeroId/confirmedTs/adminNotes
// tal cual estuvieran en local) — reabría exactamente la misma condición de
// carrera que este whitelist existe para cerrar. Una sola fuente de verdad.
const GESTOR_WRITABLE_FIELDS = [
  'id','valeNum','gestorId','ts','cliente','telefono','direccion',
  'carnet','mensajeria','articulo','precioUSD','precioMN','vuelto',
  'total','garantia','comisionGestor'
];
function slimValeGestor(x, keepValeText) {
  const slim = {};
  GESTOR_WRITABLE_FIELDS.forEach(f => { if (x[f] !== undefined) slim[f] = x[f]; });
  // valeProductos sin name — se busca por id al leer
  slim.valeProductos = (x.valeProductos || []).map(p => ({ id: p.id, qty: p.qty }));
  // Solo incluir valeText si ya existía (para vales viejos que ya lo traían)
  if (x.valeText && keepValeText) slim.valeText = x.valeText;
  // NO incluir mensajeroId, confirmedTs, adminNotes — son del admin.
  // Tampoco commissionStatus/commissionPaid — los gestores no deben escribirlos.
  // En Firestore/Supabase esto además queda reforzado por set(...,{merge:true}):
  // como slimValeGestor() nunca incluye estos campos, un write de gestor JAMÁS
  // puede tocarlos en el documento, sin importar qué tan vieja esté su copia.
  if (x.deliveredTs) slim.deliveredTs = x.deliveredTs; // mensajero puede marcar entrega
  // v36 FIX CRÍTICO: el gestor SÍ puede enviar status 'pending' (status inicial
  // al crear un vale) y 'cancelled' (cancelar vale propio). Cualquier otro status
  // (assigned/delivered/confirmed/pending_payment) lo preservamos tal cual está
  // para que el UPSERT de Supabase no lo borre al reemplazar la columna data.
  // ANTES: solo se permitía 'cancelled' → el vale nuevo llegaba a Supabase SIN
  // status → el polling del gestor lo traía con status: undefined → el filtro
  // de activeVales lo descartaba → el vale DESAPARECÍA de la lista.
  if (x.status === 'cancelled') {
    slim.status = 'cancelled';
    if (x.cancelledTs) slim.cancelledTs = x.cancelledTs;
  } else if (x.status === 'pending') {
    slim.status = 'pending'; // status inicial legítimo del gestor al crear un vale
  } else if (x.status !== undefined && x.status !== null) {
    // Preservar el status que ya tenía (puesto por el admin) — no borrarlo
    slim.status = x.status;
  }
  // v36 FIX: incluir isNew para que el admin sepa que es un vale nuevo y
  // dispare la alerta de estafa. El gestor crea el vale con isNew:true.
  if (x.isNew !== undefined) slim.isNew = !!x.isNew;
  return slim;
}
const getVales      = () => { if (_valesDirty || !_valesCache) { try { const p = JSON.parse(localStorage.getItem('axon_vales') || '[]'); _valesCache = Array.isArray(p) ? p.filter(v => v != null) : []; } catch(e) { _valesCache = []; } _valesDirty = false; } return _valesCache; };
// Vales are synced via saveVales → _enqueueFB('vales', updates, 'update') through the write queue.
// Individual fbUpdateVale was removed from patchVale to prevent race conditions.
// fbAddVale/fbRemoveVale are NO LONGER called by sendVale/cancelVale/adminDeleteVale
// because saveVales already enqueues the write on the vales node.
//
// IMPORTANTE — por qué 'update' (merge por documento) y no un 'set' del árbol
// completo:
// saveVales() se llama con la copia LOCAL EN MEMORIA de todos los vales (admin) o de
// los propios (gestor). Esa copia puede estar desactualizada si otro dispositivo
// escribió en Firestore hace un instante y el listener de este dispositivo
// todavía no procesó esa actualización (delay de red típico: 100ms–1s). En
// Firestore cada vale es su PROPIO documento (colección `vales`, doc id = String(id))
// — a diferencia del árbol anidado de RTDB, escribir el vale X con
// set(...,{merge:true}) JAMÁS puede tocar el vale Y, sin importar qué tan
// desactualizada esté la copia local en otros aspectos. Los borrados reales
// (cancelar/eliminar vale) se detectan comparando contra la copia anterior
// (`prevVales`) y se envían como `null` explícito para esos documentos puntuales.
const saveVales = v => {
  const prevVales = _valesCache; // snapshot antes de este guardado, para detectar borrados reales
  _safeSetLS('axon_vales', JSON.stringify(v));
  _valesCache = v; _valesDirty = false;
  if (isSyncingFromFirebase()) return;
  // ── DIFF-BASED WRITES (v13) + PAYLOAD SLIMMING (v14) ──
  // v13: solo encolar vales nuevos/cambiados (no todo el array).
  // v14: NO enviar valeText (~300-500 bytes), name de valeProductos (~20 bytes/item),
  //      ni flags locales (synced, isNew) a Firebase. Se regeneran al leer.
  const updates = {};
  const prevMap = new Map();
  if (Array.isArray(prevVales)) {
    prevVales.forEach(x => { prevMap.set(String(x.id), x); });
  }
  // Helper: crea una versión "slim" del vale para enviar a Firebase.
  // Quita campos que se pueden regenerar al leer.
  function slimVale(x) {
    const slim = {
      id: x.id,
      valeNum: x.valeNum,
      gestorId: x.gestorId,
      ts: x.ts,
      cliente: x.cliente,
      telefono: x.telefono,
      direccion: x.direccion,
      carnet: x.carnet,
      mensajeria: x.mensajeria,
      articulo: x.articulo,
      precioUSD: x.precioUSD,
      precioMN: x.precioMN,
      vuelto: x.vuelto,
      total: x.total,
      garantia: x.garantia,
      comisionGestor: x.comisionGestor,
      // valeProductos sin 'name' — se busca por id al leer
      valeProductos: (x.valeProductos || []).map(p => ({ id: p.id, qty: p.qty })),
      status: x.status,
      mensajeroId: x.mensajeroId,
      confirmedTs: x.confirmedTs,
      adminNotes: x.adminNotes,
      // v36 FIX CRÍTICO: incluir flags de "visto por admin" para que el gestor
      // los reciba vía polling. ANTES estos campos no se enviaban a Supabase →
      // el gestor nunca veía "👁️ Visto por admin" en su lista de vales.
      isNew: !!x.isNew,
      seenByAdmin: !!x.seenByAdmin,
      seenTs: x.seenTs || null,
    };
    // Solo incluir valeText si ya existía (para no romper vales viejos que lo usan).
    // Si el vale lo generó buildValeText() al enviar, NO se envía — se regenera al leer.
    // Pero si un vale viejo en Firebase lo tiene, lo respetamos al hacer update.
    // (No lo quitamos explícitamente para no perder datos existentes.)
    // Para vales NUEVOS: simplemente no lo incluimos.
    // Para vales MODIFICADOS que ya tenían valeText en Firebase: lo incluimos.
    if (x.valeText && prevMap.get(String(x.id))?.valeText) {
      slim.valeText = x.valeText;
    }
    // No incluir synced (flag local), isNew (flag temporal), deliveredTs (solo si existe)
    if (x.deliveredTs) slim.deliveredTs = x.deliveredTs;
    if (x.commissionStatus) slim.commissionStatus = x.commissionStatus;
    if (x.commissionPaid) slim.commissionPaid = x.commissionPaid;
    return slim;
  }
  // slimValeGestor() y GESTOR_WRITABLE_FIELDS ahora viven a nivel de módulo
  // (arriba de getVales) — compartidos con _ensurePendingValesEnqueued().
  // Doc id de Firestore = String(vale.id) — plano, sin gestorId (la colección
  // 'vales' es única y plana; gestorId vive como CAMPO dentro del documento).
  const curKeys = new Set();
  if (IS_ADMIN) {
    v.forEach(x => {
      const key = String(x.id);
      curKeys.add(key);
      const prev = prevMap.get(key);
      // Solo encolar si es nuevo o cambió (comparación por JSON stringify del slim)
      const slim = slimVale(x);
      const prevSlim = prev ? slimVale(prev) : null;
      if (!prevSlim || JSON.stringify(prevSlim) !== JSON.stringify(slim)) {
        updates[key] = slim;
      }
    });
    // Borrados reales: vales que estaban en prevVales pero ya no están en v
    if (Array.isArray(prevVales)) {
      prevVales.forEach(x => {
        const key = String(x.id);
        if (!curKeys.has(key)) updates[key] = null;
      });
    }
    if (Object.keys(updates).length === 0) return; // nada que escribir
    _enqueueFBChunked('vales', updates, 'update');
  } else if (activeGestorId != null) {
    // El gestor solo envía SUS vales — pero al mismo path 'vales' (colección
    // plana), no a una sub-rama propia como en RTDB. La protección contra
    // pisar vales/campos ajenos ya no depende de a qué "rama" se escribe,
    // sino de que slimValeGestor() (arriba) nunca incluye campos que no le
    // pertenecen, combinado con set(...,{merge:true}) documento-por-documento.
    // v34: usar Number() para comparación robusta de gestorId.
    const gidNum = Number(activeGestorId);
    const mine = v.filter(x => x && x.gestorId != null && Number(x.gestorId) === gidNum);
    mine.forEach(x => {
      const key = String(x.id);
      const prev = prevMap.get(key);
      // v17: usar slimValeGestor — solo campos del gestor, nunca status/mensajeroId/etc.
      const hadValeText = !!(prev && prev.valeText);
      const slim = slimValeGestor(x, hadValeText);
      const prevSlim = prev ? slimValeGestor(prev, hadValeText) : null;
      if (!prevSlim || JSON.stringify(prevSlim) !== JSON.stringify(slim)) {
        updates[key] = slim;
      }
    });
    if (Array.isArray(prevVales)) {
      const kept = new Set(mine.map(x => String(x.id)));
      prevVales.filter(x => x && x.gestorId != null && Number(x.gestorId) === gidNum).forEach(x => {
        if (!kept.has(String(x.id))) updates[String(x.id)] = null;
      });
    }
    if (Object.keys(updates).length === 0) return; // nada que escribir
    _enqueueFBChunked('vales', updates, 'update');
  }
  // Sin gestor activo en la página de gestor: no se escribe nada (evita borrados fantasma)
};

const getMensajeros = () => { if (_mensajerosDirty || !_mensajerosCache) { try { const parsed = JSON.parse(localStorage.getItem('axon_mensajeros') || '[]'); _mensajerosCache = Array.isArray(parsed) ? parsed.filter(v => v != null) : []; } catch(e) { _mensajerosCache = []; } _mensajerosDirty = false; } return _mensajerosCache; };
const saveMensajeros= v  => {
  const prev = _mensajerosCache;
  _safeSetLS('axon_mensajeros', JSON.stringify(v)); _mensajerosCache = v; _mensajerosDirty = false;
  if (!isSyncingFromFirebase()) _enqueueFB('mensajeros', _buildCollectionUpdates(v, prev), 'update');
};

const getProductos  = () => { if (_productosDirty || !_productosCache) { try { const p = JSON.parse(localStorage.getItem('axon_productos') || '[]'); _productosCache = Array.isArray(p) ? p.filter(v => v != null) : []; } catch(e) { _productosCache = []; } _productosDirty = false; } return _productosCache; };
const saveProductos = v  => {
  const prev = _productosCache;
  _safeSetLS('axon_productos', JSON.stringify(v)); _productosCache = v; _productosDirty = false;
  if (!isSyncingFromFirebase()) _enqueueFB('productos', _buildCollectionUpdates(v, prev), 'update');
  triggerAutoPublishCatalog();
};

const getCategorias = () => { if (_categoriasDirty || !_categoriasCache) { try { const parsed = JSON.parse(localStorage.getItem('axon_categorias') || '[]'); _categoriasCache = Array.isArray(parsed) ? parsed.filter(v => v != null) : []; } catch(e) { _categoriasCache = []; } _categoriasDirty = false; } return _categoriasCache; };
const saveCategorias= v  => {
  const prev = _categoriasCache;
  _safeSetLS('axon_categorias', JSON.stringify(v)); _categoriasCache = v; _categoriasDirty = false;
  if (!isSyncingFromFirebase()) _enqueueFB('categorias', _buildCollectionUpdates(v, prev), 'update');
};

const getConfig     = () => { if (_configDirty || !_configCache) { try { _configCache = JSON.parse(localStorage.getItem('axon_config') || '{}'); } catch(e) { _configCache = {}; } _configDirty = false; } return _configCache; };
const saveConfig    = v  => { _safeSetLS('axon_config', JSON.stringify(v)); _configCache = v; _configDirty = false; if (!isSyncingFromFirebase()) setFB('config', v); };

// GitHub token helper — el token NUNCA se sincroniza a Firebase.
// Vive solo en localStorage del dispositivo admin para evitar que gestores
// u otros dispositivos lo lean. Ver AUDITORIA-AXONTECH.md CRÍTICO 3.
const ghToken = () => { try { return localStorage.getItem('axon_gh_token') || ''; } catch(e) { return ''; } };

// Helper para escribir el estado de GitHub en AMBOS bloques (catálogo + config).
// Antes solo se actualizaba el primero por el ID duplicado. Ver AUDITORIA-AXONTECH.md ALTO 12.
const setGhStatus = html => ['ghSyncStatus','ghSyncStatus2'].forEach(i => {
  const el = document.getElementById(i);
  if (el) el.innerHTML = html;
});

const getNotifs     = () => { if (_notifsDirty || !_notifsCache) { try { const p = JSON.parse(localStorage.getItem('axon_notifs') || '[]'); _notifsCache = Array.isArray(p) ? p.filter(v => v != null) : []; } catch(e) { _notifsCache = []; } _notifsDirty = false; } return _notifsCache; };
const saveNotifs    = v  => { _safeSetLS('axon_notifs', JSON.stringify(v)); _notifsCache = v; _notifsDirty = false; if (!isSyncingFromFirebase()) setFB('notifs', v); };

// ══════════════════════════════════════════
//  AUTO-PUBLISH CATALOG TO GITHUB
// ══════════════════════════════════════════
let _catalogPublishTimer = null;
function triggerAutoPublishCatalog() {
  const cfg = getConfig();
  if (!cfg.ghAutoPublishCatalog || !ghToken() || !cfg.ghRepo) return;
  clearTimeout(_catalogPublishTimer);
  _catalogPublishTimer = setTimeout(async () => {
    try {
      const html = buildCatalogHTML();
      if (html) await publishCatalogToGitHub(html);
    } catch(e) { console.error('Auto-publish catalog error:', e); }
  }, 5000);
}

function buildCatalogHTML() {
  const cats=getCategorias();
  const allProds=getProductos().filter(p=>(p.stock||0)>0);
  if(!allProds.length) return null;
  const cfg=getConfig();
  const waPhone=cfg.catalogPhone||cfg.adminPhone||'';
  // v41 FIX: si no hay teléfono configurado, NO generar el catálogo.
  // ANTES, sin teléfono, TODOS los productos se generaban con waLink:''
  // y el catálogo los mostraba como "No disponible" — confundiendo al
  // admin y al cliente. Ahora avisamos claro.
  if(!waPhone){
    showToast('⚠️ Configura un teléfono en ⚙️ Config antes de publicar el catálogo. Sin teléfono, todos los productos aparecen como "No disponible".');
    return null;
  }
  const catColors=['#006d8a','#7c3aed','#dc2626','#059669','#d97706','#2563eb','#be185d','#475569'];
  const dateStr=new Date().toLocaleDateString('es-ES',{year:'numeric',month:'long',day:'numeric'});
  let catCardsJS='';
  if(cats.length){
    let ci=0;
    cats.forEach(cat=>{
      const prods=allProds.filter(p=>p.catId===cat.id);
      if(!prods.length)return;
      const color=catColors[ci%catColors.length];ci++;
      prods.forEach(p=>{catCardsJS+=buildCatalogCardJS(p,cat,color,waPhone);});
    });
    const noCat=allProds.filter(p=>!p.catId||!cats.find(c=>c.id===p.catId));
    if(noCat.length){
      const color=catColors[ci%catColors.length];ci++;
      noCat.forEach(p=>{catCardsJS+=buildCatalogCardJS(p,null,color,waPhone);});
    }
  } else {
    allProds.forEach(p=>{catCardsJS+=buildCatalogCardJS(p,null,'#006d8a',waPhone);});
  }
  return `<!DOCTYPE html><html lang="es"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>AXONTECH - Catalogo</title>
<link rel="icon" href="https://axontech92.github.io/AXONTECH/iconos/favicon-96.png">
<meta property="og:title" content="AXONTECH - Catalogo de Productos">
<meta property="og:description" content="Explora nuestros productos disponibles">
<meta property="og:type" content="website">
<style>
*{box-sizing:border-box;margin:0;padding:0;}
:root{--primary:#006d8a;--primary-dk:#004d60;--accent:#00b4d8;--bg:#f0f4f8;--card:#fff;--text:#1a1a2e;--muted:#64748b;--radius:16px;--shadow:0 4px 20px rgba(0,0,0,.08);}
body{font-family:'Segoe UI',-apple-system,BlinkMacSystemFont,system-ui,sans-serif;background:var(--bg);color:var(--text);line-height:1.5;min-height:100vh;-webkit-font-smoothing:antialiased;}
.hero{background:linear-gradient(135deg,var(--primary-dk) 0%,var(--primary) 50%,var(--accent) 100%);padding:48px 20px 36px;text-align:center;position:relative;overflow:hidden;}
.hero::before{content:'';position:absolute;top:-50%;left:-50%;width:200%;height:200%;background:radial-gradient(circle,rgba(255,255,255,.06) 0%,transparent 60%);animation:heroGlow 8s ease-in-out infinite alternate;}
@keyframes heroGlow{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}
.hero-logo{font-size:48px;font-weight:900;color:#fff;letter-spacing:10px;text-shadow:0 2px 20px rgba(0,0,0,.3);position:relative;z-index:1;}
.hero-sub{font-size:14px;letter-spacing:5px;color:rgba(255,255,255,.8);font-weight:300;margin-top:4px;position:relative;z-index:1;}
.hero-line{width:50px;height:3px;background:rgba(255,255,255,.4);margin:14px auto;border-radius:2px;position:relative;z-index:1;}
.hero-info{font-size:11px;color:rgba(255,255,255,.55);letter-spacing:1px;position:relative;z-index:1;}
.hero-count{display:inline-block;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);border-radius:20px;padding:5px 18px;font-size:12px;color:rgba(255,255,255,.9);margin-top:12px;font-weight:600;position:relative;z-index:1;}
.nav{position:sticky;top:0;z-index:100;background:rgba(255,255,255,.92);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid rgba(0,0,0,.06);padding:10px 16px;display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;}
.nav::-webkit-scrollbar{display:none;}
.nav-btn{padding:7px 16px;border-radius:20px;border:1.5px solid #e2e8f0;background:#fff;font-size:12px;font-weight:700;color:var(--muted);cursor:pointer;white-space:nowrap;transition:all .2s;}
.nav-btn:hover{border-color:var(--primary);color:var(--primary);}
.nav-btn.active{background:var(--primary);color:#fff;border-color:var(--primary);box-shadow:0 2px 8px rgba(0,109,138,.25);}
.container{max-width:1200px;margin:0 auto;padding:16px;}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:20px;}
.card{background:var(--card);border-radius:var(--radius);overflow:hidden;box-shadow:var(--shadow);transition:transform .25s,box-shadow .25s;position:relative;display:flex;flex-direction:column;}
.card:hover{transform:translateY(-4px);box-shadow:0 8px 30px rgba(0,0,0,.12);}
.card-img{height:220px;background:linear-gradient(145deg,#f8fafc,#eef2f7);display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative;}
.card-img img{width:100%;height:100%;object-fit:cover;transition:transform .4s;}
.card:hover .card-img img{transform:scale(1.05);}
.card-img .no-img{font-size:64px;opacity:.25;}
.card-cat{position:absolute;top:12px;left:12px;color:#fff;padding:4px 12px;border-radius:8px;font-size:10px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;box-shadow:0 2px 6px rgba(0,0,0,.15);}
.card-body{padding:18px 20px 20px;flex:1;display:flex;flex-direction:column;}
.card-name{font-weight:800;font-size:16px;color:var(--text);margin-bottom:6px;line-height:1.3;min-height:42px;}
.card-desc{font-size:12.5px;color:var(--muted);line-height:1.55;margin-bottom:12px;height:58px;overflow:hidden;position:relative;cursor:pointer;transition:max-height .3s ease;}
.card-desc.expanded{max-height:500px;}
.card-desc-fade{position:absolute;bottom:0;left:0;right:0;height:28px;background:linear-gradient(transparent,#fff);pointer-events:none;transition:opacity .3s;}
.card-desc.expanded+.card-desc-fade,.card-desc.expanded~.card-desc-fade{opacity:0;}
.card-price{font-weight:900;font-size:22px;color:var(--primary);margin-bottom:12px;letter-spacing:.3px;min-height:30px;}
.card-badges{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;min-height:26px;}
.badge{padding:4px 10px;border-radius:8px;font-size:10px;font-weight:700;letter-spacing:.3px;}
.badge-garantia{background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0;}
.wa-btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:12px;border:none;border-radius:12px;background:linear-gradient(135deg,#25d366,#128c7e);color:#fff;font-size:13px;font-weight:700;cursor:pointer;transition:all .2s;text-decoration:none;letter-spacing:.3px;margin-top:auto;}
.wa-btn:hover{transform:scale(1.02);box-shadow:0 4px 14px rgba(37,211,102,.35);}
.wa-btn:active{transform:scale(.98);}
.wa-icon{font-size:18px;}
.footer{text-align:center;padding:32px 20px;margin-top:40px;border-top:1px solid #e2e8f0;background:#fff;}
.footer-brand{font-size:14px;font-weight:900;color:var(--primary);letter-spacing:4px;margin-bottom:6px;}
.footer-addr{font-size:11px;color:var(--muted);line-height:1.6;}
.footer-gen{font-size:9px;color:#cbd5e1;margin-top:8px;}
.float-wa{position:fixed;bottom:24px;right:24px;width:56px;height:56px;border-radius:50%;background:#25d366;color:#fff;display:flex;align-items:center;justify-content:center;font-size:28px;box-shadow:0 4px 16px rgba(37,211,102,.4);cursor:pointer;z-index:999;transition:transform .2s;text-decoration:none;border:none;}
.float-wa:hover{transform:scale(1.1);}
.empty{text-align:center;padding:60px 20px;color:var(--muted);}
.empty-icon{font-size:48px;margin-bottom:12px;opacity:.5;}
.pmodal-bg{position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,.55);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:16px;opacity:0;transition:opacity .25s;pointer-events:none;}
.pmodal-bg.show{opacity:1;pointer-events:auto;}
.pmodal{background:var(--card);border-radius:var(--radius);max-width:420px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.3);transform:translateY(20px);transition:transform .25s;}
.pmodal-bg.show .pmodal{transform:translateY(0);}
.pmodal-img{width:100%;height:260px;object-fit:cover;display:block;}
.pmodal-noimg{width:100%;height:180px;display:flex;align-items:center;justify-content:center;font-size:64px;opacity:.2;background:linear-gradient(145deg,#f8fafc,#eef2f7);}
.pmodal-cat{display:inline-block;color:#fff;padding:4px 12px;border-radius:8px;font-size:10px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;margin-bottom:8px;}
.pmodal-body{padding:20px 22px 24px;}
.pmodal-name{font-weight:800;font-size:20px;color:var(--text);margin-bottom:8px;line-height:1.3;}
.pmodal-desc{font-size:13.5px;color:var(--muted);line-height:1.65;margin-bottom:14px;}
.pmodal-price{font-weight:900;font-size:24px;color:var(--primary);margin-bottom:10px;}
.pmodal-badge{display:inline-block;padding:4px 12px;border-radius:8px;font-size:11px;font-weight:700;background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0;margin-bottom:16px;}
.pmodal-close{position:absolute;top:12px;right:12px;width:36px;height:36px;border-radius:50%;background:rgba(0,0,0,.45);color:#fff;border:none;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:5;transition:background .2s;}
.pmodal-close:hover{background:rgba(0,0,0,.7);}
@media(max-width:640px){
  .hero{padding:36px 16px 28px;}
  .hero-logo{font-size:36px;letter-spacing:6px;}
  .hero-sub{font-size:11px;letter-spacing:3px;}
  .grid{grid-template-columns:1fr;gap:16px;}
  .card-img{height:200px;}
  .container{padding:12px;}
}
@media(min-width:641px) and (max-width:1024px){
  .grid{grid-template-columns:repeat(2,1fr);}
}
</style>
</head><body>
<div class="hero">
  <div class="hero-logo">AXONTECH</div>
  <div class="hero-sub">CATALOGO DE PRODUCTOS</div>
  <div class="hero-line"></div>
  <div class="hero-info">${dateStr}</div>
  <div class="hero-count">${allProds.length} productos disponibles</div>
</div>
<div class="nav" id="catNav"></div>
<div class="container"><div class="grid" id="productGrid"></div></div>
<div class="pmodal-bg" id="pmodalBg" onclick="if(event.target===this)closeProduct()">
  <div class="pmodal" style="position:relative;">
    <button class="pmodal-close" onclick="closeProduct()">&times;</button>
    <div id="pmodalContent"></div>
  </div>
</div>
<div class="footer">
  <div class="footer-brand">AXONTECH</div>
  <div class="footer-addr">Amistad #311 % San Rafael y San Jose, Centro Habana</div>
  <div class="footer-gen">Catalogo actualizado: ${dateStr}</div>
</div>
${waPhone?`<a class="float-wa" href="https://wa.me/${waPhone}?text=${encodeURIComponent('Hola, vi el catalogo de AXONTECH y me interesa...')}" target="_blank" title="Chat por WhatsApp">&#128172;</a>`:''}
<script>
var products=[${catCardsJS}];
var catNames=[${cats.map((c,i)=>"{id:"+c.id+",name:"+JSON.stringify(c.name)+",color:'"+catColors[i%catColors.length]+"'}").join(',')}${cats.length?'':",{id:0,name:'Todos',color:'#006d8a'}"}];
var activeCat=null;
function escapeHTML(s){if(s===null||s===undefined)return '';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');}
function renderNav(){
  var n=document.getElementById('catNav');
  var h='<button class="nav-btn active" onclick="filterCat(null,this)">Todos</button>';
  catNames.forEach(function(c){
    var count=products.filter(function(p){return p.catId===c.id}).length;
    if(count) h+='<button class="nav-btn" onclick="filterCat('+c.id+',this)">'+escapeHTML(c.name)+' ('+count+')</button>';
  });
  n.innerHTML=h;
}
function filterCat(id,btn){
  activeCat=id;
  document.querySelectorAll('.nav-btn').forEach(function(b){b.classList.remove('active')});
  if(btn)btn.classList.add('active');
  renderGrid();
}
function renderGrid(){
  var g=document.getElementById('productGrid');
  var filtered=activeCat!==null?products.filter(function(p){return p.catId===activeCat}):products;
  if(!filtered.length){g.innerHTML='<div class="empty"><div class="empty-icon">&#128230;</div><div>No hay productos en esta categoria</div></div>';return;}
  g.innerHTML=filtered.map(function(p){
    var s='<div class="card" onclick="openProduct('+p.id+')" style="cursor:pointer;">';
    s+='<div class="card-img">';
    // Validate photo URL — only allow http(s) and data URIs
    if(p.photo && /^(https?:|data:image|photos\\/|\\.\\/photos\\/)/i.test(p.photo)){s+='<img src="'+escapeHTML(p.photo)+'" data-img="1" loading="lazy">';}
    s+='<div class="no-img" style="'+(p.photo?'display:none':'')+'">&#128230;</div>';
    if(p.catName){s+='<div class="card-cat" style="background:'+escapeHTML(p.catColor)+'">'+escapeHTML(p.catName)+'</div>';}
    s+='</div><div class="card-body">';
    s+='<div class="card-name">'+escapeHTML(p.name)+'</div>';
    s+='<div class="card-desc">'+escapeHTML(p.desc||'')+'<div class="card-desc-fade"></div></div>';
    s+='<div class="card-price">'+escapeHTML(p.price||'')+'</div>';
    s+='<div class="card-badges">';
    if(p.garantia){s+='<span class="badge badge-garantia">Garantia: '+escapeHTML(p.garantia)+'</span>';}
    s+='</div>';
    if(p.waLink){s+='<a class="wa-btn" href="'+escapeHTML(p.waLink)+'" target="_blank" onclick="event.stopPropagation();"><span class="wa-icon">&#128172;</span>Pedir por WhatsApp</a>';}
    else{s+='<div class="wa-btn" style="background:#cbd5e1;cursor:default;pointer-events:none;">WhatsApp no configurado</div>';}
    s+='</div></div>';
    return s;
  }).join('');
}
function openProduct(id){
  var p=products.find(function(x){return x.id===id});if(!p)return;
  var c=document.getElementById('pmodalContent');
  var h='';
  if(p.photo && /^(https?:|data:image|photos\\/|\\.\\/photos\\/)/i.test(p.photo)){h+='<img class="pmodal-img" src="'+escapeHTML(p.photo)+'" data-img="1"><div class="pmodal-noimg" style="display:none">&#128230;</div>';}
  else{h+='<div class="pmodal-noimg">&#128230;</div>';}
  h+='<div class="pmodal-body">';
  if(p.catName){h+='<div class="pmodal-cat" style="background:'+escapeHTML(p.catColor)+'">'+escapeHTML(p.catName)+'</div>';}
  h+='<div class="pmodal-name">'+escapeHTML(p.name)+'</div>';
  if(p.desc){h+='<div class="pmodal-desc">'+escapeHTML(p.desc)+'</div>';}
  if(p.price){h+='<div class="pmodal-price">'+escapeHTML(p.price)+'</div>';}
  if(p.garantia){h+='<div class="pmodal-badge">Garantia: '+escapeHTML(p.garantia)+'</div>';}
  if(p.waLink){h+='<a class="wa-btn" href="'+escapeHTML(p.waLink)+'" target="_blank"><span class="wa-icon">&#128172;</span>Pedir por WhatsApp</a>';}
  h+='</div>';
  c.innerHTML=h;
  document.getElementById('pmodalBg').classList.add('show');
}
function closeProduct(){document.getElementById('pmodalBg').classList.remove('show');}
document.addEventListener('error',function(e){var t=e.target;if(t.tagName==='IMG'&&t.dataset.img){t.style.display='none';if(t.nextElementSibling)t.nextElementSibling.style.display='flex';}},true);
renderNav();renderGrid();
</script>
</body></html>`;
}

// (categorías, config, notifs now defined above next to other cache layers — this duplicate removed)

// ══════════════════════════════════════════
//  ESTAFA (Scam Blacklist) DATA
// ══════════════════════════════════════════
let _estafaCache = null;
let _estafaDirty = true;
const getEstafa   = () => { if (_estafaDirty || !_estafaCache) { try { const p = JSON.parse(localStorage.getItem('axon_estafa') || '[]'); _estafaCache = Array.isArray(p) ? p.filter(v => v != null) : []; } catch(e) { _estafaCache = []; } _estafaDirty = false; } return _estafaCache; };
const saveEstafa  = v  => { _safeSetLS('axon_estafa', JSON.stringify(v)); _estafaCache = v; _estafaDirty = false; if (!isSyncingFromFirebase()) setFB('estafa', v); };

function checkEstafaMatch(vale) {
  const lista = getEstafa();
  if (!lista.length) return [];
  const matches = [];
  // Normalize function: remove accents, lowercase, trim spaces
  const norm = s => (s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
  const vPhone = (vale.telefono || '').replace(/[\s\-()]/g, '');
  const vCliente = norm(vale.cliente || '');
  const vDireccion = norm(vale.direccion || '');
  const vCarnet = norm(vale.carnet || '');
  lista.forEach(e => {
    const reasons = [];

    // ── Teléfono: coincidencia EXACTA (mínimo 7 dígitos en ambos) ──
    // v10 FIX: ANTES usaba includes() bidireccional que causaba falsos
    // positivos (ej: vale="5123" matcheaba estafa="51234567").
    // Ahora requiere coincidencia exacta o por últimos 8 dígitos.
    if (e.telefono && vPhone && vPhone.length >= 7) {
      const ePhone = (e.telefono || '').replace(/[\s\-()]/g, '');
      if (ePhone.length >= 7) {
        // Coincidencia exacta o por últimos 8 dígitos (tolera prefijo país)
        if (vPhone === ePhone) {
          reasons.push('teléfono: ' + e.telefono);
        } else if (vPhone.length >= 8 && ePhone.length >= 8) {
          const tailV = vPhone.slice(-8);
          const tailE = ePhone.slice(-8);
          if (tailV === tailE) reasons.push('teléfono: ' + e.telefono);
        }
      }
    }

    // ── Nombre: coincidencia EXACTA o palabra-completa ──
    // v10 FIX: ANTES usaba includes() que hacía que "Juan" matcheara
    // "Juan Pérez". Ahora requiere coincidencia exacta o que TODAS las
    // palabras significativas (>=4 chars) del entry coincidan como
    // palabra completa en el vale.
    if (e.nombre && vCliente && vCliente.length >= 4) {
      const eNombre = norm(e.nombre);
      if (eNombre.length >= 4) {
        if (vCliente === eNombre) {
          reasons.push('nombre: ' + e.nombre);
        } else {
          // Matching palabra-completa: todas las palabras del entry deben
          // aparecer como palabra exacta en el vale
          const vWords = vCliente.split(/\s+/).filter(w => w.length >= 4);
          const eWords = eNombre.split(/\s+/).filter(w => w.length >= 4);
          if (eWords.length >= 2 && vWords.length >= 2) {
            const vSet = new Set(vWords);
            const allMatch = eWords.every(ew => vSet.has(ew));
            if (allMatch) reasons.push('nombre similar: ' + e.nombre);
          }
        }
      }
    }

    // ── Dirección: coincidencia EXACTA o 2+ palabras completas ──
    // v10 FIX: mismo patrón que nombre — palabras completas, no includes()
    if (e.direccion && vDireccion && vDireccion.length >= 5) {
      const eDir = norm(e.direccion);
      if (eDir.length >= 5) {
        if (vDireccion === eDir) {
          reasons.push('dirección: ' + e.direccion);
        } else {
          const vWords = vDireccion.split(/\s+/).filter(w => w.length >= 5);
          const eWords = eDir.split(/\s+/).filter(w => w.length >= 5);
          if (eWords.length >= 2) {
            const vSet = new Set(vWords);
            const matchCount = eWords.filter(ew => vSet.has(ew)).length;
            if (matchCount >= 2) reasons.push('dirección similar: ' + e.direccion);
          }
        }
      }
    }

    // ── Carnet: coincidencia EXACTA (mínimo 5 caracteres) ──
    // v10 FIX: ANTES usaba includes() bidireccional.
    if (e.carnet && vCarnet && vCarnet.length >= 5) {
      const eCarnet = norm(e.carnet);
      if (eCarnet.length >= 5 && vCarnet === eCarnet) {
        reasons.push('carnet: ' + e.carnet);
      }
    }

    if (reasons.length) matches.push({ entry: e, reasons: reasons });
  });
  return matches;
}

function showEstafaAlert(vale, matches) {
  if (!matches.length) return;
  // Build detail with links to estafa entries
  let detail = matches.map(m => {
    const r = m.reasons.join(', ');
    let s = '⚠️ Coincidencia por ' + r;
    if (m.entry.nota) s += '\n   Nota: ' + m.entry.nota;
    if (m.entry.carnet) s += '\n   Carnet: ' + m.entry.carnet;
    return s;
  }).join('\n');
  // Build estafa entries HTML
  let entriesHtml = matches.map(m => {
    const e = m.entry;
    return `<div style="background:var(--surface2);border:1px solid var(--red);border-radius:10px;padding:12px;margin-bottom:8px;cursor:pointer;" onclick="document.querySelectorAll('.modal-bg[style]').forEach(el=>el.remove());adminTab('estafa');">
      <div style="font-size:13px;font-weight:800;color:var(--red);margin-bottom:4px;">🚫 ${escapeHTML(e.nombre || 'Sin nombre')}</div>
      <div style="font-size:11px;color:var(--text);display:flex;flex-wrap:wrap;gap:8px;">
        ${e.telefono?'<span>📱 '+escapeHTML(e.telefono)+'</span>':''}
        ${e.carnet?'<span>🪪 '+escapeHTML(e.carnet)+'</span>':''}
        ${e.direccion?'<span>📍 '+escapeHTML(e.direccion)+'</span>':''}
      </div>
      ${e.nota?'<div style="font-size:11px;color:var(--red);margin-top:4px;font-weight:600;">⚡ '+escapeHTML(e.nota)+'</div>':''}
      <div style="font-size:10px;color:var(--blue);margin-top:6px;font-weight:700;">👆 Toca para ir al panel de estafa</div>
    </div>`;
  }).join('');
  const overlay = document.createElement('div');
  overlay.className = 'modal-bg show';
  overlay.style.zIndex = '10001';
  const box = document.createElement('div');
  box.className = 'modal';
  box.style.cssText = 'max-width:440px;text-align:center;';
  box.innerHTML = `
    <div style="font-size:48px;margin-bottom:12px;">🚨</div>
    <div class="modal-title" style="color:var(--red);margin-bottom:8px;">¡ALERTA DE POSIBLE ESTAFA!</div>
    <div style="font-size:12px;color:var(--gray-400);margin-bottom:12px;">El vale de <b style="color:var(--text);">${escapeHTML(vale.cliente || '—')}</b> coincide con datos en la lista negra</div>
    <div style="text-align:left;max-height:250px;overflow-y:auto;margin-bottom:16px;">${entriesHtml}</div>
    <div style="font-size:11px;color:var(--gray-400);margin-bottom:12px;">Revisa los datos antes de continuar</div>
    <div class="modal-btns" style="flex-direction:column;">
      <button class="btn btn-red btn-full" onclick="this.closest('.modal-bg').remove()" style="font-weight:700;">⚠️ Entendido — Tener precaución</button>
      <button class="btn btn-ghost btn-full" onclick="this.closest('.modal-bg').remove();adminTab('estafa');" style="font-size:12px;">🚫 Ir al panel de estafa</button>
    </div>`;
  overlay.appendChild(box);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

function addEstafa() {
  const tel = document.getElementById('estafaTelefono').value.trim();
  const nom = document.getElementById('estafaNombre').value.trim();
  const car = document.getElementById('estafaCarnet').value.trim();
  const dir = document.getElementById('estafaDireccion').value.trim();
  const nota = document.getElementById('estafaNota').value.trim();
  if (!tel && !nom && !dir && !car) { showToast('Agrega al menos un dato (teléfono, nombre, carnet o dirección)'); return; }
  const lista = getEstafa();
  const id = Date.now();
  lista.push({ id, telefono: tel, nombre: nom, carnet: car, direccion: dir, nota: nota, fecha: new Date().toISOString() });
  saveEstafa(lista);
  document.getElementById('estafaTelefono').value = '';
  document.getElementById('estafaNombre').value = '';
  document.getElementById('estafaCarnet').value = '';
  document.getElementById('estafaDireccion').value = '';
  document.getElementById('estafaNota').value = '';
  renderEstafaList();
  showToast('Registro de estafa agregado 🚫');
}

function deleteEstafa(id) {
  showConfirmAction('¿Borrar registro?', 'Se eliminará este registro de la lista de estafa.', 'Borrar', 'btn-red', () => {
    const lista = getEstafa().filter(e => e.id !== id);
    saveEstafa(lista);
    renderEstafaList();
    showToast('Registro eliminado');
  });
}

function renderEstafaList() {
  const c = document.getElementById('estafaList');
  if (!c) return;
  const searchEl = document.getElementById('estafaSearch');
  const search = searchEl ? searchEl.value.trim().toLowerCase() : '';
  let lista = getEstafa();
  if (search) {
    lista = lista.filter(e =>
      (e.telefono || '').toLowerCase().includes(search) ||
      (e.nombre || '').toLowerCase().includes(search) ||
      (e.carnet || '').toLowerCase().includes(search) ||
      (e.direccion || '').toLowerCase().includes(search) ||
      (e.nota || '').toLowerCase().includes(search)
    );
  }
  const countEl = document.getElementById('estafaCount');
  if (countEl) countEl.textContent = getEstafa().length;
  if (!lista.length) {
    c.innerHTML = '<div class="es"><div class="es-icon">🚫</div><div class="es-text">' + (search ? 'Sin resultados' : 'No hay registros de estafa') + '</div></div>';
    return;
  }
  let html = '';
  lista.forEach(e => {
    const fecha = e.fecha ? new Date(e.fecha).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
    html += `<div class="card" style="padding:10px 14px;margin-bottom:6px;display:flex;align-items:center;gap:12px;">
      <div style="font-size:20px;flex-shrink:0;">🚫</div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:700;">${e.nombre ? escapeHTML(e.nombre) : '<span style="color:var(--gray-400);">Sin nombre</span>'}</div>
        <div style="font-size:11px;color:var(--gray-400);display:flex;flex-wrap:wrap;gap:6px;margin-top:2px;">
          ${e.telefono ? '<span>📱 ' + escapeHTML(e.telefono) + '</span>' : ''}
          ${e.carnet ? '<span>🪪 ' + escapeHTML(e.carnet) + '</span>' : ''}
          ${e.direccion ? '<span>📍 ' + escapeHTML(e.direccion) + '</span>' : ''}
        </div>
        ${e.nota ? '<div style="font-size:11px;color:var(--red);margin-top:3px;font-weight:600;">⚡ ' + escapeHTML(e.nota) + '</div>' : ''}
        ${fecha ? '<div style="font-size:9px;color:var(--gray-300);margin-top:2px;">' + fecha + '</div>' : ''}
      </div>
      <button class="btn btn-ghost btn-sm" onclick="deleteEstafa(${e.id})" style="flex-shrink:0;font-size:11px;padding:5px 8px;color:var(--red);">✕</button>
    </div>`;
  });
  c.innerHTML = html;
}

// (_valesToFirebaseObj — anidaba vales por gestorId/valeId para el árbol de
// RTDB. Ya no aplica: 'vales' es una colección plana en Firestore, doc id =
// String(vale.id) — ver _buildCollectionUpdates.)

let gestorValesListener = null;
let firstLoadVales = true;
function listenToMyVales(gId) {
  if (gestorValesListener) { gestorValesListener(); gestorValesListener = null; }
  firstLoadVales = true;
  // v33: filosofía v16 — simpleza. El polling trae los vales del gestor desde
  // Supabase. Si el snap tiene vales, los guardamos (reemplazo directo como en
  // v16) PERO preservando vales locales synced:false que no estén en el snap
  // (porque el write puede no haberse confirmado todavía). Si el snap viene
  // vacío, NO tocamos el cache local (no borramos vales existentes).
  window._handleMyValesSnap = function(snap) {
    _syncCount++;
    try {
      const newVales = snap.docs.map(d => d.data());
      const gidNum = Number(gId);

      // Regenerar campos slimados al leer de Supabase
      newVales.forEach(v => {
        if (v && !v.valeText) v.valeText = regenerateValeText(v);
        if (v && Array.isArray(v.valeProductos)) {
          v.valeProductos.forEach(p => {
            if (!p.name) {
              const prod = productoOf(p.id);
              if (prod) p.name = prod.name;
            }
          });
        }
        // Vales que vienen de Supabase están confirmados
        if (v && v.synced === undefined) v.synced = true;
      });

      // Preservar vales locales synced:false que no estén en el snap
      // (el write todavía no se confirmó, el polling no los trae todavía)
      const fbIds = new Set(newVales.map(v => String(v && v.id)));
      const localPending = (getVales() || []).filter(v =>
        v && v.gestorId != null &&
        Number(v.gestorId) === gidNum &&
        v.synced === false &&
        v.status !== 'cancelled' &&
        !fbIds.has(String(v.id))
      );

      // mergedVales = vales del snap + vales locales pendientes
      let mergedVales = newVales.concat(localPending);
      mergedVales.sort((a,b) => new Date(b.ts) - new Date(a.ts));

      // Notificaciones de cambio de status (como en v16)
      if (!firstLoadVales) {
        const oldVales = getVales();
        mergedVales.forEach(nv => {
          const ov = oldVales.find(x => Number(x.id) === Number(nv.id));
          if (ov && ov.status !== nv.status) {
            const prodNames = (nv.valeProductos||[]).map(p => p.qty > 1 ? `${p.qty}x ${escapeHTML(p.name)}` : escapeHTML(p.name)).join(', ');
            if (nv.status === 'assigned') {
              sendBrowserNotif('Venta en camino 🛵', '...');
              playSound('confirm');
            } else if (nv.status === 'delivered') {
              sendBrowserNotif('Venta entregada 🎉', prodNames);
              playSound('confirm');
            } else if (nv.status === 'confirmed') {
              let amtStr = '';
              if(typeof getValeCommissionParts === 'function'){
                const cp = getValeCommissionParts(nv);
                if(cp.total !== null && cp.total > 0) {
                   amtStr = cp.currency === 'MN' ? ` por ${Math.round(cp.total)} MN` : ` por ${cp.total.toFixed(2)} USD`;
                }
              }
              sendBrowserNotif('Venta cobrada 💰', `${prodNames}${amtStr}`);
              playSound('confirm');
            }
          }
        });
      }

      // v40 FIX CRÍTICO: guardar SIEMPRE el resultado del polling, incluso si
      // está vacío. ANTES, si el snap venía vacío (porque el admin borró los
      // vales en Supabase), el cache local NO se tocaba → el gestor seguía
      // viendo los vales borrados para siempre.
      // Ahora: si el polling trajo un snap vacío, significa que Supabase no
      // tiene vales del gestor → borrar el cache local también (excepto
      // vales locales synced:false que aún no se han subido).
      // Si el polling falla (network error), _doRestPoll no llama a este
      // handler, así que estamos seguros de que un snap vacío es legítimo.
      try { localStorage.setItem('axon_vales', JSON.stringify(mergedVales)); _valesCache = mergedVales; _valesDirty = false; } catch(e) {}

      firstLoadVales = false;
    } finally {
      _syncCount--;
      refreshUI();
    }
  };
  // v33: el polling global (_startRestPolling) se encarga de llamar a
  // _handleMyValesSnap cada 5s con los vales del gestor. No hay onSnapshot.
  gestorValesListener = function() { /* no-op en v33: polling global maneja todo */ };
  _startRestPolling();
}

// fbAddVale/fbRemoveVale/fbUpdateVale eliminados — código muerto sin
// llamadores (saveVales() ya encola todo lo necesario) que además usaban la
// forma de path anidada vieja de RTDB (vales/{gestorId}/{valeId}), quedando
// como una trampa para quien los reactivara sin darse cuenta del cambio de
// esquema a Firestore.

// ── Debounce de refreshUI para conexiones lentas ──
// Firebase dispara un snapshot por cada write remoto. En una sesión activa
// con varios gestores enviando vales, podemos recibir 5-10 snapshots por
// segundo, cada uno re-renderizando TODO el panel. En móviles lentos con
// 100+ vales, cada render cuesta 200-500ms → la UI se congela.
// Solución: debounced refreshUI. Si llegan varios snapshots en ráfaga,
// solo renderizamos una vez tras el silencio. El render directo
// (forceRefreshUI) sigue disponible para acciones locales que necesitan
// feedback inmediato (enviar vale, asignar mensajero, etc.).
//
// ── Network Information API ──
// Si el navegador soporta navigator.connection, ajustamos el debounce
// según el tipo de conexión:
//   - 4G/wifi: 150ms (responsivo)
//   - 3G: 300ms (más agresivo para reducir renders)
//   - 2G/slow: 600ms (prioridad a no congelar la UI)
let _refreshUITimer = null;
let _REFRESH_UI_DELAY = 150; // ms — se recalcula según conexión
function _recalcRefreshDelay() {
  try {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn && conn.effectiveType) {
      const et = conn.effectiveType;
      if (et === 'slow-2g' || et === '2g') _REFRESH_UI_DELAY = 600;
      else if (et === '3g') _REFRESH_UI_DELAY = 300;
      else _REFRESH_UI_DELAY = 150;
    }
  } catch(e) { /* navigator.connection no disponible — usar default 150ms */ }
}
_recalcRefreshDelay();
try {
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (conn) conn.addEventListener('change', _recalcRefreshDelay);
} catch(e) {}
let _lastValesHash = '';
function _computeValesHash(vales) {
  if (!Array.isArray(vales) || !vales.length) return '';
  // Hash barato: combinar id+status+ts+seenByAdmin+seenTs del último vale modificado.
  // v41 FIX: ANTES no incluía seenByAdmin ni seenTs, así que cuando el admin
  // hacía clic en un vale (cambia seenByAdmin:true) el hash era idéntico →
  // refreshUI creía que no hubo cambios → no re-renderizaba → el gestor
  // nunca veía "👁️ Visto por admin" aunque el dato ya estaba en el cache.
  // v11 FIX: incluir comisionGestor y commissionStatus/commissionPaid en el hash
  // para que refreshUI detecte cambios en comisiones y re-renderice
  let h = '';
  for (let i = 0; i < vales.length; i++) {
    const v = vales[i];
    h += (v.id || 0) + ':' + (v.status || '') + ':' + (v.ts || '') +
         ':' + (v.seenByAdmin ? '1' : '0') + ':' + (v.seenTs || '') +
         ':' + (v.comisionGestor || '') + ':' + (v.commissionStatus || '') + ':' + (v.commissionPaid ? '1' : '0') + '|';
    if (h.length > 1200) break; // suficiente muestra
  }
  return h;
}
function refreshUI() {
  // Verificar si el snapshot de vales realmente cambió desde el último render.
  // Si es idéntico, saltar el render (snapshot redundante de Firebase).
  const currentVales = getVales();
  const currentHash = _computeValesHash(currentVales);
  if (currentHash === _lastValesHash && currentVales.length > 0) {
    // Snapshot sin cambios reales en vales → igual refrescar notifs/badges
    // pero saltar los renders pesados (lista de vales, comisiones, etc.).
    _refreshLightUI();
    return;
  }
  _lastValesHash = currentHash;
  if (_refreshUITimer) clearTimeout(_refreshUITimer);
  _refreshUITimer = setTimeout(_doRefreshUI, _REFRESH_UI_DELAY);
}
// Para acciones locales que necesitan feedback inmediato (no esperan debounce).
function forceRefreshUI() {
  if (_refreshUITimer) { clearTimeout(_refreshUITimer); _refreshUITimer = null; }
  const currentVales = getVales();
  _lastValesHash = _computeValesHash(currentVales);
  _doRefreshUI();
}
// Render ligero: solo badges y notifs, no listas de vales.
function _refreshLightUI() {
  if(IS_ADMIN) {
    if(typeof updateAdminBadge === 'function') updateAdminBadge();
    if(typeof updateMensajeroBadge === 'function') updateMensajeroBadge();
  } else {
    if(typeof renderGestorNotifs === 'function') renderGestorNotifs();
  }
}
function _doRefreshUI() {
  _refreshUITimer = null;
  if(IS_ADMIN) {
    // ── Optimización: solo renderizar el tab activo ──
    // Antes: cada snapshot de Firebase re-renderizaba TODOS los paneles del
    // admin (vales, stock, gestores, mensajeros, catalog, stats, etc.)
    // aunque el admin estuviera viendo solo uno. En 3G con varios gestores
    // enviando vales, eso era cada 200-500ms → UI congelada.
    // Ahora: solo renderizamos el panel del tab activo + badges globales
    // (que siempre necesitan actualizarse para que el contador de pendientes
    // se vea en el nav). Cuando el admin cambie de tab, ese tab se renderiza
    // fresh en ese momento (ver adminTab()).
    const tab = (typeof currentAdminTab !== 'undefined') ? currentAdminTab : 'vales';
    if(tab === 'vales') {
      if(typeof renderAdminGestores === 'function') renderAdminGestores();
      if(typeof renderMensajeros === 'function') renderMensajeros();
      if(typeof renderConfirmados === 'function') renderConfirmados();
      if(typeof renderPendienteCobro === 'function') renderPendienteCobro();
    } else if(tab === 'stock') {
      if(typeof renderStockCategorias === 'function') renderStockCategorias();
      if(typeof renderProductGrid === 'function') renderProductGrid();
    } else if(tab === 'gestores') {
      if(typeof renderAdminGestoresList === 'function') renderAdminGestoresList();
      if(typeof renderComisiones === 'function') renderComisiones();
    } else if(tab === 'mensajeros') {
      if(typeof renderMensajeroSelector === 'function') renderMensajeroSelector();
      if(typeof renderPendingCobroSection === 'function') renderPendingCobroSection();
      if(typeof renderMensajeroVales === 'function') renderMensajeroVales();
    } else if(tab === 'catalog') {
      if(typeof renderAdminCatalogCats === 'function') renderAdminCatalogCats();
      if(typeof renderAdminCatalog === 'function') renderAdminCatalog();
    } else if(tab === 'stats') {
      if(typeof renderStats === 'function') renderStats();
    } else if(tab === 'historial') {
      if(typeof renderHistorial === 'function') renderHistorial();
    } else if(tab === 'estafa') {
      if(typeof renderEstafaList === 'function') renderEstafaList();
    }
    // Badges y detalles siempre (son baratos y necesarios globalmente).
    if(typeof updateAdminBadge === 'function') updateAdminBadge();
    if(typeof updateMensajeroBadge === 'function') updateMensajeroBadge();
    if(typeof renderValeDetail === 'function' && typeof selectedValeId !== 'undefined' && selectedValeId) renderValeDetail();
    // Audit log: solo si estamos en config o si el panel está visible.
    // Es barato pero innecesario si no se está viendo.
    if(tab === 'config' && typeof renderAuditLog === 'function') renderAuditLog();
  } else {
    if(typeof renderGestores === 'function') renderGestores();
    if(typeof renderGestorNotifs === 'function') renderGestorNotifs();
    if(typeof renderMyVales === 'function') renderMyVales();
    // Ranking: es pesado (filtra vales, suma puntos, ordena) y no es crítico
    // para la interacción del usuario. Lo hacemos en requestIdleCallback para
    // que no bloquee el frame principal. Si el navegador no lo soporta, cae
    // a setTimeout(0).
    if(typeof renderGestorRanking === 'function') {
      rankingCache=null;
      if(window.requestIdleCallback) {
        if(_rankingIdleHandle) cancelIdleCallback(_rankingIdleHandle);
        _rankingIdleHandle = requestIdleCallback(() => { _rankingIdleHandle = null; renderGestorRanking(); }, {timeout: 1000});
      } else {
        renderGestorRanking();
      }
    }
    if(typeof renderGestorCatalog === 'function') {
       if(document.getElementById('gestorCatalogModal')?.classList.contains('show')) {
           renderGestorCatalog();
       }
    }
  }
}
let _rankingIdleHandle = null;



// Base Listeners (Everything except vales) — with try/finally to prevent isSyncingFromFirebase from sticking
// 'ranking_summary' está incluido aquí para que TODOS los dispositivos de gestor
// reciban el resumen de puntos que el admin calcula desde el árbol completo de
// vales (ver el listener de 'vales' más abajo). Antes nada lo escuchaba y
// renderGestorRanking() recalculaba los puntos desde getVales(), que en un
// dispositivo de gestor SOLO contiene sus propios vales — el ranking mostraba
// 0 pts para todos los demás gestores.
// Colecciones de entidades reales.
// v31: ya NO usamos onSnapshot (SDK Firestore eliminado). El polling por
// HTTPS cada 5s (arrancado abajo con _startRestPolling) ya trae todas las
// colecciones y llama a los manejadores correspondientes. Este forEach
// queda como no-op — lo mantenemos para que cualquier referencia futura
// no rompa, pero no registra ningún listener real.
['gestores', 'mensajeros', 'productos', 'categorias'].forEach(node => {
  // no-op: _doRestPoll ya trae estas colecciones cada 5s
});
// Arrancar el sondeo por HTTPS desde el inicio en AMBAS páginas (admin y
// gestor). Sin esto, un dispositivo nuevo con el streaming bloqueado no
// recibiría ni la lista de gestores para poder seleccionarse.
_startRestPolling();

// Nodos singleton: un solo documento en meta/{node}. 'notifs'/'estafa'/
// 'ranking_summary' guardan un array envuelto en {items:[...]} porque
// Firestore no admite un array como raíz de documento — 'config' es un
// objeto plano, sin envolver.
// 'ranking_summary' está incluido aquí para que TODOS los dispositivos de gestor
// reciban el resumen de puntos que el admin calcula desde el árbol completo de
// vales (ver el listener de 'vales' más abajo). Un gestor NUNCA tiene en su
// caché local los vales de los demás gestores.
// v31: ya NO usamos onSnapshot (SDK Firestore eliminado). El polling por
// HTTPS cada 5s ya trae todos los singletons (config/notifs/estafa/
// ranking_summary) a través de _doRestPoll. No-op.
['config', 'notifs', 'estafa', 'ranking_summary'].forEach(node => {
  // no-op: _doRestPoll ya trae estos documentos cada 5s
});

// Vales Listeners
if (IS_ADMIN) {
  // Admin listens to ALL vales from all gestores — with try/finally
  let _rankingDebounce = null;
  let _lastRankingSummary = '';  // hash del último summary enviado → evitar writes redundantes
  window._handleValesSnap = function(snap) {
    _syncCount++;
    try {
      // v33: filosofía v16 — simpleza. El polling trae TODOS los vales de
      // Supabase. Los guardamos (reemplazo directo) PERO preservando vales
      // locales synced:false que no estén en el snap (write sin confirmar).
      // Si el snap viene vacío, NO tocamos el cache local.
      let flatVales = snap.docs.map(d => d.data());

      // Regenerar campos slimados
      flatVales.forEach(v => {
        if (v && !v.valeText) v.valeText = regenerateValeText(v);
        if (v && Array.isArray(v.valeProductos)) {
          v.valeProductos.forEach(p => {
            if (!p.name) {
              const prod = productoOf(p.id);
              if (prod) p.name = prod.name;
            }
          });
        }
        if (v && v.synced === undefined) v.synced = true;
      });

      // Preservar vales locales synced:false que no estén en el snap
      const fbIds = new Set(flatVales.map(v => String(v && v.id)));
      const localPending = (getVales() || []).filter(v =>
        v && v.synced === false &&
        v.status !== 'cancelled' &&
        !fbIds.has(String(v.id))
      );

      let mergedFlatVales = flatVales.concat(localPending);
      mergedFlatVales.sort((a,b) => new Date(b.ts) - new Date(a.ts));

      // Check for new vales with estafa matches before saving
      const oldVales = getVales();
      const newIds = mergedFlatVales.filter(nv => nv.isNew && !oldVales.find(ov => Number(ov.id) === Number(nv.id)));

      // v40 FIX: guardar SIEMPRE, incluso si está vacío. Si el admin hizo
      // factoryResetVales() o clearGestoresData(), Supabase queda vacío y el
      // polling trae [] → el cache local debe vaciarse también.
      try { localStorage.setItem('axon_vales', JSON.stringify(mergedFlatVales)); _valesCache = mergedFlatVales; _valesDirty = false; } catch(e) {}

      // Show estafa alert for new vales that match blacklist
      newIds.forEach(nv => {
        const estafaMatches = checkEstafaMatch(nv);
        if(estafaMatches.length) setTimeout(() => showEstafaAlert(nv, estafaMatches), 300);
      });

      // Debounced ranking summary update
      clearTimeout(_rankingDebounce);
      _rankingDebounce = setTimeout(() => {
        const gestores = getGestores();
        const summary = gestores.map(g => {
          const pts = mergedFlatVales.filter(v=>Number(v.gestorId)===Number(g.id)&&['confirmed','pending_payment'].includes(v.status))
            .reduce((sum,v)=>sum+(v.valeProductos||[]).reduce((s,p)=>{const pr=productoOf(p.id);return s+(pr?pr.puntos*p.qty:0);},0),0);
          return { id: g.id, pts };
        });
        const summaryStr = JSON.stringify(summary);
        if (summaryStr !== _lastRankingSummary) {
          _lastRankingSummary = summaryStr;
          _enqueueFB('ranking_summary', summary, 'set');
        }
      }, 3000);
    } finally {
      _syncCount--;
      refreshUI();
    }
  };
  // v31: ya NO usamos onSnapshot (SDK Firestore eliminado). El polling por
  // HTTPS cada 5s trae la colección 'vales' y llama a window._handleValesSnap
  // automáticamente a través de _doRestPoll().
  _startRestPolling();
}

// Initialize empty Supabase from local if Admin (proyecto nuevo, sin datos aún)
if (IS_ADMIN) {
  setTimeout(() => {
    // v31: si la tabla 'gestores' está vacía en Supabase, sembrar con los
    // datos locales del admin (primera vez). Usamos _sbRestGetCollection
    // en vez de firestoreDb.collection().get() — ya no hay SDK Firestore.
    _sbRestGetCollection('gestores').then(arr => {
      if (arr && arr.length === 0) {
        const lGestores = getGestores();
        if (lGestores.length > 0) {
          // v31: el chunking sigue siendo útil para no mandar un payload
          // gigante de una sola vez en redes lentas. _enqueueFBChunked
          // trocea por tamaño (~6KB/chunk).
          _enqueueFBChunked('gestores', _buildCollectionUpdates(lGestores, null), 'update');
          _enqueueFBChunked('mensajeros', _buildCollectionUpdates(getMensajeros(), null), 'update');
          _enqueueFBChunked('productos', _buildCollectionUpdates(getProductos(), null), 'update');
          _enqueueFBChunked('categorias', _buildCollectionUpdates(getCategorias(), null), 'update');
          setFB('config', getConfig());
          const localVales = getVales();
          if (localVales.length) {
            _enqueueFBChunked('vales', _buildCollectionUpdates(localVales, null), 'update');
          }
        }
      }
    }).catch(e => console.error('[supabase] bootstrap check error:', e));
  }, 1500);
}




function patchVale(id, changes) {
  // BUGFIX CRÍTICO: getVales() devuelve la MISMA referencia que _valesCache
  // (no una copia). "all[i] = {...}" mutaba esa entrada DENTRO del array
  // que _valesCache sigue apuntando, así que dentro de saveVales(),
  // "prevVales = _valesCache" ya reflejaba el cambio — el diff comparaba
  // el vale modificado contra SÍ MISMO, veía "sin cambios", y el patch
  // (asignar mensajero, confirmar venta, marcar entregado, cancelar,
  // marcar comisión pagada, etc. — TODO lo que pasa por patchVale) nunca
  // se encolaba hacia Firestore. Se guardaba local nada más. Este es el
  // mismo bug que en sendVale()/addGestor(), pero aquí afecta a CADA
  // acción del admin sobre un vale ya existente, no solo a los nuevos.
  // Fix: .map() construye un array NUEVO en vez de mutar el existente.
  const all = getVales().map(v => v.id === id ? {...v, ...changes} : v);
  if (all.some(v => v.id === id)) {
    // saveVales already writes to Firebase via _enqueueFB — no need for redundant fbUpdateVale
    // Previously, both saveVales (full 'set') and fbUpdateVale (partial 'update') were called,
    // causing race conditions where Firebase could overwrite local changes with stale data.
    saveVales(all);
  }
}
// Genera el siguiente número de vale.
// v17: Patrón híbrido — local-sync síncrono + reconciler atómico async.
// ANTES (v15): el patrón local-sync podía duplicar valeNum si dos gestores
// enviaban un vale en el mismo milisegundo. A 10 Kbit/s, la latencia del
// listener de config es de varios segundos → alta probabilidad de colisión.
// AHORA (v17):
//   1. getNextValeNum() sigue siendo síncrono: reserva el número localmente
//      y encola el update a Firebase. El gestor NO espera.
//   2. _reconcileNextValeNum() corre en background cuando hay conexión:
//      usa transaction() de Firebase para asegurar que el contador remoto
//      sea monótonamente creciente. Si dos gestores reservaron el mismo
//      número localmente, el reconciler detecta la discrepancia y la corrige
//      para los siguientes vales (los ya enviados conservan su número).
//
// IMPORTANTE: esta función NO usa saveConfig() a propósito (ver nota anterior).
function getNextValeNum() {
  const cfg = getConfig();
  const n = (cfg.nextValeNum || 1);
  const updated = {...cfg, nextValeNum: n + 1};
  _safeSetLS('axon_config', JSON.stringify(updated));
  _configCache = updated; _configDirty = false;
  if (!isSyncingFromFirebase()) _enqueueFB('config', {nextValeNum: n + 1}, 'update');
  // v17: disparar el reconciler atómico en background (no bloquea al caller).
  // Se ejecuta solo si hay conexión y no hay ya un reconcile en curso.
  _scheduleReconcileNextValeNum();
  return n;
}

// ── v17: Reconciler atómico de nextValeNum ──
// Garantiza que el contador remoto de Firebase nunca sea menor que el local.
// Si dos gestores reservaron el mismo número en sus copias locales, el
// reconciler usa transaction() para forzar que el remoto sea el máximo.
// Esto no "desduplica" los vales ya enviados (conservan su número), pero
// asegura que los SIGUIENTES vales no colisionen.
let _reconcileNextValeNumInFlight = false;
let _reconcileNextValeNumScheduled = false;
function _scheduleReconcileNextValeNum() {
  if (_reconcileNextValeNumInFlight || _reconcileNextValeNumScheduled) return;
  if (!_fbConnected) return; // no tiene sentido sin conexión
  _reconcileNextValeNumScheduled = true;
  // Pequeño delay para coalesar múltiples llamadas en una sola transacción.
  setTimeout(_doReconcileNextValeNum, 800);
}
async function _doReconcileNextValeNum() {
  _reconcileNextValeNumScheduled = false;
  if (_reconcileNextValeNumInFlight) return;
  if (!_fbConnected) return;
  _reconcileNextValeNumInFlight = true;
  try {
    const localCfg = getConfig();
    const localNext = localCfg.nextValeNum || 1;
    // v31: sin SDK Firestore, no hay runTransaction. Equivalente: leer el
    // config remoto de Supabase por REST; si su nextValeNum es menor que
    // el local, hacer UPSERT con el valor local. Si dos gestores hacen esto
    // a la vez, el último en escribir gana (race benigno: el número real
    // ya se asignó a cada vale por Date.now() que es único).
    const remote = await _sbRestGetMeta('config');
    const remoteNext = (remote && remote.nextValeNum) || 1;
    if (remoteNext < localNext) {
      // Merge: preservar los demás campos del config remoto si existen.
      const merged = Object.assign({}, remote || {}, { nextValeNum: localNext });
      await _sbRestMetaUpsert('config', merged);
      // Actualizar cache local para que el listener no lo revierta.
      const cfg = getConfig();
      cfg.nextValeNum = localNext;
      _safeSetLS('axon_config', JSON.stringify(cfg));
      _configCache = cfg;
      console.log('[reconcile] nextValeNum ajustado a', localNext);
    }
  } catch(e) {
    // Silencioso — el reconciler es best-effort, no bloquea nada.
    console.warn('[reconcile] error:', e && e.message);
  } finally {
    _reconcileNextValeNumInFlight = false;
  }
}
function valeNumStr(v) {
  return v.valeNum ? 'V-' + String(v.valeNum).padStart(3,'0') : '';
}
function patchProducto(id, changes) {
  // BUGFIX: mismo problema que patchVale() — no mutar el array que
  // devuelve getProductos() (afecta stock, reservas, etc.).
  const all = getProductos().map(p => p.id === id ? {...p, ...changes} : p);
  if (all.some(p => p.id === id)) saveProductos(all);
}

// ══════════════════════════════════════════
//  NOTIFICATIONS (gestor)
// ══════════════════════════════════════════
const LOW_STOCK_THRESHOLD = 3;

// ── STOCK RESERVADO ──
// Cada producto puede tener una cantidad `reserved` (comprometida con un
// cliente/clientes pero aún no entregada). El stock realmente disponible
// para nuevos vales es stock - reserved.
// - stock: inventario físico total (no se toca al reservar).
// - reserved: unidades comprometidas (se baja cuando se entrega/cancela).
// - disponible = max(0, stock - reserved).
function _availableStock(p) {
  if (!p) return 0;
  const s = parseInt(p.stock || 0, 10);
  const r = parseInt(p.reserved || 0, 10);
  return Math.max(0, s - r);
}
function _isFullyReserved(p) {
  if (!p) return false;
  const s = parseInt(p.stock || 0, 10);
  const r = parseInt(p.reserved || 0, 10);
  return s > 0 && r >= s;
}
function _isPartiallyReserved(p) {
  if (!p) return false;
  const s = parseInt(p.stock || 0, 10);
  const r = parseInt(p.reserved || 0, 10);
  return r > 0 && r < s;
}

// Descuenta stock de los productos de un vale y genera notificaciones.
// Extraído de mensajeroEntrega/mensajeroPagado/mensajeroPagadoDirecto/confirmSale
// que tenían 4 copias del mismo bloque con divergencias sutiles.
// Ver AUDITORIA-AXONTECH.md MEDIO 28.
function _descontarStock(v) {
  const prods = getProductos();
  let stockChanged = false;
  (v.valeProductos || []).forEach(({id:pid, qty}) => {
    const idx = prods.findIndex(p => p.id === pid);
    if (idx === -1) return;
    const oldStock = prods[idx].stock || 0;
    const newStock = Math.max(0, oldStock - qty);
    prods[idx] = {...prods[idx], stock: newStock};
    stockChanged = true;
    addNotif('sale_product', prods[idx].name, pid, `${qty}|${newStock}`, v.gestorId);
    if (newStock === 0 && oldStock > 0) addNotif('out_of_stock', prods[idx].name, pid, 'stock agotado');
    else if (newStock > 0 && newStock <= LOW_STOCK_THRESHOLD && oldStock > LOW_STOCK_THRESHOLD) addNotif('low_stock', prods[idx].name, pid, `quedan ${newStock}`);
  });
  if (stockChanged) saveProductos(prods);
  return stockChanged;
}

function addNotif(type, productName, productId, extra, gestorId) {
  const notifs = getNotifs();
  notifs.unshift({ id:Date.now(), type, productName, productId, ts:new Date().toISOString(), read:false, extra:extra||'', gestorId:gestorId||null });
  if (notifs.length > 50) notifs.splice(50);
  saveNotifs(notifs);
  renderGestorNotifs();
}

function openNotifsModal() {
  const gId = activeGestorId ? activeGestorId : 'global';
  const notifs = getNotifs();
  if (notifs.length > 0) {
    localStorage.setItem('axon_viewed_id_' + gId, notifs[0].id);
  }
  renderGestorNotifs();
  document.getElementById('notifsModal').classList.add('show');
}
function closeNotifsModal() {
  document.getElementById('notifsModal').classList.remove('show');
}
function clearGestorNotifs() {
  const gId = activeGestorId ? activeGestorId : 'global';
  const notifs = getNotifs();
  if (notifs.length > 0) {
    localStorage.setItem('axon_cleared_id_' + gId, notifs[0].id);
  }
  // Also clear personal notifs for current gestor
  if(activeGestorId) {
    localStorage.setItem('axon_cleared_personal_' + activeGestorId, '1');
  }
  renderGestorNotifs();
  closeNotifsModal();
}
function clearSingleNotif(notifId) {
  const notifs = getNotifs();
  const idx = notifs.findIndex(n => n.id === notifId);
  if(idx !== -1) {
    notifs.splice(idx, 1);
    saveNotifs(notifs);
  }
  renderGestorNotifs();
}
function clearPersonalNotifs(gestorId) {
  if(!gestorId) return;
  localStorage.setItem('axon_cleared_personal_' + gestorId, '1');
  renderGestorNotifs();
  showToast('Alertas personales limpiadas ✓');
}
function renderGestorNotifs() {
  const notifs = getNotifs();
  const gId = activeGestorId ? activeGestorId : 'global';
  const viewedId = parseInt(localStorage.getItem('axon_viewed_id_' + gId) || '0');
  const clearedId = parseInt(localStorage.getItem('axon_cleared_id_' + gId) || '0');

  // Find indexes
  const viewedIdx = notifs.findIndex(n => n.id === viewedId);
  const clearedIdx = notifs.findIndex(n => n.id === clearedId);
  
  // Slicing arrays
  const visibleNotifs = clearedIdx !== -1 ? notifs.slice(0, clearedIdx) : notifs;

  // Global Notifs
  const globalNotifs = visibleNotifs.filter(n => !['vale_confirmed', 'vale_assigned', 'vale_seen', 'ranking_top3'].includes(n.type));
  
  // Personal Notifs — check if cleared for this gestor
  const personalCleared = activeGestorId ? localStorage.getItem('axon_cleared_personal_' + activeGestorId) : null;
  const personalNotifs = notifs.filter(n => {
    return ['vale_confirmed', 'vale_assigned', 'vale_seen', 'ranking_top3'].includes(n.type) && activeGestorId && Number(n.gestorId) === Number(activeGestorId);
  });

  const sec = document.getElementById('gestorNotifsSection');
  const personalSec = document.getElementById('gestorPersonalNotifsSection');
  
  const icons = {new_product:'✨',out_of_stock:'❌',low_stock:'⚠️',restocked:'✅',vale_confirmed:'🎉',sale_product:'🛒',vale_assigned:'🛵',vale_seen:'👁️',ranking_top3:'🏆'};
  
  const renderItem = (n, isPersonal) => {
    const icon=icons[n.type]||'📢';
    const age=timeAgo(n.ts);
    const typeClass=n.type==='out_of_stock'?'agotado':n.type==='low_stock'?'low':n.type==='restocked'?'restocked':['vale_confirmed','sale_product','vale_assigned','vale_seen','ranking_top3'].includes(n.type)?'ok':'';
    
    // Unread logic
    const nIdx = notifs.findIndex(x => Number(x.id) === Number(n.id));
    const isUnread = !isPersonal && (viewedIdx === -1 || nIdx < viewedIdx);
    const cls=isUnread?'unread':`type-${typeClass}`;
    
    // Escape all user-provided data to prevent XSS
    const safeName = escapeHTML(n.productName);
    const safeExtra = escapeHTML(n.extra||'');
    let msg='';
    if(n.type==='sale_product'){
      const parts=(n.extra||'').split('|');
      const qty=parseInt(parts[0])||1;
      const left=parseInt(parts[1]);
      msg=`<b>Se vendió${qty>1?` <span style="color:var(--blue);font-weight:800;">${qty}</span>`:``}</b> ${safeName}${!isNaN(left)?` — quedan <b style="color:${left===0?'var(--red)':left<=LOW_STOCK_THRESHOLD?'var(--yellow)':'var(--green)'};">${left}</b>`:``}`;
    } else if(n.type==='vale_assigned'){
      msg=`🛵 Tu venta está con el mensajero`;
    } else if(n.type==='vale_seen'){
      msg=`👁️ <b>El admin vio tu vale</b>${safeName?` · ${safeName}`:``}${safeExtra?` <span style="color:var(--gray-400);font-size:10px;">(${safeExtra})</span>`:``}`;
    } else if(n.type==='vale_confirmed'){
      msg=`<b>¡Venta completada! ✅</b> · ${safeName}${safeExtra?` <span style="color:var(--gray-400);font-size:10px;">(${safeExtra})</span>`:``}`;
    } else if(n.type==='out_of_stock'){
      msg=`<b>Agotado:</b> ${safeName}`;
    } else if(n.type==='low_stock'){
      msg=`<b>Stock bajo:</b> ${safeName} <span style="color:var(--yellow);">(${safeExtra})</span>`;
    } else if(n.type==='restocked'){
      msg=`<b>Repuesto:</b> ${safeName} <span style="color:var(--green);">(${safeExtra})</span>`;
    } else if(n.type==='new_product'){
      msg=`<b>Nuevo producto:</b> ${safeName}${safeExtra?` · ${safeExtra}`:``}`;
    } else if(n.type==='ranking_top3'){
      const parts=(n.extra||'').split('|');
      const place=parts[0]||'';const pts=parts[1]||'';
      const placeNum=parseInt(parts[2])||0;
      const placeEmoji=placeNum===1?'🥇':placeNum===2?'🥈':placeNum===3?'🥉':'🏆';
      msg=`<b>${placeEmoji} ${place}</b> · ${escapeHTML(n.productName)} con <b>${pts} pts</b>`;
    } else {
      msg=`${safeName}${safeExtra?` (${safeExtra})`:``}`;
    }
    return `<div class="gnotif-item ${cls}" style="position:relative;">
      <button onclick="clearSingleNotif(${n.id})" title="Eliminar esta alerta" style="position:absolute;top:4px;right:4px;background:none;border:none;color:var(--gray-400);font-size:14px;cursor:pointer;padding:2px 4px;line-height:1;opacity:.6;" onmouseenter="this.style.opacity='1'" onmouseleave="this.style.opacity='.6'">×</button>
      <div class="gnotif-icon">${icon}</div>
      <div class="gnotif-text">${msg}</div>
      <div class="gnotif-time">${age}</div>
    </div>`;
  };

  if(sec) {
    const unread = globalNotifs.filter(n => {
       const idx = notifs.findIndex(x => Number(x.id) === Number(n.id));
       return viewedIdx === -1 || idx < viewedIdx;
    }).length;
    const badge = document.getElementById('notifUnreadBadge');
    if(badge){badge.textContent=unread;badge.style.display=unread?'inline-block':'none';}
    
    if(!globalNotifs.length) {
      document.getElementById('gestorNotifsList').innerHTML = '<div class="es" style="padding:10px;"><div class="es-text">No hay alertas recientes.</div></div>';
    } else {
      document.getElementById('gestorNotifsList').innerHTML = globalNotifs.map(n => renderItem(n, false)).join('');
    }
  }

  if(personalSec) {
    if(!personalNotifs.length || !activeGestorId) {
      personalSec.style.display='none';
    } else if(personalCleared) {
      personalSec.style.display='none';
    } else {
      personalSec.style.display='block';
      document.getElementById('gestorPersonalNotifsList').innerHTML = 
        `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <span style="font-size:11px;color:var(--gray-400);">${personalNotifs.length} alerta${personalNotifs.length!==1?'s':''}</span>
          <button onclick="clearPersonalNotifs(${activeGestorId})" style="font-size:10px;padding:2px 8px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);border-radius:4px;color:var(--gray-400);cursor:pointer;">Limpiar todas</button>
        </div>` +
        personalNotifs.map(n => renderItem(n, true)).join('');
    }
  }
}

// ══════════════════════════════════════════
//  TOAST
// ══════════════════════════════════════════
let _tt;
function showToast(msg) {
  const t=document.getElementById('toast');
  if(!t)return;
  t.textContent=msg;t.classList.add('show');
  clearTimeout(_tt);_tt=setTimeout(()=>t.classList.remove('show'),2800);
}

// ══════════════════════════════════════════
//  DATE / NOTIFICATIONS
// ══════════════════════════════════════════
function updateDate() {
  const hd=document.getElementById('headerDate');
  if(hd)hd.textContent=new Date().toLocaleDateString('es-ES',{weekday:'short',day:'numeric',month:'short'});
  const fEl=document.getElementById('vf-fecha');
  if(fEl)fEl.value=nowDateTime();
}
function requestNotifPermission() {
  if(!('Notification' in window)){showToast('Este navegador no soporta notificaciones push');return;}
  // Skip if already granted or denied — don't show the prompt repeatedly
  if(Notification.permission !== 'default'){
    showToast('Permiso de notificaciones: ' + (Notification.permission === 'granted' ? 'activado ✓' : 'bloqueado'));
    return;
  }
  Notification.requestPermission().then(p => {
     if(p === 'granted') {
        showToast('Notificaciones activadas ✓');
     } else {
        showToast('Permiso denegado por el navegador');
     }
  });
}
function sendBrowserNotif(title,body) {
  if('Notification' in window && Notification.permission==='granted'){
    if ('serviceWorker' in navigator && navigator.serviceWorker.ready) {
      navigator.serviceWorker.ready.then(reg => {
        reg.showNotification(title, {body, icon: './iconos/icon-192.png'});
      }).catch(() => {
        new Notification(title,{body, icon: './iconos/icon-192.png'});
      });
    } else {
      new Notification(title,{body, icon: './iconos/icon-192.png'});
    }
  }
}

// ══════════════════════════════════════════
//  MODE
// ══════════════════════════════════════════
function switchMode(mode) {
  if (mode === 'admin') {
    if (IS_ADMIN) return; // already on admin page
    if (!adminActive) { openPassModal(); return; }
    activateAdminMode();
    return;
  }
  // gestor mode
  if (IS_ADMIN) { window.location.href = './index.html'; return; }
  const lg = document.getElementById('layoutGestor');
  const la = document.getElementById('layoutAdmin');
  if (lg && la) { [lg, la].forEach(el => el.classList.remove('active')); lg.classList.add('active'); }
  const ba = document.getElementById('btnAdminAccess'); if (ba) ba.style.display = 'flex';
  const bc = document.getElementById('btnCatalogo'); if (bc) bc.style.display = 'inline-flex';
}
function activateAdminMode() {
  const la = document.getElementById('layoutAdmin');
  if (la) la.classList.add('active');
  if (!IS_ADMIN) {
    const lg = document.getElementById('layoutGestor');
    if (lg) lg.classList.remove('active');
    const ba = document.getElementById('btnAdminAccess'); if (ba) ba.style.display = 'none';
    const bc = document.getElementById('btnCatalogo'); if (bc) bc.style.display = 'none';
  }
  const al = document.getElementById('adminLabel'); if (al) al.style.display = 'flex';
  const bl = document.getElementById('btnLogout'); if (bl) bl.style.display = 'inline-flex';
  const cfg = getConfig();
  const ph = document.getElementById('adminPhoneInput'); if (ph && cfg.adminPhone) ph.value = cfg.adminPhone;
  const cph = document.getElementById('catalogPhoneInput'); if (cph && cfg.catalogPhone) cph.value = cfg.catalogPhone;
  const today = new Date().toISOString().slice(0, 10);
  const sf = document.getElementById('statsDateFrom'); if (sf) sf.value = today;
  const st = document.getElementById('statsDateTo'); if (st) st.value = today;
  const hist7 = new Date(Date.now()-7*24*60*60*1000).toISOString().slice(0, 10);
  const histFrom = document.getElementById('histDateFrom'); if (histFrom) histFrom.value = hist7;
  const histTo = document.getElementById('histDateTo'); if (histTo) histTo.value = today;
  adminTab('vales');
  updateAdminBadge();
}
function logoutAdmin() {
  adminActive = false;
  showToast('Sesión admin cerrada');
  if (IS_ADMIN) { window.location.href = './index.html'; return; }
  const al = document.getElementById('adminLabel'); if (al) al.style.display = 'none';
  const bl = document.getElementById('btnLogout'); if (bl) bl.style.display = 'none';
  switchMode('gestor');
}

// ══════════════════════════════════════════
//  ADMIN TABS
// ══════════════════════════════════════════
function adminTab(tab) {
  currentAdminTab=tab;
  ['vales','stock','gestores','stats','mensajeros','config','historial','catalog','estafa'].forEach(t=>{
    const btn=document.getElementById('anav-'+t);if(btn)btn.classList.toggle('active',t===tab);
    const pid='admin'+t.charAt(0).toUpperCase()+t.slice(1)+'Panel';
    const el=document.getElementById(pid);
    if(el){el.style.display=t===tab?(t==='vales'?'grid':'block'):'none';}
  });
  if(tab==='vales'){renderAdminGestores();renderMensajeros();renderConfirmados();renderPendienteCobro();}
  if(tab==='stock'){renderStockCategorias();renderProductGrid();}
  if(tab==='catalog'){renderAdminCatalogCats();renderAdminCatalog();}
  if(tab==='gestores'&&gestoresTabDirty){renderAdminGestoresList();renderComisiones();gestoresTabDirty=false;}
  if(tab==='stats'&&statsTabDirty){renderStats();statsTabDirty=false;}
  if(tab==='mensajeros'){renderMensajeroSelector();renderPendingCobroSection();renderMensajeroVales();}
  if(tab==='config'){loadGhConfigUI();loadMaintenanceModeUI();}
  if(tab==='historial'){renderHistorial();}
  if(tab==='estafa'){renderEstafaList();}
}

// ══════════════════════════════════════════
//  BADGE
// ══════════════════════════════════════════
function updateAdminBadge() {
  const n=pendingCount();
  const b=document.getElementById('adminBadge');
  const ib=document.getElementById('inboxCountBadge');
  if(n>0){if(b){b.textContent=n;b.classList.add('show');}if(ib){ib.textContent=n;ib.style.display='inline-block';}}
  else{if(b)b.classList.remove('show');if(ib)ib.style.display='none';}
}

// ══════════════════════════════════════════
//  PASSWORD MODAL
// ══════════════════════════════════════════
function openPassModal() {
  document.getElementById('passInput').value='';
  document.getElementById('passError').style.display='none';
  document.getElementById('passModal').classList.add('show');
  setTimeout(()=>document.getElementById('passInput').focus(),100);
}
function closePassModal() {
  document.getElementById('passModal').classList.remove('show');
  if (IS_ADMIN && !adminActive) { window.location.href = './index.html'; }
}
function submitPass() {
  const val=document.getElementById('passInput').value;
  // Use async verification for proper SHA-256 checking
  verifyPassAsync(val).then(ok => {
    if(ok){
      adminActive=true;closePassModal();
      const al=document.getElementById('adminLabel'); if(al) al.style.display='flex';
      const bl=document.getElementById('btnLogout'); if(bl) bl.style.display='inline-flex';
      playSound('login');requestNotifPermission();
      activateAdminMode();
      _resetSessionTimer(); // Arrancar el timer de inactividad tras login. Ver AUDITORIA-AXONTECH.md MEDIO 27.
      showToast('Bienvenido, Admin ✓');
    } else {
      document.getElementById('passError').style.display='block';
      document.getElementById('passInput').select();
    }
  });
}


// ══════════════════════════════════════════
//  AUTH & SOUND
// ══════════════════════════════════════════
// NOTA: checkPass() fue eliminada — era código muerto (no se llamaba desde ningún
// sitio, el login usa verifyPassAsync) y contenía un fallback inseguro basado en
// sessionStorage manipulable. Ver AUDITORIA-AXONTECH.md MEDIO 19.

// Async password verification — use this for login forms
async function verifyPassAsync(input) {
  const stored = localStorage.getItem('axon_admin_hash');
  if (!stored) {
    // Default password
    const defaultHash = await _hashPass('axon2024');
    if (input === 'axon2024') {
      localStorage.setItem('axon_admin_hash', defaultHash);
      return true;
    }
    return false;
  }
  if (stored.startsWith('sha256:')) {
    // Migration path: try legacy v74 hash (SHA-256 with static salt) FIRST.
    // This must run BEFORE _hashPass() because _hashPass generates a random salt
    // on first call, and we need to detect the legacy format independently of
    // whether a salt exists yet.
    try {
      const legacyData = new TextEncoder().encode(input + '_axontech_salt_2024');
      const legacyBuf = await crypto.subtle.digest('SHA-256', legacyData);
      const legacyArr = Array.from(new Uint8Array(legacyBuf));
      const legacyHash = 'sha256:' + legacyArr.map(b => b.toString(16).padStart(2, '0')).join('');
      if (legacyHash === stored) {
        // Legacy v74 hash matched — migrate to new PBKDF2 format.
        const newHash = await _hashPass(input);
        localStorage.setItem('axon_admin_hash', newHash);
        sessionStorage.setItem('axon_admin_session', newHash);
        return true;
      }
    } catch(e) {}
    // Try the new PBKDF2 hash (for v75+ hashes that already have a salt)
    const inputHash = await _hashPass(input);
    if (inputHash === stored) {
      sessionStorage.setItem('axon_admin_session', stored);
      return true;
    }
    return false;
  }
  // Legacy btoa migration (very old versions stored btoa(password))
  if (btoa(input) === stored) {
    const h = await _hashPass(input);
    localStorage.setItem('axon_admin_hash', h);
    localStorage.removeItem('axon_admin_hash_legacy');
    sessionStorage.setItem('axon_admin_session', h);
    return true;
  }
  return false;
}
async function _hashPass(input) {
  // PBKDF2-style hashing: per-user random salt + 100k iterations of SHA-256.
  // Falls back to legacy SHA-256 + static salt if WebCrypto PBKDF2 is unavailable.
  try {
    const saltB64 = localStorage.getItem('axon_admin_salt');
    let salt;
    if (saltB64) {
      // Reuse existing salt
      const bin = atob(saltB64);
      salt = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) salt[i] = bin.charCodeAt(i);
    } else {
      // Generate a new 16-byte salt
      salt = crypto.getRandomValues(new Uint8Array(16));
      let bin = '';
      salt.forEach(b => bin += String.fromCharCode(b));
      localStorage.setItem('axon_admin_salt', btoa(bin));
    }
    const keyMaterial = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(input), 'PBKDF2', false, ['deriveBits']
    );
    const hashBuf = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
      keyMaterial, 256
    );
    const hashArr = Array.from(new Uint8Array(hashBuf));
    return 'sha256:' + hashArr.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch(e) {
    // Fallback: simple SHA-256 with static salt (less secure, but functional)
    const data = new TextEncoder().encode(input + '_axontech_salt_2024');
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return 'sha256:' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
}
// Timing-safe string comparison to prevent timing attacks on hashes
function _timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function changePass() {
  const np = document.getElementById('newPassInput').value.trim();
  if (!np||np.length<4){showToast('Mínimo 4 caracteres');return;}
  _hashPass(np).then(h => {
    localStorage.setItem('axon_admin_hash', h);
    // No longer storing reversible btoa version — security improvement
    localStorage.removeItem('axon_admin_hash_legacy');
    document.getElementById('newPassInput').value='';
    showToast('Contraseña actualizada ✓');
  });
}
// Shared AudioContext to prevent memory leak from creating new contexts
let _sharedAC = null;
function playSound(type) {
  try {
    if (!_sharedAC) _sharedAC = new (window.AudioContext||window.webkitAudioContext)();
    const ac = _sharedAC;
    if (ac.state === 'suspended') ac.resume();
    const g=ac.createGain();g.connect(ac.destination);
    g.gain.setValueAtTime(0.08,ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.8);
    const tones={login:[[880,0],[1100,.15]],vale:[[660,0],[800,.18]],confirm:[[440,0],[660,.15],[880,.3]]};
    (tones[type]||tones.login).forEach(t=>{const o=ac.createOscillator();o.type='sine';o.frequency.value=t[0];o.connect(g);o.start(ac.currentTime+t[1]);o.stop(ac.currentTime+t[1]+0.2);});
  } catch(e){}
}

// ══════════════════════════════════════════
//  GESTOR SELECTOR
// ══════════════════════════════════════════
// Collator reutilizable para ordenar gestores/mensajeros alfabéticamente.
// numeric:true → "Vale 2" va antes que "Vale 10"
// sensitivity:'base' → ignora acentos y mayúsculas
const _gestorSortCollator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
function sortGestoresAlpha(arr) {
  return arr.slice().sort((a, b) => _gestorSortCollator.compare(a.name || '', b.name || ''));
}
function sortMensajerosAlpha(arr) {
  return arr.slice().sort((a, b) => _gestorSortCollator.compare(a.name || '', b.name || ''));
}
function renderGestores() {
  // Orden alfabético (sin importar mayúsculas/minúsculas ni acentos).
  // Se ordena una COPIA — el array original (orden de creación) se conserva
  // para que addGestor/saveGestores sigan funcionando con el orden natural.
  const gestores = sortGestoresAlpha(getGestores());
  if (window.__DEBUG_GESTORES__) {
    console.log('[renderGestores] orden:', gestores.map(g => g.name).join(' → '));
  }
  const c=document.getElementById('gestoresList');
  if(!c) return;
  if(!gestores.length){c.innerHTML='<div class="es"><div class="es-icon">👤</div><div class="es-text">El admin aún no ha configurado gestores</div></div>';return;}
  const pinnedId = _getPinnedGestorId();
  c.innerHTML=gestores.map(g=>{
    const act=g.id===activeGestorId;
    const pinned=g.id===pinnedId;
    const pinBtn = pinned
      ? `<button class="g-pin-btn g-pinned" type="button" title="Quitar del inicio" aria-label="Quitar del inicio" onclick="event.stopPropagation();unpinGestor()">📌</button>`
      : `<button class="g-pin-btn" type="button" title="Fijar al inicio" aria-label="Fijar al inicio" onclick="event.stopPropagation();togglePinGestor(${g.id})">📍</button>`;
    return `<div class="g-item ${act?'active':''} ${pinned?'g-item-pinned':''}" onclick="selectGestor(${g.id})">
      <div class="g-pin-wrap">
        <div class="g-avatar" style="background:${g.color}">${gestorAvatarInner(g)}</div>
        ${pinBtn}
      </div>
      <div class="g-name">${escapeHTML(g.name)}</div>
      ${pinned?'<span class="g-pin-label">Fijado</span>':''}
      ${act?'<span class="g-badge">✓</span>':''}
    </div>`;
  }).join('');
}
function selectGestor(id) {
  const g=gestorOf(id);if(!g)return;
  if(g.password){
    // ¿Hay contraseña guardada para este gestor en este dispositivo?
    const saved = _getSavedGestorPass(id);
    if (saved !== null && _timingSafeEqual(saved.trim().toUpperCase(), (g.password||'').trim().toUpperCase())) {
      // Autologuear: la contraseña guardada sigue siendo válida
      doSelectGestor(id);
      return;
    }
    // Si había contraseña guardada pero ya no coincide (el admin la cambió),
    // limpiarla para que no reintente eternamente.
    if (saved !== null) {
      _clearSavedGestorPass(id);
    }
    pendingGestorId=id;
    document.getElementById('gestorPassInput').value='';
    document.getElementById('gestorPassError').style.display='none';
    document.getElementById('gestorPassModalSub').textContent=`${g.name} — ingresa tu contraseña`;
    // Pre-marcar el checkbox si ya hay contraseña guardada para otros gestores
    // (no para este en particular porque acabamos de borrarla) → dejarlo desmarcado
    // por seguridad para que el usuario decida explícitamente.
    const rememberChk = document.getElementById('gestorPassRemember');
    if (rememberChk) rememberChk.checked = false;
    document.getElementById('gestorPassModal').classList.add('show');
    setTimeout(()=>document.getElementById('gestorPassInput').focus(),100);
  } else {
    doSelectGestor(id);
  }
}
function doSelectGestor(id) {
  listenToMyVales(id);
  activeGestorId=id;const g=gestorOf(id);

  // ─── AVATAR con foto (si existe) ───
  const bannerAvatar=document.getElementById('bannerAvatar');
  bannerAvatar.innerHTML=gestorAvatarInner(g);
  bannerAvatar.style.background = (g.photo && /^(https?:|data:image|photos\/|\.\/photos\/)/i.test(g.photo)) ? 'transparent' : g.color;

  // ─── Botones de foto (📷 cambiar / ✕ quitar) ───
  // Se añaden al #gestorBanner (no al avatar) porque el banner es más grande
  // y no tiene overflow:hidden. Así los botones NO se recortan.
  // Usamos un wrapper para agrupar avatar+botones y posicionar todo junto.
  const banner=document.getElementById('gestorBanner');
  // Envolver avatar en un wrapper si no lo está ya
  let avatarWrap=document.getElementById('bannerAvatarWrap');
  if(!avatarWrap){
    avatarWrap=document.createElement('div');
    avatarWrap.id='bannerAvatarWrap';
    avatarWrap.style.cssText='position:relative;flex-shrink:0;width:48px;height:48px;';
    bannerAvatar.parentNode.insertBefore(avatarWrap, bannerAvatar);
    avatarWrap.appendChild(bannerAvatar);
    // Asegurar que el avatar llene el wrapper
    bannerAvatar.style.width='100%';
    bannerAvatar.style.height='100%';
  }
  // Botón 📷 cámara (esquina inferior derecha)
  let camBtn=document.getElementById('bannerAvatarCam');
  if(!camBtn){
    camBtn=document.createElement('button');
    camBtn.id='bannerAvatarCam';
    camBtn.type='button';
    camBtn.title='Cambiar foto de perfil';
    camBtn.setAttribute('aria-label','Cambiar foto de perfil');
    camBtn.innerHTML='📷';
    camBtn.onclick=function(ev){ev.stopPropagation();openGestorPhotoPicker();};
    avatarWrap.appendChild(camBtn);
  }
  // Botón ✕ quitar foto (esquina superior izquierda, solo si tiene foto)
  let removeBtn=document.getElementById('bannerAvatarRemove');
  if(g.photo && /^(https?:|data:image|photos\/|\.\/photos\/)/i.test(g.photo)){
    if(!removeBtn){
      removeBtn=document.createElement('button');
      removeBtn.id='bannerAvatarRemove';
      removeBtn.type='button';
      removeBtn.title='Quitar foto de perfil';
      removeBtn.setAttribute('aria-label','Quitar foto de perfil');
      removeBtn.innerHTML='✕';
      removeBtn.onclick=function(ev){ev.stopPropagation();removeGestorPhoto();};
      avatarWrap.appendChild(removeBtn);
    }
  } else if(removeBtn){
    removeBtn.remove();
  }

  document.getElementById('bannerLbl').textContent='HOLA, ESTÁS EN TU ÁREA';

    const perms = ('Notification' in window && Notification.permission);
    let nBtn = '';
    if(perms === 'default' || perms === 'denied') {
      nBtn = `<button type="button" onclick="requestNotifPermission()" style="background:rgba(239,68,68,.1);border:1px solid var(--red);color:var(--red);border-radius:6px;font-size:10px;padding:3px 8px;font-weight:700;margin-top:6px;cursor:pointer;">🔔 Activar alertas push</button>`;
    }
    // Si la contraseña de este gestor está guardada en este dispositivo,
    // mostrar un botón para "olvidarla" (por seguridad / si el dispositivo
    // es compartido).
    let savedPassBtn = '';
    if (g.password && _hasSavedGestorPass(id)) {
      savedPassBtn = `<button type="button" onclick="forgetSavedGestorPass()" style="background:rgba(245,158,11,.12);border:1px solid var(--amber, #f59e0b);color:#b45309;border-radius:6px;font-size:10px;padding:3px 8px;font-weight:700;margin-top:6px;margin-left:4px;cursor:pointer;" title="Borra la contraseña guardada en este dispositivo">🔓 Olvidar contraseña</button>`;
    }
  document.getElementById('bannerName').innerHTML = escapeHTML(g.name) + ((nBtn || savedPassBtn) ? '<br>' + nBtn + savedPassBtn : '');
  document.getElementById('headerGestorName').textContent='· '+g.name;
  document.getElementById('vf-promotor').value=g.name;
  document.getElementById('mobileBackName').textContent=g.name;
  document.getElementById('gestorBanner').style.display='flex';
  document.getElementById('gestorMyValesSection').style.display='block';
  document.getElementById('layoutGestor').classList.add('has-gestor');
  renderGestores();renderMyVales();renderGestorComisiones();onFormInput();renderGestorNotifs();
}

// ══════════════════════════════════════════
//  FOTO DE PERFIL DEL GESTOR
//  - El gestor sube una foto desde su dispositivo
//  - Se comprime a WebP 256x256 (≤15 KB aprox.) — ligero para Firebase
//  - Se guarda en g.photo → saveGestores() → Firebase → todos los dispositivos
//  - El admin también puede cambiar/quitar la foto de cualquier gestor
// ══════════════════════════════════════════
let _gestorPhotoInput = null;
function _ensureGestorPhotoInput() {
  if (_gestorPhotoInput) return _gestorPhotoInput;
  _gestorPhotoInput = document.createElement('input');
  _gestorPhotoInput.type = 'file';
  _gestorPhotoInput.accept = 'image/*';
  _gestorPhotoInput.style.display = 'none';
  _gestorPhotoInput.addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // permitir re-seleccionar el mismo archivo
    if (!file) return;
    handleGestorPhoto(file);
  });
  document.body.appendChild(_gestorPhotoInput);
  return _gestorPhotoInput;
}
function openGestorPhotoPicker() {
  if (!activeGestorId) { showToast('Selecciona tu nombre primero'); return; }
  _ensureGestorPhotoInput().click();
}
function handleGestorPhoto(file) {
  if (!activeGestorId) { showToast('Selecciona tu nombre primero'); return; }
  if (!file.type.startsWith('image/')) { showToast('Solo se permiten imágenes'); return; }
  if (file.size > 10 * 1024 * 1024) { showToast('Imagen demasiado grande (máx 10 MB)'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    showToast('🔄 Procesando foto...');
    // 256px, calidad 0.72 — suficiente para un avatar, ligero para Firebase sync
    compressImage(e.target.result, 256, 0.72, async compressed => {
      if (!compressed) { showToast('Error al procesar la imagen'); return; }
      // Subir como archivo a GitHub en vez de guardar el base64 completo dentro
      // del registro — si no hay GitHub configurado o la subida falla, cae de
      // vuelta a guardar el base64 directo (comportamiento de antes).
      const uploaded = await uploadPhotoToGitHub(compressed, 'g');
      const photoValue = uploaded || compressed;
      // BUGFIX: no mutar el array que devuelve getGestores() — ver el
      // comentario detallado en sendVale()/patchVale().
      const list = getGestores().map(g => g.id === activeGestorId ? {...g, photo: photoValue} : g);
      if (!list.some(g => g.id === activeGestorId)) return;
      saveGestores(list); // → localStorage + Firebase → todos los dispositivos
      gestoresTabDirty = true;
      // Refrescar UI inmediatamente en este dispositivo
      doSelectGestor(activeGestorId);
      if (typeof renderAdminGestoresList === 'function') renderAdminGestoresList();
      if (typeof renderGestorRanking === 'function') { rankingCache = null; renderGestorRanking(); }
      if (uploaded) {
        showToast('✅ Foto actualizada (subida a GitHub)');
      } else {
        const fmt = compressed.startsWith('data:image/webp') ? 'WebP' : 'JPEG';
        const kb = Math.round(compressed.length / 1024);
        showToast(`✅ Foto actualizada (${fmt} · ${kb} KB)`);
      }
    });
  };
  reader.onerror = () => showToast('Error al leer el archivo');
  reader.readAsDataURL(file);
}
function removeGestorPhoto() {
  if (!activeGestorId) return;
  const g = gestorOf(activeGestorId);
  if (!g || !g.photo) return;
  showConfirmAction(
    '¿Quitar tu foto de perfil?',
    'Volverás a ver solo tus iniciales. Tu foto se borrará también de los demás dispositivos.',
    'Quitar foto', 'btn-red',
    () => {
      const list = getGestores();
      const i = list.findIndex(x => x.id === activeGestorId);
      if (i === -1) return;
      delete list[i].photo;
      saveGestores(list);
      gestoresTabDirty = true;
      doSelectGestor(activeGestorId);
      if (typeof renderAdminGestoresList === 'function') renderAdminGestoresList();
      if (typeof renderGestorRanking === 'function') { rankingCache = null; renderGestorRanking(); }
      showToast('Foto eliminada ✓');
    }
  );
}
// Atajo para que el admin también pueda cambiar la foto desde el panel
function changeGestorPhotoById(id) {
  pendingGestorPhotoId = id;
  const input = _ensureGestorPhotoInput();
  // sobreescribimos temporalmente el handler
  input.onchange = e => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { showToast('Solo se permiten imágenes'); return; }
    if (file.size > 10 * 1024 * 1024) { showToast('Imagen demasiado grande (máx 10 MB)'); return; }
    const reader = new FileReader();
    reader.onload = ev => {
      showToast('🔄 Procesando foto...');
      compressImage(ev.target.result, 256, 0.72, async compressed => {
        if (!compressed) { showToast('Error al procesar la imagen'); return; }
        const uploaded = await uploadPhotoToGitHub(compressed, 'g');
        // BUGFIX: no mutar el array que devuelve getGestores().
        const photoValue = uploaded || compressed;
        const list = getGestores().map(g => g.id === pendingGestorPhotoId ? {...g, photo: photoValue} : g);
        if (!list.some(g => g.id === pendingGestorPhotoId)) return;
        saveGestores(list);
        gestoresTabDirty = true;
        renderAdminGestoresList();
        renderGestores();
        showToast(uploaded ? '✅ Foto actualizada (subida a GitHub)' : '✅ Foto actualizada');
      });
    };
    reader.readAsDataURL(file);
  };
  input.click();
}
let pendingGestorPhotoId = null;
function removeGestorPhotoById(id) {
  const g = gestorOf(id); if (!g || !g.photo) return;
  showConfirmAction(
    '¿Quitar la foto de ' + g.name + '?',
    'Se usaran las iniciales. Se actualizará en todos los dispositivos.',
    'Quitar foto', 'btn-red',
    () => {
      const list = getGestores();
      const i = list.findIndex(x => x.id === id);
      if (i === -1) return;
      delete list[i].photo;
      saveGestores(list);
      gestoresTabDirty = true;
      renderAdminGestoresList();
      renderGestores();
      showToast('Foto eliminada ✓');
    }
  );
}
function closeGestorPassModal(){
  document.getElementById('gestorPassModal').classList.remove('show');
  pendingGestorId=null;
}
function submitGestorPass() {
  const val=document.getElementById('gestorPassInput').value.trim().toUpperCase();
  const g=gestorOf(pendingGestorId);if(!g)return;
  // Hash both sides for comparison — no plaintext comparison.
  // Note: gestor passwords are still stored as plaintext in data.json/Firebase
  // (see BUG-005 in the code review). For now, we compare input.toUpperCase()
  // against the stored password.toUpperCase() to preserve backward compat.
  // TODO: migrate gestor passwords to hashed storage in a future release.
  const sysPass = (g.password || '').trim().toUpperCase();
  if(_timingSafeEqual(val, sysPass)){
    const id=pendingGestorId;   // save before closeGestorPassModal sets it to null
    // ¿Marcar "Recordar contraseña en este dispositivo"?
    const rememberChk = document.getElementById('gestorPassRemember');
    if (rememberChk && rememberChk.checked) {
      // Guardar el valor ORIGINAL (sin upper) para que el usuario pueda verlo
      // si algún día lo recupera. Lo compararemos siempre con .toUpperCase().
      const rawVal = document.getElementById('gestorPassInput').value.trim();
      _setSavedGestorPass(id, rawVal);
      showToast('🔒 Contraseña guardada en este dispositivo');
    }
    closeGestorPassModal();
    doSelectGestor(id);
  } else {
    document.getElementById('gestorPassError').style.display='block';
    document.getElementById('gestorPassInput').select();
  }
}
function changeGestor() {
  if (gestorValesListener && activeGestorId) {
    gestorValesListener();
    gestorValesListener = null;
  }
  activeGestorId=null;
  document.getElementById('layoutGestor').classList.remove('has-gestor');
  document.getElementById('gestorBanner').style.display='none';
  document.getElementById('gestorMyValesSection').style.display='none';
  const cs=document.getElementById('gestorComisionSection');if(cs)cs.style.display='none';
  document.getElementById('headerGestorName').textContent='';
  document.getElementById('vf-promotor').value='';
  document.getElementById('mobileBackName').textContent='';
  renderGestores();renderMyVales();renderGestorComisiones();onFormInput();renderGestorNotifs();
}

// ══════════════════════════════════════════
//  PERFIL FIJADO AL INICIO
//  - Cada gestor puede "fijar" su perfil desde la lista de selección
//  - Cuando un gestor está fijado, la app abre directamente en su sección
//    sin tener que pulsar "¿Quién eres?" cada vez
//  - El gestor fijado se muestra más grande en la lista de selección
//  - Si el gestor fijado tiene contraseña, se le pedirá al abrir
//  - El usuario puede quitar el fijado con el botón ✕ sobre el avatar
// ══════════════════════════════════════════
const PINNED_GESTOR_KEY = 'axon_pinned_gestor_id';

function _getPinnedGestorId() {
  try {
    const v = localStorage.getItem(PINNED_GESTOR_KEY);
    return v ? parseInt(v, 10) : null;
  } catch(e) { return null; }
}
function _setPinnedGestorId(id) {
  try {
    if (id === null || id === undefined) localStorage.removeItem(PINNED_GESTOR_KEY);
    else localStorage.setItem(PINNED_GESTOR_KEY, String(id));
  } catch(e) {}
}
function togglePinGestor(id) {
  const current = _getPinnedGestorId();
  if (current === id) {
    _setPinnedGestorId(null);
    showToast('Perfil no se fijará al inicio');
  } else {
    _setPinnedGestorId(id);
    showToast('📌 Perfil fijado al inicio');
  }
  renderGestores();
}
function unpinGestor() {
  _setPinnedGestorId(null);
  renderGestores();
  showToast('Perfil quitado del inicio');
}
// Llamar desde init() — si hay un gestor fijado y válido, lo selecciona
function _autoSelectPinnedGestor() {
  if (IS_ADMIN) return; // el admin no se auto-selecciona
  const pinnedId = _getPinnedGestorId();
  if (pinnedId === null) return;
  const g = gestorOf(pinnedId);
  if (!g) {
    // El gestor fijado ya no existe (lo borraron) → limpiar
    _setPinnedGestorId(null);
    return;
  }
  // Seleccionar el gestor. Si tiene contraseña, selectGestor abrirá el modal
  // (a menos que haya contraseña guardada → autologuear).
  // Pequeño retardo para que la UI esté lista.
  setTimeout(() => {
    try { selectGestor(pinnedId); } catch(e) { console.warn('auto-select failed', e); }
  }, 200);
}

// ══════════════════════════════════════════
//  CONTRASEÑA DE GESTOR GUARDADA EN ESTE DISPOSITIVO
//  - Opcional: el usuario puede marcar "Recordar contraseña en este dispositivo"
//    al entrar. La contraseña se guarda en localStorage (solo este dispositivo).
//  - Al abrir la app o seleccionar ese gestor, se autologuea sin pedir contraseña.
//  - El usuario puede "olvidar" la contraseña guardada cuando quiera.
//  - Esto NO es una bóveda criptográfica: es equivalente a que el navegador
//    recuerde la contraseña. Recomendado solo en dispositivos personales.
// ══════════════════════════════════════════
const GESTOR_SAVED_PASS_KEY = 'axon_saved_gestor_pass';

// Devuelve un mapa { gestorId: password } guardado en localStorage
function _getSavedPassMap() {
  try {
    return JSON.parse(localStorage.getItem(GESTOR_SAVED_PASS_KEY) || '{}');
  } catch(e) { return {}; }
}
function _saveSavedPassMap(map) {
  try { localStorage.setItem(GESTOR_SAVED_PASS_KEY, JSON.stringify(map)); } catch(e) {}
}
function _getSavedGestorPass(id) {
  if (id === null || id === undefined) return null;
  const map = _getSavedPassMap();
  return map[String(id)] || null;
}
function _setSavedGestorPass(id, password) {
  if (id === null || id === undefined) return;
  const map = _getSavedPassMap();
  map[String(id)] = password;
  _saveSavedPassMap(map);
}
function _clearSavedGestorPass(id) {
  if (id === null || id === undefined) return;
  const map = _getSavedPassMap();
  delete map[String(id)];
  _saveSavedPassMap(map);
}
// Olvidar TODAS las contraseñas guardadas (botón "Olvidar todas")
function _clearAllSavedGestorPass() {
  try { localStorage.removeItem(GESTOR_SAVED_PASS_KEY); } catch(e) {}
}
// ¿Tiene este gestor una contraseña guardada en este dispositivo?
function _hasSavedGestorPass(id) {
  return _getSavedGestorPass(id) !== null;
}
// Botón "Olvidar contraseña" desde el banner del gestor
function forgetSavedGestorPass(id) {
  const targetId = (id !== undefined) ? id : activeGestorId;
  if (targetId === null || targetId === undefined) return;
  _clearSavedGestorPass(targetId);
  showToast('Contraseña olvidada de este dispositivo');
}

// ══════════════════════════════════════════
//  MENSAJERO PANEL
// ══════════════════════════════════════════

function toggleMensajeroManager() {
  mensajeroManagerExpanded = !mensajeroManagerExpanded;
  const sec = document.getElementById('mensajeroManagerSection');
  const arrow = document.getElementById('mensajeroManagerArrow');
  if (sec) sec.style.display = mensajeroManagerExpanded ? 'block' : 'none';
  if (arrow) arrow.style.transform = mensajeroManagerExpanded ? 'rotate(180deg)' : 'rotate(0deg)';
  _updateMensajerosCountBadge();
}

function _updateMensajerosCountBadge() {
  const badge = document.getElementById('mensajerosCountBadge');
  if (badge) badge.textContent = String(getMensajeros().length);
}

// Antes había 3 listas separadas y repetidas con los mismos mensajeros, cada
// una mostrando solo UNA acción (una para gestionar con WhatsApp/editar/borrar,
// otra duplicada solo con editar/borrar, y otra aparte solo para elegir a quién
// ver las entregas) — puro "reguero" visual. Ahora hay una sola lista, ordenada
// alfabéticamente, donde cada mensajero tiene TODAS sus opciones juntas: ver sus
// entregas (clic en la fila), WhatsApp, editar y eliminar.
function renderMensajeroSelector() { renderMensajeros(); }
function renderMensajerosEditList() { /* fusionado en renderMensajeros() — se mantiene como no-op por compatibilidad */ }
function selectMensajero(id) {
  activeMensajeroId=id;
  document.getElementById('adminMensajerosPanel').classList.add('has-sel');
  document.getElementById('mensajeroChangeBtn').style.display='block';
  renderMensajeroSelector();renderMensajeroVales();
}
function changeMensajero() {
  activeMensajeroId=null;
  document.getElementById('adminMensajerosPanel').classList.remove('has-sel');
  document.getElementById('mensajeroChangeBtn').style.display='none';
  renderMensajeroSelector();renderMensajeroVales();
}
function renderMensajeroVales() {
  const c=document.getElementById('mensajeroValesList');if(!c)return;
  if(!activeMensajeroId){
    c.innerHTML='<div class="es"><div class="es-icon">🛵</div><div class="es-text">Selecciona un mensajero para ver sus entregas</div></div>';return;
  }
  const porEntregar=getVales().filter(v=>v.mensajeroId===activeMensajeroId&&v.status==='assigned').reverse();
  const entregados=getVales().filter(v=>v.mensajeroId===activeMensajeroId&&v.status==='delivered').reverse();
  const pendientesCobro=getVales().filter(v=>v.mensajeroId===activeMensajeroId&&v.status==='pending_payment').reverse();
  const confirmados=getVales().filter(v=>v.mensajeroId===activeMensajeroId&&v.status==='confirmed').reverse();
  let html='';
  if(!porEntregar.length&&!entregados.length&&!pendientesCobro.length&&!confirmados.length){
    html='<div class="es"><div class="es-icon">✅</div><div class="es-text">Sin entregas asignadas</div></div>';
  } else {
    if(porEntregar.length){
      html+='<div class="lbl" style="margin-top:0;">Por entregar</div>';
      html+=porEntregar.map(v=>{
        const g=gestorOf(v.gestorId);
        const m = v.mensajeroId ? mensajeroOf(v.mensajeroId) : null;
        const waBtn = (m && m.phone)
          ? `<button class="btn btn-sm btn-full" style="background:#25D366;color:white;margin-top:4px;" onclick="openMensajeroWhatsApp(${m.id}, buildShareText(getVales().find(x=>x.id===${v.id}), mensajeroOf(${v.mensajeroId})))">💬 WhatsApp al mensajero</button>`
          : '';
        return `<div class="mv-card st-assigned">
          <div class="mv-head"><span class="mv-time">${timeStr(v.ts)}</span><span class="sp-assigned" style="font-size:9px;padding:2px 6px;">🛵 Asignado</span></div>
          <div class="mv-info"><b>${escapeHTML(v.cliente||'—')}</b> · ${escapeHTML(v.telefono||'—')}</div>
          <div style="font-size:11px;color:var(--gray-400);">📍 ${escapeHTML(v.direccion||'Sin dirección')}</div>
          <div style="font-size:12px;font-weight:700;margin-top:3px;">💰 ${escapeHTML(v.total||'—')}${v.vuelto?` · Vuelto: ${escapeHTML(v.vuelto)}`:''}</div>
          ${g?`<div style="font-size:11px;color:var(--gray-400);">Gestor: ${escapeHTML(g.name)}</div>`:''}
          <div style="font-size:11px;color:var(--gray-600);margin-top:3px;">📦 ${escapeHTML(v.articulo||'—')}</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:8px;">
            <button class="btn btn-green btn-sm btn-full" onclick="mensajeroEntrega(${v.id})">📦 Entregado</button>
            <button class="btn btn-green btn-sm btn-full" style="background:#2563EB;color:white;" onclick="mensajeroPagadoDirecto(${v.id})">💰 Pagado</button>
          </div>
          ${waBtn}
        </div>`;
      }).join('');
    }
    if(entregados.length){
      html+='<div class="lbl" style="margin-top:16px;">Entregados · esperando cobro</div>';
      html+=entregados.map(v=>{
        const g=gestorOf(v.gestorId);
        return `<div class="mv-card st-delivered">
          <div class="mv-head"><span class="mv-time">${timeStr(v.deliveredTs||v.ts)}</span><span class="sp-delivered" style="font-size:9px;padding:2px 6px;">📦 Entregado</span></div>
          <div class="mv-info"><b>${escapeHTML(v.cliente||'—')}</b> · ${escapeHTML(v.total||'—')}</div>
          ${g?`<div style="font-size:11px;color:var(--gray-400);">Gestor: ${escapeHTML(g.name)}</div>`:''}
          <button class="btn btn-green btn-sm btn-full" style="margin-top:8px;" onclick="mensajeroPagado(${v.id})">💰 Marcar como Pagado</button>
        </div>`;
      }).join('');
    }
    if(pendientesCobro.length){
      html+='<div class="lbl" style="margin-top:16px;">Pendientes de cobro</div>';
      html+=pendientesCobro.map(v=>{
        const g=gestorOf(v.gestorId);
        return `<div class="mv-card st-pending_payment">
          <div class="mv-head"><span class="mv-time">${timeStr(v.ts)}</span><span style="color:var(--orange);font-size:10px;font-weight:700;">⏳ Pend. cobro</span></div>
          <div class="mv-info"><b>${escapeHTML(v.cliente||'—')}</b> · ${escapeHTML(v.total||'—')}</div>
          ${g?`<div style="font-size:11px;color:var(--gray-400);">Gestor: ${escapeHTML(g.name)}</div>`:''}
          <div style="font-size:11px;color:var(--gray-600);margin-top:3px;">📦 ${escapeHTML(v.articulo||'—')}</div>
          <button class="btn btn-green btn-sm btn-full" style="margin-top:8px;" onclick="mensajeroPagado(${v.id})">💰 Marcar como Pagado</button>
        </div>`;
      }).join('');
    }
    if(confirmados.length){
      html+='<div class="lbl" style="margin-top:16px;">Cobrados / Completados</div>';
      html+=confirmados.map(v=>{
        const g=gestorOf(v.gestorId);
        return `<div class="mv-card st-confirmed">
          <div class="mv-head"><span class="mv-time">${timeStr(v.confirmedTs||v.ts)}</span><span style="color:var(--green);font-size:10px;font-weight:700;">✅ Pagado</span></div>
          <div class="mv-info"><b>${escapeHTML(v.cliente||'—')}</b> · ${escapeHTML(v.total||'—')}</div>
          ${g?`<div style="font-size:11px;color:var(--gray-400);">Gestor: ${escapeHTML(g.name)}</div>`:''}
        </div>`;
      }).join('');
    }
  }
  c.innerHTML=html;
}

// ══════════════════════════════════════════
//  ADMIN GESTORES MANAGEMENT
// ══════════════════════════════════════════
function genPassword() {
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  return Array.from(arr, x => chars[x % chars.length]).join('').slice(0, 8);
}

let gestorManagerExpanded = true; // open by default
function toggleGestorManager() {
  gestorManagerExpanded = !gestorManagerExpanded;
  const sec = document.getElementById('gestorManagerSection');
  const arrow = document.getElementById('gestorManagerArrow');
  if(sec) sec.style.display = gestorManagerExpanded ? 'block' : 'none';
  if(arrow) arrow.style.transform = gestorManagerExpanded ? 'rotate(180deg)' : 'rotate(0deg)';
  if(gestorManagerExpanded) renderAdminGestoresList();
  _updateGestoresCountBadge();
}

function _updateGestoresCountBadge() {
  const badge = document.getElementById('gestoresCountBadge');
  if (badge) badge.textContent = String(getGestores().length);
}

// Tarjeta única por gestor: identidad + acciones + comisiones, todo junto.
// Antes "Comisiones por gestor" era una sección aparte más abajo que volvía a
// listar a cada gestor por nombre — mismo dato repetido dos veces en la misma
// pestaña. Ahora las comisiones son una tercera fila plegable DENTRO de la
// misma tarjeta (reutiliza renderComisionBody, que no cambió).
function renderAdminGestoresList() {
  // Orden alfabético (copia, no muta el array original)
  const list = sortGestoresAlpha(getGestores());
  const c=document.getElementById('adminGestoresPanel-list');
  _updateGestoresCountBadge();
  if(!c) return;
  if(!list.length){c.innerHTML='<div class="es"><div class="es-icon">👥</div><div class="es-text">Sin gestores. Agrega uno arriba.</div></div>';return;}
  c.innerHTML=list.map(g=>{
    const vales=getVales().filter(v=>Number(v.gestorId)===Number(g.id));
    const today=vales.filter(v=>new Date(v.ts).toDateString()===todayStr()).length;
    const pts=vales.filter(v=>['confirmed','pending_payment'].includes(v.status))
      .reduce((s,v)=>s+(v.valeProductos||[]).reduce((ss,p)=>{const pr=productoOf(p.id);return ss+(pr?pr.puntos*p.qty:0);},0),0);
    const hasPhoto = !!(g.photo && /^(https?:|data:image|photos\/|\.\/photos\/)/i.test(g.photo));

    // Comisiones de este gestor
    const comVales=vales.filter(v=>['confirmed','pending_payment'].includes(v.status));
    const pendientes=comVales.filter(v=>!v.commissionPaid&&v.commissionStatus!=='en_sobre'&&v.commissionStatus!=='cobrado');
    const enSobre=comVales.filter(v=>v.commissionStatus==='en_sobre');
    const cobrados=comVales.filter(v=>v.commissionPaid||v.commissionStatus==='cobrado');
    const isOpen=activeComisionGestorId===g.id;
    const pendSum=sumCommissions(pendientes);
    const sobreSum=sumCommissions(enSobre);
    const pendBadge=fmtComisionBadge(pendSum.usd,pendSum.mn,pendSum.computed);
    const sobreBadge=fmtComisionBadge(sobreSum.usd,sobreSum.mn,sobreSum.computed);
    let comBadgeHTML='';
    if(pendBadge)comBadgeHTML+=`<span style="background:var(--orange);color:white;border-radius:20px;font-size:10px;font-weight:700;padding:3px 9px;white-space:nowrap;">${pendBadge}</span>`;
    else if(pendientes.length)comBadgeHTML+=`<span style="background:var(--orange);color:white;border-radius:20px;font-size:10px;font-weight:700;padding:3px 9px;">${pendientes.length} pend.</span>`;
    if(sobreBadge)comBadgeHTML+=`<span style="background:var(--yellow);color:white;border-radius:20px;font-size:10px;font-weight:700;padding:3px 9px;white-space:nowrap;">✉️ ${sobreBadge}</span>`;
    else if(enSobre.length)comBadgeHTML+=`<span style="background:var(--yellow);color:white;border-radius:20px;font-size:10px;font-weight:700;padding:3px 9px;">✉️ ${enSobre.length}</span>`;
    if(!comBadgeHTML)comBadgeHTML=cobrados.length?`<span style="background:var(--green);color:white;border-radius:20px;font-size:10px;font-weight:700;padding:3px 9px;">✓ al día</span>`:`<span style="color:var(--gray-400);font-size:10px;">Sin comisiones</span>`;

    return `<div class="gp-card">
      <div class="gp-card-top">
        <div class="g-avatar" style="background:${hasPhoto?'transparent':g.color};width:44px;height:44px;font-size:14px;flex-shrink:0;position:relative;">${gestorAvatarInner(g)}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:800;font-size:15px;color:var(--text);">${escapeHTML(g.name)}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:1px;">${vales.length} vales · ${today} hoy · ⭐ ${pts} pts</div>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" style="color:var(--red);flex-shrink:0;" onclick="removeGestor(${g.id})">Eliminar</button>
      </div>

      <div class="gp-card-actions">
        <span id="gpw-${g.id}" style="background:var(--gray-200);border-radius:6px;padding:3px 9px;font-family:monospace;font-weight:700;font-size:12px;letter-spacing:1.5px;color:var(--text);cursor:pointer;" onclick="toggleGestorPass(${g.id})" title="Click para mostrar/ocultar">🔑 ${escapeHTML(g.password||'—').replace(/./g, '•')}</span>
        <button type="button" style="background:none;border:1px solid var(--gray-400);cursor:pointer;font-size:10px;color:var(--gray-700);padding:2px 7px;border-radius:4px;font-weight:600;" onclick="copyGestorPass(${g.id})">📋 Copiar</button>
        <button type="button" style="background:none;border:1px solid var(--blue);cursor:pointer;font-size:10px;color:var(--blue);padding:2px 7px;border-radius:4px;font-weight:600;" onclick="resetGestorPass(${g.id})">↺ Resetear</button>
        <button type="button" style="background:none;border:1px solid var(--gray-400);cursor:pointer;font-size:10px;color:var(--gray-700);padding:2px 7px;border-radius:4px;font-weight:600;" onclick="openEditGestorModal(${g.id})">✏️ Editar</button>
        <button type="button" style="background:none;border:1px solid var(--blue);cursor:pointer;font-size:10px;color:var(--blue);padding:2px 7px;border-radius:4px;font-weight:600;" onclick="changeGestorPhotoById(${g.id})" title="Cambiar foto de perfil">📷 Foto</button>
        ${hasPhoto?`<button type="button" style="background:none;border:1px solid var(--red);cursor:pointer;font-size:10px;color:var(--red);padding:2px 7px;border-radius:4px;font-weight:600;" onclick="removeGestorPhotoById(${g.id})" title="Quitar foto de perfil">✕ Quitar foto</button>`:''}
      </div>

      <div class="gp-card-com" onclick="toggleComisionGestor(${g.id})">
        <span style="font-size:11px;font-weight:700;color:var(--text-muted);flex-shrink:0;">💰 Comisiones</span>
        <div style="display:flex;gap:4px;flex-wrap:wrap;flex:1;">${comBadgeHTML}</div>
        <span style="color:var(--gray-400);font-size:12px;flex-shrink:0;">${isOpen?'▲':'▼'}</span>
      </div>
      ${isOpen?renderComisionBody(g,pendientes,enSobre,cobrados):''}
    </div>`;
  }).join('');
}

function openEditGestorModal(id) {
  const g=gestorOf(id);if(!g)return;
  document.getElementById('editGestorInput').value=g.name;
  const ph=document.getElementById('editGestorPhoneInput');if(ph)ph.value=g.phone||'';
  document.getElementById('editGestorModal').dataset.gestorId=id;
  // ── Inicializar el estado de la foto en el modal ──
  // _editGestorPhotoPending guarda la foto nueva (data URL) si el usuario cambia la foto.
  // _editGestorPhotoRemoved = true si el usuario quiere quitar la foto existente.
  // Al pulsar "Guardar" se aplican ambos estados al gestor.
  window._editGestorPhotoPending = null;
  window._editGestorPhotoRemoved = false;
  refreshEditGestorPhotoUI(g);
  document.getElementById('editGestorModal').classList.add('show');
}
// Refresca el avatar preview + botones del modal Editar Gestor
function refreshEditGestorPhotoUI(g) {
  const av = document.getElementById('editGestorAvatar');
  if (!av) return;
  // Foto efectiva a mostrar: si hay pendiente, esa; si marcó quitar, ninguna; si no, la del gestor
  const pending = window._editGestorPhotoPending;
  const removed = window._editGestorPhotoRemoved;
  const effectivePhoto = pending ? pending : (removed ? null : (g && g.photo) || null);
  if (effectivePhoto) {
    av.innerHTML = `<span class="g-avatar-img-wrap"><img src="${escapeAttr(effectivePhoto)}" alt=""></span>`;
    av.style.background = 'transparent';
  } else {
    av.textContent = g ? (g.initials || '?') : '?';
    av.style.background = g ? g.color : 'var(--gray-300)';
  }
  // Mostrar/ocultar botón "Quitar"
  const removeBtn = document.getElementById('editGestorRemovePhotoBtn');
  if (removeBtn) removeBtn.style.display = effectivePhoto ? 'inline-block' : 'none';
}
// Usuario pulsa "📷 Cambiar" → abre selector de archivo
function pickEditGestorPhoto() {
  const inp = document.getElementById('editGestorPhotoFile');
  if (inp) inp.click();
}
// Usuario seleccionó un archivo → comprimir a WebP 256x256 y guardar en _editGestorPhotoPending
// NO se guarda en el gestor todavía — se aplica al pulsar "Guardar".
function handleEditGestorPhoto(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = ''; // permitir re-seleccionar el mismo archivo
  if (!file) return;
  if (!file.type.startsWith('image/')) { showToast('Solo se permiten imágenes'); return; }
  if (file.size > 10 * 1024 * 1024) { showToast('Imagen demasiado grande (máx 10 MB)'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    showToast('🔄 Procesando foto...');
    compressImage(e.target.result, 256, 0.72, compressed => {
      if (!compressed) { showToast('Error al procesar la imagen'); return; }
      window._editGestorPhotoPending = compressed;
      window._editGestorPhotoRemoved = false;
      const id = parseInt(document.getElementById('editGestorModal').dataset.gestorId, 10);
      refreshEditGestorPhotoUI(gestorOf(id));
      const kb = Math.round(compressed.length / 1024);
      showToast(`✅ Foto lista (${kb} KB) — pulsa Guardar`);
    });
  };
  reader.onerror = () => showToast('Error al leer el archivo');
  reader.readAsDataURL(file);
}
// Usuario pulsa "✕ Quitar" → marca para borrar la foto al guardar
function clearEditGestorPhoto() {
  window._editGestorPhotoPending = null;
  window._editGestorPhotoRemoved = true;
  const id = parseInt(document.getElementById('editGestorModal').dataset.gestorId, 10);
  refreshEditGestorPhotoUI(gestorOf(id));
}
function closeEditGestorModal(){
  document.getElementById('editGestorModal').classList.remove('show');
  // Limpiar estado pendiente
  window._editGestorPhotoPending = null;
  window._editGestorPhotoRemoved = false;
}
async function saveEditGestor() {
  const id=parseInt(document.getElementById('editGestorModal').dataset.gestorId);
  const newName=document.getElementById('editGestorInput').value.trim();
  if(!newName){showToast('El nombre no puede estar vacío');return;}
  const orig=getGestores();const i=orig.findIndex(g=>g.id===id);if(i===-1)return;
  if(orig.some(g=>g.id!==id&&g.name.toLowerCase()===newName.toLowerCase())){showToast('Ese nombre ya existe');return;}
  // BUGFIX: no mutar los objetos/array que devuelve getGestores() — ver el
  // comentario detallado en sendVale()/patchVale(). Se arma una copia
  // propia del gestor editado y se muta ESA copia libremente.
  const edited = {...orig[i]};
  edited.name=newName;
  edited.initials=newName.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
  edited.phone=(document.getElementById('editGestorPhoneInput')?.value||'').trim();
  // ── Aplicar cambios de foto pendientes (subir/quitar) ──
  // _editGestorPhotoPending es el base64 recién comprimido (preview local) —
  // se sube a GitHub recién ahora, al guardar, para no subir fotos que el
  // usuario termine descartando cerrando el modal sin guardar.
  if (window._editGestorPhotoPending) {
    const uploaded = await uploadPhotoToGitHub(window._editGestorPhotoPending, 'g');
    edited.photo = uploaded || window._editGestorPhotoPending;
  } else if (window._editGestorPhotoRemoved) {
    delete edited.photo;
  }
  const list = orig.map(g => g.id === id ? edited : g);
  saveGestores(list); // → localStorage + Firebase → se actualiza en todos los dispositivos
  closeEditGestorModal();
  gestoresTabDirty=true;rankingCache=null;
  renderAdminGestoresList();renderGestores();renderAdminGestores();renderGestorRanking();
  // Si el gestor editado es el activo, refrescar su banner también
  if (activeGestorId === id) doSelectGestor(id);
  maybeAutoSync();
  showToast('Gestor editado ✓');
}

function resetGestorPass(id) {
  const orig=getGestores();if(!orig.some(g=>g.id===id))return;
  // BUGFIX: no mutar el array que devuelve getGestores().
  const np=genPassword().trim().toUpperCase();
  saveGestores(orig.map(g => g.id === id ? {...g, password: np} : g));
  _logAudit('gestor_pass_reset', 'gestor:' + id);
  gestoresTabDirty=true;
  renderAdminGestoresList();maybeAutoSync();showToast(`Nueva clave: ${np}`);
}
// toggleGestorPass / copyGestorPass now look up the password by gestor id
// instead of receiving it via the onclick attribute. This eliminates the
// XSS risk of interpolating the password into an HTML attribute (BUG-009).
function toggleGestorPass(id) {
  const g=gestorOf(id);if(!g)return;
  const pass=g.password||'';
  const el=document.getElementById('gpw-'+id);if(!el)return;
  if(el.dataset.shown==='1'){
    el.textContent='🔑 '+pass.replace(/./g,'•');
    el.dataset.shown='0';
  } else {
    el.textContent='🔑 '+pass;
    el.dataset.shown='1';
  }
}
function copyGestorPass(id) {
  const g=gestorOf(id);if(!g)return;
  const pass=g.password||'';
  navigator.clipboard.writeText(pass).then(()=>showToast('Contraseña copiada ✓')).catch(()=>showToast('No se pudo copiar'));
}

function removeGestor(id) {
  const g = gestorOf(id);
  if (!g) return;
  const hasVales = getVales().some(v=>Number(v.gestorId)===Number(id));
  const sub = hasVales ? 'Tiene vales registrados. Si lo borras, quedarán huérfanos.' : 'El gestor será borrado del sistema.';
  showConfirmAction('¿Eliminar a ' + g.name + '?', sub, 'Eliminar', 'btn-red', () => {
    const newList = getGestores().filter(x=>x.id!==id);
    saveGestores(newList);
    // saveGestores already syncs to Firebase via setFB — no need for separate db.ref call
    gestoresTabDirty=true;rankingCache=null;
    renderAdminGestoresList();renderGestores();renderAdminGestores();
    if(typeof renderComisiones === 'function') renderComisiones();
    maybeAutoSync();
    showToast('Gestor eliminado ✓');
  });
}

function addGestor() {
  const inp=document.getElementById('newGestorInput');
  const name=inp.value.trim();if(!name)return;
  const phone=(document.getElementById('newGestorPhoneInput')?.value||'').trim();
  const initials=name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
  const list=getGestores();
  if(list.some(g=>g.name.toLowerCase()===name.toLowerCase())){showToast('Ya existe ese gestor');return;}
  const color=GESTOR_COLORS[list.length%GESTOR_COLORS.length];
  const password=genPassword();
  // BUGFIX: mismo problema que en sendVale() — list ES _gestoresCache
  // (getGestores() no devuelve una copia), así que list.push() mutaba el
  // caché ANTES de que saveGestores() pudiera diferenciar "antes" vs
  // "ahora" y el gestor nuevo nunca se encolaba hacia Firestore.
  saveGestores([...list, {id:Date.now(),name,initials,color,password,phone}]);inp.value='';
  const ph=document.getElementById('newGestorPhoneInput');if(ph)ph.value='';
  gestoresTabDirty=true;rankingCache=null;
  renderAdminGestoresList();renderGestores();renderAdminGestores();renderGestorRanking();
  maybeAutoSync();
  showToast(`Gestor agregado ✓ · Clave: ${password}`);
}
// ══════════════════════════════════════════
//  ADMIN GESTORES FILTER (inbox)
// ══════════════════════════════════════════
function renderAdminGestores() {
  const c = document.getElementById('adminGestoresList');
  if(!c) return;
  const gestores = getGestores();
  const vales = getVales();

  let html = '';
  
  // Only show gestores that have AT LEAST ONE pending vale (excluye confirmed, delivered y cancelled)
  // v38 FIX: vales sin status definido (undefined/null) se consideran pendientes —
  // son vales recién enviados que aún no tienen status explícito en Supabase.
  const isPending = v => v.status !== 'confirmed' && v.status !== 'delivered' && v.status !== 'cancelled';
  const gestoresConPendientes = gestores.filter(g => {
     return vales.some(v => Number(v.gestorId) === Number(g.id) && isPending(v));
  });

  if(gestoresConPendientes.length === 0) {
     c.innerHTML = '<div class="es"><div class="es-icon">🎉</div><div class="es-text" style="font-weight:600;">No hay ningún vale pendiente.</div></div>';
     return;
  }

  gestoresConPendientes.forEach(g => {
    // Only fetch active (not confirmed/delivered/cancelled)
    const pendingVales = vales.filter(v => Number(v.gestorId) === Number(g.id) && isPending(v)).reverse();
    const isOpen = adminGestorFilter === g.id;

    html += `<div style="margin-bottom:8px;">
      <div style="display:flex;align-items:center;justify-content:space-between;background:var(--surface);border:1px solid ${isOpen?'var(--blue)':'var(--border)'};border-radius:10px;padding:12px 14px;cursor:pointer;font-weight:700;font-size:14px;transition:0.2s;" onclick="setGestorFilter(${isOpen ? 'null' : g.id})">
         <div style="display:flex;align-items:center;gap:12px;">
           <div class="ag-avatar" style="background:${g.color};width:32px;height:32px;font-size:12px;color:white;display:flex;align-items:center;justify-content:center;border-radius:50%;">${escapeHTML(g.initials)}</div>
           <span>${escapeHTML(g.name)}</span>
         </div>
         <div style="display:flex;align-items:center;gap:12px;">
           ${pendingVales.length > 0 ? `<span style="background:var(--red);color:white;border-radius:12px;padding:3px 9px;font-size:11px;">${pendingVales.length}</span>` : ''}
           <span style="color:var(--gray-400);font-size:12px;">${isOpen ? '▲' : '▼'}</span>
         </div>
      </div>`;

    if (isOpen) {
      html += `<div style="padding:10px 0 10px 14px; border-left:3px solid var(--blue); margin-left:16px; margin-bottom:16px;">`;
      html += pendingVales.map(v => buildInboxCard(v)).join('');
      html += `</div>`;
    }
    html += `</div>`;
  });

  c.innerHTML = html;
}

function setGestorFilter(gId){
  adminGestorFilter=gId;
  renderAdminGestores();
}

// ══════════════════════════════════════════
//  ADMIN INBOX
// ══════════════════════════════════════════
function buildInboxCard(v) {
  const sMap={
    pending:{label:'Pendiente',cls:'sp-pending'},
    assigned:{label:'Con mensajero',cls:'sp-assigned'},
    delivered:{label:'Entregado',cls:'sp-delivered'},
    pending_payment:{label:'Pend. cobro',cls:'sp-pending_payment'},
    cancelled:{label:'Cancelado',cls:'sp-cancelled'}
  };
  const s=sMap[v.status]||sMap['pending']||{label:'Pendiente',cls:'sp-pending'};  // v38: fallback a pendiente
  const isNew=v.isNew&&(v.status==='pending'||v.status==null);
  const sel=v.id===selectedValeId;
  const estafaMatch=checkEstafaMatch(v);
  const estafaBorder=estafaMatch.length?'border-left:3px solid var(--red);':'';
  const estafaTag=estafaMatch.length?'<span style="background:var(--red);color:white;border-radius:6px;padding:1px 6px;font-size:9px;font-weight:700;margin-left:4px;">🚫 ESTAFA</span>':'';
  return `<div class="ic ${sel?'sel':''} ${isNew?'is-new':''}" onclick="selectVale(${v.id})" style="${sel?'border: 1px solid var(--blue); background: var(--blue-lt);':'margin-bottom:6px;padding:10px;background:var(--surface);'}${estafaBorder}">
    ${isNew?'<div class="new-dot"></div>':''}
    <div class="ic-head" style="margin-bottom:4px;">
      <span class="ic-time">${timeStr(v.ts)}</span>
    </div>
    <div class="ic-cliente" style="font-size:13px;margin-bottom:2px;">${v.valeNum?`<span style="font-weight:800;color:var(--blue);">${valeNumStr(v)}</span> `:``}${escapeHTML(v.cliente||'Sin nombre')}${estafaTag}</div>
    <div class="ic-preview" style="font-size:11.5px;color:var(--gray-500);">${escapeHTML(v.articulo||'Sin artículo')}</div>
    ${v.adminNotes?`<div style="background:var(--yellow);color:#1a1a2e;border-radius:4px;padding:2px 6px;font-size:10px;font-weight:700;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">📝 ${escapeHTML(v.adminNotes)}</div>`:``}
    <div class="ic-foot" style="margin-top:8px;">
      <span class="sp ${s.cls}" style="font-size:10px;">${s.label}</span>
      <span style="font-size:12px;color:var(--text);font-weight:800;">${escapeHTML(v.total||'')}</span>
    </div>
  </div>`;
}

function selectVale(id) {
  const v = getVales().find(x => x.id === id);
  // Fire "seen" notif to the gestor ONCE: only on the first open of a brand-new
  // vale that was submitted by a gestor (not auto-generated by admin).
  const wasNew = !!(v && v.isNew);
  const fromGestor = !!(v && v.gestorId && v.adminNotes !== 'Generado por Admin');
  const alreadySeen = !!(v && v.seenByAdmin);
  selectedValeId = id;
  patchVale(id, { isNew: false, seenByAdmin: true, seenTs: new Date().toISOString() });
  if (wasNew && fromGestor && !alreadySeen) {
    addNotif('vale_seen', v.cliente || 'Cliente', null, valeNumStr(v) || '', v.gestorId);
  }
  updateAdminBadge();renderAdminGestores();renderValeDetail();
}

// ══════════════════════════════════════════
//  SHARE MODAL
// ══════════════════════════════════════════
function openShareModal(valeId) {
  const mensajeros=getMensajeros();
  if(!mensajeros.length){showToast('Agrega mensajeros primero');return;}
  shareTargetId=valeId;
  const v=getVales().find(x=>x.id===valeId);
  if(!v){showToast('Vale no encontrado');return;}
  const g=gestorOf(v.gestorId);
  document.getElementById('shareModalSub').textContent=`Vale de ${g?g.name:'—'} · ${v.cliente||'cliente'}`;
  const sel=document.getElementById('mensajeroSelect');
  sel.innerHTML=mensajeros.map(m=>`<option value="${m.id}">${escapeHTML(m.name)}</option>`).join('');
  if(v.mensajeroId)sel.value=v.mensajeroId;
  updateSharePreview();sel.onchange=updateSharePreview;
  document.getElementById('shareModal').classList.add('show');
}

function renderValeDetail() {
  const v=getVales().find(x=>x.id===selectedValeId);
  const c=document.getElementById('valeDetail');
  if(!c) return;
  if(!v){c.innerHTML='<div class="det-empty"><div class="det-empty-icon">📋</div><div style="font-size:13px;">Selecciona un vale de la bandeja</div></div>';return;}
  const g=gestorOf(v.gestorId);const m=v.mensajeroId?mensajeroOf(v.mensajeroId):null;
  const sMap={
    pending:{label:'Pendiente',cls:'sp-pending',icon:'🔵'},
    assigned:{label:'Con mensajero',cls:'sp-assigned',icon:'🛵'},
    confirmed:{label:'Confirmado',cls:'sp-confirmed',icon:'✅'},
    pending_payment:{label:'Pend. cobro',cls:'sp-pending_payment',icon:'⏳'},
    cancelled:{label:'Cancelado',cls:'sp-cancelled',icon:'🚫'},
  };
  const s=sMap[v.status]||sMap['pending'];  // v43: status undefined → 'Pendiente' (no 'UNDEFINED')
  const pts=(v.valeProductos||[]).reduce((sum,p)=>{const pr=productoOf(p.id);return sum+(pr?pr.puntos*p.qty:0);},0);
  let actHTML='';
  // Product link status — show picker if no products linked
  const hasProducts=(v.valeProductos||[]).length>0;
  const productPickerHTML=!hasProducts&&v.status!=='confirmed'?`
    <div style="background:rgba(0,109,138,.06);border:1px dashed var(--blue-bd,rgba(0,109,138,.3));border-radius:8px;padding:10px;text-align:center;margin-bottom:10px;">
      <div style="font-size:11px;color:var(--blue);font-weight:700;margin-bottom:6px;">⚠️ No hay producto del catálogo vinculado</div>
      <button class="btn btn-blue btn-full btn-sm" onclick="openEditValeModal(${v.id})">📦 Seleccionar producto del catálogo</button>
      <div style="font-size:10px;color:var(--gray-400);margin-top:4px;">Vincular un producto para descontar stock y calcular comisión</div>
    </div>`:(hasProducts?`
    <div style="background:rgba(16,185,129,.06);border:1px solid rgba(16,185,129,.2);border-radius:8px;padding:8px 10px;margin-bottom:10px;">
      <div style="font-size:10px;color:var(--green);font-weight:700;">✅ Productos vinculados: ${(v.valeProductos||[]).map(p=>`${escapeHTML(p.name)}${p.qty>1?' ×'+p.qty:''}`).join(', ')}</div>
    </div>`:'');
  if(v.status==='pending'){
    actHTML=`${productPickerHTML}<button class="btn btn-blue btn-full" onclick="openShareModal(${v.id})" style="margin-bottom:8px;">🛵 Asignar a Mensajero</button>
    <div style="font-size:10px;color:var(--gray-400);text-align:center;margin-bottom:6px;">— o confirmar directo —</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
      <button class="btn btn-green btn-sm btn-full" onclick="confirmSale(${v.id},'confirmed')">✅ Cobrado directo</button>
      <button class="btn btn-sm btn-full" style="background:var(--orange);color:white;" onclick="confirmSale(${v.id},'pending_payment')">⏳ Entregado (Por cobrar)</button>
    </div>`;
  } else if(v.status==='assigned'){
    actHTML=`${productPickerHTML}<div class="mensajero-row">🛵 <b>Mensajero:</b> ${m?escapeHTML(m.name):'—'}</div>
      <div style="font-size:12px;color:var(--gray-400);margin:6px 0 10px;">Esperando que el mensajero confirme la entrega</div>
      <button class="btn btn-ghost btn-full btn-sm" onclick="mensajeroEntrega(${v.id})" style="margin-bottom:6px;">📦 Marcar entregado (admin)</button>
      <button class="btn btn-ghost btn-full btn-sm" onclick="openShareModal(${v.id})" style="margin-bottom:8px;">🔄 Reenviar vale</button>
      <div style="font-size:10px;color:var(--gray-400);text-align:center;margin-bottom:6px;">— o confirmar directo —</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
        <button class="btn btn-green btn-sm btn-full" onclick="confirmSale(${v.id},'confirmed')">✅ Cobrado directo</button>
        <button class="btn btn-sm btn-full" style="background:var(--orange);color:white;" onclick="confirmSale(${v.id},'pending_payment')">⏳ Entregado (Por cobrar)</button>
      </div>`;
  } else if(v.status==='delivered'){
    actHTML=`${productPickerHTML}<div style="background:rgba(124,58,237,.08);border:1px solid rgba(124,58,237,.3);border-radius:8px;padding:12px;text-align:center;margin-bottom:10px;">
      <div style="font-size:24px;margin-bottom:4px;">🛵</div>
      <div style="font-weight:700;color:#7C3AED;">Entregado por mensajero</div>
      ${m?`<div style="font-size:12px;color:var(--gray-400);">Mensajero: ${escapeHTML(m.name)}</div>`:``}
    </div>
    <button class="btn btn-green btn-full" onclick="confirmSale(${v.id},'confirmed')" style="margin-bottom:8px;">✅ Confirmar venta + Entregado</button>
    <button class="btn btn-orange btn-full" onclick="confirmSale(${v.id},'pending_payment')">⏳ Confirmar venta + Pendiente de cobro</button>`;
  } else if(v.status==='confirmed'){
    actHTML=`<div style="background:rgba(16,185,129,.08);border:1px solid rgba(16,185,129,.25);border-radius:8px;padding:14px;text-align:center;">
      <div style="font-size:26px;margin-bottom:4px;">✅</div>
      <div style="font-weight:700;color:var(--green);">Venta Confirmada y Cobrada</div>
      ${m?`<div style="font-size:12px;color:var(--gray-400);">Entregada por: ${escapeHTML(m.name)}</div>`:``}
    </div>
    <button type="button" class="btn btn-ghost btn-full btn-sm" style="margin-top:6px;color:var(--orange);" onclick="revertConfirmSale(${v.id})">↩ Revertir venta (restaurar stock)</button>`;
  } else if(v.status==='pending_payment'){
    actHTML=`${productPickerHTML}<div style="background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.25);border-radius:8px;padding:14px;text-align:center;margin-bottom:8px;">
      <div style="font-size:26px;margin-bottom:4px;">⏳</div>
      <div style="font-weight:700;color:var(--yellow);">Pendiente de cobro</div>
      ${m?`<div style="font-size:12px;color:var(--gray-400);">Mensajero: ${escapeHTML(m.name)}</div>`:``}
    </div>
    <button class="btn btn-green btn-full" onclick="markAsPaid(${v.id})">✅ Cobrado — Registrar pago</button>
    <button type="button" class="btn btn-ghost btn-full btn-sm" style="margin-top:6px;color:var(--orange);" onclick="revertConfirmSale(${v.id})">↩ Revertir venta</button>`;
  } else if(v.status==='cancelled'){
    // Antes este estado no tenía rama propia: el badge mostraba el texto crudo
    // "cancelled" (sin traducir) y no se mostraba ningún bloque de acciones.
    actHTML=`<div style="background:rgba(220,38,38,.08);border:1px solid rgba(220,38,38,.25);border-radius:8px;padding:14px;text-align:center;">
      <div style="font-size:26px;margin-bottom:4px;">🚫</div>
      <div style="font-weight:700;color:var(--red);">Vale Cancelado</div>
      ${v.cancelledTs?`<div style="font-size:11px;color:var(--gray-400);margin-top:2px;">${new Date(v.cancelledTs).toLocaleString('es-ES')}</div>`:''}
    </div>`;
  } else {
    // v43 FIX: status undefined/null/unknown → tratar como 'pending'.
    // ANTES, un vale sin status no entraba en ninguna rama → actHTML quedaba
    // vacío → no se mostraban botones de acción. Ahora mostramos los mismos
    // botones que 'pending' para que el admin pueda procesar el vale.
    actHTML=`${productPickerHTML}<button class="btn btn-blue btn-full" onclick="openShareModal(${v.id})" style="margin-bottom:8px;">🛵 Asignar a Mensajero</button>
    <div style="font-size:10px;color:var(--gray-400);text-align:center;margin-bottom:6px;">— o confirmar directo —</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
      <button class="btn btn-green btn-sm btn-full" onclick="confirmSale(${v.id},'confirmed')">✅ Cobrado directo</button>
      <button class="btn btn-sm btn-full" style="background:var(--orange);color:white;" onclick="confirmSale(${v.id},'pending_payment')">⏳ Entregado (Por cobrar)</button>
    </div>`;
  }
  const numBadge=valeNumStr(v)?`<span style="font-size:15px;font-weight:900;color:var(--blue);margin-bottom:4px;display:block;">${valeNumStr(v)}</span>`:'';
  const notesHighlight=v.adminNotes?`<div style="background:var(--yellow);color:#1a1a2e;border:1px solid var(--yellow);border-radius:8px;padding:7px 10px;font-size:11px;font-weight:700;margin-top:5px;">📝 ${escapeHTML(v.adminNotes)}</div>`:'';
  const estafaMatches=checkEstafaMatch(v);
  const estafaDetailHTML=estafaMatches.length?`<div style="background:rgba(239,68,68,.08);border:2px solid var(--red);border-radius:10px;padding:12px;margin-bottom:10px;">
    <div style="font-size:14px;font-weight:800;color:var(--red);margin-bottom:6px;">🚨 ALERTA DE ESTAFA</div>
    <div style="font-size:12px;color:var(--text);line-height:1.6;">${estafaMatches.map(m=>'⚠️ Coincidencia por '+m.reasons.join(', ')+(m.entry.nota?' — <i>'+escapeHTML(m.entry.nota)+'</i>':'')).join('<br>')}</div>
  </div>`:'';
  c.innerHTML=`
    <div class="lbl" style="margin-top:0;">Detalle del Vale</div>
    ${estafaDetailHTML}
    <div class="card">
      ${numBadge}
      <div class="det-gestor-row">
        <div class="g-avatar" style="background:${g?g.color:'#888'};width:34px;height:34px;font-size:12px;">${g?escapeHTML(g.initials):'?'}</div>
        <div style="flex:1;">
          <div style="font-size:14px;font-weight:700;">${g?escapeHTML(g.name):'—'}</div>
          <div style="font-size:11px;color:var(--gray-400);">${new Date(v.ts).toLocaleDateString('es-ES')} ${timeStr(v.ts)}</div>
        </div>
        <div style="text-align:right;">
          <span class="sp ${s.cls}">${s.icon} ${s.label}</span>
          ${pts>0?`<div style="font-size:10px;color:var(--blue);font-weight:700;margin-top:3px;">⭐ ${pts} pts</div>`:``}
        </div>
      </div>
      <table style="width:100%;font-size:12px;border-collapse:collapse;">
        ${[['Cliente',v.cliente],['Teléfono',v.telefono],['Dirección',v.direccion],['Artículo',v.articulo],
           ['Precio USD',v.precioUSD],['Precio MN',v.precioMN],['Vuelto',v.vuelto],['Total',v.total],['Garantía',v.garantia],['💰 Comisión gestor',v.comisionGestor]]
          .filter(([,val])=>val)
          .map(([k,val])=>`<tr style="border-bottom:1px solid var(--gray-100);">
            <td style="padding:6px 0;color:var(--gray-400);font-weight:600;width:100px;">${k}</td>
            <td style="padding:6px 0;font-weight:600;">${escapeHTML(val)}</td></tr>`).join('')}
      </table>
      ${v.mensajeria?`<div style="margin-top:10px;padding:10px 12px;background:rgba(0,109,138,.06);border:1px solid rgba(0,109,138,.2);border-radius:8px;">
        <div style="font-size:10px;color:var(--blue);font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">🛵 Mensajería</div>
        <div style="font-size:13px;font-weight:600;color:var(--text);">${escapeHTML(v.mensajeria)}</div>
      </div>`:''}
      ${notesHighlight}
    </div>
    <div class="card" style="padding:10px 14px;display:flex;gap:6px;">
      ${v.status!=='confirmed'?`<button type="button" class="btn btn-ghost btn-full btn-sm" onclick="openEditValeModal(${v.id})">✏️ Editar vale</button>`:``}
      <button type="button" class="btn btn-sm btn-full" style="background:rgba(239,68,68,.1);color:var(--red);border:none;" onclick="adminDeleteVale(${v.id})">🗑️ Eliminar vale</button>
    </div>
    ${actHTML?`<div class="card"><div class="det-actions">${actHTML}</div></div>`:``}
    <div class="card" style="padding:10px 14px;">
      <div style="font-size:10px;font-weight:700;color:var(--gray-400);letter-spacing:.5px;text-transform:uppercase;margin-bottom:6px;">📝 Notas (admin)</div>
      <textarea id="valeNotesInput" rows="2" placeholder="Añadir nota interna…" style="font-size:12px;margin-bottom:6px;">${escapeHTML(v.adminNotes||'')}</textarea>
      <button type="button" class="btn btn-ghost btn-sm btn-full" onclick="saveValeNotes(${v.id})">Guardar nota</button>
    </div>
    <div class="lbl">Vale completo</div>
    <div class="card" style="padding:10px 12px;">
      <div class="vale-preview" style="font-size:11px;">${escapeHTML(v.valeText||'')}</div>
      <button class="btn btn-ghost btn-full btn-sm" style="margin-top:8px;" onclick="navigator.clipboard.writeText(document.querySelector('#valeDetail .vale-preview').textContent).then(()=>showToast('Copiado ✓'))">📋 Copiar vale</button>
    </div>`;
}

function saveValeNotes(id) {
  const ta=document.getElementById('valeNotesInput');
  if(!ta)return;
  patchVale(id,{adminNotes:ta.value.trim()});
  renderAdminGestores();renderValeDetail();
  showToast('Nota guardada ✓');
}

let editValePickerSelected={};
let editValePickerCatFilter=null;
let editValeProductos=[];

function openEditValeModal(id) {
  const v=getVales().find(x=>x.id===id);if(!v)return;
  ['cliente','telefono','direccion','mensajeria','total','garantia','comisionGestor'].forEach(k=>{
    const el=document.getElementById('ev-'+k);if(el)el.value=v[k]||'';
  });
  // Load articulo + precio fields
  const elArt=document.getElementById('ev-articulo');if(elArt)elArt.value=v.articulo||'';
  const elUSD=document.getElementById('ev-precioUSD');if(elUSD)elUSD.value=v.precioUSD||'';
  const elMN=document.getElementById('ev-precioMN');if(elMN)elMN.value=v.precioMN||'';
  // Load valeProductos
  editValeProductos=v.valeProductos?[...v.valeProductos]:[];
  editValePickerSelected={};
  editValeProductos.forEach(p=>{editValePickerSelected[p.id]=p.qty;});
  renderEditValeSelectedProducts();
  document.getElementById('editValeModal').dataset.valeId=id;
  document.getElementById('editValeModal').classList.add('show');
}
function closeEditValeModal(){document.getElementById('editValeModal').classList.remove('show');}
function renderEditValeSelectedProducts() {
  const c=document.getElementById('ev-selectedProductsList');
  if(!c)return;
  if(!editValeProductos.length){c.style.display='none';return;}
  c.style.display='block';
  c.innerHTML=`<div style="display:flex;flex-direction:column;gap:4px;margin-bottom:6px;">`+
    editValeProductos.map(i=>`<div style="display:flex;align-items:center;gap:6px;">
      <span style="font-weight:800;color:var(--blue);font-size:12px;">×${i.qty}</span>
      <span style="font-size:11px;">${escapeHTML(i.name)}</span>
    </div>`).join('')+`</div>`;
}
function openEditValeProductPicker() {
  if(!getProductos().length){showToast('No hay productos cargados');return;}
  editValePickerSelected={};
  editValeProductos.forEach(p=>{editValePickerSelected[p.id]=p.qty;});
  editValePickerCatFilter=null;
  // Reuse the admin product picker modal but with edit context
  const searchEl=document.getElementById('av-pickerSearch');
  if(searchEl)searchEl.value='';
  renderEditValePickerCatTabs();renderEditValePickerProducts();renderEditValePickerSelected();
  document.getElementById('adminProductPickerModal').classList.add('show');
}
function renderEditValePickerCatTabs() {
  const cats=getCategorias();const el=document.getElementById('av-pickerCatTabs');if(!el)return;
  el.innerHTML=`<button class="pcat-tab ${editValePickerCatFilter===null?'active':''}" onclick="setEditValePickerCat(null)">Todos</button>`+
    cats.map(c=>`<button class="pcat-tab ${editValePickerCatFilter===c.id?'active':''}" onclick="setEditValePickerCat(${c.id})">${escapeHTML(c.name)}</button>`).join('');
}
function setEditValePickerCat(id){editValePickerCatFilter=id;renderEditValePickerCatTabs();renderEditValePickerProducts();}
function renderEditValePickerProducts() {
  const searchEl=document.getElementById('av-pickerSearch');
  const search=searchEl?searchEl.value.toLowerCase():'';
  let prods=getProductos();
  if(editValePickerCatFilter!==null)prods=prods.filter(p=>p.catId===editValePickerCatFilter);
  if(search)prods=prods.filter(p=>p.name.toLowerCase().includes(search)||(p.description||'').toLowerCase().includes(search));
  // Sort: disponibles primero, totalmente reservados y agotados al final
  prods.sort((a,b)=>{
    const aBlocked=(a.stock||0)===0||_isFullyReserved(a)?1:0;
    const bBlocked=(b.stock||0)===0||_isFullyReserved(b)?1:0;
    return aBlocked-bBlocked;
  });
  const grid=document.getElementById('av-pickerProductGrid');if(!grid)return;
  if(!prods.length){grid.innerHTML='<div style="text-align:center;padding:30px 10px;color:var(--gray-400);"><div style="font-size:32px;margin-bottom:8px;opacity:.4;">📦</div><div style="font-size:13px;">No se encontraron productos</div></div>';return;}
  grid.innerHTML=prods.map(p=>{
    const qty=editValePickerSelected[p.id]||0;const sel=qty>0;
    const catColor=_apcGetCatColor(p.catId);
    const catName=_apcGetCatName(p.catId);
    const oos=(p.stock||0)===0;
    const fullyRes=_isFullyReserved(p);
    const partRes=_isPartiallyReserved(p);
    const blocked=oos||fullyRes;
    const reserved=parseInt(p.reserved||0,10);
    const avail=_availableStock(p);
    const badge = oos
      ? `<span class="oos-badge">AGOTADO</span>`
      : fullyRes
        ? `<span class="reserved-badge picker-reserved-badge">🔒 RESERVADO</span>`
        : partRes
          ? `<span class="reserved-badge picker-reserved-badge partial">🔐 Reservado ${reserved} · Disp ${avail}</span>`
          : '';
    const availLine = blocked ? '' : `<div style="font-size:9px;color:var(--text-muted);margin-top:2px;">Disponibles: ${avail}</div>`;
    return `<div class="apcard${sel?' picked':''}${blocked?' apcard-blocked':''}" style="${blocked?'pointer-events:none;opacity:.55;':''}">
      <div class="apcard-info">
        <div class="apcard-name"><span class="apcard-cat" style="background:${catColor}">${escapeHTML(catName)}</span>${escapeHTML(p.name)}${p.garantia?`<span class="apcard-garantia">🛡️ ${escapeHTML(p.garantia)}</span>`:''} ${badge}</div>
        ${p.precio?`<div class="apcard-price">${escapeHTML(p.precio)}</div>`:''}
        ${availLine}
      </div>
      <div class="apcard-controls" style="${blocked?'pointer-events:none;':''}">
        <button class="btn-minus" ${blocked?'disabled':''} onclick="event.stopPropagation();setEditValePickerQty(${p.id},-1)">−</button>
        <span class="qty-val">${qty}</span>
        <button class="btn-plus" ${blocked?'disabled':''} onclick="event.stopPropagation();setEditValePickerQty(${p.id},1)">+</button>
      </div>
    </div>`;
  }).join('');
}
function setEditValePickerQty(pid,delta) {
  const prod=productoOf(pid);
  const max=prod?_availableStock(prod):0;
  let q=(editValePickerSelected[pid]||0)+delta;
  if(q<=0){delete editValePickerSelected[pid];}else{editValePickerSelected[pid]=Math.min(max,q);}
  renderEditValePickerProducts();renderEditValePickerSelected();
}
function renderEditValePickerSelected() {
  const el=document.getElementById('av-pickerSelectedList');if(!el)return;
  const items=Object.entries(editValePickerSelected).map(([id,qty])=>{
    const p=productoOf(parseInt(id));return p?{id:parseInt(id),name:p.name,qty,precio:p.precio||''}:null;
  }).filter(Boolean);
  if(!items.length){el.innerHTML='<div style="font-size:12px;color:var(--gray-400);">Ningún producto seleccionado</div>';return;}
  el.innerHTML=items.map(i=>`<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;padding:4px 8px;background:var(--blue-lt);border-radius:8px;">
    <span style="font-weight:800;color:var(--blue);min-width:18px;">${i.qty}×</span>
    <span style="flex:1;font-size:12px;font-weight:600;">${escapeHTML(i.name)}</span>
    ${i.precio?`<span style="font-size:11px;color:var(--blue);font-weight:700;">${escapeHTML(i.precio)}</span>`:''}
    <button onclick="setEditValePickerQty(${i.id},-1)" style="width:22px;height:22px;border-radius:50%;border:1px solid var(--gray-200);background:var(--surface);cursor:pointer;font-weight:700;color:var(--red);font-size:13px;display:flex;align-items:center;justify-content:center;">−</button>
    <button onclick="setEditValePickerQty(${i.id},1)" style="width:22px;height:22px;border-radius:50%;border:1px solid var(--gray-200);background:var(--surface);cursor:pointer;font-weight:700;color:var(--green);font-size:13px;display:flex;align-items:center;justify-content:center;">+</button>
  </div>`).join('');
}
function confirmEditValePickerSelection() {
  const items=Object.entries(editValePickerSelected).map(([id,qty])=>{
    const p=productoOf(parseInt(id));return{id:parseInt(id),name:p?p.name:id,qty};
  });
  editValeProductos=items;
  const elArt=document.getElementById('ev-articulo');if(elArt)elArt.value=items.map(i=>`×${i.qty} ${i.name}`).join(' / ');
  // Auto-fill prices: separate USD and MN
  let usdTotal=0, mnTotal=0;
  items.forEach(({id,qty})=>{
    const p=productoOf(id);if(!p||!p.precio)return;
    const num=parsePrecioNum(p.precio)*qty;
    const isMN=(p.precio+'').toUpperCase().includes('MN')||(p.precio+'').toUpperCase().includes('CUP');
    if(isMN)mnTotal+=num; else usdTotal+=num;
  });
  if(usdTotal>0||mnTotal>0){
    document.getElementById('ev-precioUSD').value=usdTotal>0?`$${usdTotal} USD`:'';
    document.getElementById('ev-precioMN').value=mnTotal>0?`${Math.round(mnTotal)} MN`:'';
  }
  // auto-calculate commission based on products and quantity
  let comUSD=0, comMN=0;
  items.forEach(({id,qty})=>{
    const p=productoOf(id);if(!p)return;
    const com=p.comision||'';
    if(!com)return;
    const isPct=com.includes('%');
    const comUpper=(com+'').toUpperCase();
    const isMNCom=comUpper.includes('MN')||comUpper.includes('CUP');
    const moneda=p.comisionMoneda||'';
    const useMN=isMNCom||moneda.toUpperCase()==='MN';
    if(isPct){
      const pct=parseFloat(com.replace(/[^0-9.]/g,''));
      const priceNum=parsePrecioNum(p.precio||'');
      if(!isNaN(pct)&&priceNum>0){
        const amt=Math.round(priceNum*(pct/100)*qty*100)/100;
        if(useMN)comMN+=amt; else comUSD+=amt;
      }
    } else {
      const num=parsePrecioNum(com)*qty;
      if(num>0){ if(useMN)comMN+=num; else comUSD+=num; }
    }
  });
  if(comUSD>0||comMN>0){
    const parts=[];
    if(comUSD>0)parts.push(`$${comUSD.toFixed(2)} USD`);
    if(comMN>0)parts.push(`${Math.round(comMN)} MN`);
    document.getElementById('ev-comisionGestor').value=parts.join(' + ');
  }
  if(!document.getElementById('ev-garantia').value){
    const g=items.map(({id})=>productoOf(id)?.garantia).find(Boolean);
    if(g)document.getElementById('ev-garantia').value=g;
  }
  renderEditValeSelectedProducts();
  closeAdminProductPicker();
}
function saveEditVale() {
  const id=parseInt(document.getElementById('editValeModal').dataset.valeId);
  const v=getVales().find(x=>x.id===id);if(!v)return;
  const changes={};
  ['cliente','telefono','direccion','mensajeria','total','garantia','comisionGestor','articulo','precioUSD','precioMN'].forEach(k=>{
    const el=document.getElementById('ev-'+k);if(el)changes[k]=el.value.trim();
  });
  // Save product selection. editValeProductos siempre refleja la selección actual
  // del picker (se inicializa desde v.valeProductos al abrir el modal) — antes,
  // si el admin quitaba todos los productos del vale, el array quedaba vacío y
  // este `if` lo ignoraba, dejando silenciosamente los productos viejos guardados.
  const productsChanged = JSON.stringify(editValeProductos) !== JSON.stringify(v.valeProductos||[]);
  if (productsChanged && v.stockDecremented) {
    // Este vale ya tiene el stock descontado del inventario (pending_payment o
    // confirmed). Cambiar aquí los productos/cantidades no ajusta el stock —
    // dejaría el inventario descuadrado. Se guardan los demás campos igual,
    // pero los productos quedan sin tocar; hay que revertir la venta primero.
    changes.valeProductos = v.valeProductos||[];
    patchVale(id,changes);
    closeEditValeModal();
    renderAdminGestores();renderValeDetail();
    showToast('⚠️ Los productos NO se cambiaron: el stock ya se descontó. Revierte la venta primero.');
    return;
  }
  changes.valeProductos=editValeProductos;
  patchVale(id,changes);
  closeEditValeModal();
  renderAdminGestores();renderValeDetail();
  showToast('Vale editado ✓');
}

function updateSharePreview() {
  const v=getVales().find(x=>x.id===shareTargetId);if(!v)return;
  const m=mensajeroOf(parseInt(document.getElementById('mensajeroSelect').value));
  document.getElementById('shareValePreview').textContent=buildShareText(v,m);
}
function buildShareText(v,m) {
  const g=gestorOf(v.gestorId);
  const numLine=valeNumStr(v)?`${valeNumStr(v)}
`:'';
  return [numLine+'Bienvenido a "AXONTECH" 🔥','','VALE DE ENTREGA','',
    `🔸Promotor: ${g?g.name:'—'}`,`🛵Mensajero: ${m?m.name:'—'}`,'',
    `🔸 Nombre Cliente: ${v.cliente||''}`,`🔸Teléfono Cliente: ${v.telefono||''}`,
    `🔸Dirección Cliente: ${v.direccion||''}`,`🔸Mensajería/ costo: ${v.mensajeria||''}`,
    `🔸 Artículo y cantidad: ${v.articulo||''}`,`🔸 Total a pagar: ${v.total||''}`, '',
    `*Fecha: ${new Date(v.ts).toLocaleDateString('es-ES')} ${timeStr(v.ts)}`,'',
    '🧭Amistad #311 % San Rafael y San José, Centro Habana.'].join('\n');
}
function shareViaWA() {
  const text=document.getElementById('shareValePreview').textContent;
  const mId=parseInt(document.getElementById('mensajeroSelect').value);
  const m=mensajeroOf(mId);
  // Si el mensajero tiene teléfono guardado → abrir chat DIRECTO con él (wa.me/<phone>)
  // y pre-llenar el texto del vale. Si no tiene teléfono → caer al flujo público
  // wa.me/?text=... (el usuario elige el destino manualmente).
  if(m && m.phone){
    window.open(_buildWhatsAppUrl(m.phone, text), '_blank');
  } else {
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`,'_blank');
    if(m) showToast('💡 Agrega un teléfono a este mensajero para abrir su WhatsApp directo');
  }
}
function closeShareModal(){document.getElementById('shareModal').classList.remove('show');shareTargetId=null;}
function copyAndAssign() {
  if(!shareTargetId)return;
  const mId=parseInt(document.getElementById('mensajeroSelect').value);
  const m=mensajeroOf(mId);
  const text=document.getElementById('shareValePreview').textContent;
  navigator.clipboard.writeText(text).catch(()=>{});
  const vAsign=getVales().find(x=>x.id===shareTargetId);
  patchVale(shareTargetId,{status:'assigned',mensajeroId:mId});
  if(vAsign) addNotif('vale_assigned',vAsign.cliente||'Tu cliente',null,m?m.name:'',vAsign.gestorId);
  closeShareModal();selectedValeId=shareTargetId;
  renderAdminGestores();renderValeDetail();renderMyVales();
  renderConfirmados();renderPendienteCobro();
  updateMensajeroBadge();
  // Si el mensajero tiene teléfono → abrir su WhatsApp directo con el texto del vale.
  // Así el admin asigna y a la vez le manda el vale al mensajero en un solo toque.
  if(m && m.phone){
    setTimeout(()=>window.open(_buildWhatsAppUrl(m.phone, text), '_blank'), 250);
    showToast(`Asignado a ${m?m.name:'mensajero'} · WhatsApp abierto ✓`);
  } else {
    showToast(`Asignado a ${m?m.name:'mensajero'} y copiado ✓`);
  }
}

// ══════════════════════════════════════════
//  CONFIRM / PENDING
// ══════════════════════════════════════════
// Mensajero marca entrega — pasa directo a pendiente de cobro, descuenta stock, notifica gestor
function mensajeroEntrega(id) {
  const v=getVales().find(x=>x.id===id);if(!v)return;
  // Idempotency guard: prevent double stock decrement if button is double-clicked
  // Only 'assigned' vales should be deliverable.
  if(v.status !== 'assigned'){
    showToast('Este vale no está asignado o ya fue entregado');
    return;
  }
  // Descuenta stock usando el helper _descontarStock (DRY — Ver AUDITORIA-AXONTECH.md MEDIO 28)
  _descontarStock(v);
  _logAudit('vale_delivered', 'vale:' + id);
  // Notifica al gestor que su venta fue entregada y queda pendiente de cobro
  addNotif('vale_assigned',v.cliente||'Cliente',null,'Entregado · Pendiente de cobro',v.gestorId);
  patchVale(id,{status:'pending_payment',deliveredTs:new Date().toISOString(),stockDecremented:true});
  gestoresTabDirty=true;statsTabDirty=true;rankingCache=null;
  renderAdminGestores();renderValeDetail();renderMyVales();
  renderPendienteCobro();renderMensajeroVales();renderPendingCobroSection();
  renderProductGrid();renderGestorRanking();updateAdminBadge();updateMensajeroBadge();
  maybeAutoSync();
  showToast('Entregado · Pendiente de cobro 🛵⏳');
}
// Mensajero marca como pagado directo (sin pasar por pendiente de cobro)
function mensajeroPagadoDirecto(id, skipConfirm) {
  if(!skipConfirm) {
    const v=getVales().find(x=>x.id===id);if(!v)return;
    showConfirmAction('¿Confirmar venta cobrada?',`${v.cliente||''} · ${v.total||''}`,'Confirmar cobrada','btn-green',()=>mensajeroPagadoDirecto(id,true));
    return;
  }
  const v=getVales().find(x=>x.id===id);if(!v)return;
  // Idempotency: if stock was already decremented (via mensajeroEntrega → pending_payment,
  // or via a previous mensajeroPagadoDirecto), do NOT decrement again.
  if(v.status==='confirmed'){showToast('Esta venta ya fue confirmada');return;}
  if(v.status==='pending_payment'||v.stockDecremented){
    showToast('Esta venta ya tiene stock descontado');
    // Just transition to confirmed without touching stock
    patchVale(id,{status:'confirmed',confirmedTs:new Date().toISOString(),deliveredTs:v.deliveredTs||new Date().toISOString()});
    addNotif('vale_confirmed',v.cliente||'Cliente',null,`Total: ${v.total||''}`,v.gestorId);
    gestoresTabDirty=true;statsTabDirty=true;rankingCache=null;
    playSound('confirm');
    renderAdminGestores();renderValeDetail();renderMyVales();
    renderPendienteCobro();renderMensajeroVales();renderPendingCobroSection();
    renderConfirmados();renderProductGrid();renderGestorRanking();
    if(currentAdminTab==='gestores'){renderComisiones();}
    if(currentAdminTab==='catalog'){renderAdminCatalogCats();renderAdminCatalog();}
    updateAdminBadge();updateMensajeroBadge();
    checkGoalReached(v.gestorId, id);
    maybeAutoSync();
    showToast('Venta cobrada ✅');
    return;
  }
  // First-time stock decrement (helper DRY — AUDITORIA-AXONTECH.md MEDIO 28)
  _descontarStock(v);
  addNotif('vale_confirmed',v.cliente||'Cliente',null,`Total: ${v.total||''}`,v.gestorId);
  _logAudit('vale_confirmed', 'vale:' + id);
  patchVale(id,{status:'confirmed',confirmedTs:new Date().toISOString(),deliveredTs:new Date().toISOString(),stockDecremented:true});
  gestoresTabDirty=true;statsTabDirty=true;rankingCache=null;
  playSound('confirm');
  renderAdminGestores();renderValeDetail();renderMyVales();
  renderPendienteCobro();renderMensajeroVales();renderPendingCobroSection();
  renderConfirmados();renderProductGrid();renderGestorRanking();
  if(currentAdminTab==='gestores'){renderComisiones();}
  if(currentAdminTab==='catalog'){renderAdminCatalogCats();renderAdminCatalog();}
  updateAdminBadge();updateMensajeroBadge();
  checkGoalReached(v.gestorId, id);
  maybeAutoSync();
  showToast('Venta cobrada ✅');
}
// Mensajero marca como pagado (entregado y cobrado)
function mensajeroPagado(id, skipConfirm) {
  if(!skipConfirm) {
    const v=getVales().find(x=>x.id===id);if(!v)return;
    showConfirmAction('¿Confirmar venta cobrada?',`${v.cliente||''} · ${v.total||''}`,'Confirmar cobrada','btn-green',()=>mensajeroPagado(id,true));
    return;
  }
  const v=getVales().find(x=>x.id===id);if(!v)return;
  // Idempotency: if stock was already decremented (via mensajeroEntrega → pending_payment),
  // do NOT decrement again. Only transition status to 'confirmed'.
  if(v.status === 'confirmed') { showToast('Esta venta ya fue confirmada'); return; }
  if(v.status === 'pending_payment' || v.stockDecremented) {
    // Stock already decremented — just confirm the sale
    addNotif('vale_confirmed',v.cliente||'Cliente',null,`Total: ${v.total||''}`,v.gestorId);
    _logAudit('vale_confirmed', 'vale:' + id);
    patchVale(id,{status:'confirmed',confirmedTs:new Date().toISOString(),deliveredTs:v.deliveredTs||new Date().toISOString()});
    gestoresTabDirty=true;statsTabDirty=true;rankingCache=null;
    playSound('confirm');
    renderAdminGestores();renderValeDetail();renderMyVales();
    renderPendienteCobro();renderMensajeroVales();renderPendingCobroSection();
    renderConfirmados();renderProductGrid();renderGestorRanking();
    if(currentAdminTab==='gestores'){renderComisiones();}
    if(currentAdminTab==='catalog'){renderAdminCatalogCats();renderAdminCatalog();}
    updateAdminBadge();updateMensajeroBadge();
    checkGoalReached(v.gestorId, id);
    maybeAutoSync();
    showToast('Venta confirmada y cobrada ✅');
    return;
  }
  // First-time stock decrement (helper DRY — AUDITORIA-AXONTECH.md MEDIO 28)
  _descontarStock(v);
  addNotif('vale_confirmed',v.cliente||'Cliente',null,`Total: ${v.total||''}`,v.gestorId);
  _logAudit('vale_confirmed', 'vale:' + id);
  patchVale(id,{status:'confirmed',confirmedTs:new Date().toISOString(),deliveredTs:v.deliveredTs||new Date().toISOString(),stockDecremented:true});
  gestoresTabDirty=true;statsTabDirty=true;rankingCache=null;
  playSound('confirm');
  renderAdminGestores();renderValeDetail();renderMyVales();
  renderPendienteCobro();renderMensajeroVales();renderPendingCobroSection();
  renderConfirmados();renderProductGrid();renderGestorRanking();
  if(currentAdminTab==='gestores'){renderComisiones();}
  if(currentAdminTab==='catalog'){renderAdminCatalogCats();renderAdminCatalog();}
  updateAdminBadge();updateMensajeroBadge();
  checkGoalReached(v.gestorId, id);
  maybeAutoSync();
  showToast('Venta confirmada y cobrada ✅');
}
// Admin confirma venta: descuenta stock + notifica gestor + fija estado de cobro
function confirmSale(id, paymentStatus, skipConfirm) {
  if(!skipConfirm) {
    const v=getVales().find(x=>x.id===id);if(!v)return;
    const title=paymentStatus==='confirmed'?'¿Confirmar venta cobrada?':'¿Confirmar — cobro pendiente?';
    const sub=paymentStatus==='confirmed'?`${v.cliente||''} · ${v.total||''}`:`${v.cliente||''}`;
    showConfirmAction(title,sub,paymentStatus==='confirmed'?'Confirmar cobrada':'Confirmar pendiente','btn-blue',()=>confirmSale(id,paymentStatus,true));
    return;
  }
  const v=getVales().find(x=>x.id===id);if(!v)return;
  // Idempotency guard: prevent double stock decrement if button is double-clicked
  if(v.status === 'confirmed' || v.status === 'pending_payment') {
    showToast('Esta venta ya fue confirmada');
    return;
  }
  // Descuento de stock garantizado (helper DRY — AUDITORIA-AXONTECH.md MEDIO 28)
  _descontarStock(v);
  if(paymentStatus === 'confirmed') addNotif('vale_confirmed',v.cliente||'Cliente',null,`Total: ${v.total||''}`,v.gestorId);
  _logAudit('vale_confirm_' + paymentStatus, 'vale:' + id);
  patchVale(id,{status:paymentStatus,confirmedTs:new Date().toISOString(),stockDecremented:true});
  gestoresTabDirty=true;statsTabDirty=true;rankingCache=null;
  playSound('confirm');
  renderAdminGestores();renderValeDetail();renderMyVales();
  renderConfirmados();renderPendienteCobro();renderPendingCobroSection();renderMensajeroVales();
  renderProductGrid();renderGestorRanking();
  if(currentAdminTab==='gestores'){renderComisiones();}
  if(currentAdminTab==='catalog'){renderAdminCatalogCats();renderAdminCatalog();}
  checkGoalReached(v.gestorId, id);
  maybeAutoSync();
  showToast(paymentStatus==='confirmed'?'Venta confirmada y cobrada ✅':'Venta confirmada — cobro pendiente ⏳');
}
// Admin registra cobro recibido — sin tocar stock (ya se descontó al confirmar)
function markAsPaid(id, skipConfirm) {
  if(!skipConfirm) {
    const v=getVales().find(x=>x.id===id);if(!v)return;
    showConfirmAction('¿Registrar cobro recibido?',`${v.cliente||''} · ${v.total||''}`,'Registrar cobro','btn-green',()=>markAsPaid(id,true));
    return;
  }
  // Revalida el estado justo antes de aplicar el cambio (igual que mensajeroPagado/
  // confirmSale): entre que se abrió el modal de confirmación y que el admin lo
  // confirma puede pasar tiempo — si otro dispositivo ya revirtió esta venta en el
  // medio, aplicar 'confirmed' aquí dejaría un vale "confirmado" sin stock descontado.
  const v=getVales().find(x=>x.id===id);
  if(!v || v.status!=='pending_payment'){showToast('Este vale ya no está pendiente de cobro');return;}
  patchVale(id,{status:'confirmed',confirmedTs:new Date().toISOString()});
  gestoresTabDirty=true;statsTabDirty=true;rankingCache=null;
  renderAdminGestores();renderValeDetail();renderMyVales();
  renderConfirmados();renderPendienteCobro();renderPendingCobroSection();renderMensajeroVales();renderMensajeroSelector();updateMensajeroBadge();
  renderGestorRanking();
  if(currentAdminTab==='gestores'){renderComisiones();}
  if(currentAdminTab==='catalog'){renderAdminCatalogCats();renderAdminCatalog();}
  checkGoalReached(getVales().find(x=>x.id===id)?.gestorId, id);
  maybeAutoSync();
  showToast('Cobro registrado ✅');
}

// ══════════════════════════════════════════
//  MENSAJEROS
// ══════════════════════════════════════════
function addMensajero() {
  const inp=document.getElementById('newMensajeroInput');
  const name=inp.value.trim();if(!name)return;
  const phoneInp=document.getElementById('newMensajeroPhoneInput');
  const rawPhone = phoneInp ? (phoneInp.value||'').trim() : '';
  const phone = _normalizePhone(rawPhone);
  // BUGFIX: ver comentario en sendVale()/addGestor() — no mutar el array
  // que devuelve getMensajeros().
  saveMensajeros([...getMensajeros(), {id:Date.now(),name,phone:phone||''}]);
  inp.value='';if(phoneInp) phoneInp.value='';
  renderMensajeros();maybeAutoSync();
  showToast(phone ? 'Mensajero agregado ✓' : 'Mensajero agregado (sin teléfono)');
}

// Normaliza un teléfono a formato internacional solo-dígitos.
// Acepta "+53 5 123 4567", "53512345678", "(53) 5123-4567", etc.
// Devuelve string de dígitos (sin "+"). Si está vacío o no parseable, devuelve ''.
function _normalizePhone(raw) {
  if (!raw) return '';
  // Quitar todo lo que no sea dígito
  const digits = String(raw).replace(/\D+/g, '');
  if (!digits) return '';
  // Si empieza con 00, quitarlo (prefijo internacional largo)
  let n = digits;
  if (n.startsWith('00')) n = n.slice(2);
  // Si es un número cubano sin prefijo (5XXXXXXXX, 7XXXXXXXX, 20XXXXXXX, etc.)
  // y no empieza con 53, anteponer 53.
  if (!n.startsWith('53') && /^[567]\d{7}$/.test(n)) {
    n = '53' + n;
  }
  return n;
}

// Devuelve true si el teléfono normalizado parece válido (al menos 8 dígitos).
function _isValidPhone(normalized) {
  return /^\d{8,}$/.test(normalized || '');
}

// Construye la URL de WhatsApp para un teléfono normalizado + texto opcional.
function _buildWhatsAppUrl(phone, text) {
  const p = _normalizePhone(phone);
  let url = 'https://wa.me/';
  if (p) url += p;
  if (text) url += (p ? '?' : '?') + 'text=' + encodeURIComponent(text);
  return url;
}
const _nmi=document.getElementById('newMensajeroInput');if(_nmi)_nmi.addEventListener('keydown',e=>{if(e.key==='Enter')addMensajero();});
function removeMensajero(id) {
  if(getVales().some(v=>v.mensajeroId===id&&['assigned','pending_payment'].includes(v.status))){showToast('Tiene vales activos');return;}
  saveMensajeros(getMensajeros().filter(m=>m.id!==id));renderMensajeros();maybeAutoSync();
}
function renderMensajeros() {
  // Orden alfabético (copia, no muta el array original) — igual que gestores.
  const list=sortMensajerosAlpha(getMensajeros());
  const c=document.getElementById('mensajerosList');
  const vales=getVales();
  _updateMensajerosCountBadge();
  if(!c) return;
  if(!list.length){c.innerHTML='<div class="es" style="padding:8px;"><div class="es-text">Sin mensajeros</div></div>';return;}
  c.innerHTML=list.map(m=>{
    const ini=m.name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
    const phone=m.phone||'';
    const assigned=vales.filter(v=>v.mensajeroId===m.id&&v.status==='assigned').length;
    const act=m.id===activeMensajeroId;
    const waBtn = phone
      ? `<button type="button" style="background:none;border:1px solid #25D366;cursor:pointer;font-size:10px;color:#25D366;padding:2px 7px;border-radius:4px;font-weight:600;" onclick="event.stopPropagation();openMensajeroWhatsApp(${m.id})" title="WhatsApp ${escapeHTML(phone)}">💬 WhatsApp</button>`
      : '';
    const phoneHTML = phone ? `<span>📱 ${escapeHTML(phone)}</span>` : '';
    return `<div class="m-item ${act?'active':''}" style="cursor:pointer;flex-wrap:wrap;" onclick="selectMensajero(${m.id})" title="Toca para ver sus entregas">
      <div class="m-av">${escapeHTML(ini)}</div>
      <div style="flex:1;min-width:140px;">
        <div class="m-name">${escapeHTML(m.name)} ${act?'<span style="color:var(--blue);">✓ Viendo entregas</span>':''}</div>
        <div style="font-size:10px;color:var(--gray-400);display:flex;gap:8px;flex-wrap:wrap;margin-top:1px;">${phoneHTML}<span>🛵 ${assigned} entrega${assigned!==1?'s':''} en curso</span></div>
        <div style="display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-top:6px;">
          ${waBtn}
          <button type="button" style="background:none;border:1px solid var(--gray-400);cursor:pointer;font-size:10px;color:var(--gray-700);padding:2px 7px;border-radius:4px;font-weight:600;" onclick="event.stopPropagation();openEditMensajeroModal(${m.id})">✏️ Editar</button>
          <button type="button" style="background:none;border:1px solid var(--red);cursor:pointer;font-size:10px;color:var(--red);padding:2px 7px;border-radius:4px;font-weight:600;" onclick="event.stopPropagation();removeMensajero(${m.id})">🗑️ Eliminar</button>
        </div>
      </div>
    </div>`;
  }).join('');
}
function openEditMensajeroModal(id) {
  const m=mensajeroOf(id);if(!m)return;
  document.getElementById('editMensajeroInput').value=m.name;
  const phoneInp=document.getElementById('editMensajeroPhoneInput');
  if(phoneInp) phoneInp.value = m.phone || '';
  document.getElementById('editMensajeroModal').dataset.mensajeroId=id;
  document.getElementById('editMensajeroModal').classList.add('show');
}
function closeEditMensajeroModal(){document.getElementById('editMensajeroModal').classList.remove('show');}
function saveEditMensajero() {
  const id=parseInt(document.getElementById('editMensajeroModal').dataset.mensajeroId);
  const newName=document.getElementById('editMensajeroInput').value.trim();
  if(!newName){showToast('El nombre no puede estar vacío');return;}
  const phoneInp=document.getElementById('editMensajeroPhoneInput');
  const rawPhone = phoneInp ? (phoneInp.value||'').trim() : '';
  const phone = _normalizePhone(rawPhone);
  const list=getMensajeros();const i=list.findIndex(m=>m.id===id);if(i===-1)return;
  list[i]={...list[i],name:newName,phone:phone||''};
  saveMensajeros(list);
  closeEditMensajeroModal();
  renderMensajeros();renderMensajeroSelector();
  maybeAutoSync();
  showToast('Mensajero actualizado ✓');
}

// Abrir WhatsApp con el texto del vale que se está compartiendo (o vacío si
// se llama desde la ficha del mensajero).
function openMensajeroWhatsApp(mensajeroId, optionalText) {
  const m = mensajeroOf(mensajeroId);
  if(!m){showToast('Mensajero no encontrado');return;}
  if(!m.phone){showToast('Este mensajero no tiene teléfono');return;}
  const text = optionalText || '';
  window.open(_buildWhatsAppUrl(m.phone, text), '_blank');
}

// ══════════════════════════════════════════
//  CONFIRMADOS / PENDIENTES
// ══════════════════════════════════════════
function renderConfirmados() {
  const today=getVales().filter(v=>v.status==='confirmed'&&new Date(v.ts).toDateString()===todayStr()).reverse();
  const c=document.getElementById('confirmadosList');
  if(!c) return;
  if(!today.length){c.innerHTML='<div class="es"><div class="es-icon">✅</div><div class="es-text">Sin confirmaciones</div></div>';return;}
  c.innerHTML=today.map(v=>{
    const g=gestorOf(v.gestorId);const m=v.mensajeroId?mensajeroOf(v.mensajeroId):null;
    return `<div class="sc sc-ok"><div class="sc-head"><span class="sc-g">${g?escapeHTML(g.name):'—'}</span><span class="sc-t">${timeStr(v.confirmedTs||v.ts)}</span></div><div>${escapeHTML(v.cliente||'')}</div><div class="sc-m">${m?'🛵 '+escapeHTML(m.name):''}</div><button type="button" class="btn btn-ghost btn-sm" style="margin-top:5px;font-size:10px;color:var(--orange);" onclick="revertConfirmSale(${v.id})">↩ Revertir venta</button></div>`;
  }).join('');
}
function renderPendienteCobro() {
  const c=document.getElementById('pendienteList');
  if(!c) return;
  const pend=getVales().filter(v=>v.status==='pending_payment').reverse();
  if(!pend.length){c.innerHTML='<div class="es"><div class="es-icon">⏳</div><div class="es-text">Sin pendientes</div></div>';return;}
  c.innerHTML=pend.map(v=>{
    const g=gestorOf(v.gestorId);const m=v.mensajeroId?mensajeroOf(v.mensajeroId):null;
    return `<div class="sc sc-pend"><div class="sc-head"><span class="sc-g">${g?escapeHTML(g.name):'—'}</span><span class="sc-t">${timeStr(v.ts)}</span></div><div>${escapeHTML(v.cliente||'')} · ${escapeHTML(v.total||'')}</div><div class="sc-m">${m?'🛵 '+escapeHTML(m.name):''}</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:7px;"><button class="btn btn-green btn-sm btn-full" onclick="markAsPaid(${v.id})">✅ Cobrado</button><button class="btn btn-ghost btn-sm btn-full" style="color:var(--orange);" onclick="revertConfirmSale(${v.id})">↩ Revertir</button></div></div>`;
  }).join('');
}
function togglePendingCobro(){pendingCobroExpanded=!pendingCobroExpanded;renderPendingCobroSection();}
function renderPendingCobroSection() {
  const c=document.getElementById('pendingCobroSection');if(!c)return;
  const pend=getVales().filter(v=>v.status==='pending_payment').reverse();
  if(!pend.length){c.innerHTML='';return;}
  const body=pendingCobroExpanded?`<div style="margin-top:8px;">${pend.map(v=>{
    const g=gestorOf(v.gestorId);const m=v.mensajeroId?mensajeroOf(v.mensajeroId):null;
    return `<div class="mv-card" style="border-left:3px solid var(--red);background:rgba(239,68,68,.05);margin-bottom:6px;">
      <div class="mv-head"><span class="mv-time">${timeStr(v.confirmedTs||v.ts)}</span><span style="color:var(--red);font-size:9px;font-weight:700;padding:2px 6px;background:rgba(239,68,68,.12);border-radius:4px;">⏳ Pend. cobro</span></div>
      <div class="mv-info"><b>${escapeHTML(v.cliente||'—')}</b> · <span style="color:var(--red);font-weight:700;">${escapeHTML(v.total||'—')}</span></div>
      ${g?`<div style="font-size:11px;color:var(--gray-400);">Gestor: ${escapeHTML(g.name)}</div>`:''}
      ${m?`<div style="font-size:11px;color:var(--gray-400);">🛵 ${escapeHTML(m.name)}</div>`:''}
      <button class="btn btn-green btn-full btn-sm" style="margin-top:8px;" onclick="markAsPaid(${v.id})">💵 Registrar cobro</button>
    </div>`;
  }).join('')}</div>`:'' ;
  c.innerHTML=`<div onclick="togglePendingCobro()" style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:rgba(239,68,68,.08);border:1.5px solid rgba(239,68,68,.3);border-radius:9px;cursor:pointer;margin-bottom:${pendingCobroExpanded?'0':'12px'};">
    <div style="display:flex;align-items:center;gap:8px;">
      <span style="font-size:16px;">⏳</span>
      <span style="font-weight:700;font-size:13px;color:var(--red);">Pendientes de cobro</span>
      <span style="background:var(--red);color:white;border-radius:10px;font-size:10px;font-weight:700;padding:1px 7px;">${pend.length}</span>
    </div>
    <span style="color:var(--red);font-size:14px;">${pendingCobroExpanded?'▲':'▼'}</span>
  </div>${body}`;
}

// ══════════════════════════════════════════
//  MY VALES (gestor)
// ══════════════════════════════════════════

// Period filter state for gestor dashboard
let _gestorHistPeriod = 'month'; // 'month' | 'last' | 'all'

function setGestorHistPeriod(p) {
  _gestorHistPeriod = p;
  // Update chip highlight
  document.querySelectorAll('#gestorHistPeriodFilter [data-period]').forEach(btn => {
    const isActive = btn.dataset.period === p;
    btn.classList.toggle('btn-blue', isActive);
    btn.classList.toggle('btn-ghost', !isActive);
    btn.style.fontWeight = isActive ? '700' : '500';
  });
  renderMyVales();
}

// Returns {from, to, prevFrom, prevTo, label} for the currently selected period
function getGestorHistPeriodRange() {
  const now = new Date();
  const todayStr = localDay(now);
  if (_gestorHistPeriod === 'month') {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevFrom = new Date(now.getFullYear(), now.getMonth()-1, 1);
    const prevTo = new Date(now.getFullYear(), now.getMonth(), 0);
    return {
      from: localDay(from),
      to: todayStr,
      prevFrom: localDay(prevFrom),
      prevTo: localDay(prevTo),
      label: 'Este mes'
    };
  } else if (_gestorHistPeriod === 'last') {
    const from = new Date(now.getFullYear(), now.getMonth()-1, 1);
    const to = new Date(now.getFullYear(), now.getMonth(), 0);
    const prevFrom = new Date(now.getFullYear(), now.getMonth()-2, 1);
    const prevTo = new Date(now.getFullYear(), now.getMonth()-1, 0);
    return {
      from: localDay(from),
      to: localDay(to),
      prevFrom: localDay(prevFrom),
      prevTo: localDay(prevTo),
      label: 'Mes pasado'
    };
  }
  return { from:'', to:'', prevFrom:'', prevTo:'', label:'Todo el histórico' };
}

function _computeGestorStatsForRange(gestorId, from, to) {
  let vales = getVales().filter(v => Number(v.gestorId) === Number(gestorId));
  if (from) vales = vales.filter(v => localDay(v.ts) >= from);
  if (to)   vales = vales.filter(v => localDay(v.ts) <= to);
  const total = vales.length;
  const confirmed = vales.filter(v => v.status === 'confirmed').length;
  const pendingPay = vales.filter(v => v.status === 'pending_payment').length;
  const pending = vales.filter(v => v.status === 'pending').length;
  const cancelled = vales.filter(v => v.status === 'cancelled').length;
  const pts = vales
    .filter(v => ['confirmed','pending_payment'].includes(v.status))
    .reduce((sum,v) => (v.valeProductos||[]).reduce((s,p) => {
      const pr = productoOf(p.id);
      return s + (pr ? (pr.puntos||0) * p.qty : 0);
    }, sum), 0);
  // Commission for confirmed + pending_payment
  const comVales = vales.filter(v => ['confirmed','pending_payment'].includes(v.status));
  const com = sumCommissions(comVales);
  // Ticket promedio (only for confirmed/pending_payment with computable commission)
  const comBadge = fmtComisionBadge(com.usd, com.mn, com.computed);
  // Conversion: confirmed / (total - cancelled - pending still pending)
  // More useful: closed sales (confirmed + pending_payment) / total attempted
  const closed = confirmed + pendingPay;
  const conversion = total > 0 ? Math.round((closed / total) * 100) : 0;
  return { total, confirmed, pendingPay, pending, cancelled, pts, com, comBadge, conversion, closed };
}

// Comparison arrow HTML — previous vs current value
function _cmpArrow(curr, prev) {
  if (prev === 0 && curr === 0) return '';
  if (prev === 0) return `<span style="color:var(--green);font-size:10px;font-weight:700;margin-left:4px;">↑ nuevo</span>`;
  const diff = curr - prev;
  if (diff === 0) return `<span style="color:var(--gray-400);font-size:10px;margin-left:4px;">= igual</span>`;
  const pct = Math.round(Math.abs(diff) / prev * 100);
  const up = diff > 0;
  const color = up ? 'var(--green)' : 'var(--red)';
  const arrow = up ? '↑' : '↓';
  return `<span style="color:${color};font-size:10px;font-weight:700;margin-left:4px;">${arrow} ${pct}%</span>`;
}

function renderGestorDashboard() {
  const dash = document.getElementById('gestorHistDashboard');
  const filterWrap = document.getElementById('gestorHistPeriodFilter');
  if (!dash || !activeGestorId) return;

  // Highlight active period chip
  if (filterWrap) {
    filterWrap.querySelectorAll('[data-period]').forEach(btn => {
      const isActive = btn.dataset.period === _gestorHistPeriod;
      btn.classList.toggle('btn-blue', isActive);
      btn.classList.toggle('btn-ghost', !isActive);
      btn.style.fontWeight = isActive ? '700' : '500';
    });
  }

  const range = getGestorHistPeriodRange();
  const cur = _computeGestorStatsForRange(activeGestorId, range.from, range.to);
  const prev = (range.prevFrom && range.prevTo)
    ? _computeGestorStatsForRange(activeGestorId, range.prevFrom, range.prevTo)
    : null;

  // Meta progress
  const cfg = getConfig();
  const meta = cfg.metaPuntos || 100;
  const pctMeta = Math.min(100, Math.round((cur.pts / meta) * 100));

  // v9: KPIs en grid de 4 columnas fijo (el contenedor padre ya es display:block)
  const confirmedTotal = cur.confirmed + cur.pendingPay;

  const heroHTML = `
    <div style="background:var(--surface);border-radius:clamp(12px,4vw,16px);padding:clamp(14px,4vw,18px);margin-bottom:clamp(8px,2.5vw,12px);box-shadow:0 2px 8px rgba(0,0,0,.04);">
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:clamp(4px,1.5vw,8px);">
        <div style="text-align:center;">
          <div style="font-size:clamp(20px,6.5vw,30px);font-weight:700;color:var(--blue);line-height:1;letter-spacing:-.02em;">${cur.total}</div>
          <div style="font-size:clamp(8px,2.5vw,10px);color:var(--text-muted);margin-top:4px;">Vales</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:clamp(20px,6.5vw,30px);font-weight:700;color:var(--green);line-height:1;letter-spacing:-.02em;">${confirmedTotal}</div>
          <div style="font-size:clamp(8px,2.5vw,10px);color:var(--text-muted);margin-top:4px;">Confir.</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:clamp(20px,6.5vw,30px);font-weight:700;color:#F59E0B;line-height:1;letter-spacing:-.02em;">${cur.pts}</div>
          <div style="font-size:clamp(8px,2.5vw,10px);color:var(--text-muted);margin-top:4px;">Puntos ⭐</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:clamp(16px,5vw,24px);font-weight:700;color:var(--green);line-height:1;letter-spacing:-.02em;">${cur.conversion}%</div>
          <div style="font-size:clamp(8px,2.5vw,10px);color:var(--text-muted);margin-top:4px;">Conv.</div>
        </div>
      </div>
    </div>
  `;

  // v13: si hay comisión, mostrar el banner verde. Si NO hay, no mostrar nada.
  // El mensaje de "configure comisiones" confundía y rompía el diseño.
  let comHTML = '';
  if (cur.comBadge) {
    comHTML = `<div style="background:linear-gradient(135deg,#059669 0%,#047857 100%);color:#fff;border-radius:clamp(12px,4vw,16px);padding:clamp(14px,4vw,18px) clamp(16px,5vw,22px);margin-bottom:clamp(8px,2.5vw,12px);display:flex;align-items:center;justify-content:space-between;gap:12px;">
      <div>
        <div style="font-size:clamp(9px,2.8vw,11px);opacity:.9;text-transform:uppercase;letter-spacing:.5px;font-weight:600;">Comisión estimada</div>
        <div style="font-size:clamp(18px,6vw,26px);font-weight:700;margin-top:3px;">${escapeHTML(cur.comBadge)}</div>
      </div>
      <div style="font-size:clamp(22px,7vw,30px);line-height:1;flex-shrink:0;">💵</div>
    </div>`;
  }

  // Meta de puntos
  const metaHTML = `
    <div style="background:var(--surface);border-radius:clamp(12px,4vw,16px);padding:clamp(14px,4vw,18px);margin-bottom:clamp(8px,2.5vw,12px);box-shadow:0 2px 8px rgba(0,0,0,.04);">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:clamp(8px,2.5vw,12px);">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:clamp(13px,4vw,15px);">🎯</span>
          <span style="font-size:clamp(12px,3.5vw,14px);font-weight:600;color:var(--text);">Meta de puntos</span>
        </div>
        <span style="font-size:clamp(10px,3vw,12px);color:var(--text-muted);font-weight:500;">${cur.pts} / ${meta} pts</span>
      </div>
      <div style="background:var(--surface3);border-radius:20px;height:clamp(8px,2.5vw,10px);overflow:hidden;">
        <div style="width:${pctMeta}%;height:100%;background:linear-gradient(90deg,#0891B2,#0EA5E9);border-radius:20px;transition:width .6s;"></div>
      </div>
    </div>
  `;

  dash.innerHTML = heroHTML + comHTML + metaHTML;
}

function renderMyVales() {
  const c = document.getElementById('gestorMyVales');
  const hList = document.getElementById('gestorHistorialList');
  if(!c || !hList || !activeGestorId) return;
  // Asegurar que el banner de pendientes refleja el estado actual
  if (typeof _updatePendingSyncBanner === 'function') _updatePendingSyncBanner();

  // v32: comparación robusta con Number() por si gestorId viene como string
  const gid = Number(activeGestorId);
  const mine = getVales().filter(v => v && v.gestorId != null && Number(v.gestorId) === gid).reverse();
  // v37 FIX DEFENSIVO: si un vale NO tiene status definido (undefined/null),
  // asumir que es 'pending' — es el status inicial legítimo de un vale recién
  // enviado. ANTES, un vale sin status quedaba fuera de activeVales Y de
  // historyVales → desaparecía de la UI aunque estuviera en el cache.
  const activeVales = mine.filter(v => ['pending',undefined,null,'assigned','delivered','pending_payment'].includes(v.status));
  // History now separates confirmed sales from pending_payment (awaiting collection) — both "completed" deliveries
  // but pending_payment represents an outstanding balance the gestor should track.
  const historyVales = mine.filter(v => v.status === 'confirmed' && !v.hiddenFromHistory);
  const pendingPayVales = mine.filter(v => v.status === 'pending_payment' && !v.hiddenFromHistory);
  const historyCount = historyVales.length + pendingPayVales.length;

  // Render the dashboard (period-filtered summary at the top of the section)
  renderGestorDashboard();

  const sMap={
    pending:{label:'Enviado · admin pendiente',color:'var(--blue)',icon:'🔵'},
    assigned:{label:'Con mensajero',color:'var(--orange)',icon:'🛵'},
    delivered:{label:'Entregado',color:'#7C3AED',icon:'📦'},
    confirmed:{label:'Venta confirmada ✅',color:'var(--green)',icon:'✅'},
    pending_payment:{label:'Pendiente de cobro',color:'var(--yellow)',icon:'⏳'},
  };
  // Override "pending" label when the vale aún no se ha confirmado en Firebase.
  // El label PRINCIPAL cambia a "Subiendo..." (amarillo) en vez del badge chiquito
  // al lado, para que el gestor no crea que el admin ya recibió el vale cuando
  // en realidad sigue en cola o subiéndose.
  const pendingSyncing={label:'Subiendo...',color:'var(--yellow)',icon:'⏳'};
  // Override "pending" label when the admin has already seen the vale
  const pendingSeen={label:'Visto por admin 👁️',color:'#0EA5E9',icon:'👁️'};

  // 1. ACTIVE VALES
  if(!activeVales.length){
    c.innerHTML='<div class="es"><div class="es-icon">🧾</div><div class="es-text">Sin vales activos</div></div>';
  } else {
    c.innerHTML=activeVales.map(v=>{
      let s=sMap[v.status]||sMap['pending'];  // v37: si status es undefined, usar 'pending'
      // Si el vale aún no se ha confirmado en Firebase, mostrar "Subiendo..." como label principal
      if(v.synced === false) s=pendingSyncing;
      // Show "Visto por admin" status when the admin has already opened this pending vale
      else if((v.status==='pending'||v.status==null) && v.seenByAdmin) s=pendingSeen;
      const pts=(v.valeProductos||[]).reduce((sum,p)=>{const pr=productoOf(p.id);return sum+(pr?pr.puntos*p.qty:0);},0);
      const canCancel=v.status==='pending';
      return `<div class="mv-card st-${v.status}">
        <div class="mv-head">
          <span class="mv-time">${valeNumStr(v)?`<b style="color:var(--blue);">${valeNumStr(v)}</b> `:``}${timeStr(v.ts)}</span>
          <div style="display:flex;align-items:center;gap:6px;">
            ${pts>0?`<span style="font-size:10px;color:var(--blue);font-weight:700;">⭐ ${pts} pts</span>`:``}
            ${canCancel?`<button type="button" onclick="cancelVale(${v.id})" style="background:rgba(239,68,68,.12);border:none;color:var(--red);border-radius:6px;padding:2px 8px;font-size:11px;font-weight:700;cursor:pointer;" title="Cancelar vale">✕ Cancelar</button>`:``}
          </div>
        </div>
        <div class="mv-info">${escapeHTML(v.cliente||'—')} · ${escapeHTML(v.articulo||'—')}</div>
        <div class="mv-foot">
          <span class="mv-status" style="color:${s.color}">${s.icon} ${s.label}</span>
          ${v.synced === false ? `<span class="mv-pending-sync-badge" title="Aún no se ha subido a la nube">📡 Pendiente sync</span>` : ``}
        </div>
      </div>`;
    }).join('');
  }

  // 2. HISTORY VALES (in collapsible) — combines confirmed + pending_payment (with separator)
  const countEl=document.getElementById('gestorHistCount');
  const clearBtn=document.getElementById('gestorHistClearBtn');
  if(countEl) countEl.textContent=historyCount||'0';
  if(clearBtn) clearBtn.style.display=historyCount?'block':'none';
  if(!historyCount){
    hList.innerHTML='<div class="es"><div class="es-text">Sin historial</div></div>';
  } else {
    let histHTML='';
    // Render pending_payment first (action needed) — highlighted
    if(pendingPayVales.length){
      histHTML+=`<div style="font-size:10px;font-weight:700;color:var(--yellow);text-transform:uppercase;letter-spacing:.5px;padding:6px 4px 4px;">⏳ Pendiente de cobro (${pendingPayVales.length})</div>`;
      histHTML+=pendingPayVales.map(v=>{
        const s=sMap[v.status]||{label:v.status,color:'var(--yellow)',icon:'⏳'};
        return `<div class="mv-card st-pending_payment" onclick="openGestorValeModal(${v.id})" style="cursor:pointer; border-left: 3px solid var(--yellow);">
          <div class="mv-head">
            <span class="mv-time" style="color:var(--gray-600);"><b style="color:var(--gray-800);">${valeNumStr(v)}</b> · ${new Date(v.ts).toLocaleDateString('es-ES')} ${timeStr(v.ts)}</span>
          </div>
          <div class="mv-info" style="color:var(--text);font-weight:600;">${escapeHTML(v.cliente||'—')}</div>
          <div class="mv-info" style="font-size:11px;color:var(--text-muted);">${escapeHTML(v.articulo||'—')}</div>
          <div class="mv-foot" style="margin-top:6px;"><span class="mv-status" style="color:${s.color};font-size:10px;">${s.icon} ${s.label}</span></div>
        </div>`;
      }).join('');
    }
    // Then confirmed sales
    if(historyVales.length){
      histHTML+=`<div style="font-size:10px;font-weight:700;color:var(--green);text-transform:uppercase;letter-spacing:.5px;padding:6px 4px 4px;${pendingPayVales.length?'margin-top:10px;':''}">✅ Ventas confirmadas (${historyVales.length})</div>`;
      histHTML+=historyVales.map(v=>{
        const s=sMap[v.status]||{label:v.status,color:'var(--green)',icon:'✅'};
        return `<div class="mv-card st-${v.status}" onclick="openGestorValeModal(${v.id})" style="cursor:pointer; opacity:0.85; border-left: 3px solid var(--gray-300);">
          <div class="mv-head">
            <span class="mv-time" style="color:var(--gray-600);"><b style="color:var(--gray-800);">${valeNumStr(v)}</b> · ${new Date(v.ts).toLocaleDateString('es-ES')} ${timeStr(v.ts)}</span>
          </div>
          <div class="mv-info" style="color:var(--text);font-weight:600;">${escapeHTML(v.cliente||'—')}</div>
          <div class="mv-info" style="font-size:11px;color:var(--text-muted);">${escapeHTML(v.articulo||'—')}</div>
          <div class="mv-foot" style="margin-top:6px;"><span class="mv-status" style="color:${s.color};font-size:10px;">${s.icon} ${s.label}</span></div>
        </div>`;
      }).join('');
    }
    hList.innerHTML=histHTML;
  }
}
// ══════════════════════════════════════════
//  GESTOR COMMISSION VIEW (outside admin)
// ══════════════════════════════════════════
function renderGestorComisiones() {
  const section=document.getElementById('gestorComisionSection');
  const list=document.getElementById('gestorComisionList');
  if(!section||!list||!activeGestorId){if(section)section.style.display='none';return;}
  // Get confirmed/pending_payment vales for this gestor
  const mine=getVales().filter(v=>Number(v.gestorId)===Number(activeGestorId)&&['confirmed','pending_payment'].includes(v.status));
  // Solo pendientes (NO en sobre ni cobrado) — fuera del gestor solo se muestra "Pendiente"
  const pendientes=mine.filter(v=>!v.commissionPaid&&v.commissionStatus!=='en_sobre'&&v.commissionStatus!=='cobrado');
  const enSobre=mine.filter(v=>v.commissionStatus==='en_sobre');
  const cobrados=mine.filter(v=>v.commissionPaid||v.commissionStatus==='cobrado');
  if(!pendientes.length&&!enSobre.length&&!cobrados.length){section.style.display='none';return;}
  section.style.display='block';

  // v4 OPTIMIZADO MÓVIL: íconos más pequeños, padding reducido, texto con clamp()
  let html = '<div style="background:var(--surface);border:1px solid var(--border);border-radius:clamp(10px,3.5vw,14px);overflow:hidden;margin-top:10px;">';

  if(pendientes.length){
    const s=sumCommissions(pendientes);
    const badge=fmtComisionBadge(s.usd,s.mn,s.computed);
    html += `<div style="padding:clamp(10px,3.5vw,14px) clamp(12px,4vw,16px);display:flex;align-items:center;justify-content:space-between;gap:8px;border-bottom:1px solid var(--border);">
      <div style="display:flex;align-items:center;gap:clamp(8px,2.5vw,10px);min-width:0;flex:1;">
        <div style="width:clamp(30px,9vw,36px);height:clamp(30px,9vw,36px);border-radius:clamp(8px,2.5vw,10px);display:flex;align-items:center;justify-content:center;font-size:clamp(15px,4.5vw,18px);background:rgba(249,115,22,.12);flex-shrink:0;">⏳</div>
        <div style="display:flex;flex-direction:column;min-width:0;">
          <span style="font-size:clamp(12px,3.5vw,13px);font-weight:700;color:var(--orange);">Pendiente</span>
          <span style="font-size:clamp(9px,2.8vw,10px);color:var(--text-muted);">${pendientes.length} comisión${pendientes.length!==1?'es':''} · se acumulan</span>
        </div>
      </div>
      <div style="font-size:clamp(12px,3.8vw,14px);font-weight:800;color:var(--green);white-space:nowrap;flex-shrink:0;">${badge||'—'}</div>
    </div>`;
  }

  if(enSobre.length){
    html += `<div style="padding:clamp(10px,3.5vw,14px) clamp(12px,4vw,16px);display:flex;align-items:center;justify-content:space-between;gap:8px;border-bottom:1px solid var(--border);">
      <div style="display:flex;align-items:center;gap:clamp(8px,2.5vw,10px);min-width:0;flex:1;">
        <div style="width:clamp(30px,9vw,36px);height:clamp(30px,9vw,36px);border-radius:clamp(8px,2.5vw,10px);display:flex;align-items:center;justify-content:center;font-size:clamp(15px,4.5vw,18px);background:rgba(245,158,11,.12);flex-shrink:0;">✉️</div>
        <div style="display:flex;flex-direction:column;min-width:0;">
          <span style="font-size:clamp(12px,3.5vw,13px);font-weight:700;color:var(--yellow);">En sobre</span>
          <span style="font-size:clamp(9px,2.8vw,10px);color:var(--text-muted);">${enSobre.length} comisión${enSobre.length!==1?'es':''} · pend. entrega</span>
        </div>
      </div>
      <div style="font-size:clamp(10px,3vw,11px);color:var(--text-muted);flex-shrink:0;">—</div>
    </div>`;
  }

  if(cobrados.length){
    html += `<div style="padding:clamp(10px,3.5vw,14px) clamp(12px,4vw,16px);display:flex;align-items:center;justify-content:space-between;gap:8px;">
      <div style="display:flex;align-items:center;gap:clamp(8px,2.5vw,10px);min-width:0;flex:1;">
        <div style="width:clamp(30px,9vw,36px);height:clamp(30px,9vw,36px);border-radius:clamp(8px,2.5vw,10px);display:flex;align-items:center;justify-content:center;font-size:clamp(15px,4.5vw,18px);background:rgba(16,185,129,.12);flex-shrink:0;">✅</div>
        <div style="display:flex;flex-direction:column;min-width:0;">
          <span style="font-size:clamp(12px,3.5vw,13px);font-weight:700;color:var(--green);">Cobrados</span>
          <span style="font-size:clamp(9px,2.8vw,10px);color:var(--text-muted);">${cobrados.length} comisión${cobrados.length!==1?'es':''} · completado</span>
        </div>
      </div>
      <div style="font-size:clamp(10px,3vw,11px);color:var(--text-muted);flex-shrink:0;">✓</div>
    </div>`;
  }

  html += '</div>';
  list.innerHTML=html;
}
let _gestorHistOpen=false;
function toggleGestorHistorial(){
  _gestorHistOpen=!_gestorHistOpen;
  const hList=document.getElementById('gestorHistorialList');
  const arrow=document.getElementById('gestorHistArrow');
  const clearBtn=document.getElementById('gestorHistClearBtn');
  if(hList) hList.style.display=_gestorHistOpen?'block':'none';
  if(arrow) arrow.textContent=_gestorHistOpen?'▲':'▼';
  if(clearBtn&&_gestorHistOpen){const hv=getVales().filter(v=>Number(v.gestorId)===Number(activeGestorId)&&v.status==='confirmed'&&!v.hiddenFromHistory);clearBtn.style.display=hv.length?'block':'none';}
}
function clearGestorHistory(){
  const confirmed=getVales().filter(v=>Number(v.gestorId)===Number(activeGestorId)&&v.status==='confirmed'&&!v.hiddenFromHistory);
  if(!confirmed.length){showToast('No hay historial para ocultar');return;}
  showConfirmAction('¿Ocultar historial?',`Se ocultarán ${confirmed.length} vales completados de tu vista. <b>Los datos NO se borran</b> — el admin sigue viéndolos en estadísticas e historial. Esta acción es reversible desde el panel admin.`,'Ocultar','btn-red',()=>{
    // Mark vales as hidden for this gestor — do NOT delete
    confirmed.forEach(v=>patchVale(v.id,{hiddenFromHistory:true,hiddenTs:new Date().toISOString()}));
    maybeAutoSync();
    _gestorHistOpen=false;toggleGestorHistorial();toggleGestorHistorial();
    renderMyVales();showToast('Historial oculto (no borrado) ✅');
  });
}

function openGestorValeModal(id) {
  const v = getVales().find(x=>x.id===id); if(!v) return;
  const sMap={
    delivered:{label:'Entregado',color:'#7C3AED',icon:'📦'},
    confirmed:{label:'Venta confirmada ✅',color:'var(--green)',icon:'✅'}
  };
  const s = sMap[v.status]||{label:v.status,color:'var(--gray-400)',icon:'•'};
  const content = `
    <div style="font-size:16px;font-weight:800;color:var(--blue-dk);margin-bottom:12px;">${valeNumStr(v)} ${escapeHTML(v.cliente)}</div>
    <div style="margin-bottom:6px;"><b>📱 Teléfono:</b> ${escapeHTML(v.telefono||'—')}</div>
    <div style="margin-bottom:6px;"><b>📍 Dirección:</b> ${escapeHTML(v.direccion||'—')}</div>
    <div style="margin-bottom:6px;"><b>📦 Artículo:</b> ${escapeHTML(v.articulo||'—')}</div>
    <div style="margin-bottom:6px;"><b>💰 Total:</b> ${escapeHTML(v.total||'—')}</div>
    <div style="margin-bottom:12px;"><b>⚙️ Garantía:</b> ${escapeHTML(v.garantia||'—')}</div>
    <div style="padding:10px;background:var(--surface2);border-radius:8px;border:1px solid var(--border);font-weight:700;color:${s.color};text-align:center;">
      ${s.icon} ${s.label}
    </div>
  `;
  document.getElementById('gestorValeModalContent').innerHTML = content;
  document.getElementById('gestorValeModal').classList.add('show');
}

function cancelVale(id) {
  const v=getVales().find(x=>x.id===id);
  if(!v||v.status!=='pending'){showToast('No se puede cancelar este vale');return;}
  showConfirmAction('¿Cancelar este vale?',`${v.cliente||''} · ${v.articulo||''}`,'Sí, cancelar','btn-red',()=>{
    // Marcar como 'cancelled' en vez de borrar. Así:
    //  - El gestor puede ver en su historial que se canceló (no desaparece sin explicación)
    //  - Las estadísticas de conversión son correctas (cancelled cuenta en el denominador)
    //  - El admin puede auditar cancelaciones
    // Ver AUDITORIA-AXONTECH.md MEDIO 18.
    patchVale(id,{status:'cancelled',cancelledTs:new Date().toISOString()});
    _logAudit('vale_cancelled', 'vale:' + id);
    if(selectedValeId===id)selectedValeId=null;
    showToast('Vale cancelado');
    renderAdminGestores();renderValeDetail();renderMyVales();maybeAutoSync();
  });
}

function adminDeleteVale(id) {
  const v=getVales().find(x=>x.id===id);if(!v)return;
  // Un vale en 'pending_payment' o con stockDecremented ya tiene el stock descontado.
  // Borrarlo directo dejaría el inventario descuadrado permanentemente. Hay que
  // revertirlo primero para devolver el stock. Ver AUDITORIA-AXONTECH.md ALTO 9.
  if(v.status==='confirmed'||v.status==='pending_payment'||v.stockDecremented){
    showToast('Revierte la venta primero (para devolver el stock)');
    return;
  }
  showConfirmAction('¿Eliminar este vale?',`${v.cliente||''} · ${v.articulo||''}`,'Eliminar','btn-red',()=>{
    // saveVales already enqueues a 'set' on the vales node — no need for separate fbRemoveVale
    saveVales(getVales().filter(x=>x.id!==id));
    _logAudit('vale_deleted', 'vale:' + id);
    if(selectedValeId===id)selectedValeId=null;
    showToast('Vale eliminado');
    renderAdminGestores();renderValeDetail();renderMyVales();maybeAutoSync();
  });
}

// ══════════════════════════════════════════
//  VALE FORM
// ══════════════════════════════════════════
const REQUIRED=['vf-cliente','vf-telefono','vf-direccion','vf-articulo','vf-total'];
const fVal = id => (document.getElementById(id)?.value||'').trim();

function calcAutoTotal() {
  const pUSD = document.getElementById('vf-precioUSD')?.value || '';
  const pMN = document.getElementById('vf-precioMN')?.value || '';
  const mens = document.getElementById('vf-mensajeria')?.value || '';
  
  let usdTotal = 0;
  let mnTotal = 0;
  
  const addVal = (str) => {
    const s = str.toUpperCase();
    const num = parsePrecioNum(s);
    if(num === 0) return;
    if(s.includes('MN') || s.includes('CUP')) mnTotal += num;
    else if(s.includes('USD') || s.includes('ZELLE')) usdTotal += num;
    else if(s.includes('$')) usdTotal += num;
    else {
      if(num > 500) mnTotal += num;
      else usdTotal += num;
    }
  };
  
  addVal(pUSD);
  addVal(pMN);
  addVal(mens);
  
  let out = [];
  if(usdTotal > 0) out.push(`$${usdTotal} USD`);
  if(mnTotal > 0) out.push(`${mnTotal} MN`);
  
  const totalInput = document.getElementById('vf-total');
  if(out.length > 0 && totalInput) {
    totalInput.value = out.join(' + ');
  } else if (totalInput && !pUSD && !pMN && !mens) {
    totalInput.value = '';
  }
}

function onFormInput() {
  // Debounce: avoid rebuilding the vale preview on every keystroke (perf on mobile)
  clearTimeout(onFormInput._t);
  onFormInput._t = setTimeout(_onFormInputImmediate, 180);
}
function _onFormInputImmediate() {
  const activeId = document.activeElement?.id;
  if(['vf-mensajeria', 'vf-precioUSD', 'vf-precioMN'].includes(activeId)) {
    calcAutoTotal();
  }
  const allFilled=!!activeGestorId&&REQUIRED.every(id=>fVal(id).length>0);
  const btn=document.getElementById('sendValeBtn');if(btn)btn.disabled=!allFilled;
  const anyFilled=REQUIRED.some(id=>fVal(id).length>0)||['vf-mensajeria','vf-precioUSD','vf-precioMN','vf-vuelto','vf-garantia'].some(id=>fVal(id).length>0);
  const pc=document.getElementById('previewCard');
  if(pc){
    if(activeGestorId&&anyFilled){pc.style.display='block';document.getElementById('valePreviewText').textContent=buildValeText();}
    else pc.style.display='none';
  }
}
function buildValeText() {
  const g=gestorOf(activeGestorId);
  const prodLines=currentValeProductos.length
    ? currentValeProductos.map(p=>`  ×${p.qty} ${p.name}`).join('\n')
    : fVal('vf-articulo');
  return ['Bienvenido a "AXONTECH" 🔥','','VALE DEL GESTOR:','',
    `🔸Promotor: ${g?g.name:''}`, '',
    `🔸 Nombre Cliente: ${fVal('vf-cliente')}`,
    `🔸Teléfono Cliente: ${fVal('vf-telefono')}`,
    `🔸Dirección Cliente: ${fVal('vf-direccion')}`,
    `🔸Mensajería/ costo: ${fVal('vf-mensajeria')}`,
    `🔸 Artículos y cantidades:`,prodLines,
    `🔸Precio USD/ zelle: ${fVal('vf-precioUSD')}`,
    `🔸Precio MN: ${fVal('vf-precioMN')}`,
    `🔸 Vuelto: ${fVal('vf-vuelto')}`,
    `🔸 Total a pagar: ${fVal('vf-total')}`, '',
    `*Garantía: ${fVal('vf-garantia')}`,
    `*Fecha y hora de Venta: ${fVal('vf-fecha')||nowDateTime()}`, '',
    '🧭Dirección de la tienda:','* Amistad #311 % San Rafael y San José, Centro Habana.','',
    '🚨ATENCIÓN🚨','•   Horarios de atención al cliente:','    9:00am - 7:00pm.',
    '* Solo aceptamos hasta cinco billetes de 1 USD por compra.',
    '* Los pagos en MN deben ser con denominación de 50 en adelante.',
    '* Solo se aceptan billetes en buen estado (ni rotos ni manchados)'].join('\n');
}

// ── Regenera valeText a partir de un vale existente (no del form) ──
// v14: NO enviamos valeText a Firebase (~300-500 bytes por vale).
// En su lugar, lo regeneramos al leer el vale desde Firebase.
// Esto reduce el payload de cada write en redes muy lentas.
// Para vales viejos que SÍ tienen valeText en Firebase, se respeta ese valor.
function regenerateValeText(v) {
  if (!v) return '';
  // Si ya tiene valeText (vale viejo o generado por buildValeText al enviar), usarlo.
  if (v.valeText) return v.valeText;
  const g = gestorOf(v.gestorId);
  const prodLines = (v.valeProductos && v.valeProductos.length)
    ? v.valeProductos.map(p => `  ×${p.qty} ${p.name || (productoOf(p.id) ? productoOf(p.id).name : 'Producto ' + p.id)}`).join('\n')
    : (v.articulo || '');
  const ts = v.ts ? new Date(v.ts).toLocaleString('es-ES') : nowDateTime();
  return ['Bienvenido a "AXONTECH" 🔥','','VALE DEL GESTOR:','',
    `🔸Promotor: ${g?g.name:''}`, '',
    `🔸 Nombre Cliente: ${v.cliente||''}`,
    `🔸Teléfono Cliente: ${v.telefono||''}`,
    `🔸Dirección Cliente: ${v.direccion||''}`,
    `🔸Mensajería/ costo: ${v.mensajeria||''}`,
    `🔸 Artículos y cantidades:`,prodLines,
    `🔸Precio USD/ zelle: ${v.precioUSD||''}`,
    `🔸Precio MN: ${v.precioMN||''}`,
    `🔸 Vuelto: ${v.vuelto||''}`,
    `🔸 Total a pagar: ${v.total||''}`, '',
    `*Garantía: ${v.garantia||''}`,
    `*Fecha y hora de Venta: ${ts}`, '',
    '🧭Dirección de la tienda:','* Amistad #311 % San Rafael y San José, Centro Habana.','',
    '🚨ATENCIÓN🚨','•   Horarios de atención al cliente:','    9:00am - 7:00pm.',
    '* Solo aceptamos hasta cinco billetes de 1 USD por compra.',
    '* Los pagos en MN deben ser con denominación de 50 en adelante.',
    '* Solo se aceptan billetes en buen estado (ni rotos ni manchados)'].join('\n');
}

// Bandera global: indica que el modal del ticket se abrió automáticamente tras enviar un vale.
// Si es true, al cerrar el modal (botón Cerrar, clic fuera, o Escape) se limpia el formulario.
let _ticketAfterSend = false;

function openTicketModal(afterSend) {
  const g = gestorOf(activeGestorId);
  document.getElementById('tk-gestor').textContent = g ? g.name : '';
  document.getElementById('tk-cliente').textContent = fVal('vf-cliente') || 'Sin nombre';
  document.getElementById('tk-articulo').textContent = fVal('vf-articulo') || 'Sin artículo';
  document.getElementById('tk-total').textContent = fVal('vf-total') || '—';

  // Mostrar banner verde SOLO si el modal se abre después de enviar un vale.
  const banner = document.getElementById('ticketSuccessBanner');
  if (banner) banner.style.display = afterSend ? 'block' : 'none';
  _ticketAfterSend = !!afterSend;

  document.getElementById('ticketModal').classList.add('show');
}

// Cierra el modal del ticket. Si se abrió tras enviar un vale, limpia el formulario
// automáticamente para el próximo cliente. Si se abrió manualmente con "Generar Ticket
// de Recogida", el formulario se mantiene intacto.
function closeTicketModal() {
  document.getElementById('ticketModal').classList.remove('show');
  if (_ticketAfterSend) {
    _ticketAfterSend = false;
    resetForm();
  }
}


// ── Lazy-load de html2canvas ──
// Antes: el script de html2canvas (150KB) se cargaba SIEMPRE en cada página,
// incluso si el usuario nunca exportaba una imagen de ticket. En 3G eso eran
// 1-2s extra en cada carga de la app.
// Ahora: solo se carga dinámicamente cuando el usuario pulsa "Compartir imagen".
// La primera vez tarda 1-2s en cargar, pero las cargas normales van mucho más rápido.
let _html2canvasPromise = null;
function _loadHtml2Canvas() {
  if (typeof html2canvas !== 'undefined') return Promise.resolve(html2canvas);
  if (_html2canvasPromise) return _html2canvasPromise;
  _html2canvasPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
    s.onload = () => resolve(html2canvas);
    s.onerror = () => { _html2canvasPromise = null; reject(new Error('No se pudo cargar html2canvas')); };
    document.head.appendChild(s);
  });
  return _html2canvasPromise;
}

async function shareTicketImage() {
  const ticketEl = document.getElementById('ticketVisual');
  showToast('Generando imagen...');
  let html2canvasFn;
  try {
    html2canvasFn = await _loadHtml2Canvas();
  } catch(e) {
    showToast('No se pudo cargar el creador de imágenes. Verifica tu conexión.');
    return;
  }
  // Si después de cargar sigue undefined, algo falló.
  if (typeof html2canvasFn === 'undefined') {
    showToast('No se pudo cargar el creador de imágenes.');
    return;
  }

  try {
    const canvas = await html2canvasFn(ticketEl, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
    canvas.toBlob(async (blob) => {
      const file = new File([blob], 'ticket_axontech.png', { type: 'image/png' });
      
      // Check if mobile sharing is supported
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            title: 'Ticket de Recogida',
            text: 'Muestra esta imagen al llegar a la tienda.',
            files: [file]
          });
        } catch(e) {
          // If user cancels or it fails, fallback to download
          if(e.name !== 'AbortError') {
             downloadBlob(blob, 'ticket_axontech.png');
          }
        }
      } else {
        // Fallback for PC or unsupported browsers
        downloadBlob(blob, 'ticket_axontech.png');
        showToast('Imagen descargada ✓');
      }
    }, 'image/png');
  } catch (e) {
    console.error(e);
    showToast('Error al generar la imagen');
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function copyTicketText() {
  const g = gestorOf(activeGestorId);
  const prodLines=currentValeProductos.length
    ? currentValeProductos.map(p=>`  ×${p.qty} ${p.name}`).join('\n')
    : (fVal('vf-articulo') || 'Sin artículo');
  const text = `🏪 *TICKET DE RECOGIDA - AXONTECH* 🏪
-----------------------------------
👤 *Atendido por:* ${g ? g.name : ''}
👤 *Cliente:* ${fVal('vf-cliente') || 'Sin nombre'}
📦 *Artículos:*
${prodLines}
💰 *Total a pagar:* ${fVal('vf-total') || '—'}
-----------------------------------
📍 *Dirección de Tienda:*
Amistad #311 % San Rafael y San José, Centro Habana.

⚠️ *Importante:* Por favor, muestre este mensaje en el mostrador al llegar a la tienda para que le entreguen su pedido rápidamente y se le asigne la venta a su promotor.`;

  navigator.clipboard.writeText(text).then(() => showToast('¡Texto del Ticket copiado! ✓')).catch(() => showToast('Error al copiar'));
}

function copyValePreview() {
  navigator.clipboard.writeText(document.getElementById('valePreviewText').textContent)
    .then(()=>showToast('Vale copiado ✓')).catch(()=>showToast('No se pudo copiar'));
}
function shareToAdminWA() {
  const text=buildValeText();const cfg=getConfig();const phone=cfg.adminPhone||'';
  const url=phone?`https://wa.me/${phone}?text=${encodeURIComponent(text)}`:`https://wa.me/?text=${encodeURIComponent(text)}`;
  window.open(url,'_blank');
}
function saveAdminPhone() {
  const phone=document.getElementById('adminPhoneInput').value.trim();
  const cfg=getConfig();cfg.adminPhone=phone;saveConfig(cfg);showToast('Número guardado ✓');
}
function saveCatalogPhone() {
  const phone=document.getElementById('catalogPhoneInput').value.trim();
  const cfg=getConfig();cfg.catalogPhone=phone;saveConfig(cfg);showToast('Número catálogo guardado ✓');
  triggerAutoPublishCatalog();
}
function resetForm() {
  ['vf-cliente','vf-telefono','vf-direccion','vf-carnet','vf-mensajeria','vf-articulo',
   'vf-precioUSD','vf-precioMN','vf-vuelto','vf-total','vf-garantia','vf-comisionGestor'].forEach(id=>{
     const el=document.getElementById(id);if(el)el.value='';
   });
  currentValeProductos=[];selectedProductsUI=[];
  renderSelectedProductsUI();
  
  const btn=document.getElementById('sendValeBtn');
  if(btn) {
    btn.disabled=true;
    btn.textContent='📤 Enviar';
    btn.classList.replace('btn-green', 'btn-blue');
  }
  document.getElementById('previewCard').style.display='none';
  showToast('Formulario limpio ✨');
}

// ══════════════════════════════════════════
//  SEND VALE
// ══════════════════════════════════════════
let _isSendingVale = false;
function sendVale() {
  if(_isSendingVale) return; // Prevent double submission
  if(!activeGestorId){showToast('Selecciona tu nombre primero');return;}
  if(getConfig().maintenanceMode){showToast('🚧 Sistema en mantenimiento — intenta de nuevo en unos minutos');return;}
  if(REQUIRED.some(id=>!fVal(id))){showToast('Completa los campos obligatorios (*)');return;}
  _isSendingVale = true;
  const btn=document.getElementById('sendValeBtn');
  if(btn){btn.disabled=true;btn.textContent='Enviando...';}

  // ── 1. Construir el vale y guardarlo LOCALMENTE (síncrono, ~1ms) ──
  // Esto ya deja el vale persistido en localStorage y encola la escritura a Firebase.
  // El usuario NO necesita esperar a que Firebase responda para ver el feedback.
  // `synced:false` indica que el vale aún no se ha confirmado en Firebase; el banner
  // de pendientes lo mostrará hasta que el write se complete.
  const g=gestorOf(activeGestorId);
  const vale={
    id:Date.now(),valeNum:getNextValeNum(),gestorId:activeGestorId,ts:new Date().toISOString(),
    cliente:fVal('vf-cliente'),telefono:fVal('vf-telefono'),direccion:fVal('vf-direccion'),carnet:fVal('vf-carnet'),
    mensajeria:fVal('vf-mensajeria'),articulo:fVal('vf-articulo'),
    precioUSD:fVal('vf-precioUSD'),precioMN:fVal('vf-precioMN'),
    vuelto:fVal('vf-vuelto'),total:fVal('vf-total'),garantia:fVal('vf-garantia'),comisionGestor:fVal('vf-comisionGestor'),
    valeProductos:currentValeProductos,valeText:buildValeText(),
    status:'pending',mensajeroId:null,confirmedTs:null,isNew:true,adminNotes:'',
    synced:false, // se marcará true cuando Firebase confirme el write
  };
  // BUGFIX CRÍTICO: getVales() devuelve la MISMA referencia en memoria que
  // _valesCache (no una copia). Hacer getVales().push(vale) mutaba
  // _valesCache DIRECTAMENTE antes de llamar a saveVales() — así que dentro
  // de saveVales(), "prevVales = _valesCache" ya incluía el vale nuevo
  // (prevVales y v eran literalmente el mismo array). El diff contra "lo
  // anterior" comparaba el vale contra SÍ MISMO, veía "sin cambios", y
  // nunca llamaba a _enqueueFB — el vale se guardaba local pero JAMÁS se
  // encolaba el write a Firestore. Esto explica el patrón reportado
  // "el vale sale pero la subida se queda pegada": no era un problema de
  // red ni de Firestore, el write ni siquiera se intentaba. Se reproduce
  // siempre que _valesCache ya esté "tibio" (getVales() ya se llamó antes
  // en la sesión, lo normal), que es el caso típico. Fix: construir un
  // array NUEVO (spread) en vez de mutar el que devuelve getVales().
  const all=[...getVales(), vale];saveVales(all);
  _logAudit('vale_sent', 'vale:' + vale.id + ' gestor:' + activeGestorId);

  // ── v15: Registrar Background Sync para que el SW reintente si la página
  // se cierra antes de que el write se confirme. Esto NO reemplaza el retry
  // normal de la página — es un fallback para el caso en que el gestor
  // cierre la app mientras el write está encolado.
  // Safari iOS NO soporta Background Sync → la página sigue haciendo su
  // propio retry con setInterval + visibilitychange + online event.
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.ready.then(reg => {
      if (reg.sync && 'register' in reg.sync) {
        try { reg.sync.register('vales-sync'); } catch(_) {}
      }
    }).catch(()=>{});
  }

  // ── 2. Feedback INMEDIATO al usuario (antes de los renders pesados) ──
  // El toast y el ticket aparecen al instante, sin esperar a que se re-renderice
  // toda la lista de vales, comisiones, ranking, etc.
  // El mensaje depende del estado de la conexión para no engañar al gestor:
  // v14: Simplificado para conexiones muy lentas. El usuario NO necesita saber
  // si el write está en progreso o encolado — solo necesita confirmación de que
  // su vale está guardado y eventualmente llegará al admin.
  //  - Si NO hay conexión o Firebase no responde → "Vale guardado ✓ · Se enviará cuando mejore la conexión"
  //  - Si hay conexión y la cola está vacía → "Vale guardado ✓ · Enviando al administrador"
  //  - Si hay conexión pero hay writes pendientes (red lenta) → "Vale guardado ✓ · Enviando al administrador"
  playSound('vale');
  if (!_onlineStatus || !_fbConnected) {
    showToast('✓ Vale guardado · Se enviará cuando mejore la conexión');
  } else {
    showToast('✓ Vale guardado · Enviando al administrador');
  }
  _updatePendingSyncBanner();
  // v17: arrancar el poll de cola (iOS Safari fallback).
  _startPollIfPending();
  openTicketModal(true);

  // ── 3. Restaurar el botón a su estado normal INMEDIATAMENTE ──
  // Como NO se limpia el form, los campos siguen llenos. El botón se queda
  // deshabilitado hasta que el usuario modifique algún campo obligatorio
  // (para evitar enviar el MISMO vale dos veces por accidente).
  if(btn){
    btn.textContent = '📤 Enviar';
    btn.classList.replace('btn-green', 'btn-blue');
    btn.disabled = true; // se rehabilita con _onFormInputImmediate() al modificar un campo
  }

  // ── 4. Liberar el candado de envío ──
  _isSendingVale = false;

  // ── 5. Diferir los renders pesados con setTimeout(0) ──
  // Así el navegador puede pintar el toast y abrir el ticket SIN esperar a que
  // terminen renderGestores + renderMyVales + renderGestorComisiones, que pueden
  // tardar 200-800ms si el gestor tiene muchos vales en el historial.
  setTimeout(() => {
    try {
      renderGestores();
      renderMyVales();
      renderGestorComisiones();
      updateAdminBadge();

      if(adminActive){
        const _nbt=document.getElementById('notifBannerText'); if(_nbt)_nbt.textContent=`${g?g.name:'Un gestor'} acaba de enviar un vale`;
        const _nb=document.getElementById('notifBanner'); if(_nb)_nb.classList.add('show');
        renderAdminGestores();
        // Check estafa blacklist when admin is active
        const estafaMatches = checkEstafaMatch(vale);
        if(estafaMatches.length) showEstafaAlert(vale, estafaMatches);
      }

      // g puede ser undefined si el admin borró a este gestor del listado justo mientras
      // tenía el formulario abierto en otro dispositivo — el vale ya se guardó arriba,
      // así que de aquí en más solo evitamos que un g.name sin proteger crashee.
      sendBrowserNotif('AXONTECH – Nuevo vale',`${g?g.name:'Gestor'} envió un vale para ${vale.cliente}`);
    } catch(e) {
      console.error('sendVale deferred render error:', e);
    }
  }, 0);
}
// ══════════════════════════════════════════
//  PRODUCT PICKER (gestor)
// ══════════════════════════════════════════
function openProductPicker() {
  if(!getProductos().length){showToast('El admin aún no ha cargado productos');return;}
  pickerSelected={};
  selectedProductsUI.forEach(p=>{pickerSelected[p.id]=p.qty;});
  pickerCatFilter=null;
  document.getElementById('pickerSearch').value='';
  renderPickerCatTabs();renderPickerProducts();renderPickerSelected();
  document.getElementById('productPickerModal').classList.add('show');
}
function closeProductPicker(){document.getElementById('productPickerModal').classList.remove('show');}
function renderPickerCatTabs() {
  const cats=getCategorias();
  document.getElementById('pickerCatTabs').innerHTML=
    `<button class="pcat-tab ${pickerCatFilter===null?'active':''}" onclick="setPickerCat(null)">Todos</button>`+
    cats.map(c=>`<button class="pcat-tab ${pickerCatFilter===c.id?'active':''}" onclick="setPickerCat(${c.id})">${escapeHTML(c.name)}</button>`).join('');
}
function setPickerCat(id){pickerCatFilter=id;renderPickerCatTabs();renderPickerProducts();}
function renderPickerProducts() {
  const search=document.getElementById('pickerSearch').value.toLowerCase();
  let prods=getProductos();
  if(pickerCatFilter!==null)prods=prods.filter(p=>p.catId===pickerCatFilter);
  if(search)prods=prods.filter(p=>p.name.toLowerCase().includes(search)||(p.description||'').toLowerCase().includes(search));
  // Sort: disponibles primero, totalmente reservados y agotados al final
  prods.sort((a,b)=>{
    const aBlocked=(a.stock||0)===0||_isFullyReserved(a)?1:0;
    const bBlocked=(b.stock||0)===0||_isFullyReserved(b)?1:0;
    return aBlocked-bBlocked;
  });
  const c=document.getElementById('pickerProductGrid');
  if(!c) return;
  if(!prods.length){c.innerHTML='<div style="width:100%;text-align:center;padding:20px;color:var(--gray-400);">Sin productos disponibles</div>';return;}
  c.innerHTML=prods.map(p=>{
    const qty=pickerSelected[p.id]||0;
    const oos=(p.stock||0)===0;
    const fullyRes=_isFullyReserved(p);
    const partRes=_isPartiallyReserved(p);
    const blocked=oos||fullyRes;
    const reserved=parseInt(p.reserved||0,10);
    const avail=_availableStock(p);
    // Badge: agotado tiene prioridad sobre reservado
    const badge = oos
      ? `<span class="oos-badge">AGOTADO</span>`
      : fullyRes
        ? `<span class="reserved-badge picker-reserved-badge">🔒 RESERVADO</span>`
        : partRes
          ? `<span class="reserved-badge picker-reserved-badge partial">🔐 Reservado ${reserved} · Disp ${avail}</span>`
          : '';
    const cls = `picker-pill ${qty>0?'selected':''} ${oos?'out-of-stock':''} ${fullyRes?'fully-reserved':''} ${partRes?'partial-reserved':''}`;
    return `<div class="${cls}" style="${blocked?'pointer-events:none;':''}" ${oos?'title="Producto agotado"':fullyRes?'title="Producto totalmente reservado"':''}>
      <div class="picker-pill-info">
        <div class="picker-pill-name">${escapeHTML(p.name)} ${badge}</div>
        ${p.precio?`<div class="picker-pill-price">${escapeHTML(p.precio)}</div>`:''}
        ${!blocked?`<div style="font-size:9px;color:var(--text-muted);">Disponibles: ${avail}</div>`:''}
      </div>
      <div class="picker-pill-qty" style="${blocked?'pointer-events:none;':''}">
        <button ${blocked?'disabled':''} onclick="pickerAdj(${p.id},-1)">−</button>
        <span>${qty}</span>
        <button ${blocked?'disabled':''} onclick="pickerAdj(${p.id},1)">+</button>
      </div>
    </div>`;
  }).join('');
}
function pickerAdj(pid,delta) {
  const prod=productoOf(pid);
  // El máximo es el stock DISPONIBLE (stock - reserved), no el stock total.
  // Así el gestor no puede exceder las unidades realmente disponibles.
  const max=prod?_availableStock(prod):0;
  const cur=pickerSelected[pid]||0;const next=Math.max(0,Math.min(max,cur+delta));
  if(next===0)delete pickerSelected[pid];else pickerSelected[pid]=next;
  renderPickerProducts();renderPickerSelected();
}
function renderPickerSelected() {
  const items=Object.entries(pickerSelected).map(([id,qty])=>({id:parseInt(id),qty}));
  const c=document.getElementById('pickerSelectedList');
  if(!c) return;
  if(!items.length){c.innerHTML='<span style="color:var(--gray-400);font-size:11px;">Ningún producto seleccionado</span>';return;}
  c.innerHTML=items.map(({id,qty})=>{
    const p=productoOf(id);
    return `<span style="background:var(--blue-lt);border:1px solid var(--blue-bd);border-radius:6px;padding:3px 8px;font-size:11px;display:inline-flex;align-items:center;gap:6px;margin:2px;">
      ${p?escapeHTML(p.name):id} × ${qty}
      <button onclick="pickerAdj(${id},-99)" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:14px;line-height:1;padding:0;">×</button>
    </span>`;
  }).join('');
}
function parsePrecioNum(str) {
  if(!str)return 0;
  // Sum ALL numbers found in the string, not just the first one
  const matches = str.replace(/,/g,'').match(/\d+(\.\d+)?/g);
  return matches ? matches.reduce((sum, m) => sum + parseFloat(m), 0) : 0;
}
function confirmPickerSelection() {
  const items=Object.entries(pickerSelected).map(([id,qty])=>{
    const p=productoOf(parseInt(id));return{id:parseInt(id),name:p?p.name:id,qty};
  });
  selectedProductsUI=items;currentValeProductos=items;
  renderSelectedProductsUI();
  document.getElementById('vf-articulo').value=items.map(i=>`×${i.qty} ${i.name}`).join(' / ');
  // auto-sum prices: separate USD and MN
  let usdTotal=0, mnTotal=0;
  items.forEach(({id,qty})=>{
    const p=productoOf(id);if(!p||!p.precio)return;
    const num=parsePrecioNum(p.precio)*qty;
    const isMN=(p.precio+'').toUpperCase().includes('MN')||(p.precio+'').toUpperCase().includes('CUP');
    if(isMN)mnTotal+=num; else usdTotal+=num;
  });
  if(usdTotal>0||mnTotal>0){
    document.getElementById('vf-precioUSD').value=usdTotal>0?`$${usdTotal} USD`:'';
    document.getElementById('vf-precioMN').value=mnTotal>0?`${Math.round(mnTotal)} MN`:'';
    calcAutoTotal();
  }
  // auto-calculate commission based on products selected
  let comUSD=0, comMN=0;
  items.forEach(({id,qty})=>{
    const p=productoOf(id);if(!p)return;
    const com=p.comision||'';
    if(!com)return;
    const isPct=com.includes('%');
    const comUpper=(com+'').toUpperCase();
    const isMNCom=comUpper.includes('MN')||comUpper.includes('CUP');
    const moneda=p.comisionMoneda||'';
    const useMN=isMNCom||moneda.toUpperCase()==='MN';
    if(isPct){
      const pct=parseFloat(com.replace(/[^0-9.]/g,''));
      const priceNum=parsePrecioNum(p.precio||'');
      if(!isNaN(pct)&&priceNum>0){
        const amt=Math.round(priceNum*(pct/100)*qty*100)/100;
        if(useMN)comMN+=amt; else comUSD+=amt;
      }
    } else {
      const num=parsePrecioNum(com)*qty;
      if(num>0){ if(useMN)comMN+=num; else comUSD+=num; }
    }
  });
  if(comUSD>0||comMN>0){
    const parts=[];
    if(comUSD>0)parts.push(`$${comUSD.toFixed(2)} USD`);
    if(comMN>0)parts.push(`${Math.round(comMN)} MN`);
    document.getElementById('vf-comisionGestor').value=parts.join(' + ');
  }
  // auto-fill garantia from first product that has one
  if(!document.getElementById('vf-garantia').value){
    const g=items.map(({id})=>productoOf(id)?.garantia).find(Boolean);
    if(g)document.getElementById('vf-garantia').value=g;
  }
  closeProductPicker();onFormInput();
}
function renderSelectedProductsUI() {
  const c=document.getElementById('selectedProductsList');
  if(!c) return;
  if(!selectedProductsUI.length){c.style.display='none';return;}
  c.style.display='block';
  c.innerHTML=`<div style="display:flex;flex-direction:column;gap:5px;margin-bottom:8px;">`+
    selectedProductsUI.map(i=>`<div style="display:flex;align-items:center;gap:8px;min-width:0;">
      <span style="font-weight:800;color:var(--blue);flex-shrink:0;font-size:13px;">×${i.qty}</span>
      <span style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">${escapeHTML(i.name)}</span>
    </div>`).join('')+
    `</div><button class="btn btn-ghost btn-sm" style="font-size:10px;padding:3px 10px;" onclick="openProductPicker()">✏️ Editar selección</button>`;
}

// ══════════════════════════════════════════
//  STOCK PANEL
// ══════════════════════════════════════════
function renderStockCategorias() {
  const cats=getCategorias();
  const prods=getProductos();
  const c=document.getElementById('categoriasList');
  if(!c) return;
  c.innerHTML=
    `<button type="button" class="pcat-tab ${stockCatFilter===null?'active':''}" onclick="setStockCat(null)" style="flex-shrink:0;">
      📦 Todos <span style="opacity:.7;">(${prods.length})</span>
    </button>`+
    cats.map(cat=>{
      const count=prods.filter(p=>p.catId===cat.id).length;
      return `<button type="button" class="pcat-tab ${stockCatFilter===cat.id?'active':''}" onclick="setStockCat(${cat.id})" style="flex-shrink:0;">${escapeHTML(cat.name)} <span style="opacity:.7;">(${count})</span></button>`;
    }).join('');
  // Render cat manager list if visible
  const mgr=document.getElementById('catManagerList');
  if(mgr){
    mgr.innerHTML=cats.length?cats.map(cat=>{
      const count=prods.filter(p=>p.catId===cat.id).length;
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 10px;background:var(--surface);border:1px solid var(--border);border-radius:8px;margin-bottom:5px;">
        <span style="font-size:12px;font-weight:600;">${escapeHTML(cat.name)} <span style="font-size:10px;color:var(--text-muted);">(${count} producto${count!==1?'s':''})</span></span>
        <button type="button" class="btn btn-sm" style="background:rgba(239,68,68,.1);color:var(--red);border:none;font-size:11px;padding:3px 9px;" onclick="removeCategoria(${cat.id})">🗑️ Borrar</button>
      </div>`;
    }).join(''):'<div style="font-size:12px;color:var(--text-muted);padding:6px 0;">Sin categorías creadas.</div>';
  }
}
let catManagerOpen=false;
function toggleCatManager(){
  catManagerOpen=!catManagerOpen;
  document.getElementById('catManagerPanel').style.display=catManagerOpen?'block':'none';
  document.getElementById('catManagerToggle').style.background=catManagerOpen?'var(--blue-lt)':'';
  document.getElementById('catManagerToggle').style.color=catManagerOpen?'var(--blue)':'';
  if(catManagerOpen)renderStockCategorias();
}
function setStockCat(id) {
  stockCatFilter=id;renderStockCategorias();renderProductGrid();
  const cats=getCategorias();const cat=cats.find(c=>c.id===id);
  document.getElementById('stockPanelTitle').textContent=id===null?'Todos los productos':cat?cat.name:'Categoría';
}
function addCategoria() {
  const inp=document.getElementById('newCatInput');const name=inp.value.trim();if(!name)return;
  const list=getCategorias();
  if(list.some(c=>c.name.toLowerCase()===name.toLowerCase())){showToast('Ya existe');return;}
  // BUGFIX: ver comentario en sendVale()/addGestor() — no mutar el array
  // que devuelve getCategorias().
  saveCategorias([...list, {id:Date.now(),name}]);inp.value='';renderStockCategorias();showToast('Categoría agregada');
}
function removeCategoria(id) {
  if(getProductos().some(p=>p.catId===id)){showToast('Primero mueve o elimina los productos de esta categoría');return;}
  showConfirmAction('¿Eliminar esta categoría?', 'Los productos quedarán sin categoría', 'Eliminar', 'btn-red', () => {
    saveCategorias(getCategorias().filter(c=>c.id!==id));
    if(stockCatFilter===id)stockCatFilter=null;
    renderStockCategorias();renderProductGrid();
    showToast('Categoría eliminada');
  });
}
function buildProdCard(p, cats, isAgotado) {
  const cat=cats.find(c=>c.id===p.catId);
  const stockOk=(p.stock||0)>0;
  const isLow=stockOk&&(p.stock||0)<=LOW_STOCK_THRESHOLD;
  const reserved=parseInt(p.reserved||0,10);
  const avail=_availableStock(p);
  const fullyReserved=_isFullyReserved(p);
  const partiallyReserved=_isPartiallyReserved(p);
  // Estado visual: agotado > totalmente reservado > parcial reservado > bajo > normal
  const stockColor=isAgotado?'var(--red)':fullyReserved?'#b45309':partiallyReserved?'#f59e0b':isLow?'var(--yellow)':'var(--green)';
  const cardCls = isAgotado ? ' agotado' : (fullyReserved ? ' fully-reserved' : (partiallyReserved ? ' partial-reserved' : ''));
  // Stock label: prioriza mostrar disponible cuando hay reserva, total cuando no
  const stockLabel = reserved > 0
    ? `Stock: ${p.stock||0} · 🔐 ${reserved} · Disp: ${avail}`
    : `Stock: ${p.stock||0}`;
  // Reserva badge
  const reservedBadge = reserved > 0
    ? `<span class="reserved-badge ${fullyReserved?'reserved-full':''}">🔐 RESERVADO ${reserved}/${p.stock||0}</span>`
    : '';
  return `<div class="prod-card${cardCls}" style="display:flex;align-items:center;gap:10px;padding:10px 12px;">
    <div style="width:52px;height:52px;border-radius:8px;overflow:hidden;background:var(--gray-100);display:flex;align-items:center;justify-content:center;flex-shrink:0;${fullyReserved?'opacity:.5;':''}">
      ${p.photo
        ?`<img src="${escapeAttr(p.photo)}" alt="" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentElement.innerHTML='<span style=font-size:22px>📦</span>'">`
        :`<span style="font-size:22px;">📦</span>`}
    </div>
    <div style="flex:1;min-width:0;">
      <div style="display:flex;align-items:baseline;gap:5px;flex-wrap:wrap;">
        <span class="prod-name" style="margin:0;font-size:13px;">${escapeHTML(p.name)}</span>
        ${cat?`<span class="prod-cat-tag" style="font-size:9px;">${escapeHTML(cat.name)}</span>`:''}
        ${reservedBadge}
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:2px;flex-wrap:wrap;">
        ${p.precio?`<span class="prod-price" style="margin:0;font-size:11px;">${escapeHTML(p.precio)}</span>`:''}
        ${p.comision?`<span style="font-size:10px;color:var(--green);font-weight:600;">💰 ${escapeHTML(p.comision)}</span>`:''}
        ${p.puntos?`<span style="font-size:10px;color:var(--blue);font-weight:600;">⭐ ${p.puntos} pts</span>`:''}
        ${p.garantia?`<span style="font-size:10px;color:var(--gray-400);">🛡️ ${escapeHTML(p.garantia)}</span>`:''}
      </div>
    </div>
    <div style="flex-shrink:0;display:flex;flex-direction:column;align-items:flex-end;gap:5px;">
      <span style="font-size:11px;font-weight:700;color:${stockColor};">${stockLabel}</span>
      <div style="display:flex;gap:4px;">
        ${isAgotado
          ? `<button class="btn btn-green btn-sm" onclick="adjustStock(${p.id})" style="font-size:10px;padding:3px 7px;">📥 Reponer</button>`
          : `<button class="btn btn-ghost btn-sm" onclick="openEditProductModal(${p.id})" style="font-size:10px;padding:3px 7px;">✏️</button>
             <button class="btn btn-ghost btn-sm" onclick="adjustStock(${p.id})" style="font-size:10px;padding:3px 7px;">📥</button>
             <button class="btn btn-ghost btn-sm" onclick="adjustReserved(${p.id})" style="font-size:10px;padding:3px 7px;color:#b45309;" title="Reservar / liberar unidades">🔐</button>`
        }
        <button class="btn btn-ghost btn-sm" style="color:var(--red);font-size:10px;padding:3px 7px;" onclick="removeProducto(${p.id})">🗑️</button>
      </div>
    </div>
  </div>`;
}

function renderProductGrid() {
  let prods=getProductos();
  if(stockCatFilter!==null)prods=prods.filter(p=>p.catId===stockCatFilter);
  const cats=getCategorias();
  const c=document.getElementById('productGrid');
  if(!c) return;
  if(!prods.length){
    c.innerHTML='<div class="es"><div class="es-icon">📦</div><div class="es-text">Sin productos. Haz clic en "+ Nuevo producto".</div></div>';return;
  }
  // 3 secciones: Disponibles, Reservados (totalmente reservados), Agotados
  const activos = prods.filter(p => (p.stock||0) > 0 && !_isFullyReserved(p));
  const reservados = prods.filter(p => (p.stock||0) > 0 && _isFullyReserved(p));
  const agotados = prods.filter(p => (p.stock||0) === 0);
  const grid = s => `<div style="display:flex;flex-direction:column;gap:8px;">${s}</div>`;
  let html='';
  if(activos.length){
    html+=`<div class="stock-section-header">Disponibles <span style="background:var(--gray-100);border-radius:20px;font-size:9px;padding:2px 7px;">${activos.length}</span></div>`;
    html+=grid(activos.map(p=>buildProdCard(p,cats,false)).join(''));
  }
  if(reservados.length){
    html+=`<div class="stock-section-header reserved-section-header">🔐 Reservados <span class="reserved-count-badge">${reservados.length}</span></div>`;
    html+=grid(reservados.map(p=>buildProdCard(p,cats,false)).join(''));
  }
  if(agotados.length){
    html+=`<div class="stock-section-header">Agotados <span class="agotado-badge">${agotados.length}</span></div>`;
    html+=grid(agotados.map(p=>buildProdCard(p,cats,true)).join(''));
  }
  c.innerHTML=html;
}

// ══════════════════════════════════════════
//  PRODUCT MODAL
// ══════════════════════════════════════════
function populateCatSelect(selectedId) {
  const cats=getCategorias();
  document.getElementById('pm-cat').innerHTML=
    `<option value="">Sin categoría</option>`+
    cats.map(c=>`<option value="${c.id}" ${c.id===selectedId?'selected':''}>${escapeHTML(c.name)}</option>`).join('');
}
function openAddProductModal() {
  editingProductId=null;
  document.getElementById('productModalTitle').textContent='📦 Nuevo Producto';
  ['pm-name','pm-desc','pm-precio','pm-foto','pm-garantia','pm-comision'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  document.getElementById('pm-comision-amount').value='';
  document.getElementById('pm-comision-currency').value='USD';
  document.getElementById('pm-stock').value='0';document.getElementById('pm-puntos').value='0';
  document.getElementById('pm-foto-file').value='';
  document.getElementById('pm-fotoPreview').innerHTML='';
  populateCatSelect(null);document.getElementById('productModal').classList.add('show');
}
function openEditProductModal(id) {
  const p=productoOf(id);if(!p)return;
  editingProductId=id;
  document.getElementById('productModalTitle').textContent='✏️ Editar Producto';
  document.getElementById('pm-name').value=p.name||'';
  document.getElementById('pm-desc').value=p.description||'';
  document.getElementById('pm-precio').value=p.precio||'';
  document.getElementById('pm-stock').value=p.stock||0;
  document.getElementById('pm-puntos').value=p.puntos||0;
  document.getElementById('pm-garantia').value=p.garantia||'';
  document.getElementById('pm-comision').value=p.comision||'';
  // Parse comision into amount + currency fields
  {const com=p.comision||'';
   const isMN=com.toUpperCase().includes('MN');
   const num=parseFloat(com.replace(/[^0-9.]/g,''))||'';
   document.getElementById('pm-comision-amount').value=num;
   document.getElementById('pm-comision-currency').value=isMN?'MN':'USD';}
  document.getElementById('pm-foto').value=p.photo||'';
  document.getElementById('pm-foto-file').value='';
  populateCatSelect(p.catId);
  document.getElementById('pm-fotoPreview').innerHTML=p.photo?`<img src="${escapeAttr(p.photo)}" style="width:100%;height:80px;object-fit:cover;border-radius:6px;" onerror="this.style.display='none'">`:'';
  document.getElementById('productModal').classList.add('show');
}
// Compress + convert image to WebP (with JPEG fallback for very old browsers).
// WebP files are ~30-50% smaller than JPEG at equivalent quality, which saves
// localStorage quota and Firebase bandwidth. The original uploaded file is
// never persisted — only the converted WebP data URL is stored.
let _webpSupported = null;
function _checkWebPSupport() {
  if (_webpSupported !== null) return _webpSupported;
  try {
    const c = document.createElement('canvas');
    c.width = 1; c.height = 1;
    _webpSupported = c.toDataURL('image/webp').startsWith('data:image/webp');
  } catch (e) {
    _webpSupported = false;
  }
  return _webpSupported;
}
function compressImage(dataUrl, maxPx, quality, cb) {
  const img = new Image();
  img.onload = () => {
    const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    // White background so transparent PNGs don't become black on JPEG fallback
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    // Try WebP first — supported in all modern browsers (Chrome 32+, Firefox 65+, Safari 14+, Edge 18+)
    const webpDataUrl = c.toDataURL('image/webp', quality);
    if (webpDataUrl && webpDataUrl.startsWith('data:image/webp')) {
      cb(webpDataUrl);
    } else {
      // Fallback to JPEG for ancient browsers
      cb(c.toDataURL('image/jpeg', quality));
    }
  };
  img.onerror = () => { cb(null); };
  img.src = dataUrl;
}

// Promise-based version of compressImage (for batch operations).
// Always returns WebP if the browser supports it; rejects if conversion fails.
function compressImageP(dataUrl, maxPx, quality) {
  return new Promise((resolve, reject) => {
    compressImage(dataUrl, maxPx, quality, out => {
      if (!out) { reject(new Error('conversion_failed')); return; }
      if (!_checkWebPSupport() && !out.startsWith('data:image/webp')) {
        // Browser doesn't support WebP — JPEG fallback is the best we can do.
        resolve(out);
        return;
      }
      if (!out.startsWith('data:image/webp')) {
        reject(new Error('webp_not_produced'));
        return;
      }
      resolve(out);
    });
  });
}

// Detecta si una foto (data URL) ya está en formato WebP.
function isWebPPhoto(photo) {
  return !!(photo && typeof photo === 'string' && photo.startsWith('data:image/webp'));
}
// Detecta si una foto es JPEG/PNG (no WebP) — candidato a conversión.
function isLegacyPhoto(photo) {
  if (!photo || typeof photo !== 'string') return false;
  return photo.startsWith('data:image/jpeg') ||
         photo.startsWith('data:image/jpg') ||
         photo.startsWith('data:image/png');
}

// Convierte TODAS las fotos de productos en formato legacy (JPEG/PNG) a WebP.
// Devuelve un objeto con estadísticas: { total, converted, failed, skipped, savedBytes }.
// `onProgress(done, total, productName)` se llama para reportar progreso.
async function convertLegacyPhotosToWebP(onProgress) {
  const all = getProductos();
  const targets = all.filter(p => isLegacyPhoto(p.photo));
  const total = targets.length;
  if (total === 0) {
    return { total: 0, converted: 0, failed: 0, skipped: 0, savedBytes: 0 };
  }
  if (!_checkWebPSupport()) {
    throw new Error('Este navegador no soporta WebP. Usa Chrome, Edge, Firefox o Safari actualizado.');
  }
  let converted = 0, failed = 0, skipped = 0, savedBytes = 0;
  let done = 0;
  // Procesamos uno a uno para no saturar la memoria con muchos Image/Canvas a la vez.
  for (const p of targets) {
    done++;
    if (onProgress) try { onProgress(done, total, p.name || `#${p.id}`); } catch (_) {}
    try {
      const before = p.photo.length;
      const webpDataUrl = await compressImageP(p.photo, 800, 0.78);
      // Validar que efectivamente redujo tamaño (o al menos no creció significativamente).
      const after = webpDataUrl.length;
      if (after > before * 1.05) {
        // La versión WebP es más grande — mantener la original pero contar como skipped.
        skipped++;
      } else {
        // Aplicar el cambio (esto guarda en LS + encola Firebase + re-publica catálogo).
        patchProducto(p.id, { photo: webpDataUrl });
        savedBytes += (before - after);
        converted++;
      }
    } catch (e) {
      console.warn('convertLegacyPhotosToWebP: error en producto', p.id, e);
      failed++;
    }
    // Pausa mínima entre imágenes para dejar respirar el event loop.
    await new Promise(r => setTimeout(r, 10));
  }
  return { total, converted, failed, skipped, savedBytes };
}

// ══════════════════════════════════════════
//  UI: OPTIMIZAR IMÁGENES (admin)
//  Botón que convierte todas las fotos JPEG/PNG ya subidas a WebP.
//  Muestra un modal de progreso y al final un resumen con el espacio liberado.
// ══════════════════════════════════════════
let _optimizeInProgress = false;
function optimizeProductPhotos() {
  if (_optimizeInProgress) {
    showToast('Ya hay una optimización en curso...');
    return;
  }
  // Contar cuántas fotos necesitan conversión.
  const all = getProductos();
  const total = all.filter(p => isLegacyPhoto(p.photo)).length;
  if (total === 0) {
    showToast('✅ Todas las fotos ya están en WebP');
    return;
  }
  // Formatear tamaño humano.
  const fmtKB = bytes => {
    if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + ' MB';
    return Math.max(1, Math.round(bytes / 1024)) + ' KB';
  };
  // Confirmar antes de empezar.
  showConfirmAction(
    'Optimizar imágenes a WebP',
    `Se convertirán ${total} foto${total === 1 ? '' : 's'} JPEG/PNG a WebP y se borrarán las originales. Esto libera espacio en localStorage y Firebase. El proceso puede tardar según la cantidad.`,
    'Convertir a WebP',
    'btn-blue',
    async () => {
      _optimizeInProgress = true;
      // Construir modal de progreso (reutilizamos el modal genérico si existe).
      const modal = document.getElementById('optimizePhotosModal');
      if (modal) modal.classList.add('show');
      const setProgress = (done, total, name) => {
        const bar = document.getElementById('optimizeProgressBar');
        const txt = document.getElementById('optimizeProgressText');
        const nameEl = document.getElementById('optimizeProgressName');
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        if (bar) bar.style.width = pct + '%';
        if (txt) txt.textContent = `${done} / ${total} (${pct}%)`;
        if (nameEl) nameEl.textContent = name ? `Procesando: ${name}` : '';
      };
      setProgress(0, total, '');
      try {
        const result = await convertLegacyPhotosToWebP((done, t, name) => {
          setProgress(done, t, name);
        });
        // Refrescar la grilla de productos para mostrar las imágenes nuevas.
        if (typeof renderProductGrid === 'function') renderProductGrid();
        if (typeof renderStockCategorias === 'function') renderStockCategorias();
        maybeAutoSync();
        // Resumen final.
        const savedKB = fmtKB(result.savedBytes);
        const parts = [
          `✅ ${result.converted} foto${result.converted === 1 ? '' : 's'} convertida${result.converted === 1 ? '' : 's'} a WebP`,
          `💾 Espacio liberado: ~${savedKB}`,
        ];
        if (result.skipped > 0) parts.push(`⏭️ ${result.skipped} ya eran óptimas`);
        if (result.failed > 0) parts.push(`⚠️ ${result.failed} fallaron`);
        showToast(parts.join(' · '));
        // Si el navegador permite notificaciones, enviar una también.
        try {
          sendBrowserNotif('AXONTECH – Optimización completa', `${result.converted} fotos convertidas a WebP · ${savedKB} liberados`);
        } catch (_) {}
      } catch (e) {
        showToast('⚠️ ' + (e.message || 'Error al optimizar imágenes'));
      } finally {
        _optimizeInProgress = false;
        if (modal) modal.classList.remove('show');
      }
    }
  );
}
function closeOptimizePhotosModal() {
  const modal = document.getElementById('optimizePhotosModal');
  if (modal) modal.classList.remove('show');
}

// ══════════════════════════════════════════
//  MIGRAR FOTOS EXISTENTES (base64) A ARCHIVOS EN GITHUB
//  Retroactivo: productos y gestores subidos ANTES de que las fotos nuevas
//  empezaran a subirse solas a GitHub (ver uploadPhotoToGitHub). Solo toca
//  fotos que sigan siendo base64 — idempotente, se puede correr más de una
//  vez sin problema (las ya migradas se saltan).
// ══════════════════════════════════════════
async function migratePhotosToGitHubFiles(onProgress) {
  if (!ghToken() || !getConfig().ghRepo) {
    throw new Error('Configura GitHub primero en ⚙️ Config (token + repo)');
  }
  const prodTargets = getProductos().filter(p => (p.photo || '').startsWith('data:image/'));
  const gestorTargets = getGestores().filter(g => (g.photo || '').startsWith('data:image/'));
  const total = prodTargets.length + gestorTargets.length;
  let done = 0, migrated = 0, failed = 0;
  if (total === 0) return { total: 0, migrated: 0, failed: 0 };

  for (const p of prodTargets) {
    done++;
    if (onProgress) try { onProgress(done, total, p.name || `#${p.id}`); } catch (_) {}
    try {
      const uploaded = await uploadPhotoToGitHub(p.photo, 'p');
      if (uploaded) { patchProducto(p.id, { photo: uploaded }); migrated++; }
      else failed++;
    } catch (e) { console.warn('migratePhotosToGitHubFiles: producto', p.id, e); failed++; }
    await new Promise(r => setTimeout(r, 120)); // margen para el rate limit de la API de GitHub
  }

  // Gestores no tienen un patchX — hay que releer el array completo cada vez
  // (mismo patrón que ya usan handleGestorPhoto/changeGestorPhotoById) para
  // no pisar cambios que otro dispositivo haya hecho mientras tanto.
  for (const g0 of gestorTargets) {
    done++;
    if (onProgress) try { onProgress(done, total, g0.name || `#${g0.id}`); } catch (_) {}
    try {
      const uploaded = await uploadPhotoToGitHub(g0.photo, 'g');
      if (uploaded) {
        const list = getGestores();
        const i = list.findIndex(x => Number(x.id) === Number(g0.id));
        if (i !== -1) { list[i].photo = uploaded; saveGestores(list); migrated++; }
        else failed++;
      } else failed++;
    } catch (e) { console.warn('migratePhotosToGitHubFiles: gestor', g0.id, e); failed++; }
    await new Promise(r => setTimeout(r, 120));
  }

  return { total, migrated, failed };
}

let _migratingPhotosToGitHub = false;
function migratePhotosToGitHubUI() {
  if (_migratingPhotosToGitHub) { showToast('Ya hay una migración de fotos en curso...'); return; }
  if (!ghToken() || !getConfig().ghRepo) { showToast('Configura GitHub primero en ⚙️ Config'); return; }
  const prodCount = getProductos().filter(p => (p.photo || '').startsWith('data:image/')).length;
  const gestorCount = getGestores().filter(g => (g.photo || '').startsWith('data:image/')).length;
  const total = prodCount + gestorCount;
  if (total === 0) { showToast('✅ Ninguna foto pendiente de subir — ya están todas como archivo'); return; }
  showConfirmAction(
    'Subir fotos a GitHub',
    `Se subirán ${total} foto${total === 1 ? '' : 's'} (${prodCount} de productos, ${gestorCount} de gestores) como archivos a tu repositorio de GitHub, para dejar de ocupar espacio dentro de Firebase/Firestore. Puede tardar unos minutos.`,
    'Subir fotos',
    'btn-blue',
    async () => {
      _migratingPhotosToGitHub = true;
      const modal = document.getElementById('optimizePhotosModal');
      const titleEl = modal ? modal.querySelector('.modal-title') : null;
      const subEl = modal ? modal.querySelector('.modal-sub') : null;
      const prevTitle = titleEl ? titleEl.textContent : '';
      const prevSub = subEl ? subEl.textContent : '';
      if (titleEl) titleEl.textContent = '☁️ Subiendo fotos a GitHub';
      if (subEl) subEl.textContent = 'Moviendo fotos fuera de Firebase para ahorrar espacio…';
      if (modal) modal.classList.add('show');
      const setProgress = (done, t, name) => {
        const bar = document.getElementById('optimizeProgressBar');
        const txt = document.getElementById('optimizeProgressText');
        const nameEl = document.getElementById('optimizeProgressName');
        const pct = t > 0 ? Math.round((done / t) * 100) : 0;
        if (bar) bar.style.width = pct + '%';
        if (txt) txt.textContent = `${done} / ${t} (${pct}%)`;
        if (nameEl) nameEl.textContent = name ? `Subiendo: ${name}` : '';
      };
      setProgress(0, total, '');
      try {
        const result = await migratePhotosToGitHubFiles((done, t, name) => setProgress(done, t, name));
        if (typeof renderProductGrid === 'function') renderProductGrid();
        if (typeof renderStockCategorias === 'function') renderStockCategorias();
        if (typeof renderAdminGestoresList === 'function') renderAdminGestoresList();
        if (typeof renderGestores === 'function') renderGestores();
        maybeAutoSync();
        const parts = [`✅ ${result.migrated} foto${result.migrated === 1 ? '' : 's'} subida${result.migrated === 1 ? '' : 's'} a GitHub`];
        if (result.failed > 0) parts.push(`⚠️ ${result.failed} fallaron (revisa el token/repo y vuelve a intentar)`);
        showToast(parts.join(' · '));
      } catch (e) {
        showToast('⚠️ ' + (e.message || 'Error al subir fotos'));
      } finally {
        _migratingPhotosToGitHub = false;
        if (modal) modal.classList.remove('show');
        if (titleEl) titleEl.textContent = prevTitle;
        if (subEl) subEl.textContent = prevSub;
      }
    }
  );
}

function handleProductPhoto(input) {
  const file=input.files[0];if(!file)return;
  // Validate file type and size to prevent UI freeze on huge non-image files
  if(!file.type.startsWith('image/')){showToast('Solo se permiten imágenes');input.value='';return;}
  if(file.size > 10 * 1024 * 1024){showToast('Imagen demasiado grande (máx 10 MB)');input.value='';return;}
  const reader=new FileReader();
  reader.onload=e=>{
    showToast('🔄 Convirtiendo a WebP...');
    compressImage(e.target.result, 800, 0.78, compressed => {
      if(!compressed){showToast('Error al procesar la imagen');return;}
      // Si el navegador soporta WebP pero por algún motivo no se generó WebP, rechazar.
      // Esto garantiza que NUNCA se guarde un JPEG/PNG cuando el navegador soporta WebP.
      if(_checkWebPSupport() && !compressed.startsWith('data:image/webp')){
        showToast('⚠️ No se pudo convertir a WebP. Intenta con otra imagen.');
        return;
      }
      // Verify the conversion worked and check size savings
      const originalSize = e.target.result.length;
      const compressedSize = compressed.length;
      const savings = Math.round((1 - compressedSize / originalSize) * 100);
      document.getElementById('pm-foto').value=compressed;
      document.getElementById('pm-fotoPreview').innerHTML=`<img src="${compressed}" style="width:100%;height:80px;object-fit:cover;border-radius:6px;">`;
      const formatLabel = compressed.startsWith('data:image/webp') ? 'WebP' : 'JPEG';
      showToast(`✅ ${formatLabel} · ${savings}% más pequeño`, );
    });
  };
  reader.onerror=()=>{showToast('Error al leer el archivo');};
  reader.readAsDataURL(file);
}
function closeProductModal(){document.getElementById('productModal').classList.remove('show');editingProductId=null;}
async function saveProduct() {
  const name=document.getElementById('pm-name').value.trim();if(!name){showToast('El nombre es obligatorio');return;}
  const catVal=document.getElementById('pm-cat').value;
  // pm-foto puede ser: vacío, una ruta ya subida ("photos/xxx.webp", sin
  // cambios), o un data URL base64 recién comprimido por handleProductPhoto
  // (foto nueva o reemplazada) — solo en ese último caso hay que subirla.
  let photoVal = document.getElementById('pm-foto').value.trim();
  if (photoVal.startsWith('data:image/')) {
    const uploaded = await uploadPhotoToGitHub(photoVal, 'p');
    if (uploaded) photoVal = uploaded;
  }
  const prod={
    name,description:document.getElementById('pm-desc').value.trim(),
    precio:document.getElementById('pm-precio').value.trim(),
    stock:parseInt(document.getElementById('pm-stock').value)||0,
    puntos:parseFloat(document.getElementById('pm-puntos').value)||0,
    garantia:document.getElementById('pm-garantia').value.trim(),
    comision:(()=>{const amt=parseFloat(document.getElementById('pm-comision-amount').value);const cur=document.getElementById('pm-comision-currency').value;return amt>0?(cur==='MN'?`${amt} MN`:`$${amt} USD`):''})(),
    photo:photoVal,
    catId:catVal?parseInt(catVal):null,
  };
  if(editingProductId){
    const old=productoOf(editingProductId);
    patchProducto(editingProductId,prod);
    if(old&&old.stock===0&&prod.stock>0) addNotif('restocked',prod.name,editingProductId,`stock: ${prod.stock}`);
    showToast('Producto actualizado ✓');
  } else {
    const newId=Date.now();
    // BUGFIX: ver comentario en sendVale()/addGestor() — no mutar el array
    // que devuelve getProductos().
    saveProductos([...getProductos(), {id:newId,...prod}]);
    addNotif('new_product',prod.name,newId,prod.precio||'');
    showToast('Producto agregado ✓');
  }
  closeProductModal();renderProductGrid();renderStockCategorias();maybeAutoSync();
}
function removeProducto(id) {
  const p=productoOf(id);
  const name = p ? p.name : 'este producto';
  showConfirmAction('¿Eliminar este producto?', name, 'Eliminar', 'btn-red', () => {
    saveProductos(getProductos().filter(x=>x.id!==id));
    renderProductGrid();renderStockCategorias();showToast('Producto eliminado');
  });
}


function venderDirecto(id) {
  const p=productoOf(id);if(!p)return;
  const q = prompt(`¿Cuántas unidades de ${p.name} se vendieron directamente en la tienda?`, '1');
  if(q === null) return;
  const qty = parseInt(q, 10);
  if(isNaN(qty) || qty <= 0) return showToast('Cantidad inválida');
  // Comparar contra el stock DISPONIBLE (stock - reserved), no el stock físico total —
  // igual que hacen los pickers de vale. Antes esto permitía "vender directo en tienda"
  // unidades que ya estaban reservadas para otro cliente.
  if(qty > _availableStock(p)) return showToast('Stock insuficiente (hay unidades reservadas)');

  // Deduct stock
  const newStock = p.stock - qty;
  patchProducto(id, {stock: newStock});
  
  if(newStock===0 && p.stock>0) addNotif('out_of_stock',p.name,id,'stock agotado');
  else if(newStock>0 && newStock<=LOW_STOCK_THRESHOLD && p.stock>LOW_STOCK_THRESHOLD) addNotif('low_stock',p.name,id,`quedan ${newStock}`);
  
  // Create vale record for stats
  const vale={
    id:Date.now(),valeNum:getNextValeNum(),gestorId:0,ts:new Date().toISOString(),
    cliente:'Venta Directa en Tienda',telefono:'',direccion:'Tienda Física',carnet:'',
    mensajeria:'',articulo:`${p.name} x${qty}`,
    precioUSD:p.precio,precioMN:'',
    vuelto:'',total:'Venta Local',garantia:p.garantia||'',
    valeProductos:[{id:p.id,name:p.name,qty}],valeText:'Venta en tienda',
    status:'confirmed',mensajeroId:null,confirmedTs:new Date().toISOString(),isNew:false,adminNotes:'Venta directa sin gestor',
    commissionPaid:true,commissionStatus:'cobrado',commissionPaidTs:new Date().toISOString(),
    stockDecremented:true
  };
  // BUGFIX: ver el comentario detallado en sendVale() — getVales().push()
  // mutaba _valesCache antes de que saveVales() pudiera diferenciar "antes"
  // vs "ahora", y el write nunca se encolaba. Usar spread evita mutar la
  // referencia que devuelve getVales().
  const all=[...getVales(), vale];saveVales(all);
  // No direct db.ref().set() — saveVales already enqueues via the write queue.
  // Direct db.ref() calls bypassed the retry queue and could lose data on network failure.
  _logAudit('direct_sale', 'product:' + id + ' qty:' + qty);

  // Feedback inmediato al admin
  showToast('Venta directa registrada ✓');
  statsTabDirty=true;

  // Diferir el render del catálogo (puede ser pesado si hay muchos productos)
  setTimeout(() => {
    try { renderProductGrid(); } catch(e) { console.error('venderDirecto deferred render:', e); }
  }, 0);
}
function adjustStock(id) {
  const p=productoOf(id);if(!p)return;
  const n=prompt(`Stock actual: ${p.stock||0}
Nuevo stock:`,p.stock||0);
  if(n===null)return;const num=parseInt(n);
  if(isNaN(num)||num<0){showToast('Número inválido');return;}
  const oldStock=p.stock||0;
  patchProducto(id,{stock:num});
  if(oldStock===0&&num>0) addNotif('restocked',p.name,id,`stock: ${num}`);
  else if(num===0&&oldStock>0) addNotif('out_of_stock',p.name,id,'stock agotado');
  else if(num>0&&num<=LOW_STOCK_THRESHOLD&&oldStock>LOW_STOCK_THRESHOLD) addNotif('low_stock',p.name,id,`quedan ${num}`);
  maybeAutoSync();
  renderProductGrid();showToast('Stock actualizado ✓');
}

// Ajustar cantidad RESERVADA de un producto.
// - Si reserved >= stock → producto se considera "totalmente reservado"
//   (sale de la lista de disponibles, queda opaco en el picker).
// - Si reserved < stock  → el producto sigue disponible pero con stock
//   reducido en la cantidad reservada.
// - Si reserved = 0      → no hay reserva (estado normal).
function adjustReserved(id) {
  const p=productoOf(id);if(!p)return;
  const current=p.reserved||0;
  const stock=p.stock||0;
  const avail=_availableStock(p);
  const n=prompt(
    `🔐 Reservar unidades de: ${p.name}\n\n` +
    `Stock físico: ${stock}\n` +
    `Reservado ahora: ${current}\n` +
    `Disponible real: ${avail}\n\n` +
    `¿Cuántas unidades quieres reservar?\n` +
    `(Escribe 0 para liberar todas las reservas)`,
    String(current)
  );
  if(n===null)return;
  const num=parseInt(n);
  if(isNaN(num)||num<0){showToast('Número inválido');return;}
  if(num>stock){
    showToast(`No puedes reservar ${num} (solo hay ${stock} en stock)`);
    return;
  }
  patchProducto(id,{reserved:num});
  maybeAutoSync();
  renderProductGrid();
  if(num===0) showToast('Reservas liberadas ✓');
  else if(num>=stock) showToast(`🔒 ${p.name} totalmente reservado (${num}/${stock})`);
  else showToast(`🔐 ${num} unidades reservadas · ${stock-num} disponibles`);
}

// ══════════════════════════════════════════
//  STATS
// ══════════════════════════════════════════

// Inactivity threshold in days
const GESTOR_INACTIVITY_DAYS = 5;
if (typeof window._expandedStatsGestors === 'undefined') window._expandedStatsGestors = new Set();

// Mini bar chart — 7-day activity (vales per day) for a gestor
function _renderMiniBarChart7d(gestorId) {
  const days = [];
  const today = new Date();
  today.setHours(0,0,0,0);
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const ds = localDay(d);
    const count = getVales().filter(v => Number(v.gestorId) === Number(gestorId) && localDay(v.ts) === ds).length;
    days.push({ ds, count, label: d.toLocaleDateString('es-ES', { weekday:'short' }).slice(0,1).toUpperCase() });
  }
  const max = Math.max(1, ...days.map(d => d.count));
  const bars = days.map(d => {
    const h = Math.max(2, Math.round((d.count / max) * 100));
    const hasVales = d.count > 0;
    const color = hasVales ? 'var(--blue)' : 'var(--gray-100)';
    const bg = hasVales ? 'var(--blue)' : 'transparent';
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;flex:1;">
      <div style="font-size:8px;color:${hasVales?'var(--text)':'var(--gray-400)'};font-weight:700;">${d.count || ''}</div>
      <div style="width:100%;max-width:18px;height:36px;display:flex;align-items:flex-end;justify-content:center;">
        <div style="width:100%;height:${h}%;background:${color};border-radius:3px 3px 0 0;min-height:2px;transition:height .4s;"></div>
      </div>
      <div style="font-size:8px;color:var(--gray-400);">${d.label}</div>
    </div>`;
  }).join('');
  return `<div style="display:flex;align-items:flex-end;gap:3px;padding:6px 0;">${bars}</div>`;
}

// Top N products for a gestor in the given vales set
function _topProductsForGestor(vales, limit=3) {
  const map = {};
  vales.forEach(v => (v.valeProductos||[]).forEach(({id,qty}) => {
    if (!map[id]) map[id] = { qty:0, name: productoOf(id)?.name || `#${id}` };
    map[id].qty += qty;
  }));
  return Object.entries(map)
    .sort(([,a],[,b]) => b.qty - a.qty)
    .slice(0, limit)
    .map(([id,info]) => ({ id:parseInt(id), ...info }));
}

// Inactive gestor check — last vale older than threshold
function _gestorInactivityDays(gestorId) {
  const gv = getVales().filter(v => Number(v.gestorId) === Number(gestorId));
  if (!gv.length) return null; // never created a vale
  const last = gv.reduce((max, v) => v.ts > max ? v.ts : max, '');
  if (!last) return null;
  const days = Math.floor((Date.now() - new Date(last).getTime()) / 86400000);
  return days;
}

// Render a single expandible gestor card for the Estadísticas panel
function _renderStatsGestorCard(g, vales, from, to) {
  const gv = vales.filter(v => Number(v.gestorId) === Number(g.id));
  const gc = gv.filter(v => v.status === 'confirmed').length;
  const gPendingPay = gv.filter(v => v.status === 'pending_payment').length;
  const pts = gv.reduce((sum,v) => (v.valeProductos||[]).reduce((s,p) => {
    const pr = productoOf(p.id);
    return s + (pr ? (pr.puntos||0) * p.qty : 0);
  }, sum), 0);
  const closed = gc + gPendingPay;
  const conversion = gv.length > 0 ? Math.round((closed / gv.length) * 100) : 0;
  const isExpanded = window._expandedStatsGestors.has(g.id);

  // Inactivity badge
  const inactDays = _gestorInactivityDays(g.id);
  const inactBadge = (inactDays === null)
    ? `<span style="background:var(--gray-200);color:var(--gray-600);border-radius:10px;padding:1px 6px;font-size:9px;font-weight:700;">∅ Sin vales</span>`
    : (inactDays >= GESTOR_INACTIVITY_DAYS
        ? `<span style="background:var(--red);color:white;border-radius:10px;padding:1px 6px;font-size:9px;font-weight:700;">⚠️ ${inactDays}d sin actividad</span>`
        : '');

  // Header
  let html = `<div class="card" style="padding:0;overflow:hidden;margin-bottom:6px;border-color:${isExpanded?'var(--blue)':'var(--border)'};">
    <div onclick="toggleStatsGestor(${g.id})" style="display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;background:${isExpanded?'var(--blue-lt)':'var(--surface)'};">
      <div class="g-avatar" style="background:${g.color};width:32px;height:32px;font-size:11px;flex-shrink:0;">${escapeHTML(g.initials)}</div>
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <span style="font-size:13px;font-weight:700;">${escapeHTML(g.name)}</span>
          ${inactBadge}
        </div>
        <div style="font-size:11px;color:var(--gray-400);">${gv.length} vales · ${closed} cerrados${pts?` · ⭐ ${pts} pts`:''} · ${conversion}% conv.</div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
        <button type="button" onclick="event.stopPropagation();jumpToHistorialForGestor(${g.id},'${from||''}','${to||''}')" style="background:var(--blue);color:white;border:none;border-radius:6px;padding:3px 8px;font-size:10px;font-weight:700;cursor:pointer;">Ver historial →</button>
        <span style="color:var(--gray-400);font-size:12px;">${isExpanded?'▲':'▼'}</span>
      </div>
    </div>`;

  if (isExpanded) {
    // Detail body
    // Top 3 products
    const top3 = _topProductsForGestor(gv, 3);
    const top3HTML = top3.length
      ? top3.map((p,i) => {
          const medal = ['🥇','🥈','🥉'][i] || '·';
          return `<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);">
            <span style="font-size:11px;color:var(--text);">${medal} ${escapeHTML(p.name)}</span>
            <span style="font-size:10px;font-weight:700;color:var(--blue);">${p.qty} u.</span>
          </div>`;
        }).join('')
      : '<div style="font-size:11px;color:var(--gray-400);">Sin productos vendidos en el período</div>';

    // Ticket promedio — separa USD y MN en vez de sumarlos como si fueran la misma
    // moneda. Antes se hacía parsePrecioNum(v.total) sobre un texto combinado tipo
    // "$45 USD + 4050 MN" (formato de calcAutoTotal), sumando 45+4050 y mostrando
    // el resultado como si todo fuera USD — el mismo bug que ya se había corregido
    // en getValeCommissionParts (ver comentario "ALTO 10" más abajo) pero que
    // seguía sin arreglar aquí. Se usan precioUSD/precioMN (los campos ya separados
    // por moneda) y solo se cae a v.total para vales viejos sin esos campos.
    const closedVales = gv.filter(v => ['confirmed','pending_payment'].includes(v.status));
    let ticketSumUSD = 0, ticketSumMN = 0;
    closedVales.forEach(v => {
      const usd = parsePrecioNum(v.precioUSD || '');
      const mn = parsePrecioNum(v.precioMN || '');
      if (usd > 0 || mn > 0) { ticketSumUSD += usd; ticketSumMN += mn; }
      else { ticketSumUSD += parsePrecioNum(v.total || ''); }
    });
    const ticketAvgUSD = closedVales.length ? ticketSumUSD / closedVales.length : 0;
    const ticketAvgMN = closedVales.length ? ticketSumMN / closedVales.length : 0;
    const ticketParts = [];
    if (ticketAvgUSD > 0) ticketParts.push(`$${ticketAvgUSD.toFixed(0)} USD`);
    if (ticketAvgMN > 0) ticketParts.push(`${Math.round(ticketAvgMN)} MN`);
    const ticketStr = ticketParts.length ? ticketParts.join(' + ') : '—';

    // Commission summary
    const pendCom = closedVales.filter(v => !v.commissionPaid && v.commissionStatus !== 'en_sobre' && v.commissionStatus !== 'cobrado');
    const enSobre = closedVales.filter(v => v.commissionStatus === 'en_sobre');
    const cobrados = closedVales.filter(v => v.commissionPaid || v.commissionStatus === 'cobrado');
    const comParts = [];
    if (pendCom.length) comParts.push(`<span style="color:var(--orange);font-weight:600;">${pendCom.length} pend.</span>`);
    if (enSobre.length) comParts.push(`<span style="color:var(--yellow);font-weight:600;">✉️ ${enSobre.length} en sobre</span>`);
    if (cobrados.length) comParts.push(`<span style="color:var(--green);font-weight:600;">💰 ${cobrados.length} cobrado${cobrados.length!==1?'s':''}</span>`);
    const comHTML = comParts.length ? comParts.join(' · ') : '<span style="color:var(--gray-400);">Sin comisiones en el período</span>';

    // Last activity
    const lastValeTs = gv.length ? gv.reduce((max,v) => v.ts > max ? v.ts : max, '') : '';
    const lastStr = lastValeTs
      ? `${new Date(lastValeTs).toLocaleDateString('es-ES')} ${timeStr(lastValeTs)}`
      : 'Sin actividad';

    html += `<div style="padding:12px 14px;border-top:1px solid var(--border);background:var(--surface);">
      <!-- Mini chart 7 días -->
      <div style="margin-bottom:10px;">
        <div style="font-size:10px;font-weight:700;color:var(--gray-400);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">📈 Actividad últimos 7 días</div>
        ${_renderMiniBarChart7d(g.id)}
      </div>
      <!-- KPIs -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
        <div style="background:var(--surface2);padding:8px 10px;border-radius:6px;">
          <div style="font-size:9px;color:var(--gray-400);text-transform:uppercase;letter-spacing:.5px;">Ticket promedio</div>
          <div style="font-size:14px;font-weight:800;color:var(--blue);">${ticketStr}</div>
        </div>
        <div style="background:var(--surface2);padding:8px 10px;border-radius:6px;">
          <div style="font-size:9px;color:var(--gray-400);text-transform:uppercase;letter-spacing:.5px;">Tasa conversión</div>
          <div style="font-size:14px;font-weight:800;color:var(--green);">${conversion}%</div>
        </div>
        <div style="background:var(--surface2);padding:8px 10px;border-radius:6px;">
          <div style="font-size:9px;color:var(--gray-400);text-transform:uppercase;letter-spacing:.5px;">Última actividad</div>
          <div style="font-size:11px;font-weight:700;color:var(--text);">${lastStr}</div>
        </div>
        <div style="background:var(--surface2);padding:8px 10px;border-radius:6px;">
          <div style="font-size:9px;color:var(--gray-400);text-transform:uppercase;letter-spacing:.5px;">Comisiones</div>
          <div style="font-size:11px;">${comHTML}</div>
        </div>
      </div>
      <!-- Top 3 productos -->
      <div>
        <div style="font-size:10px;font-weight:700;color:var(--gray-400);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">🏆 Top productos del período</div>
        ${top3HTML}
      </div>
    </div>`;
  }

  html += `</div>`;
  return html;
}

function toggleStatsGestor(gestorId) {
  if (window._expandedStatsGestors.has(gestorId)) {
    window._expandedStatsGestors.delete(gestorId);
  } else {
    window._expandedStatsGestors.add(gestorId);
  }
  renderStats();
}

// Drill-down: jump from Estadísticas card to Historial panel filtered by that gestor + dates
function jumpToHistorialForGestor(gestorId, from, to) {
  // Set the gestor filter value first (renderHistorial preserves curGFilter on the element)
  const el = document.getElementById('histGestorFilter');
  if (el) el.value = String(gestorId);
  const fEl = document.getElementById('histDateFrom');
  const tEl = document.getElementById('histDateTo');
  if (fEl && from) fEl.value = from;
  if (tEl && to) tEl.value = to;
  adminTab('historial');
  // renderHistorial is triggered inside adminTab transition; call once more to be safe
  setTimeout(renderHistorial, 50);
}

// CSV export of currently-filtered historial
function exportHistorialCSV() {
  const fromEl = document.getElementById('histDateFrom');
  const toEl = document.getElementById('histDateTo');
  const gestorEl = document.getElementById('histGestorFilter');
  let vales = [...getVales()].reverse();
  const from = fromEl ? fromEl.value : '';
  const to = toEl ? toEl.value : '';
  const gFilter = gestorEl ? gestorEl.value : '';
  if (from) vales = vales.filter(v => localDay(v.ts) >= from);
  if (to)   vales = vales.filter(v => localDay(v.ts) <= to);
  if (gFilter) vales = vales.filter(v => String(v.gestorId) === gFilter);

  if (!vales.length) { showToast('No hay vales para exportar'); return; }

  const sMap = {
    pending: 'Pendiente', assigned: 'Con mensajero', delivered: 'Entregado',
    confirmed: 'Confirmado', pending_payment: 'Pend. cobro', cancelled: 'Cancelado'
  };
  const rows = [['# Vale','Fecha','Hora','Cliente','Teléfono','Dirección','Gestor','Mensajero','Artículo','Total','Estado','Comisión']];
  vales.forEach(v => {
    const g = gestorOf(v.gestorId);
    const m = v.mensajeroId ? (getMensajeros().find(x => x.id === v.mensajeroId) || {}) : {};
    const d = new Date(v.ts);
    rows.push([
      valeNumStr(v) || '',
      d.toLocaleDateString('es-ES'),
      timeStr(v.ts),
      (v.cliente || '').replace(/"/g, '""'),
      (v.telefono || '').replace(/"/g, '""'),
      (v.direccion || '').replace(/"/g, '""'),
      g ? g.name : '—',
      m.name || '—',
      (v.articulo || '').replace(/"/g, '""'),
      (v.total || '').replace(/"/g, '""'),
      sMap[v.status] || v.status,
      v.commissionPaid ? 'Cobrado' : (v.commissionStatus === 'en_sobre' ? 'En sobre' : (v.commissionStatus === 'cobrado' ? 'Cobrado' : 'Pendiente'))
    ]);
  });
  const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const today = localDay(new Date());
  a.download = `axontech-historial-${today}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(`Exportados ${vales.length} vales ✓`);
}

function renderStats() {
  const from=document.getElementById('statsDateFrom').value;
  const to=document.getElementById('statsDateTo').value;
  let vales=getVales();
  if(from)vales=vales.filter(v=>localDay(v.ts)>=from);
  if(to)  vales=vales.filter(v=>localDay(v.ts)<=to);
  const total=vales.length;
  const confirmed=vales.filter(v=>v.status==='confirmed').length;
  const pending=vales.filter(v=>v.status==='pending').length;
  const assigned=vales.filter(v=>v.status==='assigned').length;
  document.getElementById('statsSummaryRow').innerHTML=[
    {label:'Total vales',val:total,color:'var(--blue)'},
    {label:'Confirmados',val:confirmed,color:'var(--green)'},
    {label:'Con mensajero',val:assigned,color:'var(--orange)'},
    {label:'Pendientes',val:pending,color:'var(--red)'},
  ].map(({label,val,color})=>`<div class="stat-card"><div class="stat-num" style="color:${color};">${val}</div><div class="stat-lbl">${label}</div></div>`).join('');
  // By gestor — expandible cards with drill-down details
  const gestores=getGestores();
  document.getElementById('statsGestorList').innerHTML=gestores.length?
    gestores.map(g => _renderStatsGestorCard(g, vales, from, to)).join('') :
    '<div class="es"><div class="es-text">Sin gestores configurados</div></div>';
  // By product
  const prodCount={};
  vales.forEach(v=>(v.valeProductos||[]).forEach(({id,qty})=>{
    if(!prodCount[id])prodCount[id]={qty:0,confirmados:0};
    prodCount[id].qty+=qty;
    if(v.status==='confirmed')prodCount[id].confirmados+=qty;
  }));
  const sortedProds=Object.entries(prodCount).sort(([,a],[,b])=>b.qty-a.qty);
  document.getElementById('statsProductList').innerHTML=sortedProds.length?
    sortedProds.map(([id,{qty,confirmados}])=>{
      const p=productoOf(parseInt(id));
      return `<div class="card" style="padding:10px 14px;margin-bottom:6px;">
        <div style="font-size:13px;font-weight:700;">${p?escapeHTML(p.name):`Producto ${id}`}</div>
        <div style="font-size:11px;color:var(--gray-400);">${qty} vendidos · ${confirmados} entregados</div>
      </div>`;
    }).join('') :
    '<div class="es"><div class="es-text">Sin datos de productos en el período</div></div>';

  // ── INVENTARIO ──
  const prods=getProductos();const cats=getCategorias();
  const enStock=prods.filter(p=>(p.stock||0)>0).length;
  const agotados=prods.filter(p=>(p.stock||0)===0).length;
  const stockBajo=prods.filter(p=>(p.stock||0)>0&&(p.stock||0)<=LOW_STOCK_THRESHOLD).length;
  let valorTotal=0;
  prods.forEach(p=>{const n=parsePrecioNum(p.precio||'');if(n>0)valorTotal+=n*(p.stock||0);});
  const valorStr=valorTotal>0?`$${valorTotal.toLocaleString('es-ES',{maximumFractionDigits:0})} USD`:'—';

  document.getElementById('statsInventarioRow').innerHTML=
    [{label:'Total productos',val:prods.length,color:'var(--blue)'},
     {label:'En stock',val:enStock,color:'var(--green)'},
     {label:'Agotados',val:agotados,color:'var(--red)'},
     {label:'Stock bajo',val:stockBajo,color:'var(--yellow)'}]
    .map(({label,val,color})=>
      `<div class="stat-card"><div class="stat-num" style="color:${color};">${val}</div><div class="stat-lbl">${label}</div></div>`
    ).join('')+
    (valorTotal>0?`<div class="stat-card" style="grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;">
      <div class="stat-lbl">💰 Valor total en inventario</div>
      <div style="font-size:20px;font-weight:900;color:var(--green);">${valorStr}</div>
    </div>`:'');

  // ── POR CATEGORÍA ──
  document.getElementById('statsCatList').innerHTML=cats.length?
    cats.map(cat=>{
      const cp=prods.filter(p=>p.catId===cat.id);
      const cs=cp.filter(p=>(p.stock||0)>0).length;
      const ca=cp.filter(p=>(p.stock||0)===0).length;
      const pct=cp.length?Math.round(cs/cp.length*100):0;
      return `<div class="card" style="padding:10px 14px;margin-bottom:6px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <span style="font-size:13px;font-weight:700;">${escapeHTML(cat.name)}</span>
          <span style="font-size:11px;color:var(--gray-400);">${cp.length} prods</span>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <div style="flex:1;background:var(--gray-100);border-radius:20px;height:8px;overflow:hidden;">
            <div style="width:${pct}%;height:100%;background:var(--green);border-radius:20px;transition:width .5s;"></div>
          </div>
          <span style="font-size:10px;color:var(--green);font-weight:700;white-space:nowrap;">${cs}✓</span>
          ${ca?`<span style="font-size:10px;color:var(--red);font-weight:700;white-space:nowrap;">${ca}✗</span>`:''}
        </div>
      </div>`;
    }).join(''):
    '<div class="es"><div class="es-text">Sin categorías</div></div>';

  // ── TOP VENDIDOS (histórico total) ──
  const allConf=getVales().filter(v=>['confirmed','pending_payment'].includes(v.status));
  const soldMap={};
  allConf.forEach(v=>(v.valeProductos||[]).forEach(({id,qty})=>{soldMap[id]=(soldMap[id]||0)+qty;}));
  const topSold=Object.entries(soldMap).sort(([,a],[,b])=>b-a).slice(0,7);
  const maxSold=topSold[0]?.[1]||1;
  document.getElementById('statsTopVendidos').innerHTML=topSold.length?
    topSold.map(([id,qty])=>{
      const p=productoOf(parseInt(id));
      const pct=Math.round(qty/maxSold*100);
      return `<div class="card" style="padding:10px 14px;margin-bottom:6px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
          <span style="font-size:12px;font-weight:700;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p?escapeHTML(p.name):`Prod. ${id}`}</span>
          <span style="font-size:13px;font-weight:800;color:var(--blue);margin-left:8px;white-space:nowrap;">${qty} uds</span>
        </div>
        <div style="background:var(--gray-100);border-radius:20px;height:5px;overflow:hidden;">
          <div style="width:${pct}%;height:100%;background:var(--blue);border-radius:20px;"></div>
        </div>
      </div>`;
    }).join(''):
    '<div class="es"><div class="es-text">Sin ventas confirmadas aún</div></div>';
}

// ══════════════════════════════════════════
//  DEMO MODE
// ══════════════════════════════════════════
function loadDemo() {
  if (!confirm('¿Cargar datos de demostración?\nEsto reemplazará los datos actuales.')) return;

  // Gestores
  saveGestores([
    {id:1, name:'Carlos Mendoza',  initials:'CM', color:'#2563EB'},
    {id:2, name:'Ana López',       initials:'AL', color:'#7C3AED'},
    {id:3, name:'Pedro García',    initials:'PG', color:'#059669'},
    {id:4, name:'Laura Torres',    initials:'LT', color:'#DC2626'},
  ]);

  // Categorías
  saveCategorias([
    {id:10, name:'Electrónica'},
    {id:20, name:'Accesorios'},
    {id:30, name:'Computación'},
  ]);

  // Productos
  saveProductos([
    {id:100, name:'iPhone 15 Pro',     description:'Apple 256GB Titanio',      precio:'$950 USD',  stock:5,  puntos:10, garantia:'6 meses',  comision:'$15 USD', photo:'', catId:10},
    {id:101, name:'Samsung Galaxy S24',description:'Android 256GB',            precio:'$780 USD',  stock:3,  puntos:8,  garantia:'6 meses',  comision:'$12 USD', photo:'', catId:10},
    {id:102, name:'AirPods Pro 2',     description:'Auriculares inalámbricos', precio:'$180 USD',  stock:12, puntos:5,  garantia:'3 meses',  comision:'$5 USD',  photo:'', catId:20},
    {id:103, name:'Funda iPhone 15',   description:'Silicona premium',         precio:'$15 USD',   stock:25, puntos:1,  garantia:'',         comision:'$1 USD',  photo:'', catId:20},
    {id:104, name:'Laptop HP Victus',  description:'Core i5, 16GB RAM, 512GB', precio:'$680 USD',  stock:2,  puntos:15, garantia:'12 meses', comision:'$20 USD', photo:'', catId:30},
    {id:105, name:'Cargador MagSafe',  description:'65W Original',             precio:'$45 USD',   stock:0,  puntos:2,  garantia:'3 meses',  comision:'$2 USD',  photo:'', catId:20},
    {id:106, name:'Teclado Mecánico',  description:'RGB inalámbrico',          precio:'$95 USD',   stock:0,  puntos:4,  garantia:'6 meses',  comision:'$4 USD',  photo:'', catId:30},
  ]);

  // Mensajeros
  saveMensajeros([
    {id:50, name:'Jorge Ramírez'},
    {id:51, name:'Luis Herrera'},
  ]);

  // Vales en todos los estados
  const now   = new Date();
  const h     = (n) => new Date(now.getTime() - n*60*60*1000).toISOString();

  saveVales([
    { id:2001, gestorId:1, ts:h(0.5),  cliente:'Roberto Silva',   telefono:'55551234', direccion:'Calle 23 #456, Vedado',       mensajeria:'$2 USD',  articulo:'iPhone 15 Pro x1',    precioUSD:'$950 USD', precioMN:'',        vuelto:'',      total:'$950 USD',  garantia:'6 meses', valeProductos:[{id:100,name:'iPhone 15 Pro',qty:1}],    valeText:'', status:'pending',         mensajeroId:null, confirmedTs:null,  isNew:true  },
    { id:2002, gestorId:2, ts:h(1.2),  cliente:'María Torres',    telefono:'55559876', direccion:'Av 5ta #88 e/8 y 10',         mensajeria:'Gratis',  articulo:'AirPods Pro 2 x2',    precioUSD:'$360 USD', precioMN:'',        vuelto:'',      total:'$360 USD',  garantia:'3 meses', valeProductos:[{id:102,name:'AirPods Pro 2',qty:2}],    valeText:'', status:'assigned',        mensajeroId:50,   confirmedTs:null,  deliveredTs:null,  isNew:false },
    { id:2007, gestorId:3, ts:h(1.8),  cliente:'Diana Vázquez',   telefono:'55552468', direccion:'Neptuno #89, Centro Habana',   mensajeria:'$2 USD',  articulo:'Laptop HP Victus x1', precioUSD:'$680 USD', precioMN:'',        vuelto:'',      total:'$680 USD',  garantia:'12 meses',valeProductos:[{id:104,name:'Laptop HP Victus',qty:1}],  valeText:'', status:'delivered',       mensajeroId:51,   confirmedTs:null,  deliveredTs:h(0.3),isNew:false },
    { id:2003, gestorId:1, ts:h(2.0),  cliente:'Luis Pérez',      telefono:'55554321', direccion:'Obispo #12, Habana Vieja',    mensajeria:'$1 USD',  articulo:'Funda iPhone 15 x3',  precioUSD:'$45 USD',  precioMN:'4050 MN',vuelto:'0',     total:'$45 USD',   garantia:'',         valeProductos:[{id:103,name:'Funda iPhone 15',qty:3}],  valeText:'', status:'confirmed',       mensajeroId:51,   confirmedTs:h(0.8),isNew:false },
    { id:2004, gestorId:3, ts:h(3.1),  cliente:'Carmen Díaz',     telefono:'55557890', direccion:'23 y 12 #234, Vedado',        mensajeria:'$2 USD',  articulo:'Samsung Galaxy S24 x1',precioUSD:'$780 USD',precioMN:'',        vuelto:'',      total:'$780 USD',  garantia:'6 meses', valeProductos:[{id:101,name:'Samsung Galaxy S24',qty:1}],valeText:'', status:'pending_payment', mensajeroId:50,   confirmedTs:null,  isNew:false },
    { id:2005, gestorId:4, ts:h(4.5),  cliente:'Oscar Fernández', telefono:'55553456', direccion:'Línea #78 esq L',             mensajeria:'$3 USD',  articulo:'Laptop HP Victus x1', precioUSD:'$680 USD', precioMN:'',        vuelto:'',      total:'$680 USD',  garantia:'12 meses',valeProductos:[{id:104,name:'Laptop HP Victus',qty:1}],  valeText:'', status:'pending',         mensajeroId:null, confirmedTs:null,  isNew:true  },
    { id:2006, gestorId:2, ts:h(5.0),  cliente:'Yolanda Cruz',    telefono:'55558765', direccion:'Reina #302, Centro Habana',   mensajeria:'Gratis',  articulo:'iPhone 15 Pro x1',    precioUSD:'$950 USD', precioMN:'',        vuelto:'',      total:'$950 USD',  garantia:'6 meses', valeProductos:[{id:100,name:'iPhone 15 Pro',qty:1}],    valeText:'', status:'confirmed',       mensajeroId:51,   confirmedTs:h(3.0),isNew:false },
  ]);

  // Notificaciones de ejemplo
  saveNotifs([
    {id:3001, type:'new_product',  productName:'iPhone 15 Pro',   productId:100, ts:h(0.2), read:false, extra:'$950 USD'},
    {id:3002, type:'low_stock',    productName:'Laptop HP Victus', productId:104, ts:h(1.0), read:false, extra:'quedan 2'},
    {id:3003, type:'out_of_stock', productName:'Cargador MagSafe', productId:105, ts:h(2.5), read:false, extra:'stock agotado'},
    {id:3004, type:'restocked',    productName:'Samsung Galaxy S24',productId:101,ts:h(4.0), read:true,  extra:'stock: 3'},
  ]);

  // Reload everything
  activeGestorId=null; activeMensajeroId=null; adminActive=false; selectedValeId=null;
  adminGestorFilter=null; inboxFilter='all'; selectedProductsUI=[]; currentValeProductos=[];
  rankingCache=null;gestoresTabDirty=true;statsTabDirty=true;
  const _la=document.getElementById('layoutAdmin'); if(_la)_la.classList.remove('active');
  const _lg=document.getElementById('layoutGestor'); if(_lg){_lg.classList.remove('has-gestor');_lg.classList.add('active');}
  const _ba=document.getElementById('btnAdminAccess'); if(_ba)_ba.style.display='flex';
  const _al=document.getElementById('adminLabel'); if(_al)_al.style.display='none';
  const _bl=document.getElementById('btnLogout'); if(_bl)_bl.style.display='none';
  const _hn=document.getElementById('headerGestorName'); if(_hn)_hn.textContent='';
  const _bav=document.getElementById('bannerAvatar'); if(_bav){_bav.textContent='?';_bav.style.background='var(--gray-300)';}
  const _blbl=document.getElementById('bannerLbl'); if(_blbl)_blbl.textContent='SELECCIONA TU NOMBRE';
  const _bnm=document.getElementById('bannerName'); if(_bnm)_bnm.textContent='Selecciona tu nombre →';
  resetForm();
  renderGestores();
  renderGestorNotifs();
  renderGestorRanking();
  updateAdminBadge();updateMensajeroBadge();
  showToast('🎮 Datos de demo cargados ✓ — contraseña admin: axon2024');
}

function buildDemoVale(v) {
  const g=gestorOf(v.gestorId);
  return ['Bienvenido a "AXONTECH" 🔥','','VALE DEL GESTOR:','',
    `🔸Promotor: ${g?g.name:''}`, '',
    `🔸 Nombre Cliente: ${v.cliente}`,`🔸Teléfono Cliente: ${v.telefono}`,
    `🔸Dirección Cliente: ${v.direccion}`,`🔸Mensajería/ costo: ${v.mensajeria}`,
    `🔸 Artículo y cantidad: ${v.articulo}`,`🔸Precio USD/ zelle: ${v.precioUSD}`,
    `🔸Precio MN: ${v.precioMN}`,`🔸 Vuelto: ${v.vuelto}`,`🔸 Total a pagar: ${v.total}`,'',
    `*Garantía: ${v.garantia}`,`*Fecha y hora de Venta: ${new Date(v.ts).toLocaleString('es-ES')}`,'',
    '🧭Dirección de la tienda:','* Amistad #311 % San Rafael y San José, Centro Habana.','',
    '🚨ATENCIÓN🚨','•   Horarios de atención: 9:00am - 7:00pm.'].join('\n');
}

// ══════════════════════════════════════════
//  MENSAJERO BADGE
// ══════════════════════════════════════════
function updateMensajeroBadge() {
  const pend=getVales().filter(v=>v.status==='pending_payment').length;
  const asgn=getVales().filter(v=>v.status==='assigned').length;
  const b=document.getElementById('mensajeroBadge');
  if(!b)return;
  if(pend>0){
    b.textContent=pend;b.style.display='inline-block';
    b.style.background='var(--red)';
  } else if(asgn>0){
    b.textContent=asgn;b.style.display='inline-block';
    b.style.background='var(--green)';
  } else {
    b.style.display='none';
  }
}

// ══════════════════════════════════════════
//  GESTOR CATALOG
// ══════════════════════════════════════════
function openGestorCatalog() {
  const prods=getProductos().filter(p=>(p.stock||0)>0);
  if(!prods.length){showToast('No hay productos disponibles');return;}
  catalogCatFilter=null;expandedCatalogId=null;
  document.getElementById('catalogSearch').value='';
  renderCatalogCatTabs();renderGestorCatalog();
  document.getElementById('gestorCatalogModal').classList.add('show');
}
function toggleCatalogItem(id){expandedCatalogId=expandedCatalogId===id?null:id;renderGestorCatalog();}
function renderCatalogCatTabs() {
  const cats=getCategorias();
  document.getElementById('catalogCatTabs').innerHTML=
    `<button class="pcat-tab ${catalogCatFilter===null?'active':''}" onclick="setCatalogCat(null)">Todos</button>`+
    cats.map(c=>`<button class="pcat-tab ${catalogCatFilter===c.id?'active':''}" onclick="setCatalogCat(${c.id})">${escapeHTML(c.name)}</button>`).join('');
}
function setCatalogCat(id){catalogCatFilter=id;renderCatalogCatTabs();renderGestorCatalog();}
function renderGestorCatalog() {
  const search=document.getElementById('catalogSearch').value.toLowerCase();
  let prods=getProductos().filter(p=>(p.stock||0)>0);
  if(catalogCatFilter!==null)prods=prods.filter(p=>p.catId===catalogCatFilter);
  if(search)prods=prods.filter(p=>p.name.toLowerCase().includes(search));
  const c=document.getElementById('gestorCatalogList');
  if(!c) return;
  if(!prods.length){c.innerHTML='<div class="es"><div class="es-icon">📦</div><div class="es-text">Sin productos</div></div>';return;}
  c.innerHTML=prods.map(p=>{
    const exp=expandedCatalogId===p.id;
    return `<div style="border:1px solid var(--${exp?'blue':'gray-200'});border-radius:8px;margin-bottom:6px;overflow:hidden;cursor:pointer;transition:border-color .15s;" onclick="toggleCatalogItem(${p.id})">
      <div style="display:flex;align-items:center;gap:10px;padding:8px;">
        ${p.photo?`<img src="${escapeAttr(p.photo)}" style="width:52px;height:52px;object-fit:cover;border-radius:6px;flex-shrink:0;" onerror="this.parentElement.querySelector('img').style.display='none'">`:`<div style="width:52px;height:52px;border-radius:6px;background:var(--gray-100);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;">📦</div>`}
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:13px;color:var(--text);">${escapeHTML(p.name)}</div>
          ${p.precio?`<div style="color:var(--blue);font-weight:700;font-size:12px;margin-top:2px;">${escapeHTML(p.precio)}</div>`:''}
        </div>
        <div style="font-size:13px;color:var(--gray-400);flex-shrink:0;margin-left:4px;">${exp?'▲':'▼'}</div>
      </div>
      ${exp?`<div style="padding:8px 12px 12px;border-top:1px solid var(--gray-200);background:var(--gray-50);">
        ${p.description?`<div style="font-size:12px;color:var(--text-muted);margin-bottom:10px;white-space:pre-line;line-height:1.5;">${escapeHTML(p.description)}</div>`:''}
        <div style="display:flex;flex-wrap:wrap;gap:5px;font-size:11px;">
          <span style="background:var(--blue-lt);color:var(--blue);padding:3px 9px;border-radius:10px;font-weight:700;">📦 Disponibles: ${p.stock}</span>
          ${p.garantia?`<span style="background:var(--gray-100);color:var(--gray-600);padding:3px 9px;border-radius:10px;">🛡️ ${escapeHTML(p.garantia)}</span>`:''}
          ${p.comision?`<span style="background:#f0fdf4;color:var(--green);padding:3px 9px;border-radius:10px;font-weight:600;">Comisión: ${escapeHTML(p.comision)}</span>`:''}
          ${p.puntos?`<span style="background:var(--blue-lt);color:var(--blue);padding:3px 9px;border-radius:10px;">⭐ ${p.puntos} pts</span>`:''}
        </div>
      </div>`:''}
    </div>`;
  }).join('');
}

// ══════════════════════════════════════════
//  ADMIN CATALOG (shared products, no out-of-stock, auto-updates from stock)
// ══════════════════════════════════════════
function renderAdminCatalogCats() {
  const cats=getCategorias();
  const prods=getProductos().filter(p=>(p.stock||0)>0);
  const tabEl=document.getElementById('catalogAdminCatTabs');
  if(!tabEl)return;
  tabEl.innerHTML=`<button class="pcat-tab ${adminCatalogCatFilter===null?'active':''}" onclick="setAdminCatalogCat(null)" style="flex-shrink:0;">Todos (${prods.length})</button>`+
    cats.map(c=>{
      const count=prods.filter(p=>p.catId===c.id).length;
      return count>0?`<button class="pcat-tab ${adminCatalogCatFilter===c.id?'active':''}" onclick="setAdminCatalogCat(${c.id})" style="flex-shrink:0;">${escapeHTML(c.name)} (${count})</button>`:'';
    }).join('');
}
function setAdminCatalogCat(id){adminCatalogCatFilter=id;renderAdminCatalogCats();renderAdminCatalog();}
function renderAdminCatalog() {
  const searchEl=document.getElementById('catalogAdminSearch');
  const search=searchEl?searchEl.value.toLowerCase():'';
  let prods=getProductos().filter(p=>(p.stock||0)>0);
  if(adminCatalogCatFilter!==null)prods=prods.filter(p=>p.catId===adminCatalogCatFilter);
  if(search)prods=prods.filter(p=>p.name.toLowerCase().includes(search)||(p.description||'').toLowerCase().includes(search));
  const c=document.getElementById('catalogAdminGrid');
  if(!c)return;
  if(!prods.length){c.innerHTML='<div class="es"><div class="es-icon">📦</div><div class="es-text">Sin productos disponibles</div></div>';return;}
  c.innerHTML=`<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;">`+
    prods.map(p=>{
      const cat=getCategorias().find(c=>c.id===p.catId);
      return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;transition:box-shadow .2s,transform .15s;" onmouseover="this.style.boxShadow='0 4px 14px rgba(0,0,0,.08)';this.style.transform='translateY(-2px)'" onmouseout="this.style.boxShadow='';this.style.transform=''">
        <div style="height:140px;background:var(--gray-100);display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative;">
          ${p.photo?`<img src="${escapeAttr(p.photo)}" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`:''}
          <div style="${p.photo?'display:none;':''}width:100%;height:100%;align-items:center;justify-content:center;font-size:48px;">📦</div>
          ${cat?`<span style="position:absolute;top:8px;left:8px;background:var(--blue);color:white;padding:2px 8px;border-radius:10px;font-size:9px;font-weight:700;">${escapeHTML(cat.name)}</span>`:''}
        </div>
        <div style="padding:12px;">
          <div style="font-weight:700;font-size:14px;color:var(--text);margin-bottom:4px;">${escapeHTML(p.name)}</div>
          ${p.description?`<div style="font-size:11px;color:var(--text-muted);line-height:1.4;margin-bottom:8px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${escapeHTML(p.description)}</div>`:''}
          ${p.precio?`<div style="font-weight:800;font-size:16px;color:var(--blue);margin-bottom:6px;">${escapeHTML(p.precio)}</div>`:''}
          <div style="display:flex;flex-wrap:wrap;gap:4px;">
            ${p.garantia?`<span style="background:var(--gray-100);color:var(--gray-600);padding:2px 7px;border-radius:8px;font-size:9px;font-weight:600;">🛡️ ${escapeHTML(p.garantia)}</span>`:''}
          </div>
        </div>
      </div>`;
    }).join('')+`</div>`;
}
function shareCatalogWeb(){
  const html=buildCatalogHTML();
  if(!html){showToast('No hay productos para exportar');return;}
  const allProds=getProductos().filter(p=>(p.stock||0)>0);
  // Generate downloadable HTML file
  const blob=new Blob([html],{type:'text/html;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  // Build modal using DOM to avoid template-literal issues with blob URLs
  const overlay=document.createElement('div');
  overlay.className='modal-bg show';
  overlay.style.zIndex='10000';
  const box=document.createElement('div');
  box.className='modal';
  box.style.cssText='max-width:400px;width:90%;text-align:center;';
  box.innerHTML=`
    <div style="font-size:40px;margin-bottom:12px;">🔗</div>
    <div class="modal-title" style="margin-bottom:6px;">Catálogo Generado</div>
    <div style="font-size:12.5px;color:var(--muted,#64748b);margin-bottom:20px;line-height:1.5;">${allProds.length} productos listos para compartir.</div>
    <div style="display:flex;flex-direction:column;gap:8px;" id="catalogShareBtns"></div>
    <div id="catalogPublishedLink" style="display:none;margin-top:14px;"></div>`;
  overlay.appendChild(box);
  // Publish to GitHub button
  const cfg=getConfig();
  const hasGitHub=ghToken()&&cfg.ghRepo;
  if(hasGitHub){
    const ghBtn=document.createElement('button');
    ghBtn.style.cssText='display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:13px;border:none;border-radius:12px;background:linear-gradient(135deg,#24292e,#40464d);color:white;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;';
    ghBtn.innerHTML='☁️ Publicar en GitHub (link compartible)';
    ghBtn.onclick=async()=>{
      ghBtn.disabled=true;ghBtn.innerHTML='⏳ Publicando...';
      const publishedUrl=await publishCatalogToGitHub(html);
      if(publishedUrl){
        ghBtn.innerHTML='✅ Publicado en GitHub';
        ghBtn.style.background='var(--green)';
        const linkDiv=box.querySelector('#catalogPublishedLink');
        linkDiv.style.display='block';
        linkDiv.innerHTML=`
          <div style="font-size:11px;color:var(--gray-400);margin-bottom:6px;">Link compartible (tarda ~1 min en actualizarse):</div>
          <div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:10px;font-size:12px;word-break:break-all;font-weight:600;color:var(--blue);margin-bottom:8px;">${publishedUrl}</div>
          <div style="display:flex;gap:6px;">
            <button class="btn btn-blue btn-sm" style="flex:1;" onclick="navigator.clipboard.writeText('${publishedUrl}').then(()=>showToast('Link copiado ✓'))">📋 Copiar link</button>
            <a class="btn btn-wa btn-sm" style="flex:1;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:4px;" href="https://wa.me/?text=${encodeURIComponent('Mira nuestro catálogo: '+publishedUrl)}" target="_blank">💬 WhatsApp</a>
          </div>`;
      } else {
        ghBtn.innerHTML='☁️ Reintentar Publicar';
        ghBtn.style.background='linear-gradient(135deg,#24292e,#40464d)';
        ghBtn.disabled=false;
      }
    };
    box.querySelector('#catalogShareBtns').appendChild(ghBtn);
  }
  // Download button
  const dlBtn=document.createElement('a');
  dlBtn.href=url;
  dlBtn.download='AXONTECH-Catalogo.html';
  dlBtn.style.cssText='display:block;padding:13px;border-radius:12px;background:linear-gradient(135deg,#006d8a,#00b4d8);color:white;font-size:14px;font-weight:700;text-decoration:none;cursor:pointer;';
  dlBtn.textContent='📥 Descargar HTML';
  // Preview button
  const pvBtn=document.createElement('button');
  pvBtn.style.cssText='padding:13px;border-radius:12px;background:var(--surface2,#f0f4f8);color:var(--text,#1a1a2e);font-size:14px;font-weight:700;border:1px solid var(--border,#e2e8f0);cursor:pointer;';
  pvBtn.textContent='👁️ Previsualizar';
  pvBtn.onclick=()=>{window.open(url,'_blank');};
  // Cancel button
  const ccBtn=document.createElement('button');
  ccBtn.style.cssText='padding:10px;border-radius:10px;background:transparent;color:var(--muted,#64748b);font-size:12px;font-weight:600;border:none;cursor:pointer;';
  ccBtn.textContent='Cerrar';
  ccBtn.onclick=()=>{overlay.remove();};
  // Close on backdrop click
  overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});
  const btnsDiv=box.querySelector('#catalogShareBtns');
  btnsDiv.append(dlBtn,pvBtn,ccBtn);
  document.body.appendChild(overlay);
  // Auto-cleanup URL after 5 minutes
  setTimeout(()=>URL.revokeObjectURL(url),300000);
}
function buildCatalogCardJS(p,cat,color,waPhone){
  const pName=p.name||p.nombre||'';
  const pDesc=p.description||p.descripcion||'';
  let pPrice=p.precio||'';
  if(!pPrice && p.precioActual) pPrice = typeof p.precioActual==='number' ? '$'+p.precioActual+' USD' : p.precioActual;
  const pPhoto=p.photo||p.imagen||(p.imagenes&&p.imagenes.length?p.imagenes[0]:'')||'';
  const pGarantia=p.garantia||'';
  const esc=s=>JSON.stringify(s).replace(/<\//g,'<\\/');
  const waMsg=`Hola, me interesa el producto: ${pName}${pPrice?' - '+pPrice:''}. Esta disponible?`;
  const waLink=waPhone?`https://wa.me/${waPhone}?text=${encodeURIComponent(waMsg)}`:'';
  return `{id:${p.id},catId:${cat?cat.id:0},name:${esc(pName)},desc:${esc(pDesc)},price:${esc(pPrice)},photo:${esc(pPhoto)},catName:${esc(cat?cat.name:'')},catColor:'${color}',garantia:${esc(pGarantia)},waLink:${esc(waLink)}},`;
}

// ══════════════════════════════════════════
//  FOTOS COMO ARCHIVO EN GITHUB (en vez de base64 embebido)
// ══════════════════════════════════════════
// Sube una foto ya comprimida (data URL base64, salida de compressImage) como
// archivo nuevo a la carpeta photos/ del repo, reutilizando el mismo patrón
// PUT de la API de contenidos de GitHub que ya usan syncToGitHub/
// publishCatalogToGitHub. A diferencia de esas funciones, esto SIEMPRE crea
// un archivo con nombre nuevo (timestamp + hash del contenido) — nunca
// sobrescribe uno existente, así que no hace falta el GET previo por el sha.
// Devuelve la ruta relativa ("photos/p-...webp") si se subió bien, o null si
// no hay GitHub configurado o la subida falló — en ese caso el llamador debe
// caer de vuelta a guardar el data URL base64 directo, como se hacía antes.
async function uploadPhotoToGitHub(dataUrl, prefix) {
  const cfg = getConfig();
  if (!ghToken() || !cfg.ghRepo) return null;
  const m = /^data:image\/([a-zA-Z0-9.+-]+);base64,(.*)$/.exec(dataUrl || '');
  if (!m) return null;
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const base64Content = m[2];
  const parts = cfg.ghRepo.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0], repo = parts.slice(1).join('/');
  if ([owner, repo].some(s => /\.\.|[^a-zA-Z0-9._\-\/]/.test(s))) return null;
  // Hash corto del contenido para el nombre — sigue la misma convención
  // (prefix-timestamp-hash.ext) que los archivos ya subidos a mano en photos/.
  let hash8 = Date.now().toString(16);
  try {
    const bytes = Uint8Array.from(atob(base64Content), c => c.charCodeAt(0));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    hash8 = Array.from(new Uint8Array(digest)).slice(0, 4).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (e) { /* fallback al timestamp ya asignado arriba */ }
  const filename = `photos/${prefix}-${Date.now()}-${hash8}.${ext}`;
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${filename}`;
  const headers = { Authorization: `token ${ghToken()}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' };
  try {
    const body = { message: `Foto ${prefix === 'g' ? 'gestor' : 'producto'} · ${new Date().toLocaleString('es-ES')}`, content: base64Content };
    const res = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(body) });
    if (res.ok) return filename;
    console.error('uploadPhotoToGitHub error:', res.status, await res.text().catch(() => ''));
    return null;
  } catch (e) {
    console.error('uploadPhotoToGitHub network error:', e);
    return null;
  }
}

// ══════════════════════════════════════════
//  PUBLISH CATALOG TO GITHUB PAGES
// ══════════════════════════════════════════
// BUGFIX: publishCatalogToGitHub() usaba la API de "Contents" (PUT directo
// de un archivo), que GitHub limita a 1 MB — un límite duro, no negociable.
// Con ~35 productos con descripciones reales (el negocio escribe fichas
// técnicas largas), el catálogo generado YA pesa ~1.05 MB en base64, por
// encima del límite. GitHub rechazaba la publicación (típicamente 400/422
// "too large") y el catálogo publicado se quedaba pegado en la última
// versión que sí cupo — el dueño veía "se publicó" (o un error que no
// asoció con el tamaño) pero la página en línea no reflejaba los productos
// actuales. Cada producto nuevo que se agrega lo empeora, así que no es un
// caso raro — es cuestión de tiempo.
// Fix: usar la Git Data API (blobs + trees + commits) en vez de Contents.
// Un blob soporta hasta 100 MB — sin techo real para este caso de uso.
async function publishCatalogToGitHub(htmlContent) {
  const cfg=getConfig();
  if(!ghToken()||!cfg.ghRepo){showToast('Configura GitHub primero en ⚙️ Config');return null;}
  // v37 FIX CRÍTICO: validar que el JS del catálogo generado parsea sin errores
  // antes de publicarlo. ANTES, un regex roto en el HTML inline provocaba
  // SyntaxError al cargar el catálogo → ningún producto se mostraba →
  // "el catálogo sale bien al principio pero al rato deja de mostrar productos"
  // (cuando expiraba el cache del navegador).
  try {
    const scriptMatch = htmlContent.match(/<script>([\s\S]*?)<\/script>/);
    if (scriptMatch) {
      // new Function lanza SyntaxError si el código no parsea
      new Function(scriptMatch[1]);
    }
  } catch(e) {
    console.error('[catalog] JS del catálogo no parsea — NO se publica:', e.message);
    showToast('❌ El catálogo generado tiene un error de sintaxis. No se publicó. Revisa buildCatalogHTML.');
    return null;
  }
  const catalogPath='catalogo.html';
  // Validate repo format (owner/repo) — reject path traversal
  const parts=cfg.ghRepo.split('/').filter(Boolean);
  if(parts.length < 2){showToast('Formato de repo inválido. Use: usuario/repositorio');return null;}
  const owner=parts[0];const repo=parts.slice(1).join('/');
  if([owner,repo].some(s => /\.\.|[^a-zA-Z0-9._\-\/]/.test(s))){showToast('Nombre de repo contiene caracteres inválidos');return null;}
  const headers={Authorization:`token ${ghToken()}`,Accept:'application/vnd.github.v3+json','Content-Type':'application/json'};
  const api=`https://api.github.com/repos/${owner}/${repo}`;
  try {
    // 1. Rama por defecto + último commit de esa rama.
    const repoRes=await fetch(api,{headers});
    if(!repoRes.ok){
      if(repoRes.status===401)showToast('❌ Token inválido o expirado. Genera uno nuevo en GitHub Settings → Developer settings → Personal access tokens');
      else if(repoRes.status===404)showToast('❌ Repo no encontrado. Verifica el formato: usuario/nombre-repo');
      else showToast(`Error al publicar (${repoRes.status}) obteniendo el repo`);
      return null;
    }
    const repoInfo=await repoRes.json();
    const branch=repoInfo.default_branch||'main';
    const refRes=await fetch(`${api}/git/refs/heads/${encodeURIComponent(branch)}`,{headers});
    if(!refRes.ok){showToast(`Error al publicar (${refRes.status}) leyendo la rama ${branch}`);return null;}
    const refInfo=await refRes.json();
    const latestCommitSha=refInfo.object.sha;
    // 2. Árbol base del último commit.
    const commitRes=await fetch(`${api}/git/commits/${latestCommitSha}`,{headers});
    if(!commitRes.ok){showToast(`Error al publicar (${commitRes.status}) leyendo el commit base`);return null;}
    const commitInfo=await commitRes.json();
    const baseTreeSha=commitInfo.tree.sha;
    // 3. Blob con el HTML completo — sin el límite de 1MB de la API de Contents.
    const blobRes=await fetch(`${api}/git/blobs`,{method:'POST',headers,body:JSON.stringify({content:utf8ToBase64(htmlContent),encoding:'base64'})});
    if(!blobRes.ok){
      const err=await blobRes.json().catch(()=>({}));
      showToast(`❌ Error subiendo el catálogo (${blobRes.status}): ${err.message||''}`);
      console.error('GitHub blob error:',blobRes.status,err);
      return null;
    }
    const blobInfo=await blobRes.json();
    // 4. Árbol nuevo: mismo árbol base, solo reemplazando catalogo.html.
    const treeRes=await fetch(`${api}/git/trees`,{method:'POST',headers,body:JSON.stringify({base_tree:baseTreeSha,tree:[{path:catalogPath,mode:'100644',type:'blob',sha:blobInfo.sha}]})});
    if(!treeRes.ok){showToast(`Error al publicar (${treeRes.status}) creando el árbol`);return null;}
    const treeInfo=await treeRes.json();
    // 5. Commit nuevo apuntando al árbol nuevo.
    const newCommitRes=await fetch(`${api}/git/commits`,{method:'POST',headers,body:JSON.stringify({message:`Catalogo AXONTECH ${new Date().toLocaleString('es-ES')}`,tree:treeInfo.sha,parents:[latestCommitSha]})});
    if(!newCommitRes.ok){showToast(`Error al publicar (${newCommitRes.status}) creando el commit`);return null;}
    const newCommitInfo=await newCommitRes.json();
    // 6. Mover la rama al commit nuevo.
    const updateRefRes=await fetch(`${api}/git/refs/heads/${encodeURIComponent(branch)}`,{method:'PATCH',headers,body:JSON.stringify({sha:newCommitInfo.sha})});
    if(!updateRefRes.ok){
      const err=await updateRefRes.json().catch(()=>({}));
      if(updateRefRes.status===403)showToast('❌ Sin permisos. El token necesita permiso "repo" (full control)');
      else showToast(`Error al publicar (${updateRefRes.status}): ${err.message||''}`);
      return null;
    }
    return `https://${owner}.github.io/${repo}/${catalogPath}`;
  } catch(e) {
    console.error('publishCatalogToGitHub network error:',e);
    showToast('Error de red publicando el catálogo');
    return null;
  }
}

async function testGitHubPages() {
  const cfg=getConfig();
  if(!ghToken()||!cfg.ghRepo){showToast('Configura GitHub primero');return;}
  const parts=cfg.ghRepo.split('/');const owner=parts[0];const repo=parts.slice(1).join('/');
  setGhStatus('🧪 Probando conexión...');
  let results=[];
  // 1. Test repo access
  try{
    const r=await fetch(`https://api.github.com/repos/${owner}/${repo}`,{headers:{Authorization:`token ${ghToken()}`,Accept:'application/vnd.github.v3+json'}});
    if(r.ok){const j=await r.json();results.push(`✅ Repo encontrado: ${j.full_name} (${j.private?'privado':'público'})`);}
    else if(r.status===401){results.push('❌ Token inválido o expirado');}
    else if(r.status===404){results.push('❌ Repo no encontrado. Verifica: '+cfg.ghRepo);}
    else{results.push(`⚠️ Repo respondió con status ${r.status}`);}
  }catch(e){results.push('❌ Error de red: '+e.message);}
  // 2. Test if catalogo.html exists in repo
  try{
    const r2=await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/catalogo.html`,{headers:{Authorization:`token ${ghToken()}`,Accept:'application/vnd.github.v3+json'}});
    if(r2.ok){const j2=await r2.json();results.push(`✅ catalogo.html existe en repo (${(j2.size/1024).toFixed(1)} KB, actualizado: ${j2.updatedAt||j2.updated_at||'?'})`);}
    else{results.push('⚠️ catalogo.html NO existe en el repo. Necesitas publicar primero.');}
  }catch(e){results.push('⚠️ No se pudo verificar catalogo.html');}
  // 3. Test GitHub Pages URL
  const pagesUrl=`https://${owner}.github.io/${repo}/catalogo.html`;
  results.push(`🔗 URL del catálogo: <a href="${pagesUrl}" target="_blank" style="color:var(--blue);word-break:break-all;">${pagesUrl}</a>`);
  setGhStatus(results.map(r=>`<div style="margin-bottom:3px;">${r}</div>`).join(''));
}

async function publishCatalogNow() {
  const cfg=getConfig();
  if(!ghToken()||!cfg.ghRepo){showToast('Configura GitHub primero');return;}
  setGhStatus('☁️ Generando y publicando catálogo...');
  const html=buildCatalogHTML();
  if(!html){showToast('No hay productos con stock para publicar');setGhStatus('');return;}
  const url=await publishCatalogToGitHub(html);
  if(url){
    showToast('✅ Catálogo publicado exitosamente');
    // BUGFIX: el link de catalogo.html no tenía ningún parámetro que cambie
    // entre publicaciones — a diferencia de app.js/app.css (?v=N), así que
    // el navegador (o el CDN de GitHub Pages) podía seguir sirviendo una
    // copia vieja en caché durante varios minutos después de publicar,
    // aunque el archivo real ya estuviera actualizado. Esto generaba
    // confusión: "publiqué pero sigue sin cargar los productos" cuando en
    // realidad SÍ se publicó bien, solo que el link mostraba la versión
    // cacheada. Se agrega un ?t=timestamp único a ESTE link de verificación
    // para forzar que el propio admin vea la versión recién publicada.
    const verifyUrl = `${url}?t=${Date.now()}`;
    setGhStatus(`✅ Publicado. Para verificar (evita caché): <a href="${verifyUrl}" target="_blank" style="color:var(--blue);word-break:break-all;">${verifyUrl}</a><br><span style="font-size:10px;color:var(--gray-400);">El link normal para compartir es: ${url}<br>GitHub Pages puede tardar 1-2 min en actualizarse — si acabas de publicar, espera un poco antes de verificar.</span>`);
  } else {
    setGhStatus('❌ Error al publicar. Revisa el token y el repo.');
  }
}
// Keep PDF export as secondary option
function exportCatalogPDF(){
  shareCatalogWeb();
}

// ══════════════════════════════════════════
//  COMISIONES
// ══════════════════════════════════════════
function toggleComisionGestor(id) {
  activeComisionGestorId=activeComisionGestorId===id?null:id;
  renderComisiones();
}
function getValeCommissionParts(v) {
  const items=v.valeProductos||[];
  const parts=[];
  let totalUSD=0,totalMN=0;let computable=true;
  items.forEach(({id,qty})=>{
    const p=productoOf(id);
    if(!p){
      // Producto borrado del catálogo — la comisión no se puede calcular.
      // Marcamos como no computable para avisar al gestor/admin, en vez de
      // silently saltarlo. Ver AUDITORIA-AXONTECH.md ALTO 11.
      computable=false;
      parts.push({label:`Producto #${id} (borrado)`,com:'?',currency:'USD'});
      return;
    }
    const com=p.comision||'';
    if(!com)return;
    const label=`${p.name}${qty>1?` ×${qty}`:''}`;
    // Determine currency for this product's commission
    const comUpper=(com+'').toUpperCase();
    const isMN=comUpper.includes('MN')||comUpper.includes('CUP');
    // Also check comisionMoneda field for numeric commissions
    const moneda=p.comisionMoneda||'';
    const useMN=isMN||moneda.toUpperCase()==='MN';
    // Check if precio is in MN (fallback for percentage)
    const precioMN=(p.precio||'').toUpperCase().includes('MN');
    const isPct=com.includes('%');
    if(isPct){
      const pct=parseFloat(com.replace(/[^0-9.]/g,''));
      const priceNum=parsePrecioNum(p.precio||'');
      if(!isNaN(pct)&&priceNum>0){
        const amt=Math.round(priceNum*(pct/100)*qty*100)/100;
        const curLabel=useMN||precioMN?'MN':'USD';
        if(curLabel==='MN')totalMN+=amt;else totalUSD+=amt;
        parts.push({label,com:`${pct}% = ${curLabel==='MN'?Math.round(amt)+' MN':'$'+amt.toFixed(2)+' USD'}`,currency:curLabel});
      } else {
        parts.push({label,com,currency:useMN?'MN':'USD'});computable=false;
      }
    } else {
      const num=parsePrecioNum(com);
      if(num>0){
        const curLabel=useMN?'MN':'USD';
        const total=num*qty;
        if(curLabel==='MN')totalMN+=total;else totalUSD+=total;
        parts.push({label,com:`${com}${qty>1?` ×${qty}`:''}`,currency:curLabel});
      } else {
        parts.push({label,com,currency:useMN?'MN':'USD'});computable=false;
      }
    }
  });
  // v11 FIX CRÍTICO: si el cálculo por producto falló (sin comisión en
  // productos, producto borrado, etc.) usar v.comisionGestor como fallback.
  // El gestor llena este campo al enviar el vale, y viaja a Supabase correctamente.
  // ANTES, getValeCommissionParts ignoraba completamente v.comisionGestor →
  // si el producto no tenía comisión configurada, mostraba "Sin comisión" aunque
  // el vale tuviera el campo comisionGestor con un valor válido.
  if ((!computable || parts.length === 0) && v.comisionGestor) {
    const comStr = String(v.comisionGestor).trim();
    // Parsear comisionGestor: puede ser "$5.00 USD", "1500 MN", "$5 USD + 200 MN", etc.
    const segments = comStr.split('+').map(s => s.trim()).filter(Boolean);
    let fbUSD = 0, fbMN = 0, fbOk = false;
    segments.forEach(seg => {
      const up = seg.toUpperCase();
      const num = parsePrecioNum(seg);
      if (up.includes('MN') || up.includes('CUP')) {
        if (num > 0) { fbMN += num; fbOk = true; }
      } else if (up.includes('USD') || up.includes('$')) {
        if (num > 0) { fbUSD += num; fbOk = true; }
      } else if (num > 0) {
        fbUSD += num; fbOk = true; // default USD
      }
    });
    if (fbOk) {
      totalUSD = fbUSD;
      totalMN = fbMN;
      computable = true;
      parts.push({ label: 'Comisión (vale)', com: comStr, currency: fbMN > 0 && fbUSD === 0 ? 'MN' : 'USD' });
    }
  }

  return{parts,totalUSD:computable&&parts.length?totalUSD:null,totalMN:computable&&parts.length?totalMN:null,
    // Backward compat: total + currency for single-currency vales.
    // IMPORTANTE: si hay comisión mixta USD+MN, devolver null en total — que el
    // llamador use fmtComisionBadge(totalUSD, totalMN, true) que muestra "$X USD + Y MN".
    // Antes sumaba USD+MN como si fueran la misma moneda → "$505 USD" erróneo.
    // Ver AUDITORIA-AXONTECH.md ALTO 10.
    get total(){
      const hasUSD = this.totalUSD !== null && this.totalUSD > 0;
      const hasMN  = this.totalMN  !== null && this.totalMN  > 0;
      if (hasUSD && hasMN) return null;   // mixto → llamador muestra las dos partes
      if (hasUSD) return this.totalUSD;
      if (hasMN)  return this.totalMN;
      return null;
    },
    get isMixed(){
      return (this.totalUSD !== null && this.totalUSD > 0) &&
             (this.totalMN  !== null && this.totalMN  > 0);
    },
    get currency(){
      if(this.totalMN!==null&&this.totalMN>0&&(!this.totalUSD||this.totalUSD===0))return 'MN';
      return 'USD';
    }
  };
}
function markCommissionEnSobre(valeId,e) {
  if(e)e.stopPropagation();
  patchVale(valeId,{commissionPaid:false,commissionStatus:'en_sobre',commissionEnSobreTs:new Date().toISOString()});
  gestoresTabDirty=true;
  renderComisiones();maybeAutoSync();
  showToast('Comisión marcada como En Sobre ✉️');
}
function markCommissionCobrado(valeId,e) {
  if(e)e.stopPropagation();
  patchVale(valeId,{commissionPaid:true,commissionStatus:'cobrado',commissionPaidTs:new Date().toISOString()});
  gestoresTabDirty=true;
  renderComisiones();maybeAutoSync();
  showToast('Comisión marcada como Cobrado 💰');
}
function payCommission(valeId,e) {
  // Legacy: kept for compatibility, now marks as cobrado
  markCommissionCobrado(valeId,e);
}
function markAllCommissionsEnSobre(gestorId,e) {
  if(e)e.stopPropagation();
  const ts=new Date().toISOString();
  // Una sola escritura de todo el array, no N patchVale (que eran N subidas a Firebase).
  // Ver AUDITORIA-AXONTECH.md MEDIO 21.
  // BUGFIX: getVales() devuelve la MISMA referencia que _valesCache — mutar
  // los vales EN EL LUGAR (v.commissionPaid=...) los cambiaba dentro de
  // _valesCache antes de llamar a saveVales(), así que su diff interno
  // comparaba "antes" contra "ahora" viendo el mismo objeto ya modificado
  // → nunca detectaba el cambio → el marcado de comisiones nunca se subía
  // a Firestore (aunque se viera bien localmente). Fix: construir objetos
  // y array nuevos con .map(), sin tocar los que ya están en el caché.
  let changed=false;
  const all=getVales().map(v=>{
    if(Number(v.gestorId)===Number(gestorId)&&!v.commissionPaid&&v.commissionStatus!=='en_sobre'&&v.commissionStatus!=='cobrado'&&['confirmed','pending_payment'].includes(v.status)){
      changed=true;
      return {...v, commissionPaid:false, commissionStatus:'en_sobre', commissionEnSobreTs:ts};
    }
    return v;
  });
  if(changed) saveVales(all);
  gestoresTabDirty=true;
  renderComisiones();maybeAutoSync();
  showToast('Todas las comisiones marcadas En Sobre ✉️');
}
function markAllCommissionsCobrado(gestorId,e) {
  if(e)e.stopPropagation();
  const ts=new Date().toISOString();
  // Una sola escritura de todo el array, no N patchVale.
  // BUGFIX: ver el comentario detallado en markAllCommissionsEnSobre() —
  // mismo problema, mismo fix (.map() en vez de mutar en el lugar).
  let changed=false;
  const all=getVales().map(v=>{
    if(Number(v.gestorId)===Number(gestorId)&&!v.commissionPaid&&['confirmed','pending_payment'].includes(v.status)){
      changed=true;
      return {...v, commissionPaid:true, commissionStatus:'cobrado', commissionPaidTs:ts};
    }
    return v;
  });
  if(changed) saveVales(all);
  gestoresTabDirty=true;
  renderComisiones();maybeAutoSync();
  showToast('Todas las comisiones marcadas Cobrado 💰');
}
function payAllCommissions(gestorId,e) {
  // Legacy: kept for compatibility, now marks all as cobrado
  markAllCommissionsCobrado(gestorId,e);
}
function unpayCommission(valeId,e) {
  if(e)e.stopPropagation();
  patchVale(valeId,{commissionPaid:false,commissionStatus:null,commissionPaidTs:null,commissionEnSobreTs:null});
  gestoresTabDirty=true;
  renderComisiones();
}
// Helper: sum commissions from vales, returns {usd, mn, computed}
function sumCommissions(vales) {
  let usd=0,mn=0,computed=true;
  vales.forEach(v=>{
    const r=getValeCommissionParts(v);
    if(r.totalUSD===null&&r.totalMN===null){computed=false;}
    else{if(r.totalUSD!==null)usd+=r.totalUSD;if(r.totalMN!==null)mn+=r.totalMN;}
  });
  return{usd,mn,computed};
}
function fmtComisionBadge(usd,mn,computed) {
  if(!computed)return null;
  const p=[];if(usd>0)p.push(`$${usd.toFixed(2)} USD`);if(mn>0)p.push(`${Math.round(mn)} MN`);
  return p.length?p.join(' + '):null;
}
// Las comisiones ahora viven DENTRO de la tarjeta de cada gestor (ver
// renderAdminGestoresList) en vez de en una lista aparte que repetía cada
// nombre otra vez. Se deja esta función como alias — la llaman ~15 sitios
// distintos cada vez que cambia el estado de una comisión.
function renderComisiones() { renderAdminGestoresList(); }
function renderComisionBody(g,pendientes,enSobre,cobrados) {
  let html='<div style="border-top:1px solid var(--border);padding:12px 14px;">';
  if(!pendientes.length&&!enSobre.length&&!cobrados.length){
    html+='<div class="es" style="padding:8px 0;"><div class="es-text">Sin vales confirmados con comisión</div></div>';
  } else {
    // ── PENDIENTES ──
    if(pendientes.length){
      const s=sumCommissions(pendientes);
      const sumBadge=fmtComisionBadge(s.usd,s.mn,s.computed);
      html+=`<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:6px;">
        <span style="font-size:11px;font-weight:700;color:var(--orange);text-transform:uppercase;letter-spacing:.5px;">⏳ Pendientes (${pendientes.length})</span>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          ${sumBadge?`<span style="font-size:13px;font-weight:800;color:var(--green);">💵 ${sumBadge}</span>`:''}
          ${pendientes.length>1?`<button class="btn btn-sm" style="background:var(--yellow);color:white;flex-shrink:0;" onclick="markAllCommissionsEnSobre(${g.id},event)">✉️ Todo al sobre</button>`:''}
        </div>
      </div>`;
      html+=pendientes.map(v=>{
        const r=getValeCommissionParts(v);
        const vBadge=fmtComisionBadge(r.totalUSD||0,r.totalMN||0,r.totalUSD!==null||r.totalMN!==null);
        return `<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--surface2);border:1px solid var(--border);border-radius:9px;margin-bottom:6px;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;font-weight:700;color:var(--text);">${escapeHTML(v.cliente||'—')}</div>
            <div style="font-size:10px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHTML(v.articulo||'—')}</div>
            <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;">
              ${r.parts.length?r.parts.map(p=>`<span style="background:rgba(16,185,129,.12);color:var(--green);border-radius:20px;padding:1px 8px;font-size:10px;font-weight:600;">${escapeHTML(p.label)}: ${escapeHTML(p.com)}</span>`).join(''):`<span style="color:var(--gray-400);font-size:10px;">Sin comisión definida</span>`}
            </div>
            ${vBadge?`<div style="margin-top:4px;font-size:12px;font-weight:800;color:var(--green);">= ${vBadge}</div>`:''}
          </div>
          <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;">
            <button class="btn btn-sm" style="background:var(--yellow);color:white;" onclick="markCommissionEnSobre(${v.id},event)">✉️ En sobre</button>
            <button class="btn btn-green btn-sm" onclick="markCommissionCobrado(${v.id},event)">💰 Cobrado</button>
          </div>
        </div>`;
      }).join('');
    }
    // ── EN SOBRE ──
    if(enSobre.length){
      const s=sumCommissions(enSobre);
      const sumBadge=fmtComisionBadge(s.usd,s.mn,s.computed);
      html+=`<div style="margin-top:${pendientes.length?'14px':'0'};">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:6px;">
          <span style="font-size:11px;font-weight:700;color:var(--yellow);text-transform:uppercase;letter-spacing:.5px;">✉️ En sobre (${enSobre.length})</span>
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            ${sumBadge?`<span style="font-size:13px;font-weight:800;color:var(--green);">💵 ${sumBadge}</span>`:''}
            ${enSobre.length>1?`<button class="btn btn-green btn-sm" onclick="markAllCommissionsCobrado(${g.id},event)">💰 Cobrar todas</button>`:''}
          </div>
        </div>`;
      html+=enSobre.map(v=>{
        const r=getValeCommissionParts(v);
        const vBadge=fmtComisionBadge(r.totalUSD||0,r.totalMN||0,r.totalUSD!==null||r.totalMN!==null);
        const ts=v.commissionEnSobreTs?new Date(v.commissionEnSobreTs).toLocaleDateString('es-ES',{day:'2-digit',month:'short'})+' '+timeStr(v.commissionEnSobreTs):'';
        return `<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:rgba(245,158,11,.06);border:1px solid rgba(245,158,11,.25);border-radius:9px;margin-bottom:6px;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;font-weight:700;color:var(--text);">${escapeHTML(v.cliente||'—')}</div>
            <div style="font-size:10px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHTML(v.articulo||'—')}</div>
            <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;">
              ${r.parts.length?r.parts.map(p=>`<span style="background:rgba(245,158,11,.12);color:var(--yellow);border-radius:20px;padding:1px 8px;font-size:10px;font-weight:600;">${escapeHTML(p.label)}: ${escapeHTML(p.com)}</span>`).join(''):`<span style="color:var(--gray-400);font-size:10px;">Sin comisión definida</span>`}
            </div>
            ${vBadge?`<div style="margin-top:4px;font-size:12px;font-weight:800;color:var(--yellow);">= ${vBadge}</div>`:''}
          </div>
          <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;text-align:right;">
            <span style="font-size:9px;color:var(--yellow);font-weight:700;">✉️ En sobre</span>
            ${ts?`<div style="font-size:9px;color:var(--gray-400);">${ts}</div>`:''}
            <button class="btn btn-green btn-sm" onclick="markCommissionCobrado(${v.id},event)">💰 Cobrado</button>
            <button class="btn btn-ghost btn-sm" style="font-size:10px;padding:3px 8px;color:var(--orange);" onclick="unpayCommission(${v.id},event)">↩ Pendiente</button>
          </div>
        </div>`;
      }).join('');
      html+='</div>';
    }
    // ── COBRADOS ──
    if(cobrados.length){
      const s=sumCommissions(cobrados);
      const sumBadge=fmtComisionBadge(s.usd,s.mn,s.computed);
      html+=`<div style="margin-top:${pendientes.length||enSobre.length?'14px':'0'};">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <span style="font-size:10px;font-weight:700;color:var(--green);text-transform:uppercase;letter-spacing:.5px;">💰 Cobrados (${cobrados.length})</span>
          ${sumBadge?`<span style="font-size:11px;font-weight:800;color:var(--green);">💵 ${sumBadge}</span>`:''}
        </div>`;
      html+=cobrados.map(v=>{
        const r=getValeCommissionParts(v);
        const ts=v.commissionPaidTs?new Date(v.commissionPaidTs).toLocaleDateString('es-ES',{day:'2-digit',month:'short'})+' '+timeStr(v.commissionPaidTs):'';
        return `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:rgba(16,185,129,.05);border:1px solid rgba(16,185,129,.2);border-radius:8px;margin-bottom:4px;opacity:.85;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:11px;font-weight:600;color:var(--text-muted);">${escapeHTML(v.cliente||'—')}</div>
            ${r.parts.length?`<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:2px;">${r.parts.map(p=>`<span style="background:rgba(16,185,129,.1);color:var(--green);border-radius:20px;padding:1px 7px;font-size:9px;font-weight:600;">${escapeHTML(p.com)}</span>`).join('')}</div>`:''}
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <div style="font-size:9px;color:var(--green);font-weight:700;">💰 Cobrado</div>
            ${ts?`<div style="font-size:9px;color:var(--gray-400);">${ts}</div>`:''}
            <button class="btn btn-ghost btn-sm" style="font-size:10px;padding:3px 8px;margin-top:4px;color:var(--orange);" onclick="unpayCommission(${v.id},event)">↩ Pendiente</button>
          </div>
        </div>`;
      }).join('');
      html+='</div>';
    }
  }
  html+='</div>';
  return html;
}

// ══════════════════════════════════════════
//  GESTOR RANKING
// ══════════════════════════════════════════
function renderGestorRanking() {
  const c=document.getElementById('rankingList');if(!c)return;
  const gestores=getGestores();
  if(!gestores.length){c.innerHTML='<div class="es"><div class="es-text">Sin gestores configurados</div></div>';return;}
  const meta=getConfig().metaPuntos||0;
  if(rankingCache&&(Date.now()-rankingCache.ts<15000)){c.innerHTML=rankingCache.html;return;}
  
  // El admin calcula 'ranking_summary' (puntos por gestor) a partir del árbol
  // COMPLETO de vales y lo sincroniza a Firebase (ver el listener de 'vales' del
  // admin, más arriba). Un dispositivo de gestor NUNCA tiene en su caché local
  // (getVales()) los vales de los DEMÁS gestores — listenToMyVales() solo escucha
  // vales/{suPropioId} — así que recalcular "summary" desde getVales() aquí (como
  // se hacía antes) daba 0 pts para todos los gestores excepto el que tenía la
  // sesión abierta: el ranking estaba roto para todo el mundo salvo uno mismo.
  let summary = [];
  try { summary = JSON.parse(localStorage.getItem('axon_ranking_summary') || '[]'); } catch(e) { summary = []; }
  if (!Array.isArray(summary)) summary = [];

  const ranked=gestores.map(g=>{
    const s = summary.find(x => Number(x.id) === Number(g.id));
    return {...g, pts: s ? s.pts : 0};
  }).sort((a,b)=>b.pts-a.pts);
  const medals=['🥇','🥈','🥉'];
  const barGradients=[
    'linear-gradient(90deg,#F59E0B,#EF4444)',
    'linear-gradient(90deg,#94A3B8,#64748B)',
    'linear-gradient(90deg,#cd7f32,#b36200)',
    'linear-gradient(90deg,#00b4d8,#0284c7)',
    'linear-gradient(90deg,#6366f1,#818cf8)',
    'linear-gradient(90deg,#ec4899,#f472b6)',
  ];
  const maxRef=meta>0?meta:Math.max(ranked[0]?.pts||1,1);
  let html='';
  if(meta>0){
    const reached=ranked.filter(g=>g.pts>=meta).length;
    html+=`<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid var(--gray-200);">
      <span style="font-size:11px;font-weight:700;color:var(--gray-400);text-transform:uppercase;letter-spacing:.5px;">🎯 Meta: ${meta} pts</span>
      <span style="font-size:11px;font-weight:600;color:${reached>0?'var(--green)':'var(--gray-400)'};">${reached}/${ranked.length} alcanzaron</span>
    </div>`;
  }
  html+=ranked.map((g,i)=>{
    const pct=maxRef>0?Math.min(100,Math.round((g.pts/maxRef)*100)):0;
    const reached=meta>0&&g.pts>=meta;
    const grad=reached?'linear-gradient(90deg,var(--green),#10B981)':barGradients[Math.min(i,barGradients.length-1)];
    // Posiciones: medallas para top 3 (más compactas), número pequeño para el resto
    const pos=i<3?medals[i]:`<span style="font-size:11px;font-weight:700;color:var(--gray-400);">${i+1}</span>`;
    // Hint compacto — solo si NO es "faltan X pts" (esos ya los indica la barra)
    let hint='';
    if(reached){hint='<span style="color:var(--green);font-weight:700;">✓ Meta</span>';}
    else if(meta===0&&g.pts===0){hint='<span style="color:var(--gray-400);">Sin puntos</span>';}
    else if(meta===0&&g.pts>0){hint=`<span style="color:var(--gray-400);">${pct}% del líder</span>`;}
    // Si meta>0 y no reached, NO mostramos hint (la barra + número ya dicen todo)
    return `<div class="rank-row">
      <div class="rank-pos">${pos}</div>
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:6px;">
          <div class="g-avatar" style="background:${g.color};width:26px;height:26px;font-size:10px;flex-shrink:0;">${escapeHTML(g.initials)}</div>
          <span class="rank-name" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHTML(g.name)}</span>
          <span class="rank-pts" style="${reached?'color:var(--green);':''}flex-shrink:0;">${g.pts} pts</span>
          ${hint?`<span style="font-size:9px;flex-shrink:0;">${hint}</span>`:''}
        </div>
        <div class="rank-bar-wrap" style="margin-top:4px;"><div class="rank-bar" style="width:${pct}%;background:${grad};"></div></div>
      </div>
    </div>`;
  }).join('');
  c.innerHTML=html;
  rankingCache={html,ts:Date.now()};
}

// ══════════════════════════════════════════
//  GITHUB SYNC
// ══════════════════════════════════════════
function exportData() {
  const cfg=getConfig();
  const data={
    gestores:getGestores(),mensajeros:getMensajeros(),
    productos:getProductos(),categorias:getCategorias(),
    vales:getVales(),notifs:getNotifs(),
    estafa:getEstafa(),
    // Include config but EXCLUDE ghToken for security — never export the token
    config:{...cfg, ghToken: undefined},
    timestamp:new Date().toISOString(),version:2
  };
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=`axontech-data-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Datos exportados ✓ (sin token GitHub por seguridad)');
}
function importData(input) {
  const file=input.files[0];if(!file)return;
  if(!confirm(`¿Importar datos desde \"${file.name}\"?\nEsto reemplazará todos los datos locales actuales.`)){input.value='';return;}
  const reader=new FileReader();
  reader.onload=e=>{
    try {
      const data=JSON.parse(e.target.result);
      if(data.gestores)saveGestores(data.gestores);
      if(data.mensajeros)saveMensajeros(data.mensajeros);
      if(data.productos)saveProductos(data.productos);
      if(data.categorias)saveCategorias(data.categorias);
      if(data.vales) {
        // saveVales already enqueues the write to Firebase via _enqueueFB — no direct db.ref().set()
        saveVales(data.vales);
      }
      if(data.notifs)saveNotifs(data.notifs);
      if(data.config){
        // Merge config to avoid wiping ghToken etc if backup is older
        const cur=getConfig();
        const merged={...cur, ...data.config};
        // Don't restore ghToken from backup — keep current (could be stale or compromised)
        merged.ghToken = cur.ghToken;
        saveConfig(merged);
      }
      _logAudit('data_imported', 'file:' + file.name);
      // Reload UI
      activeGestorId=null;activeMensajeroId=null;selectedValeId=null;adminGestorFilter=null;
      expandedCatalogId=null;activeComisionGestorId=null;adminCatalogCatFilter=null;
      rankingCache=null;gestoresTabDirty=true;statsTabDirty=true;
      renderGestores();renderGestorRanking();renderGestorNotifs();
      renderAdminGestores();renderValeDetail();
      renderAdminGestoresList();renderComisiones();
      renderMensajeros();renderMensajeroSelector();
      renderStockCategorias();renderProductGrid();
      updateAdminBadge();updateMensajeroBadge();
      showToast('Datos importados correctamente ✓');
    } catch(err) {
      showToast('Error: archivo JSON inválido');
    }
    input.value='';
  };
  reader.readAsText(file);
}
function saveMetaPuntos() {
  const val=parseInt(document.getElementById('cfg-meta-puntos').value);
  if(!val||val<1){showToast('Ingresa un número válido');return;}
  const cfg=getConfig();cfg.metaPuntos=val;saveConfig(cfg);
  const s=document.getElementById('metaPuntosStatus');
  if(s)s.innerHTML=`<span style="color:var(--green);">✓ Meta fijada en ${val} pts</span>`;
  renderGestorRanking();
  maybeAutoSync();
  showToast(`Meta fijada: ${val} puntos ⭐`);
}
function saveGhConfig() {
  const cfg=getConfig();
  // El token NUNCA va a Firebase — solo localStorage de este dispositivo.
  // Evita que gestores u otros dispositivos lo lean del nodo config sincronizado.
  const tok=document.getElementById('gh-token').value.trim();
  if(tok) _safeSetLS('axon_gh_token', tok);
  else { try { localStorage.removeItem('axon_gh_token'); } catch(e){} }
  // Limpia el campo ghToken del config cache por si quedó de versiones anteriores
  // (no hace falta borrarlo explícitamente — saveConfig ya guarda cfg sin ese campo)
  if (cfg.ghToken !== undefined) delete cfg.ghToken;
  cfg.ghRepo=document.getElementById('gh-repo').value.trim();
  cfg.ghPath=document.getElementById('gh-path').value.trim()||'data.json';
  cfg.ghAutoSync=document.getElementById('gh-autosync').checked;
  cfg.ghAutoPublishCatalog=document.getElementById('gh-auto-publish-catalog')?.checked||false;
  saveConfig(cfg);
  showToast('Configuración GitHub guardada ✓');
}
// Muestra/oculta el token en el campo de password.
// El ojo 👁️ permite verlo temporalmente si necesitas verificar que lo pegaste bien.
function toggleTokenVisibility() {
  const inp = document.getElementById('gh-token');
  if (!inp) return;
  inp.type = inp.type === 'password' ? 'text' : 'password';
}
// Guarda la config de GitHub y sube los datos inmediatamente.
// Antes "Subir ahora" llamaba syncToGitHub() directo, pero si el usuario había
// cambiado el token en el campo sin hacer "Guardar config", se usaba el token
// viejo de localStorage → error de autenticación 401.
function saveAndSyncGitHub() {
  saveGhConfig();
  // Pequeño delay para que _safeSetLS se complete antes de leer ghToken()
  setTimeout(() => syncToGitHub(false), 200);
}
function loadGhConfigUI() {
  const cfg=getConfig();
  const tok=document.getElementById('gh-token');
  const repo=document.getElementById('gh-repo');
  const path=document.getElementById('gh-path');
  const auto=document.getElementById('gh-autosync');
  const meta=document.getElementById('cfg-meta-puntos');
  const metaStatus=document.getElementById('metaPuntosStatus');
  if(tok)tok.value=ghToken();
  if(repo)repo.value=cfg.ghRepo||'';
  if(path)path.value=cfg.ghPath||'data.json';
  if(auto)auto.checked=!!cfg.ghAutoSync;
  const autoPub=document.getElementById('gh-auto-publish-catalog');
  if(autoPub)autoPub.checked=!!cfg.ghAutoPublishCatalog;
  if(meta)meta.value=cfg.metaPuntos||'';
  if(metaStatus&&cfg.metaPuntos)metaStatus.innerHTML=`<span style="color:var(--green);">✓ Meta actual: ${cfg.metaPuntos} pts</span>`;
}
// ── Modo mantenimiento ──
// Usado para cortar tráfico de forma segura durante la migración a Firestore
// (o cualquier otra ventana de mantenimiento futura): mientras está activo,
// sendVale() rechaza nuevos vales con un aviso claro. Es un campo más de
// 'config', así que se propaga a todos los dispositivos en tiempo real igual
// que el resto de la configuración.
function toggleMaintenanceMode() {
  const cfg = getConfig();
  const turningOn = !cfg.maintenanceMode;
  const title = turningOn ? '🚧 Activar modo mantenimiento' : '✅ Desactivar modo mantenimiento';
  const msg = turningOn
    ? 'Los gestores NO podrán enviar vales nuevos hasta que lo desactives. Úsalo solo durante una migración o mantenimiento breve.'
    : 'Los gestores podrán volver a enviar vales normalmente.';
  showConfirmAction(title, msg, 'Sí, continuar', turningOn ? 'btn-orange' : 'btn-green', () => {
    cfg.maintenanceMode = turningOn;
    saveConfig(cfg);
    _logAudit(turningOn ? 'maintenance_on' : 'maintenance_off');
    showToast(turningOn ? 'Modo mantenimiento ACTIVADO 🚧' : 'Modo mantenimiento desactivado ✓');
    loadMaintenanceModeUI();
  });
}
function loadMaintenanceModeUI() {
  const cfg = getConfig();
  const btn = document.getElementById('maintenanceModeBtn');
  const status = document.getElementById('maintenanceModeStatus');
  if (btn) {
    btn.textContent = cfg.maintenanceMode ? '✅ Desactivar mantenimiento' : '🚧 Activar mantenimiento';
    btn.className = cfg.maintenanceMode ? 'btn btn-green btn-sm' : 'btn btn-orange btn-sm';
  }
  if (status) {
    status.innerHTML = cfg.maintenanceMode
      ? '<span style="color:var(--orange);font-weight:600;">🚧 Mantenimiento ACTIVO — los gestores no pueden enviar vales</span>'
      : '<span style="color:var(--text-muted);">Sistema operando con normalidad</span>';
  }
}
async function syncToGitHub(silent) {
  const cfg=getConfig();
  if(!ghToken()||!cfg.ghRepo||!cfg.ghPath){if(!silent)showToast('Configura GitHub primero en ⚙️ Config');return;}
  
  // Validar formato del token antes de hacer la llamada
  const tok = ghToken();
  if(tok.length < 20){
    setGhStatus('<span style="color:var(--red);">✗ Token demasiado corto. Verifica que copiaste el token completo.</span>');
    if(!silent)showToast('Token inválido (muy corto)');
    return;
  }
  
  if(!silent) setGhStatus('<span style="color:var(--blue);">⟳ Sincronizando...</span>');
  try {
    const data={
      gestores:getGestores(),mensajeros:getMensajeros(),
      productos:getProductos(),categorias:getCategorias(),
      vales:getVales(),timestamp:new Date().toISOString()
    };
    const json=JSON.stringify(data,null,2);
    const content=utf8ToBase64(json);
    const parts=cfg.ghRepo.split('/').filter(Boolean);
    if(parts.length < 2){
      setGhStatus('<span style="color:var(--red);">✗ Formato de repo inválido. Usa: usuario/repositorio</span>');
      if(!silent)showToast('Formato de repo inválido');
      return;
    }
    const owner=parts[0];const repo=parts.slice(1).join('/');
    const url=`https://api.github.com/repos/${owner}/${repo}/contents/${cfg.ghPath}`;
    const headers={Authorization:`token ${tok}`,Accept:'application/vnd.github.v3+json','Content-Type':'application/json'};
    
    // GET para obtener SHA del archivo existente
    let sha;
    try{
      const r=await fetch(url,{headers});
      if(r.ok){const j=await r.json();sha=j.sha;}
    }catch(e){/* archivo no existe, está bien */}
    
    const body={message:`AXONTECH sync ${new Date().toLocaleString('es-ES')}`,content};
    if(sha)body.sha=sha;
    const res=await fetch(url,{method:'PUT',headers,body:JSON.stringify(body)});
    if(res.ok){
      const ts=new Date().toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'});
      setGhStatus(`<span style="color:var(--green);">✓ Sincronizado ${ts}</span>`);
      if(!silent)showToast('Guardado en GitHub ✓');
    } else {
      // Leer el cuerpo del error de GitHub para mostrar un mensaje útil
      let errMsg = '';
      try {
        const errBody = await res.json();
        errMsg = errBody.message || '';
      } catch(e) {
        try { errMsg = await res.text(); } catch(e2) {}
      }
      // Mensajes específicos según el código de error
      let userMsg = '';
      if(res.status === 401){
        userMsg = 'Token inválido o expirado. ';
        if(tok.startsWith('github_pat_')){
          userMsg += 'Tu token es fine-grained: verifica que tenga permiso "Contents: Read and write" en el repo específico.';
        } else if(tok.startsWith('ghp_')){
          userMsg += 'Verifica que el token tenga el scope "repo" marcado.';
        } else {
          userMsg += 'El token debe empezar con ghp_ (classic) o github_pat_ (fine-grained).';
        }
      } else if(res.status === 403){
        userMsg = 'Sin permisos. El token necesita permiso "repo" (classic) o "Contents: Write" (fine-grained).';
      } else if(res.status === 404){
        userMsg = `Repo no encontrado: ${owner}/${repo}. Verifica el nombre.`;
      }
      const fullMsg = userMsg || errMsg || '';
      setGhStatus(`<span style="color:var(--red);">✗ Error ${res.status}: ${fullMsg}</span>`);
      if(!silent)showToast(`Error ${res.status}: ${fullMsg.slice(0,80)}`);
    }
  } catch(e) {
    setGhStatus(`<span style="color:var(--red);">✗ ${e.message}</span>`);
    if(!silent)showToast('Error de conexión con GitHub');
  }
}
async function loadFromGitHub() {
  const cfg=getConfig();
  if(!ghToken()||!cfg.ghRepo||!cfg.ghPath){showToast('Configura GitHub primero');return;}
  if(!confirm('¿Restaurar datos desde GitHub?\nEsto reemplazará todos los datos locales.'))return;
  setGhStatus('<span style="color:var(--blue);">⟳ Cargando desde GitHub...</span>');
  try {
    const parts=cfg.ghRepo.split('/').filter(Boolean);
    if(parts.length < 2){setGhStatus('<span style="color:var(--red);">✗ Formato de repo inválido</span>');showToast('Formato de repo inválido');return;}
    const owner=parts[0];const repo=parts.slice(1).join('/');
    const url=`https://api.github.com/repos/${owner}/${repo}/contents/${cfg.ghPath}`;
    const res=await fetch(url,{headers:{Authorization:`token ${ghToken()}`,Accept:'application/vnd.github.v3+json'}});
    if(!res.ok){setGhStatus(`<span style="color:var(--red);">✗ Error ${res.status}</span>`);showToast(`Error al cargar (${res.status})`);return;}
    const j=await res.json();
    // Use base64ToUtf8 instead of deprecated decodeURIComponent(escape(atob(...)))
    const text=base64ToUtf8(j.content.replace(/\n/g,''));
    const data=JSON.parse(text);
    if(data.gestores)saveGestores(data.gestores);
    if(data.mensajeros)saveMensajeros(data.mensajeros);
    if(data.productos)saveProductos(data.productos);
    if(data.categorias)saveCategorias(data.categorias);
    if(data.vales) {
        // saveVales already enqueues the write to Firebase via _enqueueFB — no need for direct db.ref().set()
        saveVales(data.vales);
      }
    setGhStatus('<span style="color:var(--green);">✓ Datos restaurados desde GitHub</span>');
    _logAudit('data_restored_github', 'repo:' + cfg.ghRepo);
    activeGestorId=null;activeMensajeroId=null;selectedValeId=null;adminGestorFilter=null;
    renderGestores();renderGestorRanking();renderAdminGestores();
    renderAdminGestoresList();renderMensajeros();renderMensajeroSelector();
    renderStockCategorias();renderProductGrid();
    updateAdminBadge();updateMensajeroBadge();
    showToast('Datos restaurados desde GitHub ✓');
  } catch(e) {
    setGhStatus(`<span style="color:var(--red);">✗ ${e.message}</span>`);
    showToast('Error al restaurar datos');
  }
}
// Debounce de 60s para auto-sync. Antes cada confirmación de venta (y 28 sitios más)
// disparaba un PUT a GitHub con data.json entero (890 KB → 1.2 MB en base64).
// En 3G cubano son minutos por clic. Ahora se acumulan cambios y se sube cada 60s.
// Ver AUDITORIA-AXONTECH.md MEDIO 13.
let _autoSyncTimer = null;
async function maybeAutoSync() {
  const cfg=getConfig();
  if(!(cfg.ghAutoSync&&ghToken()&&cfg.ghRepo&&cfg.ghPath)) return;
  clearTimeout(_autoSyncTimer);
  _autoSyncTimer = setTimeout(() => { syncToGitHub(true).catch(()=>{}); }, 60000);
}

// BUGFIX: "borrar todos los vales" (y "limpiar vales y notifs" más abajo)
// borraban solo lo que el CACHÉ LOCAL del admin conocía — saveVales() arma
// el borrado comparando contra _valesCache, la copia en memoria de ESTE
// dispositivo. Si ese caché estaba incompleto respecto a lo que de verdad
// hay en Firestore (posible mientras no se haya corrido "Migrar a
// Firestore" una vez, o si el admin no tenía sincronizados todos los
// vales), los vales que el caché local no conocía NUNCA se borraban en
// Firestore — seguían ahí, y por eso los gestores (que consultan Firestore
// directo, no el caché del admin) los seguían viendo. _fsDeleteVales()
// resuelve esto leyendo la colección 'vales' DIRECTO de Firestore (la
// misma fuente de verdad que ya usa nukeAndRebuild) y borrando ahí,
// sin depender de qué tan completo esté el caché local del admin.
async function _fsDeleteVales(predicate) {
  // v31: ya sin SDK Firestore. Lee la colección 'vales' por REST de Supabase
  // y borra por IDs con _sbRestDeleteBatch. Mismo efecto, sin depender del
  // canal de streaming del SDK que se cuelga en Cuba.
  const all = await _sbRestGetCollection('vales');
  const ids = [];
  all.forEach(v => { if (v && v.id != null && (!predicate || predicate(v))) ids.push(Number(v.id)); });
  await _sbRestDeleteBatch('vales', ids);
  return ids.length;
}
function factoryResetVales() {
  showConfirmAction('¿BORRAR TODOS LOS VALES?', 'Esta acción no se puede deshacer y vaciará el historial.', 'Sí, borrar todo', 'btn-red', async () => {
    // saveVales([]) ya calcula el diff contra el cache previo y encola un
    // delete por cada vale existente (updates[key] = null) — cubre lo que
    // el caché local del admin conocía, y actualiza la UI local al instante.
    saveVales([]);
    rankingCache=null;
    try { localStorage.removeItem('axon_ranking_summary'); } catch(e){}
    gestoresTabDirty=true;statsTabDirty=true;
    selectedValeId=null;
    refreshUI();
    showToast('Borrando todos los vales...');
    // BUGFIX: antes se mostraba "eliminados" de inmediato, sin esperar a
    // que el borrado remoto (encolado, async, puede fallar tras reintentos
    // en una red mala) realmente terminara — el admin creía que ya estaba
    // listo aunque en Firestore siguieran existiendo, y los gestores los
    // seguían viendo. Ahora se espera la limpieza DIRECTA contra Firestore
    // (la misma fuente de verdad que consultan los gestores) antes de
    // avisar éxito, y si falla se avisa claro en vez de quedar en silencio.
    try {
      const extra = await _fsDeleteVales(null);
      await _sbRestMetaDelete('ranking_summary').catch(()=>{});
      showToast(`✓ Todos los vales eliminados${extra > 0 ? ` (confirmado en la nube)` : ''}`);
    } catch(e) {
      console.error('[factoryResetVales] error en limpieza directa:', e);
      showToast('⚠️ Se guardó el borrado localmente pero falló al confirmar en la nube — revisa tu conexión y vuelve a intentar "Borrar todos los vales" para asegurar que a los gestores también se les borre.');
    }
  });
}

function changePassCfg() {
  const np=document.getElementById('newPassInputCfg').value.trim();
  if(!np||np.length<4){showToast('Mínimo 4 caracteres');return;}
  _hashPass(np).then(h => {
    localStorage.setItem('axon_admin_hash', h);
    // No longer storing reversible btoa version — eliminates the vulnerability
    // where the password could be recovered by decoding localStorage
    localStorage.removeItem('axon_admin_hash_legacy');
    document.getElementById('newPassInputCfg').value='';
    showToast('Contraseña actualizada ✓');
  });
}

// ══════════════════════════════════════════
//  RESET GESTORES DATA — clear vales + notifs for fresh app start
// ══════════════════════════════════════════
async function clearGestoresData() {
  const vales = getVales();
  const notifs = getNotifs();
  const gestores = getGestores();

  // v38 FIX: normalizar gestorIds a Set de strings para que Set.has() funcione
  // sin importar si v.gestorId viene como string o número de Supabase.
  const gestorIds = new Set(gestores.map(g => String(g.id)));
  const valesToRemove = vales.filter(v => v && v.gestorId != null && gestorIds.has(String(v.gestorId)));
  // All notifs are tied to gestor activity — remove them all (both global + personal)
  // since they exist to inform gestors about stock/vales/ranking.
  const notifsToRemove = notifs;

  const vCount = valesToRemove.length;
  const nCount = notifsToRemove.length;

  // Two-step confirmation — destructive action
  const msg =
    `¿Borrar TODOS los vales y notificaciones de gestores?\n\n` +
    `• Vales a eliminar: ${vCount}\n` +
    `• Notificaciones a eliminar: ${nCount}\n\n` +
    `NO se borrarán: productos, gestores, mensajeros ni configuración.\n\n` +
    `Esta acción NO se puede deshacer. ¿Continuar?`;
  if (!confirm(msg)) return;
  if (!confirm('¿Última confirmación? Esta acción es irreversible.')) return;

  // 1) Keep only vales NOT tied to a known gestor (e.g. admin-generated vales without gestorId)
  const remainingVales = vales.filter(v => !(v && v.gestorId != null && gestorIds.has(String(v.gestorId))));
  saveVales(remainingVales);

  // 2) Clear all notifs (encolado — ver red de seguridad más abajo)
  saveNotifs([]);

  // BUGFIX: antes esto disparaba el borrado directo de vales en un IIFE
  // "fire and forget" (sin esperarlo) y saveNotifs([]) no tenía NINGÚN
  // respaldo si su escritura encolada fallaba tras los reintentos — en
  // ambos casos el admin veía "✓ listo" sin que el borrado realmente
  // hubiera terminado (o hubiera fallado del todo) en Firestore, que es la
  // fuente que consultan los gestores. Ahora se ESPERA la limpieza directa
  // de vales (misma fuente de verdad que nukeAndRebuild) y también se
  // fuerza notifs directo contra Firestore, antes de avisar éxito — y si
  // algo falla, se avisa claro en vez de quedar en silencio.
  showToast('Borrando vales y notificaciones...');
  let cleanupError = null;
  try {
    const extra = await _fsDeleteVales(v => v && v.gestorId != null && gestorIds.has(String(v.gestorId)));
    if (extra > 0) console.log(`[clearGestoresData] ${extra} vale(s) adicionales borrados directo de Supabase`);
    // v31: limpiar notifs directo en Supabase (era {items:[]} en Firestore;
    // en Supabase el JSONB acepta arrays como raíz, así que mandamos [] directo).
    await _sbRestMetaUpsert('notifs', []).catch(()=>{});
  } catch(e) {
    console.error('[clearGestoresData] error en limpieza directa:', e);
    cleanupError = e;
  }

  // 3) Clear per-gestor local tracking flags (viewed/cleared/personal)
  try {
    const keysToRemove = Object.keys(localStorage).filter(k =>
      k.startsWith('axon_viewed_id_') ||
      k.startsWith('axon_cleared_id_') ||
      k.startsWith('axon_cleared_personal_')
    );
    keysToRemove.forEach(k => localStorage.removeItem(k));
  } catch(e) { /* ignore key enumeration errors on weird browsers */ }

  // 4) Reset active selection state so admin UI doesn't reference dead vales
  selectedValeId = null;

  // 5) Refresh all UI panels that depend on vales/notifs
  try {
    renderGestores();
    renderGestorRanking();
    renderGestorNotifs();
    renderAdminGestores();
    renderValeDetail();
    renderAdminGestoresList();
    renderComisiones();
    updateAdminBadge();
  } catch(e) { /* UI refs may not all be present on every page */ }

  // 6) Status message — honesto sobre si la limpieza directa en Firestore
  // (la que de verdad ven los gestores) terminó bien o falló.
  const s = document.getElementById('clearGestoresStatus');
  if (cleanupError) {
    if (s) s.innerHTML = `<span style="color:var(--red);">⚠️ Se borró localmente pero falló al confirmar en la nube — revisa tu conexión y vuelve a intentar.</span>`;
    showToast('⚠️ Falló la limpieza en la nube — vuelve a intentar "Limpiar vales y notifs" para que a los gestores también se les borre');
  } else {
    if (s) s.innerHTML = `<span style="color:var(--green);">✓ Se eliminaron ${vCount} vales y ${nCount} notificaciones (confirmado en la nube). Listo para empezar.</span>`;
    showToast(`✓ Datos limpiados: ${vCount} vales, ${nCount} notifs`);
  }
  maybeAutoSync();
}

// ══════════════════════════════════════════
//  GOAL CELEBRATION — EPIC GLOW PULSE
// ══════════════════════════════════════════

// Place labels and emojis
const PLACE_EMOJI=['🥇','🥈','🥉'];
const PLACE_LABEL=['¡1er Lugar!','¡2do Lugar!','¡3er Lugar!'];
const PLACE_COLOR=['#F59E0B','#94A3B8','#cd7f32'];
const PLACE_BADGE=['CAMPEÓN','SUBCAMPEÓN','TERCERO'];

// Get top 3 gestores ranked by confirmed/pending_payment points
function getTop3Ranked() {
  const gestores=getGestores();
  const confirmedVales=getVales().filter(v=>['confirmed','pending_payment'].includes(v.status));
  const ranked=gestores.map(g=>{
    const pts=confirmedVales.filter(v=>Number(v.gestorId)===Number(g.id)).reduce((sum,v)=>
      sum+(v.valeProductos||[]).reduce((s,p)=>{const pr=productoOf(p.id);return s+(pr?pr.puntos*p.qty:0);},0),0);
    return {...g,pts};
  }).sort((a,b)=>b.pts-a.pts);
  return ranked.slice(0,3);
}

// Get a specific gestor's current rank (1-based)
function getGestorRank(gestorId) {
  const gestores=getGestores();
  const confirmedVales=getVales().filter(v=>['confirmed','pending_payment'].includes(v.status));
  const ranked=gestores.map(g=>{
    const pts=confirmedVales.filter(v=>Number(v.gestorId)===Number(g.id)).reduce((sum,v)=>
      sum+(v.valeProductos||[]).reduce((s,p)=>{const pr=productoOf(p.id);return s+(pr?pr.puntos*p.qty:0);},0),0);
    return {id:g.id,pts};
  }).sort((a,b)=>b.pts-a.pts);
  const idx=ranked.findIndex(r=>r.id===gestorId);
  return idx>=0?idx+1:null;
}

// Get a specific gestor's total points
function getGestorPoints(gestorId) {
  const confirmedVales=getVales().filter(v=>Number(v.gestorId)===Number(gestorId)&&['confirmed','pending_payment'].includes(v.status));
  return confirmedVales.reduce((sum,v)=>
    sum+(v.valeProductos||[]).reduce((s,p)=>{const pr=productoOf(p.id);return s+(pr?pr.puntos*p.qty:0);},0),0);
}

// Create the glow rings background
function glowCreateRings() {
  const container=document.querySelector('.glow-rings');
  if(!container)return;
  container.innerHTML='';
  const rings=[
    {size:160,color:'#F59E0B',delay:0},
    {size:240,color:'#7C3AED',delay:.3},
    {size:320,color:'#00b4d8',delay:.6},
    {size:400,color:'#EF4444',delay:.9},
    {size:480,color:'#10B981',delay:1.2}
  ];
  rings.forEach(r=>{
    const el=document.createElement('div');
    el.className='glow-ring';
    el.style.width=r.size+'px';el.style.height=r.size+'px';
    el.style.borderColor=r.color;el.style.animationDelay=r.delay+'s';
    container.appendChild(el);
  });
}

// Celebration sound — uses shared AudioContext to prevent memory leak
function playCelebrationSound(){
  try{
    if (!_sharedAC) _sharedAC = new (window.AudioContext||window.webkitAudioContext)();
    const ac = _sharedAC;
    if (ac.state === 'suspended') ac.resume();
    const notes=[523.25,659.25,783.99,1046.50];
    notes.forEach((freq,i)=>{
      const osc=ac.createOscillator();const gain=ac.createGain();
      osc.type='sine';osc.frequency.value=freq;
      gain.gain.setValueAtTime(.08,ac.currentTime+i*.12);
      gain.gain.exponentialRampToValueAtTime(.001,ac.currentTime+i*.12+.4);
      osc.connect(gain);gain.connect(ac.destination);
      osc.start(ac.currentTime+i*.12);osc.stop(ac.currentTime+i*.12+.4);
    });
  }catch(e){}
}

// Show personal ranking notification to a specific gestor
function showGestorRankNotif(gestorId, place, pts) {
  const g=gestorOf(gestorId);if(!g)return;
  const pi=Math.min(place,3)-1;
  // Remove existing rank notif
  const old=document.querySelector('.rank-notif');if(old)old.remove();
  const el=document.createElement('div');
  el.className='rank-notif';
  el.innerHTML=`
    <div class="rank-notif-icon">${PLACE_EMOJI[pi]}</div>
    <div class="rank-notif-content">
      <div class="rank-notif-place" style="color:${PLACE_COLOR[pi]}">${PLACE_LABEL[pi]}</div>
      <div class="rank-notif-text">${escapeHTML(g.name)}, ¡alcanzaste la meta!</div>
      <div class="rank-notif-pts">${pts} pts ⭐</div>
    </div>`;
  document.body.appendChild(el);
  setTimeout(()=>el.classList.add('show'),50);
  setTimeout(()=>{el.classList.remove('show');setTimeout(()=>el.remove(),600)},6000);
}

// Show ranking notification cards to ALL gestores about the top 3
function showRankNotifCards(top3) {
  top3.forEach((g,i)=>{
    const card=document.createElement('div');
    card.className='rank-notif-card';
    card.style.bottom=(20+i*90)+'px';
    card.innerHTML=`
      <div class="rank-notif-card-header">
        <div class="rank-notif-card-icon" style="background:${g.color}">${escapeHTML(g.initials)}</div>
        <div class="rank-notif-card-title" style="color:${PLACE_COLOR[i]}">${PLACE_LABEL[i]}</div>
        <div class="rank-notif-card-time">ahora</div>
      </div>
      <div class="rank-notif-card-body"><b>${escapeHTML(g.name)}</b> obtuvo <b>${PLACE_EMOJI[i]} ${PLACE_LABEL[i]}</b> con <b>${g.pts} puntos</b></div>
      <div class="rank-notif-card-place rank-place-${i+1}">${PLACE_EMOJI[i]} Puesto #${i+1}</div>`;
    document.body.appendChild(card);
    setTimeout(()=>card.classList.add('show'),(i+1)*500);
    setTimeout(()=>{card.classList.add('hide');setTimeout(()=>card.remove(),500)},7000+(i*600));
  });
}

// Send browser push notification about ranking to all devices
function sendRankingPushNotif(top3) {
  const names=top3.map((g,i)=>`${PLACE_EMOJI[i]} ${g.name} (${g.pts}pts)`).join(' | ');
  sendBrowserNotif('🏆 ¡Ranking Top 3!',names);
  // Also write to Firebase notifs for real-time sync
  top3.forEach((g,i)=>{
    addNotif('ranking_top3',g.name,null,`${PLACE_LABEL[i]}|${g.pts}|Puesto #${i+1}`,g.id);
  });
}

// EPIC GLOW PULSE — Main celebration overlay
function launchEpicGlowPulse(triggerGestor, triggerPts) {
  // Remove any existing overlay
  const existing=document.querySelector('.glow-overlay');if(existing)existing.remove();

  const top3=getTop3Ranked();
  const meta=getConfig().metaPuntos||0;

  // Build overlay HTML
  const overlay=document.createElement('div');
  overlay.className='glow-overlay';
  overlay.innerHTML=`
    <div class="glow-rings"></div>
    <button class="glow-close" onclick="closeEpicGlowPulse()">✕</button>
    <div class="glow-announcement">
      ${meta>0?`<div class="glow-meta-label">🎯 Meta: ${meta} pts</div>`:''}
      <div class="glow-title" id="glowTitle">🏆 ¡META ALCANZADA! 🏆</div>
      <div class="glow-winners-list" id="glowWinnersList">
        ${top3.map((g,i)=>`
          <div class="glow-winner-row" id="glowRow${i}" style="transition-delay:${.3+i*.25}s">
            <div class="glow-winner-place" style="color:${PLACE_COLOR[i]}">${i===0?'1°':i===1?'2°':'3°'}</div>
            <div class="glow-winner-avatar" style="background:${g.color}">${escapeHTML(g.initials)}</div>
            <div class="glow-winner-info">
              <div class="glow-winner-name">${escapeHTML(g.name)}</div>
              <div class="glow-winner-pts">${g.pts} pts${i===0&&meta>0&&g.pts>=meta?' ⭐ ¡Meta alcanzada!':''}</div>
            </div>
            <div class="glow-winner-badge glow-badge-${i+1}">${PLACE_EMOJI[i]} ${PLACE_BADGE[i]}</div>
          </div>
        `).join('')}
      </div>
    </div>`;
  document.body.appendChild(overlay);

  // Animate in
  requestAnimationFrame(()=>{
    overlay.classList.add('active');
    glowCreateRings();
    playCelebrationSound();

    // Title animation
    setTimeout(()=>{
      const title=document.getElementById('glowTitle');
      if(title)title.classList.add('show');
    },300);

    // Winner rows staggered animation
    setTimeout(()=>{
      top3.forEach((_,i)=>{
        const row=document.getElementById('glowRow'+i);
        if(row)row.classList.add('show');
      });
    },700);

    // Personal notification to the triggering gestor (on their device/view)
    if(triggerGestor){
      const rank=getGestorRank(triggerGestor.id);
      if(rank&&rank<=3){
        setTimeout(()=>showGestorRankNotif(triggerGestor.id,rank,triggerPts),1200);
      }
    }

    // Notification cards to all gestores about top 3
    setTimeout(()=>showRankNotifCards(top3),1500);

    // Push notification
    setTimeout(()=>sendRankingPushNotif(top3),1800);
  });

  // Auto-dismiss after 12 seconds
  setTimeout(()=>{if(document.querySelector('.glow-overlay.active'))closeEpicGlowPulse();},12000);
}

function closeEpicGlowPulse(){
  const overlay=document.querySelector('.glow-overlay');
  if(!overlay)return;
  overlay.classList.remove('active');
  setTimeout(()=>overlay.remove(),500);
}

// Legacy confetti kept as fallback for non-goal celebrations
function launchConfetti() {
  const canvas=document.createElement('canvas');
  canvas.style.cssText='position:fixed;inset:0;z-index:499;pointer-events:none;';
  canvas.width=window.innerWidth;canvas.height=window.innerHeight;
  document.body.appendChild(canvas);
  const ctx=canvas.getContext('2d');
  const colors=['#00b4d8','#F59E0B','#10B981','#EF4444','#7C3AED','#F97316','#EC4899','#ffffff'];
  const particles=Array.from({length:160},()=>({
    x:Math.random()*canvas.width,
    y:-20-Math.random()*canvas.height*.6,
    w:6+Math.random()*10,h:3+Math.random()*5,
    color:colors[Math.floor(Math.random()*colors.length)],
    vx:(Math.random()-.5)*4,
    vy:1.5+Math.random()*4,
    rot:Math.random()*Math.PI*2,
    vrot:(Math.random()-.5)*.18,
    shape:Math.random()>.6?'circle':'rect',
  }));
  let frame;const start=Date.now();
  (function animate(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    const elapsed=Date.now()-start;
    const alpha=elapsed>2800?Math.max(0,1-(elapsed-2800)/900):1;
    particles.forEach(p=>{
      p.x+=p.vx;p.y+=p.vy;p.rot+=p.vrot;p.vy+=.06;
      ctx.save();ctx.globalAlpha=alpha;
      ctx.translate(p.x,p.y);ctx.rotate(p.rot);
      ctx.fillStyle=p.color;
      if(p.shape==='circle'){ctx.beginPath();ctx.arc(0,0,p.w/2,0,Math.PI*2);ctx.fill();}
      else{ctx.fillRect(-p.w/2,-p.h/2,p.w,p.h);}
      ctx.restore();
    });
    if(elapsed<3700){frame=requestAnimationFrame(animate);}
    else{canvas.remove();}
  })();
  setTimeout(()=>{cancelAnimationFrame(frame);if(canvas.parentNode)canvas.remove();},4200);
}

function showGoalBanner(g, pts) {
  const old=document.getElementById('goalBanner');if(old)old.remove();
  const el=document.createElement('div');el.id='goalBanner';
  el.innerHTML=`
    <div style="font-size:32px;flex-shrink:0;">🏆</div>
    <div style="flex:1;min-width:0;">
      <div style="font-size:15px;font-weight:900;letter-spacing:.5px;text-shadow:0 1px 4px rgba(0,0,0,.3);">¡META ALCANZADA!</div>
      <div style="font-size:13px;opacity:.9;margin-top:2px;">${escapeHTML(g.name)} llegó a <b>${pts} puntos ⭐</b> — ¡Felicidades!</div>
    </div>
    <div style="background:${g.color};width:42px;height:42px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;flex-shrink:0;border:2px solid rgba(255,255,255,.4);">${escapeHTML(g.initials)}</div>
    <button onclick="dismissGoalBanner()" style="background:rgba(255,255,255,.18);border:none;color:white;border-radius:50%;width:26px;height:26px;cursor:pointer;font-size:16px;line-height:1;display:flex;align-items:center;justify-content:center;flex-shrink:0;padding:0;">×</button>`;
  document.body.appendChild(el);
  setTimeout(()=>dismissGoalBanner(),6000);
}
function dismissGoalBanner(){
  const el=document.getElementById('goalBanner');if(!el)return;
  el.classList.add('hide');setTimeout(()=>el.remove(),370);
}

function checkGoalReached(gestorId, currentValeId) {
  const meta=getConfig().metaPuntos;if(!meta||!gestorId)return;
  const g=gestorOf(gestorId);if(!g)return;
  const pts=getGestorPoints(gestorId);
  if(pts>=meta){
    // Celebrate only if THIS sale crossed the threshold (exclude current vale from prev total)
    const vales=getVales().filter(v=>Number(v.gestorId)===Number(gestorId)&&['confirmed','pending_payment'].includes(v.status));
    const prev=vales.filter(v=>v.id!==currentValeId).reduce((sum,v)=>sum+(v.valeProductos||[]).reduce((s,p)=>{const pr=productoOf(p.id);return s+(pr?pr.puntos*p.qty:0);},0),0);
    if(prev<meta){
      // EPIC GLOW PULSE — Full-screen celebration
      launchEpicGlowPulse(g,pts);
    }
  }
}

// ══════════════════════════════════════════
//  CONFIRM ACTION MODAL
// ══════════════════════════════════════════
function showConfirmAction(title, sub, okLabel, okClass, cb) {
  confirmActionCb = cb;
  document.getElementById('confirmActionTitle').textContent = title;
  document.getElementById('confirmActionSub').textContent = sub;
  const btn = document.getElementById('confirmActionOk');
  btn.textContent = okLabel;
  btn.className = `btn ${okClass} btn-full`;
  btn.onclick = () => { const cb = confirmActionCb; closeConfirmAction(); cb && cb(); };
  document.getElementById('confirmActionModal').classList.add('show');
}
function closeConfirmAction() {
  document.getElementById('confirmActionModal').classList.remove('show');
  confirmActionCb = null;
}

// ══════════════════════════════════════════
//  REVERT CONFIRMED SALE
// ══════════════════════════════════════════
function revertConfirmSale(id, skipConfirm) {
  const v=getVales().find(x=>x.id===id);if(!v)return;
  // Allow reverting both 'confirmed' and 'pending_payment' states
  if(v.status!=='confirmed'&&v.status!=='pending_payment'){showToast('Solo se puede revertir una venta confirmada o pendiente de cobro');return;}
  if(!skipConfirm) {
    const targetLabel=v.status==='confirmed'?'Pendiente (enviado)':'Entregado';
    showConfirmAction('¿Revertir venta?',`${v.cliente||''} volverá a "${targetLabel}" · Stock restaurado`,'Revertir','btn-orange',()=>revertConfirmSale(id,true));
    return;
  }
  // Idempotency: only restore stock if it was previously decremented.
  // The stockDecremented flag prevents double-restoration when the user
  // double-clicks the revert button before patchVale updates the state.
  if(v.stockDecremented){
    (v.valeProductos||[]).forEach(({id:pid,qty})=>{
      const prod=productoOf(pid);if(!prod)return;
      const restored=Math.max(0,(prod.stock||0)+qty);
      patchProducto(pid,{stock:restored});
    });
  }
  // Revert to appropriate previous state:
  // - Si tenía mensajero asignado, vuelve a 'assigned' (estado visible en el panel admin)
  // - Si no, vuelve a 'pending' (estado original)
  // Antes usaba 'delivered' pero nada en el código produce ese estado (mensajeroEntrega
  // pone 'pending_payment'), así que el vale quedaba huérfano: no aparecía en el panel
  // admin. Ver AUDITORIA-AXONTECH.md ALTO 8.
  const prevStatus = v.mensajeroId ? 'assigned' : 'pending';
  patchVale(id,{status:prevStatus,confirmedTs:null,commissionPaid:false,commissionStatus:null,commissionPaidTs:null,commissionEnSobreTs:null,stockDecremented:false});
  _logAudit('vale_reverted', 'vale:' + id + ' → ' + prevStatus);
  gestoresTabDirty=true;statsTabDirty=true;rankingCache=null;
  renderAdminGestores();renderValeDetail();
  renderConfirmados();renderPendienteCobro();
  renderGestorRanking();renderProductGrid();
  if(currentAdminTab==='gestores'){renderComisiones();}
  if(currentAdminTab==='catalog'){renderAdminCatalogCats();renderAdminCatalog();}
  maybeAutoSync();
  showToast(prevStatus === 'assigned'
    ? 'Venta revertida a "Con mensajero" — stock restaurado'
    : 'Venta revertida a "Pendiente" — stock restaurado');
}

// ══════════════════════════════════════════
//  HISTORIAL
// ══════════════════════════════════════════
function renderHistorial() {
  const fromEl=document.getElementById('histDateFrom');
  const toEl=document.getElementById('histDateTo');
  const gestorEl=document.getElementById('histGestorFilter');
  const searchEl=document.getElementById('histSearchPhone');
  const c=document.getElementById('historialList');
  if(!c) return;
  // Populate gestor filter
  const gestores=getGestores();
  const curGFilter=gestorEl?gestorEl.value:'';
  if(gestorEl){
    gestorEl.innerHTML=`<option value="">Todos los gestores</option>`+gestores.map(g=>`<option value="${g.id}">${escapeHTML(g.name)}</option>`).join('');
    gestorEl.value=curGFilter;
  }
  let vales=[...getVales()].reverse();
  const from=fromEl?fromEl.value:'';
  const to=toEl?toEl.value:'';
  const search=searchEl?searchEl.value.trim().toLowerCase():'';
  if(from)vales=vales.filter(v=>localDay(v.ts)>=from);
  if(to)  vales=vales.filter(v=>localDay(v.ts)<=to);
  if(curGFilter)vales=vales.filter(v=>String(v.gestorId)===curGFilter);
  // Search by phone, client name, or vale number
  if(search){
    vales=vales.filter(v=>{
      const phone=(v.telefono||'').toLowerCase().replace(/[\s\-()]/g,'');
      const cliente=(v.cliente||'').toLowerCase();
      const valeNum=v.valeNum?String(v.valeNum):'';
      const art=(v.articulo||'').toLowerCase();
      const searchClean=search.replace(/[\s\-()]/g,'');
      return phone.includes(searchClean)||cliente.includes(search)||valeNum.includes(search)||art.includes(search)||(valeNumStr(v).toLowerCase().includes(search));
    });
  }
  if(!vales.length){c.innerHTML='<div class="es"><div class="es-icon">📭</div><div class="es-text">'+(search?'Sin resultados para "'+escapeHTML(search)+'"':'Sin vales en el periodo seleccionado')+'</div></div>';return;}
  // Group by date
  const groups={};
  vales.forEach(v=>{
    const d=localDay(v.ts);
    if(!groups[d])groups[d]=[];
    groups[d].push(v);
  });
  const sMap={
    pending:{label:'Pendiente',cls:'sp-pending'},assigned:{label:'Con mensajero',cls:'sp-assigned'},
    delivered:{label:'Entregado',cls:'sp-delivered'},
    confirmed:{label:'Confirmado',cls:'sp-confirmed'},pending_payment:{label:'Pend. cobro',cls:'sp-pending_payment'},
  };
  let html='';
  Object.keys(groups).sort((a,b)=>b.localeCompare(a)).forEach(date=>{
    const day=new Date(date+'T12:00:00').toLocaleDateString('es-ES',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
    html+=`<div style="font-size:11px;font-weight:700;color:var(--gray-400);text-transform:uppercase;letter-spacing:.5px;padding:10px 0 5px;border-top:1px solid var(--border);margin-top:8px;">${day} <span style="background:var(--gray-100);border-radius:10px;padding:1px 7px;font-size:10px;">${groups[date].length}</span></div>`;
    groups[date].forEach(v=>{
      const g=gestorOf(v.gestorId);
      const s=sMap[v.status]||{label:v.status,cls:''};
      const estafaMatch=checkEstafaMatch(v);
      const estafaBorder=estafaMatch.length?'border-left:3px solid var(--red);':'';
      const estafaTag=estafaMatch.length?'<span style="background:var(--red);color:white;border-radius:6px;padding:1px 5px;font-size:8px;font-weight:700;margin-left:3px;">🚫</span>':'';
      html+=`<div class="card" style="padding:8px 12px;margin-bottom:5px;cursor:pointer;display:flex;align-items:center;gap:10px;${estafaBorder}" onclick="selectValeFromHistorial(${v.id})">
        <div style="flex-shrink:0;">
          <div class="g-avatar" style="background:${g?g.color:'#888'};width:28px;height:28px;font-size:10px;">${g?escapeHTML(g.initials):'?'}</div>
        </div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;font-weight:700;">${valeNumStr(v)?`<span style="color:var(--blue);">${valeNumStr(v)}</span> `:''}${escapeHTML(v.cliente||'—')}${estafaTag}</div>
          <div style="font-size:10px;color:var(--gray-400);">${v.telefono?escapeHTML(v.telefono)+' · ':''}${g?escapeHTML(g.name):'—'} · ${timeStr(v.ts)}</div>
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <span class="sp ${s.cls}" style="font-size:9px;">${s.label}</span>
          <div style="font-size:11px;font-weight:700;color:var(--blue);margin-top:2px;">${escapeHTML(v.total||'')}</div>
        </div>
      </div>`;
    });
  });
  c.innerHTML=html;
}
function selectValeFromHistorial(id) {
  selectedValeId=id;
  adminTab('vales');
  setTimeout(()=>{renderValeDetail();},50);
}

// ══════════════════════════════════════════
//  THEME
// ══════════════════════════════════════════
function applyTheme(dark) {
  document.body.classList.toggle('dark', dark);
  const btn=document.getElementById('btnTheme');if(btn)btn.textContent=dark?'☀️':'🌙';
}
function toggleTheme() {
  const isDark = document.body.classList.toggle('dark');
  localStorage.setItem('axon_theme', isDark ? 'dark' : 'light');
  const btn=document.getElementById('btnTheme');if(btn)btn.textContent=isDark?'☀️':'🌙';
}


// ══════════════════════════════════════════
//  INITIAL DATA LOAD & GESTOR PULL
// ══════════════════════════════════════════





async function nukeAndRebuild() {
  // Three-step confirmation for this destructive action
  if(!confirm("⚠️ ¿Estás seguro? Esto borrará Firebase entero y cargará la base limpia.")) return;
  if(!confirm("⚠️ ÚLTIMA VERIFICACIÓN: ¿Continuar con el reseteo total? Se creará un backup automático antes.")) return;
  try {
    // Step 1: Backup current data to localStorage + Firebase before nuking
    showToast("💾 Creando backup de seguridad...");
    const backup = {
      gestores: getGestores(),
      mensajeros: getMensajeros(),
      productos: getProductos(),
      categorias: getCategorias(),
      vales: getVales(),
      notifs: getNotifs(),
      estafa: getEstafa(),
      // Shallow copy sin ghToken — no mutar _configCache con delete.
      // El token vive en localStorage.axon_gh_token aparte, no en config.
      config: (() => { const { ghToken, ...rest } = getConfig(); return rest; })(),
      ts: new Date().toISOString(),
      type: 'pre-nuke-backup'
    };
    // Limpiar backups pre-nuke anteriores (solo guardamos el último para no llenar localStorage)
    try {
      Object.keys(localStorage).filter(k => k.startsWith('axon_prenuke_backup_')).forEach(k => localStorage.removeItem(k));
    } catch(e) {}
    try {
      localStorage.setItem('axon_prenuke_backup_' + Date.now(), JSON.stringify(backup));
    } catch(e) {
      if (!confirm('⚠️ No se pudo guardar el backup local (sin espacio). ¿Continuar de todos modos?')) return;
    }
    // Also enqueue the backup to Firebase so it survives even if localStorage is cleared
    _enqueueFB('backups/pre-nuke-' + Date.now(), backup, 'set');

    showToast("Descargando data.json limpio...");
    const res = await fetch('./data.json?t=' + Date.now());
    if(!res.ok) throw new Error("No se pudo leer data.json");
    const data = await res.json();

    // Step 2: reemplazar por completo gestores/mensajeros/productos/categorias
    // y borrar todos los vales/notifs/ranking_summary/estafa.
    showToast("Inyectando base de datos limpia...");
    // BUGFIX: antes esto solo hacía SET de cada entrada de data.json — un
    // gestor/producto creado desde el admin DESPUÉS de la última vez que se
    // regeneró data.json sobrevivía al "reseteo total" como zombie, porque
    // nunca se borraba. RTDB original usaba un update() atómico de todo el
    // subárbol (equivalente a un reemplazo real). _fsReplaceCollection()
    // restaura ese comportamiento: borra en Firestore cualquier doc que NO
    // esté en el data.json nuevo.
    if(data.gestores)   localStorage.setItem('axon_gestores', JSON.stringify(data.gestores));
    if(data.mensajeros) localStorage.setItem('axon_mensajeros', JSON.stringify(data.mensajeros));
    if(data.productos)  localStorage.setItem('axon_productos', JSON.stringify(data.productos));
    if(data.categorias) localStorage.setItem('axon_categorias', JSON.stringify(data.categorias));
    if(data.gestores)   await _fsReplaceCollection('gestores', data.gestores);
    if(data.mensajeros) await _fsReplaceCollection('mensajeros', data.mensajeros);
    if(data.productos)  await _fsReplaceCollection('productos', data.productos);
    if(data.categorias) await _fsReplaceCollection('categorias', data.categorias);

    // v31: Borrar vales/notifs/ranking_summary/estafa directo en Supabase.
    // NO tocar 'backups' — ahí acabamos de guardar el snapshot pre-nuke.
    await _sbRestDeleteAll('vales').catch(()=>{});
    await _sbRestMetaDelete('notifs').catch(()=>{});
    await _sbRestMetaDelete('ranking_summary').catch(()=>{});
    await _sbRestMetaDelete('estafa').catch(()=>{});

    // Clear localStorage vales/notifs/estafa (but preserve backup, admin hash, audit log)
    ['axon_vales','axon_notifs','axon_ranking_summary','axon_estafa','axon_pending_writes','axon_failed_writes'].forEach(k => {
      try { localStorage.removeItem(k); } catch(e) {}
    });

    // Reset in-memory caches so the next read picks up the new data
    _gestoresCache=null;_gestoresDirty=true;
    _valesCache=null;_valesDirty=true;
    _mensajerosCache=null;_mensajerosDirty=true;
    _productosCache=null;_productosDirty=true;
    _categoriasCache=null;_categoriasDirty=true;
    _notifsCache=null;_notifsDirty=true;
    _estafaCache=null;_estafaDirty=true;

    _logAudit('nuke_rebuild', 'system');

    showToast("¡Listo! Recargando...");
    setTimeout(() => { window.location.href = './admin.html'; }, 1500);
  } catch(e) {
    showToast("Error: " + e.message + " — Backup disponible en localStorage");
    console.error('Nuke failed:', e);
  }
}

// ══════════════════════════════════════════
//  MIGRACIÓN DE DATOS: REALTIME DATABASE → FIRESTORE
// ══════════════════════════════════════════
// Herramienta de una sola vez para el corte de producción (Fase 3/4 de la
// migración). Lee el árbol COMPLETO y fresco de RTDB (no la caché local),
// lo escribe en Firestore con IDs deterministas (String(id)) — por lo tanto
// es SEGURO re-ejecutarla: vuelve a sobrescribir con los mismos IDs, no
// duplica nada. Al terminar verifica conteos por colección y hace un
// spot-check de contenido en una muestra de vales antes de reportar éxito.
// No borra ni modifica RTDB — es de solo lectura sobre `db`.
function _rtdbNodeToArray(node) {
  if (!node) return [];
  return Array.isArray(node) ? node.filter(x => x != null) : Object.values(node).filter(x => x != null);
}
// BUGFIX: la versión anterior (_fsWriteCollection) solo hacía SET de cada
// item — nunca borraba un doc que ya no estuviera en el array nuevo. RTDB
// original usaba db.ref('/').update({...}) con paths completos, que SÍ
// reemplaza el subárbol entero (cualquier gestor/producto ausente del
// nuevo objeto desaparece). Tanto migrateToFirestore() como
// nukeAndRebuild() dependen de este "reemplazo total", así que ahora
// _fsReplaceCollection() primero lee lo que YA existe en Firestore y borra
// lo que no esté en `arr` — mismo comportamiento que el reemplazo atómico
// de RTDB, adaptado a los batches de Firestore. Devuelve la lista de ids
// omitidos por ser demasiado grandes (>900KB, típicamente una foto vieja
// en base64) para que el llamador pueda avisar al usuario.
async function _fsReplaceCollection(name, arr) {
  // v31: reemplazo total de una colección en Supabase. Lee los IDs
  // existentes, borra los que ya no están, y upserta los nuevos.
  const existing = await _sbRestGetCollection(name);
  const existingIds = new Set(existing.filter(x => x && x.id != null).map(x => String(x.id)));
  const keepIds = new Set(arr.filter(x => x && x.id != null).map(x => String(x.id)));
  const skipped = [];
  const upsertItems = [];
  arr.forEach(item => {
    if (!item || item.id == null) return;
    let tooLarge = false;
    try { tooLarge = JSON.stringify(item).length > 900000; } catch(e) {}
    if (tooLarge) { skipped.push(String(item.id)); return; }
    upsertItems.push({ id: Number(item.id), value: item });
  });
  // Borrar los IDs que existen en Supabase pero NO en el array nuevo
  const deleteIds = [];
  existingIds.forEach(id => { if (!keepIds.has(id)) deleteIds.push(Number(id)); });
  if (upsertItems.length > 0) await _sbRestUpsertBatch(name, upsertItems);
  if (deleteIds.length > 0) await _sbRestDeleteBatch(name, deleteIds);
  return skipped;
}

// ══════════════════════════════════════════════════════════════════════
//  MIGRACIÓN DE DATOS: FIRESTORE → SUPABASE (v31)
// ══════════════════════════════════════════════════════════════════════
// Esta función migra los datos existentes de Firestore a Supabase. Solo
// se ejecuta una vez (manualmente desde el panel de admin). Si los datos
// ya están en Supabase (después de correr esto una vez o si el proyecto
// está vacío), no hace falta volver a correrla.
//
// IMPORTANTE: Esta función necesita que la app tenga acceso AMBOS a
// Firestore (para leer) y a Supabase (para escribir). Como Firestore
// está bloqueado desde Cuba sin VPN, esta migración debe correrse CON
// VPN o desde fuera de Cuba. Una vez migrado, la app funciona solo
// con Supabase y el VPN ya no es necesario.
async function migrateToFirestore() {
  // ── Renombrada conceptualmente a migrateFirestoreToSupabase ──
  // Mantenemos el nombre migrateToFirestore() porque hay llamadas en
  // admin.html que lo invocan por ese nombre.
  const statusEl = document.getElementById('fsMigrateStatus');
  const setStatus = html => { if (statusEl) statusEl.innerHTML = html; };
  if (!confirm('Esto LEE todos los datos actuales de Firestore y los ESCRIBE en Supabase. Es seguro repetir (no duplica, sobrescribe con los mismos IDs). Firestore está bloqueado desde Cuba sin VPN, así que probablemente necesites VPN para correr esto. ¿Continuar?')) return;
  setStatus('⏳ Leyendo datos de Firestore...');
  try {
    // v31: leer por REST de Firestore (sigue siendo alcanzable desde fuera
    // de Cuba, así que con VPN funciona). Los helpers que usábamos antes
    // eran _fsRestGetCollection (que todavía existe como función pero ya
    // no usa Firestore). Como ya no tenemos firestoreDb, hacemos el fetch
    // directo aquí.
    const FS_BASE = 'https://firestore.googleapis.com/v1/projects/axontech/databases/(default)/documents';
    const FS_KEY  = 'AIzaSyBIyvayDYLYDFy4qrbTkYnrTmxfvxvLnlU';
    const fsGetCollection = async (collName) => {
      const out = [];
      let token = null;
      do {
        const url = `${FS_BASE}/${collName}?pageSize=300&key=${FS_KEY}` + (token ? `&pageToken=${encodeURIComponent(token)}` : '');
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Firestore GET ${collName} ${res.status}`);
        const j = await res.json();
        (j.documents || []).forEach(d => {
          // Desenvolver fields de Firestore al formato JS plano
          const fields = d.fields || {};
          const obj = {};
          Object.keys(fields).forEach(k => {
            const v = fields[k];
            if ('nullValue' in v) obj[k] = null;
            else if ('booleanValue' in v) obj[k] = v.booleanValue;
            else if ('integerValue' in v) obj[k] = Number(v.integerValue);
            else if ('doubleValue' in v) obj[k] = Number(v.doubleValue);
            else if ('stringValue' in v) obj[k] = v.stringValue;
            else if ('timestampValue' in v) obj[k] = v.timestampValue;
            else if ('arrayValue' in v) obj[k] = (v.arrayValue.values || []).map(x => {
              if ('stringValue' in x) return x.stringValue;
              if ('integerValue' in x) return Number(x.integerValue);
              if ('mapValue' in x) {
                const m = {}; Object.keys(x.mapValue.fields || {}).forEach(k2 => {
                  const v2 = x.mapValue.fields[k2];
                  if ('stringValue' in v2) m[k2] = v2.stringValue;
                  else if ('integerValue' in v2) m[k2] = Number(v2.integerValue);
                  else if ('booleanValue' in v2) m[k2] = v2.booleanValue;
                });
                return m;
              }
              return null;
            });
            else if ('mapValue' in v) {
              const m = {};
              Object.keys(v.mapValue.fields || {}).forEach(k2 => {
                const v2 = v.mapValue.fields[k2];
                if ('stringValue' in v2) m[k2] = v2.stringValue;
                else if ('integerValue' in v2) m[k2] = Number(v2.integerValue);
                else if ('booleanValue' in v2) m[k2] = v2.booleanValue;
                else if ('doubleValue' in v2) m[k2] = Number(v2.doubleValue);
              });
              obj[k] = m;
            }
          });
          out.push(obj);
        });
        token = j.nextPageToken;
      } while (token);
      return out;
    };
    const fsGetMeta = async (name) => {
      const res = await fetch(`${FS_BASE}/meta/${name}?key=${FS_KEY}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Firestore GET meta/${name} ${res.status}`);
      const j = await res.json();
      // Desenvolver items si es un array singleton
      const fields = j.fields || {};
      if (fields.items && fields.items.arrayValue) {
        return (fields.items.arrayValue.values || []).map(x => {
          if ('mapValue' in x) {
            const m = {};
            Object.keys(x.mapValue.fields || {}).forEach(k => {
              const v = x.mapValue.fields[k];
              if ('stringValue' in v) m[k] = v.stringValue;
              else if ('integerValue' in v) m[k] = Number(v.integerValue);
              else if ('booleanValue' in v) m[k] = v.booleanValue;
            });
            return m;
          }
          if ('stringValue' in x) return x.stringValue;
          if ('integerValue' in x) return Number(x.integerValue);
          return null;
        });
      }
      // Si no es array, desenvolver como objeto plano
      const obj = {};
      Object.keys(fields).forEach(k => {
        const v = fields[k];
        if ('stringValue' in v) obj[k] = v.stringValue;
        else if ('integerValue' in v) obj[k] = Number(v.integerValue);
        else if ('booleanValue' in v) obj[k] = v.booleanValue;
        else if ('doubleValue' in v) obj[k] = Number(v.doubleValue);
      });
      return obj;
    };

    setStatus('⏳ Leyendo colecciones de Firestore...');
    const rGestores   = await fsGetCollection('gestores');
    const rMensajeros = await fsGetCollection('mensajeros');
    const rProductos  = await fsGetCollection('productos');
    const rCategorias = await fsGetCollection('categorias');
    const rVales      = await fsGetCollection('vales');
    const rConfig     = await fsGetMeta('config') || {};
    const rNotifs     = await fsGetMeta('notifs') || [];
    const rEstafa     = await fsGetMeta('estafa') || [];
    const rRanking    = await fsGetMeta('ranking_summary') || [];

    setStatus(`⏳ Leído: ${rGestores.length} gestores, ${rMensajeros.length} mensajeros, ${rProductos.length} productos, ${rCategorias.length} categorías, ${rVales.length} vales.<br>Escribiendo en Supabase...`);

    const skippedByCollection = {};
    skippedByCollection.gestores   = await _fsReplaceCollection('gestores', rGestores);
    skippedByCollection.mensajeros = await _fsReplaceCollection('mensajeros', rMensajeros);
    skippedByCollection.productos  = await _fsReplaceCollection('productos', rProductos);
    skippedByCollection.categorias = await _fsReplaceCollection('categorias', rCategorias);
    skippedByCollection.vales      = await _fsReplaceCollection('vales', rVales);

    await _sbRestMetaUpsert('config', rConfig);
    await _sbRestMetaUpsert('notifs', rNotifs);
    await _sbRestMetaUpsert('estafa', rEstafa);
    await _sbRestMetaUpsert('ranking_summary', rRanking);

    try { localStorage.setItem('axon_fs_migrated', '1'); } catch(e) {}

    setStatus('⏳ Verificando conteos en Supabase...');
    const [gArr, mArr, pArr, cArr, vArr] = await Promise.all([
      _sbRestGetCollection('gestores'),
      _sbRestGetCollection('mensajeros'),
      _sbRestGetCollection('productos'),
      _sbRestGetCollection('categorias'),
      _sbRestGetCollection('vales'),
    ]);
    const mismatches = [];
    const expected = (arr, skipped) => arr.length - (skipped ? skipped.length : 0);
    if (gArr.length !== expected(rGestores, skippedByCollection.gestores)) mismatches.push(`gestores: esperado=${expected(rGestores, skippedByCollection.gestores)} Supabase=${gArr.length}`);
    if (mArr.length !== expected(rMensajeros, skippedByCollection.mensajeros)) mismatches.push(`mensajeros: esperado=${expected(rMensajeros, skippedByCollection.mensajeros)} Supabase=${mArr.length}`);
    if (pArr.length !== expected(rProductos, skippedByCollection.productos)) mismatches.push(`productos: esperado=${expected(rProductos, skippedByCollection.productos)} Supabase=${pArr.length}`);
    if (cArr.length !== expected(rCategorias, skippedByCollection.categorias)) mismatches.push(`categorias: esperado=${expected(rCategorias, skippedByCollection.categorias)} Supabase=${cArr.length}`);
    if (vArr.length !== expected(rVales, skippedByCollection.vales)) mismatches.push(`vales: esperado=${expected(rVales, skippedByCollection.vales)} Supabase=${vArr.length}`);

    const problems = mismatches.slice();
    if (problems.length === 0) {
      setStatus(`✅ Migración a Supabase completa y verificada.<br>Gestores: ${gArr.length} · Mensajeros: ${mArr.length} · Productos: ${pArr.length} · Categorías: ${cArr.length} · Vales: ${vArr.length}`);
      showToast('Migración a Supabase verificada ✓');
    } else {
      setStatus(`⚠️ Migración terminada CON DIFERENCIAS:<br>${problems.join('<br>')}`);
      showToast('Migración con diferencias — revisar');
    }
  } catch(e) {
    console.error('[migrateToFirestore/Supabase]', e);
    setStatus('❌ Error durante la migración: ' + (e && e.message ? e.message : e));
    showToast('Error en la migración: ' + (e && e.message ? e.message : e));
  }
}

async function loadInitialData() {
  // ── Optimización para conexiones lentas ──
  // Antes: si getGestores() o getProductos() estaban vacíos, hacíamos
  // `await fetch('./data.json?t=' + Date.now())` que bajaba 1.2MB en 3G
  // (3-5s) y BLOQUEABA el init() — la UI no arrancaba hasta que terminaba.
  // Ahora:
  // 1. Si ya hay datos en localStorage (caso normal tras primer uso),
  //    NO hacemos fetch — los listeners de Firebase traerán cualquier
  //    actualización en background.
  // 2. Si NO hay datos en localStorage (primera vez), hacemos el fetch SIN
  //    await — el init() continúa y la UI se inicializa con lo que haya
  //    (vacío). Cuando el fetch termina, actualiza localStorage y dispara
  //    refreshUI().
  // 3. Quitamos el ?t=Date.now() del fetch — invalidate el cache del SW
  //    y forzaba bajar 1.2MB cada vez. El SW ya stale-while-revalidatea
  //    data.json correctamente; no necesitamos bypass.
  const hasLocalData = getGestores().length > 0 || getProductos().length > 0;
  if (hasLocalData) {
    // Ya tenemos datos locales — los listeners de Firebase traerán cambios.
    // Solo si el admin no tiene nada en Firebase podría querer popular,
    // pero eso ya lo maneja el bloque 'Initialize empty Firebase from local'
    // que está abajo. Aquí no hacemos nada.
    return;
  }
  // Primera vez: bajar data.json SIN bloquear init().
  // Usar cache del SW (sin ?t=Date.now()) — si data.json cambió, el SW
  // lo traerá en background stale-while-revalidate.
  fetch('./data.json').then(res => {
    if (!res.ok) return null;
    return res.json();
  }).then(data => {
    if (!data) return;
    _syncCount++;
    try {
      if (data.gestores) localStorage.setItem('axon_gestores', JSON.stringify(data.gestores));
      if (data.mensajeros) localStorage.setItem('axon_mensajeros', JSON.stringify(data.mensajeros));
      if (data.productos) localStorage.setItem('axon_productos', JSON.stringify(data.productos));
      if (data.categorias) localStorage.setItem('axon_categorias', JSON.stringify(data.categorias));
      // Marcar caches como dirty para que el próximo getGestores() relea localStorage.
      _gestoresDirty = true;
      _mensajerosDirty = true;
      _productosDirty = true;
      _categoriasDirty = true;
    } finally {
      _syncCount--;
      refreshUI();
    }
    if (IS_ADMIN) {
       const localGestores = getGestores();
       if(localGestores.length > 0) {
          // Use write queue instead of direct db.ref().set() to enable retries
          _enqueueFB('gestores', _buildCollectionUpdates(localGestores, null), 'update');
          _enqueueFB('mensajeros', _buildCollectionUpdates(getMensajeros(), null), 'update');
       }
    }
  }).catch(() => { /* red caída — la app igual arranca con lo que haya */ });
}


// ══════════════════════════════════════════
//  UNSENT FORM WARNING & KEYBOARD SHORTCUTS
// ══════════════════════════════════════════
function isFormDirty() {
  if (!activeGestorId) return false;
  return REQUIRED.some(id => fVal(id).length > 0) || 
    ['vf-mensajeria','vf-precioUSD','vf-precioMN','vf-vuelto','vf-garantia'].some(id => fVal(id).length > 0);
}

// Warn before navigating away from a dirty form
window.addEventListener('beforeunload', (e) => {
  if (isFormDirty()) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// Escape key closes modals — EXCEPTO los modales de login (passModal, gestorPassModal)
// para evitar que se cierre el modal de admin y quede el panel visible sin sesión.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const openModal = document.querySelector('.modal-bg.show');
  if (!openModal) return;
  if (openModal.id === 'passModal' || openModal.id === 'gestorPassModal') return;
  // Si es el modal del ticket, usar closeTicketModal() para que respete la lógica
  // de "limpiar formulario solo si se abrió tras enviar un vale".
  if (openModal.id === 'ticketModal') { closeTicketModal(); return; }
  openModal.classList.remove('show');
});

// ══════════════════════════════════════════
//  ADMIN VALE GENERATOR
// ══════════════════════════════════════════
let adminValeProductos = [];
let adminPickerSelected = {};
let adminPickerCatFilter = null;

function openAdminValeModal() {
  const sel = document.getElementById('av-gestor');
  const gestores = getGestores();
  sel.innerHTML = '<option value="">— Seleccionar —</option>' +
    '<option value="0">👤 Admin</option>' +
    gestores.map(g => `<option value="${g.id}">${escapeHTML(g.name)}</option>`).join('');

  ['av-cliente','av-telefono','av-direccion','av-mensajeria','av-articulo',
   'av-precioUSD','av-precioMN','av-vuelto','av-total','av-garantia','av-comisionGestor'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  adminValeProductos = [];
  adminPickerSelected = {};
  const spList = document.getElementById('av-selectedProductsList');
  if (spList) spList.style.display = 'none';
  document.getElementById('av-previewCard').style.display = 'none';
  const btn = document.getElementById('av-sendBtn');
  if (btn) { btn.disabled = true; btn.textContent = '📤 Generar Vale'; }

  document.getElementById('adminValeModal').classList.add('show');
}

function closeAdminValeModal() {
  document.getElementById('adminValeModal').classList.remove('show');
}

const avVal = id => (document.getElementById(id)?.value || '').trim();

function onAdminValeInput() {
  const activeId = document.activeElement?.id;
  if (['av-mensajeria', 'av-precioUSD', 'av-precioMN'].includes(activeId)) {
    calcAdminAutoTotal();
  }
  const REQUIRED_AV = ['av-gestor','av-cliente','av-telefono','av-direccion','av-articulo','av-total'];
  const allFilled = REQUIRED_AV.every(id => avVal(id).length > 0);
  const btn = document.getElementById('av-sendBtn');
  if (btn) btn.disabled = !allFilled;

  const anyFilled = REQUIRED_AV.some(id => avVal(id).length > 0) ||
    ['av-mensajeria','av-precioUSD','av-precioMN','av-vuelto','av-garantia','av-comisionGestor'].some(id => avVal(id).length > 0);

  const pc = document.getElementById('av-previewCard');
  if (pc) {
    if (avVal('av-gestor') && anyFilled) {
      pc.style.display = 'block';
      document.getElementById('av-previewText').textContent = buildAdminValeText();
    } else {
      pc.style.display = 'none';
    }
  }
}

function calcAdminAutoTotal() {
  const pUSD = document.getElementById('av-precioUSD')?.value || '';
  const pMN = document.getElementById('av-precioMN')?.value || '';
  const mens = document.getElementById('av-mensajeria')?.value || '';
  let usdTotal = 0, mnTotal = 0;
  const addVal = (str) => {
    const s = str.toUpperCase();
    const num = parsePrecioNum(s);
    if (num === 0) return;
    if (s.includes('MN') || s.includes('CUP')) mnTotal += num;
    else if (s.includes('USD') || s.includes('ZELLE')) usdTotal += num;
    else if (s.includes('$')) usdTotal += num;
    else { if (num > 500) mnTotal += num; else usdTotal += num; }
  };
  addVal(pUSD); addVal(pMN); addVal(mens);
  let out = [];
  if (usdTotal > 0) out.push(`$${usdTotal} USD`);
  if (mnTotal > 0) out.push(`${mnTotal} MN`);
  const totalInput = document.getElementById('av-total');
  if (out.length > 0 && totalInput) { totalInput.value = out.join(' + '); }
  else if (totalInput && !pUSD && !pMN && !mens) { totalInput.value = ''; }
}

function buildAdminValeText() {
  const gId = parseInt(avVal('av-gestor'));
  const g = gestorOf(gId);
  const prodLines = adminValeProductos.length
    ? adminValeProductos.map(p => `  ×${p.qty} ${p.name}`).join('\n')
    : avVal('av-articulo');
  return ['Bienvenido a "AXONTECH" 🔥', '', 'VALE DEL GESTOR:', '',
    `🔸Promotor: ${g ? g.name : ''}`, '',
    `🔸 Nombre Cliente: ${avVal('av-cliente')}`,
    `🔸Teléfono Cliente: ${avVal('av-telefono')}`,
    `🔸Dirección Cliente: ${avVal('av-direccion')}`,
    avVal('av-carnet') ? `🪪 Carnet: ${avVal('av-carnet')}` : '',
    `🔸Mensajería/ costo: ${avVal('av-mensajeria')}`,
    `🔸 Artículos y cantidades:`, prodLines,
    `🔸Precio USD/ zelle: ${avVal('av-precioUSD')}`,
    `🔸Precio MN: ${avVal('av-precioMN')}`,
    `🔸 Vuelto: ${avVal('av-vuelto')}`,
    `🔸 Total a pagar: ${avVal('av-total')}`, '',
    `*Garantía: ${avVal('av-garantia')}`,
    `*Fecha y hora de Venta: ${nowDateTime()}`, '',
    '🧭Dirección de la tienda:', '* Amistad #311 % San Rafael y San José, Centro Habana.', '',
    '🚨ATENCIÓN🚨', '•   Horarios de atención al cliente:', '    9:00am - 7:00pm.',
    '* Solo aceptamos hasta cinco billetes de 1 USD por compra.',
    '* Los pagos en MN deben ser con denominación de 50 en adelante.',
    '* Solo se aceptan billetes en buen estado (ni rotos ni manchados)'
  ].join('\n');
}

let _isSendingAdminVale = false;
function sendAdminVale() {
  if (_isSendingAdminVale) return;
  const REQUIRED_AV = ['av-gestor','av-cliente','av-telefono','av-direccion','av-articulo','av-total'];
  if (REQUIRED_AV.some(id => !avVal(id))) { showToast('Completa los campos obligatorios (*)'); return; }
  _isSendingAdminVale = true;
  const btn = document.getElementById('av-sendBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Generando...'; }
  const gId = parseInt(avVal('av-gestor'));
  const g = gestorOf(gId);
  const vale = {
    id: Date.now(), valeNum: getNextValeNum(), gestorId: gId,
    ts: new Date().toISOString(), cliente: avVal('av-cliente'),
    telefono: avVal('av-telefono'), direccion: avVal('av-direccion'), carnet: avVal('av-carnet'),
    mensajeria: avVal('av-mensajeria'), articulo: avVal('av-articulo'),
    precioUSD: avVal('av-precioUSD'), precioMN: avVal('av-precioMN'),
    vuelto: avVal('av-vuelto'), total: avVal('av-total'),
    garantia: avVal('av-garantia'), comisionGestor: avVal('av-comisionGestor'),
    valeProductos: adminValeProductos, valeText: buildAdminValeText(),
    status: 'pending', mensajeroId: null, confirmedTs: null,
    isNew: true, adminNotes: 'Generado por Admin',
  };

  // ── 1. Guardar el vale LOCALMENTE y encolar write a Firebase (síncrono, rápido) ──
  // BUGFIX: ver el comentario detallado en sendVale() — getVales().push()
  // mutaba _valesCache antes de que saveVales() pudiera diferenciar "antes"
  // vs "ahora", y el write nunca se encolaba.
  const all = [...getVales(), vale]; saveVales(all);
  _logAudit('admin_vale_sent', 'vale:' + vale.id + ' gestor:' + gId);

  // ── 2. Feedback INMEDIATO al admin ──
  playSound('vale');
  showToast(`Vale ${valeNumStr(vale)} generado para ${g ? g.name : 'gestor'} ✓`);
  closeAdminValeModal();
  _isSendingAdminVale = false;

  // ── 3. Diferir los renders pesados ──
  setTimeout(() => {
    try {
      renderAdminGestores();
      renderValeDetail();
      updateAdminBadge();
      maybeAutoSync();
    } catch(e) {
      console.error('sendAdminVale deferred render error:', e);
    }
  }, 0);
}

function openAdminProductPicker() {
  if (!getProductos().length) { showToast('No hay productos cargados'); return; }
  adminPickerSelected = {};
  adminValeProductos.forEach(p => { adminPickerSelected[p.id] = p.qty; });
  adminPickerCatFilter = null;
  const searchEl = document.getElementById('av-pickerSearch');
  if (searchEl) searchEl.value = '';
  renderAdminPickerCatTabs(); renderAdminPickerProducts(); renderAdminPickerSelected();
  document.getElementById('adminProductPickerModal').classList.add('show');
}
function closeAdminProductPicker() { document.getElementById('adminProductPickerModal').classList.remove('show'); }

// Unified picker search handler — dispatches to the correct context
// (edit vale vs admin vale generator) based on which modal is open.
function handlePickerSearch() {
  // If editValeModal is open, we're in edit context
  if(document.getElementById('editValeModal')?.classList.contains('show')) {
    if (typeof renderEditValePickerProducts === 'function') renderEditValePickerProducts();
  } else {
    renderAdminPickerProducts();
  }
}

function renderAdminPickerCatTabs() {
  const cats = getCategorias(); const el = document.getElementById('av-pickerCatTabs');
  if (!el) return;
  el.innerHTML = `<button class="pcat-tab ${adminPickerCatFilter===null?'active':''}" onclick="setAdminPickerCat(null)">Todos</button>` +
    cats.map(c=>`<button class="pcat-tab ${adminPickerCatFilter===c.id?'active':''}" onclick="setAdminPickerCat(${c.id})">${escapeHTML(c.name)}</button>`).join('');
}
function setAdminPickerCat(id) { adminPickerCatFilter=id; renderAdminPickerCatTabs(); renderAdminPickerProducts(); }

const _apcCatColors=['#006d8a','#7c3aed','#dc2626','#059669','#d97706','#2563eb','#be185d','#475569','#0ea5e9','#f97316','#14b8a6','#84cc16'];
function _apcGetCatColor(catId){
  const cats=getCategorias(); const idx=cats.findIndex(c=>c.id===catId);
  return idx>=0?_apcCatColors[idx%_apcCatColors.length]:'#64748b';
}
function _apcGetCatName(catId){
  const c=getCategorias().find(x=>x.id===catId);
  return c?c.name:'Otro';
}

function renderAdminPickerProducts() {
  const searchEl = document.getElementById('av-pickerSearch');
  const search = searchEl ? searchEl.value.toLowerCase() : '';
  let prods = getProductos();
  if (adminPickerCatFilter!==null) prods=prods.filter(p=>p.catId===adminPickerCatFilter);
  if (search) prods=prods.filter(p=>p.name.toLowerCase().includes(search)||(p.description||'').toLowerCase().includes(search));
  const grid = document.getElementById('av-pickerProductGrid'); if(!grid)return;
  if(!prods.length){grid.innerHTML='<div style="text-align:center;padding:30px 10px;color:var(--gray-400);"><div style="font-size:32px;margin-bottom:8px;opacity:.4;">📦</div><div style="font-size:13px;">No se encontraron productos</div></div>';return;}
  grid.innerHTML = prods.map(p=>{
    const qty=adminPickerSelected[p.id]||0; const sel=qty>0;
    const catColor=_apcGetCatColor(p.catId);
    const catName=_apcGetCatName(p.catId);
    return `<div class="apcard${sel?' picked':''}">
      <div class="apcard-info">
        <div class="apcard-name"><span class="apcard-cat" style="background:${catColor}">${escapeHTML(catName)}</span>${escapeHTML(p.name)}${p.garantia?`<span class="apcard-garantia">🛡️ ${escapeHTML(p.garantia)}</span>`:''}</div>
        ${p.precio?`<div class="apcard-price">${escapeHTML(p.precio)}</div>`:''}
      </div>
      <div class="apcard-controls">
        <button class="btn-minus" onclick="event.stopPropagation();setAdminPickerQty(${p.id},-1)">−</button>
        <span class="qty-val">${qty}</span>
        <button class="btn-plus" onclick="event.stopPropagation();setAdminPickerQty(${p.id},1)">+</button>
      </div>
    </div>`;
  }).join('');
}

function toggleAdminPickerProd(pid) {
  if(adminPickerSelected[pid]){delete adminPickerSelected[pid];}else{adminPickerSelected[pid]=1;}
  renderAdminPickerProducts(); renderAdminPickerSelected();
}
function setAdminPickerQty(pid, delta) {
  // A diferencia de pickerAdj() (picker del gestor) y setEditValePickerQty() (picker
  // de edición), este picker del "Generar vale" del admin no tenía tope de stock —
  // se podía seleccionar cualquier cantidad aunque el producto estuviera agotado o
  // totalmente reservado. Se agrega el mismo límite que usan los otros dos pickers.
  const prod=productoOf(pid);
  const max=prod?_availableStock(prod):0;
  let q=(adminPickerSelected[pid]||0)+delta;
  if(q<=0){delete adminPickerSelected[pid];}else{adminPickerSelected[pid]=Math.min(max,q);}
  renderAdminPickerProducts(); renderAdminPickerSelected();
}
function renderAdminPickerSelected() {
  const el = document.getElementById('av-pickerSelectedList'); if(!el)return;
  const items = Object.entries(adminPickerSelected).map(([id,qty])=>{
    const p=productoOf(parseInt(id)); return p?{id:parseInt(id),name:p.name,qty,precio:p.precio||''}:null;
  }).filter(Boolean);
  if(!items.length){el.innerHTML='<div style="font-size:12px;color:var(--gray-400);">Ningún producto seleccionado</div>';return;}
  el.innerHTML = items.map(i=>`<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;padding:4px 8px;background:var(--blue-lt);border-radius:8px;">
    <span style="font-weight:800;color:var(--blue);min-width:18px;">${i.qty}×</span>
    <span style="flex:1;font-size:12px;font-weight:600;">${escapeHTML(i.name)}</span>
    ${i.precio?`<span style="font-size:11px;color:var(--blue);font-weight:700;">${escapeHTML(i.precio)}</span>`:''}
    <button onclick="setAdminPickerQty(${i.id},-1)" style="width:22px;height:22px;border-radius:50%;border:1px solid var(--gray-200);background:var(--surface);cursor:pointer;font-weight:700;color:var(--red);font-size:13px;display:flex;align-items:center;justify-content:center;">−</button>
    <button onclick="setAdminPickerQty(${i.id},1)" style="width:22px;height:22px;border-radius:50%;border:1px solid var(--gray-200);background:var(--surface);cursor:pointer;font-weight:700;color:var(--green);font-size:13px;display:flex;align-items:center;justify-content:center;">+</button>
  </div>`).join('');
}

// Context-aware picker confirm: edit vale or admin vale creation
function handlePickerConfirm() {
  // If editValeModal is open, use edit picker confirm
  if(document.getElementById('editValeModal')?.classList.contains('show')) {
    confirmEditValePickerSelection();
  } else {
    confirmAdminPickerSelection();
  }
}
function confirmAdminPickerSelection() {
  const items = Object.entries(adminPickerSelected).map(([id,qty])=>{
    const p=productoOf(parseInt(id)); return {id:parseInt(id),name:p?p.name:id,qty};
  });
  adminValeProductos = items;
  document.getElementById('av-articulo').value = items.map(i=>`×${i.qty} ${i.name}`).join(' / ');
  // auto-sum prices: separate USD and MN properly
  let usdTotal=0, mnTotal=0;
  items.forEach(({id,qty})=>{
    const p=productoOf(id); if(!p||!p.precio)return;
    const num=parsePrecioNum(p.precio)*qty;
    const isMN=(p.precio+'').toUpperCase().includes('MN')||(p.precio+'').toUpperCase().includes('CUP');
    if(isMN)mnTotal+=num; else usdTotal+=num;
  });
  if(usdTotal>0||mnTotal>0){
    document.getElementById('av-precioUSD').value=usdTotal>0?`$${usdTotal} USD`:'';
    document.getElementById('av-precioMN').value=mnTotal>0?`${Math.round(mnTotal)} MN`:'';
    calcAdminAutoTotal();
  }
  // auto-calculate commission based on products selected and quantity
  let comUSD=0, comMN=0;
  items.forEach(({id,qty})=>{
    const p=productoOf(id);if(!p)return;
    const com=p.comision||'';
    if(!com)return;
    const isPct=com.includes('%');
    const comUpper=(com+'').toUpperCase();
    const isMNCom=comUpper.includes('MN')||comUpper.includes('CUP');
    const moneda=p.comisionMoneda||'';
    const useMN=isMNCom||moneda.toUpperCase()==='MN';
    if(isPct){
      const pct=parseFloat(com.replace(/[^0-9.]/g,''));
      const priceNum=parsePrecioNum(p.precio||'');
      if(!isNaN(pct)&&priceNum>0){
        const amt=Math.round(priceNum*(pct/100)*qty*100)/100;
        if(useMN)comMN+=amt; else comUSD+=amt;
      }
    } else {
      const num=parsePrecioNum(com)*qty;
      if(num>0){ if(useMN)comMN+=num; else comUSD+=num; }
    }
  });
  if(comUSD>0||comMN>0){
    const parts=[];
    if(comUSD>0)parts.push(`$${comUSD.toFixed(2)} USD`);
    if(comMN>0)parts.push(`${Math.round(comMN)} MN`);
    document.getElementById('av-comisionGestor').value=parts.join(' + ');
  }
  if(!document.getElementById('av-garantia').value){
    const g=items.map(({id})=>productoOf(id)?.garantia).find(Boolean);
    if(g)document.getElementById('av-garantia').value=g;
  }
  const spList=document.getElementById('av-selectedProductsList');
  if(spList&&items.length){
    spList.style.display='block';
    spList.innerHTML=`<div style="display:flex;flex-direction:column;gap:4px;margin-bottom:6px;">`+
      items.map(i=>`<div style="display:flex;align-items:center;gap:6px;">
        <span style="font-weight:800;color:var(--blue);font-size:12px;">×${i.qty}</span>
        <span style="font-size:11px;">${escapeHTML(i.name)}</span>
      </div>`).join('')+`</div>`;
  } else if(spList){spList.style.display='none';}
  closeAdminProductPicker(); onAdminValeInput();
}

// ══════════════════════════════════════════
//  AUDIT LOG — tracks who did what and when
// ══════════════════════════════════════════
function _getAuditLog() {
  try { return JSON.parse(localStorage.getItem('axon_audit_log') || '[]'); }
  catch(e) { return []; }
}
function _logAudit(action, target) {
  try {
    const log = _getAuditLog();
    const actor = IS_ADMIN ? 'admin' : (activeGestorId ? 'gestor:' + activeGestorId : 'anonymous');
    log.unshift({ ts: new Date().toISOString(), actor, action, target: target || '' });
    // Cap to last 200 entries to prevent unbounded localStorage growth
    if (log.length > 200) log.length = 200;
    localStorage.setItem('axon_audit_log', JSON.stringify(log));
  } catch(e) {/* localStorage full or unavailable */}
}
function renderAuditLog() {
  const el = document.getElementById('auditLogList');
  if (!el) return;
  const log = _getAuditLog();
  if (!log.length) {
    el.innerHTML = '<div class="es"><div class="es-text">Sin eventos registrados</div></div>';
    return;
  }
  el.innerHTML = log.slice(0, 50).map(e => {
    const d = new Date(e.ts);
    const dateStr = d.toLocaleDateString('es-ES') + ' ' + d.toLocaleTimeString('es-ES', {hour:'2-digit', minute:'2-digit'});
    return `<div class="audit-entry">
      <span class="audit-ts">${dateStr}</span> ·
      <span class="audit-action">${escapeHTML(e.action)}</span> ·
      <span class="audit-user">${escapeHTML(e.actor)}</span>
      ${e.target ? ` · <span style="color:var(--gray-600);">${escapeHTML(e.target)}</span>` : ''}
    </div>`;
  }).join('');
}

// ══════════════════════════════════════════
//  SESSION TIMEOUT — auto-logout admin after 15 min of inactivity
// ══════════════════════════════════════════
const SESSION_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const SESSION_WARNING_MS = 14 * 60 * 1000; // Warn at 14 min
let _sessionTimer = null;
let _sessionWarnTimer = null;
function _resetSessionTimer() {
  if (!IS_ADMIN || !adminActive) return;
  clearTimeout(_sessionTimer);
  clearTimeout(_sessionWarnTimer);
  const warnEl = document.getElementById('sessionWarning');
  if (warnEl) warnEl.classList.remove('show');
  _sessionWarnTimer = setTimeout(() => {
    if (!adminActive) return;
    const warnEl = document.getElementById('sessionWarning');
    if (warnEl) {
      warnEl.classList.add('show');
      warnEl.onclick = () => { _resetSessionTimer(); };
    }
  }, SESSION_WARNING_MS);
  _sessionTimer = setTimeout(() => {
    if (!adminActive) return;
    showToast('Sesión cerrada por inactividad');
    logoutAdmin();
  }, SESSION_TIMEOUT_MS);
}
['click', 'keydown', 'touchstart', 'mousemove'].forEach(evt => {
  document.addEventListener(evt, () => { if (IS_ADMIN && adminActive) _resetSessionTimer(); }, { passive: true });
});// ══════════════════════════════════════════
//  PWA INSTALL PROMPT (v92 — universal + métodos alternativos)
//  - Cuando beforeinstallprompt NO se dispara y el menú ⋮ de Chrome
//    no tiene "Instalar app" (caso del teléfono problemático), damos
//    métodos alternativos que SÍ funcionan:
//    1) navigator.share() → abre hoja de compartir de Android donde
//       MIUI / One UI / Pixel launcher tienen "Añadir a pantalla de inicio"
//    2) Código QR → escanear desde otro móvil con Chrome que funcione
//    3) Copiar URL → compartir por WhatsApp/Telegram
// ══════════════════════════════════════════
let _deferredInstallPrompt = null;
let _installDiagnosticInfo = {
  promptReceived: false,
  promptTime: null,
  hasManifest: false,
  manifestValid: false,
  hasSW: false,
  isStandalone: false,
  alreadyInstalled: false,
  https: location.protocol === 'https:' || location.hostname === 'localhost'
};
const PWA_DISMISS_KEY = 'axon_pwa_install_dismissed';
const PWA_DISMISS_DAYS = 7;
const PWA_BANNER_WAIT_MS = 3500;
const PWA_PROMPT_GRACE_MS = 8000;

function _isStandaloneMode() {
  if (window.navigator.standalone === true) return true;
  if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
  if (window.matchMedia && window.matchMedia('(display-mode: fullscreen)').matches) return true;
  if (window.matchMedia && window.matchMedia('(display-mode: minimal-ui)').matches) return true;
  return false;
}
function _isIOS() {
  const ua = navigator.userAgent || '';
  const isIPad = (/iPad/i.test(ua)) || (/Macintosh/i.test(ua) && (navigator.maxTouchPoints || 0) > 1);
  const isIPhone = /iPhone|iPod/i.test(ua);
  return isIPad || isIPhone;
}
function _isAndroid() { return /Android/i.test(navigator.userAgent || ''); }
function _ua() { return navigator.userAgent || ''; }

// ── Detección de navegadores ──
function _isMiBrowser() { return /MiuiBrowser|XiaoMi\/MiuiBrowser|Miui\/Hybrid|XiaoMi\/Hunter/i.test(_ua()); }
function _isHuaweiBrowser() { return /HuaweiBrowser|HBPC\/|HuaWeiBrowser/i.test(_ua()); }
function _isQuarkOrUc() { return /Quark\/|UCBrowser\/|UCWEB/i.test(_ua()); }
function _isSamsungInternet() { return /SamsungBrowser\//i.test(_ua()); }
function _isOpera() { return /OPR\/|Opera\/|Opera\sMini|OPT\//i.test(_ua()); }
function _isBrave() { return typeof navigator.brave !== 'undefined'; }
function _isVivaldi() { return /Vivaldi\//i.test(_ua()); }
function _isEdge() { return /Edg\//i.test(_ua()); }
function _isChrome() {
  const ua = _ua();
  if (!/Chrome\//i.test(ua)) return false;
  if (_isEdge() || _isOpera() || _isSamsungInternet() || _isVivaldi()) return false;
  return true;
}
function _isFirefox() { return /Firefox\//i.test(_ua()) && !/Seamonkey\//i.test(_ua()); }
function _isKiwi() { return /Kiwi/i.test(_ua()); }
function _isWebView() { return /FBAN|FBAV|Instagram|WhatsApp|Line\/|; wv\)/i.test(_ua()); }
function _isDesktop() { return !_isIOS() && !_isAndroid(); }

function _needsManualInstall() {
  return _isIOS() || _isMiBrowser() || _isHuaweiBrowser() || _isQuarkOrUc();
}
function _isXiaomiDevice() {
  return /Mi\s|Redmi|POCO|Xiaomi|MiuiBrowser/i.test(_ua());
}

function _browserLabel() {
  const ua = _ua();
  if (_isWebView()) return 'Navegador dentro de app (Facebook/Instagram/WhatsApp)';
  if (_isMiBrowser()) return 'Navegador Mi (Xiaomi)';
  if (_isHuaweiBrowser()) return 'Navegador Huawei';
  if (_isQuarkOrUc()) return /Quark/.test(ua) ? 'Quark' : 'UC Browser';
  if (_isSamsungInternet()) return 'Samsung Internet';
  if (_isOpera()) return 'Opera';
  if (_isVivaldi()) return 'Vivaldi';
  if (_isEdge()) return 'Microsoft Edge';
  if (_isBrave()) return 'Brave';
  if (_isKiwi()) return 'Kiwi Browser';
  if (/CriOS/i.test(ua)) return 'Chrome (iPhone)';
  if (/FxiOS/i.test(ua)) return 'Firefox (iPhone)';
  if (_isFirefox()) return 'Firefox';
  if (_isChrome()) return 'Chrome';
  if (/Safari\//i.test(ua) && _isIOS()) return 'Safari';
  if (_isDesktop()) return 'Navegador de escritorio';
  return 'tu navegador';
}

function _isInstallDismissed() {
  try {
    const ts = parseInt(localStorage.getItem(PWA_DISMISS_KEY) || '0', 10);
    if (!ts) return false;
    const days = (Date.now() - ts) / (1000 * 60 * 60 * 24);
    return days < PWA_DISMISS_DAYS;
  } catch(e) { return false; }
}
function _dismissPWAInstall() {
  try { localStorage.setItem(PWA_DISMISS_KEY, String(Date.now())); } catch(e) {}
  const b = document.getElementById('pwaInstallBanner');
  if (b) b.classList.remove('show');
}

// ── Web Share API: el método alternativo más fiable ──
// Abre la hoja de compartir de Android. En MIUI, One UI y Pixel launcher,
// la hoja incluye "Añadir a pantalla de inicio" como destino de compartir.
async function _shareForInstall() {
  if (!navigator.share) {
    showToast('Tu navegador no soporta compartir. Copia la URL manualmente.');
    return;
  }
  try {
    await navigator.share({
      title: 'AXONTECH',
      text: 'Instala AXONTECH en tu pantalla de inicio',
      url: location.href
    });
  } catch(e) {
    // El usuario canceló — no hacer nada
  }
}

// ── Copiar URL al portapapeles ──
async function _copyInstallURL() {
  const url = location.href;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(url);
      showToast('✅ URL copiada — pégala en WhatsApp o donde quieras');
    } else {
      // Fallback: input temporal
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('✅ URL copiada — pégala en WhatsApp o donde quieras');
    }
  } catch(e) {
    showToast('No pude copiar. Anota la URL: ' + url);
  }
}

// ── Generar y mostrar código QR ──
// Construye un modal overlay con la imagen QR generada por api.qrserver.com
// (servicio público gratuito). El QR contiene la URL actual.
function _showInstallQR() {
  let modal = document.getElementById('pwaInstallQRModal');
  if (!modal) {
    // Crear el modal una sola vez
    modal = document.createElement('div');
    modal.id = 'pwaInstallQRModal';
    modal.className = 'modal-bg';
    modal.innerHTML = `
      <div class="modal" style="max-width:320px;width:90%;text-align:center;">
        <div class="modal-title">🖼️ Escanea este QR</div>
        <div class="modal-sub" style="margin-bottom:14px;">
          Abre la cámara de otro teléfono y apúntala al código. Te llevará a AXONTECH en un navegador que sí soporta instalación.
        </div>
        <div id="pwaInstallQRImgWrap" style="background:#fff;padding:14px;border-radius:10px;display:inline-block;margin:8px 0 14px;">
          <img id="pwaInstallQRImg" alt="Código QR de AXONTECH" style="display:block;width:220px;height:220px;" />
        </div>
        <div id="pwaInstallQRUrl" style="font-size:10px;color:var(--muted,#94a3b8);word-break:break-all;margin-bottom:14px;line-height:1.4;"></div>
        <div class="modal-btns">
          <button type="button" class="btn btn-blue btn-full" onclick="_copyInstallURL()">📋 Copiar URL</button>
          <button type="button" class="btn btn-ghost btn-full" onclick="document.getElementById('pwaInstallQRModal').classList.remove('show')">Cerrar</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    // Cerrar al hacer clic en el fondo
    modal.addEventListener('click', (ev) => {
      if (ev.target === modal) modal.classList.remove('show');
    });
  }
  const url = location.href;
  const qrImg = modal.querySelector('#pwaInstallQRImg');
  const urlEl = modal.querySelector('#pwaInstallQRUrl');
  if (qrImg) {
    // api.qrserver.com genera QR gratis sin API key
    qrImg.src = 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=10&data=' + encodeURIComponent(url);
    qrImg.onerror = () => {
      qrImg.style.display = 'none';
      const wrap = modal.querySelector('#pwaInstallQRImgWrap');
      if (wrap) wrap.innerHTML = '<div style="color:#dc2626;padding:30px;font-size:12px;">No pude generar el QR. Usa el botón Copiar URL.</div>';
    };
  }
  if (urlEl) urlEl.textContent = url;
  modal.classList.add('show');
}

// ── Mostrar banner con contenido dinámico según contexto ──
function _showPWAInstallBanner() {
  const b = document.getElementById('pwaInstallBanner');
  if (!b) return;
  const subEl = document.getElementById('pwaInstallSub');
  const btnInstall = document.getElementById('pwaInstallBtn');
  const manualHint = document.getElementById('pwaInstallManualHint');
  const iosInstructions = document.getElementById('pwaInstallIOSHint');

  if (manualHint) manualHint.style.display = 'none';
  if (iosInstructions) iosInstructions.style.display = 'none';
  if (btnInstall) { btnInstall.style.display = 'none'; btnInstall.onclick = null; }

  const isIOS = _isIOS();
  const label = _browserLabel();

  if (isIOS) {
    if (subEl) subEl.textContent = 'Toca Compartir y luego "Añadir a pantalla de inicio"';
    if (iosInstructions) iosInstructions.style.display = 'block';
    // En iOS mostramos el botón "Instalar" que abre el modal de ayuda (no hay beforeinstallprompt)
    if (btnInstall) {
      btnInstall.style.display = 'inline-block';
      btnInstall.onclick = openPWAInstallHelp;
    }
  } else if (_deferredInstallPrompt) {
    // beforeinstallprompt disponible → botón nativo de instalar
    if (subEl) subEl.textContent = 'Acceso rápido desde tu pantalla de inicio, sin tienda de apps';
    if (btnInstall) {
      btnInstall.style.display = 'inline-block';
      btnInstall.onclick = _triggerPWAInstall;
    }
  } else {
    // CASO CLAVE: Chrome en Android sin beforeinstallprompt.
    // Banner SIMPLE: el botón "Instalar" abre el modal de ayuda (donde están
    // los métodos alternativos: Compartir, QR, Copiar URL).
    if (subEl) {
      if (_isChrome() || _isEdge() || _isBrave() || _isOpera() || _isVivaldi() || _isKiwi()) {
        subEl.textContent = 'Pulsa Instalar para ver cómo agregar AXONTECH a tu pantalla de inicio';
      } else if (_isMiBrowser() || _isHuaweiBrowser() || _isQuarkOrUc()) {
        subEl.textContent = 'Tu ' + label + ' no soporta instalación directa — pulsa Instalar para ver opciones';
      } else if (_isWebView()) {
        subEl.textContent = 'Pulsa Instalar para ver cómo abrir AXONTECH en un navegador real';
      } else {
        subEl.textContent = 'Pulsa Instalar para agregar AXONTECH a tu pantalla de inicio';
      }
    }
    if (btnInstall) {
      btnInstall.style.display = 'inline-block';
      btnInstall.onclick = openPWAInstallHelp;
    }
  }
  b.classList.add('show');
}

async function _triggerPWAInstall() {
  if (!_deferredInstallPrompt) {
    openPWAInstallHelp();
    return;
  }
  try {
    _deferredInstallPrompt.prompt();
    const choice = await _deferredInstallPrompt.userChoice;
    if (choice && choice.outcome === 'accepted') {
      showToast('🎉 Instalando AXONTECH…');
    } else {
      _dismissPWAInstall();
    }
  } catch(e) {
    console.warn('Install prompt error:', e);
    openPWAInstallHelp();
  } finally {
    _deferredInstallPrompt = null;
    const b = document.getElementById('pwaInstallBanner');
    if (b) b.classList.remove('show');
  }
}

// ══════════════════════════════════════════
//  MODAL DE AYUDA DE INSTALACIÓN
// ══════════════════════════════════════════
function openPWAInstallHelp() {
  const modal = document.getElementById('pwaInstallHelpModal');
  if (!modal) return;

  const browserLbl = document.getElementById('pwaHelpBrowser');
  if (browserLbl) browserLbl.textContent = _browserLabel();

  // Ocultar todos los bloques
  const blockIds = [
    'pwaHelpChrome', 'pwaHelpChromeNoPrompt', 'pwaHelpSamsung', 'pwaHelpOpera',
    'pwaHelpKiwi', 'pwaHelpXiaomi', 'pwaHelpHuawei', 'pwaHelpIphone',
    'pwaHelpFirefox', 'pwaHelpGeneric', 'pwaHelpDesktop', 'pwaHelpWebView'
  ];
  blockIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  // Decidir qué bloque mostrar
  let blockId = null;
  if (_isIOS()) {
    blockId = 'pwaHelpIphone';
  } else if (_isWebView()) {
    blockId = 'pwaHelpWebView';
  } else if (_isMiBrowser()) {
    blockId = 'pwaHelpXiaomi';
  } else if (_isHuaweiBrowser()) {
    blockId = 'pwaHelpHuawei';
  } else if (_deferredInstallPrompt) {
    blockId = 'pwaHelpChrome';
  } else if (_isChrome() || _isEdge()) {
    blockId = 'pwaHelpChromeNoPrompt';
  } else if (_isSamsungInternet()) {
    blockId = 'pwaHelpSamsung';
  } else if (_isOpera() || _isBrave() || _isVivaldi()) {
    blockId = 'pwaHelpOpera';
  } else if (_isKiwi()) {
    blockId = 'pwaHelpKiwi';
  } else if (_isFirefox()) {
    blockId = 'pwaHelpFirefox';
  } else if (_isDesktop()) {
    blockId = 'pwaHelpDesktop';
  } else {
    blockId = 'pwaHelpGeneric';
  }
  const block = document.getElementById(blockId);
  if (block) block.style.display = 'block';

  // Botón "Instalar ahora" — solo si tenemos beforeinstallprompt
  const installNowBtn = document.getElementById('pwaHelpInstallNowBtn');
  if (installNowBtn) {
    if (_deferredInstallPrompt) {
      installNowBtn.style.display = 'inline-block';
      installNowBtn.onclick = () => {
        modal.classList.remove('show');
        _triggerPWAInstall();
      };
    } else {
      installNowBtn.style.display = 'none';
      installNowBtn.onclick = null;
    }
  }

  // Botón "Compartir / Agregar a inicio" (Web Share API) — visible en móvil
  const shareBtn = document.getElementById('pwaHelpShareBtn');
  if (shareBtn) {
    if (navigator.share && (_isAndroid() || _isIOS())) {
      shareBtn.style.display = 'inline-block';
      shareBtn.onclick = _shareForInstall;
    } else {
      shareBtn.style.display = 'none';
      shareBtn.onclick = null;
    }
  }

  // Botón "Ver código QR" — siempre visible
  const qrBtn = document.getElementById('pwaHelpQRBtn');
  if (qrBtn) {
    qrBtn.style.display = 'inline-block';
    qrBtn.onclick = _showInstallQR;
  }

  // Botón "Copiar URL" — siempre visible
  const copyBtn = document.getElementById('pwaHelpCopyBtn');
  if (copyBtn) {
    copyBtn.style.display = 'inline-block';
    copyBtn.onclick = _copyInstallURL;
  }

  modal.classList.add('show');
}
function closePWAInstallHelp() {
  const modal = document.getElementById('pwaInstallHelpModal');
  if (modal) modal.classList.remove('show');
}

// ── Diagnóstico técnico (long-press en botón del header) ──
async function _showInstallDiagnostic() {
  const info = _installDiagnosticInfo;
  const ua = _ua();

  // Verificar getInstalledRelatedApps (Chrome 80+)
  let relatedApps = 'no soportado';
  if (navigator.getInstalledRelatedApps) {
    try {
      const apps = await navigator.getInstalledRelatedApps();
      relatedApps = apps && apps.length ? 'INSTALADA: ' + apps.map(a => a.id).join(', ') : 'no instalada';
      info.alreadyInstalled = !!(apps && apps.length);
    } catch(e) { relatedApps = 'error: ' + e.message; }
  }

  const lines = [
    '🔧 DIAGNÓSTICO DE INSTALACIÓN',
    '',
    'Navegador: ' + _browserLabel(),
    'UA: ' + ua.substring(0, 150),
    'Plataforma: ' + (_isIOS() ? 'iOS' : _isAndroid() ? 'Android' : 'Desktop/otro'),
    'HTTPS: ' + (info.https ? 'Sí' : 'No'),
    'Standalone: ' + (info.isStandalone ? 'Sí (ya instalado)' : 'No'),
    'Service Worker: ' + (info.hasSW ? 'Soportado' : 'No soportado'),
    'Manifest: ' + (info.hasManifest ? (info.manifestValid ? 'OK' : 'CARGADO PERO INVÁLIDO') : 'FALTA'),
    'beforeinstallprompt: ' + (info.promptReceived ? 'Recibido ✓' : 'NO recibido ✗'),
    'deferredPrompt: ' + (_deferredInstallPrompt ? 'Disponible' : 'No disponible'),
    'navigator.share: ' + (typeof navigator.share === 'function' ? 'Disponible ✓' : 'No ✗'),
    'getInstalledRelatedApps: ' + relatedApps,
    '',
    'CAUSAS POSIBLES de "no recibido":',
    '• Chrome < 86 (menú ⋮ no tiene "Instalar app")',
    '• Sitio cargado en modo incógnito',
    '• Chrome con almacenamiento lleno',
    '• Manifest invalid o SW no activado',
    '• Modo escritorio activado en este sitio',
    '',
    'Si todo dice OK pero prompt=no recibido,',
    'es problema del Chrome de este teléfono.',
    'Usa los botones "Compartir" / "QR" / "Copiar URL"',
    'del modal como alternativa.'
  ];
  alert(lines.join('\n'));
}

// ── Setup principal ──
function setupPWAInstallPrompt() {
  // Diagnóstico: registrar estado inicial
  _installDiagnosticInfo.isStandalone = _isStandaloneMode();
  _installDiagnosticInfo.hasSW = ('serviceWorker' in navigator);

  // Verificar manifest (async) — fetch y validar campos mínimos
  try {
    fetch('./manifest.json', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(m => {
        if (!m) { _installDiagnosticInfo.hasManifest = false; return; }
        _installDiagnosticInfo.hasManifest = true;
        _installDiagnosticInfo.manifestValid = !!(
          m.name && m.short_name && m.start_url &&
          m.display &&
          Array.isArray(m.icons) && m.icons.length > 0 &&
          m.icons.some(i => i.sizes && /192|512/.test(i.sizes))
        );
      })
      .catch(() => { _installDiagnosticInfo.hasManifest = false; });
  } catch(e) {}

  // 1) Si ya está instalado → ocultar botón del header
  if (_isStandaloneMode()) {
    const hdrBtn = document.getElementById('btnPWAInstallHeader');
    if (hdrBtn) hdrBtn.style.display = 'none';
    return;
  }

  // 2) Botón del header: SIEMPRE visible (incluso desktop).
  //    Click corto → modal de ayuda. Long-press (800ms) → diagnóstico.
  const hdrBtn = document.getElementById('btnPWAInstallHeader');
  if (hdrBtn) {
    hdrBtn.style.display = 'inline-flex';
    hdrBtn.onclick = openPWAInstallHelp;
    let _pressTimer = null;
    const startPress = (ev) => {
      if (_pressTimer) clearTimeout(_pressTimer);
      _pressTimer = setTimeout(() => {
        _pressTimer = null;
        _showInstallDiagnostic();
      }, 800);
    };
    const cancelPress = () => {
      if (_pressTimer) { clearTimeout(_pressTimer); _pressTimer = null; }
    };
    hdrBtn.addEventListener('touchstart', startPress, { passive: true });
    hdrBtn.addEventListener('touchend', cancelPress);
    hdrBtn.addEventListener('touchcancel', cancelPress);
    hdrBtn.addEventListener('touchmove', cancelPress, { passive: true });
    hdrBtn.addEventListener('mousedown', startPress);
    hdrBtn.addEventListener('mouseup', cancelPress);
    hdrBtn.addEventListener('mouseleave', cancelPress);
    hdrBtn.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      _showInstallDiagnostic();
    });
  }

  // 3) Si el usuario lo cerró hace menos de 7 días → no mostrar banner automático
  const showBanner = !_isInstallDismissed();

  // 4) Capturar beforeinstallprompt
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    _deferredInstallPrompt = e;
    _installDiagnosticInfo.promptReceived = true;
    _installDiagnosticInfo.promptTime = new Date().toISOString();
    if (showBanner) {
      const b = document.getElementById('pwaInstallBanner');
      if (b && !b.classList.contains('show')) {
        _showPWAInstallBanner();
      }
    }
  });

  // 5) appinstalled → limpiar UI
  window.addEventListener('appinstalled', () => {
    const b = document.getElementById('pwaInstallBanner');
    if (b) b.classList.remove('show');
    try { localStorage.removeItem(PWA_DISMISS_KEY); } catch(e) {}
    showToast('✅ AXONTECH instalada');
    const hdrBtn2 = document.getElementById('btnPWAInstallHeader');
    if (hdrBtn2) hdrBtn2.style.display = 'none';
  });

  // 6) Mostrar banner tras retardo. Estrategia universal:
  //    - iOS, Mi, Huawei, UC, WebView: siempre (instrucciones manuales).
  //    - Chrome/Edge/Samsung/Opera/Brave/Kiwi en Android: si en
  //      PWA_PROMPT_GRACE_MS no llegó beforeinstallprompt, mostramos banner
  //      con botón "Compartir para agregar a inicio" (Web Share API).
  //    - Desktop: no mostramos banner (solo modal desde el botón del header).
  setTimeout(() => {
    if (_isStandaloneMode()) return;
    if (!showBanner) return;
    if (_isDesktop()) return;
    if (_deferredInstallPrompt || _needsManualInstall() || _isWebView()) {
      _showPWAInstallBanner();
      return;
    }
    // Android con navegador que SÍ debería disparar beforeinstallprompt:
    // esperar gracia y mostrar banner con botón de compartir como fallback.
    setTimeout(() => {
      if (_isStandaloneMode() || _isInstallDismissed()) return;
      _showPWAInstallBanner();
    }, PWA_PROMPT_GRACE_MS);
  }, PWA_BANNER_WAIT_MS);
}






// ══════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════
async function init() {
  applyTheme(localStorage.getItem('axon_theme')==='dark');
  updateDate();
  setInterval(updateDate, 60000);
  // ── Version badge + auto-update check ──
  _initVersionBadge();
  // Primer chequeo a los 3s (para no competir con la carga inicial de Firebase)
  setTimeout(() => checkVersion(false), 3000);
  // Polling cada 5 minutos
  setInterval(() => checkVersion(false), _VERSION_CHECK_INTERVAL);
  await loadInitialData();
  _updateSyncIndicator();
  // Mostrar banner de vales pendientes de sincronizar al arrancar.
  // También re-encolar writes para vales que se quedaron huérfanos (synced:false)
  // tras un cierre de la app con red caída.
  _ensurePendingValesEnqueued();
  _updatePendingSyncBanner();
  // Verificar cada 30s si hay vales pendientes y volver a encolar si es necesario.
  setInterval(() => {
    if (_onlineStatus) _ensurePendingValesEnqueued();
    _updatePendingSyncBanner();
  }, 30000);
  if (IS_ADMIN) {
    initAdminPage();
  } else {
    initGestorPage();
  }
  // Register service worker and watch for updates
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').then(reg => {
      // Listen for new service worker versions
      reg.addEventListener('updatefound', () => {
        const newSW = reg.installing;
        if (!newSW) return;
        newSW.addEventListener('statechange', () => {
          if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
            // New version ready — auto-activar el nuevo SW y recargar.
            // Antes mostrábamos un toast pidiendo al usuario recargar, pero
            // eso causaba que siguieran viendo versiones viejas. Ahora forzamos
            // la activación inmediata.
            newSW.postMessage('SKIP_WAITING');
          }
        });
      });
      // Verificar cada 60s si hay una nueva versión del SW
      setInterval(() => {
        reg.update().catch(() => {});
      }, 60000);
    }).catch(() => {});
    // When the new SW takes control (after skipWaiting), reload once
    let _reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!_reloaded) { _reloaded = true; window.location.reload(); }
    });
    // Escuchar mensaje SW_UPDATED del SW (se envía en activate)
    navigator.serviceWorker.addEventListener('message', (ev) => {
      if (ev.data && ev.data.type === 'SW_UPDATED') {
        // Recargar para cargar la nueva versión de los assets
        setTimeout(() => window.location.reload(), 500);
      }
      // ── v15: Background Sync request del SW ──
      // El SW nos pide que procesemos la cola de writes pendientes.
      // Esto se dispara cuando el browser reanuda el SW tras un periodo
      // sin conexión (Background Sync API).
      if (ev.data && ev.data.type === 'SW_SYNC_REQUEST') {
        _ensurePendingValesEnqueued();
        _processFBQueue();
      }
    });
  }
  // PWA install prompt (Android + iPhone)
  setupPWAInstallPrompt();
  // ── Auto-seleccionar gestor fijado al inicio (si existe) ──
  _autoSelectPinnedGestor();
}
function initGestorPage() {
  // Removed the 12-second setInterval that re-rendered everything — Firebase
  // listeners already trigger refreshUI on every remote change. Only refresh
  // the timeAgo labels every 60s (cheap and useful).
  setInterval(() => {
    if (typeof renderGestorNotifs === 'function') renderGestorNotifs();
  }, 60000);
  renderGestores();
  renderGestorNotifs();
  renderGestorRanking();
  const bc = document.getElementById('btnCatalogo');
  if (bc) bc.style.display = 'inline-flex';
  // Triple-tap on AX logo → go to admin page
  let _taps = 0, _tapTimer;
  const brandTap = document.getElementById('brandTap');
  if (brandTap) {
    brandTap.addEventListener('click', () => {
      _taps++;
      clearTimeout(_tapTimer);
      _tapTimer = setTimeout(() => { _taps = 0; }, 800);
      if (_taps >= 3) { _taps = 0; window.location.href = './admin.html'; }
    });
  }
  // ── Ocultar splash screen (feedback visual de carga) ──
  if (typeof window.__axonHideSplash === 'function') {
    setTimeout(window.__axonHideSplash, 200);
  }
}
function initAdminPage() {
  updateAdminBadge(); updateMensajeroBadge();
  renderAuditLog();
  if (adminActive) {
    activateAdminMode();
    _resetSessionTimer();
  } else {
    openPassModal();
  }
  // ── Ocultar splash screen (feedback visual de carga) ──
  // Si la función existe (definida en index.html / admin.html), quitar el splash.
  if (typeof window.__axonHideSplash === 'function') {
    // Pequeño delay (200ms) para que el primer render se pinte sin parpadeo.
    setTimeout(window.__axonHideSplash, 200);
  }
}
init();
