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
const APP_VERSION = 140;
// v62: la etiqueta que se ENSEÑA va aparte del número que se COMPARA.
// APP_VERSION es el contador de publicaciones y tiene que seguir subiendo sin
// saltos: checkVersion() decide que hay actualización con `remoto > local`, así
// que si se reiniciara a 1 ningún teléfono con un número mayor volvería a ver
// el aviso de nueva versión —y el service worker no se activa solo, espera a
// que el usuario pulse "Recargar ahora" en ese mismo aviso—, con lo que se
// quedarían clavados para siempre.
// _PUBLIC_VERSION_STR es solo cosmética y la inyecta build.py: avanza 1.0, 1.1,
// … 1.9, 2.0 mientras el contador va 62, 63, 64. Si faltara, se cae al número
// interno para que el badge nunca aparezca vacío.
let _PUBLIC_VERSION_STR = 'v8.6';
const VERSION_STR = _PUBLIC_VERSION_STR || ('v' + APP_VERSION);

// Estado del chequeo de versión
let _updateDismissed = false;       // el usuario pospuso la actualización
let _lastRemoteVersion = null;       // caché en memoria de la última versión remota vista
const _VERSION_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutos

// Inicializa el badge de versión con la versión local.
function _initVersionBadge() {
  const badge = document.getElementById('versionBadge');
  if (badge) badge.textContent = VERSION_STR;
}

// ── v101: que un teléfono viejo se note SIEMPRE ─────────────────────────────
// El aviso de versión nueva se puede posponer, y al posponerlo se guarda para no
// volver a molestar (30 minutos, o hasta que salga otra versión). Efecto
// secundario: un teléfono puede quedarse semanas con código viejo sin nada en
// pantalla que lo delate, y quien lo usa jura que está actualizado. Pasó el
// 17/08: se arregló el orden de los gestores y el margen de la tasa, se
// comprobó que los datos en la nube estaban bien, y aun así dos teléfonos
// seguían enseñando lo de antes. Media tarde para descubrir que el arreglo
// estaba publicado pero no instalado.
// Ahora, si hay una versión más nueva, el número de versión se pinta en naranja
// y avisa al tocarlo. Eso no se puede posponer: o se actualiza, o se ve.
function _marcarVersionVieja(remoteStr) {
  const badge = document.getElementById('versionBadge');
  if (!badge) return;
  badge.textContent = VERSION_STR + ' ⚠';
  badge.style.color = 'var(--orange, #f59e0b)';
  badge.style.fontWeight = '700';
  badge.title = `Este teléfono usa ${VERSION_STR} y ya hay ${remoteStr}. Toca para actualizar.`;
  badge.style.cursor = 'pointer';
  badge.onclick = () => {
    if (typeof showConfirmAction === 'function') {
      showConfirmAction('¿Actualizar ahora?',
        `Este teléfono usa ${VERSION_STR} y ya hay ${remoteStr}. Hasta que se actualice, seguirá funcionando con las reglas viejas.`,
        'Actualizar', 'btn-blue', () => applyUpdate());
    } else { applyUpdate(); }
  };
}
function _desmarcarVersionVieja() {
  const badge = document.getElementById('versionBadge');
  if (!badge) return;
  badge.textContent = VERSION_STR;
  badge.style.color = '';
  badge.style.fontWeight = '';
  badge.title = '';
  badge.onclick = null;
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
let _LOCAL_BUILD_HASH = '73c759e3767ee9fb';

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
    //     Y la versión remota es ESTRICTAMENTE mayor (no igual).
    //     v30 FIX: Antes, un hash distinto en la MISMA versión mostraba el banner
    //     eternamente (el usuario no puede "actualizar" a la misma versión). Ahora
    //     solo consideramos hashChanged si también hay una versión más nueva.
    const isNewer = _isNewerVersion(remoteVersion, APP_VERSION);
    const hashChanged = remoteHash && remoteHash !== _LOCAL_BUILD_HASH && isNewer;
    const hasUpdate = isNewer || hashChanged;

    if (hasUpdate) {
      // v101: el número de versión se marca SIEMPRE, se haya pospuesto el aviso
      // o no. El banner se puede callar; esto no.
      _marcarVersionVieja(remoteStr);
      // Hay una versión nueva — mostrar banner (salvo que el usuario ya lo haya pospuesto
      // para esta sesión y no sea una verificación manual).
      // ── v28 BUGFIX: No mostrar banner si el usuario ya pospuso ESTA versión ──
      const dismissedFor = parseInt(localStorage.getItem('axon_update_dismissed') || '0', 10);
      const alreadyDismissedThisVersion = (dismissedFor >= remoteVersion);
      // v32 FIX: More aggressive cooldown to prevent stuck update banner
      let inCooldown = false;
      try {
        const applyingAt = parseInt(localStorage.getItem('axon_update_applying') || '0', 10);
        if (applyingAt && (Date.now() - applyingAt) < 300000) {  // 5min cooldown (v32: was 60s)
          inCooldown = true;
        } else if (applyingAt) {
          localStorage.removeItem('axon_update_applying');  // cooldown expired, clean up
        }
      } catch(e) {}
      // v32: Also check dismissed timestamp — don't re-show within 30 minutes
      let recentlyDismissed = false;
      try {
        const dismissedTs = parseInt(localStorage.getItem('axon_update_dismissed_ts') || '0', 10);
        if (dismissedTs && (Date.now() - dismissedTs) < 1800000) { // 30 min
          recentlyDismissed = true;
        }
      } catch(e) {}
      if ((manual || (!_updateDismissed && !alreadyDismissedThisVersion && !inCooldown && !recentlyDismissed))) {
        _showUpdateBanner(remoteStr, data.changelog);
      }
    } else {
      // Estamos al día
      // Se añade el nº de compilación: el badge enseña la etiqueta pública, y
      // para dar soporte hace falta saber a qué publicación corresponde.
      if (manual) showToast('Ya tienes la última versión (' + VERSION_STR + ' · build ' + APP_VERSION + ') ✓');
      _desmarcarVersionVieja();   // v101: se actualizó — quitar el aviso naranja
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
// ── v28 BUGFIX: Persistir el dismiss en localStorage ──
// ANTES: _updateDismissed se reseteaba en cada page reload, así que el
// banner volvía cada 5 minutos o al recargar. Ahora se guarda la versión
// que el usuario pospuso, y solo se vuelve a mostrar si hay una versión
// NUEVA distinta a la que ya pospuso.
function dismissUpdate() {
  _updateDismissed = true;
  try {
    localStorage.setItem('axon_update_dismissed', _lastRemoteVersion || APP_VERSION);
    // v32: Also set a timestamp so we don't re-show for at least 30 minutes
    localStorage.setItem('axon_update_dismissed_ts', Date.now().toString());
  } catch(e) {}
  _hideUpdateBanner();
}

// El usuario pulsó "Recargar ahora" — forzar recarga limpia saltando la caché.
function applyUpdate() {
  // v31 FIX: Prevent reload loop. Set a cooldown flag so checkVersion
  // doesn't re-show the banner immediately after reload.
  try {
    localStorage.setItem('axon_update_dismissed', _lastRemoteVersion || APP_VERSION);
    localStorage.setItem('axon_update_applying', Date.now().toString());
  } catch(e) {}
  // 1. Si hay un SW esperando, activarlo.
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage('SKIP_WAITING');
  }
  // 2. Borrar todos los caches del SW para forzar descarga fresh.
  if ('caches' in window) {
    caches.keys().then(names => names.forEach(n => caches.delete(n))).catch(()=>{});
  }
  // 3. Recargar sin caché después de un delay para dar tiempo al SW + cache cleanup.
  setTimeout(() => {
    window.location.href = window.location.pathname + '?v=' + (_lastRemoteVersion || APP_VERSION) + (window.location.hash || '');
  }, 800);
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

// ════════════════════════════════════════
//  SUPABASE REST DATA LAYER
// ════════════════════════════════════════
// v65: el objeto `db` (mock vacío de la era Firebase) se ha eliminado junto con
// las últimas llamadas que lo usaban. Sus métodos eran no-ops silenciosos: .on()
// jamás invocaba el callback, .once() resolvía siempre con val()===null y
// .transaction() con committed:false. No era solo código inerte: hacía que el
// código de alrededor pareciera funcionar y mintiera sobre lo que hacía.
// Todo va por Supabase REST: escrituras → _enqueueSB → _supabaseOpFor; lecturas
// → _doRestPoll() cada 5 s. Si algún día hace falta escuchar cambios en tiempo
// real, se usa Supabase Realtime — no se resucita este mock.

const SUPABASE_URL  = 'https://gdzsqwyedzrfituewdtt.supabase.co';
const SUPABASE_KEY  = 'sb_publishable_Ftyw83d2WPU7TtC7JacCRw_uQuqFXdW';
const _SB_REST      = SUPABASE_URL + '/rest/v1';
const _SB_AUTH_HDRS = {
  'apikey':       SUPABASE_KEY,
  'Authorization': 'Bearer ' + SUPABASE_KEY,
  'Content-Type':  'application/json',
  'Prefer':        'resolution=merge-duplicates',
};
let _syncCount = 0;
const isSyncingFromSupabase = () => _syncCount > 0;
// 'vales_borrados' lo bajan TODOS, admin y gestores: al gestor también le
// borran vales desde el panel del admin, y sin la lápida se le quedarían de
// fantasmas en la pantalla hasta el siguiente barrido completo.
const _SB_SINGLETON_ROWS = ['config', 'notifs', 'estafa', 'ranking_summary', 'reservas', 'tasa', 'vales_borrados'];
// v114: documentos que SOLO se baja el teléfono del admin. Los costos de compra
// no tienen por qué acabar guardados en el teléfono de un gestor.
const _SB_SINGLETON_ADMIN = ['costos', 'duenos'];

async function _sbRestGetCollection(collName) {
  const url = `${_SB_REST}/${encodeURIComponent(collName)}?select=data&order=id.asc`;
  const res = await fetch(url, { headers: _SB_AUTH_HDRS });
  if (!res.ok) { if (res.status === 404) return []; throw new Error(`Supabase GET ${collName} ${res.status}`); }
  const rows = await res.json();
  return (rows || []).map(r => r.data).filter(x => x != null);
}

// ── v103: preguntar antes de bajar, en vez de bajar para preguntar ─────────
// El 17/08/2026 el plan gratuito de Supabase (5 GB de salida al mes) se agotó
// a la mitad del ciclo. La causa: _sbRestGetCollection('vales') se llamaba
// cada 5 SEGUNDOS desde cualquier teléfono sin gestor activo (el admin,
// básicamente) — la tabla vales ENTERA, se hubiera movido algo o no. Con la
// pantalla del admin abierta una jornada de 10 horas eso son 7.200 descargas
// completas al día de un solo teléfono.
//
// Cada tabla ya lleva un `updated_at` que un trigger de Postgres actualiza
// solo (ver supabase_schema.sql): ningún camino de escritura —upsert, RPC,
// borrado— puede dejarlo desactualizado, así que sirve para preguntar "¿hay
// ALGO más nuevo que la última vez?" con una consulta de un puñado de bytes
// en vez de la tabla entera. Si la respuesta es no, no hay nada que fusionar
// y se sale sin gastar el ancho de banda.
//
// Lo único que este truco NO puede ver es un BORRADO: la fila desaparece, no
// queda un updated_at más reciente que avise de ello. Por eso quien lo usa
// (_doRestPoll) igual fuerza una bajada real de vez en cuando pase lo que
// pase — la red de seguridad que limita cuánto puede tardar un borrado en
// notarse, sin volver a la descarga constante de antes.
async function _sbRestHayCambios(collName, desdeISO) {
  if (!desdeISO) return true; // sin referencia previa: no se puede saber → se baja todo
  const url = `${_SB_REST}/${encodeURIComponent(collName)}?select=id&updated_at=gt.${encodeURIComponent(desdeISO)}&limit=1`;
  try {
    const res = await fetch(url, { headers: _SB_AUTH_HDRS });
    if (!res.ok) return true; // ante la duda, se baja todo — nunca debe quedarse corto
    const rows = await res.json().catch(() => null);
    return !Array.isArray(rows) || rows.length > 0;
  } catch (e) { return true; }
}
// ── v119: contar filas sin traérselas ──────────────────────────────────────
// El barrido de seguridad existe solo para enterarse de los BORRADOS, y para
// eso no hace falta la tabla: basta con cuántas filas hay. Con
// `Prefer: count=exact` y `limit=0`, PostgREST no devuelve ni una fila — el
// número viene en la cabecera Content-Range ("0-0/1234"). Son unos cientos de
// bytes en vez de megas, y —esto es lo importante— cuesta lo mismo con 200
// vales que con 20.000: el gasto deja de crecer con el negocio.
// Devuelve null si no se puede saber; quien llama entonces baja la tabla, que
// es el comportamiento seguro de siempre.
async function _sbRestContarFilas(collName, filtroExtra) {
  const base = `${_SB_REST}/${encodeURIComponent(collName)}?select=id`
             + (filtroExtra ? '&' + filtroExtra : '');
  try {
    // 1) Por la cabecera: no baja ni una fila, son unos cientos de bytes.
    const res = await fetch(base + '&limit=0', { headers: { ..._SB_AUTH_HDRS, 'Prefer': 'count=exact' } });
    if (!res.ok) return null;
    const rango = res.headers.get('content-range') || '';   // "0-0/1234" o "*/1234"
    const n = parseInt(String(rango).split('/')[1], 10);
    if (!isNaN(n)) return n;
    // 2) Si no se puede leer la cabecera, se cuentan los ids a mano.
    //    Content-Range NO es de las que el navegador deja leer por defecto: hace
    //    falta que el servidor la exponga (Access-Control-Expose-Headers). Si no
    //    lo hace, aquí llegaba null SIEMPRE y el atajo no ahorraba nada —sin dar
    //    la cara, porque null significa "ante la duda, baja la tabla". Pedir los
    //    ids pesa más que la cabecera (unos 20 bytes por vale) pero sigue siendo
    //    una fracción de la tabla entera, y no depende de cómo esté configurado
    //    el servidor.
    const res2 = await fetch(base, { headers: _SB_AUTH_HDRS });
    if (!res2.ok) return null;
    const filas = await res2.json().catch(() => null);
    return Array.isArray(filas) ? filas.length : null;
  } catch (e) { return null; }
}

// Como _sbRestGetCollection, pero además devuelve el updated_at más reciente
// visto — DEL SERVIDOR, no del reloj del teléfono (que puede estar mal puesto
// y hacer que _sbRestHayCambios descarte un cambio real o repita trabajo de
// más). Ese valor es lo que se usa como referencia la próxima vez.
async function _sbRestGetCollectionYTs(collName) {
  const url = `${_SB_REST}/${encodeURIComponent(collName)}?select=data,updated_at&order=id.asc`;
  const res = await fetch(url, { headers: _SB_AUTH_HDRS });
  if (!res.ok) { if (res.status === 404) return { items: [], maxTs: null, filas: 0 }; throw new Error(`Supabase GET ${collName} ${res.status}`); }
  const rows = await res.json();
  const items = []; let maxTs = null;
  (rows || []).forEach(r => {
    if (r && r.data != null) items.push(r.data);
    if (r && r.updated_at && (!maxTs || r.updated_at > maxTs)) maxTs = r.updated_at;
  });
  // v119: `filas` es cuántas trajo el servidor, que NO tiene por qué ser
  // items.length —una fila con data nula no entra en items— y es contra ese
  // número contra el que compara el conteo barato del barrido. Usar
  // items.length haría que no cuadraran nunca y el atajo no serviría de nada.
  return { items, maxTs, filas: (rows || []).length };
}
// ── v112: bajar SOLO las filas que cambiaron ────────────────────────────────
// Hasta ahora la pregunta barata (_sbRestHayCambios) evitaba bajar la tabla
// cuando NO había novedades. Pero en cuanto había una sola —y una venta cambia
// el stock de un producto, y cualquier toque a un vale cambia ese vale— se
// bajaba la tabla ENTERA. Medido el 21/08:
//
//   una venta cambia 1 producto →   1.9 KB de datos nuevos, se bajaban 139 KB
//   un vale cambia 1 vale       →   1.5 KB de datos nuevos, se bajaban 149 KB
//
// El mismo `updated_at` que sirve para preguntar sirve para pedir solo lo
// nuevo. Lo que esto NO puede ver sigue siendo un BORRADO —la fila desaparece
// sin dejar un updated_at más reciente—, así que la bajada completa se mantiene
// como red de seguridad cada tanto. La diferencia es que ahora esa bajada
// completa es la excepción y no la regla.
async function _sbRestGetCollectionDesde(collName, desdeISO) {
  const url = `${_SB_REST}/${encodeURIComponent(collName)}?select=data,updated_at`
            + `&updated_at=gt.${encodeURIComponent(desdeISO)}&order=id.asc`;
  const res = await fetch(url, { headers: _SB_AUTH_HDRS });
  if (!res.ok) { if (res.status === 404) return { items: [], maxTs: null }; throw new Error(`Supabase GET ${collName} parcial ${res.status}`); }
  const rows = await res.json();
  const items = []; let maxTs = null;
  (rows || []).forEach(r => {
    if (r && r.data != null) items.push(r.data);
    if (r && r.updated_at && (!maxTs || r.updated_at > maxTs)) maxTs = r.updated_at;
  });
  return { items, maxTs };
}

// Mete las filas nuevas encima de las que ya había, emparejando por id. Las que
// no vinieron se quedan como estaban — que es justo lo que significa "no ha
// cambiado". Ojo: esto NO sirve para detectar borrados, y por eso existe la
// bajada completa periódica.
function _fusionarPorId(viejas, nuevas) {
  const mapa = new Map();
  (viejas || []).forEach(x => { if (x && x.id != null) mapa.set(String(x.id), x); });
  (nuevas || []).forEach(x => { if (x && x.id != null) mapa.set(String(x.id), x); });
  return Array.from(mapa.values());
}

// Estado del truco de arriba, por colección. _ultimaTsVisto guarda la
// referencia para la pregunta barata; _ultimoFetchReal, cuándo fue la última
// vez que de verdad se bajó algo (para la red de seguridad de los borrados).
let _ultimaTsVisto = {};
let _ultimoFetchReal = {};
// vales: red de seguridad corta (30 s) — un vale es dinero, que un borrado
// tarde medio minuto en notarse no lo nota nadie. lento: los cuatro nodos que
// ya iban cada 5 min; 20 min de red de seguridad es de sobra para un catálogo.
// Cada cuánto se baja la tabla ENTERA aunque no haga falta. Su única razón de
// existir es notar los BORRADOS, que el filtro por updated_at no puede ver.
// v112: los vales estaban en 30 s. Con la tabla en 149 KB, eso era una bajada
// completa cada medio minuto — el teléfono del admin abierto 10 h se comía
// ~180 MB al día solo en eso, y ahí se fue buena parte de los 5 GB del plan.
// Desde que la sincronización es incremental, esta bajada ya no es la que trae
// los cambios (esos llegan al instante y pesan 1,5 KB): es solo el barrido que
// detecta lo que se borró desde otro teléfono. Cinco minutos de retraso en ver
// un vale borrado es perfectamente asumible; 180 MB al día no lo era.
// v119: y volvió a pasar, por la misma razón de fondo. Estos minutos se
// eligieron cuando la tabla pesaba 149 KB; ahora la base va por 28 MB y una
// bajada completa cuesta un orden de magnitud más. Con el barrido cada 5 min,
// el teléfono del admin abierto una jornada se comía otra vez varios cientos de
// MB al día, y la cuenta llegó a 6,74 GB de los 5 GB del plan.
//
// El número correcto no es fijo: es "cada cuánto puedo permitirme bajar la
// tabla entera", y eso encoge según crece la tabla. A 30 min son 48 barridos
// al día en vez de 288 — seis veces menos — y lo único que se paga es que un
// vale borrado desde otro teléfono tarde hasta media hora en desaparecer de
// este. Los cambios normales (crear, confirmar, cobrar) NO pasan por aquí:
// llegan por la vía incremental en segundos y pesan ~1,5 KB.
//
// Si la base sigue creciendo y el egress vuelve a apretar, lo que toca ya no es
// subir más este número, sino dejar de barrer con la tabla entera: pedir solo
// `?select=id` (unos KB) y comparar ids para deducir los borrados. No se hizo
// aquí porque la tabla `vales` mezcla dos formatos —fila por vale (nueva) y
// fila por gestor con varios vales dentro (vieja)— y un barrido por ids se
// tragaría los de formato viejo dándolos por borrados.
const _GATE_SEGURIDAD_MS = { vales: 30 * 60000, lento: 60 * 60000, meta: 20 * 60000 };
// v119: cuántas FILAS tenía el servidor la última vez que se bajó la tabla
// entera. Es la referencia del atajo barato del barrido (ver
// _sbRestContarFilas): si el conteo de ahora coincide, no se ha borrado nada.
// null = todavía no consta, y entonces se barre como siempre.
const _filasVistas = { vales: null };
// Cuándo se bajó la tabla ENTERA por última vez. Tiene que ser un reloj aparte
// de _ultimoFetchReal: ese lo renueva también el conteo barato —para eso está,
// para aplazar el barrido— y si el gate de fondo mirara ahí, cada conteo le
// daría cuerda y las horas no se cumplirían nunca. El barrido de fondo dejaría
// de existir sin que se notara.
const _ultimaBajadaCompleta = { vales: 0 };
// El barrido de verdad, el que sí se baja la tabla. Aunque el conteo diga
// "nada nuevo" una y otra vez, cada tantas horas se baja igual: el conteo no
// ve un vale borrado de DENTRO de una fila del formato viejo (una fila por
// gestor con varios vales dentro), y ese caso solo lo corrige la foto completa.
// v119b: con las lápidas (ver _apuntarValeBorrado) los borrados ya llegan
// avisados y por su id, incluidos los del formato viejo —que también pasan por
// _sbRestDeleteVale—, así que este barrido deja de ser la forma de enterarse y
// pasa a ser solo una red por si una lápida no llegó a escribirse. Una vez al
// día basta: una sola bajada completa, y el resto del tiempo 200 bytes.
const _GATE_ABSOLUTO_MS = { vales: 24 * 60 * 60000 };
// ── v66: descarga SOLO los vales de un gestor ───────────────────────────────
// Antes, cada dispositivo de gestor se bajaba la tabla `vales` COMPLETA cada 5 s
// —los vales de todos los demás incluidos— y luego descartaba en el navegador lo
// que no era suyo. Con eso se fueron los 5 GB de tráfico del plan gratuito.
// Se piden dos cosas, porque en la tabla conviven dos formatos (ver
// _flattenValesFromSB):
//   · formato NEW: una fila por vale, con gestorId dentro del JSON `data`.
//   · formato OLD: una fila por gestor, con id = gestorId y todos sus vales dentro.
// Si algo falla —filtro no soportado, error de red— se devuelve null y quien
// llama se baja la tabla entera como hasta ahora. Ahorrar tráfico nunca debe
// costar que un gestor deje de ver sus vales.
// ── v114: el freno de v103/v112, que se quedó a medias ─────────────────────
// v103 preguntaba antes de bajar y v112 bajaba solo las filas cambiadas… pero
// las dos cosas viven en la rama del ADMIN. El gestor entra por aquí, y aquí no
// había ni freno ni bajada parcial: sus vales se descargaban ENTEROS cada 5
// segundos, hubiera cambiado algo o no. Medido: el gestor con más trabajo son
// 46 KB por pasada, o sea 32 MB por hora de un solo teléfono.
//
// Estas dos funciones son las mismas preguntas que ya se le hacen a la tabla
// entera, pero acotadas a un gestor.
async function _sbRestHayCambiosDeGestor(gestorId, desdeISO) {
  const gid = Number(gestorId);
  if (!gid || isNaN(gid) || !desdeISO) return true;
  const url = `${_SB_REST}/vales?select=id&data->>gestorId=eq.${encodeURIComponent(String(gid))}`
            + `&updated_at=gt.${encodeURIComponent(desdeISO)}&limit=1`;
  try {
    const res = await fetch(url, { headers: _SB_AUTH_HDRS });
    if (!res.ok) return true;
    const rows = await res.json().catch(() => null);
    return !Array.isArray(rows) || rows.length > 0;
  } catch (e) { return true; }
}
// Solo las filas del gestor que cambiaron. Devuelve null si falla, para que el
// que llama se caiga a la descarga completa de siempre.
async function _sbRestGetValesDeGestorDesde(gestorId, desdeISO) {
  const gid = Number(gestorId);
  if (!gid || isNaN(gid) || !desdeISO) return null;
  const url = `${_SB_REST}/vales?select=data,updated_at&data->>gestorId=eq.${encodeURIComponent(String(gid))}`
            + `&updated_at=gt.${encodeURIComponent(desdeISO)}`;
  try {
    const res = await fetch(url, { headers: _SB_AUTH_HDRS });
    if (!res.ok) return null;
    const filas = (await res.json()) || [];
    let maxTs = null;
    filas.forEach(r => { if (r.updated_at && (!maxTs || r.updated_at > maxTs)) maxTs = r.updated_at; });
    return { items: filas.map(r => r.data).filter(x => x != null), maxTs };
  } catch (e) { return null; }
}
// La descarga completa de los vales de un gestor. Sigue haciendo falta: es la
// que arranca el teléfono y la que cada tanto pilla los borrados, que una
// bajada parcial no puede ver.
async function _sbRestGetValesDeGestor(gestorId) {
  const gid = Number(gestorId);
  if (!gid || isNaN(gid)) return null;
  try {
    const urlNew = `${_SB_REST}/vales?select=data,updated_at&data->>gestorId=eq.${encodeURIComponent(String(gid))}`;
    const urlOld = `${_SB_REST}/vales?select=data,updated_at&id=eq.${encodeURIComponent(String(gid))}`;
    const [rNew, rOld] = await Promise.all([
      fetch(urlNew, { headers: _SB_AUTH_HDRS }),
      fetch(urlOld, { headers: _SB_AUTH_HDRS }),
    ]);
    if (!rNew.ok && rNew.status !== 404) throw new Error(`GET vales(gestor) ${rNew.status}`);
    if (!rOld.ok && rOld.status !== 404) throw new Error(`GET vales(old) ${rOld.status}`);
    const filas = [];
    if (rNew.ok) filas.push(...((await rNew.json()) || []));
    if (rOld.ok) filas.push(...((await rOld.json()) || []));
    let maxTs = null;
    filas.forEach(r => { if (r.updated_at && (!maxTs || r.updated_at > maxTs)) maxTs = r.updated_at; });
    return { items: filas.map(r => r.data).filter(x => x != null), maxTs };
  } catch(e) {
    console.warn('[rest-poll] no se pudo filtrar por gestor, se descargará todo:', e && e.message);
    return null;
  }
}
async function _sbRestGetMeta(name) {
  const url = `${_SB_REST}/meta?select=data&name=eq.${encodeURIComponent(name)}`;
  const res = await fetch(url, { headers: _SB_AUTH_HDRS });
  if (!res.ok) { if (res.status === 404) return null; throw new Error(`Supabase GET meta/${name} ${res.status}`); }
  const rows = await res.json();
  if (!rows || rows.length === 0) return null;
  return rows[0].data;
}
// ── v114: el mismo freno de v103, pero para los documentos de `meta` ────────
// v103 le puso freno a las TABLAS y se dejó fuera los documentos sueltos. El
// peor con diferencia es `notifs`: va en cada pasada del bucle —cada 5 s, en
// TODOS los teléfonos, admin y gestores— y se baja entero, haya avisos nuevos
// o no. Medido contra la base de datos de verdad: 11.551 bytes cada vez. Eso
// es 8 MB por hora y por teléfono; solo el del admin, con la app abierta una
// jornada, son 2,4 GB al mes de los 5 que da el plan.
//
// La pregunta equivalente pesa 2 bytes.
async function _sbRestMetaHayCambios(name, desdeISO) {
  if (!desdeISO) return true;   // sin referencia previa: se baja, como siempre
  const url = `${_SB_REST}/meta?select=name&name=eq.${encodeURIComponent(name)}&updated_at=gt.${encodeURIComponent(desdeISO)}&limit=1`;
  try {
    const res = await fetch(url, { headers: _SB_AUTH_HDRS });
    if (!res.ok) return true;   // ante la duda se baja: nunca debe quedarse corto
    const rows = await res.json().catch(() => null);
    return !Array.isArray(rows) || rows.length > 0;
  } catch (e) { return true; }
}
// Como _sbRestGetMeta pero trae también el updated_at, que es la referencia con
// la que se hará la pregunta la próxima vez. Se usa la hora del SERVIDOR, no la
// del teléfono: un reloj mal puesto descartaría cambios reales.
async function _sbRestGetMetaYTs(name) {
  const url = `${_SB_REST}/meta?select=data,updated_at&name=eq.${encodeURIComponent(name)}`;
  const res = await fetch(url, { headers: _SB_AUTH_HDRS });
  if (!res.ok) { if (res.status === 404) return { data: null, ts: null }; throw new Error(`Supabase GET meta/${name} ${res.status}`); }
  const rows = await res.json();
  if (!rows || rows.length === 0) return { data: null, ts: null };
  return { data: rows[0].data, ts: rows[0].updated_at || null };
}
async function _sbRestUpsert(collName, id, value) {
  const url = `${_SB_REST}/${encodeURIComponent(collName)}`;
  const body = JSON.stringify([{ id: id, data: value }]);
  const res = await fetch(url, { method: 'POST', headers: { ..._SB_AUTH_HDRS, 'Prefer': 'resolution=merge-duplicates,return=representation' }, body });
  if (!res.ok) { const t = await res.text(); throw new Error(`Supabase UPSERT ${collName}/${id} ${res.status}: ${t.slice(0,150)}`); }
}
async function _sbRestUpsertBatch(collName, items) {
  if (!items || items.length === 0) return [];
  const savedIds = [];
  const CHUNK = 500;
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    const url = `${_SB_REST}/${encodeURIComponent(collName)}`;
    const body = JSON.stringify(chunk.map(it => ({ id: it.id, data: it.value })));
    const res = await fetch(url, { method: 'POST', headers: { ..._SB_AUTH_HDRS, 'Prefer': 'resolution=merge-duplicates,return=representation' }, body });
    if (!res.ok) { const t = await res.text(); throw new Error(`Supabase UPSERT batch ${collName} ${res.status}: ${t.slice(0,150)}`); }
    const rows = await res.json().catch(() => []);
    if (Array.isArray(rows)) rows.forEach(r => { if (r && r.id != null) savedIds.push(Number(r.id)); });
  }
  return savedIds;
}
async function _sbRestDelete(collName, id) {
  const url = `${_SB_REST}/${encodeURIComponent(collName)}?id=eq.${encodeURIComponent(id)}`;
  const res = await fetch(url, { method: 'DELETE', headers: _SB_AUTH_HDRS });
  if (!res.ok && res.status !== 404) throw new Error(`Supabase DELETE ${collName}/${id} ${res.status}`);
}

// ════════════════════════════════════════
//  v54: RPC upsert_vale_from_gestor
// ════════════════════════════════════════
//  PROBLEMA: Cuando el gestor hace saveVales(), el UPSERT a Supabase
//  REEMPLAZA toda la columna `data` JSONB. Esto borraba los campos que
//  el admin había puesto (status='confirmed', confirmedTs, etc.).
//  El "fix v53" trataba de incluirlos desde la caché local del gestor,
//  pero esa caché está stale → el gestor escribía status='pending' sobre
//  el status='confirmed' del admin.
//
//  SOLUCIÓN: RPC server-side que hace JSONB merge preservando campos
//  administrativos. El gestor manda SOLO sus campos; el RPC hace:
//    merged = existing_data || p_data, pero force-preserva campos del admin
//  desde existing_data.
//
//  Requiere migración SQL (migration_v54.sql). Si la función no existe
//  (404), hacemos fallback al comportamiento viejo (v53 slim).
let _sbGestorRpcAvailable = null; // null=unknown, true=disponible, false=no disponible

async function _detectGestorRpc() {
  if (_sbGestorRpcAvailable !== null) return _sbGestorRpcAvailable;
  try {
    // Probe con p_id=0 (no existe) → debe responder 200/204 si la función existe
    const res = await fetch(`${_SB_REST}/rpc/upsert_vale_from_gestor`, {
      method: 'POST',
      headers: _SB_AUTH_HDRS,
      body: JSON.stringify({ p_id: 0, p_data: {} })
    });
    _sbGestorRpcAvailable = (res.status !== 404);
    console.log(`[sb] upsert_vale_from_gestor RPC: ${_sbGestorRpcAvailable ? 'disponible' : 'NO disponible (fallback a v53 slim)'}`);
  } catch (e) {
    _sbGestorRpcAvailable = false;
    console.warn('[sb] Error detectando RPC upsert_vale_from_gestor:', e.message);
  }
  return _sbGestorRpcAvailable;
}

// ════════════════════════════════════════
//  v96: RPC aplicar_delta_stock
// ════════════════════════════════════════
//  Desde v95 cada venta sube solo el producto tocado, así que un teléfono con la
//  copia vieja ya no puede reponer el catálogo entero. Pero lo que sube sigue
//  siendo un número ABSOLUTO, y eso deja un hueco más pequeño y más tonto:
//
//    El teléfono A lee stock=10, vende 2 y escribe 8.
//    El teléfono B, que también leyó 10, vende 1 y escribe 9.
//
//  Salieron 3 unidades y en la nube quedan 9. No hace falta una caché de ayer:
//  basta con que los dos hayan mirado en los últimos 5 minutos.
//
//  Con el RPC el teléfono deja de decir "queda en 8" y dice "quita 2". El orden
//  de llegada da igual y no hay foto vieja de por medio. Requiere ejecutar
//  migration_v96_stock.sql; si no está, se hace leer-restar-escribir contra
//  Supabase, que tiene una ventana mínima pero sigue partiendo del dato bueno.
let _sbStockRpcAvailable = null; // null=sin saber, true=disponible, false=no

async function _detectStockRpc() {
  if (_sbStockRpcAvailable !== null) return _sbStockRpcAvailable;
  try {
    // Sonda con delta 0 sobre un id que no existe: si la función está, responde
    // 200 con -1 (producto no encontrado); si no está, 404. En ningún caso toca
    // un dato real.
    const res = await fetch(`${_SB_REST}/rpc/aplicar_delta_stock`, {
      method: 'POST', headers: _SB_AUTH_HDRS,
      body: JSON.stringify({ p_id: 0, p_delta: 0 })
    });
    _sbStockRpcAvailable = (res.status !== 404);
    console.log(`[sb] aplicar_delta_stock RPC: ${_sbStockRpcAvailable ? 'disponible' : 'NO disponible (leer-restar-escribir)'}`);
  } catch (e) {
    _sbStockRpcAvailable = false;
    console.warn('[sb] Error detectando RPC aplicar_delta_stock:', e.message);
  }
  return _sbStockRpcAvailable;
}

// Aplica el stock que devuelve el servidor sobre la copia local, sin encolar
// nada: es un dato que BAJA, no un cambio nuestro. Si no coincide con lo que
// teníamos, manda el servidor — ahí está la venta del otro teléfono.
function _asentarStockServidor(id, stockServidor) {
  if (stockServidor == null || stockServidor < 0) return;
  const lista = getProductos();
  const i = lista.findIndex(p => p && p.id === id);
  if (i === -1) return;
  const local = parseInt(lista[i].stock || 0, 10);
  if (local === stockServidor) return;
  console.log(`[sb] stock de ${id}: local ${local} → servidor ${stockServidor}`);
  lista[i] = { ...lista[i], stock: stockServidor };
  _safeSetLS('axon_productos', JSON.stringify(lista));
  _productosCache = lista; _productosDirty = false; _productosMap = null;
  if (typeof renderProductGrid === 'function') { try { renderProductGrid(); } catch(e) {} }
}

// mapa: {idProducto: {d: delta, op: identificador}}. El delta negativo descuenta.
// El identificador se genera UNA vez al encolar y viaja con la cola cuando se
// guarda en el teléfono, así que un reintento manda el mismo y el servidor sabe
// que ya lo aplicó. Sin eso, una conexión que se corta después de escribir pero
// antes de confirmar descontaría la venta dos veces.
async function _sbRestAplicarDeltas(mapa) {
  const entradas = Object.entries(mapa || {})
    .map(([id, v]) => [Number(id), (v && typeof v === 'object') ? v : { d: v, op: null }])
    .filter(([, v]) => Number(v.d));
  if (!entradas.length) return;
  const disponible = await _detectStockRpc();
  for (const [id, { d, op }] of entradas) {
    if (disponible) {
      const res = await fetch(`${_SB_REST}/rpc/aplicar_delta_stock`, {
        method: 'POST', headers: _SB_AUTH_HDRS,
        body: JSON.stringify({ p_id: id, p_delta: Number(d), p_op: op || null })
      });
      if (res.status === 404) {
        _sbStockRpcAvailable = false;           // la migración se revirtió
        await _deltaStockPorLectura(id, Number(d));
        continue;
      }
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`RPC aplicar_delta_stock(${id}) ${res.status}: ${t.slice(0,150)}`);
      }
      const nuevo = await res.json().catch(() => null);
      _asentarStockServidor(id, typeof nuevo === 'number' ? nuevo : null);
    } else {
      await _deltaStockPorLectura(id, Number(d));
    }
  }
}

// Guarda en el teléfono y manda la INTENCIÓN ("quita 2"), no el resultado.
// deltas: {idProducto: unidades} — negativo descuenta.
function guardarProductosPorDelta(lista, deltas) {
  if (Array.isArray(lista)) lista.forEach(_normalizeProducto);
  _safeSetLS('axon_productos', JSON.stringify(lista));
  _productosCache = lista; _productosDirty = false; _productosMap = null;
  if (!isSyncingFromSupabase()) {
    const carga = {};
    let hay = false;
    Object.entries(deltas || {}).forEach(([id, d]) => {
      if (!Number(d)) return;
      hay = true;
      carga[String(id)] = {
        d: Number(d),
        // Identificador de la orden: producto + instante + azar. Se genera aquí
        // y se persiste con la cola, así el reintento reutiliza el mismo.
        op: `${id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      };
    });
    if (hay) _enqueueSB('productos', carga, 'delta');
  }
  triggerAutoPublishCatalog();
}

// Sin la función SQL: se lee la fila, se aplica el delta sobre lo que hay en la
// nube (no sobre la pantalla) y se escribe. Queda una rendija entre leer y
// escribir, pero es de milisegundos en vez de los 5 minutos de la caché.
async function _deltaStockPorLectura(id, delta) {
  const url = `${_SB_REST}/productos?select=data&id=eq.${encodeURIComponent(String(id))}`;
  const res = await fetch(url, { headers: _SB_AUTH_HDRS });
  if (!res.ok) throw new Error(`GET productos/${id} ${res.status}`);
  const filas = await res.json().catch(() => []);
  if (!filas || !filas.length) return;            // ya no está: nada que restar
  const data = filas[0].data || {};
  const nuevo = Math.max(0, (parseInt(data.stock || 0, 10) || 0) + delta);
  const patch = await fetch(`${_SB_REST}/productos?id=eq.${encodeURIComponent(String(id))}`, {
    method: 'PATCH', headers: { ..._SB_AUTH_HDRS, 'Prefer': 'return=minimal' },
    body: JSON.stringify({ data: { ...data, stock: nuevo } })
  });
  if (!patch.ok) throw new Error(`PATCH productos/${id} ${patch.status}`);
  _asentarStockServidor(id, nuevo);
}

// Llama al RPC upsert_vale_from_gestor para un vale individual.
// items: [{id, value}, ...]  — value es el slim del vale (sin campos del admin)
async function _sbRestUpsertValeFromGestorBatch(items) {
  if (!items || items.length === 0) return;
  // El RPC procesa un vale por llamada. Hacemos las llamadas en paralelo
  // (con un límite de concurrencia para no saturar conexiones lentas).
  const CONCURRENCY = 4;
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const chunk = items.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(async it => {
      const res = await fetch(`${_SB_REST}/rpc/upsert_vale_from_gestor`, {
        method: 'POST',
        headers: _SB_AUTH_HDRS,
        body: JSON.stringify({ p_id: Number(it.id), p_data: it.value })
      });
      if (!res.ok && res.status !== 404) {
        const t = await res.text().catch(() => '');
        throw new Error(`RPC upsert_vale_from_gestor(${it.id}) ${res.status}: ${t.slice(0,150)}`);
      }
      if (res.status === 404) {
        // La función desapareció (¿migración reversada?) → marcar como no disponible
        _sbGestorRpcAvailable = false;
        throw new Error('RPC upsert_vale_from_gestor desapareció (404)');
      }
    }));
  }
}

// ── v54: Fallback puro-JS (sin SQL) — read-merge-write ──
// Si el RPC NO está disponible, hacemos un GET del vale actual desde Supabase,
// mergeamos los campos del gestor por encima, y luego hacemos el UPSERT normal.
// Esto preserva los campos del admin (status, confirmedTs, etc.) con sus valores
// FRESH de Supabase, evitando el bug de v53 donde escribíamos valores stale.
//
// Tiene una pequeña race window (entre el GET y el POST), pero es mucho mejor
// que el comportamiento v53 que SIEMPRE pisaba los cambios del admin.
async function _sbRestUpsertValeFromGestorFallbackBatch(items) {
  if (!items || items.length === 0) return;
  // 1) GET de los vales actuales desde Supabase (un solo request batch)
  const ids = items.map(it => it.id);
  const getUrl = `${_SB_REST}/vales?select=id,data&id=in.(${ids.map(x => encodeURIComponent(String(x))).join(',')})`;
  const getRes = await fetch(getUrl, { headers: _SB_AUTH_HDRS });
  if (!getRes.ok && getRes.status !== 404) {
    const t = await getRes.text().catch(() => '');
    throw new Error(`Fallback GET vales ${getRes.status}: ${t.slice(0,150)}`);
  }
  const existingRows = (getRes.status === 404) ? [] : await getRes.json().catch(() => []);
  const existingMap = new Map();
  for (const r of existingRows) {
    if (r && r.id != null) existingMap.set(String(r.id), r.data || {});
  }
  // 2) Merge: existing + gestor slim (gestor wins para sus campos)
  const mergedItems = items.map(it => {
    const existing = existingMap.get(String(it.id)) || {};
    const merged = { ...existing, ...it.value };
    return { id: it.id, value: merged };
  });
  // 3) UPSERT normal con los valores mergeados
  return _sbRestUpsertBatch('vales', mergedItems);
}
async function _sbRestDeleteBatch(collName, ids) {
  if (!ids || ids.length === 0) return;
  const CHUNK = 500;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const url = `${_SB_REST}/${encodeURIComponent(collName)}?id=in.(${chunk.map(x => encodeURIComponent(String(x))).join(',')})`;
    const res = await fetch(url, { method: 'DELETE', headers: { ..._SB_AUTH_HDRS, 'Prefer': 'return=minimal' } });
    if (!res.ok && res.status !== 404) throw new Error(`Supabase DELETE batch ${collName} ${res.status}`);
  }
}
async function _sbRestMetaUpsert(name, value) {
  const url = `${_SB_REST}/meta`;
  const body = JSON.stringify([{ name: name, data: value }]);
  const res = await fetch(url, { method: 'POST', headers: { ..._SB_AUTH_HDRS, 'Prefer': 'resolution=merge-duplicates,return=representation' }, body });
  if (!res.ok) { const t = await res.text(); throw new Error(`Supabase META UPSERT ${name} ${res.status}: ${t.slice(0,150)}`); }
}
// ── v99: escribir SOLO unas claves de un documento compartido ───────────────
// Los documentos como `config` viven enteros en una fila de `meta`, así que
// subirlo es reemplazarlo. Eso convertía cualquier retoque en un borrado: al
// crear un vale se manda {nextValeNum: N} —solo eso— y el documento pasaba a
// tener ESA única clave. Con ella se iban el margen de la tasa (+10), la tasa
// compartida y su fecha.
//
// Nadie lo relacionaba con "hice un vale": el gestor veía la tasa pelada y el
// admin, que acababa de escribir el margen, seguía viéndolo hasta la siguiente
// bajada. De ahí el "los gestores no ven el +10".
//
// Se lee lo que hay en el servidor, se le encajan las claves nuevas y se sube.
// Se parte del documento del SERVIDOR, no de la copia del teléfono: si se
// partiera de la copia local se estaría repitiendo el fallo que costó el
// inventario, esta vez con el config.
async function _sbRestMetaMerge(name, parcial) {
  if (!parcial || typeof parcial !== 'object' || Array.isArray(parcial)) {
    return _sbRestMetaUpsert(name, parcial);
  }
  let actual = {};
  try {
    const previo = await _sbRestGetMeta(name);
    if (previo && typeof previo === 'object' && !Array.isArray(previo)) actual = previo;
  } catch (e) {
    // Si no se puede leer, mejor no escribir: subir solo las claves nuevas
    // dejaría el documento pelado, que es justo lo que se está arreglando.
    throw new Error(`META MERGE ${name}: no se pudo leer lo anterior (${e.message})`);
  }
  return _sbRestMetaUpsert(name, { ...actual, ...parcial });
}
async function _sbRestMetaDelete(name) {
  const url = `${_SB_REST}/meta?name=eq.${encodeURIComponent(name)}`;
  const res = await fetch(url, { method: 'DELETE', headers: _SB_AUTH_HDRS });
  if (!res.ok && res.status !== 404) throw new Error(`Supabase META DELETE ${name} ${res.status}`);
}
// ── v34: Delete ALL rows from a collection ──
// Used for factory reset and bulk clear operations.
// v34 FIX: Supabase REST API REQUIRES a WHERE clause for DELETE.
// ANTES: DELETE /rest/v1/vales (sin WHERE) → 400 "DELETE requires a WHERE clause"
// AHORA: DELETE /rest/v1/vales?id=gt.0 (WHERE id > 0, matches all numeric PK rows)
// For non-numeric PKs, use id=not.is.null which also matches all rows.
async function _sbRestDeleteAll(collName) {
  // Try numeric PK first (works for our tables where id is bigint)
  let url = `${_SB_REST}/${encodeURIComponent(collName)}?id=gt.0`;
  let res = await fetch(url, { method: 'DELETE', headers: { ..._SB_AUTH_HDRS, 'Prefer': 'return=minimal' } });
  if (res.ok) {
    console.log(`[sbRestDeleteAll] ✓ Deleted all rows from ${collName} (id>0)`);
    return;
  }
  // Fallback: try id=not.is.null (for text PKs or other types)
  url = `${_SB_REST}/${encodeURIComponent(collName)}?id=not.is.null`;
  res = await fetch(url, { method: 'DELETE', headers: { ..._SB_AUTH_HDRS, 'Prefer': 'return=minimal' } });
  if (res.ok) {
    console.log(`[sbRestDeleteAll] ✓ Deleted all rows from ${collName} (id not null)`);
    return;
  }
  if (res.status === 404) return; // table empty or doesn't exist
  const errText = await res.text().catch(() => '');
  console.error(`[sbRestDeleteAll] ✗ Failed: ${res.status} ${errText}`);
  throw new Error(`Supabase DELETE ALL ${collName} ${res.status}: ${errText.slice(0,150)}`);
}
// ── v32: Track in-flight direct Supabase vale deletions ──
// When adminDeleteVale or cancelVale calls _sbRestDeleteVale directly,
// _doRestPoll needs to know so it doesn't overwrite localStorage with
// stale Supabase data (where the vale still exists because the delete
// hasn't completed yet).
const _valesDirectDeleting = new Set();

// ── v33: Delete a specific vale from Supabase, handling BOTH formats ──
// The vales table has mixed formats:
//   NEW format: row with id = valeId (one row per vale) → just delete that row
//   OLD format: row with id = gestorId, data = {valeId: {...}, ...} → remove the key from data
// We try NEW format first, then OLD format if needed.
// v33 FIX: No more silent returns — all failure paths now throw or log clearly.
// v33 FIX: Added verification step to confirm the delete actually worked.
// v33 FIX: Added retry logic for transient network errors.
// ── v119: dejar constancia de que un vale se borró ─────────────────────────
// Hasta ahora, para enterarse de un borrado hecho desde otro teléfono había
// que bajarse la tabla entera y ver cuál faltaba: preguntar por todos para
// encontrar a uno. Y como no hay forma de que una fila que ya no existe avise
// de nada, ese barrido tenía que repetirse para siempre.
//
// Lo que sí puede avisar es QUIEN BORRA, en el momento de borrar. Se apunta el
// id en un documento aparte —la "lápida"— y los demás teléfonos solo tienen
// que leer esa lista, que pesa unos bytes por borrado, y quitar exactamente
// esos. Se deja de preguntar por 20.000 vales para localizar uno.
//
// Se escribe con 'update' (merge en el servidor) a propósito: dos teléfonos
// borrando a la vez no se pisan las lápidas el uno al otro.
const _LAPIDAS_DIAS = 30;   // pasado ese tiempo ya no hay teléfono tan atrasado
function _apuntarValeBorrado(valeId) {
  if (valeId == null) return;
  try {
    const ahora = new Date();
    const doc = { [String(valeId)]: ahora.toISOString() };
    // Aprovechando el viaje, se tiran las lápidas viejas para que el documento
    // no crezca sin fin. Solo puede hacerlo quien ya tiene la lista delante.
    try {
      const previas = (typeof _lapidasCache === 'object' && _lapidasCache) ? _lapidasCache : null;
      if (previas) {
        const corte = ahora.getTime() - _LAPIDAS_DIAS * 86400000;
        Object.keys(previas).forEach(k => {
          const t = Date.parse(previas[k]);
          if (isFinite(t) && t < corte) doc[k] = null;   // null = quitar la clave
        });
      }
    } catch(e) {}
    setSB('vales_borrados', doc, 'update');
  } catch (e) { console.warn('[lapidas] no se pudo apuntar el borrado de', valeId, e && e.message); }
}
let _lapidasCache = null;

// La lápida se pone SOLO si el borrado salió bien, nunca antes de intentarlo.
// Al revés se abre un ida y vuelta sin fin: si el DELETE falla por red, el vale
// sigue en la nube pero los demás teléfonos ya lo han quitado por la lápida; el
// siguiente barrido se lo devuelve, la lápida vuelve a quitarlo, y así siempre.
// Si lo que falla es apuntar la lápida, el vale queda borrado y algún teléfono
// tarda en enterarse — eso lo arregla el barrido de fondo. Ese lado sí se puede
// asumir; el otro no se arregla solo.
async function _sbRestDeleteVale(valeId, gestorId, _retryCount) {
  const _r = await _sbRestDeleteValeCore(valeId, gestorId, _retryCount);
  _apuntarValeBorrado(valeId);
  return _r;
}
async function _sbRestDeleteValeCore(valeId, gestorId, _retryCount) {
  if (_retryCount === undefined) _retryCount = 0;
  console.log(`[sbRestDeleteVale] Deleting vale ${valeId} (gestorId=${gestorId}), attempt ${_retryCount + 1}`);
  // 1) Try NEW format: delete row where id = valeId
  const newUrl = `${_SB_REST}/vales?id=eq.${encodeURIComponent(String(valeId))}`;
  const r1 = await fetch(newUrl, { method: 'DELETE', headers: { ..._SB_AUTH_HDRS, 'Prefer': 'return=representation' } });
  if (r1.ok) {
    try {
      const deleted = await r1.json();
      if (Array.isArray(deleted) && deleted.length > 0) {
        console.log(`[sbRestDeleteVale] ✓ NEW format: deleted row id=${valeId}`);
        return; // Successfully deleted NEW-format row
      }
    } catch(e) {
      console.warn('[sbRestDeleteVale] NEW format: response parse error:', e);
    }
  } else {
    console.warn(`[sbRestDeleteVale] NEW format: DELETE returned ${r1.status}`);
  }
  // 2) OLD format: read the gestor row, remove the valeId key from data, upsert back
  if (!gestorId) {
    // v33: Try to find the vale by scanning ALL gestor rows if gestorId is missing
    console.warn(`[sbRestDeleteVale] No gestorId provided — scanning all rows for vale ${valeId}`);
    try {
      const allUrl = `${_SB_REST}/vales?select=id,data&order=id.asc`;
      const rAll = await fetch(allUrl, { headers: _SB_AUTH_HDRS });
      if (rAll.ok) {
        const allRows = await rAll.json();
        for (const row of (allRows || [])) {
          if (row.data && typeof row.data === 'object' && row.data[String(valeId)] !== undefined) {
            const foundGestorId = row.id;
            console.log(`[sbRestDeleteVale] Found vale ${valeId} in gestor row ${foundGestorId}`);
            // Recurse with the found gestorId
            return _sbRestDeleteValeCore(valeId, foundGestorId, _retryCount);
          }
        }
      }
    } catch(e) {
      console.warn('[sbRestDeleteVale] Scan-all error:', e);
    }
    const errMsg = `Cannot delete vale ${valeId}: no gestorId and vale not found in any row`;
    console.error(`[sbRestDeleteVale] ✗ ${errMsg}`);
    throw new Error(errMsg);
  }
  const getUrl = `${_SB_REST}/vales?select=id,data&id=eq.${encodeURIComponent(String(gestorId))}`;
  const r2 = await fetch(getUrl, { headers: _SB_AUTH_HDRS });
  if (!r2.ok) {
    const errMsg = `OLD format: GET gestor row failed (${r2.status}) for gestorId=${gestorId}`;
    console.error(`[sbRestDeleteVale] ✗ ${errMsg}`);
    throw new Error(errMsg);
  }
  try {
    const rows = await r2.json();
    if (!rows || rows.length === 0) {
      // v33: The gestor row doesn't exist — vale may have already been deleted
      console.log(`[sbRestDeleteVale] Gestor row ${gestorId} not found — vale already deleted`);
      return; // Not an error — the vale is gone
    }
    const row = rows[0];
    const data = row.data;
    const vKey = String(valeId);
    if (!data || typeof data !== 'object' || data[vKey] === undefined) {
      // v33: Vale key not found in the gestor row — might already be deleted
      console.log(`[sbRestDeleteVale] Vale key ${vKey} not in gestor row ${gestorId} — already removed`);
      return; // Not an error — the vale is gone from this row
    }
    delete data[vKey];
    if (Object.keys(data).length === 0) {
      // No more vales for this gestor → delete the entire row
      await _sbRestDelete('vales', gestorId);
      console.log(`[sbRestDeleteVale] ✓ OLD format: deleted entire row id=${gestorId} (was last vale)`);
    } else {
      // Update the row with the vale removed
      await _sbRestUpsert('vales', gestorId, data);
      console.log(`[sbRestDeleteVale] ✓ OLD format: removed vale ${vKey} from row id=${gestorId}, ${Object.keys(data).length} vales remain`);
    }
    // v33: VERIFICATION — re-read Supabase to confirm the vale is actually gone
    try {
      const vUrl = `${_SB_REST}/vales?select=id,data&id=eq.${encodeURIComponent(String(gestorId))}`;
      const vRes = await fetch(vUrl, { headers: _SB_AUTH_HDRS });
      if (vRes.ok) {
        const vRows = await vRes.json();
        if (vRows && vRows.length > 0 && vRows[0].data && vRows[0].data[vKey] !== undefined) {
          // VALE STILL EXISTS — the delete/upsert didn't work!
          console.error(`[sbRestDeleteVale] ✗✗ VERIFICATION FAILED: vale ${vKey} still in gestor row ${gestorId}!`);
          if (_retryCount < 2) {
            console.log(`[sbRestDeleteVale] Retrying deletion (attempt ${_retryCount + 2})...`);
            return _sbRestDeleteValeCore(valeId, gestorId, _retryCount + 1);
          }
          throw new Error(`Verification failed: vale ${vKey} still exists after delete`);
        }
        console.log(`[sbRestDeleteVale] ✓ Verification: vale ${vKey} confirmed deleted from Supabase`);
      }
    } catch(verifyErr) {
      console.warn('[sbRestDeleteVale] Verification check error:', verifyErr);
      // Don't throw — the delete likely worked, we just couldn't verify
    }
  } catch(e) {
    console.error('[sbRestDeleteVale] OLD format error:', e);
    throw e; // v33: Re-throw so callers know the delete failed
  }
}
function _fakeSnap(arr) {
  const docs = (arr || []).map(o => ({ id: String(o && o.id != null ? o.id : ''), data: () => o, metadata: { hasPendingWrites: false } }));
  return { docs, empty: docs.length === 0, size: docs.length, forEach: fn => docs.forEach(fn) };
}
// ── v35: Resolve product photo URL ──
// Product photos have 3 formats:
//   1. Full URL: https://tiendamax.org/imagenes/... → use as-is
//   2. Relative path: photos/p-XXX.webp → prepend origin to make absolute
//   3. Data URI: data:image/... → use as-is
// Without this, relative "photos/" URLs fail because the browser can't resolve them
// from the PWA context (service worker, cached page, etc.)
// v65 — OJO: existe una gemela, photoUrl() en catalogo.html. Esa página es
// autónoma a propósito (no carga app.js), así que la lógica está escrita dos
// veces. Ya costó un fallo: el catálogo se quedó sin la parte que resuelve las
// rutas relativas y no mostró ninguna foto de producto durante versiones (v62).
// Si tocas una, revisa la otra. La de catalogo.html absolutiza cualquier ruta
// relativa; esta solo las que empiezan por photos/ y el resto las deja tal cual.
function _resolvePhotoUrl(photo) {
  if (!photo) return '';
  // Data URI or full URL — use as-is
  if (/^(https?:|data:|blob:)/i.test(photo)) return photo;
  // Relative path starting with photos/ — make absolute
  if (photo.startsWith('photos/') || photo.startsWith('/photos/')) {
    const base = window.location.origin + window.location.pathname.replace(/[^/]*$/, '');
    return base + (photo.startsWith('/') ? photo.slice(1) : photo);
  }
  // Other: try as-is
  return photo;
}
// ── v29→v37: Flatten vales from Supabase mixed format ──
// The `vales` table in Supabase has TWO formats:
//   OLD: rows where id=gestorId, data={valeId: valeObj, ...}  (grouped by gestor)
//   NEW: rows where id=valeId, data={id, ts, ...}             (one row per vale)
// _sbRestGetCollection('vales') returns rows.map(r => r.data), which gives us
// a mix of nested objects (old) and flat vale objects (new).
//
// v37 CRITICAL FIX: Two-pass approach — NEW format ALWAYS wins over OLD.
// ANTES (v36): first-come-first-served dedup. OLD format rows have smaller `id`
// (gestorId ~ 1-100) so they sort first. When both formats exist for the same
// vale, OLD format was kept (with stale status like 'pending') and NEW format
// (with updated status like 'confirmed') was dropped. This caused:
//   - Status always showing 'admin pendiente' even after confirmation
//   - Confirmed sales reverting to pending on next poll
//   - Notifications never firing (status change was overwritten before render)
// AHORA: Pass 1 collects NEW format vales (from upserts = latest data).
// Pass 2 adds OLD format vales ONLY if their ID isn't in NEW format yet.
// Result: NEW format always takes priority, old stale data is ignored.
function _flattenValesFromSB(rawItems) {
  const newFormatMap = new Map(); // id → vale (NEW format, highest priority)
  const oldFormatMap = new Map(); // id → vale (OLD format, fallback only)

  // Helper: extract vale objects from an OLD-format nested item
  function _extractOldFormatVales(item) {
    const vales = [];
    const vals = Object.values(item);
    if (vals.length > 0 && vals[0] && typeof vals[0] === 'object' && vals[0].id != null && vals[0].ts != null) {
      for (const v of vals) { if (v && v.id != null) vales.push(v); }
      return vales;
    }
    // Fallback: numeric keys at top level
    const keys = Object.keys(item);
    if (keys.length > 0 && !isNaN(Number(keys[0])) && Number(keys[0]) > 1000000000000) {
      for (const v of Object.values(item)) { if (v && v.id != null) vales.push(v); }
    }
    return vales;
  }

  for (const item of (rawItems || [])) {
    if (!item || typeof item !== 'object') continue;
    // NEW format check: item is a flat vale with id as timestamp
    if (item.id != null && item.ts != null && typeof item.id === 'number' && item.id > 1000000000000) {
      if (item.gestorId != null || item.status != null || item.cliente != null) {
        // NEW format always wins — put in newFormatMap
        newFormatMap.set(item.id, item);
        continue;
      }
    }
    // OLD format: extract individual vales from nested structure
    const oldVales = _extractOldFormatVales(item);
    for (const v of oldVales) {
      // Only add if not already in NEW format for this ID
      if (!newFormatMap.has(v.id)) {
        oldFormatMap.set(v.id, v);
      }
    }
  }

  // Merge: NEW format vales first (they have priority), then OLD format fallbacks
  const flat = [];
  for (const v of newFormatMap.values()) flat.push(v);
  for (const v of oldFormatMap.values()) flat.push(v);
  return flat;
}
let _restPollTimer = null;
let _restPollInFlight = false;
const _REST_POLL_MS = 5000;
// v66: ritmo lento para los datos que casi nunca cambian (productos, categorías,
// gestores, mensajeros, config, estafa, ranking_summary). Ver el motivo donde se
// usa: descargarlos cada 5 s era la mayor parte del tráfico contra Supabase.
const _POLL_LENTO_MS = 300000; // 5 minutos
let _ultimoPollLento = 0;      // 0 = la primera pasada los trae igualmente
async function _doRestPoll() {
  if (_restPollInFlight) return;
  if (!navigator.onLine) return;
  if (document.hidden) return;
  _restPollInFlight = true;
  // v66: ¿toca en esta pasada refrescar lo que cambia poco? (cada 5 min)
  const _toqueNodosLentos = (Date.now() - _ultimoPollLento) >= _POLL_LENTO_MS;
  if (_toqueNodosLentos) _ultimoPollLento = Date.now();
  // v96: si en esta pasada algún nodo lento se salta por tener un write en curso,
  // aquí se marca para volver a intentarlo en la siguiente vuelta (5 s) en vez de
  // esperar los 5 minutos completos. Antes el turno se daba por gastado aunque no
  // se hubiera bajado nada: el teléfono se quedaba con su copia vieja de productos
  // hasta 5 minutos más, y cualquier cambio hecho entretanto partía de ahí.
  let _lentoSaltado = false;
  // v55: Snapshot de vales ANTES del poll, para detectar cambios de status
  // y forzar re-render si los hay.
  const _prePollValesMap = new Map();
  try {
    const _pre = getVales();
    _pre.forEach(v => { if (v && v.id != null) _prePollValesMap.set(String(v.id), v); });
  } catch(e) {}
  try {
    // ── v29: Sync vales from Supabase REST ──
    // ANTES (v28): usaba _handleValesSnap/_handleMyValesSnap que NUNCA se definían,
    // así que los vales NUNCA se sincronizaban desde Supabase.
    // ANTES (v23): usaba db.ref('vales').on() pero db es un mock (no-op).
    // AHORA: leemos vales via REST, aplanamos el formato mixto, y hacemos merge
    // con los vales locales (misma lógica que el viejo listener de Supabase (legacy)).
    // v31 FIX: Also check _sbProcessing to prevent race condition.
    // ANTES: solo se verificaba _sbWriteQueue. Pero cuando _processSBQueue hace
    // shift() del item, la cola queda vacía mientras el write está en vuelo.
    // _doRestPoll lee datos viejos de Supabase y los escribe en localStorage,
    // haciendo que los vales borrados vuelvan a aparecer.
    const _valesWriteInFlight = _sbProcessing && _currentWritePath && (_currentWritePath === 'vales' || _currentWritePath.startsWith('vales/'));
    // v55 FIX: Allow the poll to proceed even if there are writes queued/in-flight.
    // ANTES (v32-v54): si había writes encolados o en vuelo para 'vales', se saltaba
    // el poll entero. En redes lentas, un write stuck (timeout + retry) bloqueaba
    // TODOS los polls → el gestor nunca veía los cambios del admin (confirmaciones,
    // asignaciones) → los vales se quedaban eternamente en 'pending' en la UI
    // del gestor aunque en Supabase estuvieran correctos.
    // AHORA (v55): solo bloquear si hay deletes directos en progreso
    // (_valesDirectDeleting). El merge logic (Supabase-wins-for-status) maneja
    // conflictos de writes normales. Para zombie vales (borrados locales cuyo
    // delete write no ha llegado a Supabase), el siguiente poll los limpiará.
    if (_valesDirectDeleting.size > 0) {
      // Hay deletes directos en progreso — no sobreescribir con datos viejos.
    } else {
      try {
        // v66: el gestor pide solo lo suyo; el admin necesita verlo todo.
        // Si el filtrado falla, _sbRestGetValesDeGestor devuelve null y se cae a
        // la descarga completa de siempre.
        let rawVales = null;
        let _saltarVales = false;
        // v112: ¿esta pasada trajo SOLO los vales que cambiaron? De eso depende
        // cómo se fusiona: en una bajada completa, un vale que está en el
        // teléfono y no viene de Supabase es que lo borraron; en una parcial,
        // simplemente no ha cambiado. Confundir esas dos cosas borraría el
        // historial entero, así que la diferencia viaja hasta la fusión.
        let _valesParcial = false;
        // v114: un gestor que todavía no ha entrado con su clave no tiene
        // ningún vale que enseñar — la pantalla de antes de entrar solo lista
        // nombres. Pero el bucle se bajaba igualmente la tabla ENTERA (149 KB
        // medidos) en CADA arranque de la app y en cada teléfono, para no
        // pintar nada con ella. Se espera a que entre.
        if (!IS_ADMIN && activeGestorId == null) { _saltarVales = true; rawVales = []; }
        else if (!IS_ADMIN && activeGestorId != null) {
          // v114: el mismo freno que el admin lleva desde v103, que a esta rama
          // se le había olvidado poner. Ver la nota en _sbRestHayCambiosDeGestor.
          const _tsG = _ultimaTsVisto.vales;
          const _fetchViejoG = (Date.now() - (_ultimoFetchReal.vales || 0)) > _GATE_SEGURIDAD_MS.vales;
          if (_tsG !== undefined && !_fetchViejoG) {
            if (await _sbRestHayCambiosDeGestor(activeGestorId, _tsG)) {
              const _rg = await _sbRestGetValesDeGestorDesde(activeGestorId, _tsG);
              if (_rg) {
                rawVales = _rg.items;
                _valesParcial = true;
                if (_rg.maxTs) _ultimaTsVisto.vales = _rg.maxTs;
                if (!rawVales.length) _saltarVales = true;
              }
            } else {
              _saltarVales = true;
              rawVales = [];   // nada nuevo; no se toca el estado local
            }
          }
          // Primera pasada, o toca la bajada de seguridad (la única que ve los
          // borrados), o la parcial falló: se baja todo lo suyo.
          if (rawVales === null && !_saltarVales) {
            const _rgFull = await _sbRestGetValesDeGestor(activeGestorId);
            if (_rgFull) {
              rawVales = _rgFull.items;
              _ultimoFetchReal.vales = Date.now();
              _ultimaTsVisto.vales = _rgFull.maxTs || _ultimaTsVisto.vales || new Date().toISOString();
            }
          }
        }
        if (rawVales === null) {
          // v103: aquí es donde se iban los GB — ver la nota grande junto a
          // _sbRestHayCambios(). Se pregunta primero con una consulta mínima;
          // solo si dice que sí (o toca la red de seguridad) se baja la tabla.
          const _tsVales = _ultimaTsVisto.vales;
          let _fetchViejo = (Date.now() - (_ultimoFetchReal.vales || 0)) > _GATE_SEGURIDAD_MS.vales;
          // ── v119: preguntar cuántas filas hay antes de bajarlas ──
          // Al barrido solo le interesa saber si desapareció algo. Si el número
          // de filas del servidor es el mismo que la última vez que se bajó de
          // verdad, no se ha borrado nada y no hay nada que barrer: se deja el
          // turno para dentro de otro rato y se sigue por la vía incremental.
          // Cuesta ~200 bytes frente a la tabla entera, y cuesta lo mismo aunque
          // la tabla crezca — que es lo que hacía que esto se repitiera cada
          // pocos meses según crecía el negocio.
          //
          // El barrido de verdad NO desaparece: _GATE_ABSOLUTO_MS lo fuerza cada
          // pocas horas pase lo que pase. Hace falta porque el número de filas no
          // lo ve todo: en el formato viejo de la tabla una fila guarda los vales
          // de un gestor entero, así que borrar uno de dentro deja el conteo
          // igual. Ese caso se corrige en el barrido de fondo.
          if (_fetchViejo && _filasVistas.vales != null) {
            const _fetchMuyViejo = (Date.now() - (_ultimaBajadaCompleta.vales || 0)) > _GATE_ABSOLUTO_MS.vales;
            if (!_fetchMuyViejo) {
              const _n = await _sbRestContarFilas('vales');
              if (_n !== null && _n === _filasVistas.vales) {
                _fetchViejo = false;                  // nada borrado: no toca barrer
                _ultimoFetchReal.vales = Date.now();  // se renueva el turno
              }
            }
          }
          const _hayCambiosVales = (_tsVales === undefined) || _fetchViejo || await _sbRestHayCambios('vales', _tsVales);
          if (_hayCambiosVales) {
            // v112: igual que con los otros nodos, solo las filas que cambiaron.
            // Aquí es donde más se nota: la tabla de vales pesa 149 KB y cambia
            // con cada acción sobre cualquier vale.
            _valesParcial = (_tsVales !== undefined) && !_fetchViejo;
            const _r = _valesParcial ? await _sbRestGetCollectionDesde('vales', _tsVales)
                                     : await _sbRestGetCollectionYTs('vales');
            rawVales = _r.items;
            if (!_valesParcial) {
              _ultimoFetchReal.vales = Date.now();
              _ultimaBajadaCompleta.vales = Date.now();   // esta sí fue completa
              // Con la foto recién bajada, se apunta cuántas filas tenía: es
              // contra este número contra el que compara el conteo barato.
              _filasVistas.vales = (typeof _r.filas === 'number') ? _r.filas : null;
            }
            _ultimaTsVisto.vales = _r.maxTs || _ultimaTsVisto.vales || new Date().toISOString();
            if (_valesParcial && !rawVales.length) _saltarVales = true;
            // ── v119: una bajada completa que vuelve vacía tiene que demostrarlo ──
            // En el barrido completo, un vale que está aquí y no viene en la
            // bajada se da por borrado. Eso es lo que hace que los borrados se
            // noten... y también que una bajada vacía POR UN FALLO —un 404, un
            // RLS mal puesto, una respuesta cortada— se lleve por delante el
            // historial entero de este teléfono. Comprobado: devolvía [] y los
            // vales locales desaparecían todos.
            //
            // "Vacío" de verdad existe (el admin puede borrarlos todos), así que
            // no vale ignorarlo sin más: se le pregunta al servidor cuántas
            // filas tiene. Si dice 0, era de verdad y se aplica. Si dice que hay
            // filas —o no se puede saber— la bajada no era buena y no se toca
            // nada: ya volverá la siguiente.
            if (!_valesParcial && !rawVales.length) {
              const _hayLocales = (getVales() || []).some(v => v && v.synced !== false);
              if (_hayLocales) {
                const _n = await _sbRestContarFilas('vales');
                if (_n !== 0) {
                  console.warn('[vales] bajada completa vacía pero el servidor dice que hay '
                    + (_n === null ? '¿?' : _n) + ' fila(s) — se conserva lo de aquí');
                  _saltarVales = true;
                  _ultimoFetchReal.vales = 0;      // que reintente en la próxima pasada
                  _filasVistas.vales = null;
                }
              }
            }
          } else {
            _saltarVales = true; // nada nuevo — no hay nada que fusionar esta vez
          }
        }
        if (_saltarVales) { /* nada que hacer: el estado local ya refleja lo último visto */ } else {
        const flatVales = _flattenValesFromSB(rawVales);
        // v67: aquí iba el log [AXON-DIAG] por cada pasada del poll, que sirvió
        // para localizar por qué los estados no llegaban al gestor. Ya cumplió y
        // se retira para no ensuciar la consola cada 5 s. El aviso del catch de
        // más abajo SÍ se queda: ese solo habla cuando algo falla de verdad.
        // v34 FIX: ALWAYS update localStorage from Supabase, even if flatVales is empty.
        // ANTES: solo se actualizaba si flatVales.length > 0. Si se borraban TODOS los
        // vales de Supabase, localStorage mantenía los vales "zombie" y reaparecían.
        {
          // Regenerar campos slimados (valeText, name de valeProductos)
          flatVales.forEach(v => {
            if (v && !v.valeText) v.valeText = (typeof regenerateValeText === 'function') ? regenerateValeText(v) : '';
            if (v && Array.isArray(v.valeProductos)) {
              v.valeProductos.forEach(p => {
                if (!p.name) {
                  const prod = (typeof productoOf === 'function') ? productoOf(p.id) : null;
                  if (prod) p.name = prod.name;
                }
              });
            }
            // v50 FIX: si el vale llegó sin status (vales viejos guardados antes
            // del fix de slimValeGestor), asignar 'pending' por defecto. Sin esto,
            // el filtro .includes(v.status) en renderMyVales lo descartaba y el
            // vale desaparecía de la pantalla del gestor.
            if (v && !v.status) v.status = 'pending';
            if (v && v.synced === undefined) v.synced = true;
          });
          // ── v37 SMART MERGE: local-wins for recently changed vales ──
          // ANTES (v36): Supabase was the base, local orphaned (synced:false) appended.
          // Problem: if admin confirmed a sale locally but the write hasn't reached
          // Supabase yet (or Supabase returns slightly stale data), the poll would
          // overwrite the local 'confirmed' status with Supabase's 'pending'.
          //
          // AHORA: For each vale that exists in BOTH local and Supabase, we compare
          // modification timestamps. If the local version was modified more recently
          // (e.g. has a confirmedTs that Supabase doesn't have, or has a newer status
          // change), the local version wins. Otherwise Supabase wins (it may have
          // updates from another device).
          const localVales = getVales() || [];
          const localMap = new Map();
          localVales.forEach(v => { if (v && v.id != null) localMap.set(v.id, v); });

          // Helper: get the effective modification timestamp of a vale.
          // v39: confirmedTs > assignedTs > deliveredTs > ts — the most recent admin action wins.
          function _valeModTs(v) {
            if (!v) return 0;
            if (v.confirmedTs) return new Date(v.confirmedTs).getTime();
            if (v.assignedTs) return new Date(v.assignedTs).getTime();
            if (v.deliveredTs) return new Date(v.deliveredTs).getTime();
            return new Date(v.ts || 0).getTime();
          }

          // v39: TIME-BASED local-wins window.
          // PROBLEM: the old _localIsMoreAdvanced used STATUS_RANK alone, so a stale
          // local vale with status='confirmed' from a previous session would win over
          // a newer Supabase vale with status='assigned' from another device, because
          // confirmed rank 4 > assigned rank 1. This broke cross-device sync.
          //
          // FIX: local only wins if:
          //   a) The vale was patched locally within the last 60 seconds (write may
          //      not have reached Supabase yet), AND
          //   b) Local status rank is higher OR same rank with newer timestamp.
          // After 60 seconds, Supabase is ALWAYS the source of truth for status.
          const _LOCAL_WINS_WINDOW_MS = 60000; // 60 seconds
          const STATUS_RANK = { pending: 0, assigned: 1, delivered: 2, pending_payment: 3, confirmed: 4, cancelled: -1 };
          function _localIsMoreAdvanced(localV, sbV, valeId) {
            if (!localV || !sbV) return false;
            // v39: Only allow local-wins if this vale was recently patched locally
            const patchTs = _valeLocalPatchTs.get(String(valeId));
            if (!patchTs || (Date.now() - patchTs) > _LOCAL_WINS_WINDOW_MS) {
              // Not recently changed locally → Supabase is source of truth
              // BUT: if local has fields that Supabase doesn't (e.g. synced===false
              // for a new vale), still keep local version.
              return false;
            }
            const localRank = STATUS_RANK[localV.status] ?? 0;
            const sbRank = STATUS_RANK[sbV.status] ?? 0;
            // If local status is more advanced (e.g. confirmed vs pending), local wins
            if (localRank > sbRank) return true;
            // If same rank but local has a newer modification timestamp, local wins
            if (localRank === sbRank && _valeModTs(localV) > _valeModTs(sbV)) return true;
            return false;
          }

          const sbMap = new Map();
          flatVales.forEach(v => { if (v && v.id != null) sbMap.set(v.id, v); });

          // Build merged: start with Supabase, then apply local-wins where appropriate
          const mergedMap = new Map();
          // Add all Supabase vales first — Supabase is the base (cross-device truth)
          for (const [id, v] of sbMap) mergedMap.set(id, v);
          // Apply local-wins: for vales that exist locally AND in Supabase
          for (const [id, lv] of localMap) {
            const sv = sbMap.get(id);
            if (sv) {
              // Vale exists in both — check if local is more advanced (with time window)
              if (_localIsMoreAdvanced(lv, sv, id)) {
                mergedMap.set(id, lv); // local wins (recently changed locally)
              } else {
                // v39: Supabase wins — but MERGE non-status fields from local that
                // Supabase might not have (e.g. synced flag, isNew flag).
                // This prevents losing the synced===false status for pending writes.
                const merged = { ...sv }; // start with Supabase (source of truth for status)
                if (lv.synced === false) merged.synced = false; // preserve pending sync flag
                if (lv.isNew && !sv.isNew) merged.isNew = true; // preserve new flag
                if (lv.hiddenFromHistory && !sv.hiddenFromHistory) merged.hiddenFromHistory = true;
                mergedMap.set(id, merged);
              }
            } else {
              // Vale only exists locally
              // ⚠ v112: en una bajada PARCIAL esto no significa "lo borraron",
              // significa "no ha cambiado" — que es el caso de la inmensa
              // mayoría. Borrarlos aquí vaciaría el historial en la primera
              // pasada. Solo una bajada completa puede concluir un borrado.
              if (_valesParcial) {
                mergedMap.set(id, lv);
              } else if (lv.synced === false && lv.status !== 'cancelled') {
                // Orphaned local vale (not yet synced to Supabase) — keep it
                mergedMap.set(id, lv);
              }
            }
          }

          let merged = Array.from(mergedMap.values());
          // Deduplicate by vale ID (safety net)
          {
            const seen = new Set();
            merged = merged.filter(v => {
              if (!v || v.id == null) return false;
              const key = String(v.id);
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });
          }
          // Filtrar por gestor si estamos en modo gestor
          if (!IS_ADMIN && activeGestorId != null) {
            const gid = Number(activeGestorId);
            merged = merged.filter(v => v && v.gestorId != null && Number(v.gestorId) === gid);
          }
          merged.sort((a, b) => new Date(b.ts) - new Date(a.ts));
          // Check for new vales with estafa matches
          const oldVales = getVales();
          const newIds = merged.filter(nv => nv.isNew && !oldVales.find(ov => ov.id === nv.id));

          // ── v38: Detect status changes and fire notifications ──
          // ANTES: this logic only existed inside listenToMyVales() which uses
          // db.ref().on() — a MOCK that NEVER fires. So the gestor never got
          // notifications when the admin changed a vale's status (assigned, delivered,
          // confirmed, seenByAdmin). Now we detect changes right here in _doRestPoll().
          if (!IS_ADMIN) {
            merged.forEach(nv => {
              // v56: blindaje. Dos veces ya (prodNames en v52, personalCleared en
              // v56) un error al construir un aviso ha tumbado este forEach ANTES
              // del setItem('axon_vales') de más abajo, dejando los vales del
              // gestor sin guardar y repitiendo el fallo en cada poll. Avisar es
              // secundario; guardar el estado de los vales no. Si un vale falla,
              // se registra y se sigue con el resto.
              try {
              const ov = oldVales.find(x => x.id === nv.id);
              if (!ov) return; // new vale, not a status change

              // v52 FIX: prodNames se calculaba dentro del bloque `if (ov.status
              // !== nv.status)` pero también se usaba más abajo en el bloque de
              // seenByAdmin, fuera de ese scope (const es de bloque). Eso lanzaba
              // "ReferenceError: prodNames is not defined" cada vez que el admin
              // marcaba un vale como visto, lo cual abortaba este forEach ANTES de
              // que se guardara el merge en _valesCache/localStorage (líneas más
              // abajo) — dejando el caché de vales del gestor permanentemente
              // desincronizado (el próximo poll comparaba contra el mismo ov
              // desactualizado y volvía a crashear). Efecto: ninguna notificación
              // de estado (asignado/entregado/cobrado/visto) volvía a llegar a ese
              // gestor hasta recargar la app. Ahora se calcula una sola vez, sin
              // condicionar al bloque de status.
              // v52 FIX: sin escapeHTML aquí. Este texto se guarda como DATO en la
              // notificación y quien lo pinta (renderItem) ya lo escapa, así que
              // escaparlo también aquí lo hacía dos veces: un producto llamado
              // 'Controlador solar 120A Y&H' se le mostraba al gestor como
              // 'Y&amp;amp;H'. El escapado va en la capa que pinta, no en el dato.
              // Ojo: prodNames se usa además en sendBrowserNotif, que muestra
              // texto plano — otra razón para no meterle entidades HTML.
              const prodNames = (nv.valeProductos||[]).map(p => p.qty > 1 ? `${p.qty}x ${p.name||''}` : (p.name||'')).join(', ');

              // Status change notification.
              // El propio dispositivo del gestor genera aquí la notif además de
              // la que crea el admin al ejecutar la acción. Esa redundancia es
              // deliberada: 'notifs' es una fila SINGLETON en Supabase que cada
              // dispositivo reescribe entera, así que el aviso del admin se puede
              // perder si otro dispositivo guarda su copia antes de recibirlo.
              // Detectar el cambio sobre los vales (que sí se sincronizan fila a
              // fila) es la vía fiable. La clave `evt` hace que ambas notifs se
              // colapsen en una sola en _mergeNotifArrays, sin duplicados.
              if (ov.status !== nv.status) {
                if (nv.status === 'assigned') {
                  if (typeof sendBrowserNotif === 'function') sendBrowserNotif('Venta en camino 🛵', prodNames || '...');
                  if (typeof playSound === 'function') playSound('confirm');
                  if (typeof addNotif === 'function') addNotif('vale_assigned', prodNames || '', null, 'Vale #' + valeNumStr(nv), nv.gestorId, 'vale_assigned:' + nv.id);
                } else if (nv.status === 'delivered') {
                  if (typeof sendBrowserNotif === 'function') sendBrowserNotif('Venta entregada 🎉', prodNames);
                  if (typeof playSound === 'function') playSound('confirm');
                  if (typeof addNotif === 'function') addNotif('vale_delivered', prodNames || '', null, 'Vale #' + valeNumStr(nv), nv.gestorId, 'vale_delivered:' + nv.id);
                } else if (nv.status === 'confirmed') {
                  let amtStr = '';
                  if (typeof getValeCommissionParts === 'function') {
                    const cp = getValeCommissionParts(nv);
                    if (cp.total !== null && cp.total > 0) {
                      amtStr = cp.currency === 'MN' ? ` por ${Math.round(cp.total)} MN` : ` por ${cp.total.toFixed(2)} USD`;
                    }
                  }
                  if (typeof sendBrowserNotif === 'function') sendBrowserNotif('Venta cobrada 💰', `${prodNames}${amtStr}`);
                  if (typeof playSound === 'function') playSound('confirm');
                  if (typeof addNotif === 'function') addNotif('vale_confirmed', prodNames || '', null, 'Vale #' + valeNumStr(nv) + amtStr, nv.gestorId, 'vale_confirmed:' + nv.id);
                } else if (nv.status === 'pending_payment') {
                  if (typeof sendBrowserNotif === 'function') sendBrowserNotif('Pendiente de cobro ⏳', prodNames);
                  if (typeof playSound === 'function') playSound('confirm');
                  if (typeof addNotif === 'function') addNotif('vale_pending', prodNames || '', null, 'Vale #' + valeNumStr(nv), nv.gestorId, 'vale_pending:' + nv.id);
                }
              }

              // seenByAdmin change notification (admin opened the pending vale)
              if (ov.status === 'pending' && nv.status === 'pending' && !ov.seenByAdmin && nv.seenByAdmin) {
                if (typeof sendBrowserNotif === 'function') sendBrowserNotif('Visto por admin 👁️', 'Tu vale fue visto');
                if (typeof playSound === 'function') playSound('confirm');
                if (typeof addNotif === 'function') addNotif('vale_seen', prodNames || '', null, 'Vale #' + valeNumStr(nv), nv.gestorId, 'vale_seen:' + nv.id);
              }
              } catch(e) { console.warn('[rest-poll] aviso de estado falló para el vale', nv && nv.id, e && e.message); }
            });
          }

          // Admin-side: detect new pending vales from gestores
          if (IS_ADMIN) {
            merged.forEach(nv => {
              const ov = oldVales.find(x => x.id === nv.id);
              if (!ov && nv.status === 'pending') {
                // New vale from a gestor — already handled by addNotif in sendVale,
                // but play sound in case the admin is watching
                if (typeof playSound === 'function') playSound('newVale');
              }
            });
          }
          _syncCount++;
          try {
            _safeSetLS('axon_vales', JSON.stringify(merged)); // v65: era un catch vacío — si el guardado fallaba (p.ej. sin espacio), los vales se perdían sin que nadie se enterara
            _valesCache = merged; _valesDirty = false;
            // v92: esta vía NO pasa por saveVales(), así que las reservas hay que
            // recalcularlas aquí a mano o se quedarían con el conteo anterior.
            setTimeout(_refrescarReservas, 0);
          } finally { _syncCount--; }
          // Show estafa alert for new vales that match blacklist
          if (typeof checkEstafaMatch === 'function' && typeof showEstafaAlert === 'function') {
            newIds.forEach(nv => {
              const estafaMatches = checkEstafaMatch(nv);
              if (estafaMatches.length) setTimeout(() => showEstafaAlert(nv, estafaMatches), 300);
            });
          }
          // Debounced ranking summary update (admin only)
          if (IS_ADMIN && typeof _rankingDebounce !== 'undefined') {
            clearTimeout(_rankingDebounce);
            _rankingDebounce = setTimeout(() => {
              const gestores = getGestores();
              // v114: los puntos del CICLO, no los de siempre. Este es el número
              // que el gestor ve en su barra de meta: si no se le descuentan los
              // ciclos ya cerrados, la barra se queda llena para siempre y la
              // meta deja de significar nada.
              const summary = gestores.map(g => {
                const total = merged.filter(v => v.gestorId === g.id && ['confirmed', 'pending_payment'].includes(v.status))
                  .reduce((sum, v) => sum + (v.valeProductos || []).reduce((s, p) => { const pr = (typeof productoOf === 'function') ? productoOf(p.id) : null; return s + ((pr && pr.puntos) || 0) * p.qty; }, 0), 0);
                const pts = Math.max(0, total - (parseFloat(g.puntosCanjeados) || 0));
                return { id: g.id, pts, metas: parseInt(g.metasLogradas, 10) || 0 };
              });
              const summaryStr = JSON.stringify(summary);
              if (summaryStr !== _lastRankingSummary) {
                _lastRankingSummary = summaryStr;
                _enqueueSB('ranking_summary', summary, 'set');
              }
            }, 3000);
          }
        }
        } // v103: cierra el "else" de _saltarVales — ver el gate más arriba
      } catch(e) {
        // v58: este catch envuelve TODO el bloque de vales (lectura, merge, avisos
        // y guardado). Con console.warn el fallo pasaba desapercibido y el poll
        // seguía hasta las notifs, así que el gestor recibía los avisos del admin
        // mientras sus vales se quedaban congelados en el estado viejo — sin ni un
        // error a la vista. Ahora se ve, y queda guardado para poder consultarlo.
        try { window.__axonValesError = { cuando: new Date().toISOString(), error: (e && (e.stack || e.message)) || String(e) }; } catch(_e) {}
        console.error('[AXON-DIAG] FALLO al sincronizar vales — los estados NO se actualizarán:', e);
      }
    }
    // v39: Log sync status for debugging cross-device sync issues
    if (typeof _lastSyncLog === 'undefined') var _lastSyncLog = 0;
    if (Date.now() - _lastSyncLog > 30000) { // log every 30s max
      _lastSyncLog = Date.now();
      const vCount = getVales().length;
      const qLen = _sbWriteQueue.length;
      console.log(`[sync] vales:${vCount} queue:${qLen} connected:${_sbConnected} online:${navigator.onLine}`);
    }
    // v66: estos cuatro nodos se descargaban ENTEROS cada 5 s como los vales, y
    // apenas cambian: productos solo son ~78 KB de los ~280 KB de cada pasada.
    // A 720 pasadas por hora eso era la mayor parte del tráfico de salida de
    // Supabase, que agotó los 5 GB del plan gratuito. Ahora van cada 5 minutos.
    // No se nota en la app: un producto nuevo o un gestor nuevo tarda como mucho
    // 5 minutos en aparecer, y eso no lo mira nadie al segundo.
    for (const node of (_toqueNodosLentos ? ['gestores', 'mensajeros', 'productos', 'categorias'] : [])) {
      try {
        // ── v28 BUGFIX: No sobreescribir datos locales si hay writes pendientes ──
        // v94: mirar TAMBIÉN el write en vuelo, no solo la cola. Cuando un write
        // sale de la cola para enviarse, la cola queda vacía aunque el dato aún
        // no haya llegado a Supabase; en esa ventana este poll bajaba la foto
        // ANTERIOR y pisaba con ella el stock recién descontado. A los vales se
        // les puso este mismo cerrojo en v31 (línea ~705) y a estos nodos se les
        // olvidó — el mismo fallo, esperando su turno.
        const _enVuelo = _sbProcessing && _currentWritePath &&
                         (_currentWritePath === node || _currentWritePath.startsWith(node + '/'));
        if (_enVuelo || _sbWriteQueue.some(q => q.path === node || q.path.startsWith(node + '/'))) { _lentoSaltado = true; continue; }
        // v103: mismo truco que en vales — preguntar primero con una consulta
        // mínima en vez de bajar la tabla entera (productos incluye fotos de
        // hasta 200 KB cada una; con 93 productos, ~640 KB por pasada). Estos
        // nodos ya solo se tocaban cada 5 min, pero de esos 5 minutos la
        // mayoría no cambia nada — sobre todo de madrugada, con la tienda
        // cerrada y el teléfono del admin encendido igual.
        const _tsNodo = _ultimaTsVisto[node];
        const _fetchViejoNodo = (Date.now() - (_ultimoFetchReal[node] || 0)) > _GATE_SEGURIDAD_MS.lento;
        const _hayCambiosNodo = (_tsNodo === undefined) || _fetchViejoNodo || await _sbRestHayCambios(node, _tsNodo);
        if (!_hayCambiosNodo) continue; // nada nuevo — no hay nada que bajar
        // v112: si ya tenemos la tabla y no toca la bajada de seguridad, se
        // piden SOLO las filas que cambiaron y se encajan sobre las que había.
        // La bajada completa queda para el arranque y para pillar los borrados.
        const _parcial = (_tsNodo !== undefined) && !_fetchViejoNodo;
        const _rn = _parcial ? await _sbRestGetCollectionDesde(node, _tsNodo)
                             : await _sbRestGetCollectionYTs(node);
        let arr;
        if (_parcial) {
          if (!_rn.items.length) continue;          // la pregunta dijo sí pero no vino nada
          const _previas = (node === 'productos') ? getProductos()
                         : (node === 'gestores')   ? getGestores()
                         : (node === 'mensajeros') ? getMensajeros()
                         : (node === 'categorias') ? getCategorias() : [];
          arr = _fusionarPorId(_previas, _rn.items);
          console.log(`[sync] ${node}: ${_rn.items.length} fila(s) nuevas en vez de ${_previas.length}`);
        } else {
          arr = _rn.items;
          _ultimoFetchReal[node] = Date.now();
        }
        _ultimaTsVisto[node] = _rn.maxTs || _ultimaTsVisto[node] || new Date().toISOString();
        // v33 FIX: Always update localStorage even if Supabase returns empty
        // (prevents "zombie" data from staying in localStorage after being deleted from Supabase)
        _syncCount++;
        try {
          _safeSetLS('axon_'+node, JSON.stringify(arr)); // v65: idem — fallo de guardado visible
          // v114: y aquí también hay que tirar el índice — ver la nota en
          // guardarGestores(). Esta bajada deja _gestoresDirty en false, así que
          // sin esto gestorOf() seguiría sirviendo las fichas de antes del poll.
          if(node==='gestores'){_gestoresCache=arr;_gestoresDirty=false;_gestoresMap=null;}
          else if(node==='mensajeros'){_mensajerosCache=arr;_mensajerosDirty=false;_mensajerosMap=null;}
          else if(node==='productos'){
            // v95: _productosMap=null es OBLIGATORIO. Ese índice solo se
            // reconstruía al guardar, así que tras bajar productos nuevos
            // productoOf() seguía devolviendo los objetos VIEJOS para siempre —
            // y hay escrituras que leen de ahí (devolver stock al revertir un
            // vale, el modal de stock, la venta directa), así que el dato viejo
            // acababa volviendo al almacén.
            _productosCache=arr;_productosDirty=false;_productosMap=null;
          }
          else if(node==='categorias'){_categoriasCache=arr;_categoriasDirty=false;}
        } finally { _syncCount--; }
      } catch(e) { console.warn(`[rest-poll] ${node} sync error:`, e && e.message); }
    }
    // v66: 'notifs' sigue en cada pasada —es por donde llegan los avisos del admin
    // al gestor y ahí la inmediatez sí importa—. config, estafa y ranking_summary
    // pasan al ritmo lento por el mismo motivo que los nodos de arriba.
    // v114: 'costos' se añade SOLO si este teléfono es el del admin — ver la
    // nota larga en getCostos(). El del gestor ni lo pide.
    // v119: 'vales_borrados' va en el carril rápido junto a 'notifs'. En el
    // lento tardaría hasta 5 min en saberse que un vale se borró, y el sentido
    // de las lápidas es enterarse en el momento. Sale barato porque antes de
    // bajarlo se pregunta si cambió (_sbRestMetaHayCambios): mientras nadie
    // borre nada son unos cientos de bytes por pasada, y el documento en sí
    // pesa ~45 bytes por borrado.
    const _singletonsAPedir = _toqueNodosLentos
      ? (IS_ADMIN ? _SB_SINGLETON_ROWS.concat(_SB_SINGLETON_ADMIN) : _SB_SINGLETON_ROWS)
      : ['notifs', 'vales_borrados'];
    for (const node of _singletonsAPedir) {
      try {
        // ── v28 BUGFIX: Mismo guard para singleton rows (estafa, config, etc.) ──
        // v94: y el mismo cerrojo del write en vuelo que arriba.
        if ((_sbProcessing && _currentWritePath === node) || _sbWriteQueue.some(q => q.path === node)) { if (_toqueNodosLentos) _lentoSaltado = true; continue; }
        // v114: preguntar antes de bajar, igual que las tablas desde v103. Sin
        // esto, `notifs` se bajaba entero (11,5 KB medidos) cada 5 segundos en
        // cada teléfono, hubiera avisos nuevos o no. Ver _sbRestMetaHayCambios.
        //
        // La red de seguridad es la misma que en las tablas: cada tanto se baja
        // igualmente, por si un cambio se hizo sin que el trigger tocara el
        // updated_at o por si este teléfono se perdió una pasada.
        const _claveTs = 'meta:' + node;
        const _tsMeta = _ultimaTsVisto[_claveTs];
        const _fetchViejoMeta = (Date.now() - (_ultimoFetchReal[_claveTs] || 0)) > _GATE_SEGURIDAD_MS.meta;
        if (_tsMeta !== undefined && !_fetchViejoMeta && !(await _sbRestMetaHayCambios(node, _tsMeta))) continue;
        const _rm = await _sbRestGetMetaYTs(node);
        const val = _rm.data;
        _ultimoFetchReal[_claveTs] = Date.now();
        if (_rm.ts) _ultimaTsVisto[_claveTs] = _rm.ts;
        // ── v119: un documento vacío de la nube NO borra lo que hay aquí ──
        // Le pasó a `duenos` en cuanto empezó a sincronizarse de verdad: si en
        // la nube quedaba un documento vacío —de una versión que subía mal, o
        // de un teléfono que se abrió sin tener dueños todavía—, el poll lo
        // bajaba encima y el admin veía su lista desaparecer entera, también de
        // localStorage. Un vacío que llega de fuera casi nunca significa "se
        // borraron todos": significa "ese teléfono no los tenía".
        //
        // Es el mismo criterio que ya sigue `config` (el disparador
        // axon_no_vaciar_config en la base) y `notifs` (fusiona en vez de
        // reemplazar). Aquí, además, se aprovecha para volver a subir lo bueno:
        // si este teléfono tiene la lista y la nube no, la nube se arregla sola.
        if (node === 'duenos' && val && typeof val === 'object') {
          const _remotoVacio = !Array.isArray(val.lista) || !val.lista.length;
          const _local = (typeof getDuenosDoc === 'function') ? getDuenosDoc() : null;
          const _localTiene = _local && Array.isArray(_local.lista) && _local.lista.length;
          if (_remotoVacio && _localTiene) {
            console.warn('[duenos] la nube venía vacía y aquí hay ' + _local.lista.length + ' — se conserva lo de aquí y se resube');
            try { setSB('duenos', _local); } catch(e) {}
            continue;                                   // no se toca nada local
          }
        }
        if (val) {
          _syncCount++;
          try {
            _safeSetLS('axon_'+node, JSON.stringify(val)); // v65: idem — fallo de guardado visible
            if(node==='vales_borrados'){
              // v119: la lista de vales que alguien borró. En vez de bajar la
              // tabla entera para ver cuál falta, se quitan exactamente estos.
              _lapidasCache = (val && typeof val === 'object' && !Array.isArray(val)) ? val : {};
              // Solo cuentan las que llevan fecha. Una lápida podada se queda
              // como clave en null —el merge del servidor conserva las claves,
              // no puede quitarlas— y si se tomara por buena seguiría borrando
              // un vale para siempre, incluso pasados los 30 días de la poda.
              const ids = new Set(Object.keys(_lapidasCache).filter(k => !!_lapidasCache[k]));
              if (ids.size) {
                const vivos = getVales() || [];
                const quedan = vivos.filter(v => !v || v.id == null || !ids.has(String(v.id)));
                if (quedan.length !== vivos.length) {
                  console.log(`[lapidas] ${vivos.length - quedan.length} vale(s) borrados desde otro teléfono`);
                  // Estamos dentro de _syncCount++, así que saveVales NO reenvía
                  // esto a Supabase: se aplica aquí y no rebota.
                  saveVales(quedan);
                  if (typeof refreshUI === 'function') { try { refreshUI(); } catch(e) {} }
                }
              }
            }
            else if(node==='config'){
              _configCache=val;_configDirty=false;
              // v91: el chip de la tasa depende del config (ahí viaja el margen
              // que pone el admin). Si no se repinta aquí, el margen llega al
              // teléfono pero el número de arriba sigue siendo el de antes:
              // refreshUI() solo redibuja cuando cambian los VALES, y un cambio
              // de config a secas no lo despertaba.
              if (typeof renderTasaBadge === 'function') { try { renderTasaBadge(); renderTasaModal(); } catch(e) {} }
            }
            else if(node==='notifs'){
              // v43: merge local + remoto en vez de reemplazo ciego (evita pérdida
              // de notificaciones cuando varios dispositivos escriben el singleton)
              const mergedNotifs = _mergeNotifArrays(_notifsCache, val);
              _notifsCache = mergedNotifs; _notifsDirty = false;
              _safeSetLS('axon_notifs', JSON.stringify(mergedNotifs)); // v65: idem — fallo de guardado visible
              // v51 FIX: forzar render de notifs después de recibir nuevas.
              // ANTES: dependía de refreshUI() → _refreshLightUI() → renderGestorNotifs(),
              // pero si el hash de vales no cambiaba (solo llegaron notifs nuevas),
              // a veces no se renderizaba. Ahora lo forzamos directamente.
              if (typeof renderGestorNotifs === 'function') {
                try { renderGestorNotifs(); } catch(e) {}
                // v114: si entre los avisos que acaban de llegar está el de su
                // meta, el teléfono del gestor lanza la animación. Hasta ahora
                // solo la veía el admin, que es quien confirma la venta.
                try { _celebrarMetaDelGestor(); } catch(e) {}
              }
            }
            else if(node==='estafa'){_estafaCache=val;_estafaDirty=false;}
            else if(node==='reservas'){
              // v94: unidades apartadas por vales. Vive fuera del producto a
              // propósito — ver la nota larga en _refrescarReservas().
              _reservasSBCache=(val&&typeof val==='object')?val:{};_reservasSBDirty=false;
              if(typeof renderProductGrid==='function'){try{renderProductGrid();}catch(e){}}
            }
            else if(node==='duenos'){
              // v117: de quién es cada producto. Solo llega si IS_ADMIN.
              _duenosCache=_normalizarDocDuenos(val);_duenosDirty=false;
              if(typeof currentAdminTab!=='undefined'&&currentAdminTab==='duenos'&&typeof renderDuenos==='function'){try{renderDuenos();}catch(e){}}
            }
            else if(node==='costos'){
              // v114: costos de compra. Aquí solo llega si IS_ADMIN.
              _costosCache=(val&&typeof val==='object'&&!Array.isArray(val))?val:{};_costosDirty=false;
              // El único sitio que los enseña es el panel de ganancias, y solo
              // si está a la vista: repintarlo a ciegas cada 5 min borraría lo
              // que el admin esté escribiendo en la tabla en ese momento.
              if(typeof currentAdminTab!=='undefined'&&currentAdminTab==='stats'&&typeof renderStats==='function'){try{renderStats();}catch(e){}}
            }
          } finally { _syncCount--; }
        }
      } catch(e) {}
    }
    // v55 FIX: Forzar re-render si cualquier vale cambió de status respecto al
    // snapshot local anterior. ANTES, el hash de vales solo incluía id+status+ts
    // y tenía un cutoff de 500 chars. Si el gestor tenía muchos vales, los más
    // viejos no entraban en el hash → su cambio de status no se detectaba →
    // refreshUI() saltaba el render → el gestor veía vales eternamente en
    // 'pending' aunque Supabase tuviera 'confirmed'.
    // AHORA: comparamos el status de cada vale ANTES y DESPUÉS del merge. Si
    // cualquier status cambió, reseteamos _lastValesHash para forzar el render.
    try {
      const _afterVales = getVales();
      const _afterMap = new Map();
      _afterVales.forEach(v => { if (v && v.id != null) _afterMap.set(String(v.id), v); });
      let _statusChanged = false;
      for (const [id, lv] of _prePollValesMap) {
        const nv = _afterMap.get(id);
        if (nv && lv.status !== nv.status) {
          _statusChanged = true;
          console.log(`[v55] Status changed: V-${String(lv.valeNum||'?').padStart(3,'0')} ${lv.status} → ${nv.status} — forcing render`);
          break;
        }
      }
      // También detectar vales nuevos que llegaron del admin (no estaban en local)
      if (!_statusChanged) {
        for (const [id, nv] of _afterMap) {
          if (!_prePollValesMap.has(id)) {
            _statusChanged = true;
            console.log(`[v55] New vale from admin/other device: id=${id} — forcing render`);
            break;
          }
        }
      }
      if (_statusChanged) {
        _lastValesHash = ''; // forzar render completo
      }
    } catch(e) { /* best-effort */ }
    // v104: mirar si algún vale tiene su hora de entrega encima. Va dentro del
    // try/catch de la pasada y con su propio guard, para que un fallo aquí no
    // pueda cortar la sincronización de vales, que es lo importante.
    try { revisarEntregasProximas(); } catch(e) { console.warn('[entregas]', e && e.message); }
    refreshUI();
  } catch(e) { console.warn('[rest-poll] error:', e && e.message); }
  finally {
    _restPollInFlight = false;
    // v96: un nodo lento que no se pudo bajar no gasta el turno de 5 minutos.
    if (_lentoSaltado) _ultimoPollLento = 0;
  }
}
function _startRestPolling() {
  if (_restPollTimer) return;
  _doRestPoll();
  _restPollTimer = setInterval(_doRestPoll, _REST_POLL_MS);
  // v53 FIX: cuando la página se vuelve visible, forzar un poll Y resetear
  // el hash de vales para que refreshUI() SIEMPRE re-renderice la vista del
  // gestor (Mis Vales, notifs, etc.). ANTES, si el gestor salía de la app y
  // volvía, el poll corría pero si el hash no cambiaba (p.ej. el admin
  // confirmó pero el gestor ya tenía el status actualizado en caché vieja),
  // el render se saltaba y el gestor veía datos stale.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      _lastValesHash = '';
      _doRestPoll();
    }
  });
  window.addEventListener('online', () => {
    _lastValesHash = '';
    _doRestPoll();
  });
}
// ── v29 BUGFIX: _sbConnected initialization ──
// ANTES: _sbConnected = navigator.onLine, pero el listener de db.ref('.info/connected')
// es un no-op (db es mock desde v23). Si el usuario ya estaba online al arrancar,
// el evento 'online' NUNCA se disparaba, así que _processSBQueue() nunca se llamaba
// para procesar writes pendientes. La app se quedaba "pegada" con todos los writes
// encolados pero nunca enviados.
// AHORA: Si navigator.onLine es true al arrancar, marcamos _sbConnected=true Y
// disparamos _processSBQueue() inmediatamente.
let _sbConnected = navigator.onLine;
let _sbConnectedBooted = false;
// v65: aquí había un listener db.ref('.info/connected').on(…) que pretendía
// mantener _sbConnected. Nunca disparó —el .on() del stub no invoca el callback—,
// así que su asignación de _sbConnected no llegó a ejecutarse jamás. Quien
// mantiene ese flag de verdad es la inicialización con navigator.onLine de aquí
// arriba, más los listeners de 'online'/'offline' de aquí abajo, que sí existen.
// ── v29: Boot _sbConnected if online at startup ──
// Since db is a mock, the .info/connected listener never fires.
// We need to kick-start the write queue ourselves.
if (navigator.onLine && !_sbConnectedBooted) {
  _sbConnectedBooted = true;
  _sbConnected = true;
  setTimeout(() => {
    _ensurePendingValesEnqueued();
    _processSBQueue();
    _updateSyncIndicator();
  }, 200);
}
window.addEventListener('online', () => {
  if (_sbConnected) return;
  _sbConnected = true;
  _sbConnectedBooted = true;
  setTimeout(() => { _ensurePendingValesEnqueued(); _processSBQueue(); }, 100);
  _updateSyncIndicator();
});
window.addEventListener('offline', () => { _sbConnected = false; _sbConnectedBooted = false; _updateSyncIndicator(); });

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
let _showAgotados = false;       // v35: Toggle to show out-of-stock products (default: hidden)
let _adminShowAgotados = false;  // v35: Same for admin catalog
let _adminCatalogSyncing = false;
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
let _productosMap = null;
let _gestoresMap = null;
let _mensajerosMap = null;
function _getProductosMap() {
  if (!_productosMap || _productosDirty) {
    _productosMap = new Map();
    getProductos().forEach(p => _productosMap.set(p.id, p));
  }
  return _productosMap;
}
function _getGestoresMap() {
  if (!_gestoresMap || _gestoresDirty) {
    _gestoresMap = new Map();
    getGestores().forEach(g => _gestoresMap.set(g.id, g));
  }
  return _gestoresMap;
}
function _getMensajerosMap() {
  if (!_mensajerosMap || _mensajerosDirty) {
    _mensajerosMap = new Map();
    getMensajeros().forEach(m => _mensajerosMap.set(m.id, m));
  }
  return _mensajerosMap;
}
// ── v107: la tienda como "gestor" para los vales que hace el admin ──────────
// El modal de vale del admin ofrece "👤 Admin" con el valor 0, y el vale se
// guardaba con gestorId: 0. Pero ningún gestor tiene el id 0, así que
// gestorOf(0) devolvía undefined y —lo importante— la bandeja, que recorre la
// lista de gestores para agrupar los vales, no tenía dónde ponerlo: el vale se
// creaba, decía "generado ✓" y desaparecía. Eso era el "no funciona".
//
// Con esta ficha de mentira el vale tiene a quién pertenecer y todas las
// pantallas lo pintan bien sin tocarlas una por una. No entra en getGestores(),
// así que no aparece en el ranking, ni en el panel de comisiones, ni se le
// puede poner contraseña: es solo un nombre para los vales de la propia tienda.
const GESTOR_TIENDA = { id: 0, name: 'Tienda (admin)', initials: '🏪', color: '#64748b', _tienda: true };
const esValeDeLaTienda = v => !!v && (v.gestorId === 0 || v.gestorId === '0');
const gestorOf    = id => (id === 0 || id === '0') ? GESTOR_TIENDA : _getGestoresMap().get(id);
const mensajeroOf = id => _getMensajerosMap().get(id);
const productoOf  = id => _getProductosMap().get(id);
const todayStr    = () => new Date().toDateString();

// ══════════════════════════════════════════
//  ESTADOS DEL VALE — una sola tabla
//  v114: esta tabla estaba copiada en tres sitios (bandeja, detalle e
//  historial) y ninguna de las tres tenía los mismos estados: a la bandeja le
//  faltaba 'confirmed', al detalle 'delivered' y al historial 'cancelled' y
//  los iconos. El resultado era que un vale confirmado salía en la bandeja
//  con la palabra "confirmed" en inglés y sin color.
//  El icono es lo que pidió el dueño: ver de un vistazo qué vale ya salió con
//  el mensajero (🛵) sin tener que leer estado por estado.
// ══════════════════════════════════════════
const VALE_ESTADOS = {
  pending:         { label:'Pendiente',     cls:'sp-pending',         icon:'🔵' },
  assigned:        { label:'Con mensajero', cls:'sp-assigned',        icon:'🛵' },
  delivered:       { label:'Entregado',     cls:'sp-delivered',       icon:'📦' },
  confirmed:       { label:'Confirmado',    cls:'sp-confirmed',       icon:'✅' },
  pending_payment: { label:'Pend. cobro',   cls:'sp-pending_payment', icon:'⏳' },
  cancelled:       { label:'Cancelado',     cls:'sp-cancelled',       icon:'🚫' },
};
// Nunca devuelve undefined: si llega un estado que no conocemos se pinta tal
// cual en vez de dejar la chapa en blanco.
function estadoVale(v) {
  const st = (v && v.status) || 'pending';
  return VALE_ESTADOS[st] || { label: st, cls: '', icon: '•' };
}

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
// ── v119: el día en el que una venta CUENTA ────────────────────────────────
// No es el día en que se mandó el vale, es el día en que entró el dinero. Un
// vale mandado el 26 y confirmado el 27 es dinero del 27: si se agrupa por la
// fecha de envío, al cerrar el día 27 ese importe no aparece por ningún lado
// —está archivado en el 26, un día que el admin ya dio por cerrado— y el corte
// de Dueños de ese día sale corto sin que nada avise.
//
// El sello de envío (v.ts) NO se toca: es cuándo se hizo la venta, hace falta
// para el historial del gestor y para saber cuánto se tarda en cerrar. Lo que
// cambia es por cuál se AGRUPA en los paneles que hablan de dinero.
//
// Orden: confirmada manda; si solo está entregada, la fecha de entrega (que es
// desde cuando el gestor gana su comisión); y si no hay ninguna, la de envío.
function _fechaEfectiva(v) {
  if (!v) return '';
  const d = localDay(v.confirmedTs || v.deliveredTs || v.ts);
  return d || localDay(v.ts);   // un sello corrupto no puede sacar el vale del historial
}
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
// v84: lo que cuenta el círculo rojo del encabezado. Antes usaba pendingCount(),
// que cuenta TODOS los vales en estado 'pendiente' aunque el admin ya los
// hubiera abierto: el número no bajaba nunca hasta confirmar o borrar el vale,
// así que dejaba de avisar de nada y solo molestaba.
// Ahora cuenta los que aún no se han visto. selectVale() marca seenByAdmin al
// abrir un vale, así que el número baja solo a medida que se revisan.
const sinVerCount = () => getVales().filter(v => v.status === 'pending' && !v.seenByAdmin).length;
const pendingOf   = gId=> getVales().filter(v=>v.gestorId===gId&&v.status==='pending').length;
const todayValesOf= gId=> getVales().filter(v=>v.gestorId===gId&&new Date(v.ts).toDateString()===todayStr());



// v31: Track the path currently being written, so _doRestPoll can avoid
// overwriting data for that path with stale Supabase reads.
let _currentWritePath = null;

// ══════════════════════════════════════════
//  SUPABASE WRITE QUEUE — prevents data loss with persistence + retries
// ══════════════════════════════════════════
const _sbWriteQueue = [];
let _sbProcessing = false;
const _FAILED_WRITES_LIMIT = 100;
// ── In-Flight Merge Buffer (v13) ──
// Cuando un write a Supabase está EN PROCESO (op in flight), no está en
// _sbWriteQueue — fue shift()ado. Si llega otro saveVales con más vales
// mientras tanto, ANTES se creaba un segundo item encolado. Eso causaba:
//   - Si el primer write tarda 8s (timeout), el segundo espera 8s+ para empezar.
//   - Si el gestor manda 5 vales en 5s, se acumulan 5 items encolados, cada uno
//     con su versión parcial del estado, todos esperando al primero.
// Ahora: si el path que llega coincide con el path que está EN PROCESO,
// fusionamos el nuevo value en _sbInFlightPending[path]. Cuando el write
// actual termina (éxito, fallo, o timeout), el buffer se encola
// automáticamente como un NUEVO write, y se procesa después.
// Resultado: como máximo 1 write encolado esperando, sin importar cuántos
// saveVales se llamen durante el procesamiento.
const _sbInFlightPending = {};  // { path: { value, method } }

// Persist queue to localStorage so it survives reloads / tab closes
function _persistQueue() {
  try {
    // Only persist non-callback items (callbacks are not serializable)
    const serializable = _sbWriteQueue.map(({path, value, method, retries}) => ({path, value, method, retries}));
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
// y un techo de 20 KB/s (no tiene sentido asumir más para Supabase REST).
const _sbEncoder = (typeof TextEncoder !== 'undefined') ? new TextEncoder() : null;
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
    if (_sbEncoder) return _sbEncoder.encode(s).length;
    return s.length; // fallback para navegadores viejos
  } catch(_) { return 0; }
}

function _processSBQueue() {
  // v14: Si Supabase NO está conectado (_sbConnected === false), NO intentar
  // hacer el write. En redes muy malas, la conexión a la conexión a Supabase puede tardar
  // 5-10s en establecerse, y cada write intentado fallaría tras el timeout
  // de 8s. En su lugar, dejamos los items en la cola y esperamos a que el
  // listener de .info/connected dispare _processSBQueue() cuando vuelva la
  // conexión. El indicador muestra "Sin conexión a la nube" para que el
  // usuario sepa que sus vales están guardados localmente.
  if (_sbProcessing || _sbWriteQueue.length === 0) {
    _updateSyncIndicator();
    return;
  }
  if (!_sbConnected) {
    // Supabase desconectado — NO intentar writes. Los items se quedan en
    // la cola (persistida en localStorage). El listener de .info/connected
    // llamará a _processSBQueue() cuando se reconecte.
    _updateSyncIndicator();
    return;
  }
  _sbProcessing = true;
  _updateSyncIndicator();
  const item = _sbWriteQueue.shift();
  _currentWritePath = item.path;  // v31: track in-flight path for _doRestPoll guard
  item.retries = (item.retries || 0) + 1;
  const {path, method, callback} = item;
  let value = item.value;  // v15: mutable, podemos filtrarle vales ya synced

  // ── v54 BUGFIX: REMOVER el filtro de vales synced en reintentos ──
  // ANTES (v15/v45): en los reintentos de writes a 'vales', se filtraban los
  // vales con synced===true. La idea era evitar re-sincronizar vales que ya
  // estaban en Supabase. PERO synced===true solo significa "este vale se
  // escribió a Supabase en ALGÚN momento", NO significa "este update en
  // particular es innecesario". El admin cambia status de 'pending' a
  // 'confirmed' → el vale SIGUE teniendo synced=true → el retry FILTRA el
  // update → la confirmación del admin se PIERDE para siempre en Supabase.
  // Esto causaba que los vales se quedaran eternamente en 'pending' en
  // Supabase aunque el admin los hubiera confirmado localmente.
  // AHORA (v54): no filtramos. El retry manda el update completo. Si hay
  // duplicación (el write anterior sí llegó pero el ack se perdió), el
  // upsert es idempotente (mismos datos → mismo resultado).
  // (Bloque eliminado intencionalmente — ver git history de v53 para contexto.)

  // ── Inicializar buffer in-flight para este path ──
  // Si durante el procesamiento de este write llegan más saveVales al mismo
  // path, se acumularán en _sbInFlightPending[path]. Al terminar, los
  // flushearemos como un nuevo write.
  if (callback == null && (method === 'set' || method === 'update')) {
    _sbInFlightPending[path] = { value: method === 'update' ? {} : null, method };
  }
  // ── TRADUCIR A SUPABASE REST ──
  // db.ref() es un mock que no conecta a nada. Aquí traducimos la operación
  // a llamadas reales de Supabase REST.
  // ⚠️ Un documento que se baja (_SB_SINGLETON_ROWS / _SB_SINGLETON_ADMIN) TIENE
  // que estar también aquí, o la subida no encuentra su sitio: al no reconocer
  // el nombre, más abajo se toma por una colección y se intenta escribir en una
  // tabla con ese nombre que no existe. No da error visible —el documento es un
  // objeto, sus claves no son ids numéricos y el lote sale vacío— así que se
  // guarda bien en el teléfono y no llega nunca a la nube. Le pasó a `duenos`
  // (v117): se veían en el teléfono del admin y no aparecían en ningún otro.
  const _FS_SINGLETON_DOCS = {
    config: 'config', notifs: 'notifs', estafa: 'estafa', ranking_summary: 'ranking_summary',
    reservas: 'reservas', tasa: 'tasa', costos: 'costos',  // v114
    duenos: 'duenos',                                      // v119 — ver aviso de arriba
    vales_borrados: 'vales_borrados'                       // v119 — lápidas de borrado
  };
  function _supabaseOpFor(path, value, method) {
    // Singleton → meta/{name}
    if (_FS_SINGLETON_DOCS[path]) {
      const name = _FS_SINGLETON_DOCS[path];
      if (method === 'remove') return _sbRestMetaDelete(name);
      // v99: 'update' = tocar unas claves, no reemplazar el documento. Antes
      // aquí se ignoraba el método y todo acababa en upsert, así que un
      // {nextValeNum: N} borraba el resto del config. Ver _sbRestMetaMerge.
      if (method === 'update') return _sbRestMetaMerge(name, value);
      return _sbRestMetaUpsert(name, value);
    }
    // Backups → tabla backups
    if (path.startsWith('backups/')) {
      const key = path.split('/').slice(1).join('/');
      if (!key) return Promise.resolve();
      if (method === 'remove') {
        const url = `${_SB_REST}/backups?name=eq.${encodeURIComponent(key)}`;
        return fetch(url, { method: 'DELETE', headers: _SB_AUTH_HDRS }).then(r => { if(!r.ok&&r.status!==404) throw new Error(`DELETE backups/${key} ${r.status}`); });
      }
      return _sbRestMetaUpsert ? _sbRestMetaUpsert('backups', value) : Promise.resolve();
    }
    // v96: "quita 2" en vez de "queda en 8". Ver _sbRestAplicarDeltas.
    if (method === 'delta') return _sbRestAplicarDeltas(value);
    // Colecciones (gestores, mensajeros, productos, categorias, vales)
    const collName = path.split('/')[0];
    if (method === 'remove') {
      const docId = path.includes('/') ? path.split('/').pop() : null;
      if (!docId) {
        // v30 FIX: No docId means "delete ALL rows in this collection"
        // ANTES: return Promise.resolve() — era un no-op, así los "borrar todos los vales"
        // nunca se borraban de Supabase y volvían al actualizar.
        return _sbRestDeleteAll(collName);
      }
      return _sbRestDelete(collName, docId);
    }
    if (Array.isArray(value)) {
      const items = [];
      value.forEach(item => { if (item && item.id != null) items.push({ id: Number(item.id), value: item }); });
      return _sbRestUpsertBatch(collName, items);
    }
    if (value && typeof value === 'object') {
      const upsertItems = [];
      const deleteIds = [];
      const deleteValeOps = []; // v30: for vales with nested keys (gestorId/valeId)
      // v30: Detect gestorId from path like "vales/1781761257105" for gestor writes
      const pathGestorId = (collName === 'vales' && path.includes('/')) ? Number(path.split('/')[1]) : null;
      Object.entries(value).forEach(([key, val]) => {
        if (val === null) {
          // v30 FIX: For vales table with nested keys like "gestorId/valeId",
          // _sbRestDeleteBatch(vales, [valeId]) fails because OLD-format rows
          // use id=gestorId, not id=valeId. Use _sbRestDeleteVale instead.
          if (collName === 'vales' && key.includes('/')) {
            const parts = key.split('/');
            const gestorId = Number(parts[0]);
            const valeId = Number(parts[1]);
            if (!isNaN(gestorId) && !isNaN(valeId)) {
              deleteValeOps.push(_sbRestDeleteVale(valeId, gestorId));
              return;
            }
          }
          // v30 FIX: Also handle gestor writes where path is "vales/gestorId"
          // and key is just "valeId" (no slash). OLD-format row has id=gestorId.
          if (collName === 'vales' && !key.includes('/') && !isNaN(pathGestorId)) {
            const valeId = Number(key);
            if (!isNaN(valeId)) {
              deleteValeOps.push(_sbRestDeleteVale(valeId, pathGestorId));
              return;
            }
          }
          const docId = key.includes('/') ? key.split('/').pop() : key;
          if (!isNaN(Number(docId))) deleteIds.push(Number(docId));
          return;
        }
        const idNum = (val && typeof val === 'object' && val.id != null) ? Number(val.id) : Number(key.includes('/') ? key.split('/').pop() : key);
        if (!isNaN(idNum)) upsertItems.push({ id: idNum, value: val });
      });
      const ops = [];
      // v54: Si es un write del GESTOR (path = 'vales/{gestorId}'), usar
      // merge server-side (RPC) o read-merge-write (fallback JS) para
      // preservar los campos del admin. NUNCA usar _sbRestUpsertBatch
      // directo para gestor writes — eso pisaba los cambios del admin.
      const isGestorValesWrite = (collName === 'vales' && pathGestorId !== null);
      if (upsertItems.length > 0) {
        if (isGestorValesWrite) {
          // Detectar RPC si aún no sabemos, y luego elegir path
          ops.push(Promise.resolve(_sbGestorRpcAvailable).then(avail => {
            if (avail === null) return _detectGestorRpc();
            return avail;
          }).then(available => {
            if (available) {
              // RPC disponible → merge server-side (óptimo)
              return _sbRestUpsertValeFromGestorBatch(upsertItems);
            } else {
              // RPC no disponible → read-merge-write en JS (fallback)
              return _sbRestUpsertValeFromGestorFallbackBatch(upsertItems);
            }
          }));
        } else {
          // Admin write o escritura de otra colección → upsert normal
          ops.push(_sbRestUpsertBatch(collName, upsertItems));
        }
      }
      if (deleteIds.length > 0) ops.push(_sbRestDeleteBatch(collName, deleteIds));
      if (deleteValeOps.length > 0) ops.push(...deleteValeOps);
      if (ops.length === 0) return Promise.resolve();
      return Promise.all(ops).then(() => {});
    }
    return Promise.resolve();
  }
  let op;
  try {
    op = _supabaseOpFor(path, value, method);
  } catch(syncErr) {
    console.error('[supabase] error síncrono armando el write:', syncErr);
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
    const pending = _sbInFlightPending[path];
    delete _sbInFlightPending[path];
    if (!pending) return;
    if (pending.method === 'update' && pending.value && typeof pending.value === 'object' && Object.keys(pending.value).length > 0) {
      _sbWriteQueue.push({path, value: pending.value, method: 'update', callback: null, retries: 0});
    } else if (pending.method === 'set' && pending.value !== null) {
      _sbWriteQueue.push({path, value: pending.value, method: 'set', callback: null, retries: 0});
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
  // Fórmula v17: timeout = (payloadBytes / effectiveBps) * 1.3 + 3000ms (RTT WS)
  // Cap máximo: 90s (antes 45s) para writes grandes en redes muy malas.
  // Cap mínimo: 8s para writes pequeños (evita falsos timeout en redes con
  // alta latencia inicial).
  const payloadBytes = _payloadBytes(value);
  const effectiveBps = _estimateEffectiveThroughputBytesPerSec();
  // ×1.3 safety margin para overhead real (frames WS, JSON parsing, ack)
  const estimatedMs = Math.ceil((payloadBytes / effectiveBps) * 1000 * 1.3) + 3000;
  const adaptiveTimeout = Math.min(90000, Math.max(8000, estimatedMs));
  _currentWriteTimeout = adaptiveTimeout;  // exponer para el indicador de sync
  const timeoutId = setTimeout(() => {
    if (settled) return;
    settled = true;
    console.warn(`Supabase write TIMEOUT (${adaptiveTimeout}ms, payload=${payloadBytes}B, est=${effectiveBps}B/s):`, path);
    // Flush del buffer in-flight ANTES de reencolar el item.
    // Si el gestor mandó 5 vales mientras este write estaba colgado, esos 5
    // vales están en _sbInFlightPending[path] y deben encolarse como un nuevo
    // write, no perderse.
    _flushInFlight();
    if (item.retries < 4) {
      requeued = true;
      _sbWriteQueue.unshift(item);
      _persistQueue();
      // v17: Backoff exponencial con jitter para evitar thundering herd.
      // Si varios gestores están reintentando a la vez sobre el mismo enlace
      // saturado, backoffs sin jitter se sincronizan y empeoran la congestión.
      const base = Math.min(1000 * Math.pow(2, item.retries), 30000);
      const jitter = Math.random() * 500;
      const delay = base + jitter;
      setTimeout(() => { _sbProcessing = false; _currentWritePath = null; _processSBQueue(); }, delay);
    } else {
      // Demasiados reintentos — descartar y seguir con el siguiente.
      _sbProcessing = false;
      _currentWritePath = null;  // v31: clear in-flight path
      _persistQueue();
      _processSBQueue();
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
      // Marcar vales como synced cuando su write a Supabase se confirma.
      // Esto funciona incluso tras recargar la página porque el `value` del
      // item encolado sí es serializable y se persiste en axon_pending_writes.
      _markValesSyncedFromUpdate(path, value);
      // Flush del buffer in-flight: si llegaron más cambios al mismo path
      // durante este write, encolarlos ahora.
      _flushInFlight();
      // Actualizar el indicador con timestamp de última sync exitosa.
      _markSyncSuccess();
      // Liberar el candado y procesar el siguiente item de la cola.
      _sbProcessing = false;
      _currentWritePath = null;  // v31: clear in-flight path
      _persistQueue();
      _processSBQueue();
    })
    .catch(e => {
      if (settled) return;  // el timeout o el .then ya manejaron este item
      settled = true;
      clearTimeout(timeoutId);
      console.error("Supabase write error:", e);
      // Flush del buffer in-flight antes de reencolar (igual que en timeout).
      _flushInFlight();
      if (item.retries < 4) {
        // Reencolar YA (no en el setTimeout) para que sobreviva a un cierre
        // de la app durante el backoff. Antes el item se perdía porque el
        // finally persistía la cola sin él.
        requeued = true;
        _sbWriteQueue.unshift(item);
        _persistQueue();
        // v17: backoff exponencial con jitter (igual que en timeout).
        // Antes Math.pow(1.5, retries) era demasiado corto en redes lentas y
        // sin jitter → si varios gestores reintentaban a la vez, saturaban.
        const base = Math.min(1000 * Math.pow(2, item.retries), 30000);
        const jitter = Math.random() * 500;
        const delay = base + jitter;
        setTimeout(() => { _sbProcessing = false; _currentWritePath = null; _processSBQueue(); }, delay);
        return;
      }
      console.error("Supabase write permanently failed:", path);
      try {
        const failed = JSON.parse(localStorage.getItem('axon_failed_writes') || '[]');
        failed.push({path, value, method, ts: new Date().toISOString()});
        if (failed.length > _FAILED_WRITES_LIMIT) failed.splice(0, failed.length - _FAILED_WRITES_LIMIT);
        localStorage.setItem('axon_failed_writes', JSON.stringify(failed));
      } catch(e2) {}
      _sbProcessing = false;
      _currentWritePath = null;  // v31: clear in-flight path
      _persistQueue();
      _processSBQueue();
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
      _sbProcessing = false;
      _persistQueue();
      _processSBQueue();
    });
}

// ══════════════════════════════════════════════════════════════════
//  ENQUEUE WITH MERGE (queue + in-flight)
// ══════════════════════════════════════════════════════════════════
// (El buffer _sbInFlightPending se declara arriba, junto con _sbWriteQueue.)
function _enqueueSB(path, value, method='set', callback=null) {
  // ── Batching para conexiones lentas ──
  // Antes: cada saveVales() encolaba un item separado. Si un gestor enviaba
  // 3 vales seguidos + editaba 1, habían 4 items encolados sobre paths
  // relacionados, cada uno → 1 HTTP request. En 3G cada write = 800ms–2s.
  // Ahora: si hay items pendientes al MISMO path (o path padre del mismo
  // método 'set'/'update'), los fusionamos. Solo importa el ÚLTIMO valor.
  // Caso típico: saveVales() del gestor encola 'update' en 'vales/{gestorId}'.
  // Si llegan 3 saveVales seguidos, los 3 updates se fusionan en 1 solo.
  if (callback === null) {
    // Solo fusionar items sin callback (los callbacks no son serializables
    // y normalmente corresponden a operaciones críticas que no se fusionan).
    const methodIsMergeable = (method === 'set' || method === 'update');
    if (methodIsMergeable) {
      // ── NUEVO v13: fusionar también con el buffer in-flight ──
      // Si hay un write EN PROCESO para el mismo path+method, meter el nuevo
      // value en el buffer. Se encolará cuando el write actual termine.
      // Así evitamos acumular items encolados mientras el primero tarda 8s.
      if (_sbProcessing && _sbInFlightPending[path] &&
          _sbInFlightPending[path].method === method) {
        if (method === 'update' && _sbInFlightPending[path].value &&
            typeof _sbInFlightPending[path].value === 'object' &&
            value && typeof value === 'object') {
          Object.assign(_sbInFlightPending[path].value, value);
        } else {
          _sbInFlightPending[path].value = value;
        }
        _updateSyncIndicator();
        return; // Ya está agendado para enviarse cuando termine el write actual.
      }
      // Buscar items pendientes con el mismo path y mismo método → reemplazar.
      // También fusionar: si llega 'set' para 'vales' y hay 'update' pendiente
      // para 'vales/X', el 'set' los sobreescribe a todos.
      for (let i = _sbWriteQueue.length - 1; i >= 0; i--) {
        const existing = _sbWriteQueue[i];
        if (existing.path === path && (existing.method === method)) {
          // Mismo path, mismo método → fusionar valores (para 'update') o reemplazar (para 'set').
          if (method === 'update' && existing.value && typeof existing.value === 'object' && value && typeof value === 'object') {
            // Merge profundo de claves: el nuevo value gana sobre el existente.
            Object.assign(existing.value, value);
          } else {
            // 'set' o 'update' con value no-objeto: reemplazar el valor anterior.
            existing.value = value;
          }
          _persistQueue();
          _processSBQueue();
          return; // No agregar nuevo item.
        }
        // Caso: nuevo 'set' a un path padre invalida 'update'/'set' pendientes a subpaths.
        // Ej: nuevo set('vales', fullObj) invalida update('vales/gestorId', {...}) pendiente.
        // (Solo aplicable a 'set' — el set reemplaza todo el subtree.)
        if (method === 'set' && (existing.path === path + '/' || existing.path.startsWith(path + '/'))) {
          _sbWriteQueue.splice(i, 1);
        }
      }
    }
  }
  _sbWriteQueue.push({path, value, method, callback});
  _persistQueue();
  _processSBQueue();
}

// ── v17: Chunking automático para writes grandes ──
// En redes de 10 Kbit/s (~1.2 KB/s), un write de 30 KB (25 vales batched)
// tarda 25s en subir. Si la conexión se cae a mitad, TODO el batch se
// reintenta desde cero. Partir en chunks de ~6 KB permite que cada chunk
// se complete en ~5s y si uno falla, solo se reintenta ese, no todo el lote.
// Solo aplica a method 'update' (que es multi-clave por naturaleza).
function _enqueueSBChunked(path, updates, method='update') {
  if (method !== 'update' || !updates || typeof updates !== 'object') {
    // No es actualizable por chunks → pasar directo
    return _enqueueSB(path, updates, method);
  }
  const keys = Object.keys(updates);
  if (keys.length === 0) return;

  // Calcular tamaño total del payload
  let totalBytes;
  try { totalBytes = _payloadBytes(updates); } catch(_) { totalBytes = 0; }

  // Si el payload total es pequeño (≤ 6 KB), no partir
  const MAX_CHUNK_BYTES = 6000;
  if (totalBytes <= MAX_CHUNK_BYTES) {
    return _enqueueSB(path, updates, method);
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
  chunks.forEach(chunk => _enqueueSB(path, chunk, method));
}

// ══════════════════════════════════════════
//  SYNCED TRACKING — marca vales como realmente subidos a Supabase
// ══════════════════════════════════════════
// Cuando un gestor envía un vale en condiciones de red mala, el vale se guarda
// localmente con synced:false y se encola el write. Si la app se cierra antes
// de que el write se confirme, el vale queda "huérfano": el gestor lo ve como
// enviado pero el admin nunca lo recibe. Esta función se llama desde el .then()
// de _processSBQueue cuando el write se confirma, y marca los vales afectados
// como synced:true en localStorage (sin re-encolar otro write a Supabase).
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
  // Actualizar el cache local SIN encolar otro write a Supabase.
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
    pending.forEach(item => _sbWriteQueue.push(item));
    // Clear persisted copy; will be re-persisted as queue processes
    localStorage.removeItem('axon_pending_writes');
    // Defer first attempt to give Supabase time to init
    setTimeout(_processSBQueue, 1500);
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
  const pendingCount = _sbWriteQueue.length;
  if (!_onlineStatus) {
    ind.className = 'offline';
    lbl.textContent = 'Sin conexión';
    ind.title = _lastSyncAtStr ? `Última sync: ${_lastSyncAtStr}` : 'Sin sincronización aún';
  } else if (!_sbConnected) {
    // v14: Navegador tiene internet, pero Supabase REST NO conectó.
    // Esto pasa en redes muy malas (50Kbit/s con alta pérdida de paquetes).
    // Mostrar "Nube no disponible" en vez de "Sincronizando" para que el
    // usuario sepa que NO hay que esperar — los vales se guardarán localmente.
    ind.className = 'pending';
    lbl.textContent = pendingCount > 0 ? `Guardado local (${pendingCount})` : 'Nube no disponible';
    ind.title = pendingCount > 0
      ? `${pendingCount} vale(s) guardado(s) localmente.\nSupabase no responde — se enviarán automáticamente cuando mejore la conexión.`
      : 'Supabase no responde. Los vales se guardarán localmente y se enviarán cuando mejore la conexión.';
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
    const stalled = _sbProcessing && (Date.now() - _lastSyncAt > stalledThreshold);
    lbl.textContent = stalled ? 'Guardando… (red lenta)' : `Sincronizando (${pendingCount})`;
    ind.title = `${pendingCount} cambio(s) pendiente(s) de subir.\n` +
                (_lastSyncAtStr ? `Última sync exitosa: ${_lastSyncAtStr}` : 'Aún no se ha sincronizado nada.') +
                (stalled ? '\n⚠️ La red está lenta — tus datos están guardados localmente.' : '');
  } else {
    ind.className = 'online';
    lbl.textContent = 'En línea';
    // Solo actualizar _lastSyncAt si no estaba ya en 0 (evita marcar "synced" al cargar).
    // Realmente hay sync exitosa cuando se confirma un write en _processSBQueue.then().
    if (_lastSyncAt > 0) {
      const ago = _formatAgo(_lastSyncAt);
      ind.title = `✓ Sincronizado${ago ? ` (hace ${ago})` : ''}`;
    } else {
      ind.title = 'En línea — esperando primer cambio';
    }
  }
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
// Llamada cuando un write a Supabase se confirma exitosamente.
function _markSyncSuccess() {
  _lastSyncAt = Date.now();
  _lastSyncAtStr = new Date().toLocaleTimeString('es-ES', {hour:'2-digit', minute:'2-digit', second:'2-digit'});
  _updateSyncIndicator();
}
// Refrescar el tooltip cada 30s para que el "hace Xs" no se quede viejo.
setInterval(() => {
  if (_lastSyncAt > 0 && _sbWriteQueue.length === 0) _updateSyncIndicator();
}, 30000);
window.addEventListener('online', () => {
  _onlineStatus = true;
  _updatePendingSyncBanner();
  // Al volver la conexión, forzar el procesamiento de la cola de writes pendientes.
  // Si hay vales con synced:false que por alguna razón no están encolados (p.ej. el
  // item se descartó tras 5 reintentos), re-encolar un write de vales para ese gestor.
  _ensurePendingValesEnqueued();
  _processSBQueue();
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
  // La tasa se reintenta al volver; actualizarTasaUSD() se frena sola si el
  // dato tiene menos de 3 h, así que esto no dispara peticiones de más.
  if (typeof actualizarTasaUSD === 'function') actualizarTasaUSD(false);
  // Solo actuar si hay trabajo pendiente o Supabase parece desconectado
  if (_sbWriteQueue.length === 0 && _countPendingSyncVales() === 0 && _sbConnected) {
    _updateSyncIndicator();
    return;
  }
  // Verificar si hay vales huérfanos (synced:false no encolados) y procesar cola.
  _ensurePendingValesEnqueued();
  _processSBQueue();
  _updatePendingSyncBanner();
});

// ── v15: page freeze / resume (Page Lifecycle API en Chrome Android) ──
// Cuando el browser backgroundea la pestaña por mucho tiempo y luego la
// restaura, la conexión a la conexión a Supabase puede haberse caído silenciosamente.
// Forzar un re-check al recibir el evento 'resume'.
if (document.addEventListener && 'onresume' in document) {
  document.addEventListener('resume', () => {
    _ensurePendingValesEnqueued();
    _processSBQueue();
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
    if (_sbWriteQueue.length === 0 && _countPendingSyncVales() === 0) {
      // No hay trabajo — apagar el poll
      clearInterval(_pendingPollTimer);
      _pendingPollTimer = null;
      return;
    }
    // Re-encolar vales huérfanos y procesar cola
    _ensurePendingValesEnqueued();
    _processSBQueue();
  };
  _pendingPollTimer = setInterval(tick, 5000);
}

// Si hay vales con synced:false pero NO están encolados en _sbWriteQueue (puede pasar
// si el item se descartó tras 4 reintentos, o si la app se cerró y reabrió sin que
// el write se completara), re-encolar un write para ese gestor.
// ── v15 BUGFIX (re-sync-all bug): ANTES este función solo miraba _sbWriteQueue.
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
  if (!activeGestorId) return;
  const mine = getVales().filter(v => v.gestorId === activeGestorId && v.synced !== true && v.status !== 'cancelled');
  if (mine.length === 0) return;
  const myPath = `vales/${activeGestorId}`;
  // Verificar si ya hay un write de vales/{gestorId} encolado
  const hasValesWriteQueued = _sbWriteQueue.some(item =>
    item.path === myPath ||
    item.path === 'vales'
  );
  if (hasValesWriteQueued) return; // ya hay uno en cola, no duplicar
  // ── v15: También salir si hay un write IN-FLIGHT para este path ──
  // Ese write ya está subiendo los vales pendientes. Si encolamos otro, el
  // in-flight merge lo fusionará al write actual (innecesario) Y al terminar
  // se flushéa como un nuevo write duplicado. Mejor no tocar nada.
  if (_sbProcessing && _sbInFlightPending[myPath]) return;
  if (_sbProcessing && _sbInFlightPending['vales']) return; // admin path (raro en gestor, pero por seguridad)
  // Re-encolar un write con TODOS los vales pendientes de este gestor.
  // v15: usar slimVale-equivalente para no mandar synced/isNew a Supabase.
  // v46 FIX: usar SOLO los campos que pertenecen al gestor (whitelist).
  // ANTES: este re-encolado enviaba status/mensajeroId/confirmedTs/adminNotes
  // desde la copia LOCAL del gestor — si esa copia estaba desactualizada
  // (p.ej. el admin confirmó la venta mientras el gestor estaba offline),
  // reescribía 'pending' por encima del 'confirmed' del admin en Supabase.
  // v53 FIX: igual que slimValeGestor, ahora PRESERVAMOS los campos del admin
  // desde la caché local. La razón es la misma: si no los incluimos, el upsert
  // de Supabase REEMPLAZA toda la columna `data` y se borran los campos que
  // el admin ya había puesto (status, seenByAdmin, etc.). Como estos vales
  // tienen synced=false, su caché local puede estar desactualizada, pero es
  // mejor escribir el valor viejo que borrar el campo entero.
  const GESTOR_REENQUEUE_FIELDS = [
    'id','valeNum','gestorId','ts','cliente','telefono','direccion',
    'carnet','mensajeria','articulo','precioUSD','precioMN','vuelto',
    'total','garantia','comisionGestor','recogidaTienda','ubicacion',
    'horaEntrega'   // v104
  ];
  const REENQUEUE_ADMIN_PRESERVE = [
    'status','mensajeroId','assignedTs','confirmedTs','adminNotes',
    'seenByAdmin','seenTs','commissionStatus','commissionPaid',
    'stockDecremented','hiddenFromHistory','hiddenTs'
  ];
  const updates = {};
  mine.forEach(v => {
    const slim = {};
    GESTOR_REENQUEUE_FIELDS.forEach(f => { if (v[f] !== undefined) slim[f] = v[f]; });
    slim.valeProductos = (v.valeProductos || []).map(p => ({ id: p.id, qty: p.qty }));
    if (v.valeText) slim.valeText = v.valeText; // preservar si existe (vales viejos)
    if (v.deliveredTs) slim.deliveredTs = v.deliveredTs; // mensajero puede marcar entrega
    // v54: NUNCA incluir campos del admin en el re-encolado del gestor.
    // Tanto el RPC como el fallback JS (read-merge-write) los preservan.
    // (Bloque v53 que incluía REENQUEUE_ADMIN_PRESERVE fue removido en v54.)
    // Para vales que aún no se han syncado, asegurar status inicial
    if (!slim.status) slim.status = v.status || 'pending';
    updates[v.id] = slim;
  });
  _enqueueSB(myPath, updates, 'update');
  console.log(`[sync] Re-encolados ${mine.length} vales pendientes para gestor ${activeGestorId}`);
}

const setSB = (path, v) => {
  _enqueueSB(path, v, 'set');
};

// ═══ In-memory cache layer ═══
let _gestoresCache = null, _gestoresDirty = true;
let _valesCache = null, _valesDirty = true;
// v58: último slim de cada vale TAL Y COMO SE ENVIÓ a Supabase, serializado y
// por clave `gestorId/valeId`. saveVales lo usa para decidir qué ha cambiado
// de verdad. Tiene que ser texto y no referencias a los objetos del caché:
// patchVale y compañía mutan los vales DENTRO del array de _valesCache, así que
// comparar contra ese array era comparar el vale consigo mismo y el diff salía
// siempre vacío (ver el FIX detallado en saveVales).
// Arranca vacío en cada carga, así que el primer guardado de la sesión reenvía
// los vales una vez. Es idempotente —el upsert deja el mismo resultado— y de
// paso repara en Supabase los que se hubieran quedado con el estado viejo.
const _valesPrevSlimJson = new Map();
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

const getGestores   = () => { if (_gestoresDirty || !_gestoresCache) { try { _gestoresCache = JSON.parse(localStorage.getItem('axon_gestores') || '[]'); } catch(e) { _gestoresCache = []; } _gestoresDirty = false; } return _gestoresCache; };
// ⚠️ saveGestores SUBE LA LISTA ENTERA. Solo para reemplazarlo todo (importar,
// restaurar, cargar demo). Para tocar uno o dos usa guardarGestores(lista, ids).
const saveGestores  = v  => { _safeSetLS('axon_gestores', JSON.stringify(v)); _gestoresCache = v; _gestoresDirty = false; _gestoresMap = null; if (!isSyncingFromSupabase()) setSB('gestores', v); _logAudit('gestores_update'); };

// ── v96: guardar SOLO los gestores que cambian ──────────────────────────────
// Mismo fallo que costó el inventario el 16/08, esperando su turno en otra
// tabla. La foto y la clave las cambia el gestor DESDE SU PROPIO TELÉFONO, y
// ese teléfono refresca la lista de gestores cada 5 minutos (nunca en segundo
// plano). Al subirla entera devolvía a la nube su copia vieja: una clave que el
// admin acababa de resetear volvía a la anterior, y un gestor recién dado de
// alta desaparecía. Nadie lo habría relacionado con "me cambié la foto".
// Ahora cada cambio manda solo las filas tocadas; un id ausente de la lista
// viaja como null y eso borra la fila de verdad.
function _guardarFilas(clave, nodo, lista, ids, setCache) {
  _safeSetLS(clave, JSON.stringify(lista));
  setCache(lista);
  if (!isSyncingFromSupabase()) {
    const porId = new Map();
    (lista || []).forEach(x => { if (x && x.id != null) porId.set(String(x.id), x); });
    const cambios = {};
    (ids || []).forEach(id => {
      if (id == null) return;
      const k = String(id);
      cambios[k] = porId.has(k) ? porId.get(k) : null;   // null = borrar la fila
    });
    if (Object.keys(cambios).length) _enqueueSB(nodo, cambios, 'update');
  }
}
// ⚠️ v114 — _gestoresMap = null es OBLIGATORIO, igual que en saveProductos.
// gestorOf() no lee la lista: lee un índice aparte (_gestoresMap) que solo se
// reconstruye cuando _gestoresDirty está en true. Y todos los guardados lo
// dejan en FALSE, porque el dato que acaban de escribir es el bueno. Resultado:
// después de tocar un gestor —su foto, su clave, sus puntos— gestorOf() seguía
// devolviendo la ficha ANTERIOR en ese mismo teléfono hasta la siguiente
// bajada de Supabase. Es el mismo despiste que ya se cazó con los productos en
// v95, esperando su turno en otra tabla.
function guardarGestores(lista, ids) {
  _guardarFilas('axon_gestores', 'gestores', lista, ids, l => { _gestoresCache = l; _gestoresDirty = false; _gestoresMap = null; });
  _logAudit('gestores_update');
}
function guardarMensajeros(lista, ids) {
  _guardarFilas('axon_mensajeros', 'mensajeros', lista, ids, l => { _mensajerosCache = l; _mensajerosDirty = false; _mensajerosMap = null; });
}

const getVales      = () => { if (_valesDirty || !_valesCache) { try { _valesCache = JSON.parse(localStorage.getItem('axon_vales') || '[]'); } catch(e) { _valesCache = []; } _valesDirty = false; /* v41: deduplicate on read */ if(Array.isArray(_valesCache)&&_valesCache.length>1){const s=new Set();_valesCache=_valesCache.filter(v=>{if(!v||v.id==null)return false;const k=String(v.id);if(s.has(k))return false;s.add(k);return true;});} } return _valesCache; };
// Vales are synced via saveVales → _enqueueSB('vales', updates, 'update') through the write queue.
// Individual fbUpdateVale was removed from patchVale to prevent race conditions.
// fbAddVale/fbRemoveVale are NO LONGER called by sendVale/cancelVale/adminDeleteVale
// because saveVales already enqueues the write on the vales node.
//
// IMPORTANTE — por qué 'update' y no 'set':
// saveVales() se llama con la copia LOCAL EN MEMORIA de todos los vales (admin) o de
// los propios (gestor). Esa copia puede estar desactualizada si otro dispositivo
// (un gestor enviando un vale nuevo, o el admin cambiando el estado de un vale)
// escribió en Supabase hace un instante y el listener `db.ref('vales').on('value', ...)`
// de este dispositivo todavía no procesó esa actualización (delay de red típico:
// 100ms–1s). Antes se hacía un `set()` del árbol COMPLETO reconstruido desde esa
// copia local: eso reemplazaba TODO el nodo 'vales' en Supabase, borrando
// silenciosamente cualquier vale que hubiera llegado de otro dispositivo en esa
// ventana de tiempo — esto es lo que causaba que "los vales no llegaran bien".
// Con `update()` (multi-path update) solo se tocan las rutas gestorId/valeId que
// esta llamada realmente conoce; cualquier vale ajeno que ya esté en Supabase pero
// no en la copia local queda intacto. Los borrados reales (cancelar/eliminar vale)
// se detectan comparando contra la copia anterior (`prevVales`) y se envían como
// `null` explícito para esas rutas puntuales.
const saveVales = v => {
  // v41: Deduplicate vales by ID — prevents duplicate entries in the UI.
  // This can happen if a vale is saved twice before the merge runs,
  // or if the REST poll returns stale data alongside local data.
  if (Array.isArray(v) && v.length > 1) {
    const seen = new Set();
    v = v.filter(vale => {
      if (!vale || vale.id == null) return false;
      const key = String(vale.id);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  const prevVales = _valesCache; // snapshot antes de este guardado, para detectar borrados reales
  _safeSetLS('axon_vales', JSON.stringify(v));
  _valesCache = v; _valesDirty = false;
  setTimeout(_refrescarReservas, 0);   // v92: las reservas se calculan de los vales
  if (isSyncingFromSupabase()) return;
  // ── DIFF-BASED WRITES (v13) + PAYLOAD SLIMMING (v14) ──
  // v13: solo encolar vales nuevos/cambiados (no todo el array).
  // v14: NO enviar valeText (~300-500 bytes), name de valeProductos (~20 bytes/item),
  //      ni flags locales (synced, isNew) a Supabase. Se regeneran al leer.
  // En redes de 50Kbit/s (~6KB/s), reducir 500 bytes por vale = 80ms menos por write.
  // Para 5 vales seguidos, eso son 400ms menos de bloqueo del WebSocket.
  const updates = {};
  const prevMap = new Map();
  if (Array.isArray(prevVales)) {
    prevVales.forEach(x => { prevMap.set(`${x.gestorId}/${x.id}`, x); });
  }
  // Helper: crea una versión "slim" del vale para enviar a Supabase.
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
      assignedTs: x.assignedTs,   // v39: sync assignment timestamp
      confirmedTs: x.confirmedTs,
      adminNotes: x.adminNotes,
      recogidaTienda: !!x.recogidaTienda,
      ubicacion: x.ubicacion || null,
    };
    // Solo incluir valeText si ya existía (para no romper vales viejos que lo usan).
    // Si el vale lo generó buildValeText() al enviar, NO se envía — se regenera al leer.
    // Pero si un vale viejo en Supabase lo tiene, lo respetamos al hacer update.
    // (No lo quitamos explícitamente para no perder datos existentes.)
    // Para vales NUEVOS: simplemente no lo incluimos.
    // Para vales MODIFICADOS que ya tenían valeText en Supabase: lo incluimos.
    if (x.valeText && prevMap.get(`${x.gestorId}/${x.id}`)?.valeText) {
      slim.valeText = x.valeText;
    }
    // No incluir synced (flag local), isNew (flag temporal), deliveredTs (solo si existe)
    if (x.deliveredTs) slim.deliveredTs = x.deliveredTs;
    if (x.seenByAdmin) slim.seenByAdmin = true;  // v38: sync seenByAdmin to Supabase
    if (x.seenTs) slim.seenTs = x.seenTs;        // v38: sync seenTs to Supabase
    if (x.commissionStatus) slim.commissionStatus = x.commissionStatus;
    if (x.commissionPaid) slim.commissionPaid = x.commissionPaid;
    // v73: stockDecremented NO se subía, y es la bandera que decide si al
    // revertir o borrar un vale hay que devolver las unidades al almacén. El
    // admin la ponía en local, el vale subía sin ella y el poll siguiente traía
    // de vuelta la versión sin bandera y pisaba la local: al revertir, el stock
    // se quedaba descontado para siempre. Se envía siempre —también en false—
    // porque "ya se devolvió" es un dato tan necesario como "está descontado".
    slim.stockDecremented = !!x.stockDecremented;
    // v92: la marca de reserva la pone el admin. Sin esto pasaría lo de siempre:
    // se guarda en el móvil, sube sin ella y el siguiente poll la borra — y con
    // ella se irían las unidades apartadas del stock.
    slim.reservado = !!x.reservado;
    // v75: la cesión de comisión del gestor no puede perderse cuando escribe el
    // admin, o el vale volvería a mostrar la comisión entera.
    if (x.comisionCedida) slim.comisionCedida = x.comisionCedida;
    if (x.comisionCedidaMoneda) slim.comisionCedidaMoneda = x.comisionCedidaMoneda;
    if (x.comisionCedidaMotivo) slim.comisionCedidaMotivo = x.comisionCedidaMotivo;
    // v81: si el admin escribe el vale, la comisión congelada no puede perderse
    // o el vale volvería a recalcularse desde el catálogo actual.
    if (x.comFijadaUSD != null) slim.comFijadaUSD = x.comFijadaUSD;
    if (x.comFijadaMN  != null) slim.comFijadaMN  = x.comFijadaMN;
    // v82: rebaja aplicada por el admin. Va en el slim del admin porque es él
    // quien la decide; el gestor no la toca.
    if (x.rebajaAdmin != null) slim.rebajaAdmin = x.rebajaAdmin;
    if (x.rebajaAdminMoneda) slim.rebajaAdminMoneda = x.rebajaAdminMoneda;
    if (x.rebajaAdminMotivo) slim.rebajaAdminMotivo = x.rebajaAdminMotivo;
    if (x.rebajaAdminTs) slim.rebajaAdminTs = x.rebajaAdminTs;
    return slim;
  }
  // ── v17: slimValeGestor — whitelist de campos que el gestor puede escribir ──
  // PROBLEMA: el gestor tenía una copia local del vale que podía estar desactualizada
  // respecto a lo que el admin había cambiado (status, mensajeroId, confirmedTs,
  // adminNotes). Cualquier saveVales() del gestor mandaba su copia local →
  // pisaba los cambios del admin. En redes lentas la ventana de desincronización
  // es de varios segundos → muy probable que pase.
  // AHORA: el gestor solo escribe los campos que le pertenecen (datos del
  // cliente y productos). Los campos administrativos nunca se mandan desde
  // el dispositivo del gestor, así no pueden pisar cambios del admin.
  const GESTOR_WRITABLE_FIELDS = [
    'id','valeNum','gestorId','ts','cliente','telefono','direccion',
    'carnet','mensajeria','articulo','precioUSD','precioMN','vuelto',
    'total','garantia','comisionGestor','recogidaTienda','ubicacion',
    // v104: la hora de entrega la pone el gestor, así que viaja con sus campos.
    'horaEntrega',
    // v75: la cesión de comisión la decide el gestor al hacer el vale, así que
    // viaja con sus campos. Si faltara aquí, pasaría lo de la marca de stock en
    // v73: se guarda en el móvil, sube sin ella y el poll la borra al volver.
    'comisionCedida','comisionCedidaMoneda','comisionCedidaMotivo',
    // v81: la comisión congelada se fija al crear el vale, así que viaja con el gestor
    'comFijadaUSD','comFijadaMN'
  ];
  // v53 FIX: campos controlados por el admin que el gestor DEBE preservar
  // al escribir. ANTES (v17-v52) el gestor NO escribía estos campos → el
  // upsert de Supabase REEMPLAZABA toda la columna `data` → se borraban
  // status, seenByAdmin, confirmedTs, etc. que el admin había puesto.
  // Resultado: el vale del gestor se quedaba SIEMPRE en 'pending' aunque
  // el admin lo hubiera confirmado, porque el siguiente write del gestor
  // (p.ej. al editar OTRO vale) limpiaba el status de TODOS sus vales.
  // AHORA: el gestor escribe el VALOR ACTUAL de estos campos desde su
  // caché local (que se actualiza cada 5s vía _doRestPoll). Como la caché
  // trae el último estado de Supabase, escribirlos de vuelta es un no-op
  // para los vales que el gestor no tocó. El único riesgo es una ventana
  // pequeña (5s): si el admin cambia el status JUSTO después del último
  // poll del gestor y el gestor guarda antes del siguiente poll, el cambio
  // del admin se pisa con el valor viejo del gestor. El siguiente poll
  // corrige la caché local, pero el cambio del admin ya se perdió en
  // Supabase. Es un trade-off aceptable vs. el bug anterior (que siempre
  // se perdía el status).
  const ADMIN_PRESERVE_FIELDS = [
    'status','mensajeroId','assignedTs','confirmedTs','adminNotes',
    'seenByAdmin','seenTs','commissionStatus','commissionPaid',
    'stockDecremented','hiddenFromHistory','hiddenTs'
  ];
  function slimValeGestor(x) {
    const slim = {};
    GESTOR_WRITABLE_FIELDS.forEach(f => { if (x[f] !== undefined) slim[f] = x[f]; });
    // valeProductos sin name — se busca por id al leer
    slim.valeProductos = (x.valeProductos || []).map(p => ({ id: p.id, qty: p.qty }));
    // Solo incluir valeText si ya existía en local (vales viejos)
    if (x.valeText && prevMap.get(`${x.gestorId}/${x.id}`)?.valeText) {
      slim.valeText = x.valeText;
    }
    if (x.deliveredTs) slim.deliveredTs = x.deliveredTs; // mensajero puede marcar entrega
    // v54: NUNCA incluir campos del admin en el slim del gestor.
    // Tanto el RPC (server-side merge) como el fallback JS (read-merge-write)
    // preservan los campos del admin. Si los incluyéramos aquí, estaríamos
    // pisándolos con valores stale de la caché local del gestor.
    // (El bloque v53 que incluía ADMIN_PRESERVE_FIELDS fue removido en v54.)
    const _prev = prevMap.get(`${x.gestorId}/${x.id}`);
    if (!_prev) {
      // Vale nuevo — incluir status inicial ('pending') y campos del admin vacíos
      if (!slim.status) slim.status = x.status || 'pending';
      if (slim.mensajeroId === undefined) slim.mensajeroId = null;
      if (slim.confirmedTs === undefined) slim.confirmedTs = null;
      slim.isNew = true;
      if (slim.adminNotes === undefined) slim.adminNotes = '';
    }
    return slim;
  }
  const curKeys = new Set();
  if (IS_ADMIN) {
    v.forEach(x => {
      const key = `${x.gestorId}/${x.id}`;
      curKeys.add(key);
      // v58 FIX: el diff se comparaba contra prevMap, construido desde
      // _valesCache. Pero patchVale (que es como el admin confirma, asigna y
      // cobra) hace `const all = getVales(); all[i] = {...all[i], ...changes};
      // saveVales(all)`, y getVales() devuelve _valesCache POR REFERENCIA. Así
      // que para cuando saveVales comparaba, "el estado anterior" ya traía el
      // cambio aplicado: slim y prevSlim eran idénticos, updates quedaba vacío
      // y el `return` de más abajo cortaba la escritura. El cambio de estado
      // del admin NUNCA se subía a Supabase.
      // Efecto, que es justo lo que se veía: el admin confirmaba, lo veía
      // confirmado en su pantalla (localStorage sí se actualiza) y ~60 s
      // después el poll leía 'pending' de Supabase y se lo revertía, al
      // expirar la ventana de local-wins. Y el gestor no recibía nada, porque
      // no había nada que recibir. Los avisos sí le llegaban porque van por
      // otro camino (saveNotifs → setSB directo, sin diff), y esa asimetría
      // era la que despistaba.
      // AHORA se compara contra un snapshot SERIALIZADO del último slim
      // enviado. Al ser texto y no referencias, es inmune a que alguien mute
      // los vales del caché por debajo.
      const slim = slimVale(x);
      const slimStr = JSON.stringify(slim);
      if (_valesPrevSlimJson.get(key) !== slimStr) {
        updates[key] = slim;
        _valesPrevSlimJson.set(key, slimStr);
      }
    });
    // Borrados reales: vales que estaban en prevVales pero ya no están en v.
    // Esto sí funciona con prevVales: al borrar se construye un array NUEVO
    // (getVales().filter(...)), sin mutar el anterior, así que la ausencia se
    // detecta bien. El bug del diff solo afectaba a las MODIFICACIONES.
    if (Array.isArray(prevVales)) {
      prevVales.forEach(x => {
        const key = `${x.gestorId}/${x.id}`;
        if (!curKeys.has(key)) { updates[key] = null; _valesPrevSlimJson.delete(key); }
      });
    }
    if (Object.keys(updates).length === 0) return; // nada que escribir
    _enqueueSBChunked('vales', updates, 'update');
  } else if (activeGestorId) {
    // El gestor SOLO puede escribir su propia rama. Nunca 'vales' a secas,
    // porque tocaría los vales de los demás gestores.
    const mine = v.filter(x => x.gestorId === activeGestorId);
    mine.forEach(x => {
      // v17: usar slimValeGestor — solo campos del gestor, nunca status/mensajeroId/etc.
      // v58 FIX: mismo problema de referencia compartida que en la rama del
      // admin — se comparaba contra prevMap, que puede traer el vale ya mutado,
      // y la edición del gestor se quedaba sin subir. Aquí el daño era menor
      // (el slim del gestor no lleva status, así que no pisaba nada del admin),
      // pero perdía igualmente cambios de datos del cliente.
      // Ojo: slimValeGestor sigue usando prevMap para saber si el vale es NUEVO,
      // y eso es correcto — prevVales contiene todos los vales existentes, estén
      // mutados o no, así que "no está en prevMap" solo pasa con vales nuevos de
      // verdad. Es importante no tocarlo: si un vale existente se tomara por
      // nuevo, el gestor le mandaría status:'pending' y confirmedTs:null, y sí
      // pisaría la confirmación del admin.
      const key = `${x.gestorId}/${x.id}`;
      const slim = slimValeGestor(x);
      const slimStr = JSON.stringify(slim);
      if (_valesPrevSlimJson.get(key) !== slimStr) {
        updates[x.id] = slim;
        _valesPrevSlimJson.set(key, slimStr);
      }
    });
    if (Array.isArray(prevVales)) {
      const kept = new Set(mine.map(x => x.id));
      prevVales.filter(x => x.gestorId === activeGestorId).forEach(x => {
        if (!kept.has(x.id)) { updates[x.id] = null; _valesPrevSlimJson.delete(`${x.gestorId}/${x.id}`); }
      });
    }
    if (Object.keys(updates).length === 0) return; // nada que escribir
    _enqueueSBChunked(`vales/${activeGestorId}`, updates, 'update');
  }
  // Sin gestor activo en la página de gestor: no se escribe nada (evita borrados fantasma)
};

const getMensajeros = () => { if (_mensajerosDirty || !_mensajerosCache) { try { _mensajerosCache = JSON.parse(localStorage.getItem('axon_mensajeros') || '[]'); } catch(e) { _mensajerosCache = []; } _mensajerosDirty = false; } return _mensajerosCache; };
const saveMensajeros= v  => { _safeSetLS('axon_mensajeros', JSON.stringify(v)); _mensajerosCache = v; _mensajerosDirty = false; _mensajerosMap = null; if (!isSyncingFromSupabase()) setSB('mensajeros', v); };

// v41: Normalize product fields — some products come from productos.json with Spanish
// field names (nombre, descripcion, imagen, precioActual) while the code uses English
// (name, description, photo, precio). This function ensures BOTH exist on every product.
function _normalizeProducto(p) {
  if (!p || typeof p !== 'object') return p;
  // name ← nombre (if name missing)
  if (!p.name && p.nombre) p.name = p.nombre;
  if (!p.nombre && p.name) p.nombre = p.name;
  // description ← descripcion
  if (!p.description && p.descripcion) p.description = p.descripcion;
  if (!p.descripcion && p.description) p.descripcion = p.description;
  // photo ← imagen
  if (!p.photo && p.imagen) p.photo = p.imagen;
  if (!p.imagen && p.photo) p.imagen = p.photo;
  // precio ← precioActual (precioActual is often a number, precio is string like "$270 USD")
  if (!p.precio && p.precioActual != null) {
    p.precio = typeof p.precioActual === 'number' ? `$${p.precioActual} USD` : String(p.precioActual);
  }
  if (p.precioActual == null && p.precio) {
    p.precioActual = typeof p.precio === 'string' ? parseFloat(p.precio.replace(/[^0-9.]/g, '')) || 0 : p.precio;
  }
  // Si el producto viene SIN el campo (los de productos.json, por ejemplo), se
  // le pone 1: toda venta valía al menos un punto.
  //
  // v114: antes esta línea también pisaba el 0. Escribir 0 puntos en la ficha
  // guardaba 0, y al volver a leer el producto salía 1 — no había forma de
  // dejar un producto sin puntos, que es justo lo que hace falta con los que
  // no puntúan. Un 0 escrito a propósito no es un campo que falta.
  if (p.puntos == null || p.puntos === '') p.puntos = 1;
  else { const _n = parseFloat(p.puntos); p.puntos = isFinite(_n) && _n > 0 ? _n : 0; }
  // comisionMoneda default
  if (p.comision && !p.comisionMoneda) {
    const c = String(p.comision).toUpperCase();
    if (c.includes('MN') || c.includes('CUP')) p.comisionMoneda = 'MN';
    else p.comisionMoneda = 'USD';
  }
  return p;
}
const getProductos  = () => {
  if (_productosDirty || !_productosCache) {
    try { _productosCache = JSON.parse(localStorage.getItem('axon_productos') || '[]'); } catch(e) { _productosCache = []; }
    // v41: Normalize all products on read
    if (Array.isArray(_productosCache)) _productosCache.forEach(_normalizeProducto);
    _productosDirty = false;
  }
  return _productosCache;
};
// ⚠️ saveProductos SUBE EL CATÁLOGO ENTERO. Úsalo solo cuando de verdad quieras
// reemplazarlo todo (importar, restaurar, cargar demo). Para cambiar uno o dos
// productos usa guardarProductos(lista, ids), justo debajo.
const saveProductos = v  => { if(Array.isArray(v)) v.forEach(_normalizeProducto); _safeSetLS('axon_productos', JSON.stringify(v)); _productosCache = v; _productosDirty = false; _productosMap = null; if (!isSyncingFromSupabase()) setSB('productos', v); triggerAutoPublishCatalog(); };

// ── v95: guardar SOLO los productos que cambian ─────────────────────────────
// El 16/08 se perdió el inventario de un día entero por esto. Alguien tocó el
// stock desde un segundo teléfono y, en vez de subir ese producto, subió su
// copia COMPLETA del catálogo — que llevaba horas sin refrescarse, porque la
// lista de productos solo se baja cada 5 minutos y nunca con la app en segundo
// plano. El upsert de Supabase no compara fechas: el último que escribe gana.
// Así que un teléfono desactualizado podía reponer el inventario de la mañana
// con una sola pulsación, y ni siquiera hacía falta mala suerte.
//
// Ahora cada cambio manda solo las filas tocadas. Las demás ni se mencionan, así
// que lo que otro dispositivo haya hecho mientras tanto sobrevive intacto.
// Un id que ya no está en la lista se manda como null y eso SÍ borra la fila en
// Supabase — antes, borrar un producto solo lo quitaba del teléfono y volvía a
// aparecer en la siguiente sincronización.
function guardarProductos(lista, ids) {
  if (Array.isArray(lista)) lista.forEach(_normalizeProducto);
  _safeSetLS('axon_productos', JSON.stringify(lista));
  _productosCache = lista; _productosDirty = false; _productosMap = null;
  if (!isSyncingFromSupabase()) {
    const porId = new Map();
    (lista || []).forEach(p => { if (p && p.id != null) porId.set(String(p.id), p); });
    const cambios = {};
    (ids || []).forEach(id => {
      if (id == null) return;
      const k = String(id);
      cambios[k] = porId.has(k) ? porId.get(k) : null;   // null = borrar la fila
    });
    if (Object.keys(cambios).length) _enqueueSB('productos', cambios, 'update');
  }
  triggerAutoPublishCatalog();
}

const getCategorias = () => { if (_categoriasDirty || !_categoriasCache) { try { _categoriasCache = JSON.parse(localStorage.getItem('axon_categorias') || '[]'); } catch(e) { _categoriasCache = []; } _categoriasDirty = false; } return _categoriasCache; };
// ⚠️ Sube la lista entera: solo para importar/restaurar/demo.
const saveCategorias= v  => { _safeSetLS('axon_categorias', JSON.stringify(v)); _categoriasCache = v; _categoriasDirty = false; if (!isSyncingFromSupabase()) setSB('categorias', v); };
function guardarCategorias(lista, ids) {
  _guardarFilas('axon_categorias', 'categorias', lista, ids, l => { _categoriasCache = l; _categoriasDirty = false; });
}

const getConfig     = () => { if (_configDirty || !_configCache) { try { _configCache = JSON.parse(localStorage.getItem('axon_config') || '{}'); } catch(e) { _configCache = {}; } _configDirty = false; } return _configCache; };
const saveConfig    = v  => { _safeSetLS('axon_config', JSON.stringify(v)); _configCache = v; _configDirty = false; if (!isSyncingFromSupabase()) setSB('config', v); };

// GitHub token helper — el token NUNCA se sincroniza a Supabase.
// Vive solo en localStorage del dispositivo admin para evitar que gestores
// u otros dispositivos lo lean. Ver AUDITORIA-AXONTECH.md CRÍTICO 3.
const ghToken = () => { try { return localStorage.getItem('axon_gh_token') || ''; } catch(e) { return ''; } };

// Helper para escribir el estado de GitHub en AMBOS bloques (catálogo + config).
// Antes solo se actualizaba el primero por el ID duplicado. Ver AUDITORIA-AXONTECH.md ALTO 12.
const setGhStatus = html => ['ghSyncStatus','ghSyncStatus2'].forEach(i => {
  const el = document.getElementById(i);
  if (el) el.innerHTML = html;
});

const getNotifs     = () => { if (_notifsDirty || !_notifsCache) { try { _notifsCache = JSON.parse(localStorage.getItem('axon_notifs') || '[]'); } catch(e) { _notifsCache = []; } _notifsDirty = false; } return _notifsCache; };
const saveNotifs    = v  => { _safeSetLS('axon_notifs', JSON.stringify(v)); _notifsCache = v; _notifsDirty = false; if (!isSyncingFromSupabase()) setSB('notifs', v); };

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
  // ── v28 BUGFIX: Asignar catId por nombre si el producto no lo tiene ──
  // Algunos productos vienen de productos.json con campo 'categoria' (string)
  // pero sin 'catId'. Necesitamos mapear el nombre de categoría al ID
  // para que el catálogo agrupe correctamente los productos.
  // v36: Shallow clone to avoid mutating cached product objects
  if(cats.length){
    const catNameToId={};
    cats.forEach(c=>{ catNameToId[(c.name||'').toUpperCase()] = c.id; });
    allProds=allProds.map(p=>{
      if(!p.catId && p.categoria){
        const mapped = catNameToId[(p.categoria||'').toUpperCase()];
        if(mapped) return {...p, catId: mapped};
      }
      return p;
    });
  }
  const cfg=getConfig();
  const waPhone=cfg.catalogPhone||cfg.adminPhone||'';
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
var PHOTO_RE=/^(https?:|data:image|photos\.|.\/photos\.)/i;
function renderGrid(){
  var g=document.getElementById('productGrid');
  var filtered=activeCat!==null?products.filter(function(p){return p.catId===activeCat}):products;
  if(!filtered.length){g.innerHTML='<div class="empty"><div class="empty-icon">&#128230;</div><div>No hay productos en esta categoria</div></div>';return;}
  g.innerHTML=filtered.map(function(p){
    var s='<div class="card" onclick="openProduct('+p.id+')" style="cursor:pointer;">';
    s+='<div class="card-img">';
    // Validate photo URL — only allow http(s) and data URIs
    if(p.photo && PHOTO_RE.test(p.photo)){s+='<img src="'+escapeHTML(p.photo)+'" data-img="1" loading="lazy">';}
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
    else{s+='<div class="wa-btn" style="background:#cbd5e1;cursor:default;pointer-events:none;">No disponible</div>';}
    s+='</div></div>';
    return s;
  }).join('');
}
function openProduct(id){
  var p=products.find(function(x){return x.id===id});if(!p)return;
  var c=document.getElementById('pmodalContent');
  var h='';
  if(p.photo && PHOTO_RE.test(p.photo)){h+='<img class="pmodal-img" src="'+escapeHTML(p.photo)+'" data-img="1"><div class="pmodal-noimg" style="display:none">&#128230;</div>';}
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
const getEstafa   = () => { if (_estafaDirty || !_estafaCache) { try { _estafaCache = JSON.parse(localStorage.getItem('axon_estafa') || '[]'); } catch(e) { _estafaCache = []; } _estafaDirty = false; } return _estafaCache; };
const saveEstafa  = v  => { _safeSetLS('axon_estafa', JSON.stringify(v)); _estafaCache = v; _estafaDirty = false; if (!isSyncingFromSupabase()) setSB('estafa', v); };

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
    // Phone match (exact digits only, no formatting)
    if (e.telefono && vPhone) {
      const ePhone = e.telefono.replace(/[\s\-()]/g, '');
      if (ePhone && (vPhone.includes(ePhone) || ePhone.includes(vPhone))) reasons.push('teléfono: ' + e.telefono);
    }
    // Name match (fuzzy: normalized, partial, reversed)
    if (e.nombre && vCliente) {
      const eNombre = norm(e.nombre);
      if (eNombre && vCliente) {
        // Exact normalized match
        if (vCliente === eNombre) { reasons.push('nombre: ' + e.nombre); }
        // One contains the other
        else if (vCliente.includes(eNombre) || eNombre.includes(vCliente)) { reasons.push('nombre: ' + e.nombre); }
        // Check each word of the name against each word of the entry
        else {
          const vWords = vCliente.split(/\s+/).filter(w=>w.length>2);
          const eWords = eNombre.split(/\s+/).filter(w=>w.length>2);
          let wordMatch = false;
          for(const vw of vWords){ for(const ew of eWords){ if(vw.includes(ew)||ew.includes(vw)){wordMatch=true;break;} } if(wordMatch)break; }
          if(wordMatch && vWords.length>=2 && eWords.length>=2) reasons.push('nombre similar: ' + e.nombre);
        }
      }
    }
    // Address match (fuzzy: normalized, partial)
    if (e.direccion && vDireccion) {
      const eDir = norm(e.direccion);
      if (eDir && vDireccion) {
        if (vDireccion.includes(eDir) || eDir.includes(vDireccion)) { reasons.push('dirección: ' + e.direccion); }
        else {
          const vWords = vDireccion.split(/\s+/).filter(w=>w.length>3);
          const eWords = eDir.split(/\s+/).filter(w=>w.length>3);
          let matchCount = 0;
          for(const vw of vWords){ for(const ew of eWords){ if(vw===ew||vw.includes(ew)||ew.includes(vw)){matchCount++;break;} } }
          if(matchCount >= Math.min(2, eWords.length)) reasons.push('dirección similar: ' + e.direccion);
        }
      }
    }
    // Carnet match (exact or partial)
    if (e.carnet && vCarnet) {
      const eCarnet = norm(e.carnet);
      if (eCarnet && (vCarnet.includes(eCarnet) || eCarnet.includes(vCarnet))) reasons.push('carnet: ' + e.carnet);
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
    return `<div style="background:var(--surface2);border:1px solid var(--red);border-radius:10px;padding:12px;margin-bottom:8px;cursor:pointer;" onclick="var _m=this.closest('.modal-bg');if(_m)_m.remove();adminTab('estafa');">
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

// Helper: convert vales array to Supabase nested object
function _valesToSupabaseObj(vales) {
  const obj = {};
  vales.forEach(v => {
    if (!obj[v.gestorId]) obj[v.gestorId] = {};
    obj[v.gestorId][v.id] = v;
  });
  return obj;
}

// ── v65: listenToMyVales() eliminada (código muerto) ─────────────────────────
// Eran ~115 líneas colgadas de db.ref(`vales/{gId}`).on('value', …). `db` es un
// stub local: su .on() devuelve una función vacía y NUNCA invoca el callback, así
// que nada de aquel bloque llegó a ejecutarse jamás — ni el merge de vales, ni la
// detección de cambios de estado, ni las notificaciones que decía enviar.
// Peor que inútil: era engañoso. Al buscar por qué el gestor no recibía los avisos
// se leía esta función, que parecía justo la responsable, y se perdía el tiempo
// ahí en vez de en _doRestPoll(), que es quien hace el trabajo de verdad (cada 5 s
// por REST). Ya provocó al menos un fallo documentado en el propio código (v28:
// «usaba _handleValesSnap/_handleMyValesSnap que NUNCA se definían»).

// Custom Supabase Vale individual operations — now using the write queue
// NOTE: fbAddVale and fbRemoveVale are DEPRECATED — saveVales already enqueues a
// full 'set' on the vales node. Calling these in addition to saveVales caused
// race conditions. Kept for backward compatibility but no longer invoked from
// sendVale / cancelVale / adminDeleteVale / sendAdminVale.
function fbAddVale(v)    { _enqueueSB(`vales/${v.gestorId}/${v.id}`, v, 'set'); }
function fbRemoveVale(v) { _enqueueSB(`vales/${v.gestorId}/${v.id}`, null, 'remove'); }
// fbUpdateVale removed — was unused dead code (see comment in patchVale).

// ── Debounce de refreshUI para conexiones lentas ──
// Supabase dispara un snapshot por cada write remoto. En una sesión activa
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
  // v55 FIX: Hash de TODOS los vales (sin cutoff de 500 chars) e incluir campos
  // del admin (confirmedTs, assignedTs, mensajeroId, seenByAdmin) para detectar
  // ANY cambio que deba disparar un re-render.
  // ANTES: solo hasheaba id+status+ts de los primeros ~10 vales (cutoff 500 chars).
  // Si el gestor tenía más de 10 vales, los más viejos no se hasheaban → si el
  // admin confirmaba un vale viejo, el hash no cambiaba → refreshUI() saltaba el
  // render → el gestor nunca veía la confirmación.
  let h = '';
  for (let i = 0; i < vales.length; i++) {
    const v = vales[i];
    h += (v.id || 0) + ':' + (v.status || '') + ':' + (v.ts || '') + ':'
       + (v.confirmedTs || '') + ':' + (v.assignedTs || '') + ':'
       + (v.mensajeroId || '') + ':' + (v.seenByAdmin ? '1' : '0') + '|';
  }
  return h;
}
function refreshUI() {
  // Verificar si el snapshot de vales realmente cambió desde el último render.
  // Si es idéntico, saltar el render (snapshot redundante de Supabase).
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
    // Antes: cada snapshot de Supabase re-renderizaba TODOS los paneles del
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
  // v89: el chip de la tasa, en los dos roles. El admin la comparte por el
  // config sincronizado, así que al gestor le llega en este mismo refresco.
  if(typeof renderTasaBadge === 'function') renderTasaBadge();
}
let _rankingIdleHandle = null;



// ── v65: listeners de nodos eliminados (código muerto) ──────────────────────
// Eran 8 suscripciones db.ref(node).on('value', …) —gestores, mensajeros,
// productos, categorías, config, notifs, estafa y ranking_summary— que el propio
// código ya reconocía como inertes: «db.ref() is a MOCK — these listeners NEVER
// fire […] kept as dead code to avoid breaking references». No había tales
// referencias que romper, así que se van. Todo eso lo sincroniza _doRestPoll().

// Vales Listeners
// ── v29: Moved to global scope so the REST poll can access them ──
let _rankingDebounce = null;
let _lastRankingSummary = '';  // hash del último summary enviado → evitar writes redundantes
// v65: aquí vivía el listener db.ref('vales').on('value', …) del admin, 114
// líneas que nunca se ejecutaron. Lo que hace de verdad ese trabajo —leer los
// vales, mezclarlos y refrescar la UI— es _doRestPoll().

// Initialize empty Supabase from local if Admin
// Siembra inicial: si la nube está VACÍA, subir los datos locales del admin.
//
// v65 FIX: este bloque parecía código muerto como el resto de db.ref, pero no lo
// era, y hacía lo contrario de lo que dice su nombre. El stub .once() devuelve
// Promise.resolve({ val: () => null }), así que el .then() SÍ se ejecutaba y
// `!s.val()` era SIEMPRE cierto: el admin se creía la nube vacía en cada arranque
// y, 1,5 s después de abrir, resubía gestores, mensajeros, productos, categorías,
// config y TODOS los vales desde su copia local. Es decir, machacaba lo que
// hubiera en Supabase —incluidos cambios recién hechos desde otro dispositivo—
// con lo que tuviera guardado, que es exactamente la clase de escritura ciega que
// ha provocado los fallos de sincronización de esta app.
// Ahora la comprobación es de verdad, leyendo por REST. Y si la lectura falla no
// se siembra nada: ante la duda, mejor no escribir que escribir de más.
if (IS_ADMIN) {
  setTimeout(async () => {
    try {
      const remoteGestores = await _sbRestGetCollection('gestores');
      if (remoteGestores && remoteGestores.length > 0) return; // la nube ya tiene datos
      const lGestores = getGestores();
      if (!lGestores.length) return;
      console.log('[seed] Supabase vacío — subiendo los datos locales por primera vez');
      setSB('gestores', lGestores);
      setSB('mensajeros', getMensajeros());
      setSB('productos', getProductos());
      setSB('categorias', getCategorias());
      setSB('config', getConfig());
      const localVales = getVales();
      if (localVales.length) {
        // v37: Write vales in NEW flat format (one row per vale, id=valeId)
        // ANTES: _enqueueSB('vales', _valesToSupabaseObj(localVales), 'set')
        // which wrote in OLD nested format (id=gestorId, data={valeId: valeObj})
        // causing duplicates when _flattenValesFromSB found both formats.
        const flatUpdates = {};
        localVales.forEach(v => { if (v && v.id != null) flatUpdates[v.id] = v; });
        _enqueueSB('vales', flatUpdates, 'update');
      }
    } catch(e) {
      console.warn('[seed] no se pudo comprobar si la nube está vacía, no se siembra nada:', e && e.message);
    }
  }, 1500);
}




// v39: Track when each vale was last patched LOCALLY (ms timestamp).
// Used by _doRestPoll merge to only apply "local-wins" for recently changed vales
// (within 60s), so that stale local data from a previous session doesn't
// override newer Supabase changes from another device.
const _valeLocalPatchTs = new Map();

// ── v99: el más reciente primero, siempre ───────────────────────────────────
// Las listas de vales hacían `.reverse()`, que solo funciona si el array está
// guardado del más viejo al más nuevo. Y lo está… hasta el primer sync: el poll
// deja los vales ORDENADOS POR FECHA DESCENDENTE (línea ~1030), así que el
// reverse los daba la vuelta y el vale recién llegado se iba al FONDO de la
// lista. De ahí que un vale nuevo no apareciera arriba.
// Ordenar por la fecha en vez de por la posición no depende de cómo esté
// guardado el array, así que no puede volver a descolocarse.
function ordenarRecientesPrimero(vales) {
  return (vales || []).slice().sort((a, b) => {
    const ta = Date.parse(a && a.ts) || 0;
    const tb = Date.parse(b && b.ts) || 0;
    if (tb !== ta) return tb - ta;
    // Misma marca de tiempo (dos vales del mismo segundo): el id es creciente.
    return (Number(b && b.id) || 0) - (Number(a && a.id) || 0);
  });
}

function patchVale(id, changes) {
  // v65: .slice() — copia del array antes de tocarlo. getVales() devuelve el
  // caché VIVO (_valesCache), así que mutarlo aquí dejaba a saveVales() sin
  // estado anterior con el que comparar: comparaba el vale consigo mismo, el
  // diff salía vacío y el cambio del admin no se subía a Supabase (el fallo de
  // v59). Aquel se arregló con un snapshot serializado; esto ataca la causa, y
  // entre las dos cosas el bug no puede volver por esta vía.
  const all = getVales().slice(); const i = all.findIndex(v=>v.id===id);
  if (i!==-1){
    // v39: Track assignment timestamp for proper _valeModTs comparison
    if (changes.status === 'assigned' && !changes.assignedTs) {
      changes.assignedTs = new Date().toISOString();
    }
    // v114: al confirmar se congela lo que costó la mercancía, igual que la
    // comisión se congela al crear el vale. Se hace aquí y no en los cinco
    // sitios que confirman una venta, que es donde esta app se ha ido
    // desincronizando siempre. No toca `changes`: el costo no va dentro del
    // vale — ver la nota en _congelarCostoVale().
    if (changes.status === 'confirmed' && all[i].status !== 'confirmed') {
      try { _congelarCostoVale(all[i]); } catch(e) { console.warn('[costos] no se pudo congelar:', e && e.message); }
    }
    all[i]={...all[i],...changes};
    // v39: Mark this vale as locally patched (for time-based local-wins in merge)
    _valeLocalPatchTs.set(String(id), Date.now());
    // saveVales already writes to Supabase via _enqueueSB — no need for redundant fbUpdateVale
    // Previously, both saveVales (full 'set') and fbUpdateVale (partial 'update') were called,
    // causing race conditions where Supabase could overwrite local changes with stale data.
    saveVales(all);
    // v39: Force a delayed poll to confirm the write reached Supabase
    // and pull any updates from other devices.
    setTimeout(() => { if (typeof _doRestPoll === 'function') _doRestPoll(); }, 3000);
  }
}
// Genera el siguiente número de vale.
// v17: Patrón híbrido — local-sync síncrono + reconciler atómico async.
// ANTES (v15): el patrón local-sync podía duplicar valeNum si dos gestores
// enviaban un vale en el mismo milisegundo. A 10 Kbit/s, la latencia del
// listener de config es de varios segundos → alta probabilidad de colisión.
// AHORA (v17):
//   1. getNextValeNum() sigue siendo síncrono: reserva el número localmente
//      y encola el update a Supabase. El gestor NO espera.
//   2. _reconcileNextValeNum() corre en background cuando hay conexión:
//      usa transaction() de Supabase para asegurar que el contador remoto
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
  if (!isSyncingFromSupabase()) _enqueueSB('config', {nextValeNum: n + 1}, 'update');
  // v65: aquí se llamaba a _scheduleReconcileNextValeNum(), eliminado por no
  // funcionar (ver la nota justo debajo de esta función).
  return n;
}

// ── v65: reconciliador de nextValeNum eliminado (no funcionaba) ─────────────
// Se apoyaba en db.ref('config/nextValeNum').transaction(...), y el stub `db`
// resuelve transaction() con { committed: false } SIEMPRE. El bloque que ajustaba
// el contador estaba dentro de `if (result && result.committed)`, así que no se
// ejecutó nunca: la función se programaba, esperaba 800 ms y no hacía nada.
// OJO — esto NO arregla lo que decía arreglar, solo deja de fingirlo: si dos
// gestores sin conexión reservan el mismo número de vale, seguirán colisionando,
// igual que hasta ahora. Para resolverlo de verdad hace falta reservar el número
// en el servidor (una función RPC en Supabase que devuelva el siguiente valor de
// forma atómica), no un contador en cada teléfono.
function valeNumStr(v) {
  return v.valeNum ? 'V-' + String(v.valeNum).padStart(3,'0') : '';
}
function patchProducto(id, changes) {
  // v65: .slice() para no mutar el array vivo del caché.
  // v95: sube SOLO este producto. Antes reenviaba el catálogo entero, y con él
  // el stock de todos los demás tal y como estuviera en este teléfono.
  const all = getProductos().slice(); const i = all.findIndex(p=>p.id===id);
  if (i!==-1){all[i]={...all[i],...changes};guardarProductos(all,[id]);}
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
// ── v92: reservas atadas a un vale ─────────────────────────────────────────
// Hasta ahora `reserved` era un número suelto que solo se movía a mano desde el
// botón 🔐. El comentario de arriba decía que bajaba al entregar o cancelar,
// pero NADA en el código lo bajaba: al confirmar la venta caía el stock y la
// reserva se quedaba clavada, comiéndose disponibilidad para siempre.
//
// Ahora el admin puede marcar un vale como reservado (v.reservado) y las
// unidades de ese vale cuentan como comprometidas mientras el vale siga vivo.
// No hay que liberar nada: en cuanto el vale se confirma, se cancela o se borra,
// deja de estar en la lista y su reserva desaparece sola. Es la diferencia entre
// una cuenta y una copia — una copia hay que acordarse de actualizarla, y ya
// vimos con el stock (v73) cómo acaba eso.
//
// El botón 🔐 sigue existiendo para lo que no viene de un vale (el cliente que
// llamó por teléfono); esa reserva manual se suma a la calculada.
const _VALE_RESERVA_ESTADOS = { pending: 1, assigned: 1 };
// v93: "¿este vale está apartando stock ahora mismo?" — una sola respuesta para
// el cálculo y para las chapas que se pintan. Si la pregunta se contestara por
// separado en cada sitio, acabaría habiendo vales con chapa de reservado que ya
// no reservan nada.
function _valeReservaActiva(v) {
  if (!v) return false;
  // ── v104: un vale que salió con el mensajero aparta sus unidades solo ──────
  // Hasta ahora un vale solo reservaba si alguien le daba al botón 🔐. Pero
  // cuando el admin asigna un mensajero, esa mercancía YA VA DE CAMINO al
  // cliente: físicamente no está en el almacén, aunque el stock no se descuente
  // hasta que se marque la entrega. En esa ventana —que puede ser toda una
  // tarde— otro gestor veía las unidades como disponibles y las prometía a otro
  // cliente. Después no había qué entregar y alguien quedaba mal.
  // Se reserva sin necesidad de acordarse de pulsar nada: el propio hecho de
  // asignar el mensajero es la señal.
  if (v.status === 'assigned' && !_valeDescontoStock(v)) return true;
  return !!(v.reservado && _VALE_RESERVA_ESTADOS[v.status]);
}
// ══════════════════════════════════════════════════════════════════════════
//  v104 · HORA DE ENTREGA Y AVISO AL ADMIN
// ══════════════════════════════════════════════════════════════════════════
// El gestor manda el vale a las 10 de la mañana pero el cliente lo espera a las
// 3 de la tarde. Entre medias entran veinte vales más y el de las 3 queda
// enterrado en la bandeja: cuando alguien se acuerda, ya es tarde.
//
// El gestor puede escribir esa hora al hacer el vale (campo opcional). El
// teléfono del admin la vigila y avisa una hora antes.
//
// Por qué el aviso NO viaja por el sistema de notificaciones compartidas:
//   · Esas notificaciones las ve todo el mundo, y esto es cosa del admin.
//   · Cada una se sube y se baja a la nube, y en agosto nos comimos los 5 GB
//     del plan gratuito justamente por tráfico de más.
//   · El admin es quien tiene la app abierta todo el día, así que basta con que
//     su propio teléfono mire el reloj.
// A cambio, el aviso solo salta con la app abierta. Para que no dependa solo de
// eso, el vale además lleva una chapa con la hora que se pone roja cuando se
// acerca — esa se ve siempre, aunque nadie estuviera delante al saltar el aviso.
const AVISO_ENTREGA_MS = 60 * 60 * 1000;      // se avisa una hora antes
const _ESTADOS_ESPERANDO_ENTREGA = { pending: 1, assigned: 1 };

// "HH:MM" + el día del vale → instante exacto, o null si no hay hora puesta.
function _momentoEntrega(v) {
  if (!v || !v.horaEntrega) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v.horaEntrega).trim());
  if (!m) return null;
  const base = new Date(v.ts || Date.now());
  if (isNaN(base.getTime())) return null;
  const d = new Date(base);
  d.setHours(parseInt(m[1], 10), parseInt(m[2], 10), 0, 0);
  // Un vale hecho a las 23:50 para entregar "a las 00:30" es del día siguiente.
  if (d.getTime() < base.getTime()) d.setDate(d.getDate() + 1);
  return d.getTime();
}

// Chapa para la tarjeta del vale. Gris mientras falta mucho, naranja en la
// última hora, roja cuando ya pasó la hora.
function _chipHoraEntrega(v) {
  const t = _momentoEntrega(v);
  if (t == null || !_ESTADOS_ESPERANDO_ENTREGA[v.status]) return '';
  const falta = t - Date.now();
  let fondo = 'var(--surface3)', color = 'var(--text-muted)', borde = 'var(--border)';
  if (falta < 0)                   { fondo = 'rgba(220,38,38,.15)';  color = '#dc2626'; borde = 'rgba(220,38,38,.4)'; }
  else if (falta <= AVISO_ENTREGA_MS) { fondo = 'rgba(245,158,11,.15)'; color = '#b45309'; borde = 'rgba(245,158,11,.4)'; }
  const hhmm = escapeHTML(String(v.horaEntrega));
  const titulo = falta < 0 ? 'La hora de entrega ya pasó' : 'Hora de entrega acordada';
  return `<span title="${titulo}" style="background:${fondo};color:${color};border:1px solid ${borde};border-radius:6px;padding:1px 6px;font-size:9px;font-weight:700;margin-left:4px;white-space:nowrap;">⏰ ${hhmm}</span>`;
}

// Los avisos ya dados se recuerdan en ESTE teléfono, no en la nube: es una
// preferencia local ("ya me lo dijiste"), no un dato del negocio. La clave
// incluye la hora, así que si el gestor la corrige, se vuelve a avisar.
function _avisosEntregaDados() {
  try { return new Set(JSON.parse(localStorage.getItem('axon_avisos_entrega') || '[]')); }
  catch(e) { return new Set(); }
}
function _guardarAvisosEntrega(set) {
  // Solo se conservan los últimos 200: son de un día y no valen nada mañana.
  try { _safeSetLS('axon_avisos_entrega', JSON.stringify([...set].slice(-200))); } catch(e) {}
}

// ── v108: la lista de entregas con hora, siempre a la vista ─────────────────
// El aviso del sistema salta una vez y se lo puede llevar el viento: si en ese
// momento nadie estaba mirando, no queda rastro. Esto es lo contrario — una
// lista corta, ordenada por cercanía, que está ahí todo el rato. El aviso pasa
// a ser el extra, no el único sitio donde se entera uno.
function renderProximasEntregas() {
  const cont = document.getElementById('proximasEntregas');
  const sec = document.getElementById('proximasEntregasSection');
  if (!cont || !sec) return;
  const ahora = Date.now();
  const pendientes = getVales()
    .filter(v => _ESTADOS_ESPERANDO_ENTREGA[v.status] && _momentoEntrega(v) != null)
    .map(v => ({ v, t: _momentoEntrega(v) }))
    // Lo de ayer no interesa; lo de hace un rato sí, porque sigue sin entregarse.
    .filter(x => x.t > ahora - 12 * 3600000)
    .sort((a, b) => a.t - b.t);

  if (!pendientes.length) { sec.style.display = 'none'; cont.innerHTML = ''; return; }
  sec.style.display = '';
  cont.innerHTML = pendientes.map(({ v, t }) => {
    const min = Math.round((t - ahora) / 60000);
    let cuando, color, fondo;
    if (min < 0)        { cuando = `${Math.abs(min)} min tarde`; color = '#dc2626'; fondo = 'rgba(220,38,38,.10)'; }
    else if (min <= 60) { cuando = `en ${min} min`;              color = '#b45309'; fondo = 'rgba(245,158,11,.10)'; }
    else                { cuando = `en ${Math.round(min / 60)} h`; color = 'var(--text-muted)'; fondo = 'transparent'; }
    const g = gestorOf(v.gestorId);
    return `<div onclick="selectVale(${v.id})" style="display:flex;align-items:center;gap:10px;background:${fondo};border:1px solid var(--border);border-radius:9px;padding:8px 11px;margin-bottom:6px;cursor:pointer;">
      <span style="font-weight:800;font-size:13px;color:${color};white-space:nowrap;">${escapeHTML(String(v.horaEntrega))}</span>
      <div style="flex:1;min-width:0;">
        <div style="font-size:12px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHTML(v.cliente || 'Cliente')}</div>
        <div style="font-size:10px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHTML((g && g.name) || '—')} · ${escapeHTML(v.articulo || '')}</div>
      </div>
      <span style="font-size:10px;font-weight:700;color:${color};white-space:nowrap;">${cuando}</span>
    </div>`;
  }).join('');
}

let _ultimaRevisionEntregas = 0;
function revisarEntregasProximas() {
  if (typeof IS_ADMIN === 'undefined' || !IS_ADMIN) return;
  // v108: la lista se repinta en cada pasada (es corta y sale barato), para que
  // la cuenta atrás no se quede congelada en pantalla.
  try { renderProximasEntregas(); } catch(e) {}
  const ahora = Date.now();
  // El aviso, en cambio, no necesita mirarse cada 5 s.
  if (ahora - _ultimaRevisionEntregas < 60000) return;
  _ultimaRevisionEntregas = ahora;

  const dados = _avisosEntregaDados();
  let cambio = false;
  for (const v of getVales()) {
    if (!_ESTADOS_ESPERANDO_ENTREGA[v.status]) continue;   // ya entregado o cancelado
    const t = _momentoEntrega(v);
    if (t == null) continue;
    if (ahora < t - AVISO_ENTREGA_MS) continue;            // todavía no toca
    // Más de 12 h tarde: el vale se quedó ahí colgado, avisar ya no ayuda.
    if (ahora > t + 12 * 3600000) continue;
    const clave = v.id + '@' + v.horaEntrega;
    if (dados.has(clave)) continue;
    dados.add(clave); cambio = true;

    const min = Math.round((t - ahora) / 60000);
    const cuando = min > 0 ? `en ${min} min` : (min === 0 ? 'ahora' : `hace ${Math.abs(min)} min`);
    const g = (typeof gestorOf === 'function') ? gestorOf(v.gestorId) : null;
    const quien = g && g.name ? ' · ' + g.name : '';
    sendBrowserNotif(
      `⏰ Entrega ${cuando} — ${v.horaEntrega}`,
      `${v.cliente || 'Cliente'}${quien}\n${v.articulo || ''}`.trim()
    );
    try { playSound('vale'); } catch(e) {}
    try { showToast(`⏰ ${v.cliente || 'Cliente'} espera su pedido ${cuando}`); } catch(e) {}
  }
  if (cambio) _guardarAvisosEntrega(dados);
}

let _reservasMemo = null, _reservasMemoTs = 0;
const _RESERVAS_MEMO_MS = 500;   // basta para cubrir una pasada de render entera
function _invalidarReservas() { _reservasMemo = null; }
// Mapa productoId → { unidades, vales:[{id, valeNum, cliente, qty}] }
function _reservasPorProducto() {
  const ahora = Date.now();
  if (_reservasMemo && (ahora - _reservasMemoTs) < _RESERVAS_MEMO_MS) return _reservasMemo;
  const mapa = new Map();
  for (const v of getVales()) {
    if (!_valeReservaActiva(v)) continue;
    for (const it of (v.valeProductos || [])) {
      if (!it || it.id == null) continue;
      const qty = parseInt(it.qty || 0, 10) || 0;
      if (qty <= 0) continue;
      let e = mapa.get(it.id);
      if (!e) { e = { unidades: 0, vales: [] }; mapa.set(it.id, e); }
      e.unidades += qty;
      e.vales.push({ id: v.id, valeNum: v.valeNum, cliente: v.cliente || '', qty });
    }
  }
  _reservasMemo = mapa; _reservasMemoTs = ahora;
  return mapa;
}
// Documento compartido con las unidades apartadas: {productoId: unidades}.
// Lo escribe solo el admin (_refrescarReservas) y lo leen todos.
let _reservasSBCache = null, _reservasSBDirty = true;
function getReservasVales() {
  if (_reservasSBDirty || !_reservasSBCache) {
    try { _reservasSBCache = JSON.parse(localStorage.getItem('axon_reservas') || '{}'); }
    catch(e) { _reservasSBCache = {}; }
    if (!_reservasSBCache || typeof _reservasSBCache !== 'object') _reservasSBCache = {};
    _reservasSBDirty = false;
  }
  return _reservasSBCache;
}
function _reservadasPorVales(pid) {
  return parseInt(getReservasVales()[String(pid)] || 0, 10) || 0;
}
// El gestor solo tiene SUS vales en el teléfono (así se recortó el consumo en
// v66), así que no puede calcular lo que han apartado los demás. El admin, que
// sí los tiene todos, publica el resultado y todo el mundo —él incluido— lee de
// ahí: una sola fórmula para los dos roles.
//
// ⚠️ v94 — POR QUÉ ESTO NO VA DENTRO DEL PRODUCTO
// En v92 este número se guardaba como un campo más de cada producto. Parecía lo
// natural y costó un día de inventario: `saveProductos()` sube el ARRAY ENTERO,
// así que para escribir un contador de reservas había que reenviar también el
// stock de todos los productos, tal y como estuviera en la copia local. Y la
// copia local de productos solo se refresca cada 5 minutos (o nunca, si la app
// está en segundo plano), mientras que los vales que disparan el recálculo
// llegan cada 5 segundos. Resultado: al reabrir la app por la noche, este
// recálculo subía el inventario de la mañana entero y borraba las ventas del
// día. Peor todavía: al encolar esa escritura, el poll se saltaba la descarga
// de productos —hay un guard que evita pisar un write pendiente—, así que el
// dato bueno no volvía a bajar nunca y lo viejo quedaba consagrado.
//
// Ahora vive en su propio sitio (`reservas`, un documento aparte de unos pocos
// bytes con {productoId: unidades}). El stock ya NO está en el camino de
// escritura de las reservas: por mucho que este cálculo se equivoque, no puede
// tocar una sola unidad de inventario.
function _refrescarReservas() {
  _invalidarReservas();
  if (typeof IS_ADMIN === 'undefined' || !IS_ADMIN) return;
  // Durante una bajada de Supabase no se escribe nada, o el guardado se tomaría
  // por un cambio del propio dispositivo. Se reintenta al salir de la bajada.
  if (typeof isSyncingFromSupabase === 'function' && isSyncingFromSupabase()) { setTimeout(_refrescarReservas, 200); return; }
  const nuevo = {};
  _reservasPorProducto().forEach((e, pid) => { if (e.unidades > 0) nuevo[String(pid)] = e.unidades; });
  const ahora = JSON.stringify(nuevo);
  if (ahora === JSON.stringify(getReservasVales())) return;   // nada que cambiar
  _safeSetLS('axon_reservas', ahora);
  _reservasSBCache = nuevo; _reservasSBDirty = false;
  setSB('reservas', nuevo);
}

// ══════════════════════════════════════════
//  COSTOS DE COMPRA  (v114)
// ══════════════════════════════════════════
// Lo que le costó cada producto al dueño. Vive FUERA del producto, y no por
// comodidad: la tabla `productos` se la baja también el teléfono del gestor
// —la necesita para el catálogo y el picker—, así que un campo `costo` dentro
// del producto sería un campo que el gestor tiene guardado en su teléfono
// aunque su app no se lo enseñe en ninguna pantalla. Basta con mirar el
// almacenamiento del navegador para leerlo.
//
// Aquí es un documento aparte —{productoId: "texto"}, unos pocos bytes— que
// SOLO pide el teléfono del admin: no entra en la lista de nodos que baja
// todo el mundo (ver _SB_SINGLETON_ADMIN en el poll). Es la misma solución
// que se le dio a `reservas` en v94 por un motivo distinto.
//
// ⚠️ Con la clave pública de Supabase cualquiera que sepa buscar podría pedir
// esta fila a mano. Lo que se garantiza es que la app del gestor no se la
// descarga ni la guarda; para blindarlo del todo haría falta cerrar la tabla
// `meta` por rol, que es otro trabajo.
let _costosCache = null, _costosDirty = true;
function getCostos() {
  if (_costosDirty || !_costosCache) {
    try { _costosCache = JSON.parse(localStorage.getItem('axon_costos') || '{}'); }
    catch(e) { _costosCache = {}; }
    if (!_costosCache || typeof _costosCache !== 'object' || Array.isArray(_costosCache)) _costosCache = {};
    _costosDirty = false;
  }
  return _costosCache;
}
const costoDe = pid => String(getCostos()[String(pid)] || '');
function setCosto(pid, texto) {
  if (typeof IS_ADMIN === 'undefined' || !IS_ADMIN) return false;
  const limpio = String(texto || '').trim();
  const mapa = { ...getCostos() };
  if (limpio) mapa[String(pid)] = limpio; else delete mapa[String(pid)];
  const ahora = JSON.stringify(mapa);
  if (ahora === JSON.stringify(getCostos())) return false;   // nada que cambiar
  _safeSetLS('axon_costos', ahora);
  _costosCache = mapa; _costosDirty = false;
  setSB('costos', mapa);
  return true;
}
// ── Costo congelado de un vale (v114) ──────────────────────────────────────
// La comisión se congela al crear el vale: si mañana cambia el catálogo, ese
// vale sigue valiendo lo que valía. Al costo le hacía falta lo mismo, o una
// subida del precio de compra cambiaría sola la ganancia de las ventas del mes
// pasado. Se congela al CONFIRMAR, que es el primer momento en que se conoce:
// el que crea el vale suele ser el gestor, y el gestor no tiene los costos.
//
// Vive en el mismo documento del admin, bajo la clave reservada `_vales`, y no
// dentro del vale: los vales de un gestor SÍ se los baja su teléfono, así que
// un campo en el vale sería el mismo agujero que se acaba de cerrar. Un id de
// producto nunca es la cadena "_vales", así que no se pisan.
const costoFijadoDe = valeId => {
  const m = getCostos()._vales;
  const n = m && m[String(valeId)];
  return (typeof n === 'number' && isFinite(n)) ? n : null;
};
// Lo que cuesta HOY la mercancía de un vale, en USD. null = no se puede saber
// (falta algún costo, o hay pesos y no hay tasa). Igual que con la comisión:
// si no sale un número bueno, mejor no congelar nada que congelar un cero.
function _costoValeHoy(v) {
  if (typeof IS_ADMIN === 'undefined' || !IS_ADMIN) return null;
  const items = (v && v.valeProductos) || [];
  if (!items.length) return null;
  let total = 0;
  for (const it of items) {
    const txt = costoDe(it.id);
    if (parsePrecioNum(txt) <= 0) return null;
    const u = _aUSD(_montoMonedas(txt));
    if (u === null) return null;
    total += u * (parseInt(it.qty, 10) || 0);
  }
  return Math.round(total * 100) / 100;
}
function _congelarCostoVale(v) {
  if (typeof IS_ADMIN === 'undefined' || !IS_ADMIN) return false;
  if (!v || costoFijadoDe(v.id) !== null) return false;   // ya estaba congelado
  const usd = _costoValeHoy(v);
  if (usd === null) return false;
  const doc = { ...getCostos() };
  doc._vales = { ...(doc._vales || {}), [String(v.id)]: usd };
  _safeSetLS('axon_costos', JSON.stringify(doc));
  _costosCache = doc; _costosDirty = false;
  setSB('costos', doc);
  return true;
}

// ══════════════════════════════════════════
//  DUEÑOS DE LA MERCANCÍA  (v117)
// ══════════════════════════════════════════
// De quién es cada producto. La tienda vende mercancía de varias personas y al
// final del día hay que decirle a cada una cuánto se vendió de lo suyo y cuánta
// comisión le toca pagar a cada gestor.
//
// Vive fuera del producto por el mismo motivo que los costos: la tabla
// `productos` se la baja también el teléfono del gestor, y de quién es la
// mercancía no es asunto suyo. Documento aparte que solo pide el admin.
//
// Forma del documento:
//   { lista: [{id, nombre}], asig: { productoId: duenoId } }
//
// Los dueños son una lista con id propio, no un texto suelto en cada producto:
// así se les puede cambiar el nombre sin perder de vista qué era suyo, y al dar
// de alta un producto se ELIGE de una lista en vez de teclear —que es como
// acababan "Pedro", "pedro" y "Pedro " siendo tres personas distintas.
let _duenosCache = null, _duenosDirty = true;

// La primera versión guardaba {productoId: "Nombre"} y estuvo publicada un rato.
// Si el documento viene con esa forma se convierte al vuelo: se da de alta un
// dueño por cada nombre distinto y se les reasignan sus productos. No se pierde
// nada de lo que se hubiera escrito.
function _normalizarDocDuenos(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { lista: [], asig: {} };
  if (Array.isArray(doc.lista) && doc.asig && typeof doc.asig === 'object') {
    return {
      lista: doc.lista.filter(d => d && d.id != null && String(d.nombre || '').trim())
                      .map(d => ({ id: Number(d.id), nombre: String(d.nombre).trim() })),
      asig: { ...doc.asig },
    };
  }
  // Forma vieja: {productoId: "Nombre"}
  const porClave = new Map();     // nombre normalizado → {id, nombre}
  const asig = {};
  let siguiente = 1;
  Object.entries(doc).forEach(([pid, nombre]) => {
    const limpio = String(nombre || '').trim();
    if (!limpio) return;
    const k = _claveDueno(limpio);
    if (!porClave.has(k)) porClave.set(k, { id: siguiente++, nombre: limpio });
    asig[String(pid)] = porClave.get(k).id;
  });
  return { lista: [...porClave.values()], asig };
}

function getDuenosDoc() {
  if (_duenosDirty || !_duenosCache) {
    let crudo = null;
    try { crudo = JSON.parse(localStorage.getItem('axon_duenos') || 'null'); } catch(e) {}
    _duenosCache = _normalizarDocDuenos(crudo);
    _duenosDirty = false;
  }
  return _duenosCache;
}
function _guardarDuenos(doc) {
  if (typeof IS_ADMIN === 'undefined' || !IS_ADMIN) return false;
  const ahora = JSON.stringify(doc);
  if (ahora === JSON.stringify(getDuenosDoc())) return false;
  _safeSetLS('axon_duenos', ahora);
  _duenosCache = doc; _duenosDirty = false;
  setSB('duenos', doc);
  return true;
}

// La lista de dueños, por nombre.
function listaDuenos() {
  return getDuenosDoc().lista.slice().sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}
const duenoPorId = id => getDuenosDoc().lista.find(d => d.id === Number(id)) || null;
// A qué dueño pertenece un producto. null = mercancía de la tienda.
const duenoIdDe = pid => {
  const v = getDuenosDoc().asig[String(pid)];
  return v == null ? null : Number(v);
};
const duenoDe = pid => { const d = duenoPorId(duenoIdDe(pid)); return d ? d.nombre : ''; };

function addDueno(nombre) {
  const limpio = String(nombre || '').trim();
  if (!limpio) return null;
  const doc = getDuenosDoc();
  const ya = doc.lista.find(d => _claveDueno(d.nombre) === _claveDueno(limpio));
  if (ya) return ya;                       // ya existe: no se duplica
  const id = doc.lista.reduce((m, d) => Math.max(m, d.id), 0) + 1;
  const nuevo = { id, nombre: limpio };
  _guardarDuenos({ lista: doc.lista.concat([nuevo]), asig: { ...doc.asig } });
  return nuevo;
}
function renameDueno(id, nombre) {
  const limpio = String(nombre || '').trim();
  if (!limpio) return false;
  const doc = getDuenosDoc();
  if (!doc.lista.some(d => d.id === Number(id))) return false;
  return _guardarDuenos({
    lista: doc.lista.map(d => d.id === Number(id) ? { ...d, nombre: limpio } : d),
    asig: { ...doc.asig },
  });
}
// Al borrar un dueño, sus productos quedan SIN dueño (mercancía de la tienda).
// No se borra nada del catálogo: el producto sigue ahí, solo deja de tener quien
// lo reclame.
function removeDueno(id) {
  const doc = getDuenosDoc();
  const asig = {};
  Object.entries(doc.asig).forEach(([pid, did]) => { if (Number(did) !== Number(id)) asig[pid] = did; });
  return _guardarDuenos({ lista: doc.lista.filter(d => d.id !== Number(id)), asig });
}
// Asignarle (o quitarle) el dueño a un producto. duenoId vacío = de la tienda.
function setDuenoProducto(pid, duenoId) {
  const doc = getDuenosDoc();
  const asig = { ...doc.asig };
  const n = Number(duenoId);
  if (duenoId === '' || duenoId == null || isNaN(n) || !duenoPorId(n)) delete asig[String(pid)];
  else asig[String(pid)] = n;
  return _guardarDuenos({ lista: doc.lista.slice(), asig });
}
// Cuántos productos del catálogo tiene asignados un dueño.
function productosDeDueno(id) {
  return getProductos().filter(p => duenoIdDe(p.id) === Number(id));
}
// Clave del grupo "sin dueño" (mercancía tuya). Se le pone un nombre en vez
// de una cadena rara: así no se confunde con un dueño que se llame así, y no
// acaba un carácter invisible dentro del código.
const _SIN_DUENO = '__tienda__';
// Dos nombres son el mismo dueño si solo cambian mayúsculas o espacios.
const _claveDueno = n => String(n || '').trim().toLowerCase().replace(/\s+/g, ' ');

// v114: la primera versión de esto guardaba el costo dentro del producto y
// estuvo publicada un rato. Si algún producto llegó a llevarlo, aquí se pasa
// al documento aparte y se le quita de encima — lo que además lo borra de los
// teléfonos de los gestores en su siguiente sincronización.
// v119: sube los dueños que se quedaron solo en este teléfono.
// Mientras `duenos` faltó en _FS_SINGLETON_DOCS, cada alta se guardaba aquí y
// la subida se perdía en silencio: quien ya tenía dueños dados de alta los ve
// bien en su teléfono y en ningún otro. Al arreglar el enrutado eso no se cura
// solo, porque _guardarDuenos solo sube cuando el documento CAMBIA — sin tocar
// nada, la nube se quedaría vacía para siempre.
//
// Solo sube si la nube NO tiene nada. Si allí ya hay una lista, manda esa: este
// teléfono podría llevar días sin abrirse y machacarla sería justo el tipo de
// escritura a ciegas que provoca los fallos de sincronización de esta app.
async function _rescatarDuenosNoSubidos() {
  if (typeof IS_ADMIN === 'undefined' || !IS_ADMIN) return;
  const local = getDuenosDoc();
  if (!local || !local.lista || !local.lista.length) return;   // nada que subir
  try {
    const remoto = await _sbRestGetMetaYTs('duenos');
    const yaHay = remoto && remoto.data && Array.isArray(remoto.data.lista) && remoto.data.lista.length;
    if (yaHay) return;                                          // la nube manda
    console.log('[duenos] la nube no los tenía — subiendo los ' + local.lista.length + ' de este teléfono');
    setSB('duenos', local);
  } catch (e) {
    // Sin red o REST caído: no se fuerza nada. Se reintenta en el próximo arranque.
    console.warn('[duenos] no se pudo comprobar la nube:', e && e.message);
  }
}

function _rescatarCostosDelProducto() {
  if (typeof IS_ADMIN === 'undefined' || !IS_ADMIN) return;
  const conCosto = getProductos().filter(p => p && p.costo);
  if (!conCosto.length) return;
  const mapa = { ...getCostos() };
  conCosto.forEach(p => { if (!mapa[String(p.id)]) mapa[String(p.id)] = String(p.costo).trim(); });
  _safeSetLS('axon_costos', JSON.stringify(mapa));
  _costosCache = mapa; _costosDirty = false;
  setSB('costos', mapa);
  conCosto.forEach(p => patchProducto(p.id, { costo: null }));
  console.log(`[costos] ${conCosto.length} costo(s) movidos fuera del producto`);
}
// Reservado de verdad = lo apartado a mano + lo comprometido por vales.
function _reservedTotal(p) {
  if (!p) return 0;
  return (parseInt(p.reserved || 0, 10) || 0) + _reservadasPorVales(p.id);
}
function _availableStock(p) {
  if (!p) return 0;
  const s = parseInt(p.stock || 0, 10);
  return Math.max(0, s - _reservedTotal(p));
}
function _isFullyReserved(p) {
  if (!p) return false;
  const s = parseInt(p.stock || 0, 10);
  return s > 0 && _reservedTotal(p) >= s;
}
function _isPartiallyReserved(p) {
  if (!p) return false;
  const s = parseInt(p.stock || 0, 10);
  const r = _reservedTotal(p);
  return r > 0 && r < s;
}

// Descuenta stock de los productos de un vale y genera notificaciones.
// Extraído de mensajeroEntrega/mensajeroPagado/mensajeroPagadoDirecto/confirmSale
// que tenían 4 copias del mismo bloque con divergencias sutiles.
// Ver AUDITORIA-AXONTECH.md MEDIO 28.
// v96: una venta ya no dice "el stock queda en 8", dice "quita 2". Si dos
// teléfonos venden el mismo producto con el mismo número en pantalla, antes uno
// pisaba al otro y se perdía una venta; ahora las dos restas se suman en el
// servidor. La resta local sigue siendo inmediata, así que se puede vender sin
// cobertura y la orden sale cuando vuelve.
function _descontarStock(v) {
  const prods = getProductos().slice();
  const deltas = {};
  let stockChanged = false;
  (v.valeProductos || []).forEach(({id:pid, qty}) => {
    const idx = prods.findIndex(p => p.id === pid);
    if (idx === -1) return;
    const oldStock = prods[idx].stock || 0;
    const newStock = Math.max(0, oldStock - qty);
    // Lo que se manda es lo que REALMENTE sale del almacén: si había 1 y se
    // venden 2, se resta 1, no 2. Así el servidor no acaba en negativo por un
    // teléfono que tenía un número inflado.
    deltas[pid] = (deltas[pid] || 0) - (oldStock - newStock);
    prods[idx] = {...prods[idx], stock: newStock};
    stockChanged = true;
    addNotif('sale_product', prods[idx].name, pid, `${qty}|${newStock}`, v.gestorId);
    if (newStock === 0 && oldStock > 0) addNotif('out_of_stock', prods[idx].name, pid, 'stock agotado');
    else if (newStock > 0 && newStock <= LOW_STOCK_THRESHOLD && oldStock > LOW_STOCK_THRESHOLD) addNotif('low_stock', prods[idx].name, pid, `quedan ${newStock}`);
  });
  if (stockChanged) guardarProductosPorDelta(prods, deltas);
  return stockChanged;
}

// v52: tipos de aviso que son PERSONALES de un gestor (su vale, su ranking).
// El resto (stock, productos nuevos) son avisos globales de la tienda.
const NOTIF_PERSONAL_TYPES = ['vale_confirmed','vale_assigned','vale_seen','vale_delivered','vale_pending','ranking_top3','meta_alcanzada','mes_ganado'];
const _esNotifPersonal = n => !!n && NOTIF_PERSONAL_TYPES.includes(n.type);

// v52 FIX: el recorte a 50 avisos era ciego y el array de notifs es GLOBAL:
// lo comparten todos los gestores y además lleva los avisos de stock/productos.
// Con el negocio en marcha (ventas de otros gestores, movimientos de stock) el
// aviso personal de un gestor —"tu venta fue cobrada"— quedaba fuera del corte
// y desaparecía antes de que ese gestor abriera la app. Es el mismo fallo que
// el del orden roto, por otra vía.
// AHORA el recorte reserva cuota: hasta 35 avisos personales y 15 globales, y
// si una categoría no llena su cuota la otra aprovecha el hueco. El total sigue
// acotado a 50 para no inflar la fila singleton de Supabase.
const NOTIF_CAP = 50, NOTIF_CAP_PERSONAL = 35;
function _trimNotifs(arr) {
  const list = (Array.isArray(arr) ? arr : []).filter(Boolean);
  if (list.length <= NOTIF_CAP) return list;
  const personales = list.filter(_esNotifPersonal);
  const globales   = list.filter(n => !_esNotifPersonal(n));
  // Cada categoría cede al otro el espacio que no usa.
  const nPersonal = Math.min(personales.length, Math.max(NOTIF_CAP_PERSONAL, NOTIF_CAP - globales.length));
  const nGlobal   = Math.min(globales.length, NOTIF_CAP - nPersonal);
  const keep = new Set([...personales.slice(0, nPersonal), ...globales.slice(0, nGlobal)]);
  return list.filter(n => keep.has(n)); // conserva el orden original del array
}

// v52 FIX: ids únicos y monótonos para las notificaciones.
// ANTES: addNotif usaba `id: Date.now()`. Varias notifs creadas en el MISMO
// milisegundo (caso real: confirmSale → _descontarStock emite un 'sale_product'
// por producto y justo después se emite el 'vale_confirmed' del gestor) recibían
// el MISMO id. Como _mergeNotifArrays deduplica con un Map por id, al primer
// merge con Supabase sobrevivía UNA sola de ellas — y la que ganaba era la
// última escrita en el Map, normalmente un 'sale_product'. Resultado: la notif
// 'vale_confirmed' del gestor desaparecía. Ese era el motivo real de que "al
// cobrar" el gestor nunca viera nada.
// El id debe seguir siendo numérico y creciente porque renderGestorNotifs lo
// compara con `n.id <= personalClearedId` y con los parseInt de
// axon_viewed_id_/axon_cleared_id_ para saber qué ya fue visto/limpiado.
let _lastNotifId = 0;
function _nextNotifId() {
  const now = Date.now();
  _lastNotifId = now > _lastNotifId ? now : _lastNotifId + 1;
  return _lastNotifId;
}

// v52: `evt` es una clave estable del EVENTO (ej. 'vale_confirmed:2001').
// Sirve para que la notif que crea el admin y la que crea el propio dispositivo
// del gestor al detectar el cambio de estado se reconozcan como el MISMO aviso
// y se colapsen en uno solo, en vez de duplicarse o perderse.
function addNotif(type, productName, productId, extra, gestorId, evt) {
  const notifs = getNotifs();
  const n = { id:_nextNotifId(), type, productName, productId, ts:new Date().toISOString(), read:false, extra:extra||'', gestorId:gestorId||null };
  if (evt) n.evt = evt;
  // Si este evento ya existe localmente, no lo duplicamos.
  if (evt && notifs.some(x => x && x.evt === evt)) return;
  notifs.unshift(n);
  saveNotifs(_trimNotifs(notifs));
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
  // v47 FIX: NO tocar las notifs personales al limpiar las globales.
  // ANTES (v46-): se seteaba 'axon_cleared_personal_<gId>'='1' aquí también,
  // lo cual hacía que limpiar el modal de novedades globales borrara PARA
  // SIEMPRE las notifs personales del gestor.
  // Ahora las personales solo se limpian con clearPersonalNotifs() y usando
  // el esquema basado en id (axon_cleared_personal_id_<gId>).
  renderGestorNotifs();
  closeNotifsModal();
}
function _notifDeletedKeys() {
  try { return JSON.parse(localStorage.getItem('axon_notifs_deleted') || '[]'); } catch(e) { return []; }
}
function _markNotifDeleted(id) {
  const keys = _notifDeletedKeys().filter(k => k !== String(id));
  keys.push(String(id));
  if (keys.length > 100) keys.splice(0, keys.length - 100);
  localStorage.setItem('axon_notifs_deleted', JSON.stringify(keys));
}
// v43: unión por id de los arrays local y remoto, sin duplicados y sin
// resucitar notificaciones eliminadas (tombstones). Cap de 50.
//
// v52 FIX (dos bugs que hacían desaparecer notificaciones):
//  1. El sort restaba `ts`, que son STRINGS ISO ('2026-08-14T...'), no números.
//     Restar dos strings da NaN, así que el comparador devolvía NaN siempre y el
//     array quedaba SIN ordenar. Como después se corta con .slice(0,50) y las
//     locales viejas van primero en el Map, cuando el gestor ya tenía 50 notifs
//     acumuladas TODA notificación nueva del admin caía fuera del corte y se
//     perdía en silencio. Ahora se ordena por fecha real (desc) antes de cortar,
//     así el cap de 50 descarta lo más viejo y nunca lo más nuevo.
//  2. Se deduplica también por `evt` (clave de evento), para que el aviso que
//     genera el admin y el que genera el propio dispositivo del gestor al
//     detectar el cambio de estado se colapsen en UNO, en vez de aparecer
//     duplicados. Se conserva el de id menor (el original) para que el id sea
//     estable entre dispositivos y no rompa la lógica de "ya visto/limpiado".
function _mergeNotifArrays(localArr, remoteArr) {
  const deleted = new Set(_notifDeletedKeys());
  const map = new Map();
  for (const n of (Array.isArray(localArr) ? localArr : [])) {
    if (n && n.id != null && !deleted.has(String(n.id))) map.set(String(n.id), n);
  }
  for (const n of (Array.isArray(remoteArr) ? remoteArr : [])) {
    if (n && n.id != null && !deleted.has(String(n.id))) map.set(String(n.id), n);
  }
  // Colapsar por evento: mismo evt → se queda el de id menor.
  const byEvt = new Map();
  for (const n of map.values()) {
    if (!n.evt) continue;
    const prev = byEvt.get(n.evt);
    if (!prev || Number(n.id) < Number(prev.id)) byEvt.set(n.evt, n);
  }
  const out = [];
  for (const n of map.values()) {
    if (n.evt && byEvt.get(n.evt) !== n) continue; // duplicado del mismo evento
    out.push(n);
  }
  const _t = v => { const ms = Date.parse(v && v.ts); return isNaN(ms) ? 0 : ms; };
  // Ordenar por fecha real (desc) y recortar respetando la cuota de avisos
  // personales, para que la actividad global no desaloje el aviso de un gestor.
  return _trimNotifs(out.sort((a, b) => _t(b) - _t(a)));
}
// v52: borra los avisos de ciclo de vida (visto/asignado/entregado/cobrado) de
// un vale concreto. Se usa al revertir una venta, para que el estado que ve el
// gestor sea coherente y un nuevo cambio de estado vuelva a notificar.
function _clearValeEventNotifs(valeId) {
  const suffix = ':' + valeId;
  const notifs = getNotifs();
  const kept = notifs.filter(n => {
    const isThisVale = n && typeof n.evt === 'string' && n.evt.endsWith(suffix);
    if (isThisVale) _markNotifDeleted(n.id); // tombstone: no revive en el próximo merge
    return !isThisVale;
  });
  if (kept.length !== notifs.length) {
    saveNotifs(kept);
    renderGestorNotifs();
  }
}
function clearSingleNotif(notifId) {
  const notifs = getNotifs();
  const idx = notifs.findIndex(n => n.id === notifId);
  if(idx !== -1) {
    _markNotifDeleted(notifId);
    notifs.splice(idx, 1);
    saveNotifs(notifs);
  }
  renderGestorNotifs();
}
function clearPersonalNotifs(gestorId) {
  if(!gestorId) return;
  // v47 FIX: Guardar el ID (Date.now()) de la notif personal más reciente
  // en vez de un flag binario '1'. Así las notifs NUEVAS (con id mayor al
  // guardado) siguen apareciendo, y solo se ocultan las que ya existían.
  // ANTES (v46-): se guardaba '1' y NUNCA se reseteaba → el gestor nunca
  // volvía a ver notifs personales aunque llegaran nuevas después de limpiar.
  const _notifs = getNotifs();
  const _mine = _notifs.filter(n =>
    NOTIF_PERSONAL_TYPES.includes(n.type) &&
    n.gestorId === gestorId
  );
  if (_mine.length > 0) {
    // getNotifs() viene ordenado desc por ts → _mine[0] es la más reciente
    localStorage.setItem('axon_cleared_personal_id_' + gestorId, String(_mine[0].id));
  }
  // Limpiar el flag binario viejo (v46-) por si estaba seteado de antes
  localStorage.removeItem('axon_cleared_personal_' + gestorId);
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
  const globalNotifs = visibleNotifs.filter(n => !NOTIF_PERSONAL_TYPES.includes(n.type));
  
  // Personal Notifs — v47 FIX: ya no usamos un flag binario 'personalCleared'.
  // Ahora usamos 'axon_cleared_personal_id_<gId>' = ID de la notif más reciente
  // al momento de limpiar. Las notifs con id > ese valor son NUEVAS y se ven.
  // ANTES (v46-): 'axon_cleared_personal_<gId>'='1' era binario y NUNCA se
  // reseteaba → después de limpiar una vez, el gestor nunca más veía notifs
  // personales nuevas (bug reportado: "los gestores nunca ven las notificaciones
  // de los estados del vale").
  const personalClearedId = activeGestorId
    ? parseInt(localStorage.getItem('axon_cleared_personal_id_' + activeGestorId) || '0', 10)
    : 0;
  // Migración: si existe el flag viejo (v46-), lo respetamos temporalmente
  // como "limpiar todo lo anterior" → lo quitamos para que las nuevas sí se vean.
  const personalClearedLegacy = activeGestorId
    ? localStorage.getItem('axon_cleared_personal_' + activeGestorId)
    : null;
  if (personalClearedLegacy === '1' && personalClearedId === 0) {
    // Primera carga tras update v47: marcar como limpiadas todas las actuales,
    // pero permitir que las FUTURAS se vean. Usamos el id mayor encontrado.
    const _legacyMine = notifs.filter(n =>
      NOTIF_PERSONAL_TYPES.includes(n.type) &&
      n.gestorId === activeGestorId
    );
    if (_legacyMine.length > 0) {
      const _legacyMaxId = _legacyMine.reduce((mx, n) => n.id > mx ? n.id : mx, 0);
      localStorage.setItem('axon_cleared_personal_id_' + activeGestorId, String(_legacyMaxId));
      // Solo borrar el flag viejo después de migrar — así no perdemos el estado
      // si el gestor recarga antes de que getNotifs devuelva datos.
      localStorage.removeItem('axon_cleared_personal_' + activeGestorId);
    }
  }
  const personalNotifs = notifs.filter(n => {
    if (!NOTIF_PERSONAL_TYPES.includes(n.type)) return false;
    if (!activeGestorId) return false;
    // v47 FIX: comparación robusta Number===Number (gestorId puede venir como
    // string desde Supabase JSON en algunos casos edge).
    if (Number(n.gestorId) !== Number(activeGestorId)) return false;
    // v47: ocultar las notifs que ya estaban presentes cuando el gestor limpió
    if (n.id <= personalClearedId) return false;
    return true;
  });
  // v51 DEBUG: log para verificar el filtro de notifs personales
  if (!IS_ADMIN && activeGestorId) {
    const _debugTotal = notifs.filter(n => NOTIF_PERSONAL_TYPES.includes(n.type)).length;
    if (_debugTotal > 0) {
      console.log('[renderGestorNotifs]', { activeGestorId, totalPersonalType: _debugTotal, afterFilter: personalNotifs.length, personalClearedId });
    }
  }

  const sec = document.getElementById('gestorNotifsSection');
  const personalSec = document.getElementById('gestorPersonalNotifsSection');
  
  const icons = {new_product:'✨',out_of_stock:'❌',low_stock:'⚠️',restocked:'✅',vale_confirmed:'🎉',sale_product:'🛒',vale_assigned:'🛵',vale_seen:'👁️',vale_delivered:'📦',vale_pending:'💰',ranking_top3:'🏆'};
  
  const renderItem = (n, isPersonal) => {
    const icon=icons[n.type]||'📢';
    const age=timeAgo(n.ts);
    const typeClass=n.type==='out_of_stock'?'agotado':n.type==='low_stock'?'low':n.type==='restocked'?'restocked':['vale_confirmed','sale_product','vale_assigned','vale_seen','vale_delivered','vale_pending','ranking_top3'].includes(n.type)?'ok':'';
    
    // Unread logic
    const nIdx = notifs.findIndex(x => x.id === n.id);
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
    } else if(n.type==='meta_alcanzada'){
      msg=`🎯 <b>¡Meta alcanzada!</b> Llegaste a los ${safeExtra} puntos — el contador vuelve a empezar.`;
    } else if(n.type==='mes_ganado'){
      msg=`🏆 <b>¡Ganaste el mes!</b> Terminaste primero con ${safeExtra} puntos.`;
    } else if(n.type==='vale_delivered'){
      msg=`📦 <b>¡Tu venta fue entregada!</b>${safeName?` · ${safeName}`:``}${safeExtra?` <span style="color:var(--gray-400);font-size:10px;">(${safeExtra})</span>`:``}`;
    } else if(n.type==='vale_pending'){
      msg=`💰 <b>Vale en proceso de cobro</b>${safeName?` · ${safeName}`:``}${safeExtra?` <span style="color:var(--gray-400);font-size:10px;">(${safeExtra})</span>`:``}`;
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
       const idx = notifs.findIndex(x => x.id === n.id);
       return viewedIdx === -1 || idx < viewedIdx;
    // v56 FIX: aquí se leía `!personalCleared`, una variable que NO EXISTE desde
    // v47 (era el flag binario que se eliminó; las que sí existen se llaman
    // personalClearedId y personalClearedLegacy). Leer una variable no declarada
    // lanza ReferenceError, y el `&&` solo llegaba a evaluarla cuando
    // personalNotifs.length era > 0 — es decir, JUSTO cuando el gestor tenía un
    // aviso que mostrar. Con 0 avisos cortocircuitaba y no fallaba, por eso el
    // fallo era invisible hasta que llegaba el primero.
    // Efecto en cadena, que es el fallo que se llevaba persiguiendo desde v47:
    //   1. renderGestorNotifs() abortaba AQUÍ, antes del bloque que pinta la
    //      sección de avisos personales → el gestor no veía NINGÚN aviso.
    //   2. addNotif() termina llamando a renderGestorNotifs(), así que el throw
    //      subía por _doRestPoll → abortaba el forEach de detección de estados
    //      ANTES del localStorage.setItem('axon_vales', ...) → el caché de vales
    //      del gestor no se guardaba y sus vales se quedaban en 'pending' en
    //      pantalla aunque en Supabase estuvieran confirmados.
    //   3. Al no guardarse, el poll siguiente volvía a detectar el mismo cambio
    //      y a lanzar el mismo error: un bucle cada 5 s del que no se salía.
    // Es el MISMO patrón que el ReferenceError de prodNames documentado arriba
    // (v52): ese se corrigió, pero este quedó aguas abajo con idéntico efecto.
    // El término sobraba además: personalNotifs ya viene filtrado por
    // personalClearedId, así que las limpiadas no se cuentan.
    }).length + (personalNotifs.length && activeGestorId ? personalNotifs.length : 0);
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
    } else {
      // v47: ya no existe el flag binario personalCleared — el filtro por id
      // (personalClearedId) en personalNotifs se encarga de ocultar las viejas.
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
  ['vales','stock','gestores','duenos','stats','mensajeros','config','historial','catalog','estafa'].forEach(t=>{
    const btn=document.getElementById('anav-'+t);if(btn)btn.classList.toggle('active',t===tab);
    const pid='admin'+t.charAt(0).toUpperCase()+t.slice(1)+'Panel';
    const el=document.getElementById(pid);
    if(el){el.style.display=t===tab?(t==='vales'?'grid':'block'):'none';}
  });
  if(tab==='vales'){renderAdminGestores();renderMensajeros();renderConfirmados();renderPendienteCobro();
    if(typeof renderProximasEntregas==='function'){try{renderProximasEntregas();}catch(e){}}  // v108
  }
  if(tab==='stock'){renderStockCategorias();renderProductGrid();}
  if(tab==='catalog'){_adminShowAgotados=false;adminCatalogCatFilter=null;renderAdminCatalogCats();renderAdminCatalog();}
  if(tab==='gestores'&&gestoresTabDirty){renderAdminGestoresList();renderComisiones();gestoresTabDirty=false;}
  if(tab==='stats'&&statsTabDirty){renderStats();statsTabDirty=false;}
  if(tab==='mensajeros'){renderMensajeroSelector();renderPendingCobroSection();renderMensajeroVales();}
  if(tab==='config'){loadGhConfigUI();}
  if(tab==='duenos'){renderDuenos();}
  if(tab==='historial'){renderHistorial();}
  if(tab==='estafa'){renderEstafaList();}
}

// ══════════════════════════════════════════
//  BADGE
// ══════════════════════════════════════════
function updateAdminBadge() {
  const n=sinVerCount();  // v84: solo los que el admin aún no ha abierto
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
// ── v42: Gestor passwords HASHEADAS (PBKDF2) — ya no se guardan en texto plano.
// Formato: 'pbkdf2$100000$<salt b64>$<hex>' · fallback legacy: 'sha256:<hex>'
// El admin NO puede ver la clave una vez hasheada — usa "↺ Resetear" para
// generar una nueva (gestiones en resetGestorPass/addGestor).
async function _hashGestorPass(input) {
  try {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const keyMaterial = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(input), 'PBKDF2', false, ['deriveBits']
    );
    const hashBuf = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
      keyMaterial, 256
    );
    let bin = '';
    salt.forEach(b => bin += String.fromCharCode(b));
    const hashArr = Array.from(new Uint8Array(hashBuf));
    return 'pbkdf2$100000$' + btoa(bin) + '$' + hashArr.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch(e) {
    const data = new TextEncoder().encode(input + '_axontech_salt_2024');
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return 'sha256:' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
}
async function _gestorPassMatches(input, stored) {
  const val = String(input || '').trim().toUpperCase();
  const sys = String(stored || '').trim();
  if (!sys) return false;
  if (sys.startsWith('pbkdf2$')) {
    try {
      const parts = sys.split('$');
      const iterations = parseInt(parts[1], 10) || 100000;
      const bin = atob(parts[2] || '');
      const salt = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) salt[i] = bin.charCodeAt(i);
      const keyMaterial = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(val), 'PBKDF2', false, ['deriveBits']
      );
      const hashBuf = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
        keyMaterial, 256
      );
      const hashArr = Array.from(new Uint8Array(hashBuf));
      const hex = hashArr.map(b => b.toString(16).padStart(2, '0')).join('');
      return _timingSafeEqual(hex, parts[3] || '');
    } catch(e) { return false; }
  }
  if (sys.startsWith('sha256:')) {
    try {
      const data = new TextEncoder().encode(val + '_axontech_salt_2024');
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      return _timingSafeEqual('sha256:' + hex, sys);
    } catch(e) { return false; }
  }
  // Legacy: texto plano (backward compat, se migra al hacer login)
  return _timingSafeEqual(val, sys.toUpperCase());
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
    if (saved !== null) {
      _gestorPassMatches(saved, g.password).then(ok => {
        if (ok) {
          // Autologuear: la contraseña guardada sigue siendo válida
          doSelectGestor(id);
          return;
        }
        _proceedGestorPassPrompt(id, g);
      });
      return;
    }
    _proceedGestorPassPrompt(id, g);
  } else {
    doSelectGestor(id);
  }
}
function _proceedGestorPassPrompt(id, g) {
  // Si había contraseña guardada pero ya no coincide (el admin la cambió),
  // limpiarla para que no reintente eternamente.
  if (_getSavedGestorPass(id) !== null) _clearSavedGestorPass(id);
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
}
function doSelectGestor(id) {
  // v65: aquí se llamaba a listenToMyVales(id), eliminada por ser código muerto.
  // Los vales del gestor los sincroniza _doRestPoll() cada 5 s vía REST.
  activeGestorId=id;
  // v114: se apunta cuál es su último aviso de meta ANTES de empezar a mirar,
  // para que al entrar no le salte la fiesta de una meta de la semana pasada.
  // A partir de aquí, cualquier aviso de meta nuevo sí se celebra.
  try {
    const k='axon_meta_celebrada_'+id;
    if(localStorage.getItem(k)===null){
      const mia=getNotifs().filter(n=>n&&(n.type==='meta_alcanzada'||n.type==='mes_ganado')&&n.gestorId===id)
        .sort((a,b)=>String(b.ts||'').localeCompare(String(a.ts||'')))[0];
      localStorage.setItem(k, mia?String(mia.id):'0');
    }
  } catch(e) {}
  // v77: dejar los campos automáticos bloqueados desde el primer momento, sin
  // esperar a que el gestor toque algo.
  setTimeout(() => { if (typeof _aplicarCamposAuto === 'function') _aplicarCamposAuto(); }, 0);const g=gestorOf(id);

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
//  - Se comprime a WebP 256x256 (≤15 KB aprox.) — ligero para Supabase
//  - Se guarda en g.photo → saveGestores() → Supabase → todos los dispositivos
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
    // 256px, calidad 0.72 — suficiente para un avatar, ligero para Supabase sync
    compressImage(e.target.result, 256, 0.72, compressed => {
      if (!compressed) { showToast('Error al procesar la imagen'); return; }
      const list = getGestores();
      const i = list.findIndex(g => g.id === activeGestorId);
      if (i === -1) return;
      list[i].photo = compressed;
      guardarGestores(list, [activeGestorId]); // sube solo esta ficha
      gestoresTabDirty = true;
      // Refrescar UI inmediatamente en este dispositivo
      doSelectGestor(activeGestorId);
      if (typeof renderAdminGestoresList === 'function') renderAdminGestoresList();
      if (typeof renderGestorRanking === 'function') { rankingCache = null; renderGestorRanking(); }
      const fmt = compressed.startsWith('data:image/webp') ? 'WebP' : 'JPEG';
      const kb = Math.round(compressed.length / 1024);
      showToast(`✅ Foto actualizada (${fmt} · ${kb} KB)`);
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
      guardarGestores(list, [activeGestorId]);
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
      compressImage(ev.target.result, 256, 0.72, compressed => {
        if (!compressed) { showToast('Error al procesar la imagen'); return; }
        const list = getGestores();
        const i = list.findIndex(g => g.id === pendingGestorPhotoId);
        if (i === -1) return;
        list[i].photo = compressed;
        guardarGestores(list, [pendingGestorPhotoId]);
        gestoresTabDirty = true;
        renderAdminGestoresList();
        renderGestores();
        showToast('✅ Foto actualizada');
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
      guardarGestores(list, [id]);
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
  const rawVal=document.getElementById('gestorPassInput').value.trim();
  const val=rawVal.toUpperCase();
  const g=gestorOf(pendingGestorId);if(!g)return;
  // v42: las claves ahora se guardan hasheadas (PBKDF2); se acepta legacy en
  // texto plano sólo para compatibilidad y se migra automáticamente al login.
  const sysPass=(g.password||'').trim();
  const btn = document.getElementById('gestorPassSubmit'); if(btn){ btn.disabled=true; btn.textContent='Verificando…'; }
  _gestorPassMatches(val, sysPass).then(ok => {
    if(btn){ btn.disabled=false; btn.textContent='Entrar'; }
    if(ok){
      // v42: migrar clave legacy (texto plano) -> hash al primer login
      if (!sysPass.startsWith('pbkdf2$') && !sysPass.startsWith('sha256:')) {
        _hashGestorPass(val).then(hash => {
          try {
            const list=getGestores();
            const i=list.findIndex(x=>x.id===g.id);
            if(i!==-1){ list[i].password=hash; guardarGestores(list, [g.id]); }
          } catch(e){ console.warn('Migración de clave gestor falló:', e); }
        }).catch(()=>{});
      }
      const id=pendingGestorId;   // save before closeGestorPassModal sets it to null
      // ¿Marcar "Recordar contraseña en este dispositivo"?
      const rememberChk = document.getElementById('gestorPassRemember');
      if (rememberChk && rememberChk.checked) {
        // Guardar el valor ORIGINAL (sin upper) para que el usuario pueda verlo
        // si algún día lo recupera. Lo compararemos siempre con .toUpperCase().
        _setSavedGestorPass(id, rawVal);
        showToast('🔒 Contraseña guardada en este dispositivo');
      }
      closeGestorPassModal();
      doSelectGestor(id);
    } else {
      document.getElementById('gestorPassError').style.display='block';
      document.getElementById('gestorPassInput').select();
    }
  }).catch(() => {
    if(btn){ btn.disabled=false; btn.textContent='Entrar'; }
    document.getElementById('gestorPassError').style.display='block';
  });
}
function changeGestor() {
  // v65: aquí se soltaba el listener de listenToMyVales, eliminada por muerta.
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
// v87: las entregas se abren en un modal en vez de pintarse al final del panel.
// Antes había que tocar el mensajero, bajar hasta el fondo de la página para ver
// sus entregas y volver a subir para cambiar de mensajero.
function selectMensajero(id) {
  activeMensajeroId=id;
  const modal=document.getElementById('mensajeroEntregasModal');
  if(modal) modal.classList.add('show');
  renderMensajeros();renderMensajeroVales();
}
function closeMensajeroEntregasModal() {
  const modal=document.getElementById('mensajeroEntregasModal');
  if(modal) modal.classList.remove('show');
  // Se suelta la selección para que la lista no siga marcando "viendo entregas"
  // a alguien cuyo modal ya está cerrado.
  activeMensajeroId=null;
  renderMensajeros();
}
// El botón "↺ Cambiar selección" desapareció con el modal (se cambia de
// mensajero cerrando y tocando otro). Se mantiene la función porque cerrar es
// exactamente lo mismo que hacía.
function changeMensajero(){ closeMensajeroEntregasModal(); }
// ── v119: la deuda del mensajero deja de deducirse del estado de la venta ──
// Hasta ahora "este mensajero tiene dinero mío" se sacaba de v.status: valía
// 'pending_payment' o 'delivered'. Pero ese mismo campo dice también si la
// VENTA está cerrada, y son dos cosas distintas que pasan por separado: el
// cliente ya pagó (la venta se cierra, el gestor gana su comisión, la venta
// cuenta en el corte de ese día) y aun así el dinero sigue en el bolsillo del
// mensajero hasta que lo trae.
//
// Como era un solo campo, el admin tenía que elegir: o cerraba la venta y la
// deuda del mensajero desaparecía de su ficha, o la dejaba abierta y entonces
// la venta no contaba el día que se cerró. Ahora la deuda vive en su propio
// campo (cobroMensajeroPend) y no le importa lo que haga la venta.
//
// Los estados viejos siguen contando: un vale entregado y sin cobrar es deuda
// del mensajero aunque sea anterior a este cambio y no lleve el campo nuevo.
const _mensajeroDebeCobro = v =>
  !!v && v.mensajeroId != null &&
  (v.cobroMensajeroPend === true || v.status === 'pending_payment' || v.status === 'delivered');

// Al cerrar una venta que llevaba mensajero hay que saber dónde está ese
// dinero. Se marca la deuda PRIMERO y luego se pregunta, no al revés: el
// confirmador solo tiene un botón, así que ignorar el aviso —o cerrarlo sin
// querer— tiene que caer del lado seguro. Y el lado seguro es que la deuda
// quede apuntada: que sobre un cobro por reclamar se arregla con un toque, que
// falte no se descubre hasta que faltan los cuartos.
function _marcarCobroMensajeroYPreguntar(id) {
  const v = getVales().find(x => x.id === id);
  if (!v || v.mensajeroId == null) return;          // sin mensajero no hay nada que preguntar
  if (v.cobroMensajeroTs) return;                   // ya se saldó antes: no se vuelve a abrir
  patchVale(id, { cobroMensajeroPend: true });
  const m = (typeof mensajeroOf === 'function') ? mensajeroOf(v.mensajeroId) : null;
  const nombre = (m && m.name) ? m.name : 'el mensajero';
  renderMensajeros(); renderMensajeroVales(); updateMensajeroBadge();
  showConfirmAction(`¿${escapeHTML(nombre)} ya te entregó el dinero?`,
    `${escapeHTML(v.cliente||'')} · ${escapeHTML(v.total||'')}<br><span style="font-size:11px;color:var(--text-muted);">Si no, queda apuntado como pendiente en su ficha.</span>`,
    'Sí, ya lo tengo', 'btn-green', () => mensajeroEntregoDinero(id, true));
}

// Se llama cuando el mensajero por fin entrega el dinero. NO toca el estado de
// la venta: puede llevar días cerrada.
function mensajeroEntregoDinero(id, skipConfirm) {
  const v = getVales().find(x => x.id === id);
  if (!v) return;
  if (!skipConfirm) {
    showConfirmAction('¿El mensajero te entregó el dinero?',
      `${escapeHTML(v.cliente||'')} · ${escapeHTML(v.total||'')}`,
      'Sí, lo recibí', 'btn-green', () => mensajeroEntregoDinero(id, true));
    return;
  }
  patchVale(id, { cobroMensajeroPend: false, cobroMensajeroTs: new Date().toISOString() });
  renderMensajeros(); renderMensajeroVales(); renderPendingCobroSection();
  updateMensajeroBadge(); maybeAutoSync();
  showToast('Dinero recibido del mensajero ✓');
}

function renderMensajeroVales() {
  const c=document.getElementById('mensajeroEntregasBody');if(!c)return;
  const _tit=document.getElementById('mensajeroEntregasTitulo');
  const _sub=document.getElementById('mensajeroEntregasSub');
  if(!activeMensajeroId){
    if(_tit) _tit.textContent='🛵 Entregas';
    if(_sub) _sub.textContent='';
    c.innerHTML='<div class="es"><div class="es-icon">🛵</div><div class="es-text">Selecciona un mensajero para ver sus entregas</div></div>';return;
  }
  // v88: un vale entregado pero sin cobrar SIGUE siendo trabajo del mensajero,
  // así que se queda en la misma lista de arriba con la chapa de pendiente en
  // vez de bajar a otra sección. Como el orden es por fecha del vale (que no
  // cambia al entregarlo), la tarjeta ni se mueve de sitio: solo cambia su
  // chapa y su botón.
  // 'delivered' es un estado heredado que ya ningún flujo produce, pero queda en
  // datos antiguos — entra aquí también para que no se pierda de vista.
  const _ES_ACTIVO={assigned:1,delivered:1,pending_payment:1};
  // v119: una venta ya cerrada cuyo dinero sigue con el mensajero SIGUE siendo
  // trabajo suyo, así que se queda arriba con las activas en vez de bajar a
  // "confirmados", donde se perdía de vista justo lo que hay que reclamar.
  const _sigueActivo = v => !!_ES_ACTIVO[v.status] || _mensajeroDebeCobro(v);
  const activos=ordenarRecientesPrimero(getVales().filter(v=>v.mensajeroId===activeMensajeroId&&_sigueActivo(v)));
  const confirmados=ordenarRecientesPrimero(getVales().filter(v=>v.mensajeroId===activeMensajeroId&&v.status==='confirmed'&&!_mensajeroDebeCobro(v)));
  const nPorEntregar=activos.filter(v=>v.status==='assigned').length;
  const nPorCobrar=activos.length-nPorEntregar;
  // La cabecera se repinta en cada render, así que al marcar una entrega el
  // número de arriba se mueve solo.
  const _m=mensajeroOf(activeMensajeroId);
  if(_tit) _tit.textContent='🛵 '+((_m&&_m.name)||'Mensajero');
  if(_sub){
    const partes=[];
    if(nPorEntregar) partes.push(`${nPorEntregar} por entregar`);
    if(nPorCobrar) partes.push(`${nPorCobrar} por cobrar`);
    if(!partes.length) partes.push('Sin entregas activas');
    _sub.textContent=partes.join(' · ')+((_m&&_m.phone)?' · 📱 '+_m.phone:'');
  }
  let html='';
  if(!activos.length&&!confirmados.length){
    html='<div class="es"><div class="es-icon">✅</div><div class="es-text">Sin entregas asignadas</div></div>';
  } else {
    if(activos.length){
      html+='<div class="lbl" style="margin-top:0;">En curso</div>';
      html+=activos.map(v=>{
        const g=gestorOf(v.gestorId);
        const m = v.mensajeroId ? mensajeroOf(v.mensajeroId) : null;
        const porEntregar = v.status==='assigned';
        // v119: tres situaciones, no dos. La tercera es nueva: la venta ya está
        // cerrada (el cliente pagó, el gestor cobró su comisión) y lo único que
        // falta es que el mensajero traiga el dinero. Antes no podía existir
        // —cerrar la venta borraba la deuda— y la tarjeta ofrecía "confirmar
        // venta" sobre una venta que ya estaba confirmada.
        const soloFaltaElDinero = !porEntregar && v.status==='confirmed';
        const chapa = porEntregar
          ? '<span class="sp-assigned" style="font-size:9px;padding:2px 6px;">🛵 Asignado</span>'
          : soloFaltaElDinero
            ? '<span style="color:var(--orange);font-size:10px;font-weight:700;" title="La venta ya está cerrada; falta que el mensajero entregue el dinero">💵 Te debe el dinero</span>'
            : '<span style="color:var(--orange);font-size:10px;font-weight:700;">⏳ Pendiente de cobro</span>';
        const acciones = porEntregar
          ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:8px;">
            <button class="btn btn-green btn-sm btn-full" onclick="mensajeroEntrega(${v.id})">📦 Entregado</button>
            <button class="btn btn-green btn-sm btn-full" style="background:#2563EB;color:white;" onclick="mensajeroPagadoDirecto(${v.id})">💰 Pagado</button>
          </div>`
          : soloFaltaElDinero
            ? `<button class="btn btn-green btn-sm btn-full" style="margin-top:8px;" onclick="mensajeroEntregoDinero(${v.id})">💵 Me entregó el dinero</button>`
            : `<button class="btn btn-green btn-sm btn-full" style="margin-top:8px;" onclick="mensajeroPagado(${v.id})">💰 Cobrado — confirmar venta</button>`;
        const waBtn = (porEntregar && m && m.phone)
          ? `<button class="btn btn-sm btn-full" style="background:#25D366;color:white;margin-top:4px;" onclick="openMensajeroWhatsApp(${m.id}, buildShareText(getVales().find(x=>x.id===${v.id}), mensajeroOf(${v.mensajeroId})))">💬 WhatsApp al mensajero</button>`
          : '';
        return `<div class="mv-card ${porEntregar?'st-assigned':'st-pending_payment'}">
          <div class="mv-head"><span class="mv-time">${timeStr(porEntregar?v.ts:(v.deliveredTs||v.ts))}</span>${chapa}</div>
          <div class="mv-info"><b>${escapeHTML(v.cliente||'—')}</b> · ${escapeHTML(v.telefono||'—')}</div>
          <div style="font-size:11px;color:var(--gray-400);">📍 ${escapeHTML(v.direccion||'Sin dirección')}</div>
          <div style="font-size:12px;font-weight:700;margin-top:3px;">💰 ${escapeHTML(v.total||'—')}${v.vuelto?` · Vuelto: ${escapeHTML(v.vuelto)}`:''}</div>
          ${g?`<div style="font-size:11px;color:var(--gray-400);">Gestor: ${escapeHTML(g.name)}</div>`:''}
          <div style="font-size:11px;color:var(--gray-600);margin-top:3px;">📦 ${escapeHTML(v.articulo||'—')}</div>
          ${acciones}
          ${waBtn}
        </div>`;
      }).join('');
    }
    if(confirmados.length){
      // v87: los cobrados son el historial completo del mensajero y no paran de
      // crecer. En el panel daba igual porque quedaban al fondo de la página;
      // dentro del modal se enseñan solo los últimos 15 para que las entregas
      // pendientes, que es a lo que se viene, no queden sepultadas.
      const _MAX_COBRADOS=15;
      const _confMostrar=confirmados.slice(0,_MAX_COBRADOS);
      html+=`<div class="lbl" style="margin-top:16px;">Cobrados / Completados${confirmados.length>_MAX_COBRADOS?` <span style="font-weight:400;color:var(--gray-400);">· últimos ${_MAX_COBRADOS} de ${confirmados.length}</span>`:''}</div>`;
      html+=_confMostrar.map(v=>{
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
  // Con el modal abierto, al marcar una entrega hay que refrescar también la
  // lista de detrás: su globo 🛵 y el orden dependen de estos mismos vales. Se
  // hace aquí y no en cada acción (mensajeroEntrega, mensajeroPagado…) para no
  // repetir la misma llamada en cinco sitios.
  const _modalAbierto=document.getElementById('mensajeroEntregasModal');
  if(_modalAbierto&&_modalAbierto.classList.contains('show')) renderMensajeros();
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
// Lo que se le DEBE a un gestor: todo lo de sus ventas cobradas que aún no ha
// cobrado él. Incluye lo que está "en sobre".
//
// ⚠ v102 — esto estaba mal y por eso el panel parecía no ordenarse.
// La versión anterior descartaba los vales con commissionStatus 'en_sobre', y
// resulta que ahí es donde está casi todo el dinero: un gestor con once vales y
// $185 + 46500 MN apartados en sobres contaba como CERO para el orden y caía al
// final de la lista, entre los que no han vendido nada. En pantalla se le veía
// su chapa con la cifra —esa sí sumaba el sobre—, así que la lista parecía
// ignorar un número que estaba ahí escrito.
//
// "En sobre" significa apartado, no pagado: el gestor sigue sin tener ese
// dinero en la mano. Para saber a quién hay que pagar —que es para lo que se
// usa esta lista— cuenta igual que lo pendiente. Lo único que sale de la cuenta
// es lo ya cobrado.
// ── v104: ¿este vale ya le genera comisión al gestor? ───────────────────────
// Desde v52 la respuesta era "solo si está cobrado", y el razonamiento tenía
// sentido: no contar como ganado un dinero que aún no ha entrado en caja.
// Pero en la práctica el trabajo del gestor termina cuando la mercancía llega
// al cliente; que el mensajero tarde en liquidar es asunto entre el mensajero y
// la tienda, y mientras tanto el gestor no veía nada de lo que ya había
// vendido. Decisión del 17/08/2026: cuenta desde que se entrega.
//
// El riesgo —comisión contada por una venta que luego se cae— está cubierto:
// las comisiones NO se guardan, se calculan a partir del estado del vale cada
// vez que se miran. Si el vale se revierte o se cancela, su comisión desaparece
// sola en la misma pasada, igual que el stock vuelve al almacén.
//
// Esta pregunta se contesta AQUÍ y en ningún otro sitio. Estaba escrita seis
// veces con el mismo comentario copiado, que es exactamente cómo empiezan las
// divergencias que luego cuestan una tarde de búsqueda.
function _valeGeneraComision(v) {
  return !!v && (v.status === 'confirmed' || v.status === 'pending_payment');
}
function comisionPendienteDe(gestorId) {
  const vs = getVales().filter(v => v.gestorId === gestorId && _valeGeneraComision(v)
    && !v.commissionPaid && v.commissionStatus !== 'cobrado');
  try { return sumCommissions(vs); } catch(e) { return { usd: 0, mn: 0 }; }
}
// Compara dos gestores por lo que se les debe, de más a menos. Devuelve 0 si
// deben lo mismo, para que quien llame decida el desempate.
function _cmpComisionPendiente(a, b) {
  const A = comisionPendienteDe(a.id), B = comisionPendienteDe(b.id);
  if ((B.usd || 0) !== (A.usd || 0)) return (B.usd || 0) - (A.usd || 0);
  if ((B.mn || 0) !== (A.mn || 0)) return (B.mn || 0) - (A.mn || 0);
  return 0;
}

// v116: foto del orden de la lista mientras el modal de comisiones está
// abierto. Se declara junto a quien la LEE: si se quedara al lado de quien la
// escribe (~5000 líneas más abajo) y algo renderizara durante la carga, sería
// un ReferenceError por la zona muerta de `let`.
let _ordenGestoresCongelado = null;
function renderAdminGestoresList() {
  // v83: orden por comisión pendiente, de mayor a menor. Este panel se usa para
  // ver a quién hay que pagar, así que lo útil es que los que más tienen
  // acumulado salgan primero, no que salgan por orden alfabético.
  // Los que no deben nada quedan al final por nombre: sortGestoresAlpha va
  // primero y Array.sort es estable, así que la lista no baila entre recargas.
  // v116: con el modal de comisiones abierto, la lista se REFRESCA pero NO se
  // reordena. Se ordena por lo que se le debe a cada gestor, así que cada
  // comisión que tocas lo movería de sitio bajo el modal; al cerrar te
  // encontrarías otra lista. Se congela el orden mientras dura la faena y se
  // recalcula al cerrar. Las chapas sí se actualizan al momento.
  let list = sortGestoresAlpha(getGestores()).slice().sort(_cmpComisionPendiente);
  if (Array.isArray(_ordenGestoresCongelado)) {
    const pos = new Map(_ordenGestoresCongelado.map((id, i) => [id, i]));
    // Un gestor creado a mitad no está en la foto: va al final, no se pierde.
    list.sort((a, b) => (pos.has(a.id) ? pos.get(a.id) : 1e9) - (pos.has(b.id) ? pos.get(b.id) : 1e9));
  }
  const c=document.getElementById('adminGestoresPanel-list');
  _updateGestoresCountBadge();
  if(!c) return;
  if(!list.length){c.innerHTML='<div class="es"><div class="es-icon">👥</div><div class="es-text">Sin gestores. Agrega uno arriba.</div></div>';return;}
  c.innerHTML=list.map(g=>{
    const vales=getVales().filter(v=>v.gestorId===g.id);
    const today=vales.filter(v=>new Date(v.ts).toDateString()===todayStr()).length;
    const pts=getGestorPoints(g.id);   // v114: los del ciclo, los que corren hacia la meta
    const hasPhoto = !!(g.photo && /^(https?:|data:image|photos\/|\.\/photos\/)/i.test(g.photo));

    // Comisiones de este gestor, repartidas en los tres montones.
    const {pendientes,enSobre,cobrados}=_comisionesDe(g.id);
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

    return `<div class="gp-card" data-gestor-id="${g.id}">
      <div class="gp-card-top">
        <div class="g-avatar" style="background:${hasPhoto?'transparent':g.color};width:44px;height:44px;font-size:14px;flex-shrink:0;position:relative;">${gestorAvatarInner(g)}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:800;font-size:15px;color:var(--text);">${escapeHTML(g.name)}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:1px;">${vales.length} vales · ${today} hoy · ⭐ ${pts} pts</div>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" style="color:var(--red);flex-shrink:0;" onclick="removeGestor(${g.id})">Eliminar</button>
      </div>

      <div class="gp-card-actions">
        <span id="gpw-${g.id}" style="background:var(--gray-200);border-radius:6px;padding:3px 9px;font-family:monospace;font-weight:700;font-size:12px;letter-spacing:1px;color:var(--text);cursor:pointer;" onclick="toggleGestorPass(${g.id})" title="Click para ver clave (solo claves legacy no encriptadas)">${(g.password||'').startsWith('pbkdf2$')||(g.password||'').startsWith('sha256:') ? '🔒 Encriptada' : '🔑 ' + escapeHTML(g.password||'—').replace(/./g, '•')}</span>
        <button type="button" style="background:none;border:1px solid var(--gray-400);cursor:pointer;font-size:10px;color:var(--gray-700);padding:2px 7px;border-radius:4px;font-weight:600;" onclick="copyGestorPass(${g.id})">📋 Copiar</button>
        <button type="button" style="background:none;border:1px solid var(--blue);cursor:pointer;font-size:10px;color:var(--blue);padding:2px 7px;border-radius:4px;font-weight:600;" onclick="resetGestorPass(${g.id})">↺ Resetear</button>
        <button type="button" style="background:none;border:1px solid var(--gray-400);cursor:pointer;font-size:10px;color:var(--gray-700);padding:2px 7px;border-radius:4px;font-weight:600;" onclick="openEditGestorModal(${g.id})">✏️ Editar</button>
        <button type="button" style="background:none;border:1px solid var(--blue);cursor:pointer;font-size:10px;color:var(--blue);padding:2px 7px;border-radius:4px;font-weight:600;" onclick="changeGestorPhotoById(${g.id})" title="Cambiar foto de perfil">📷 Foto</button>
        ${hasPhoto?`<button type="button" style="background:none;border:1px solid var(--red);cursor:pointer;font-size:10px;color:var(--red);padding:2px 7px;border-radius:4px;font-weight:600;" onclick="removeGestorPhotoById(${g.id})" title="Quitar foto de perfil">✕ Quitar foto</button>`:''}
      </div>

      <div class="gp-card-com" onclick="toggleComisionGestor(${g.id})" title="Abrir las comisiones de ${escapeHTML(g.name)}">
        <span style="font-size:11px;font-weight:700;color:var(--text-muted);flex-shrink:0;">💰 Comisiones</span>
        <div style="display:flex;gap:4px;flex-wrap:wrap;flex:1;">${comBadgeHTML}</div>
        <span style="color:var(--gray-400);font-size:12px;flex-shrink:0;">›</span>
      </div>
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
function saveEditGestor() {
  const id=parseInt(document.getElementById('editGestorModal').dataset.gestorId);
  const newName=document.getElementById('editGestorInput').value.trim();
  if(!newName){showToast('El nombre no puede estar vacío');return;}
  const list=getGestores();const i=list.findIndex(g=>g.id===id);if(i===-1)return;
  if(list.some(g=>g.id!==id&&g.name.toLowerCase()===newName.toLowerCase())){showToast('Ese nombre ya existe');return;}
  list[i].name=newName;
  list[i].initials=newName.split(/\s+/).filter(Boolean).map(w=>w[0]).join('').toUpperCase().slice(0,2);
  list[i].phone=(document.getElementById('editGestorPhoneInput')?.value||'').trim();
  // ── Aplicar cambios de foto pendientes (subir/quitar) ──
  if (window._editGestorPhotoPending) {
    list[i].photo = window._editGestorPhotoPending;
  } else if (window._editGestorPhotoRemoved) {
    delete list[i].photo;
  }
  guardarGestores(list, [id]); // sube solo la ficha editada
  closeEditGestorModal();
  gestoresTabDirty=true;rankingCache=null;
  renderAdminGestoresList();renderGestores();renderAdminGestores();renderGestorRanking();
  // Si el gestor editado es el activo, refrescar su banner también
  if (activeGestorId === id) doSelectGestor(id);
  maybeAutoSync();
  showToast('Gestor editado ✓');
}

function resetGestorPass(id) {
  const list=getGestores();const i=list.findIndex(g=>g.id===id);if(i===-1)return;
  const np=genPassword().trim().toUpperCase();
  _hashGestorPass(np).then(hash => {
    list[i].password=hash;guardarGestores(list, [id]);
    _logAudit('gestor_pass_reset', 'gestor:' + id);
    gestoresTabDirty=true;
    renderAdminGestoresList();maybeAutoSync();showToast(`Nueva clave: ${np}`);
  }).catch(() => { showToast('No se pudo encriptar la clave, reintenta'); });
}
// toggleGestorPass / copyGestorPass now look up the password by gestor id
// instead of receiving it via the onclick attribute. This eliminates the
// XSS risk of interpolating the password into an HTML attribute (BUG-009).
// v42: las claves almacenadas ya están hasheadas — no se pueden revelar;
// el admin usa "↺ Resetear" para generar una nueva.
function toggleGestorPass(id) {
  const g=gestorOf(id);if(!g)return;
  const pass=g.password||'';
  const el=document.getElementById('gpw-'+id);if(!el)return;
  const hashed = pass.startsWith('pbkdf2$') || pass.startsWith('sha256:');
  if (hashed) {
    el.textContent='🔒 Encriptada';
    showToast('Clave encriptada — usa "↺ Resetear" para generar una nueva');
    return;
  }
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
  const hashed = pass.startsWith('pbkdf2$') || pass.startsWith('sha256:');
  if (hashed) { showToast('Clave encriptada — usa "↺ Resetear" para generar una nueva'); return; }
  navigator.clipboard.writeText(pass).then(()=>showToast('Contraseña copiada ✓')).catch(()=>showToast('No se pudo copiar'));
}

function removeGestor(id) {
  const g = gestorOf(id);
  if (!g) return;
  const hasVales = getVales().some(v=>v.gestorId===id);
  const sub = hasVales ? 'Tiene vales registrados. Si lo borras, quedarán huérfanos.' : 'El gestor será borrado del sistema.';
  showConfirmAction('¿Eliminar a ' + g.name + '?', sub, 'Eliminar', 'btn-red', () => {
    const newList = getGestores().filter(x=>x.id!==id);
    guardarGestores(newList, [id]);   // el id ausente viaja como null → borra la fila
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
  const initials=name.split(/\s+/).filter(Boolean).map(w=>w[0]).join('').toUpperCase().slice(0,2);
  const list=getGestores();
  if(list.some(g=>g.name.toLowerCase()===name.toLowerCase())){showToast('Ya existe ese gestor');return;}
  const color=GESTOR_COLORS[list.length%GESTOR_COLORS.length];
  const password=genPassword().trim().toUpperCase();
  _hashGestorPass(password).then(hash => {
    const nuevoId=Date.now();
    list.push({id:nuevoId,name,initials,color,password:hash,phone});
    guardarGestores(list, [nuevoId]);
    const ph=document.getElementById('newGestorPhoneInput');if(ph)ph.value='';
    gestoresTabDirty=true;rankingCache=null;
    renderAdminGestoresList();renderGestores();renderAdminGestores();renderGestorRanking();
    maybeAutoSync();
    showToast(`Gestor agregado ✓ · Clave: ${password}`);
  }).catch(() => { showToast('No se pudo encriptar la clave, reintenta'); });
  inp.value='';
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
  
  // Solo gestores con AL MENOS UN vale activo (excluye confirmed y cancelled).
  // v52 FIX: antes también excluía 'delivered', pero ese NO es un estado final:
  // renderValeDetail ofrece para él "Confirmar venta + Entregado / Pendiente de
  // cobro". Al ocultarlo, un vale en 'delivered' quedaba huérfano — invisible en
  // el panel y por tanto imposible de cerrar. Es el mismo fallo ya corregido en
  // revertConfirmSale (AUDITORIA-AXONTECH.md ALTO 8) que aquí seguía vivo.
  // Ningún flujo actual produce 'delivered', pero sí aparece en datos antiguos
  // y en los datos de demostración.
  const _activo = v => v.status !== 'confirmed' && v.status !== 'cancelled';
  const gestoresConPendientes = gestores.filter(g => {
     return vales.some(v => v.gestorId === g.id && _activo(v));
  });

  // ── v107: los vales que no son de ningún gestor de la lista ────────────────
  // Dos casos, el mismo síntoma: el vale existe pero no se ve en ninguna parte.
  //   · Los que hace el admin eligiendo "👤 Admin" (gestorId 0).
  //   · Los huérfanos: al borrar un gestor la app avisa de que "quedarán
  //     huérfanos", y hasta ahora huérfano quería decir invisible.
  // Se agrupan bajo la ficha de la tienda para que se puedan atender igual.
  const _idsReales = new Set(gestores.map(g => g.id));
  const _sinDuenno = vales.some(v => _activo(v) && !_idsReales.has(v.gestorId));
  if (_sinDuenno) gestoresConPendientes.push(GESTOR_TIENDA);

  // ── v99: orden de la bandeja ────────────────────────────────────────────────
  // Antes salían en el orden en que se dieron de alta, así que un gestor con un
  // vale SIN VER podía quedar en mitad de la lista —su chapa roja pasaba
  // desapercibida— mientras arriba había gente sin nada que atender.
  // Ahora mandan, por este orden:
  //   1. quien tiene vales sin mirar (lo que hay que atender ya),
  //   2. a quien más comisión se le debe (misma regla que el panel de pagos),
  //   3. el nombre, para que la lista no baile entre recargas.
  const _sinVerDe = g => vales.filter(v => v.gestorId === g.id
    && v.status === 'pending' && !v.seenByAdmin).length;
  const _ordenados = sortGestoresAlpha(gestoresConPendientes).sort((a, b) => {
    const nuevosA = _sinVerDe(a), nuevosB = _sinVerDe(b);
    if (nuevosA !== nuevosB) return nuevosB - nuevosA;
    return _cmpComisionPendiente(a, b);
  });

  if(gestoresConPendientes.length === 0) {
     c.innerHTML = '<div class="es"><div class="es-icon">🎉</div><div class="es-text" style="font-weight:600;">No hay ningún vale pendiente.</div></div>';
     return;
  }

  _ordenados.forEach(g => {
    // Solo vales activos (no confirmed/cancelled) — 'delivered' incluido, ver arriba.
    // La ficha de la tienda recoge TODO lo que no tiene dueño en la lista: sus
    // propios vales (gestorId 0) y los huérfanos de un gestor borrado.
    const _mio = g._tienda ? (v => !_idsReales.has(v.gestorId)) : (v => v.gestorId === g.id);
    const pendingVales = ordenarRecientesPrimero(vales.filter(v => _mio(v) && v.status !== 'confirmed' && v.status !== 'cancelled'));
    const isOpen = adminGestorFilter === g.id;

    html += `<div style="margin-bottom:8px;">
      <div style="display:flex;align-items:center;justify-content:space-between;background:var(--surface);border:1px solid ${isOpen?'var(--blue)':'var(--border)'};border-radius:10px;padding:12px 14px;cursor:pointer;font-weight:700;font-size:14px;transition:0.2s;" onclick="setGestorFilter(${isOpen ? 'null' : g.id})">
         <div style="display:flex;align-items:center;gap:12px;">
           <div class="ag-avatar" style="background:${g.color};width:32px;height:32px;font-size:12px;color:white;display:flex;align-items:center;justify-content:center;border-radius:50%;">${escapeHTML(g.initials)}</div>
           <span>${escapeHTML(g.name)}</span>
         </div>
         <div style="display:flex;align-items:center;gap:12px;">
           ${(() => {
             // v93: cuántos de sus vales tienen stock apartado. Va aparte del
             // contador de nuevos porque son dos cosas distintas: uno es "míralo",
             // el otro es "esto tiene mercancía comprometida".
             const _res = pendingVales.filter(_valeReservaActiva).length;
             return _res ? `<span style="background:rgba(180,83,9,.15);color:#b45309;border:1px solid rgba(180,83,9,.35);border-radius:12px;padding:3px 9px;font-size:11px;font-weight:700;white-space:nowrap;" title="${_res} vale${_res>1?'s':''} con stock apartado">🔐 ${_res}</span>` : '';
           })()}
           ${(() => {
             // v114: cuántos de sus vales van ya con un mensajero. Al lado del
             // candado y por el mismo motivo: saberlo sin tener que desplegar el
             // grupo y abrir los vales uno a uno.
             const _conMoto = pendingVales.filter(v => v.status === 'assigned').length;
             return _conMoto ? `<span style="background:rgba(217,119,6,.15);color:var(--orange);border:1px solid rgba(217,119,6,.35);border-radius:12px;padding:3px 9px;font-size:11px;font-weight:700;white-space:nowrap;" title="${_conMoto} vale${_conMoto>1?'s':''} con mensajero">🛵 ${_conMoto}</span>` : '';
           })()}
           ${(() => {
             // v85: el número rojo contaba TODOS los vales activos del gestor,
             // vistos o no, así que no bajaba nunca y no servía para saber si
             // había entrado algo nuevo. Ahora el rojo son los que faltan por
             // mirar; si no queda ninguno, se enseña el total en gris — sigue
             // haciendo falta ver cuántos hay en curso, pero sin alarma.
             const _sinVer = pendingVales.filter(x => x.status === 'pending' && !x.seenByAdmin).length;
             if (_sinVer > 0) return `<span style="background:var(--red);color:white;border-radius:12px;padding:3px 9px;font-size:11px;font-weight:700;">${_sinVer} nuevo${_sinVer > 1 ? 's' : ''}</span>`;
             if (pendingVales.length > 0) return `<span style="background:var(--surface3);color:var(--text-muted);border-radius:12px;padding:3px 9px;font-size:11px;font-weight:600;">${pendingVales.length} en curso</span>`;
             return '';
           })()}
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
  // v114: el icono lo llevaba el detalle del vale desde siempre, pero la tarjeta
  // de la bandeja solo el texto. En una lista larga eso obliga a leer estado por
  // estado; un 🛵 se ve de un vistazo y dice lo que más importa saber de un
  // golpe: ese vale ya salió de la tienda.
  const _vStatus = v.status || 'pending';   // v51 FIX: por si llegó sin status
  const s=estadoVale(v);
  const isNew=v.isNew&&_vStatus==='pending';
  const sel=v.id===selectedValeId;
  const estafaMatch=checkEstafaMatch(v);
  const estafaBorder=estafaMatch.length?'border-left:3px solid var(--red);':'';
  const estafaTag=estafaMatch.length?'<span style="background:var(--red);color:white;border-radius:6px;padding:1px 6px;font-size:9px;font-weight:700;margin-left:4px;">🚫 ESTAFA</span>':'';
  // v93: chapa de reservado, para saber de un vistazo qué vales tienen mercancía
  // apartada sin tener que abrirlos uno a uno.
  const reservaTag=_valeReservaActiva(v)?'<span style="background:rgba(180,83,9,.15);color:#b45309;border:1px solid rgba(180,83,9,.35);border-radius:6px;padding:1px 6px;font-size:9px;font-weight:700;margin-left:4px;white-space:nowrap;">🔐 RESERVADO</span>':'';
  return `<div class="ic ${sel?'sel':''} ${isNew?'is-new':''}" onclick="selectVale(${v.id})" style="${sel?'border: 1px solid var(--blue); background: var(--blue-lt);':'margin-bottom:6px;padding:10px;background:var(--surface);'}${estafaBorder}">
    ${isNew?'<div class="new-dot"></div>':''}
    <div class="ic-head" style="margin-bottom:4px;">
      <span class="ic-time">${timeStr(v.ts)}</span>
    </div>
    <div class="ic-cliente" style="font-size:13px;margin-bottom:2px;">${v.valeNum?`<span style="font-weight:800;color:var(--blue);">${valeNumStr(v)}</span> `:``}${escapeHTML(v.cliente||'Sin nombre')}${estafaTag}${reservaTag}${_chipHoraEntrega(v)}</div>
    <div class="ic-preview" style="font-size:11.5px;color:var(--gray-500);">${escapeHTML(v.articulo||'Sin artículo')}</div>
    ${v.adminNotes?`<div style="background:var(--yellow);color:#1a1a2e;border-radius:4px;padding:2px 6px;font-size:10px;font-weight:700;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">📝 ${escapeHTML(v.adminNotes)}</div>`:``}
    <div class="ic-foot" style="margin-top:8px;">
      <span class="sp ${s.cls}" style="font-size:10px;">${s.icon?s.icon+' ':''}${s.label}</span>
      <span style="font-size:12px;color:var(--text);font-weight:800;">${escapeHTML(v.total||'')}</span>
    </div>
  </div>`;
}

function selectVale(id) {
  const v = getVales().find(x => x.id === id);
  // Fire "seen" notif to the gestor ONCE: on the first open of a vale that was
  // submitted by a gestor (not auto-generated by admin).
  const fromGestor = !!(v && v.gestorId && v.adminNotes !== 'Generado por Admin');
  const alreadySeen = !!(v && v.seenByAdmin);
  selectedValeId = id;
  patchVale(id, { isNew: false, seenByAdmin: true, seenTs: new Date().toISOString() });
  if (fromGestor && !alreadySeen) {
    // v52 FIX: antes exigía además `wasNew` (v.isNew). Si el flag isNew se había
    // perdido en una sincronización, el admin abría el vale, se marcaba
    // seenByAdmin... y NO se creaba la notif "visto por admin". Basta con que sea
    // un vale de gestor que aún no estaba visto.
    addNotif('vale_seen', v.cliente || 'Cliente', null, valeNumStr(v) || '', v.gestorId, 'vale_seen:' + id);
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
  // v88: el botón ya no se enseña en las recogidas en tienda, pero el freno va
  // aquí también: un teléfono con la versión anterior en caché lo seguiría
  // enseñando, y asignar un mensajero a una recogida deja el vale esperando una
  // entrega que nunca va a existir.
  if(v.recogidaTienda&&v.status==='pending'){showToast('Recogida en tienda — no lleva mensajero 🏬');return;}
  const g=gestorOf(v.gestorId);
  document.getElementById('shareModalSub').textContent=`Vale de ${g?g.name:'—'} · ${v.cliente||'cliente'}`;
  const sel=document.getElementById('mensajeroSelect');
  sel.innerHTML=mensajeros.map(m=>`<option value="${m.id}">${escapeHTML(m.name)}</option>`).join('');
  if(v.mensajeroId)sel.value=v.mensajeroId;
  updateSharePreview();sel.onchange=updateSharePreview;
  document.getElementById('shareModal').classList.add('show');
}

// ── v76: la rebaja del gestor baja lo que paga el cliente ───────────────────
// En v75 se implementó como "el gestor cobra menos pero el cliente paga igual",
// siguiendo la maqueta. En la práctica el negocio funciona al revés: el gestor
// cede $10 de su comisión PARA QUE el cliente pague $10 menos. Si el admin no lo
// ve, cobra el precio de lista y el cliente paga de más.
// Devuelve null si no hay rebaja. Si la moneda de la rebaja no coincide con la
// del total (o el total no se puede leer), devuelve el importe pero deja
// aCobrar en null: mejor enseñar el dato y que lo reste una persona que restar
// mal dos monedas distintas.
// ── v83: lee un importe que puede llevar las dos monedas ────────────────────
// Los totales reales vienen a menudo mezclados: "$230 USD + 2500 MN". Antes se
// miraba si el texto contenía "MN" y se trataba TODO como MN, así que una rebaja
// en USD no coincidía con "la moneda del total" y el vale se quedaba en "restar
// a mano" en vez de calcularse. Ahora se separan las dos partes y cada rebaja se
// descuenta de la suya.
// Sin sufijo se asume USD, que es como está escrito el resto de la app.
function _partesMonetarias(txt) {
  const s = String(txt || '');
  let usd = 0, mn = 0;
  // Cada tramo es un número con su moneda opcional detrás: "230 USD", "2500 MN", "700".
  const re = /([0-9][0-9.,]*)\s*(USD|CUP|MN)?/gi;
  let m;
  while ((m = re.exec(s)) !== null) {
    const num = parseFloat((m[1] || '').replace(/,/g, ''));
    if (isNaN(num) || num === 0) continue;
    const mon = (m[2] || '').toUpperCase();
    if (mon === 'MN' || mon === 'CUP') mn += num;
    else usd += num;
  }
  return { usd, mn };
}
// Escribe un importe en el mismo formato que usa la app.
function _fmtMonto(usd, mn) {
  const p = [];
  if (usd > 0) p.push('$' + (Math.round(usd * 100) / 100).toFixed(2).replace(/\.00$/, '') + ' USD');
  if (mn > 0) p.push(Math.round(mn) + ' MN');
  return p.length ? p.join(' + ') : '0';
}

function _rebajaVale(v) {
  if (!v) return null;
  const totalTxt = ((v.total || '') + '').trim();
  const numTotal = (typeof parsePrecioNum === 'function') ? parsePrecioNum(totalTxt) : 0;
  const totalEsMN = /\bMN\b|\bCUP\b/i.test(totalTxt);
  const fmtEn = (n, mon) => mon === 'MN' ? (Math.round(n) + ' MN') : ('$' + n.toFixed(2) + ' USD');

  // v82: dos rebajas distintas y con origen distinto, que conviene no mezclar:
  //  · la del GESTOR sale de su comisión — él cobra menos (fase 1, v75)
  //  · la del ADMIN sale del margen del negocio — la comisión del gestor no se toca
  // Las dos bajan lo que paga el cliente, así que para el total se suman; para
  // todo lo demás se llevan por separado.
  const partes = [];
  const cedida = Math.max(0, parseFloat(v.comisionCedida || 0) || 0);
  if (cedida > 0) partes.push({
    quien: 'gestor',
    importe: cedida,
    moneda: ((v.comisionCedidaMoneda || 'USD') + '').toUpperCase() === 'MN' ? 'MN' : 'USD',
    motivo: v.comisionCedidaMotivo || ''
  });
  const reba = Math.max(0, parseFloat(v.rebajaAdmin || 0) || 0);
  if (reba > 0) partes.push({
    quien: 'admin',
    importe: reba,
    moneda: ((v.rebajaAdminMoneda || 'USD') + '').toUpperCase() === 'MN' ? 'MN' : 'USD',
    motivo: v.rebajaAdminMotivo || ''
  });
  if (!partes.length) return null;

  partes.forEach(pt => { pt.txt = fmtEn(pt.importe, pt.moneda); });
  const gestor = partes.find(pt => pt.quien === 'gestor') || null;
  const admin  = partes.find(pt => pt.quien === 'admin')  || null;

  // v83: cada rebaja se descuenta de SU moneda. Los totales suelen venir mixtos
  // ("$230 USD + 2500 MN": el producto en USD y la mensajería en MN), así que
  // rebajar $20 tiene que bajar el producto y dejar la mensajería intacta.
  // Antes se miraba si el texto contenía "MN" y se trataba todo como MN, con lo
  // que una rebaja en USD no cuadraba con "la moneda del total" y el vale se
  // quedaba en "restar a mano".
  const tot = _partesMonetarias(totalTxt);
  const rebUSD = partes.reduce((a, pt) => a + (pt.moneda === 'USD' ? pt.importe : 0), 0);
  const rebMN  = partes.reduce((a, pt) => a + (pt.moneda === 'MN'  ? pt.importe : 0), 0);
  // Una rebaja sin nada de esa moneda en el total no se puede aplicar: se avisa
  // en vez de restarla de la otra.
  const sueltas = partes.filter(pt =>
    (pt.moneda === 'USD' && tot.usd <= 0) || (pt.moneda === 'MN' && tot.mn <= 0));

  const res = {
    partes, gestor, admin, sueltas,
    totalTxt,
    // Compatibilidad con el resto del código: rebajaTxt es lo que se rebaja en
    // total y aCobrarTxt lo que hay que cobrar.
    rebajaTxt: _fmtMonto(rebUSD, rebMN),
    motivo: partes.map(pt => pt.motivo).filter(Boolean).join(' · '),
    cedida,
    aCobrar: null, aCobrarTxt: null
  };
  const quedaUSD = Math.max(0, tot.usd - (tot.usd > 0 ? rebUSD : 0));
  const quedaMN  = Math.max(0, tot.mn  - (tot.mn  > 0 ? rebMN  : 0));
  if ((tot.usd > 0 || tot.mn > 0) && !sueltas.length) {
    res.aCobrar = quedaUSD;
    res.aCobrarTxt = _fmtMonto(quedaUSD, quedaMN);
  }
  return res;
}

// ── v82: rebaja aplicada por el admin (fase 2) ──────────────────────────────
// A diferencia de la del gestor, esta sale del margen del negocio: la comisión
// del gestor no se toca. Las dos bajan lo que paga el cliente y se suman para el
// total, pero se registran por separado para saber de dónde salió cada euro.
let _rebajaAdminValeId = null;
function openRebajaAdminModal(id) {
  const v = getVales().find(x => x.id === id); if (!v) return;
  _rebajaAdminValeId = id;
  document.getElementById('rebajaAdminSub').textContent =
    (valeNumStr(v) ? valeNumStr(v) + ' · ' : '') + (v.cliente || 'Vale');
  document.getElementById('rebajaAdminInput').value = Math.max(0, parseFloat(v.rebajaAdmin || 0) || 0) || '';
  document.getElementById('rebajaAdminMoneda').value = ((v.rebajaAdminMoneda || 'USD') + '').toUpperCase() === 'MN' ? 'MN' : 'USD';
  document.getElementById('rebajaAdminMotivo').value = v.rebajaAdminMotivo || '';
  document.getElementById('rebajaAdminModal').classList.add('show');
  rebajaAdminRefresca();
}
function closeRebajaAdminModal() {
  const m = document.getElementById('rebajaAdminModal');
  if (m) m.classList.remove('show');
  _rebajaAdminValeId = null;
}
function rebajaAdminSuma(delta) {
  const inp = document.getElementById('rebajaAdminInput'); if (!inp) return;
  inp.value = Math.max(0, (parseFloat(inp.value) || 0) + delta);
  rebajaAdminRefresca();
}
function rebajaAdminQuitar() {
  const inp = document.getElementById('rebajaAdminInput'); if (!inp) return;
  inp.value = '';
  rebajaAdminRefresca();
}
// Enseña en vivo en cuánto quedaría el vale, contando también lo que ya rebajó
// el gestor: sin ese dato el admin no sabe cuánto margen le queda por dar.
function rebajaAdminRefresca() {
  const v = getVales().find(x => x.id === _rebajaAdminValeId); if (!v) return;
  const val = Math.max(0, parseFloat(document.getElementById('rebajaAdminInput').value) || 0);
  const mon = document.getElementById('rebajaAdminMoneda').value === 'MN' ? 'MN' : 'USD';
  const simulado = {...v, rebajaAdmin: val, rebajaAdminMoneda: mon};
  const r = _rebajaVale(simulado);
  document.getElementById('rebajaAdminPrecio').textContent = (v.total || '—');
  const filaG = document.getElementById('rebajaAdminGestorRow');
  if (filaG) {
    const g = r && r.gestor;
    filaG.style.display = g ? 'flex' : 'none';
    if (g) document.getElementById('rebajaAdminGestor').textContent = '− ' + g.txt;
  }
  const out = document.getElementById('rebajaAdminResultado');
  if (out) {
    if (r && r.aCobrarTxt) { out.textContent = r.aCobrarTxt; out.style.color = 'var(--green)'; }
    else if (r) { out.textContent = 'restar a mano'; out.style.color = 'var(--orange)'; }
    else { out.textContent = (v.total || '—'); out.style.color = 'var(--text)'; }
  }
}
function guardarRebajaAdmin() {
  const id = _rebajaAdminValeId;
  const v = getVales().find(x => x.id === id); if (!v) { closeRebajaAdminModal(); return; }
  const val = Math.max(0, parseFloat(document.getElementById('rebajaAdminInput').value) || 0);
  const mon = document.getElementById('rebajaAdminMoneda').value === 'MN' ? 'MN' : 'USD';
  const motivo = (document.getElementById('rebajaAdminMotivo').value || '').trim();
  // El motivo se exige solo cuando hay rebaja: sin él, dentro de un mes nadie
  // sabrá por qué se dejó ese producto más barato.
  if (val > 0 && !motivo) { showToast('Escribe el motivo de la rebaja'); return; }
  patchVale(id, {
    rebajaAdmin: val,
    rebajaAdminMoneda: mon,
    rebajaAdminMotivo: val > 0 ? motivo : '',
    rebajaAdminTs: val > 0 ? new Date().toISOString() : null
  });
  _logAudit('vale_rebaja_admin', 'vale:' + id + ' ' + val + ' ' + mon);
  closeRebajaAdminModal();
  renderValeDetail(); renderAdminGestores();
  maybeAutoSync();
  showToast(val > 0 ? 'Rebaja aplicada ✓' : 'Rebaja quitada ✓');
}

// v84: dónde se está pintando el detalle. Normalmente el panel de la pestaña
// Vales, pero cuando se abre desde el historial es el modal. Se guarda en una
// variable porque los botones de acción del propio detalle (confirmar, revertir,
// asignar…) vuelven a llamar a renderValeDetail() sin argumentos: si no se
// recordara el destino, repintarían el panel de detrás y el modal se quedaría
// con los datos viejos.
let _valeDetailDestino = 'valeDetail';
function renderValeDetail(destinoId) {
  if (destinoId) _valeDetailDestino = destinoId;
  const v=getVales().find(x=>x.id===selectedValeId);
  const c=document.getElementById(_valeDetailDestino) || document.getElementById('valeDetail');
  if(!c) return;
  if(!v){c.innerHTML='<div class="det-empty"><div class="det-empty-icon">📋</div><div style="font-size:13px;">Selecciona un vale de la bandeja</div></div>';return;}
  const g=gestorOf(v.gestorId);const m=v.mensajeroId?mensajeroOf(v.mensajeroId):null;
  // v51 FIX: normalizar status
  const _vStatus = v.status || 'pending';
  const s=estadoVale(v);
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
  // v92: apartar el stock de este vale. Solo tiene sentido mientras el vale siga
  // vivo y tenga productos del catálogo: en cuanto se cobra, el stock se
  // descuenta de verdad y no hay nada que reservar.
  const _puedeReservar = hasProducts && (_vStatus === 'pending' || _vStatus === 'assigned');
  const reservaHTML = _puedeReservar ? `
    <label style="display:flex;align-items:flex-start;gap:8px;background:${v.reservado ? 'rgba(180,83,9,.08)' : 'var(--surface2)'};border:1px solid ${v.reservado ? 'rgba(180,83,9,.35)' : 'var(--border)'};border-radius:8px;padding:9px 11px;margin-bottom:10px;cursor:pointer;">
      <input type="checkbox" ${v.reservado ? 'checked' : ''} onchange="toggleValeReservado(${v.id})" style="margin-top:2px;width:17px;height:17px;flex-shrink:0;">
      <span style="font-size:11px;line-height:1.35;">
        <b style="color:${v.reservado ? '#b45309' : 'var(--text)'};">🔐 Apartar el stock de este vale</b><br>
        <span style="color:var(--gray-400);">${v.reservado
          ? 'Estas unidades no se pueden vender en otro vale. Se sueltan solas al cobrar, cancelar o borrar este.'
          : 'Marca esto si el cliente aún no ha pagado pero quieres guardarle la mercancía.'}</span>
      </span>
    </label>` : '';
  if(v.status==='pending'){
    // v88: si el cliente recoge en la tienda no hay nada que repartir, así que
    // el botón de mensajero estorba y se presta a asignar por error. En su
    // lugar se recuerda de qué tipo de venta se trata.
    const _cabecera = v.recogidaTienda
      ? `<div style="background:rgba(0,109,138,.08);border:1px solid rgba(0,109,138,.25);border-radius:8px;padding:10px;text-align:center;margin-bottom:8px;">
        <div style="font-size:12px;font-weight:700;color:var(--blue);">🏬 Recogida en tienda</div>
        <div style="font-size:10px;color:var(--gray-400);margin-top:2px;">No lleva mensajero — se entrega en el mostrador</div>
      </div>`
      : `<button class="btn btn-blue btn-full" onclick="openShareModal(${v.id})" style="margin-bottom:8px;">🛵 Asignar a Mensajero</button>
    <div style="font-size:10px;color:var(--gray-400);text-align:center;margin-bottom:6px;">— o confirmar directo —</div>`;
    actHTML=`${productPickerHTML}${reservaHTML}${_cabecera}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
      <button class="btn btn-green btn-sm btn-full" onclick="confirmSale(${v.id},'confirmed')">✅ Cobrado directo</button>
      <button class="btn btn-sm btn-full" style="background:var(--orange);color:white;" onclick="confirmSale(${v.id},'pending_payment')">⏳ Entregado (Por cobrar)</button>
    </div>`;
  } else if(v.status==='assigned'){
    actHTML=`${productPickerHTML}${reservaHTML}<div class="mensajero-row">🛵 <b>Mensajero:</b> ${m?escapeHTML(m.name):'—'}</div>
      <div style="font-size:12px;color:var(--gray-400);margin:6px 0 10px;">Esperando que el mensajero confirme la entrega</div>
      <button class="btn btn-ghost btn-full btn-sm" onclick="mensajeroEntrega(${v.id})" style="margin-bottom:6px;">📦 Marcar entregado (admin)</button>
      <button class="btn btn-ghost btn-full btn-sm" onclick="openShareModal(${v.id})">🔄 Reenviar vale</button>`;
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
           ['Precio USD',v.precioUSD],['Precio MN',v.precioMN],['Vuelto',v.vuelto],['Total',_rebajaVale(v)?'':v.total],['Garantía',v.garantia],['⏰ Hora de entrega',v.horaEntrega],['💰 Comisión gestor',v.comisionGestor]]
          .filter(([,val])=>val)
          .map(([k,val])=>`<tr style="border-bottom:1px solid var(--gray-100);">
            <td style="padding:6px 0;color:var(--gray-400);font-weight:600;width:100px;">${k}</td>
            <td style="padding:6px 0;font-weight:600;">${escapeHTML(val)}</td></tr>`).join('')}
      </table>
      ${(()=>{const _r=_rebajaVale(v);if(!_r)return '';return `
        <div style="margin-top:10px;padding:12px 13px;background:rgba(245,158,11,.09);border:1px solid rgba(245,158,11,.35);border-radius:11px;">
          <div style="font-size:10px;color:var(--orange);font-weight:800;text-transform:uppercase;letter-spacing:.5px;margin-bottom:7px;">🏷️ Este vale lleva rebaja</div>
          <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;">
            <span style="color:var(--text-muted);">Precio del vale</span>
            <span style="${_r.aCobrarTxt?'text-decoration:line-through;opacity:.6;':'font-weight:700;'}">${escapeHTML(_r.totalTxt||'—')}</span>
          </div>
          ${_r.gestor?`<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;">
            <span style="color:var(--text-muted);">🤝 Del gestor <span style="font-size:9px;opacity:.8;">(de su comisión)</span></span>
            <span style="color:var(--orange);font-weight:700;">− ${escapeHTML(_r.gestor.txt)}</span>
          </div>`:''}
          ${_r.admin?`<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;">
            <span style="color:var(--text-muted);">🏷️ Del negocio <span style="font-size:9px;opacity:.8;">(tu margen)</span></span>
            <span style="color:var(--blue);font-weight:700;">− ${escapeHTML(_r.admin.txt)}</span>
          </div>`:''}
          <div style="margin-bottom:6px;"></div>
          ${_r.aCobrarTxt
            ? `<div style="display:flex;justify-content:space-between;align-items:baseline;border-top:1px solid rgba(245,158,11,.3);padding-top:7px;">
                 <span style="font-size:12px;font-weight:800;">COBRAR AL CLIENTE</span>
                 <span style="font-size:17px;font-weight:800;color:var(--green);">${escapeHTML(_r.aCobrarTxt)}</span>
               </div>`
            : `<div style="border-top:1px solid rgba(245,158,11,.3);padding-top:7px;font-size:11px;color:var(--orange);font-weight:600;">⚠️ Resta la rebaja a mano: el total del vale está en otra moneda.</div>`}
          ${_r.motivo?`<div style="margin-top:7px;font-size:11px;color:var(--text-muted);">Motivo: ${escapeHTML(_r.motivo)}</div>`:''}
          <button class="btn btn-ghost btn-sm btn-full" style="margin-top:9px;font-size:11px;" onclick="openRebajaAdminModal(${v.id})">🏷️ Cambiar la rebaja del negocio</button>
        </div>`;})()}
      ${!_rebajaVale(v)?`<button class="btn btn-ghost btn-full btn-sm" style="margin-top:9px;color:var(--blue);" onclick="openRebajaAdminModal(${v.id})">🏷️ Rebajar este vale</button>`:''}
      ${v.recogidaTienda?`<div style="margin-top:8px;padding:8px 12px;background:rgba(0,109,138,.08);border:1px solid rgba(0,109,138,.25);border-radius:8px;display:flex;align-items:center;gap:6px;">
        <span style="font-size:14px;">🏪</span>
        <span style="font-size:12px;font-weight:700;color:var(--blue);">Recogida en tienda</span>
      </div>`:''}
      ${v.ubicacion?`<div style="margin-top:8px;padding:8px 12px;background:rgba(16,185,129,.06);border:1px solid rgba(16,185,129,.2);border-radius:8px;">
        <div style="font-size:10px;color:var(--green);font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">📍 Ubicación compartida</div>
        <a href="${escapeAttr(v.ubicacion)}" target="_blank" style="font-size:11px;color:var(--blue);text-decoration:underline;word-break:break-all;">Abrir en Google Maps</a>
      </div>`:''}
      ${v.mensajeria?`<div style="margin-top:8px;padding:8px 12px;background:rgba(0,109,138,.06);border:1px solid rgba(0,109,138,.2);border-radius:8px;">
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

// v92: marcar/desmarcar el vale como reservado. No toca ningún contador de
// stock: las unidades apartadas se calculan a partir de esta marca, así que con
// cambiarla ya está todo hecho — no hay nada que sumar ni que restar, que es
// justo donde se rompió el stock en su día.
function toggleValeReservado(id) {
  const v = getVales().find(x => x.id === id); if (!v) return;
  const nuevo = !v.reservado;
  // Avisar, no bloquear: si el cliente ya tiene el vale, esas unidades le hacen
  // falta igual; lo que no puede es pasar desapercibido. Se mira ANTES de
  // marcar, o el propio vale ya estaría contándose a sí mismo.
  const cortos = nuevo ? (v.valeProductos || []).map(({ id: pid, qty }) => {
    const p = productoOf(pid); if (!p) return null;
    const disp = _availableStock(p);
    return disp < (qty || 0) ? `${p.name}: hay ${disp} y hacen falta ${qty}` : null;
  }).filter(Boolean) : [];
  patchVale(id, { reservado: nuevo });
  _refrescarReservas();
  renderValeDetail();
  if (typeof renderProductGrid === 'function') renderProductGrid();
  if (typeof renderStockCategorias === 'function') renderStockCategorias();
  maybeAutoSync();
  showToast(cortos.length ? ('⚠️ ' + cortos[0]) : (nuevo ? 'Stock apartado 🔐' : 'Stock liberado ✓'));
}

// v114: la fecha del vale se guarda en ISO/UTC (v.ts) pero el <input
// datetime-local> habla en hora local. Estas dos funciones traducen entre
// los dos formatos; sin ellas el vale se movería de hora cada vez que se
// abre y se guarda el modal.
function _tsAInputLocal(ts) {
  const d = ts ? new Date(ts) : null;
  if (!d || isNaN(d.getTime())) return '';
  const p = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function _inputLocalATs(val) {
  if (!val) return null;
  const d = new Date(val);   // sin zona horaria, JS lo lee como hora local
  return isNaN(d.getTime()) ? null : d.toISOString();
}
function openEditValeModal(id) {
  const v=getVales().find(x=>x.id===id);if(!v)return;
  ['cliente','telefono','direccion','mensajeria','total','garantia','comisionGestor',
   'horaEntrega'].forEach(k=>{                     // v108: y la hora de entrega
    const el=document.getElementById('ev-'+k);if(el)el.value=v[k]||'';
  });
  const elFecha=document.getElementById('ev-fecha');
  if(elFecha)elFecha.value=_tsAInputLocal(v.ts);
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
    const reserved=_reservedTotal(p);
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
  // v92: recalcular el total. Sin esto, añadir un producto actualizaba el precio
  // pero dejaba el total a pagar como estaba.
  calcEditValeTotal();
  renderEditValeSelectedProducts();
  closeAdminProductPicker();
}
function saveEditVale() {
  const id=parseInt(document.getElementById('editValeModal').dataset.valeId);
  const v=getVales().find(x=>x.id===id);if(!v)return;
  const changes={};
  ['cliente','telefono','direccion','mensajeria','total','garantia','comisionGestor','articulo','precioUSD','precioMN',
   'horaEntrega'].forEach(k=>{                     // v108
    const el=document.getElementById('ev-'+k);if(el)changes[k]=el.value.trim();
  });
  // v114: fecha editable. Solo se toca v.ts si el admin puso una fecha válida;
  // si borra el campo o escribe algo imposible, se queda la de antes en vez de
  // dejar el vale sin fecha (que lo sacaría del historial y de las estadísticas).
  const elFecha=document.getElementById('ev-fecha');
  if(elFecha&&elFecha.value){
    const nuevoTs=_inputLocalATs(elFecha.value);
    if(nuevoTs&&nuevoTs!==v.ts)changes.ts=nuevoTs;
  }
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
  // v81: si cambian los productos, la comisión congelada se vuelve a fijar con
  // los nuevos. Si no, el vale seguiría valiendo lo que valían los productos
  // que ya no tiene.
  if (productsChanged) {
    try {
      const _r = getValeCommissionParts({valeProductos: editValeProductos || []});
      if (_r.totalUSD !== null || _r.totalMN !== null) {
        changes.comFijadaUSD = _r.totalUSD || 0;
        changes.comFijadaMN  = _r.totalMN  || 0;
      }
    } catch(e) { console.warn('[vale] no se pudo recongelar la comisión:', e && e.message); }
  }
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
    `🔸 Artículo y cantidad: ${v.articulo||''}`,
    // v79: el mensajero cobra lo que dice este texto, así que tiene que llevar
    // la rebaja del gestor. Antes iba el precio de lista y cobraba de más.
    ...(function(){
      const _r = (typeof _rebajaVale === 'function') ? _rebajaVale(v) : null;
      if (!_r) return [`🔸 Total a pagar: ${v.total||''}`];
      return [`🔸 Precio: ${v.total||''}`,
              `🔸 Rebaja: −${_r.rebajaTxt}`,
              `🔸 Total a pagar: ${_r.aCobrarTxt || ((v.total||'') + ' menos ' + _r.rebajaTxt)}`];
    })(), '',
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
// v85: asignar y punto. copyAndAssign() copia el texto, asigna y además abre
// WhatsApp: útil cuando hay que mandarle el vale al mensajero, un estorbo cuando
// ya se le ha dicho por otra vía y solo falta dejarlo registrado.
function asignarMensajeroSinMas() {
  if (!shareTargetId) return;
  const mId = parseInt(document.getElementById('mensajeroSelect').value);
  if (!mId || isNaN(mId)) { showToast('Elige un mensajero'); return; }
  const m = mensajeroOf(mId);
  const vAsign = getVales().find(x => x.id === shareTargetId);
  patchVale(shareTargetId, {status:'assigned', mensajeroId:mId});
  if (vAsign) addNotif('vale_assigned', vAsign.cliente||'Tu cliente', null, m?m.name:'', vAsign.gestorId, 'vale_assigned:'+shareTargetId);
  closeShareModal();
  selectedValeId = shareTargetId;
  renderAdminGestores(); renderValeDetail(); renderMyVales();
  renderConfirmados(); renderPendienteCobro();
  updateMensajeroBadge();
  maybeAutoSync();
  showToast('Asignado a ' + (m ? m.name : 'mensajero') + ' ✓');
}

function copyAndAssign() {
  if(!shareTargetId)return;
  const mId=parseInt(document.getElementById('mensajeroSelect').value);
  const m=mensajeroOf(mId);
  const text=document.getElementById('shareValePreview').textContent;
  navigator.clipboard.writeText(text).catch(()=>{});
  const vAsign=getVales().find(x=>x.id===shareTargetId);
  patchVale(shareTargetId,{status:'assigned',mensajeroId:mId});
  if(vAsign) addNotif('vale_assigned',vAsign.cliente||'Tu cliente',null,m?m.name:'',vAsign.gestorId,'vale_assigned:'+shareTargetId);
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
  // v47 FIX: notif correcta para 'entregado · pendiente de cobro'.
  // ANTES (v46-): se usaba 'vale_assigned' que muestra "Tu venta está con el
  // mensajero" — confuso porque el mensajero YA entregó. Ahora usamos
  // 'vale_pending' que muestra "Vale en proceso de cobro".
  patchVale(id,{status:'pending_payment',deliveredTs:new Date().toISOString(),stockDecremented:true});
  addNotif('vale_pending', v.cliente||'Cliente', null, 'Entregado · Pendiente de cobro', v.gestorId, 'vale_pending:'+id);
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
    _marcarCobroMensajeroYPreguntar(id);
    addNotif('vale_confirmed',v.cliente||'Cliente',null,`Total: ${v.total||''}`,v.gestorId,'vale_confirmed:'+id);
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
  patchVale(id,{status:'confirmed',confirmedTs:new Date().toISOString(),deliveredTs:new Date().toISOString(),stockDecremented:true});
  _marcarCobroMensajeroYPreguntar(id);
  addNotif('vale_confirmed',v.cliente||'Cliente',null,`Total: ${v.total||''}`,v.gestorId,'vale_confirmed:'+id);
  _logAudit('vale_confirmed', 'vale:' + id);
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
    patchVale(id,{status:'confirmed',confirmedTs:new Date().toISOString(),deliveredTs:v.deliveredTs||new Date().toISOString()});
    _marcarCobroMensajeroYPreguntar(id);
    addNotif('vale_confirmed',v.cliente||'Cliente',null,`Total: ${v.total||''}`,v.gestorId,'vale_confirmed:'+id);
    _logAudit('vale_confirmed', 'vale:' + id);
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
  patchVale(id,{status:'confirmed',confirmedTs:new Date().toISOString(),deliveredTs:v.deliveredTs||new Date().toISOString(),stockDecremented:true});
  _marcarCobroMensajeroYPreguntar(id);
  addNotif('vale_confirmed',v.cliente||'Cliente',null,`Total: ${v.total||''}`,v.gestorId,'vale_confirmed:'+id);
  _logAudit('vale_confirmed', 'vale:' + id);
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
  // Descuento de stock garantizado (helper DRY — AUDITORIA-AXONTECH.md MEDIO 28).
  // v52 FIX: se comprueba stockDecremented antes de descontar. ANTES la única
  // guarda era el status (confirmed/pending_payment), así que un vale que ya
  // tenía el stock descontado pero estaba en otro estado —caso real: un vale
  // 'delivered' heredado— lo descontaba OTRA VEZ al confirmarlo desde el panel,
  // perdiendo inventario real. Los otros tres flujos de cobro
  // (mensajeroPagado, mensajeroPagadoDirecto, mensajeroEntrega) ya comprobaban
  // esta bandera; confirmSale era el único que no.
  if(!v.stockDecremented) _descontarStock(v);
  // v52: si el admin marca "Entregado (por cobrar)" también se avisa al gestor.
  // ANTES solo se notificaba cuando paymentStatus era 'confirmed'; con
  // 'pending_payment' el gestor no recibía nada desde este flujo.
  patchVale(id,{status:paymentStatus,confirmedTs:new Date().toISOString(),stockDecremented:true});
  if(paymentStatus === 'confirmed') addNotif('vale_confirmed',v.cliente||'Cliente',null,`Total: ${v.total||''}`,v.gestorId,'vale_confirmed:'+id);
  else if(paymentStatus === 'pending_payment') addNotif('vale_pending',v.cliente||'Cliente',null,'Entregado · Pendiente de cobro',v.gestorId,'vale_pending:'+id);
  _logAudit('vale_confirm_' + paymentStatus, 'vale:' + id);
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
  // v47 FIX: añadir notif al gestor de que su venta fue cobrada.
  // ANTES (v46-): markAsPaid era el ÚNICO path de confirmación que NO llamaba
  // addNotif — el gestor solo se enteraba si su app estaba abierta y el poll
  // detectaba el cambio de status. Ahora garantizamos la notif desde el admin.
  patchVale(id,{status:'confirmed',confirmedTs:new Date().toISOString()});
  _marcarCobroMensajeroYPreguntar(id);
  addNotif('vale_confirmed', v.cliente||'Cliente', null, `Total: ${v.total||''}`, v.gestorId, 'vale_confirmed:'+id);
  _logAudit('vale_confirmed', 'vale:' + id);
  gestoresTabDirty=true;statsTabDirty=true;rankingCache=null;
  playSound('confirm');
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
  const list=getMensajeros();const nuevoId=Date.now();list.push({id:nuevoId,name,phone:phone||''});guardarMensajeros(list,[nuevoId]);
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
  if (!n.startsWith('53') && /^[57]\d{7}$/.test(n)) {
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
  guardarMensajeros(getMensajeros().filter(m=>m.id!==id),[id]);renderMensajeros();maybeAutoSync();
}
function renderMensajeros() {
  const c=document.getElementById('mensajerosList');
  const vales=getVales();
  _updateMensajerosCountBadge();
  if(!c) return;
  // v86: cuántas entregas lleva cada uno ahora mismo. Se cuenta de una pasada
  // para todos, en vez de recorrer los vales otra vez dentro del bucle.
  // v88: se cuentan aparte los que ya entregó y están esperando el cobro — sigue
  // siendo trabajo suyo (el dinero no ha entrado), así que tiene que verse.
  const enCurso=new Map(), porCobrar=new Map();
  const _suma=(mapa,id)=>mapa.set(id,(mapa.get(id)||0)+1);
  for(const v of vales){
    if(!v.mensajeroId) continue;
    if(v.status==='assigned') _suma(enCurso,v.mensajeroId);
    // v119: la deuda ya no se deduce del estado de la venta — ver _mensajeroDebeCobro.
    else if(_mensajeroDebeCobro(v)) _suma(porCobrar,v.mensajeroId);
  }
  const _carga=id=>(enCurso.get(id)||0)+(porCobrar.get(id)||0);
  // v86: arriba los que tienen trabajo encima, y entre ellos primero el que más
  // lleva; los que no tienen nada quedan debajo. sortMensajerosAlpha ya devuelve
  // una COPIA, así que reordenarla no toca el array original, y el sort de JS es
  // estable: dentro del mismo número se mantiene el orden alfabético.
  const list=sortMensajerosAlpha(getMensajeros())
    .sort((a,b)=>_carga(b.id)-_carga(a.id));
  if(!list.length){c.innerHTML='<div class="es" style="padding:8px;"><div class="es-text">Sin mensajeros</div></div>';return;}
  c.innerHTML=list.map(m=>{
    const ini=m.name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
    const phone=m.phone||'';
    const assigned=enCurso.get(m.id)||0;
    const cobrar=porCobrar.get(m.id)||0;
    const act=m.id===activeMensajeroId;
    // v86: el número de entregas pasa a ser un globo visible junto al nombre —
    // antes era texto diminuto en gris y había que buscarlo.
    // v88: dos globos, porque son dos cosas distintas y mezclarlas engañaba:
    // azul lo que lleva encima sin entregar, naranja lo entregado que aún no ha
    // pagado.
    let badge='';
    if(assigned) badge+=`<span style="background:var(--blue);color:#fff;border-radius:12px;padding:3px 9px;font-size:11px;font-weight:700;white-space:nowrap;" title="${assigned} vale${assigned!==1?'s':''} en reparto ahora mismo">🛵 ${assigned}</span>`;
    if(cobrar) badge+=`<span style="background:var(--orange);color:#fff;border-radius:12px;padding:3px 9px;font-size:11px;font-weight:700;white-space:nowrap;" title="${cobrar} vale${cobrar!==1?'s':''} entregado${cobrar!==1?'s':''} pendiente${cobrar!==1?'s':''} de cobro">⏳ ${cobrar}</span>`;
    if(!badge) badge=`<span style="background:var(--surface3);color:var(--text-muted);border-radius:12px;padding:3px 9px;font-size:11px;font-weight:600;white-space:nowrap;">Sin entregas</span>`;
    const waBtn = phone
      ? `<button type="button" style="background:none;border:1px solid #25D366;cursor:pointer;font-size:10px;color:#25D366;padding:2px 7px;border-radius:4px;font-weight:600;" onclick="event.stopPropagation();openMensajeroWhatsApp(${m.id})" title="WhatsApp ${escapeHTML(phone)}">💬 WhatsApp</button>`
      : '';
    const phoneHTML = phone ? `<span>📱 ${escapeHTML(phone)}</span>` : '';
    return `<div class="m-item ${act?'active':''}" style="cursor:pointer;flex-wrap:wrap;" onclick="selectMensajero(${m.id})" title="Toca para ver sus entregas">
      <div class="m-av">${escapeHTML(ini)}</div>
      <div style="flex:1;min-width:140px;">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <div class="m-name">${escapeHTML(m.name)} ${act?'<span style="color:var(--blue);">✓ Viendo entregas</span>':''}</div>
          ${badge}
        </div>
        <div style="font-size:10px;color:var(--gray-400);display:flex;gap:8px;flex-wrap:wrap;margin-top:1px;">${phoneHTML}${assigned?`<span>${assigned} en reparto</span>`:''}${cobrar?`<span>${cobrar} sin cobrar</span>`:''}</div>
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
  guardarMensajeros(list,[id]);
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
  const today=ordenarRecientesPrimero(getVales().filter(v=>v.status==='confirmed'&&new Date(v.ts).toDateString()===todayStr()));
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
  const pend=ordenarRecientesPrimero(getVales().filter(v=>v.status==='pending_payment'));
  if(!pend.length){c.innerHTML='<div class="es"><div class="es-icon">⏳</div><div class="es-text">Sin pendientes</div></div>';return;}
  c.innerHTML=pend.map(v=>{
    const g=gestorOf(v.gestorId);const m=v.mensajeroId?mensajeroOf(v.mensajeroId):null;
    return `<div class="sc sc-pend"><div class="sc-head"><span class="sc-g">${g?escapeHTML(g.name):'—'}</span><span class="sc-t">${timeStr(v.ts)}</span></div><div>${escapeHTML(v.cliente||'')} · ${escapeHTML(v.total||'')}</div><div class="sc-m">${m?'🛵 '+escapeHTML(m.name):''}</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:7px;"><button class="btn btn-green btn-sm btn-full" onclick="markAsPaid(${v.id})">✅ Cobrado</button><button class="btn btn-ghost btn-sm btn-full" style="color:var(--orange);" onclick="revertConfirmSale(${v.id})">↩ Revertir</button></div></div>`;
  }).join('');
}
function togglePendingCobro(){pendingCobroExpanded=!pendingCobroExpanded;renderPendingCobroSection();}
function renderPendingCobroSection() {
  const c=document.getElementById('pendingCobroSection');if(!c)return;
  const pend=ordenarRecientesPrimero(getVales().filter(v=>v.status==='pending_payment'));
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
  let vales = getVales().filter(v => v.gestorId === gestorId);
  if (from) vales = vales.filter(v => _fechaEfectiva(v) >= from);
  if (to)   vales = vales.filter(v => _fechaEfectiva(v) <= to);
  const total = vales.length;
  const confirmed = vales.filter(v => v.status === 'confirmed').length;
  const pendingPay = vales.filter(v => v.status === 'pending_payment').length;
  const pending = vales.filter(v => v.status === 'pending').length;
  const cancelled = vales.filter(v => v.status === 'cancelled').length;
  // v41 FIX: PUNTOS now includes ALL non-cancelled vales (pending + assigned + delivered + pending_payment + confirmed).
  // ANTES: solo contaba puntos de confirmed/pending_payment → mostraba PUNTOS: 0
  // cuando el gestor tenía vales pending con puntos.
  // Ahora: puntos "ganados" (confirmed/pending_payment) y puntos "potenciales" (todos).
  const earnedStatuses = ['confirmed','pending_payment'];
  const allActiveStatuses = ['pending','assigned','delivered','pending_payment','confirmed'];
  // v114: se descuentan los ciclos de meta ya cerrados, para que este número
  // sea el MISMO que el de la barra de meta y el del ranking. Antes eran los
  // puntos de siempre y seguían subiendo aunque la meta ya se hubiera logrado.
  //
  // SOLO cuando se está mirando todo el histórico. Si hay un rango de fechas
  // ("Este mes", "Mes pasado"), lo que se pregunta es cuántos puntos se hicieron
  // EN ESAS FECHAS: restarle ahí los ciclos de toda la vida daría cero.
  const _canjeados = (from || to) ? 0
    : ((gestorOf(gestorId) && parseFloat(gestorOf(gestorId).puntosCanjeados)) || 0);
  const _sumaPuntos = lista => lista.reduce((sum,v) => (v.valeProductos||[]).reduce((s,p) => {
      const pr = productoOf(p.id);
      return s + ((pr && pr.puntos) || 0) * p.qty;
    }, sum), 0);
  const ptsEarned    = Math.max(0, _sumaPuntos(vales.filter(v => earnedStatuses.includes(v.status)))    - _canjeados);
  const ptsPotential = Math.max(0, _sumaPuntos(vales.filter(v => allActiveStatuses.includes(v.status))) - _canjeados);
  // v80 FIX: aquí se hacía `ptsEarned > 0 ? ptsEarned : ptsPotential`, con la
  // idea (v41) de que un gestor nuevo no viera un cero desangelado. Pero eso
  // hacía que el número CAMBIARA DE SIGNIFICADO según el caso: sin ventas
  // confirmadas enseñaba los puntos posibles —"1 punto" con cero vales
  // confirmados, que es lo que se reportó— y en cuanto confirmabas una pasaba a
  // enseñar solo los ganados, con lo que el contador podía BAJAR justo después
  // de una venta buena.
  // Ahora siempre son los ganados. Los posibles no se pierden: se enseñan
  // aparte, etiquetados como lo que son, así que la motivación que buscaba v41
  // sigue estando sin mentir en la cifra principal.
  const pts = ptsEarned;
  // v52 FIX: la comisión se cuenta solo al completar la venta (status
  // 'confirmed' = cobrada). v50 la calculaba sobre confirmed+pending_payment,
  // así que un vale apenas entregado (aún sin cobrar) ya sumaba comisión —
  // justo el bug que v50 decía estar arreglando, solo que a medias: seguía
  // incluyendo pending_payment en vez de limitarse a confirmed.
  // ── v116: aquí sale lo que le DEBEN, no lo que ha ganado en su vida ───────
  // Antes esta tarjeta sumaba todas las ventas que generan comisión, cobrada ya
  // o no. El gestor cobraba su dinero y la tarjeta seguía enseñando el mismo
  // importe, así que no servía para lo único que se mira en ella: cuánto falta
  // por cobrar. Es el mismo criterio que usa el panel del admin desde v102 —
  // "en sobre" sigue contando (está apartado, pero el gestor no lo tiene en la
  // mano) y lo ya cobrado desaparece.
  const comValesEarned = vales.filter(v => _valeGeneraComision(v)
    && !v.commissionPaid && v.commissionStatus !== 'cobrado');
  const comCobrados = vales.filter(v => _valeGeneraComision(v)
    && (v.commissionPaid || v.commissionStatus === 'cobrado')).length;
  const com = sumCommissions(comValesEarned);
  const comBadge = fmtComisionBadge(com.usd, com.mn, com.computed);
  // Conversion: confirmed / (total - cancelled - pending still pending)
  // More useful: closed sales (confirmed + pending_payment) / total attempted
  const closed = confirmed + pendingPay;
  const conversion = total > 0 ? Math.round((closed / total) * 100) : 0;
  return { total, confirmed, pendingPay, pending, cancelled, pts, ptsEarned, ptsPotential,
           com, comBadge, comPendientes: comValesEarned.length, comCobrados, conversion, closed };
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

  // Meta progress bar
  const cfg = getConfig();
  const meta = cfg.metaPuntos || 100;
  const pctMeta = Math.min(100, Math.round((cur.pts / meta) * 100));

  // Build the 4-stat summary
  const stats = [
    { label:'Vales', val:cur.total, color:'var(--blue)', cmp: prev ? _cmpArrow(cur.total, prev.total) : '' },
    { label:'Confirmados', val:cur.confirmed + cur.pendingPay, color:'var(--green)', cmp: prev ? _cmpArrow(cur.confirmed + cur.pendingPay, prev.confirmed + prev.pendingPay) : '' },
    // v80: los puntos aún no ganados se enseñan debajo, en pequeño y dichos por
    // su nombre, en vez de sumarlos al número grande como si ya fueran suyos.
    { label:'Puntos ⭐', val:cur.pts, color:'#F59E0B', cmp: prev ? _cmpArrow(cur.pts, prev.pts) : '',
      extra: (cur.ptsPotential > cur.ptsEarned) ? ('+' + (cur.ptsPotential - cur.ptsEarned) + ' en camino') : '' },
    { label:'Conversión', val:cur.conversion + '%', color:'var(--orange)', cmp: prev ? _cmpArrow(cur.conversion, prev.conversion) : '' },
  ];

  const statsHTML = stats.map(s => `
    <div class="stat-card" style="padding:10px 8px;text-align:center;">
      <div class="stat-num" style="color:${s.color};font-size:20px;">${s.val}</div>
      <div class="stat-lbl" style="font-size:10px;">${s.label}</div>
      ${s.cmp ? `<div style="margin-top:2px;">${s.cmp}</div>` : ''}
      ${s.extra ? `<div style="margin-top:2px;font-size:9px;color:var(--text-muted);font-weight:600;">${s.extra}</div>` : ''}
    </div>
  `).join('');

  // v39: Hero commission card — green gradient, like original design
  // v60 FIX: el contenedor #gestorHistDashboard es un grid de 4 columnas, pensado
  // para las 4 stat-cards. El hero y la meta se metían como hijos sueltos, así que
  // caían cada uno en UNA celda —un cuarto del ancho— y salían aplastados y en
  // paralelo. El hero es un flex con el importe a un lado y el icono al otro: a
  // 1/4 de ancho se amontona y pierde el sentido. `grid-column:1/-1` los devuelve
  // a la franja completa, que es como estaban diseñados.
  // El separador ya lo pone el gap:6px del grid, así que el margin-top extra
  // sobraba y descuadraba el ritmo vertical.
  const _heroBase = 'grid-column:1/-1;margin-top:6px;padding:16px 18px;border-radius:14px;'
    + 'background:linear-gradient(135deg,#10b981,#059669);box-shadow:0 2px 10px rgba(16,185,129,.28);'
    + 'display:flex;align-items:center;justify-content:space-between;gap:12px;';
  const _heroLbl = 'font-size:11px;font-weight:600;color:rgba(255,255,255,.85);text-transform:uppercase;letter-spacing:.5px;';
  let comHero = '';
  if (cur.comBadge) {
    // v116: cuántas ventas quedan por cobrar detrás del importe. Antes decía
    // "de N ventas cobradas" usando el total de ventas, que no tenía nada que
    // ver con el dinero que falta por pagarle.
    const _n = cur.comPendientes;
    const _sub = _n > 0 ? `de ${_n} venta${_n !== 1 ? 's' : ''} sin cobrar` : '';
    comHero = `<div style="${_heroBase}">
      <div style="min-width:0;">
        <div style="${_heroLbl}">Comisión por cobrar</div>
        <div style="font-size:26px;font-weight:800;color:white;margin-top:3px;line-height:1.1;word-break:break-word;">${escapeHTML(cur.comBadge)}</div>
        ${_sub ? `<div style="font-size:11px;color:rgba(255,255,255,.82);margin-top:3px;">${_sub}</div>` : ''}
      </div>
      <div style="font-size:30px;opacity:.75;flex-shrink:0;">💰</div>
    </div>`;
  } else if (cur.comCobrados > 0) {
    // v116: ya cobró todo lo que se le debía. Se dice, en vez de dejar el hueco
    // en blanco: un gestor que ve la tarjeta desaparecer piensa que se perdió
    // su dinero, no que ya lo tiene.
    comHero = `<div style="${_heroBase}">
      <div style="min-width:0;">
        <div style="${_heroLbl}">Comisión por cobrar</div>
        <div style="font-size:26px;font-weight:800;color:white;margin-top:3px;line-height:1.1;">$0</div>
        <div style="font-size:11px;color:rgba(255,255,255,.82);margin-top:3px;">✓ ya cobraste ${cur.comCobrados} venta${cur.comCobrados !== 1 ? 's' : ''} — al día</div>
      </div>
      <div style="font-size:30px;opacity:.75;flex-shrink:0;">✅</div>
    </div>`;
  } else if (cur.closed > 0) {
    comHero = `<div style="${_heroBase}">
      <div style="min-width:0;">
        <div style="${_heroLbl}">Comisión estimada</div>
        <div style="font-size:16px;font-weight:700;color:rgba(255,255,255,.75);margin-top:4px;">No computable</div>
        <div style="font-size:11px;color:rgba(255,255,255,.7);margin-top:3px;">los productos no tienen comisión definida</div>
      </div>
      <div style="font-size:30px;opacity:.5;flex-shrink:0;">💰</div>
    </div>`;
  }

  // v39: Meta progress bar — dark card style like original
  // v60: a ancho completo por el mismo motivo que el hero (ver arriba). Con la
  // barra metida en un cuarto de columna no se leía el progreso, que es justo
  // para lo que sirve.
  const metaHTML = `
    <div style="grid-column:1/-1;margin-top:6px;padding:11px 14px;background:var(--surface2);border-radius:10px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:7px;flex-wrap:wrap;gap:4px;">
        <span style="font-size:12px;font-weight:700;color:var(--text);">🎯 Meta de puntos</span>
        <span style="font-size:12px;font-weight:700;color:var(--cyan,#06b6d4);">${cur.pts} / ${meta} pts</span>
      </div>
      <div style="background:var(--gray-100);border-radius:20px;height:8px;overflow:hidden;">
        <div style="width:${pctMeta}%;height:100%;background:#06b6d4;border-radius:20px;transition:width .6s;"></div>
      </div>
      <div style="font-size:10px;color:var(--text-muted);margin-top:5px;">${pctMeta >= 100 ? '¡Meta alcanzada! 🎉' : `Te faltan ${meta - cur.pts} pts para la meta`}</div>
    </div>
  `;

  dash.innerHTML = statsHTML + comHero + metaHTML;
}

// ── v65: criterio único de "vale confirmado y visible para el gestor" ────────
// Estaba escrito por separado en cuatro sitios (historial, comisiones, botón de
// ocultar e "ocultar historial") y ya divergió una vez: la vista de comisiones se
// había dejado el !hiddenFromHistory, así que al ocultar el historial la comisión
// del vale seguía ahí, sin ningún vale a la vista y sin forma de quitarla (v61).
// Con un solo sitio, no puede volver a pasar: si mañana cambia el criterio de qué
// vale cuenta, cambia para todas las vistas a la vez.
const esValeConfirmadoVisible = v => !!v && v.status === 'confirmed' && !v.hiddenFromHistory;
const valesConfirmadosDeGestor = gestorId =>
  getVales().filter(v => v && v.gestorId === gestorId && esValeConfirmadoVisible(v));

function renderMyVales() {
  const c = document.getElementById('gestorMyVales');
  const hList = document.getElementById('gestorHistorialList');
  if(!c || !hList || !activeGestorId) return;
  // Asegurar que el banner de pendientes refleja el estado actual
  if (typeof _updatePendingSyncBanner === 'function') _updatePendingSyncBanner();

  const mine = ordenarRecientesPrimero(getVales().filter(v => v.gestorId === activeGestorId));
  const activeVales = mine.filter(v => ['pending','assigned','delivered','pending_payment'].includes(v.status));
  // History now separates confirmed sales from pending_payment (awaiting collection) — both "completed" deliveries
  // but pending_payment represents an outstanding balance the gestor should track.
  const historyVales = mine.filter(esValeConfirmadoVisible);
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
  // Override "pending" label when the vale aún no se ha confirmado en Supabase.
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
      // v50 FIX: fallback robusto. ANTES, si v.status era undefined o no estaba
      // en sMap, mostraba "• undefined". Ahora mostramos "• Estado desconocido"
      // y forzamos status='pending' para que al menos el vale se vea.
      const _status = v.status || 'pending';
      let s=sMap[_status]||{label:'Estado: '+escapeHTML(_status),color:'var(--gray-400)',icon:'•'};
      // Si el vale aún no se ha confirmado en Supabase, mostrar "Subiendo..." como label principal
      if(v.synced === false) s=pendingSyncing;
      // Show "Visto por admin" status when the admin has already opened this pending vale
      else if(_status==='pending' && v.seenByAdmin) s=pendingSeen;
      const pts=(v.valeProductos||[]).reduce((sum,p)=>{const pr=productoOf(p.id);return sum+(pr?pr.puntos*p.qty:0);},0);
      const canCancel=true; // v33: Allow deleting ANY vale from gestor side, not just pending
      return `<div class="mv-card st-${v.status}">
        <div class="mv-head">
          <span class="mv-time">${valeNumStr(v)?`<b style="color:var(--blue);">${valeNumStr(v)}</b> `:``}${timeStr(v.ts)}</span>
          <div style="display:flex;align-items:center;gap:6px;">
            ${pts>0?`<span style="font-size:10px;color:var(--blue);font-weight:700;">⭐ ${pts} pts</span>`:``}
            ${canCancel?`<button type="button" onclick="cancelVale(${v.id})" style="background:rgba(239,68,68,.12);border:none;color:var(--red);border-radius:6px;padding:2px 8px;font-size:11px;font-weight:700;cursor:pointer;" title="Eliminar vale">🗑️ Eliminar</button>`:``}
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
        const _vStatus = v.status || 'pending_payment';
        const s=sMap[_vStatus]||{label:_vStatus,color:'var(--yellow)',icon:'⏳'};
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
        const _vStatus = v.status || 'confirmed';
        const s=sMap[_vStatus]||{label:_vStatus,color:'var(--green)',icon:'✅'};
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
  // v52 FIX: la comisión se cuenta solo al completar la venta (status
  // 'confirmed' = cobrada). 'pending_payment' es entregado pero AÚN sin cobrar,
  // así que no debe generar comisión todavía.
  // v61 FIX: faltaba excluir los vales ocultos, y por eso la comisión se quedaba
  // "pegada". El botón 🙈 Ocultar historial marca los vales confirmados con
  // hiddenFromHistory:true; renderMyVales sí lo respeta y los quita del
  // historial, pero aquí no se miraba, así que la comisión de un vale que ya no
  // se ve por ninguna parte seguía en MIS COMISIONES sin forma de quitarla: los
  // vales activos ya estaban borrados y el vale que la generaba estaba oculto.
  // Ahora ambas vistas usan el mismo criterio. Ojo: esto solo afecta a lo que ve
  // el gestor. La comisión sigue intacta en el panel del admin, que es quien
  // paga — igual que avisa el propio texto del botón ("los datos NO se borran").
  const mine=valesConfirmadosDeGestor(activeGestorId);
  // Solo pendientes (NO en sobre ni cobrado) — fuera del gestor solo se muestra "Pendiente"
  const pendientes=mine.filter(v=>!v.commissionPaid&&v.commissionStatus!=='en_sobre'&&v.commissionStatus!=='cobrado');
  const enSobre=mine.filter(v=>v.commissionStatus==='en_sobre');
  const cobrados=mine.filter(v=>v.commissionPaid||v.commissionStatus==='cobrado');
  if(!pendientes.length&&!enSobre.length&&!cobrados.length){section.style.display='none';return;}
  section.style.display='block';
  let html='';
  // v39: Card style with icon containers matching original design
  // Pendientes — orange left border, hourglass icon box, "se acumulan" subtitle
  if(pendientes.length){
    const s=sumCommissions(pendientes);
    const badge=fmtComisionBadge(s.usd,s.mn,s.computed);
    html+=`<div class="card" style="border-left:4px solid #f59e0b;margin-bottom:8px;padding:12px 14px;display:flex;align-items:center;gap:12px;">
      <div style="background:var(--surface2);border-radius:10px;padding:8px 10px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;">⏳</div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:700;color:#f59e0b;">Pendiente</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${pendientes.length} comisión${pendientes.length!==1?'es':''} · se acumulan</div>
      </div>
      ${badge?`<div style="font-size:14px;font-weight:800;color:var(--green);flex-shrink:0;">💵 ${badge}</div>`:''}
    </div>`;
  }
  // En sobre — yellow left border, envelope icon box
  if(enSobre.length){
    const s=sumCommissions(enSobre);
    const badge=fmtComisionBadge(s.usd,s.mn,s.computed);
    html+=`<div class="card" style="border-left:4px solid #eab308;margin-bottom:8px;padding:12px 14px;display:flex;align-items:center;gap:12px;opacity:.85;">
      <div style="background:var(--surface2);border-radius:10px;padding:8px 10px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;">✉️</div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:700;color:#eab308;">En sobre</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${enSobre.length} comisión${enSobre.length!==1?'es':''} · pendiente de entrega</div>
      </div>
      ${badge?`<div style="font-size:13px;font-weight:800;color:#eab308;flex-shrink:0;">✉️ ${badge}</div>`:''}
    </div>`;
  }
  // Cobrados — green left border, checkmark icon box, "completado" subtitle
  if(cobrados.length){
    html+=`<div class="card" style="border-left:4px solid #10b981;padding:12px 14px;display:flex;align-items:center;gap:12px;opacity:.85;">
      <div style="background:var(--surface2);border-radius:10px;padding:8px 10px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;">✅</div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:700;color:#10b981;">Cobrados</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${cobrados.length} comisión${cobrados.length!==1?'es':''} · completado</div>
      </div>
    </div>`;
  }
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
  if(clearBtn&&_gestorHistOpen){const hv=valesConfirmadosDeGestor(activeGestorId);clearBtn.style.display=hv.length?'block':'none';}
}
function clearGestorHistory(){
  const confirmed=valesConfirmadosDeGestor(activeGestorId);
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
  // v51 FIX: normalizar status
  const _vStatus = v.status || 'pending';
  const s = sMap[_vStatus]||{label:_vStatus,color:'var(--gray-400)',icon:'•'};
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
  if(!v){showToast('Vale no encontrado');return;}
  // v33: Allow cancelling/deleting ANY vale, not just pending
  showConfirmAction('¿Eliminar este vale?',`${v.cliente||''} · ${v.articulo||''}`,'Eliminar','btn-red',()=>{
    // v33 FIX: Actually DELETE the vale from Supabase instead of just marking
    // as 'cancelled'. Cancelled vales were reappearing on refresh because
    // they still existed in Supabase. Now we remove completely.
    _valesDirectDeleting.add(String(id));
    // Devolver el stock al inventario si este vale lo había descontado.
    // v52 FIX: la condición exigía además que el estado fuese confirmed o
    // pending_payment. Un vale con el stock ya descontado en cualquier otro
    // estado (p.ej. 'delivered' heredado) se borraba SIN devolver el stock —
    // inventario perdido en silencio, y este botón está disponible para el
    // gestor sobre cualquiera de sus vales. La bandera stockDecremented es por
    // sí sola la fuente de verdad, igual que ya hacía adminDeleteVale.
    _devolverStockDeVale(v);  // v73: misma regla que al revertir
    const filtered = getVales().filter(x=>x.id!==id);
    saveVales(filtered);
    _logAudit('vale_deleted', 'vale:' + id);
    // v52: quitar los avisos de estado de un vale que ya no existe, para que el
    // gestor no siga viendo "venta cobrada" de algo eliminado.
    _clearValeEventNotifs(id);
    if(selectedValeId===id)selectedValeId=null;
    showToast('Eliminando vale…');
    renderAdminGestores();renderValeDetail();renderMyVales();
    _doValeSupabaseDelete(v, id);
  });
}
// v34: Shared Supabase delete function with retry logic + extended guard
function _doValeSupabaseDelete(v, id) {
  const maxRetries = 3;
  let attempt = 0;
  function tryDelete() {
    attempt++;
    console.log(`[doValeDelete] Attempt ${attempt}/${maxRetries} for vale ${id}`);
    _sbRestDeleteVale(v.id, v.gestorId).then(() => {
      // v34: Keep guard active for 5 more seconds to prevent _doRestPoll
      // from re-adding the vale from a stale Supabase read.
      // ANTES: se borraba _valesDirectDeleting inmediatamente, y si _doRestPoll
      // corría en los próximos 2s antes del poll forzado, podía re-add el vale.
      setTimeout(() => {
        _valesDirectDeleting.delete(String(id));
      }, 5000);
      showToast('Vale eliminado ✓');
      maybeAutoSync();
      // v34: Force immediate poll to sync fresh state from Supabase
      if(typeof _doRestPoll === 'function') _doRestPoll();
    }).catch(e => {
      console.error(`[doValeDelete] Attempt ${attempt} failed:`, e);
      if (attempt < maxRetries) {
        showToast(`Reintentando eliminación (${attempt}/${maxRetries})…`);
        setTimeout(tryDelete, 2000 * attempt); // exponential backoff
      } else {
        _valesDirectDeleting.delete(String(id));
        console.error('[doValeDelete] All retries exhausted:', e);
        showToast('⚠️ No se pudo borrar de la nube — se reintentará al reconectar');
        // v33: Re-enqueue the deletion so it gets retried when connection returns
        _enqueueSB(`vales/${v.gestorId}/${v.id}`, null, 'remove');
      }
    });
  }
  tryDelete();
}

function adminDeleteVale(id) {
  const v=getVales().find(x=>x.id===id);if(!v)return;
  // v33 FIX: Allow deleting ANY vale, including confirmed/pending_payment.
  const needsStockRevert = _valeDescontoStock(v);  // v73: misma regla que la devolución real, para que el aviso no mienta
  const confirmMsg = needsStockRevert
    ? `¿Eliminar este vale?<br><br><b>⚠️ Se revertirá el stock automáticamente</b> porque la venta ya fue confirmada.`
    : `¿Eliminar este vale?`;
  showConfirmAction('¿Eliminar este vale?',`${v.cliente||''} · ${v.articulo||''}`,'Eliminar','btn-red',()=>{
    // v33: Auto-revert stock if the vale was confirmed/pending_payment
    _devolverStockDeVale(v);  // v73: misma regla que al revertir
    // v33 FIX: Track this deletion so _doRestPoll doesn't overwrite localStorage
    // with stale Supabase data while the delete is in flight.
    _valesDirectDeleting.add(String(id));
    const filtered = getVales().filter(x=>x.id!==id);
    saveVales(filtered);
    _logAudit('vale_deleted', 'vale:' + id);
    // v52: quitar los avisos de estado de un vale que ya no existe, para que el
    // gestor no siga viendo "venta cobrada" de algo eliminado.
    _clearValeEventNotifs(id);
    if(selectedValeId===id)selectedValeId=null;
    showToast('Eliminando vale…');
    renderAdminGestores();renderValeDetail();renderMyVales();
    // v33: Use shared delete function with retry and verification
    _doValeSupabaseDelete(v, id);
  });
}

// ══════════════════════════════════════════
//  VALE FORM
// ══════════════════════════════════════════
// v69: abre y cierra el bloque "Más detalles" del formulario de vale.
// Los campos de dentro (carnet, garantía, comisión, fecha) casi nunca se tocan y
// alargaban la pantalla del gestor, que crea vales varias veces al día. No se
// plegaron los de precio: alimentan el cálculo automático del total.
// ── v75: cesión de comisión del gestor ──────────────────────────────────────
// Calcula cuánta comisión daría este vale con los productos elegidos, para
// enseñar el tope ("tu comisión aquí es de $10") y no dejar ceder más de eso.
// Sin ese tope, un número mal tecleado dejaría la comisión en cero sin que el
// gestor lo entienda.
function _comisionDelValeEnCurso() {
  const falso = { valeProductos: (typeof currentValeProductos !== 'undefined' && currentValeProductos) ? currentValeProductos : [] };
  try { return getValeCommissionParts(falso); } catch(e) { return {totalUSD:null, totalMN:null}; }
}
// ── v77: bloqueo de los campos que rellena la app ───────────────────────────
// Un campo que se autocompleta y además se deja escribir es una trampa: el
// gestor toca el precio después de elegir productos del catálogo, deja de
// cuadrar con lo que suma la app, y el error no se ve hasta que el admin cobra.
// Se bloquean solo los que la app sabe calcular:
//   · comisión → siempre; es informativa, la de verdad sale de los productos
//   · precios  → solo si hay productos del catálogo; si el artículo se escribió
//                a mano, no hay de dónde calcularlos y tiene que poder ponerlos
//   · dirección y mensajería → mientras "recogida en tienda" esté marcada
// Artículo, garantía y total se quedan editables a propósito: el formulario
// invita a escribirlos a mano y a veces hay que ajustarlos.
function _bloquearCampo(id, bloquear, titulo) {
  const el = document.getElementById(id);
  if (!el) return;
  el.readOnly = !!bloquear;
  el.classList.toggle('vf-auto-lock', !!bloquear);
  if (bloquear) el.title = titulo || 'Lo calcula la app a partir de los productos';
  else el.removeAttribute('title');
}
function _aplicarCamposAuto() {
  // v78: artículo y precios se bloquean SIEMPRE, no solo cuando ya hay productos
  // elegidos. Todo lo que se vende está en el catálogo, y tanto el artículo como
  // su precio salen de ahí: dejar escribir era una vía abierta a que el vale
  // dijera un producto o un importe distintos de los que la app tiene fichados.
  // Efecto buscado: para hacer un vale hay que pasar por "Seleccionar del
  // catálogo". El artículo es obligatorio, así que sin elegir productos el vale
  // no se envía.
  _bloquearCampo('vf-articulo', true, 'Los productos se añaden desde "Seleccionar del catálogo"');
  _bloquearCampo('vf-comisionGestor', true, 'Se calcula con la comisión de cada producto');
  _bloquearCampo('vf-precioUSD', true, 'Sale del precio de catálogo de los productos elegidos');
  _bloquearCampo('vf-precioMN',  true, 'Sale del precio de catálogo de los productos elegidos');
  const chk = document.getElementById('vf-recogidaTienda');
  const enTienda = !!(chk && chk.checked);
  _bloquearCampo('vf-direccion',  enTienda, 'Recogida en tienda: no hay envío a domicilio');
  _bloquearCampo('vf-mensajeria', enTienda, 'Recogida en tienda: no hay envío a domicilio');
}

function onCesionComisionInput() {
  const inp = document.getElementById('vf-comisionCedida');
  const sel = document.getElementById('vf-comisionCedidaMoneda');
  const nota = document.getElementById('vf-cesionNota');
  const motivo = document.getElementById('vf-cesionMotivo');
  if (!inp || !nota) return;
  const moneda = (sel && sel.value === 'MN') ? 'MN' : 'USD';
  const r = _comisionDelValeEnCurso();
  const tope = moneda === 'MN' ? (r.totalMN || 0) : (r.totalUSD || 0);
  let val = Math.max(0, parseFloat(inp.value) || 0);
  if (tope > 0 && val > tope) { val = tope; inp.value = val; }   // no se puede ceder más de lo que se gana
  // El motivo solo aparece cuando de verdad se cede algo: pedirlo siempre sería
  // un campo más que estorba en el 95% de los vales.
  if (motivo) motivo.style.display = val > 0 ? '' : 'none';
  const fmt = n => moneda === 'MN' ? (Math.round(n) + ' MN') : ('$' + n.toFixed(2) + ' USD');
  if (!tope) {
    nota.textContent = val > 0
      ? 'Elige primero los productos para saber cuánta comisión tiene este vale.'
      : 'Aquí puedes renunciar a parte de tu comisión en este vale.';
    nota.style.color = 'var(--text-muted)';
  } else if (val <= 0) {
    nota.textContent = 'Tu comisión en este vale es de ' + fmt(tope) + '.';
    nota.style.color = 'var(--text-muted)';
  } else {
    // v76: lo que más importa al gestor no es su comisión, sino qué le dice al
    // cliente. Se muestran las dos cosas.
    const _tot = document.getElementById('vf-total');
    const _numTot = _tot ? parsePrecioNum(_tot.value || '') : 0;
    const _totEsMN = _tot ? /\bMN\b|\bCUP\b/i.test(_tot.value || '') : false;
    let _txt = 'De ' + fmt(tope) + ' cobrarías ' + fmt(Math.max(0, tope - val)) + '.';
    if (_numTot > 0 && ((moneda === 'MN') === _totEsMN)) {
      _txt += ' El cliente paga ' + fmt(Math.max(0, _numTot - val)) + ' en vez de ' + fmt(_numTot) + '.';
    }
    nota.textContent = _txt;
    nota.style.color = 'var(--orange)';
  }
  if (typeof onFormInput === 'function') onFormInput();
}

function toggleVfExtras(forzar) {
  const box = document.getElementById('vfExtras');
  const arrow = document.getElementById('vfExtrasArrow');
  if (!box) return;
  const abrir = (typeof forzar === 'boolean') ? forzar : (box.style.display === 'none');
  box.style.display = abrir ? 'block' : 'none';
  if (arrow) arrow.textContent = abrir ? '▲' : '▼';
}
// Si el vale que se está editando ya trae algo en esos campos, se abre solo:
// esconder un dato que el gestor escribió sería peor que el formulario largo.
function _abrirVfExtrasSiTieneDatos() {
  const ids = ['vf-carnet','vf-garantia','vf-comisionGestor'];
  const hayAlgo = ids.some(id => {
    const el = document.getElementById(id);
    return el && el.value && el.value.trim() !== '';
  });
  if (hayAlgo) toggleVfExtras(true);
}

const REQUIRED=['vf-cliente','vf-telefono','vf-direccion','vf-articulo','vf-total'];
const fVal = id => (document.getElementById(id)?.value||'').trim();

// v92: esta cuenta —precio USD + precio MN + mensajería→ total— estaba escrita
// DOS veces, una para el formulario del gestor (vf-) y otra igual para el vale
// que crea el admin (av-). En el formulario de EDITAR un vale (ev-) no estaba
// ninguna de las dos, y por eso al añadirle un producto el total se quedaba como
// estaba. Ahora es una sola función que recibe el prefijo de los campos: añadir
// un cuarto formulario mañana no vuelve a dejarse la cuenta por el camino.
function _calcTotalDe(pfx) {
  const pUSD = document.getElementById(pfx + '-precioUSD')?.value || '';
  const pMN  = document.getElementById(pfx + '-precioMN')?.value || '';
  const mens = document.getElementById(pfx + '-mensajeria')?.value || '';

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

  const totalInput = document.getElementById(pfx + '-total');
  if(out.length > 0 && totalInput) {
    totalInput.value = out.join(' + ');
  } else if (totalInput && !pUSD && !pMN && !mens) {
    totalInput.value = '';
  }
}
function calcAutoTotal() { _calcTotalDe('vf'); }
function calcEditValeTotal() { _calcTotalDe('ev'); }

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
    // v104: solo aparece si el gestor puso hora, para no meter una línea vacía
    // en todos los mensajes que no la usan.
    ...(fVal('vf-horaEntrega') ? [`🔸Hora de entrega: ${fVal('vf-horaEntrega')}`] : []),
    `🔸 Artículos y cantidades:`,prodLines,
    `🔸Precio USD/ zelle: ${fVal('vf-precioUSD')}`,
    `🔸Precio MN: ${fVal('vf-precioMN')}`,
    `🔸 Vuelto: ${fVal('vf-vuelto')}`,
    ...(function(){
      // v79: usa la misma función que el ticket y el resto, en vez de repetir
      // la cuenta aquí. Cuando estaba duplicada, el ticket de recogida se quedó
      // sin actualizar y seguía enseñando el precio de lista.
      const _r = _rebajaFormulario();
      const _tot = fVal('vf-total');
      if (!_r) return [`🔸 Total a pagar: ${_tot}`];
      return [`🔸 Precio: ${_tot}`,
              `🔸 Rebaja: −${_r.rebajaTxt}`,
              `🔸 Total a pagar: ${_r.aCobrarTxt || (_tot + ' menos ' + _r.rebajaTxt)}`];
    })(), '',
    `*Garantía: ${fVal('vf-garantia')}`,
    `*Fecha y hora de Venta: ${fVal('vf-fecha')||nowDateTime()}`, '',
    '🧭Dirección de la tienda:','* Amistad #311 % San Rafael y San José, Centro Habana.','',
    '🚨ATENCIÓN🚨','•   Horarios de atención al cliente:','    9:00am - 7:00pm.',
    '* Solo aceptamos hasta cinco billetes de 1 USD por compra.',
    '* Los pagos en MN deben ser con denominación de 50 en adelante.',
    '* Solo se aceptan billetes en buen estado (ni rotos ni manchados)'].join('\n');
}

// ── Regenera valeText a partir de un vale existente (no del form) ──
// v14: NO enviamos valeText a Supabase (~300-500 bytes por vale).
// En su lugar, lo regeneramos al leer el vale desde Supabase.
// Esto reduce el payload de cada write en redes muy lentas.
// Para vales viejos que SÍ tienen valeText en Supabase, se respeta ese valor.
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
    ...(function(){
      // v76: mismo criterio que buildValeText — el texto debe decir lo que se
      // cobra de verdad, no el precio de lista.
      const _r = (typeof _rebajaVale === 'function') ? _rebajaVale(v) : null;
      if (!_r) return [`🔸 Total a pagar: ${v.total||''}`];
      return [`🔸 Precio: ${v.total||''}`,
              `🔸 Rebaja: −${_r.rebajaTxt}`,
              `🔸 Total a pagar: ${_r.aCobrarTxt || ((v.total||'') + ' menos ' + _r.rebajaTxt)}`];
    })(), '',
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

// v79: misma cuenta que _rebajaVale pero leyendo del formulario en curso, para
// el ticket de recogida y el texto del vale, que se generan antes de guardar.
// Estaba calculado a mano dentro de buildValeText, y por eso el ticket de
// recogida seguía enseñando el precio de lista: nadie se acordó de repetir la
// cuenta allí. Con una sola función, cualquier sitio que muestre el total la usa.
function _rebajaFormulario() {
  const el = document.getElementById('vf-comisionCedida');
  const cedida = Math.max(0, parseFloat((el && el.value) || 0) || 0);
  if (!cedida) return null;
  const selMon = document.getElementById('vf-comisionCedidaMoneda');
  return _rebajaVale({
    comisionCedida: cedida,
    comisionCedidaMoneda: (selMon && selMon.value === 'MN') ? 'MN' : 'USD',
    comisionCedidaMotivo: fVal('vf-cesionMotivo'),
    total: fVal('vf-total')
  });
}
// Total que hay que cobrar de verdad, ya con la rebaja aplicada. Si las monedas
// no cuadran devuelve el total tal cual y la rebaja se indica aparte.
function _totalACobrarFormulario() {
  const r = _rebajaFormulario();
  const tot = fVal('vf-total');
  if (!r) return tot;
  return r.aCobrarTxt || tot;
}

function openTicketModal(afterSend) {
  const g = gestorOf(activeGestorId);
  document.getElementById('tk-gestor').textContent = g ? g.name : '';
  document.getElementById('tk-cliente').textContent = fVal('vf-cliente') || 'Sin nombre';
  document.getElementById('tk-articulo').textContent = fVal('vf-articulo') || 'Sin artículo';
  document.getElementById('tk-total').textContent = _totalACobrarFormulario() || '—';  // v79: con la rebaja aplicada
  // v79: la fila de rebaja solo aparece cuando la hay.
  const _rt = _rebajaFormulario();
  const _rowReb = document.getElementById('tk-rebajaRow');
  if (_rowReb) {
    _rowReb.style.display = _rt ? 'flex' : 'none';
    const _celda = document.getElementById('tk-rebaja');
    if (_celda && _rt) _celda.textContent = '− ' + _rt.rebajaTxt;
  }

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
${(()=>{const _r=_rebajaFormulario();if(!_r)return '';return `💵 *Precio:* ${fVal('vf-total')}\n🤝 *Rebaja:* −${_r.rebajaTxt}\n`;})()}💰 *Total a pagar:* ${_totalACobrarFormulario() || '—'}
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
// v18: cuando se marca "recogida en tienda", deshabilitar dirección y mensajería
function onRecogidaTiendaChange() {
  const chk = document.getElementById('vf-recogidaTienda');
  if (!chk) return;
  const isStore = chk.checked;
  const dir = document.getElementById('vf-direccion');
  const men = document.getElementById('vf-mensajeria');
  const ubi = document.getElementById('vf-ubicacion');
  const ubiRow = document.getElementById('vf-ubicacionRow');
  _aplicarCamposAuto();  // v77: bloquea dirección y mensajería si es recogida
  if (isStore) {
    if (dir) { dir.value = 'Recogida en tienda'; dir.style.background = 'var(--surface2)'; dir.style.color = 'var(--text-muted)'; }
    if (men) { men.value = 'Sin envío'; men.style.background = 'var(--surface2)'; men.style.color = 'var(--text-muted)'; }
    if (ubi) ubi.value = '';
    if (ubiRow) ubiRow.style.display = 'none';
  } else {
    if (dir) { if (dir.value === 'Recogida en tienda') dir.value = ''; dir.style.background = ''; dir.style.color = ''; }
    if (men) { if (men.value === 'Sin envío') men.value = ''; men.style.background = ''; men.style.color = ''; }
    if (ubiRow) ubiRow.style.display = '';
  }
  onFormInput();
}

function resetForm() {
  ['vf-cliente','vf-telefono','vf-direccion','vf-carnet','vf-mensajeria','vf-articulo',
   'vf-precioUSD','vf-precioMN','vf-vuelto','vf-total','vf-garantia','vf-comisionGestor','vf-ubicacion',
   'vf-comisionCedida','vf-cesionMotivo','vf-horaEntrega'].forEach(id=>{
     const el=document.getElementById(id);if(el)el.value='';
   });
  const chk=document.getElementById('vf-recogidaTienda');if(chk)chk.checked=false;
  // v69: al limpiar, el bloque "Más detalles" vuelve a quedar plegado.
  if (typeof toggleVfExtras === 'function') toggleVfExtras(false);
  if (typeof _aplicarCamposAuto === 'function') _aplicarCamposAuto();  // v77
  onRecogidaTiendaChange();
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
  if(REQUIRED.some(id=>!fVal(id))){showToast('Completa los campos obligatorios (*)');return;}
  _isSendingVale = true;
  const btn=document.getElementById('sendValeBtn');
  if(btn){btn.disabled=true;btn.textContent='Enviando...';}

  // ── 1. Construir el vale y guardarlo LOCALMENTE (síncrono, ~1ms) ──
  // Esto ya deja el vale persistido en localStorage y encola la escritura a Supabase.
  // El usuario NO necesita esperar a que Supabase responda para ver el feedback.
  // `synced:false` indica que el vale aún no se ha confirmado en Supabase; el banner
  // de pendientes lo mostrará hasta que el write se complete.
  const g=gestorOf(activeGestorId);
  const vale={
    id:Date.now(),valeNum:getNextValeNum(),gestorId:activeGestorId,ts:new Date().toISOString(),
    cliente:fVal('vf-cliente'),telefono:fVal('vf-telefono'),direccion:fVal('vf-direccion'),carnet:fVal('vf-carnet'),
    mensajeria:fVal('vf-mensajeria'),articulo:fVal('vf-articulo'),
    precioUSD:fVal('vf-precioUSD'),precioMN:fVal('vf-precioMN'),
    vuelto:fVal('vf-vuelto'),total:fVal('vf-total'),garantia:fVal('vf-garantia'),comisionGestor:fVal('vf-comisionGestor'),
    horaEntrega:fVal('vf-horaEntrega'),   // v104: "HH:MM" o vacío
    // v81: comisión que da este vale HOY, congelada. Si mañana cambia el catálogo,
    // este vale sigue valiendo lo que valía. Se calcula sobre un objeto suelto
    // para que no se lea a sí mismo.
    ...(function(){
      try {
        const _r = getValeCommissionParts({valeProductos: currentValeProductos || []});
        if (_r.totalUSD === null && _r.totalMN === null) return {};   // no computable: mejor no congelar nada
        return { comFijadaUSD: _r.totalUSD || 0, comFijadaMN: _r.totalMN || 0 };
      } catch(e) { return {}; }
    })(),
    // v75: cesión de comisión (importe, moneda y motivo)
    comisionCedida: Math.max(0, parseFloat(fVal('vf-comisionCedida')) || 0),
    comisionCedidaMoneda: (document.getElementById('vf-comisionCedidaMoneda')||{}).value === 'MN' ? 'MN' : 'USD',
    comisionCedidaMotivo: fVal('vf-cesionMotivo'),
    recogidaTienda:!!document.getElementById('vf-recogidaTienda')?.checked,
    ubicacion:fVal('vf-ubicacion'),
    valeProductos:currentValeProductos,valeText:buildValeText(),
    status:'pending',mensajeroId:null,confirmedTs:null,isNew:true,adminNotes:'',
    synced:false, // se marcará true cuando Supabase confirme el write
  };
  const all=getVales();all.push(vale);saveVales(all);
  _valeLocalPatchTs.set(String(vale.id), Date.now()); // v39: track local patch
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
  //  - Si NO hay conexión o Supabase no responde → "Vale guardado ✓ · Se enviará cuando mejore la conexión"
  //  - Si hay conexión y la cola está vacía → "Vale guardado ✓ · Enviando al administrador"
  //  - Si hay conexión pero hay writes pendientes (red lenta) → "Vale guardado ✓ · Enviando al administrador"
  playSound('vale');
  if (!_onlineStatus || !_sbConnected) {
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
  // v31 FIX: Also sync categorias for the picker tabs
  if(!getProductos().length){
    showToast('Cargando productos…');
    Promise.all([
      _sbRestGetCollection('productos').catch(e => { console.warn('[picker] productos fetch error:', e); return []; }),
      _sbRestGetCollection('categorias').catch(e => { console.warn('[picker] categorias fetch error:', e); return []; })
    ]).then(([prodArr, catArr]) => {
      if (prodArr && prodArr.length > 0) {
        _syncCount++;
        try {
          // v41: Normalize products from Supabase
          prodArr.forEach(_normalizeProducto);
          localStorage.setItem('axon_productos', JSON.stringify(prodArr));
          _productosCache = prodArr; _productosDirty = false; _productosMap = null;  // v95
          if (catArr && catArr.length > 0) {
            localStorage.setItem('axon_categorias', JSON.stringify(catArr));
            _categoriasCache = catArr; _categoriasDirty = false;
          }
        } finally { _syncCount--; }
        openProductPicker();
      } else {
        showToast('El admin aún no ha cargado productos');
      }
    }).catch(() => { showToast('Error al cargar productos'); });
    return;
  }
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
    const reserved=_reservedTotal(p);
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
  closeProductPicker();_aplicarCamposAuto();onFormInput();
}
function renderSelectedProductsUI() {
  // v77: se llama siempre que cambia la selección de productos (al elegir, al
  // quitar y al limpiar), así que es el punto fiable para recalcular qué campos
  // van bloqueados. Si se quitan todos, los precios se vuelven a poder escribir.
  if (typeof _aplicarCamposAuto === 'function') _aplicarCamposAuto();
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
  const nuevoId=Date.now();list.push({id:nuevoId,name});guardarCategorias(list,[nuevoId]);inp.value='';renderStockCategorias();showToast('Categoría agregada');
}
function removeCategoria(id) {
  if(getProductos().some(p=>p.catId===id)){showToast('Primero mueve o elimina los productos de esta categoría');return;}
  showConfirmAction('¿Eliminar esta categoría?', 'Los productos quedarán sin categoría', 'Eliminar', 'btn-red', () => {
    guardarCategorias(getCategorias().filter(c=>c.id!==id),[id]);
    if(stockCatFilter===id)stockCatFilter=null;
    renderStockCategorias();renderProductGrid();
    showToast('Categoría eliminada');
  });
}
// v19: copiar SOLO la descripción del producto (no todo el texto del vale)
function copyProductDesc(id) {
  const p = productoOf(id);
  if (!p || !p.description) { showToast('Sin descripción'); return; }
  navigator.clipboard.writeText(p.description)
    .then(() => showToast('Descripción copiada ✓'))
    .catch(() => showToast('No se pudo copiar'));
}

// v19: Sistema de favoritos del gestor
// Los favoritos se guardan en localStorage del dispositivo del gestor.
// NO se sincronizan a Supabase — son personales de cada gestor.
function getGestorFavorites() {
  if (!activeGestorId) return [];
  try {
    const key = 'axon_favorites_' + activeGestorId;
    return JSON.parse(localStorage.getItem(key) || '[]');
  } catch(e) { return []; }
}
function toggleFavorite(productId) {
  if (!activeGestorId) return;
  const key = 'axon_favorites_' + activeGestorId;
  let favs = getGestorFavorites();
  const id = Number(productId);
  if (favs.includes(id)) {
    favs = favs.filter(f => f !== id);
    showToast('Removido de favoritos');
  } else {
    favs.push(id);
    showToast('⭐ Añadido a favoritos');
  }
  try { localStorage.setItem(key, JSON.stringify(favs)); } catch(e) {}
  renderProductGrid();
}
function isFavorite(productId) {
  return getGestorFavorites().includes(Number(productId));
}

function buildProdCard(p, cats, isAgotado) {
  const cat=cats.find(c=>c.id===p.catId);
  const stockOk=(p.stock||0)>0;
  const isLow=stockOk&&(p.stock||0)<=LOW_STOCK_THRESHOLD;
  const reserved=_reservedTotal(p);
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
  // v74: la tarjeta era una sola fila de tres columnas (foto · texto · botones).
  // Al agrandar los botones en v71 para poder tocarlos, esa tercera columna pasó
  // a ocupar unos 276 px y en un móvil no dejaba sitio al texto: el nombre se
  // partía en cuatro líneas y el precio, la comisión y los puntos se apilaban en
  // vertical, uno debajo de otro. Ahora son dos filas —arriba la información,
  // abajo el stock y las acciones—, que es como ya se veía en pantalla ancha.
  return `<div class="prod-card${cardCls}" style="display:flex;flex-direction:column;padding:11px 12px;">
    <div style="display:flex;align-items:center;gap:11px;">
      <div style="width:56px;height:56px;border-radius:9px;overflow:hidden;background:var(--gray-100);display:flex;align-items:center;justify-content:center;flex-shrink:0;${fullyReserved?'opacity:.5;':''}">
        ${p.photo
        ?`<img src="${escapeAttr(_resolvePhotoUrl(p.photo))}" alt="" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentElement.innerHTML='<span style=font-size:22px>📦</span>'">`
        :`<span style="font-size:22px;">📦</span>`}
      </div>
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;">
          <span class="prod-name" style="margin:0;font-size:14px;">${escapeHTML(p.name)}</span>
          ${cat?`<span class="prod-cat-tag" style="font-size:9px;">${escapeHTML(cat.name)}</span>`:''}
          ${reservedBadge}
        </div>
        <div style="display:flex;align-items:center;gap:9px;margin-top:3px;flex-wrap:wrap;">
          ${p.precio?`<span class="prod-price" style="margin:0;font-size:11px;">${escapeHTML(p.precio)}</span>`:''}
        ${p.comision?`<span style="font-size:10px;color:var(--green);font-weight:600;">💰 ${escapeHTML(p.comision)}</span>`:''}
        ${p.puntos?`<span style="font-size:10px;color:var(--blue);font-weight:600;">⭐ ${p.puntos} pts</span>`:''}
        ${p.garantia?`<span style="font-size:10px;color:var(--gray-400);">🛡️ ${escapeHTML(p.garantia)}</span>`:''}
        </div>
      </div>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-top:10px;padding-top:9px;border-top:1px solid var(--border);">
      <span style="font-size:12px;font-weight:700;color:${stockColor};">${stockLabel}</span>
      <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
        <button class="btn btn-ghost btn-sm btn-icono" style="color:${isFavorite(p.id)?'#F59E0B':'var(--gray-400)'};" onclick="toggleFavorite(${p.id})" title="Favorito">${isFavorite(p.id)?'⭐':'☆'}</button>
        ${p.description?`<button class="btn btn-ghost btn-sm btn-icono" onclick="copyProductDesc(${p.id})" title="Copiar descripción">📋</button>`:''}
        ${isAgotado
          ? `<button class="btn btn-green btn-sm btn-icono con-texto" onclick="openStockModal(${p.id})">📥 Reponer</button>`
          : `<button class="btn btn-ghost btn-sm btn-icono" onclick="openEditProductModal(${p.id})" title="Editar producto">✏️</button>
             <button class="btn btn-ghost btn-sm btn-icono" onclick="openStockModal(${p.id})" title="Ajustar stock">📥</button>
             <button class="btn btn-ghost btn-sm btn-icono" onclick="openReservaModal(${p.id})" style="color:#b45309;" title="Reservar / liberar unidades">🔐</button>`
        }
        <button class="btn btn-ghost btn-sm btn-icono" style="color:var(--red);" onclick="removeProducto(${p.id})" title="Eliminar producto">🗑️</button>
      </div>
    </div>
  </div>`;
}

// ── v84: buscador del apartado Stock ────────────────────────────────────────
// Con casi cien productos, encontrar uno para reponerlo obligaba a recorrer la
// lista entera o a acertar con la categoría. Busca por nombre y también por
// descripción, que es donde suele estar el modelo o la marca.
// Mientras se busca, el filtro por categoría se ignora a propósito: si escribes
// "router" y no aparece porque tenías puesta otra categoría, el buscador parece
// roto.
let _stockBusqueda = '';
function onBuscarStock() {
  const inp = document.getElementById('stockBuscador');
  _stockBusqueda = ((inp && inp.value) || '').trim().toLowerCase();
  const btn = document.getElementById('stockBuscadorLimpiar');
  if (btn) btn.style.display = _stockBusqueda ? 'block' : 'none';
  renderProductGrid();
}
function limpiarBuscadorStock() {
  const inp = document.getElementById('stockBuscador');
  if (inp) inp.value = '';
  _stockBusqueda = '';
  const btn = document.getElementById('stockBuscadorLimpiar');
  if (btn) btn.style.display = 'none';
  renderProductGrid();
  if (inp) inp.focus();
}
function _coincideBusquedaStock(p) {
  if (!_stockBusqueda) return true;
  const txt = ((p.name || '') + ' ' + (p.description || '')).toLowerCase();
  // Todas las palabras deben aparecer, en cualquier orden: "router mikrotik"
  // encuentra "Mikrotik hAP ax3 router".
  return _stockBusqueda.split(/\s+/).filter(Boolean).every(w => txt.includes(w));
}

function renderProductGrid() {
  let prods=getProductos();
  // v84: al buscar se ignora la categoría elegida — ver el motivo arriba.
  if (_stockBusqueda) prods = prods.filter(_coincideBusquedaStock);
  else if(stockCatFilter!==null)prods=prods.filter(p=>p.catId===stockCatFilter);
  {
    const _info = document.getElementById('stockBuscadorInfo');
    if (_info) {
      _info.style.display = _stockBusqueda ? 'block' : 'none';
      if (_stockBusqueda) _info.textContent = prods.length
        ? (prods.length + (prods.length === 1 ? ' producto encontrado' : ' productos encontrados') + ' · se buscó en todas las categorías')
        : 'Ningún producto coincide con “' + _stockBusqueda + '”';
    }
  }
  // v19: ordenar favoritos primero
  if (!IS_ADMIN && activeGestorId) {
    const favs = getGestorFavorites();
    prods.sort((a, b) => {
      const aFav = favs.includes(Number(a.id)) ? 0 : 1;
      const bFav = favs.includes(Number(b.id)) ? 0 : 1;
      return aFav - bFav;
    });
  }
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
  // v117: se ELIGE de los dueños dados de alta. Tecleando acababan tres
  // variantes del mismo nombre; con una lista eso no puede pasar.
  const sel=document.getElementById('pm-dueno');
  if(sel){
    const actual=sel.value;
    sel.innerHTML='<option value="">🏪 Mercancía de la tienda</option>'
      +listaDuenos().map(d=>`<option value="${d.id}">${escapeHTML(d.nombre)}</option>`).join('');
    sel.value=actual;
  }
}
function openAddProductModal() {
  editingProductId=null;
  document.getElementById('productModalTitle').textContent='📦 Nuevo Producto';
  ['pm-name','pm-desc','pm-precio','pm-costo','pm-dueno','pm-foto','pm-garantia','pm-comision'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  document.getElementById('pm-comision-amount').value='';
  document.getElementById('pm-comision-currency').value='USD';
  document.getElementById('pm-stock').value='0';document.getElementById('pm-puntos').value='0';
  document.getElementById('pm-foto-file').value='';
  _pintarFotoProducto('');
  populateCatSelect(null);document.getElementById('productModal').classList.add('show');
}
// v72: pinta la miniatura de la foto del producto y ajusta los botones.
// Estaba escrito en tres sitios distintos (al abrir en blanco, al editar y al
// elegir una foto nueva), cada uno con su propio HTML — el mismo patrón de
// duplicación que ya hizo divergir otras vistas de esta app.
// La miniatura es cuadrada: antes era width:100% y height:80px, así que una foto
// vertical salía aplastada y ocupaba todo el ancho del formulario.
// v72: avisa, bajo el campo Stock de la ficha del producto, de cuántas unidades
// hay comprometidas en vales. Desde esa ficha se puede escribir un stock por
// debajo de lo reservado y dejar el disponible descuadrado sin enterarse, porque
// ahí no se ven las reservas (sí en la ventana de stock).
function _notaStockProducto() {
  const nota = document.getElementById('pm-stockNota');
  if (!nota) return;
  const p = editingProductId ? productoOf(editingProductId) : null;
  const reservado = p ? _reservedTotal(p) : 0;
  if (!reservado) { nota.textContent = ''; return; }
  const escrito = Math.max(0, parseInt(document.getElementById('pm-stock').value, 10) || 0);
  if (escrito < reservado) {
    nota.textContent = '⚠️ Hay ' + reservado + ' unidades reservadas en vales: con ' + escrito + ' no alcanzan.';
    nota.style.color = 'var(--red)';
  } else {
    nota.textContent = reservado + ' reservadas · quedarían ' + (escrito - reservado) + ' para vender';
    nota.style.color = 'var(--text-muted)';
  }
}

function _pintarFotoProducto(url) {
  const cont = document.getElementById('pm-fotoPreview');
  const btnQuitar = document.getElementById('pm-fotoQuitar');
  const btnTexto = document.getElementById('pm-fotoBtnTexto');
  if (!cont) return;
  if (url) {
    cont.innerHTML = '<img src="' + escapeAttr(url) + '" style="width:84px;height:84px;object-fit:cover;border-radius:10px;border:1px solid var(--border);display:block;">';
    if (btnQuitar) btnQuitar.style.display = '';
    if (btnTexto) btnTexto.textContent = 'Cambiar foto';
  } else {
    cont.innerHTML = '<div style="width:84px;height:84px;border-radius:10px;border:1px dashed var(--border);background:var(--surface2);display:flex;align-items:center;justify-content:center;font-size:26px;opacity:.45;">📦</div>';
    if (btnQuitar) btnQuitar.style.display = 'none';
    if (btnTexto) btnTexto.textContent = 'Elegir foto';
  }
}
// Deja el producto sin foto. Antes no había manera: una vez puesta, solo se
// podía sustituir por otra.
function quitarFotoProducto() {
  const h = document.getElementById('pm-foto');
  const f = document.getElementById('pm-foto-file');
  if (h) h.value = '';
  if (f) f.value = '';
  _pintarFotoProducto('');
  showToast('Foto quitada — recuerda guardar');
}

function openEditProductModal(id) {
  const p=productoOf(id);if(!p)return;
  editingProductId=id;
  document.getElementById('productModalTitle').textContent='✏️ Editar Producto';
  document.getElementById('pm-name').value=p.name||'';
  document.getElementById('pm-desc').value=p.description||'';
  document.getElementById('pm-precio').value=p.precio||'';
  {const elC=document.getElementById('pm-costo');if(elC)elC.value=costoDe(id);}   // v114: vive aparte
  {const elD=document.getElementById('pm-dueno');if(elD)elD.value=duenoIdDe(id)==null?'':String(duenoIdDe(id));}   // v117
  document.getElementById('pm-stock').value=p.stock||0;
  document.getElementById('pm-puntos').value=p.puntos||0;
  document.getElementById('pm-garantia').value=p.garantia||'';
  document.getElementById('pm-comision').value=p.comision||'';
  // Parse comision into amount + currency fields
  {const com=p.comision||'';
   const isMN=com.toUpperCase().includes('MN');
   const numParsed=parseFloat(com.replace(/[^0-9.]/g,'')); const num=isNaN(numParsed)?'':numParsed;
   document.getElementById('pm-comision-amount').value=num;
   document.getElementById('pm-comision-currency').value=isMN?'MN':'USD';}
  document.getElementById('pm-foto').value=p.photo||'';
  document.getElementById('pm-foto-file').value='';
  populateCatSelect(p.catId);
  _pintarFotoProducto(p.photo ? _resolvePhotoUrl(p.photo) : '');
  _notaStockProducto();
  document.getElementById('productModal').classList.add('show');
}
// Compress + convert image to WebP (with JPEG fallback for very old browsers).
// WebP files are ~30-50% smaller than JPEG at equivalent quality, which saves
// localStorage quota and Supabase bandwidth. The original uploaded file is
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
        // Aplicar el cambio (esto guarda en LS + encola Supabase + re-publica catálogo).
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
    `Se convertirán ${total} foto${total === 1 ? '' : 's'} JPEG/PNG a WebP y se borrarán las originales. Esto libera espacio en localStorage y Supabase. El proceso puede tardar según la cantidad.`,
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
      _pintarFotoProducto(compressed);
      const formatLabel = compressed.startsWith('data:image/webp') ? 'WebP' : 'JPEG';
      showToast(`✅ ${formatLabel} · ${savings}% más pequeño`, );
    });
  };
  reader.onerror=()=>{showToast('Error al leer el archivo');};
  reader.readAsDataURL(file);
}
// ══════════════════════════════════════════════════════════════════════════
//  v106 · LAS FOTOS VIVEN EN GITHUB, NO DENTRO DE LA FILA
// ══════════════════════════════════════════════════════════════════════════
// Una foto guardada como texto base64 dentro del producto viaja con él CADA VEZ
// que alguien baja el catálogo. Y el catálogo se baja entero en cuanto cambia
// cualquier cosa — y cambia con cada venta, porque baja el stock.
//
// Medido el 17/08/2026: 12 productos con la foto incrustada sumaban 705 KB de
// los 842 KB de la tabla. El 84% de cada bajada eran fotos que no habían
// cambiado. A doce bajadas por hora y por teléfono, ahí se fueron los 5 GB del
// plan gratuito de Supabase.
//
// Los otros 75 productos ya lo hacían bien: guardan la ruta "photos/xxx.webp" y
// el archivo vive en GitHub, donde el service worker lo cachea PARA SIEMPRE
// —el nombre lleva un hash del contenido, así que si la foto cambia, cambia la
// ruta—. Bajar una foto una vez en la vida del teléfono, en vez de doce veces
// por hora.
//
// Esto sube la foto a GitHub y devuelve la ruta. Si no se puede (sin token, sin
// conexión, repo mal configurado) devuelve null y quien llama decide: aquí se
// prefiere guardar la foto como antes a perderla.
async function _subirFotoAGitHub(dataUri, prodId) {
  const cfg = getConfig() || {};
  const tok = ghToken();
  if (!tok || !cfg.ghRepo) return null;
  const m = /^data:image\/([a-z]+);base64,(.+)$/i.exec(String(dataUri || ''));
  if (!m) return null;
  const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
  const base64 = m[2];
  // El nombre lleva un trozo del hash del contenido: dos fotos distintas nunca
  // comparten archivo, y la misma foto no se vuelve a subir con otro nombre.
  let hash = '';
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(base64));
    hash = [...new Uint8Array(buf)].slice(0, 4).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (e) {
    hash = Math.abs(base64.length * 2654435761 % 4294967296).toString(16).slice(0, 8);
  }
  const ruta = `photos/p-${prodId}-${hash}.${ext}`;
  const partes = cfg.ghRepo.split('/').filter(Boolean);
  if (partes.length < 2) return null;
  const url = `https://api.github.com/repos/${partes[0]}/${partes.slice(1).join('/')}/contents/${ruta}`;
  const headers = { Authorization: `token ${tok}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' };
  try {
    // ¿Ya está subida? Mismo contenido → mismo nombre → no hay nada que hacer.
    const previo = await fetch(url, { headers });
    if (!previo.ok) {
      const res = await fetch(url, {
        method: 'PUT', headers,
        body: JSON.stringify({ message: `foto producto ${prodId}`, content: base64 })
      });
      if (!res.ok) {
        console.warn('[fotos] GitHub respondió', res.status, 'al subir', ruta);
        return null;
      }
    }
    // ── v109: subida ≠ servida ────────────────────────────────────────────────
    // El 21/08 el "Aligerar catálogo" dejó varias fotos en blanco. No se perdió
    // nada —los archivos estaban en el repositorio y eran WebP correctos— pero
    // la app pide la foto por HTTP y GitHub Pages publica con retraso. Entre que
    // la fila del producto pasó a apuntar a la ruta (instantáneo) y que el
    // archivo se pudo descargar (unos minutos después) quedó una ventana con la
    // foto rota, y desde fuera eso es indistinguible de haberla perdido.
    // El fallo no fue subir mal: fue soltar la foto original antes de comprobar
    // que la copia ya se podía bajar. Ahora se comprueba, y si todavía no está,
    // se deja el producto como estaba y se reintenta más tarde: el archivo ya
    // quedó subido, así que el siguiente intento solo tiene que verificarlo.
    if (!await _fotoDescargable(ruta)) {
      console.warn('[fotos]', ruta, 'subida pero todavía no se puede descargar — se deja la original');
      return null;
    }
    return ruta;
  } catch (e) {
    console.warn('[fotos] no se pudo subir', ruta, e && e.message);
    return null;
  }
}

// ¿Se puede bajar ya esta foto desde donde la va a pedir la app? Se pregunta por
// la misma dirección que usará el <img>, para que la respuesta valga de algo.
async function _fotoDescargable(ruta) {
  try {
    const url = _resolvePhotoUrl(ruta) + (ruta.includes('?') ? '&' : '?') + 'v=' + Date.now();
    const r = await fetch(url, { cache: 'no-store' });
    return !!(r && r.ok);
  } catch (e) { return false; }
}

// ── v107: el mismo trabajo, pero solo y sin avisar ──────────────────────────
// Corre al arrancar el admin. No pregunta ni interrumpe: si hay fotos dentro de
// la base de datos y GitHub está configurado, las va sacando. Lo único que se
// ve es el aviso final, y solo si movió algo.
// Va de una en una a propósito: son peticiones a la API de GitHub y no hay
// ninguna prisa. Si algo falla, no se toca ese producto y se reintentará en el
// siguiente arranque.
let _aligerandoCatalogo = false;
async function _aligerarCatalogoAuto() {
  if (_aligerandoCatalogo) return;
  if (typeof IS_ADMIN === 'undefined' || !IS_ADMIN) return;
  const cfg = getConfig() || {};
  if (!ghToken() || !cfg.ghRepo) return;      // sin GitHub no hay dónde ponerlas
  if (!navigator.onLine) return;
  const lista = getProductos().slice();
  const pesados = lista.filter(p => p && typeof p.photo === 'string' && p.photo.startsWith('data:image'));
  if (!pesados.length) return;

  _aligerandoCatalogo = true;
  try {
    const kb = Math.round(pesados.reduce((a, p) => a + p.photo.length, 0) / 1024);
    console.log(`[fotos] ${pesados.length} foto(s) dentro de la base de datos (${kb} KB) — sacándolas a GitHub`);
    const tocados = [];
    for (const p of pesados) {
      const ruta = await _subirFotoAGitHub(p.photo, p.id);
      if (!ruta) continue;
      const i = lista.findIndex(x => x && x.id === p.id);
      if (i === -1) continue;
      lista[i] = { ...lista[i], photo: ruta, imagen: ruta };
      tocados.push(p.id);
    }
    if (tocados.length) {
      guardarProductos(lista, tocados);
      try { renderProductGrid(); } catch(e) {}
      showToast(`☁️ ${tocados.length} foto(s) movidas a GitHub · el catálogo pesa menos`);
    }
  } finally { _aligerandoCatalogo = false; }
}

// La misma operación a mano, desde el botón "☁️ Aligerar catálogo". Se queda
// como red de seguridad: si la automática no pudo (sin conexión, sin token),
// aquí se ve exactamente qué pasa en vez de fallar en silencio.
async function migrarFotosAGitHub() {
  const cfg = getConfig() || {};
  if (!ghToken() || !cfg.ghRepo) {
    showToast('Configura GitHub primero en ⚙️ Config');
    return;
  }
  const lista = getProductos().slice();
  const pesados = lista.filter(p => p && typeof p.photo === 'string' && p.photo.startsWith('data:image'));
  if (!pesados.length) { showToast('No hay fotos que mover: el catálogo ya está ligero ✓'); return; }
  const kb = Math.round(pesados.reduce((a, p) => a + p.photo.length, 0) / 1024);

  showConfirmAction(
    `¿Mover ${pesados.length} foto${pesados.length > 1 ? 's' : ''} a GitHub?`,
    `Son ${kb} KB que ahora mismo se descargan cada vez que alguien abre el catálogo. ` +
    `Las fotos se ven igual: pasan a servirse desde GitHub, donde el teléfono las guarda para siempre. ` +
    `Si alguna no se puede subir, se queda como está.`,
    'Mover', 'btn-green', async () => {
      let hechas = 0, fallidas = 0;
      const tocados = [];
      for (const p of pesados) {
        showToast(`📤 Subiendo ${hechas + fallidas + 1} de ${pesados.length}…`);
        const ruta = await _subirFotoAGitHub(p.photo, p.id);
        if (!ruta) { fallidas++; continue; }
        const i = lista.findIndex(x => x && x.id === p.id);
        if (i === -1) { fallidas++; continue; }
        lista[i] = { ...lista[i], photo: ruta, imagen: ruta };
        tocados.push(p.id);
        hechas++;
      }
      if (tocados.length) guardarProductos(lista, tocados);
      renderProductGrid();
      if (typeof renderAdminCatalog === 'function') { try { renderAdminCatalog(); } catch(e) {} }
      showToast(fallidas
        ? `${hechas} movida(s), ${fallidas} sin mover (revisa la conexión y reintenta)`
        : `✅ ${hechas} foto(s) movidas · el catálogo pesa ${kb} KB menos en cada bajada`);
    }
  );
}

function closeProductModal(){document.getElementById('productModal').classList.remove('show');editingProductId=null;}
async function saveProduct() {
  const name=document.getElementById('pm-name').value.trim();if(!name){showToast('El nombre es obligatorio');return;}
  const catVal=document.getElementById('pm-cat').value;
  const prod={
    name,description:document.getElementById('pm-desc').value.trim(),
    precio:document.getElementById('pm-precio').value.trim(),
    stock:parseInt(document.getElementById('pm-stock').value)||0,
    puntos:parseFloat(document.getElementById('pm-puntos').value)||0,
    garantia:document.getElementById('pm-garantia').value.trim(),
    comision:(()=>{const amt=parseFloat(document.getElementById('pm-comision-amount').value);const cur=document.getElementById('pm-comision-currency').value;return amt>0?(cur==='MN'?`${amt} MN`:`$${amt} USD`):''})(),
    photo:document.getElementById('pm-foto').value.trim(),
    catId:catVal?parseInt(catVal):null,
  };
  // v106: si la foto viene incrustada (base64), se sube a GitHub y en el
  // producto queda solo la ruta. Si la subida falla, se guarda como antes: es
  // mejor un catálogo pesado que un producto sin foto.
  if (prod.photo && prod.photo.startsWith('data:image')) {
    const idParaFoto = editingProductId || Date.now();
    showToast('📤 Subiendo la foto…');
    const ruta = await _subirFotoAGitHub(prod.photo, idParaFoto);
    if (ruta) { prod.photo = ruta; prod.imagen = ruta; }
    else showToast('⚠️ La foto se guarda en la base de datos (revisa GitHub en ⚙️ Config)');
  }
  // v114: el costo NO va dentro del producto —ver la nota en getCostos()— así
  // que se guarda aparte, con el id que le toque.
  const costoEscrito=(document.getElementById('pm-costo')||{value:''}).value.trim();
  const duenoElegido=(document.getElementById('pm-dueno')||{value:''}).value;
  if(editingProductId){
    const old=productoOf(editingProductId);
    setCosto(editingProductId,costoEscrito);
    setDuenoProducto(editingProductId,duenoElegido);
    patchProducto(editingProductId,prod);
    if(old&&old.stock===0&&prod.stock>0) addNotif('restocked',prod.name,editingProductId,`stock: ${prod.stock}`);
    showToast('Producto actualizado ✓');
  } else {
    const newId=Date.now();
    setCosto(newId,costoEscrito);
    setDuenoProducto(newId,duenoElegido);
    const list=getProductos().slice();list.push({id:newId,...prod});guardarProductos(list,[newId]);
    addNotif('new_product',prod.name,newId,prod.precio||'');
    showToast('Producto agregado ✓');
  }
  closeProductModal();renderProductGrid();renderStockCategorias();maybeAutoSync();
}
function removeProducto(id) {
  const p=productoOf(id);
  const name = p ? p.name : 'este producto';
  showConfirmAction('¿Eliminar este producto?', name, 'Eliminar', 'btn-red', () => {
    // v95: al mandar este id como ausente, guardarProductos manda un borrado
    // de verdad. Antes solo se quitaba del teléfono y la siguiente
    // sincronización lo devolvía a la vida.
    guardarProductos(getProductos().filter(x=>x.id!==id), [id]);
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
    id:Date.now(),valeNum:getNextValeNum(),gestorId:'admin',ts:new Date().toISOString(),
    cliente:'Venta Directa en Tienda',telefono:'',direccion:'Tienda Física',
    mensajeria:'',articulo:`${p.name} x${qty}`,
    precioUSD:p.precio,precioMN:'',
    vuelto:'',total:'Venta Local',garantia:p.garantia||'',
    valeProductos:[{id:p.id,name:p.name,qty}],valeText:'Venta en tienda',
    status:'confirmed',mensajeroId:null,confirmedTs:new Date().toISOString(),isNew:false,adminNotes:'Venta directa sin gestor',
    commissionPaid:true,commissionStatus:'cobrado',commissionPaidTs:new Date().toISOString(),
    stockDecremented:true
  };
  const all=getVales();all.push(vale);saveVales(all);
  // v114: esta venta nace ya confirmada, así que no pasa por patchVale y hay
  // que congelarle el costo aquí.
  try { _congelarCostoVale(vale); } catch(e) {}
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
// ── v70: ajuste de stock con modal propio ───────────────────────────────────
// Antes esto era un prompt() del navegador que pedía el valor ABSOLUTO: con 5
// unidades en almacén y una entrada de 10, había que escribir 15 calculándolo de
// cabeza. Un error de cuenta ahí descuadra el inventario real y no se nota hasta
// que un vale falla por falta de stock.
// El modal muestra los tres números que importan (almacén, reservado y lo que
// realmente se puede vender), permite sumar y restar, y avisa de lo que va a
// pasar antes de guardar.
let _stockModalId = null;
function openStockModal(id) {
  const p = productoOf(id); if (!p) return;
  _stockModalId = id;
  const stock = parseInt(p.stock || 0, 10);
  document.getElementById('stockModalName').textContent = p.name || 'Producto';
  document.getElementById('stockModalInput').value = stock;
  closeProductModalIfOpen();
  document.getElementById('stockModal').classList.add('show');
  stockModalRefresca();
}
function closeProductModalIfOpen() {
  // El ajuste puede lanzarse desde la ficha del producto; si está abierta se
  // cierra para no apilar dos modales.
  const pm = document.getElementById('productModal');
  if (pm && pm.classList.contains('show')) pm.classList.remove('show');
}
function closeStockModal() {
  const m = document.getElementById('stockModal');
  if (m) m.classList.remove('show');
  _stockModalId = null;
}
function stockModalSuma(delta) {
  const inp = document.getElementById('stockModalInput'); if (!inp) return;
  const v = Math.max(0, (parseInt(inp.value, 10) || 0) + delta);
  inp.value = v;
  stockModalRefresca();
}
function stockModalPonACero() {
  const inp = document.getElementById('stockModalInput'); if (!inp) return;
  inp.value = 0; stockModalRefresca();
}
// Recalcula los tres contadores y explica en una línea qué va a pasar al guardar.
function stockModalRefresca() {
  const p = productoOf(_stockModalId); if (!p) return;
  const nuevo = Math.max(0, parseInt(document.getElementById('stockModalInput').value, 10) || 0);
  const reservado = _reservedTotal(p);
  const disponible = Math.max(0, nuevo - reservado);
  document.getElementById('stockModalFisico').textContent = nuevo;
  document.getElementById('stockModalReservado').textContent = reservado;
  document.getElementById('stockModalDisponible').textContent = disponible;
  const antes = parseInt(p.stock || 0, 10);
  const dif = nuevo - antes;
  const res = document.getElementById('stockModalResumen');
  if (!res) return;
  if (dif === 0) { res.textContent = 'Sin cambios (ahora hay ' + antes + ')'; res.style.color = 'var(--text-muted)'; }
  else if (dif > 0) { res.textContent = 'Entran ' + dif + ' · de ' + antes + ' a ' + nuevo; res.style.color = 'var(--green)'; }
  else { res.textContent = 'Salen ' + Math.abs(dif) + ' · de ' + antes + ' a ' + nuevo; res.style.color = 'var(--orange)'; }
  // Aviso si quedan unidades comprometidas por encima de lo que habrá en almacén.
  if (reservado > nuevo) {
    res.textContent += ' ⚠️ hay ' + reservado + ' reservadas';
    res.style.color = 'var(--red)';
  }
}
function guardarStockModal() {
  const id = _stockModalId;
  const p = productoOf(id); if (!p) { closeStockModal(); return; }
  const nuevo = Math.max(0, parseInt(document.getElementById('stockModalInput').value, 10) || 0);
  const antes = parseInt(p.stock || 0, 10);
  if (nuevo === antes) { closeStockModal(); showToast('Sin cambios'); return; }
  _aplicarCambioStock(id, p, antes, nuevo);
  closeStockModal();
  showToast(nuevo > antes ? ('Entraron ' + (nuevo - antes) + ' ✓') : ('Stock ajustado a ' + nuevo + ' ✓'));
}
// Guardado + avisos. Se comparte con adjustStock() para no tener la regla de
// cuándo avisar escrita dos veces: ya pasó con otras vistas y acabó divergiendo.
function _aplicarCambioStock(id, p, oldStock, newStock) {
  patchProducto(id, {stock: newStock});
  if (oldStock === 0 && newStock > 0) addNotif('restocked', p.name, id, 'stock: ' + newStock);
  else if (newStock === 0 && oldStock > 0) addNotif('out_of_stock', p.name, id, 'stock agotado');
  else if (newStock > 0 && newStock <= LOW_STOCK_THRESHOLD && oldStock > LOW_STOCK_THRESHOLD) addNotif('low_stock', p.name, id, 'quedan ' + newStock);
  maybeAutoSync();
  renderProductGrid();
  if (typeof renderStockCategorias === 'function') renderStockCategorias();
}

function adjustStock(id) {
  // v70: se mantiene como puerta de entrada alternativa (por si alguna vista la
  // llama), pero ahora abre el modal en vez del prompt() del navegador.
  openStockModal(id);
}

// Ajustar cantidad RESERVADA de un producto.
// - Si reserved >= stock → producto se considera "totalmente reservado"
//   (sale de la lista de disponibles, queda opaco en el picker).
// - Si reserved < stock  → el producto sigue disponible pero con stock
//   reducido en la cantidad reservada.
// - Si reserved = 0      → no hay reserva (estado normal).
// ── v71: reservas con ventana propia ────────────────────────────────────────
// Mismo caso que el stock: era un prompt() del navegador con cinco líneas de
// texto explicando stock físico, reservado y disponible. En el móvil ese cuadro
// se lee fatal y no deja ver los números mientras escribes.
// Reservar = comprometer unidades para un cliente sin sacarlas del almacén. Lo
// que no se puede es reservar más de lo que hay, y eso ahora se impide en vez de
// avisarlo después.
let _reservaModalId = null;
function openReservaModal(id) {
  const p = productoOf(id); if (!p) return;
  _reservaModalId = id;
  document.getElementById('reservaModalName').textContent = p.name || 'Producto';
  document.getElementById('reservaModalInput').value = parseInt(p.reserved || 0, 10);
  document.getElementById('reservaModal').classList.add('show');
  reservaModalRefresca();
}
function closeReservaModal() {
  const m = document.getElementById('reservaModal');
  if (m) m.classList.remove('show');
  _reservaModalId = null;
}
// v92: el tope de la reserva a mano ya no es el stock entero, sino lo que queda
// después de lo que ya tienen apartado los vales: esas unidades están
// comprometidas y contarlas dos veces daría una disponibilidad falsa.
function _topeReservaManual(p) {
  return Math.max(0, parseInt(p.stock || 0, 10) - _reservadasPorVales(p.id));
}
function reservaModalSuma(delta) {
  const p = productoOf(_reservaModalId); if (!p) return;
  const inp = document.getElementById('reservaModalInput'); if (!inp) return;
  inp.value = Math.min(_topeReservaManual(p), Math.max(0, (parseInt(inp.value, 10) || 0) + delta));
  reservaModalRefresca();
}
function reservaModalTodo() {
  const p = productoOf(_reservaModalId); if (!p) return;
  document.getElementById('reservaModalInput').value = _topeReservaManual(p);
  reservaModalRefresca();
}
function reservaModalLiberar() {
  document.getElementById('reservaModalInput').value = 0;
  reservaModalRefresca();
}
function reservaModalRefresca() {
  const p = productoOf(_reservaModalId); if (!p) return;
  const stock = parseInt(p.stock || 0, 10);
  const porVales = _reservadasPorVales(p.id);
  const tope = _topeReservaManual(p);
  let nuevo = Math.max(0, parseInt(document.getElementById('reservaModalInput').value, 10) || 0);
  if (nuevo > tope) { nuevo = tope; document.getElementById('reservaModalInput').value = tope; }
  document.getElementById('reservaModalFisico').textContent = stock;
  // Los tres contadores de arriba enseñan el total real, no solo lo manual.
  document.getElementById('reservaModalReservado').textContent = nuevo + porVales;
  document.getElementById('reservaModalDisponible').textContent = Math.max(0, stock - nuevo - porVales);
  _pintarReservasDeVales(p);
  const antes = parseInt(p.reserved || 0, 10);
  const res = document.getElementById('reservaModalResumen');
  if (!res) return;
  const dif = nuevo - antes;
  const quedan = Math.max(0, stock - nuevo - porVales);
  if (dif === 0) { res.textContent = 'Sin cambios (hay ' + antes + ' reservadas a mano)'; res.style.color = 'var(--text-muted)'; }
  else if (dif > 0) { res.textContent = 'Se reservan ' + dif + ' más · quedan ' + quedan + ' para vender'; res.style.color = '#b45309'; }
  else { res.textContent = 'Se liberan ' + Math.abs(dif) + ' · quedan ' + quedan + ' para vender'; res.style.color = 'var(--green)'; }
  if (quedan === 0 && stock > 0) { res.textContent += ' ⚠️ no queda nada disponible'; res.style.color = 'var(--red)'; }
}
// Enseña qué vales tienen apartado este producto. Es informativo: desde aquí no
// se sueltan, porque soltarlos a mano volvería a abrir la puerta al descuadre —
// se sueltan solos al vender, cancelar o borrar el vale.
function _pintarReservasDeVales(p) {
  const c = document.getElementById('reservaModalPorVales');
  if (!c) return;
  const e = _reservasPorProducto().get(p.id);
  if (!e || !e.unidades) { c.style.display = 'none'; c.innerHTML = ''; return; }
  c.style.display = 'block';
  c.innerHTML = `<div style="font-weight:700;color:#b45309;margin-bottom:4px;">🔐 ${e.unidades} apartada${e.unidades !== 1 ? 's' : ''} por vales</div>` +
    e.vales.map(v => `<div style="display:flex;justify-content:space-between;gap:8px;">
      <span>${v.valeNum ? 'V-' + String(v.valeNum).padStart(3, '0') + ' · ' : ''}${escapeHTML(v.cliente || 'Sin nombre')}</span>
      <span style="font-weight:700;">×${v.qty}</span>
    </div>`).join('') +
    `<div style="color:var(--gray-400);margin-top:4px;">Se liberan solas al cobrar, cancelar o borrar el vale.</div>`;
}

function guardarReservaModal() {
  const id = _reservaModalId;
  const p = productoOf(id); if (!p) { closeReservaModal(); return; }
  const nuevo = Math.min(_topeReservaManual(p), Math.max(0, parseInt(document.getElementById('reservaModalInput').value, 10) || 0));
  const antes = parseInt(p.reserved || 0, 10);
  if (nuevo === antes) { closeReservaModal(); showToast('Sin cambios'); return; }
  patchProducto(id, {reserved: nuevo});
  maybeAutoSync();
  renderProductGrid();
  if (typeof renderStockCategorias === 'function') renderStockCategorias();
  closeReservaModal();
  showToast(nuevo > antes ? ('Reservadas ' + nuevo + ' ✓') : (nuevo === 0 ? 'Reservas liberadas ✓' : ('Reservadas ' + nuevo + ' ✓')));
}

function adjustReserved(id) {
  // v71: se conserva como puerta de entrada, pero abre la ventana en vez del
  // prompt() del navegador.
  openReservaModal(id);
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
    const count = getVales().filter(v => v.gestorId === gestorId && localDay(v.ts) === ds).length;
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
  const gv = getVales().filter(v => v.gestorId === gestorId);
  if (!gv.length) return null; // never created a vale
  const last = gv.reduce((max, v) => v.ts > max ? v.ts : max, '');
  if (!last) return null;
  const days = Math.floor((Date.now() - new Date(last).getTime()) / 86400000);
  return days;
}

// Render a single expandible gestor card for the Estadísticas panel
function _renderStatsGestorCard(g, vales, from, to) {
  const gv = vales.filter(v => v.gestorId === g.id);
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

    // Commission summary.
    // v104: la comisión cuenta desde que se entrega — ver _valeGeneraComision.
    const confirmedVales = gv.filter(_valeGeneraComision);
    const pendCom = confirmedVales.filter(v => !v.commissionPaid && v.commissionStatus !== 'en_sobre' && v.commissionStatus !== 'cobrado');
    const enSobre = confirmedVales.filter(v => v.commissionStatus === 'en_sobre');
    const cobrados = confirmedVales.filter(v => v.commissionPaid || v.commissionStatus === 'cobrado');
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
  let vales = ordenarRecientesPrimero(getVales());
  const from = fromEl ? fromEl.value : '';
  const to = toEl ? toEl.value : '';
  const gFilter = gestorEl ? gestorEl.value : '';
  if (from) vales = vales.filter(v => _fechaEfectiva(v) >= from);
  if (to)   vales = vales.filter(v => _fechaEfectiva(v) <= to);
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
      sMap[v.status] || v.status || 'pending',
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

// ══════════════════════════════════════════
//  GANANCIA E INVERSIÓN  (v114)
// ══════════════════════════════════════════
// Todo lo que había en Estadísticas contaba vales y unidades. Esto cuenta
// dinero: cuánto hay metido en la mercancía, cuánto vale si se vende toda, y
// cuánto se ganó de verdad en el período (venta − costo − comisión).
//
// Precios y costos se escriben como texto ("$45 USD" / "4500 MN"), igual que en
// el resto de la app. Para poder sumarlos entre sí hay que pasarlo todo a una
// sola moneda, y se usa la tasa del día. Si no hay tasa, no se inventa un
// número: se avisa y los importes en MN se dejan aparte.

// Separa un texto de precio en las dos monedas, con el mismo criterio que ya
// usa el picker de productos: si dice MN o CUP es moneda nacional.
function _montoMonedas(txt) {
  const s = String(txt || '');
  const n = parsePrecioNum(s);
  if (!(n > 0)) return { usd: 0, mn: 0 };
  const u = s.toUpperCase();
  return (u.includes('MN') || u.includes('CUP')) ? { usd: 0, mn: n } : { usd: n, mn: 0 };
}
// Devuelve el equivalente en USD, o null si hay pesos y no hay tasa para
// convertirlos. null significa "no lo sé", no "cero": pintar 0 ahí sería mentir.
function _aUSD(m) {
  if (!m.mn) return m.usd;
  const t = tasaUSDFinal();
  if (!t || t <= 0) return null;
  return m.usd + m.mn / t;
}
const _fmtUSD = n => (n === null || n === undefined || !isFinite(n)) ? '—'
  : (n < 0 ? '−' : '') + '$' + Math.abs(n).toLocaleString('es-ES', { maximumFractionDigits: 2 });

// Las cuentas de un producto. tieneCosto=false ⇒ no se puede calcular nada de
// ganancia con él, y el panel lo dice en vez de contarlo como ganancia total.
function _gananciaProducto(p) {
  const stock  = Math.max(0, parseInt(p.stock, 10) || 0);
  const costoTxt = costoDe(p.id);          // v114: el costo vive fuera del producto
  const ventaU = _aUSD(_montoMonedas(p.precio));
  const costoU = _aUSD(_montoMonedas(costoTxt));
  const tieneCosto = parsePrecioNum(costoTxt) > 0;
  const ganU   = (tieneCosto && ventaU !== null && costoU !== null) ? ventaU - costoU : null;
  return {
    stock, ventaU, costoU, ganU, tieneCosto,
    margen  : (ganU !== null && ventaU) ? (ganU / ventaU) * 100 : null,
    inv     : costoU !== null ? costoU * stock : null,
    valor   : ventaU !== null ? ventaU * stock : null,
    ganTotal: ganU   !== null ? ganU   * stock : null,
  };
}
// Lo que se cobró de verdad por un vale. Se prefieren los campos de precio; si
// el vale es viejo y solo tiene "total", se lee de ahí.
function _ventaVale(v) {
  const a = _montoMonedas(v.precioUSD), b = _montoMonedas(v.precioMN);
  let usd = a.usd + b.usd, mn = a.mn + b.mn;
  if (!usd && !mn) { const t = _montoMonedas(v.total); usd = t.usd; mn = t.mn; }
  return { usd, mn };
}

// ── COLUMNAS CONFIGURABLES ──
// El dueño pidió poder añadir y quitar campos. La elección se guarda en el
// teléfono del admin (no se sincroniza: es una preferencia de pantalla, no un
// dato del negocio).
const GANANCIA_COLUMNAS = [
  { k:'stock',    label:'Stock',       def:true  },
  { k:'costo',    label:'Costo u.',    def:true  },
  { k:'precio',   label:'Venta u.',    def:true  },
  { k:'ganU',     label:'Gana u.',     def:true  },
  { k:'margen',   label:'Margen %',    def:true  },
  { k:'inv',      label:'Inversión',   def:false },
  { k:'valor',    label:'Valor venta', def:false },
  { k:'ganTotal', label:'Ganancia',    def:true  },
  { k:'vendidos', label:'Vendidos',    def:false },
];
const _GAN_COLS_KEY = 'axon_ganancia_cols';
function _gananciaCols() {
  let guardadas = null;
  try { guardadas = JSON.parse(localStorage.getItem(_GAN_COLS_KEY) || 'null'); } catch(e) {}
  if (!Array.isArray(guardadas)) return GANANCIA_COLUMNAS.filter(c => c.def).map(c => c.k);
  // Se filtra contra la lista real: si algún día se quita una columna del
  // código, la preferencia vieja no deja una cabecera vacía colgando.
  return guardadas.filter(k => GANANCIA_COLUMNAS.some(c => c.k === k));
}
function toggleGananciaCol(k) {
  const act = new Set(_gananciaCols());
  if (act.has(k)) act.delete(k); else act.add(k);
  // Se guarda en el orden del código, no en el que se fue tocando, para que la
  // tabla no cambie de orden de columnas cada vez que se marca una.
  const orden = GANANCIA_COLUMNAS.filter(c => act.has(c.k)).map(c => c.k);
  try { localStorage.setItem(_GAN_COLS_KEY, JSON.stringify(orden)); } catch(e) {}
  renderStats();
}
function toggleGananciaCols() {
  const c = document.getElementById('statsGananciaCols'); if (!c) return;
  c.style.display = c.style.display === 'none' ? 'block' : 'none';
}
// Escribir el costo desde la propia tabla. Con casi cien productos, abrir la
// ficha de cada uno para rellenarlos sería inviable.
function setCostoProducto(id, valor) {
  if (!productoOf(id)) return;
  if (!setCosto(id, valor)) return;        // no cambió nada
  renderStats();
  maybeAutoSync();
}

// ── v118: buscador, chips de filtro y categorías plegables ──────────────────
// Estado de pantalla (no es dato del negocio, así que no se sincroniza ni se
// guarda entre sesiones — vive solo mientras la pestaña está abierta).
let _gananciaFiltro = 'todos';        // todos | agotado | bajo | sincosto
let _gananciaBusqueda = '';
let _gananciaCatAbierta = null;       // Set<string> — se siembra la primera vez
// El último `vales` (ya filtrado por fecha) que le pasó renderStats(). Buscar
// o cambiar de chip no toca el rango de fechas, así que no hace falta rehacer
// la pestaña de Estadísticas entera para repintar solo esto — se reutiliza.
let _gananciaValesUltimos = [];
function setGananciaFiltro(f) {
  _gananciaFiltro = f;
  renderGanancia(_gananciaValesUltimos);
}
function onGananciaBuscar(v) {
  _gananciaBusqueda = String(v || '').trim().toLowerCase();
  renderGanancia(_gananciaValesUltimos);
}
function toggleGananciaCat(key) {
  if (!_gananciaCatAbierta) _gananciaCatAbierta = new Set();
  if (_gananciaCatAbierta.has(key)) _gananciaCatAbierta.delete(key); else _gananciaCatAbierta.add(key);
  renderGanancia(_gananciaValesUltimos);
}

function renderGanancia(vales) {
  const cAviso = document.getElementById('statsGananciaAviso');
  const cRow   = document.getElementById('statsGananciaRow');
  const cCols  = document.getElementById('statsGananciaCols');
  const cTabla = document.getElementById('statsGananciaTabla');
  if (!cRow || !cTabla) return;
  _gananciaValesUltimos = vales;

  const prods = getProductos();
  const cats  = getCategorias();
  const tasa  = tasaUSDFinal();

  // ── INVENTARIO: lo que hay metido y lo que vale ──
  let inversion = 0, valorVenta = 0, sinCosto = 0, conCosto = 0, hayMNSinTasa = false;
  prods.forEach(p => {
    const g = _gananciaProducto(p);
    if (!g.tieneCosto) { sinCosto++; } else { conCosto++; }
    if (g.inv   !== null) inversion  += g.inv;   else if (g.tieneCosto) hayMNSinTasa = true;
    if (g.valor !== null) valorVenta += g.valor; else hayMNSinTasa = true;
  });
  const potencial = valorVenta - inversion;

  // ── PERÍODO: lo que se ganó de verdad ──
  // Solo los vales confirmados. Un vale pendiente todavía se puede caer.
  const vendidos = {};   // id producto → unidades vendidas en el período
  let ingreso = 0, costoVendido = 0, comisiones = 0;
  let valesSinCosto = 0, valesSinProductos = 0, valesConfirmados = 0, congelados = 0;
  vales.filter(v => v.status === 'confirmed').forEach(v => {
    valesConfirmados++;
    const ing = _aUSD(_ventaVale(v));
    if (ing !== null) ingreso += ing; else hayMNSinTasa = true;
    const items = v.valeProductos || [];
    if (!items.length) { valesSinProductos++; }
    items.forEach(({ id, qty }) => { vendidos[id] = (vendidos[id] || 0) + qty; });
    // v114: si el costo se congeló al confirmar la venta, manda ese. Es lo que
    // costó de verdad ese día; el de hoy puede ser otro.
    const fijado = costoFijadoDe(v.id);
    if (fijado !== null) { costoVendido += fijado; congelados++; }
    else {
      let faltaCosto = false;
      items.forEach(({ id, qty }) => {
        const p = productoOf(id);
        const g = p ? _gananciaProducto(p) : null;
        if (!g || !g.tieneCosto || g.costoU === null) { faltaCosto = true; return; }
        costoVendido += g.costoU * qty;
      });
      if (faltaCosto) valesSinCosto++;
    }
    try {
      const r = getValeCommissionParts(v);
      const c = _aUSD({ usd: r.totalUSD || 0, mn: r.totalMN || 0 });
      if (c !== null) comisiones += c; else hayMNSinTasa = true;
    } catch(e) {}
  });
  const ganRealizada = ingreso - costoVendido - comisiones;

  // ── CHIPS DE FILTRO: contadores del catálogo entero y estado activo ──
  // Solo se tocan las clases/textos de los chips que ya están en el DOM —
  // nunca su innerHTML— para no borrarle el foco al buscador, que es su
  // hermano en el mismo contenedor.
  let cAgotado = 0, cBajo = 0, cSinCosto = 0;
  prods.forEach(p => {
    const st = parseInt(p.stock, 10) || 0;
    if (st === 0) cAgotado++;
    else if (st <= LOW_STOCK_THRESHOLD) cBajo++;
    if (!_gananciaProducto(p).tieneCosto) cSinCosto++;
  });
  const conteos = { todos: prods.length, agotado: cAgotado, bajo: cBajo, sincosto: cSinCosto };
  document.querySelectorAll('#gananciaChips .ax2-chip').forEach(chip => {
    const f = chip.dataset.f;
    chip.classList.toggle('active', f === _gananciaFiltro);
    const nEl = chip.querySelector('.n'); if (nEl) nEl.textContent = conteos[f] != null ? conteos[f] : 0;
  });

  // ── AVISOS ──
  // Sin costos el panel no puede decir nada, así que lo dice claro en vez de
  // enseñar ceros que parecen un negocio en ruina.
  const avisos = [];
  if (sinCosto) avisos.push(`${sinCosto} de ${prods.length} productos no tienen costo puesto — escríbelo en la columna <b>Costo u.</b> de la tabla de abajo, o filtra por "Sin costo" arriba.`);
  if (hayMNSinTasa && !tasa) avisos.push('Hay precios o costos en MN y no hay tasa del día guardada, así que no se pueden sumar con los de USD. Pon la tasa en ⚙️ Config.');
  if (valesSinProductos) avisos.push(`${valesSinProductos} venta(s) confirmada(s) del período no tienen productos del catálogo enlazados, así que su costo no se puede saber.`);
  else if (valesSinCosto) avisos.push(`${valesSinCosto} venta(s) confirmada(s) llevan productos sin costo — la ganancia del período sale más alta de lo real.`);
  cAviso.innerHTML = avisos.length ? `<div class="ax2-aviso">${avisos.map(a => `<div>⚠️ ${a}</div>`).join('')}</div>` : '';

  // ── TARJETAS ──
  const margenGlobal = valorVenta > 0 ? (potencial / valorVenta) * 100 : null;
  cRow.innerHTML = [
    { label:'Inversión en stock',  val:_fmtUSD(inversion),   cls:'ember', sub:`${conCosto} producto(s) con costo` },
    { label:'Valor de venta',      val:_fmtUSD(valorVenta),  cls:'',      sub:'si se vende todo el stock' },
    { label:'Ganancia potencial',  val:_fmtUSD(potencial),   cls:'good',  sub:margenGlobal!==null?`margen ${margenGlobal.toFixed(0)}%`:'' },
    { label:'Ganancia del período',val:_fmtUSD(ganRealizada),cls:ganRealizada>=0?'good':'danger', sub:`${valesConfirmados} venta(s) confirmada(s)` },
  ].map(({label,val,cls,sub}) => `<div class="ax2-card ax2-kpi">
      <div class="ax2-kpi-label">${label}</div>
      <div class="ax2-kpi-value ${cls}">${val}</div>
      ${sub?`<div class="ax2-kpi-sub">${sub}</div>`:''}
    </div>`).join('') +
    `<div class="ax2-card ax2-kpi wide">
      <div class="ax2-kpi-label">Del período</div>
      <div class="ax2-flow">
        <span>${_fmtUSD(ingreso)}</span><span class="arrow">−</span>
        <span class="neg">${_fmtUSD(costoVendido)}${congelados?` <span title="a estas ventas se les guardó el costo del día en que se confirmaron, así que ya no cambia">🔒</span>`:''}</span>
        <span class="arrow">−</span><span class="neg">${_fmtUSD(comisiones)}</span>
        <span class="arrow">=</span><span class="pos">${_fmtUSD(ganRealizada)}</span>
      </div>
      ${tasa?`<div class="ax2-kpi-sub">Los importes en MN se convirtieron a USD a ${tasa} CUP/USD.</div>`:''}
    </div>`;

  // ── SELECTOR DE COLUMNAS ──
  const activas = _gananciaCols();
  cCols.innerHTML = `<div class="ax2-card" style="padding:10px 12px;">
    <div style="font-size:10px;font-weight:700;color:var(--ax2-text-low);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">Columnas de la tabla</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;">
      ${GANANCIA_COLUMNAS.map(c => { const on = activas.includes(c.k);
        return `<button class="ax2-btn${on?' primary':''}" onclick="toggleGananciaCol('${c.k}')">${on?'✓':'+'} ${c.label}</button>`;
      }).join('')}
    </div>
  </div>`;

  // ── TABLA POR CATEGORÍA, con buscador + chips + plegado ──
  if (!prods.length) { cTabla.innerHTML = '<div class="ax2-empty">Sin productos en el catálogo</div>'; return; }
  const pasaFiltro = p => {
    const st = parseInt(p.stock, 10) || 0;
    if (_gananciaFiltro === 'agotado')  return st === 0;
    if (_gananciaFiltro === 'bajo')     return st > 0 && st <= LOW_STOCK_THRESHOLD;
    if (_gananciaFiltro === 'sincosto') return !_gananciaProducto(p).tieneCosto;
    return true;
  };
  const pasaBusqueda = p => !_gananciaBusqueda || String(p.name || p.nombre || '').toLowerCase().includes(_gananciaBusqueda);
  const filtrando = _gananciaFiltro !== 'todos' || !!_gananciaBusqueda;

  // Primera vez que se pinta esta pestaña: se abre sola la primera categoría
  // que tenga productos, para no soltar el catálogo entero plegado y vacío.
  if (!_gananciaCatAbierta) {
    _gananciaCatAbierta = new Set();
    const primeraConCat = cats.find(c => prods.some(p => p.catId === c.id));
    if (primeraConCat) _gananciaCatAbierta.add(String(primeraConCat.id));
    else if (prods.some(p => !p.catId || !cats.some(c => c.id === p.catId))) _gananciaCatAbierta.add('__sin_cat__');
  }

  const num = (v, suf) => v === null ? '<span style="color:var(--ax2-text-low);">—</span>' : (suf === '%' ? v.toFixed(0) + '%' : _fmtUSD(v));
  const celda = (k, p, g) => {
    switch (k) {
      case 'stock': {
        const cls = g.stock === 0 ? 'zero' : g.stock <= LOW_STOCK_THRESHOLD ? 'low' : 'ok';
        return `<span class="ax2-badge ${cls}">${g.stock}</span>`;
      }
      case 'costo': return `<input class="ax2-cost-input" value="${escapeHTML(costoDe(p.id))}" placeholder="—" onchange="setCostoProducto(${p.id},this.value)">`;
      case 'precio':   return num(g.ventaU);
      case 'ganU':     return `<span class="ax2-gain${g.ganU!==null?' set':''}">${num(g.ganU)}</span>`;
      case 'margen':   return num(g.margen, '%');
      case 'inv':      return num(g.inv);
      case 'valor':    return num(g.valor);
      case 'ganTotal': return `<span class="ax2-gain${g.ganTotal!==null?' set':''}">${num(g.ganTotal)}</span>`;
      case 'vendidos': return String(vendidos[p.id] || 0);
    }
    return '';
  };
  const colsAct = GANANCIA_COLUMNAS.filter(c => activas.includes(c.k));
  const seccion = (key, titulo, lista) => {
    if (!lista.length) return '';
    const mostrar = filtrando ? lista.filter(p => pasaFiltro(p) && pasaBusqueda(p)) : lista;
    if (filtrando && !mostrar.length) return '';   // categoría entera sin coincidencias: no ocupa sitio
    const abierta = filtrando || _gananciaCatAbierta.has(key);
    // Los totales de la cabecera son SIEMPRE de la categoría completa, aunque
    // el buscador esté escondiendo filas — filtrar no cambia lo que hay.
    let sInv = 0, sGan = 0;
    lista.forEach(p => { const g = _gananciaProducto(p); if (g.inv !== null) sInv += g.inv; if (g.ganTotal !== null) sGan += g.ganTotal; });
    return `<div class="ax2-card ax2-cat-card${abierta?' open':''}">
      <div class="ax2-cat-head" onclick="toggleGananciaCat('${key}')">
        <div class="ax2-cat-head-left">
          <span class="ax2-cat-chevron">›</span>
          <span class="ax2-cat-title">${escapeHTML(titulo)}</span>
          <span class="ax2-cat-count">${mostrar.length}${filtrando && mostrar.length!==lista.length?` de ${lista.length}`:''}</span>
        </div>
        <div class="ax2-cat-stats">invertido ${_fmtUSD(sInv)} · <b>gana ${_fmtUSD(sGan)}</b></div>
      </div>
      <div class="ax2-cat-body">
        <div style="overflow-x:auto;">
          <table class="ax2-table" style="min-width:${140+colsAct.length*84}px;">
            <thead><tr>
              <th style="text-align:left;">Producto</th>
              ${colsAct.map(c=>`<th>${c.label}</th>`).join('')}
            </tr></thead>
            <tbody>${mostrar.map(p => { const g = _gananciaProducto(p);
              return `<tr${g.tieneCosto?'':' class="sin-costo"'}>
                <td>${escapeHTML(p.name||p.nombre||'—')}</td>
                ${colsAct.map(c=>`<td>${celda(c.k,p,g)}</td>`).join('')}
              </tr>`;
            }).join('')}</tbody>
          </table>
        </div>
      </div>
    </div>`;
  };
  let tabla = '';
  cats.forEach(cat => { tabla += seccion(String(cat.id), cat.name || 'Categoría', prods.filter(p => p.catId === cat.id)); });
  tabla += seccion('__sin_cat__', 'Sin categoría', prods.filter(p => !p.catId || !cats.some(c => c.id === p.catId)));
  cTabla.innerHTML = tabla || '<div class="ax2-empty">Ningún producto coincide con la búsqueda</div>';
}

// ══════════════════════════════════════════
//  CORTE POR DUEÑO  (v117)
// ══════════════════════════════════════════
// Qué se vendió de cada dueño y qué comisión le toca pagar a cada gestor.
//
// ⚠️ POR QUÉ ESTO SE CALCULA LÍNEA A LÍNEA Y NO DEL TOTAL DEL VALE
// Un vale puede llevar productos de DOS dueños distintos, y guarda un solo
// importe total (y una sola comisión congelada). De ese total no se puede
// deducir cuánto era de cada uno. Así que cada línea se valora con el precio
// del producto en el catálogo por su cantidad, que es lo que el dueño sabe que
// vale su mercancía.
//
// Eso trae dos avisos que el panel enseña cuando tocan, en vez de callárselos:
//   · Si el vale llevaba una rebaja, se cobró menos de lo que suman las líneas.
//   · Si la comisión del catálogo cambió después de la venta, la suma por
//     líneas no coincide con la que se le congeló al vale.
function _lineasPorDueno(vales) {
  const porDueno = new Map();       // clave → {nombre, propia, lineas[]}
  let conRebaja = 0, sinPrecio = 0;
  // v119: ventas del período que no llevan NI UN producto del catálogo. Sin
  // productos no hay a quién atribuirlas, así que el panel no puede repartir
  // nada y sale todo en cero — pero callándose, que es lo peor: parece que no
  // se vendió nada cuando lo que pasa es que no se puede saber de quién era.
  let sinProductos = 0;
  vales.forEach(v => {
    const esTienda = esValeDeLaTienda(v) || v.gestorId === 'admin';
    const g = gestorOf(v.gestorId);
    const tieneRebaja = !!(typeof _rebajaVale === 'function' && _rebajaVale(v));
    if (tieneRebaja) conRebaja++;
    // Estado del pago de la comisión de este vale: se necesita para poder tachar
    // en "Debe pagar a" lo que el admin ya marcó como en sobre o cobrado en el
    // panel de Gestores, en vez de seguir pidiéndolo por siempre.
    const comEstado = (v.commissionPaid || v.commissionStatus === 'cobrado') ? 'cobrado'
                     : v.commissionStatus === 'en_sobre' ? 'en_sobre' : 'pendiente';
    if (!(v.valeProductos || []).length) sinProductos++;
    (v.valeProductos || []).forEach(({ id, qty }) => {
      const p = productoOf(id);
      const dueno = duenoPorId(duenoIdDe(id));
      const clave = dueno ? String(dueno.id) : _SIN_DUENO;
      const unidades = parseInt(qty, 10) || 0;
      // v117: cada moneda por su lado. Antes se pasaba todo a USD con la tasa
      // del día, y al dueño hay que pagarle en lo que se cobró, no en un
      // equivalente que cambia cada mañana.
      const pv = _montoMonedas(p ? p.precio : '');
      const ventaUSD = pv.usd * unidades, ventaMN = pv.mn * unidades;
      if (!pv.usd && !pv.mn) sinPrecio++;
      // La comisión del gestor. Una venta hecha desde el admin no genera
      // comisión: no hay a quién pagársela.
      let comUSD = 0, comMN = 0;
      if (!esTienda && p) {
        try {
          const r = getValeCommissionParts({ valeProductos: [{ id, qty: unidades }] });
          comUSD = r.totalUSD || 0; comMN = r.totalMN || 0;
        } catch(e) {}
      }
      if (!porDueno.has(clave)) porDueno.set(clave, {
        id: dueno ? dueno.id : null,
        nombre: dueno ? dueno.nombre : 'Mercancía de la tienda',
        propia: !dueno, lineas: [],
      });
      porDueno.get(clave).lineas.push({
        ts: v.ts, valeId: v.id, valeNum: (typeof valeNumStr === 'function' ? valeNumStr(v) : ''),
        cliente: v.cliente || '',
        gestor: esTienda ? 'Tienda (admin)' : (g ? g.name : '—'), esTienda,
        gestorId: esTienda ? null : v.gestorId, comEstado,
        producto: p ? (p.name || p.nombre || ('#' + id)) : ('Producto #' + id + ' (borrado)'),
        qty: unidades, ventaUSD, ventaMN, comUSD, comMN,
        sinPrecio: !pv.usd && !pv.mn, tieneRebaja,
      });
    });
  });
  // Los totales de cada grupo, en las dos monedas.
  porDueno.forEach(gr => {
    gr.ventaUSD = gr.lineas.reduce((s, l) => s + l.ventaUSD, 0);
    gr.ventaMN  = gr.lineas.reduce((s, l) => s + l.ventaMN,  0);
    gr.comUSD   = gr.lineas.reduce((s, l) => s + l.comUSD,   0);
    gr.comMN    = gr.lineas.reduce((s, l) => s + l.comMN,    0);
  });
  return { porDueno, conRebaja, sinPrecio, sinProductos };
}

// Un importe en las dos monedas, tal cual, sin convertir. "—" si no hay nada.
function _fmtDosMonedas(usd, mn) {
  const p = [];
  // Cada parte lleva su propio signo (−) en vez de dejar que toLocaleString lo
  // pegue después del "+" del separador: "USD + -7.500 MN" se lee como un error
  // de tipeo. Si la segunda parte es negativa, se une con un espacio — el propio
  // signo ya dice "y además esto", no hace falta el "+".
  if (usd) p.push((usd < 0 ? '−' : '') + '$' + (Math.round(Math.abs(usd) * 100) / 100).toLocaleString('es-ES', { maximumFractionDigits: 2 }) + ' USD');
  if (mn)  p.push((mn < 0 ? '−' : '') + Math.round(Math.abs(mn)).toLocaleString('es-ES') + ' MN');
  if (!p.length) return '—';
  if (p.length === 1) return p[0];
  return p[0] + (mn < 0 ? ' ' : ' + ') + p[1];
}

// El importe de "debe pagar" a un gestor: lo pendiente en grande, y si además
// hay algo que el admin ya marcó en sobre o cobrado en 📋 Gestores para ese
// mismo gestor, se tacha aparte — así queda claro qué falta todavía y qué ya
// se resolvió, en vez de seguir pidiendo dinero que ya se pagó.
function _montoDebePagarHTML(a) {
  const hayPend = a.usdPend || a.mnPend;
  const hayListo = a.usdListo || a.mnListo;
  if (!hayPend && hayListo) {
    return `<s style="opacity:.5;">${_fmtDosMonedas(a.usd, a.mn)}</s> <span style="font-size:9px;font-weight:700;color:var(--ax2-good);white-space:nowrap;">✓ pagado</span>`;
  }
  const pend = _fmtDosMonedas(a.usdPend, a.mnPend);
  if (!hayListo) return pend;
  return pend + `<div style="font-size:9.5px;font-weight:500;opacity:.55;text-decoration:line-through;margin-top:1px;">${_fmtDosMonedas(a.usdListo, a.mnListo)}</div>`;
}
// Atributos para saltar directo a la ficha de comisiones de ese gestor en
// 📋 Gestores al tocar su fila en "Debe pagar a" — ver irAComisionesDeGestor().
function _filaPagarAttrs(gestorId) {
  return gestorId == null ? '' : ` onclick="irAComisionesDeGestor(${gestorId},event)" style="cursor:pointer;" title="Abrir sus comisiones en 📋 Gestores"`;
}

function setDuenosRango(cual) {
  const f = document.getElementById('duenosDateFrom');
  const t = document.getElementById('duenosDateTo');
  if (!f || !t) return;
  const hoy = new Date();
  const dia = d => localDay(d.toISOString());
  if (cual === 'hoy')  { f.value = dia(hoy); t.value = dia(hoy); }
  else if (cual === 'ayer') { const a = new Date(hoy.getTime() - 86400000); f.value = dia(a); t.value = dia(a); }
  else if (cual === 'mes')  { f.value = dia(new Date(hoy.getFullYear(), hoy.getMonth(), 1)); t.value = dia(hoy); }
  renderDuenos();
}

function addDuenoDesdeUI() {
  const el = document.getElementById('newDuenoInput');
  if (!el) return;
  const nombre = el.value.trim();
  if (!nombre) { showToast('Escribe el nombre del dueño'); return; }
  const ya = listaDuenos().some(d => _claveDueno(d.nombre) === _claveDueno(nombre));
  addDueno(nombre);
  el.value = '';
  showToast(ya ? `"${nombre}" ya estaba en la lista` : `Dueño "${nombre}" agregado ✓`);
  renderDuenos(); maybeAutoSync();
}
function renameDuenoDesdeUI(id, e) {
  if (e) e.stopPropagation();
  const d = duenoPorId(id); if (!d) return;
  const n = prompt('Nombre del dueño:', d.nombre);
  if (n === null) return;
  if (!String(n).trim()) { showToast('El nombre no puede quedar vacío'); return; }
  renameDueno(id, n);
  renderDuenos(); renderDuenoModal(); maybeAutoSync();
  showToast('Nombre cambiado ✓');
}
function removeDuenoDesdeUI(id, e) {
  if (e) e.stopPropagation();
  const d = duenoPorId(id); if (!d) return;
  const n = productosDeDueno(id).length;
  showConfirmAction('¿Eliminar este dueño?',
    `${escapeHTML(d.nombre)}${n ? ` · sus <b>${n}</b> producto(s) quedarían como mercancía de la tienda` : ''}. No se borra ningún producto.`,
    'Eliminar', 'btn-red', () => {
      removeDueno(id);
      closeDuenoModal();
      renderDuenos(); maybeAutoSync();
      showToast('Dueño eliminado');
    });
}

// Desde "Debe pagar a" se salta directo a la ficha de comisiones de ese
// gestor en 📋 Gestores, para marcarla en sobre o cobrada sin tener que ir a
// buscarlo a mano. gestoresTabDirty=true fuerza a adminTab() a repintar la
// pestaña aunque ya estuviera pintada de antes (si no, el cambio de tab no
// hace nada y el modal se abriría sobre una lista vieja).
function irAComisionesDeGestor(id, e) {
  if (e) e.stopPropagation();
  if (id == null) return;
  closeDuenoModal();
  gestoresTabDirty = true;
  adminTab('gestores');
  setTimeout(() => { if (typeof toggleComisionGestor === 'function') toggleComisionGestor(id); }, 50);
}

// ── EL MODAL DE UN DUEÑO ───────────────────────────────────────────────────
let _duenoModalId = null;
function openDuenoModal(clave) {
  const modal = document.getElementById('duenoModal');
  if (!modal) return;
  _duenoModalId = clave;
  modal.classList.add('show');      // antes de pintar: renderDuenoModal se niega si está cerrado
  renderDuenoModal();
}
function closeDuenoModal() {
  const modal = document.getElementById('duenoModal');
  if (modal) modal.classList.remove('show');
  _duenoModalId = null;
}
function renderDuenoModal() {
  const modal = document.getElementById('duenoModal');
  if (!modal || !modal.classList.contains('show') || _duenoModalId == null) return false;
  const cuerpo = document.getElementById('duenoModalBody');
  const titulo = document.getElementById('duenoModalTitle');
  const sub    = document.getElementById('duenoModalSub');
  if (!cuerpo) return true;
  const { porDueno } = _lineasPorDueno(_valesDelCorte());
  const gr = porDueno.get(String(_duenoModalId));
  if (!gr) {
    cuerpo.innerHTML = '<div class="ax2-panel"><div class="ax2-empty">Sin ventas de este dueño en estas fechas</div></div>';
    if (titulo) { const d = duenoPorId(_duenoModalId); titulo.textContent = '🧑‍💼 ' + (d ? d.nombre : 'Dueño'); }
    if (sub) sub.textContent = '';
    return true;
  }
  if (titulo) titulo.textContent = (gr.propia ? '🏪 ' : '🧑‍💼 ') + gr.nombre;
  if (sub) sub.textContent = `Vendido ${_fmtDosMonedas(gr.ventaUSD, gr.ventaMN)} · comisiones ${_fmtDosMonedas(gr.comUSD, gr.comMN)}`;

  // Lo que le toca a cada gestor, que es lo que se lleva apuntado en la mano.
  const porGestor = new Map();
  gr.lineas.forEach(l => {
    if (!l.comUSD && !l.comMN) return;
    const clave = l.gestorId != null ? String(l.gestorId) : l.gestor;
    const a = porGestor.get(clave) || { nombre: l.gestor, gestorId: l.gestorId, usd: 0, mn: 0, usdPend: 0, mnPend: 0, usdListo: 0, mnListo: 0 };
    a.usd += l.comUSD; a.mn += l.comMN;
    if (l.comEstado === 'pendiente') { a.usdPend += l.comUSD; a.mnPend += l.comMN; }
    else { a.usdListo += l.comUSD; a.mnListo += l.comMN; }
    porGestor.set(clave, a);
  });
  // v118: NO se ordena sumando usd+mn — eso trata un peso cubano como si
  // valiera lo mismo que un dólar, y ordenaría a quien le deben 400 MN por
  // delante de a quien le deben $10 USD. Se ordena por lo que representa DE
  // SU PROPIA moneda: quien se lleva la mayor tajada del USD que se debe, o de
  // el MN que se debe, el que sea más grande, va primero.
  let _mUSD = 0, _mMN = 0;
  porGestor.forEach(a => { _mUSD = Math.max(_mUSD, a.usd); _mMN = Math.max(_mMN, a.mn); });
  const _pctDe = a => Math.max(_mUSD ? a.usd / _mUSD : 0, _mMN ? a.mn / _mMN : 0);
  const filasGestor = [...porGestor.entries()].sort((a, b) => _pctDe(b[1]) - _pctDe(a[1]));

  // Las ventas, agrupadas por vale: es como se mira un vale de verdad.
  const porVale = new Map();
  gr.lineas.forEach(l => {
    if (!porVale.has(l.valeId)) porVale.set(l.valeId, { ...l, lineas: [] });
    porVale.get(l.valeId).lineas.push(l);
  });
  const vales = [...porVale.values()].sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));

  cuerpo.innerHTML = `<div class="ax2-panel">
    ${filasGestor.length ? `<div class="ax2-card" style="padding:10px 12px;margin-bottom:12px;">
      <div style="font-size:10px;font-weight:700;color:var(--ax2-text-low);text-transform:uppercase;letter-spacing:.5px;margin-bottom:7px;">Comisiones que debe pagar</div>
      ${filasGestor.map(([, a]) => `<div class="ax2-owe-row"${_filaPagarAttrs(a.gestorId)}>
        <div class="ax2-owe-name">${escapeHTML(a.nombre)}${a.gestorId != null ? ' ›' : ''}</div>
        <div class="ax2-owe-amt">${_montoDebePagarHTML(a)}</div>
      </div>`).join('')}
    </div>` : '<div style="font-size:11px;color:var(--ax2-text-low);margin-bottom:12px;">Sin comisiones que pagar en estas fechas.</div>'}

    <div style="font-size:10px;font-weight:700;color:var(--ax2-text-low);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">Vales (${vales.length})</div>
    ${vales.map(v => {
      const vu = v.lineas.reduce((s, l) => s + l.ventaUSD, 0), vm = v.lineas.reduce((s, l) => s + l.ventaMN, 0);
      const cu = v.lineas.reduce((s, l) => s + l.comUSD, 0),  cm = v.lineas.reduce((s, l) => s + l.comMN, 0);
      return `<div class="ax2-card" style="padding:9px 11px;margin-bottom:7px;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
          <span style="font-size:12px;font-weight:700;color:var(--ax2-text-hi);">
            ${v.valeNum ? `<span style="color:var(--ax2-signal);">${escapeHTML(v.valeNum)}</span> ` : ''}${escapeHTML(v.cliente || '—')}
            ${v.tieneRebaja ? '<span title="este vale llevaba rebaja: se cobró menos" style="color:var(--ax2-ember-soft);">🏷️</span>' : ''}
          </span>
          <span style="font-size:10px;color:var(--ax2-text-low);white-space:nowrap;">${new Date(v.ts).toLocaleDateString('es-ES',{day:'2-digit',month:'short'})} · ${escapeHTML(v.gestor)}${v.esTienda ? ' (sin comisión)' : ''}</span>
        </div>
        ${v.lineas.map(l => `<div style="font-size:11px;color:var(--ax2-text-mid);margin-top:3px;">
          ${escapeHTML(l.producto)}${l.qty > 1 ? ` <b>×${l.qty}</b>` : ''} — ${l.sinPrecio ? '<span style="color:var(--ax2-text-low);">sin precio</span>' : `<span class="ax2-mono">${_fmtDosMonedas(l.ventaUSD, l.ventaMN)}</span>`}
        </div>`).join('')}
        <div style="display:flex;justify-content:space-between;gap:8px;margin-top:5px;padding-top:5px;border-top:1px solid var(--ax2-line);font-size:11px;">
          <span>Vendido <b class="ax2-mono" style="color:var(--ax2-signal);">${_fmtDosMonedas(vu, vm)}</b></span>
          <span>Comisión <b class="ax2-mono" style="color:${cu || cm ? 'var(--ax2-ember-soft)' : 'var(--ax2-text-low)'};">${_fmtDosMonedas(cu, cm)}</b></span>
        </div>
      </div>`;
    }).join('')}

    ${gr.propia ? '' : `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0 4px;">
      <button class="ax2-btn" onclick="renameDuenoDesdeUI(${gr.id},event)">✏️ Cambiar nombre</button>
      <button class="ax2-btn danger" onclick="removeDuenoDesdeUI(${gr.id},event)">Eliminar dueño</button>
    </div>`}
  </div>`;
  return true;
}

// Los vales que entran en el corte: solo ventas cerradas, dentro de las fechas.
// Un vale pendiente todavía se puede caer, y no se le pide dinero a nadie por
// algo que aún no se ha cobrado.
function _valesDelCorte() {
  const elF = document.getElementById('duenosDateFrom');
  const elT = document.getElementById('duenosDateTo');
  const from = elF ? elF.value : '', to = elT ? elT.value : '';
  // v119 FIX: esto pedía status==='confirmed' a secas, y dejaba fuera los
  // 'pending_payment' —entregados, con el cobro pendiente—. En el resto de la
  // app esos SÍ cuentan: _valeGeneraComision los da por buenos desde v104
  // ("la comisión cuenta desde que se entrega"), así que el panel de Gestores
  // ya le debe ese dinero al gestor mientras Dueños decía que no se había
  // vendido nada. Dos cifras distintas para la misma deuda, y en una tienda
  // donde casi todo se entrega antes de cobrar, el corte salía en blanco.
  // Se usa la MISMA función que el resto para que no puedan discrepar otra vez.
  let vales = getVales().filter(v => _valeGeneraComision(v));
  if (from) vales = vales.filter(v => _fechaEfectiva(v) >= from);
  if (to)   vales = vales.filter(v => _fechaEfectiva(v) <= to);
  return vales;
}

function renderDuenos() {
  const cAviso = document.getElementById('duenosAviso');
  const cRes   = document.getElementById('duenosResumen');
  const cPagarCard  = document.getElementById('duenosPagarCard');
  const cPagarCount = document.getElementById('duenosPagarCount');
  const cListCount  = document.getElementById('duenosListaCount');
  const cList  = document.getElementById('duenosLista');
  if (!cList) return;
  const elF = document.getElementById('duenosDateFrom');
  const elT = document.getElementById('duenosDateTo');
  // Por defecto, el corte del día: es para lo que se abre esta pantalla.
  if (elF && !elF.value && elT && !elT.value) {
    const hoy = localDay(new Date().toISOString());
    elF.value = hoy; elT.value = hoy;
  }

  // ── CHIP DE RANGO ACTIVO ──
  // Se recalcula cada vez comparando las fechas actuales contra lo que daría
  // cada preset, así que da igual si llegaron ahí por un chip o escribiendo a
  // mano: el chip que coincide se enciende solo.
  if (elF && elT) {
    const hoy = new Date(), dia = d => localDay(d.toISOString());
    const rangos = {
      hoy: [dia(hoy), dia(hoy)],
      ayer: [dia(new Date(hoy.getTime() - 86400000)), dia(new Date(hoy.getTime() - 86400000))],
      mes: [dia(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), dia(hoy)],
    };
    document.querySelectorAll('#duenosRangoChips .ax2-chip').forEach(chip => {
      const r = rangos[chip.dataset.rango];
      chip.classList.toggle('active', !!r && r[0] === elF.value && r[1] === elT.value);
    });
  }

  const { porDueno, conRebaja, sinPrecio, sinProductos } = _lineasPorDueno(_valesDelCorte());
  const registrados = listaDuenos();

  // ── AVISOS ──
  const avisos = [];
  if (!registrados.length) avisos.push('Todavía no hay dueños dados de alta. Agrégalos aquí arriba y después elígelos en la ficha de cada producto (📦 Stock → tocar un producto → <b>Dueño de la mercancía</b>).');
  else if (!Object.keys(getDuenosDoc().asig).length) avisos.push('Hay dueños dados de alta pero ningún producto asignado todavía. Se elige en la ficha del producto (📦 Stock).');
  // Esto va ANTES que los demás avisos: si es lo que está pasando, explica el
  // panel entero, y sin él lo único que se ve son ceros sin motivo.
  if (sinProductos) {
    const _totalCorte = _valesDelCorte().length;
    avisos.push(sinProductos === _totalCorte
      ? `Las ${sinProductos} venta(s) del período no llevan productos del catálogo enlazados, así que <b>no se puede saber de qué dueño era la mercancía</b> y el corte sale en cero. Se enlazan al hacer el vale, eligiendo los productos del catálogo en vez de escribirlos a mano.`
      : `${sinProductos} venta(s) del período no llevan productos del catálogo enlazados y no entran en este reparto.`);
  }
  if (sinPrecio) avisos.push(`${sinPrecio} línea(s) de venta son de productos sin precio en el catálogo (o borrados), así que no suman importe.`);
  if (conRebaja) avisos.push(`${conRebaja} vale(s) del período llevaban rebaja: se cobró menos de lo que suman sus líneas, que van al precio de catálogo.`);
  cAviso.innerHTML = avisos.length ? `<div class="ax2-aviso">${avisos.map(a => `<div>⚠️ ${a}</div>`).join('')}</div>` : '';

  // ── RESUMEN, cada moneda por su lado ──
  let tvU = 0, tvM = 0, tcU = 0, tcM = 0;
  porDueno.forEach(gr => { tvU += gr.ventaUSD; tvM += gr.ventaMN; tcU += gr.comUSD; tcM += gr.comMN; });
  // Si en alguna de las dos monedas se debe más comisión de lo que se vendió
  // en esa misma moneda (p. ej. comisiones fijadas en MN sobre ventas en USD),
  // "lo que queda" da negativo: se marca en rojo en vez de seguir en verde
  // como si sobrara dinero.
  const _quedaNeg = (tvU - tcU) < 0 || (tvM - tcM) < 0;
  cRes.innerHTML = `
    <div class="ax2-card ax2-kpi">
      <div class="ax2-kpi-label">Vendido en el período</div>
      <div class="ax2-kpi-value">${_fmtDosMonedas(tvU, tvM)}</div>
    </div>
    <div class="ax2-card ax2-kpi">
      <div class="ax2-kpi-label">Comisiones a pagar</div>
      <div class="ax2-kpi-value ember">${_fmtDosMonedas(tcU, tcM)}</div>
    </div>
    <div class="ax2-card ax2-kpi wide">
      <div class="ax2-kpi-label">Queda después de pagar</div>
      <div class="ax2-kpi-value ${_quedaNeg ? 'danger' : 'good'}">${_fmtDosMonedas(tvU - tcU, tvM - tcM)}</div>
      <div class="ax2-flow">
        <span>${_fmtDosMonedas(tvU, tvM)}</span><span class="arrow">−</span>
        <span class="neg">${_fmtDosMonedas(tcU, tcM)}</span><span class="arrow">=</span>
        <span class="${_quedaNeg ? 'neg' : 'pos'}">${_fmtDosMonedas(tvU - tcU, tvM - tcM)}</span>
      </div>
    </div>`;

  // ── "DEBE PAGAR A" — agregado por gestor, cruzando TODOS los dueños ──
  // Aquí sí importa quién cobra, no de quién era la mercancía: es la lista que
  // se usa para pagarle a cada gestor de una vez, sin ir dueño por dueño.
  const porGestorGlobal = new Map();
  porDueno.forEach(gr => gr.lineas.forEach(l => {
    if (!l.comUSD && !l.comMN) return;
    const clave = l.gestorId != null ? String(l.gestorId) : l.gestor;
    const a = porGestorGlobal.get(clave) || { nombre: l.gestor, gestorId: l.gestorId, usd: 0, mn: 0, usdPend: 0, mnPend: 0, usdListo: 0, mnListo: 0 };
    a.usd += l.comUSD; a.mn += l.comMN;
    if (l.comEstado === 'pendiente') { a.usdPend += l.comUSD; a.mnPend += l.comMN; }
    else { a.usdListo += l.comUSD; a.mnListo += l.comMN; }
    porGestorGlobal.set(clave, a);
  }));
  // El ancho de la barra (y el orden de la lista) es un adelanto visual, no un
  // importe: compara cada fila con el máximo DE SU MISMA MONEDA y se queda con
  // la mayor de las dos. Sumar USD y MN en un solo número —como se hacía antes
  // de esta pasada— pondría a quien le deben 400 MN por delante de a quien le
  // deben $10 USD, tratando un peso como si valiera lo mismo que un dólar.
  let maxUSD = 0, maxMN = 0;
  porGestorGlobal.forEach(a => { maxUSD = Math.max(maxUSD, a.usd); maxMN = Math.max(maxMN, a.mn); });
  const pctDe = a => Math.max(maxUSD ? a.usd / maxUSD : 0, maxMN ? a.mn / maxMN : 0);
  const filasPagar = [...porGestorGlobal.entries()].sort((a, b) => pctDe(b[1]) - pctDe(a[1]));
  if (cPagarCount) cPagarCount.textContent = filasPagar.length ? `${filasPagar.length} persona${filasPagar.length!==1?'s':''}` : '';
  if (!filasPagar.length) {
    cPagarCard.innerHTML = '<div class="ax2-card ax2-empty">Sin comisiones que pagar en estas fechas</div>';
  } else {
    cPagarCard.innerHTML = `<div class="ax2-card ax2-payout-card">
      <div class="ax2-payout-total">
        <div class="ax2-payout-total-label">Total comisiones del período</div>
        <div class="ax2-payout-total-value">${_fmtDosMonedas(tcU, tcM)}</div>
      </div>
      ${filasPagar.map(([, a]) => `<div class="ax2-payout-row"${_filaPagarAttrs(a.gestorId)}>
          <div class="ax2-payout-row-top">
            <div class="ax2-payout-name">${escapeHTML(a.nombre)}${a.gestorId != null ? ' ›' : ''}</div>
            <div class="ax2-payout-amt">${_montoDebePagarHTML(a)}</div>
          </div>
          <div class="ax2-payout-track"><div class="ax2-payout-fill" style="width:${Math.max(4,pctDe(a)*100).toFixed(0)}%;"></div></div>
        </div>`).join('')}
    </div>`;
  }

  // ── UNA FICHA POR DUEÑO ──
  // Salen TODOS los dados de alta, hayan vendido o no: si uno no aparece porque
  // no vendió nada, no hay dónde tocar para cambiarle el nombre o quitarlo.
  const tarjetas = [];
  registrados.forEach(d => {
    const gr = porDueno.get(String(d.id));
    tarjetas.push({ clave: String(d.id), id: d.id, nombre: d.nombre, propia: false,
                    ventaUSD: gr ? gr.ventaUSD : 0, ventaMN: gr ? gr.ventaMN : 0,
                    comUSD: gr ? gr.comUSD : 0, comMN: gr ? gr.comMN : 0,
                    ventas: gr ? gr.lineas.length : 0,
                    productos: productosDeDueno(d.id).length });
  });
  const tienda = porDueno.get(_SIN_DUENO);
  if (tienda) tarjetas.push({ clave: _SIN_DUENO, id: null, nombre: tienda.nombre, propia: true,
                              ventaUSD: tienda.ventaUSD, ventaMN: tienda.ventaMN,
                              comUSD: tienda.comUSD, comMN: tienda.comMN,
                              ventas: tienda.lineas.length, productos: 0 });
  if (cListCount) cListCount.textContent = tarjetas.length ? `${tarjetas.length}` : '';
  if (!tarjetas.length) {
    cList.innerHTML = '<div class="ax2-card ax2-empty">Sin dueños todavía</div>';
    return;
  }
  // Primero quien más vendió; los que no vendieron nada, por nombre al final.
  tarjetas.sort((a, b) => (a.propia ? 1 : 0) - (b.propia ? 1 : 0)
                       || (b.ventaUSD + b.ventaMN / 1000) - (a.ventaUSD + a.ventaMN / 1000)
                       || a.nombre.localeCompare(b.nombre, 'es'));

  cList.innerHTML = `<div class="ax2-card ax2-row-card">
    ${tarjetas.map(t => `
      <div class="ax2-row" data-dueno="${escapeHTML(t.clave)}" onclick="openDuenoModal('${escapeHTML(t.clave)}')" title="Ver las ventas de ${escapeHTML(t.nombre)}">
        <div class="ax2-row-avatar" style="${t.propia?'background:rgba(127,127,127,.15);color:var(--ax2-text-mid);':''}">${t.propia ? '🏪' : '🧑‍💼'}</div>
        <div class="ax2-row-body">
          <div class="ax2-row-title">${escapeHTML(t.nombre)}</div>
          <div class="ax2-row-meta">${t.ventas} venta(s) en el período${t.propia ? '' : ` · ${t.productos} producto(s) suyos`}</div>
        </div>
        <div class="ax2-row-nums">
          <div class="ax2-row-amount">${_fmtDosMonedas(t.ventaUSD, t.ventaMN)}</div>
          ${(t.comUSD || t.comMN) ? `<div class="ax2-row-sub">paga ${_fmtDosMonedas(t.comUSD, t.comMN)}</div>` : ''}
        </div>
        <span class="ax2-row-chevron">›</span>
      </div>`).join('')}
  </div>`;
}

function renderStats() {
  const from=document.getElementById('statsDateFrom').value;
  const to=document.getElementById('statsDateTo').value;
  let vales=getVales();
  if(from)vales=vales.filter(v=>_fechaEfectiva(v)>=from);
  if(to)  vales=vales.filter(v=>_fechaEfectiva(v)<=to);
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
  // v113: los totales de arriba SIEMPRE contaron las ventas de la tienda —salen
  // de todos los vales— pero este desglose recorre la lista de gestores, y la
  // tienda no está en ella (a propósito: no compite en el ranking ni cobra
  // comisión). Resultado: una venta hecha desde el admin se confirmaba, entraba
  // en el historial… y desaparecía del único sitio donde se mira qué se ha
  // vendido y quién lo vendió. Aquí sí tiene que salir, con su propia tarjeta.
  renderGanancia(vales);   // v114
  const gestores=getGestores().slice();
  if (vales.some(esValeDeLaTienda)) gestores.push(GESTOR_TIENDA);
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
    `🔸Precio MN: ${v.precioMN}`,`🔸 Vuelto: ${v.vuelto}`,
    ...(function(){   // v79: mismo criterio que el resto
      const _r = (typeof _rebajaVale === 'function') ? _rebajaVale(v) : null;
      if (!_r) return [`🔸 Total a pagar: ${v.total}`];
      return [`🔸 Precio: ${v.total}`,
              `🔸 Rebaja: −${_r.rebajaTxt}`,
              `🔸 Total a pagar: ${_r.aCobrarTxt || (v.total + ' menos ' + _r.rebajaTxt)}`];
    })(),'',
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
  // v34 FIX: Show ALL products in catalog (not just stock>0).
  // The gestor needs to see the full catalog to sell products.
  // Stock info is displayed as a badge on each product.
  const prods=getProductos();
  if(!prods.length){
    // Try one-shot sync from Supabase before giving up
    showToast('Cargando productos…');
    Promise.all([
      _sbRestGetCollection('productos').catch(e => { console.warn('[catalog] productos fetch error:', e); return []; }),
      _sbRestGetCollection('categorias').catch(e => { console.warn('[catalog] categorias fetch error:', e); return []; })
    ]).then(([prodArr, catArr]) => {
      if (prodArr && prodArr.length > 0) {
        _syncCount++;
        try {
          localStorage.setItem('axon_productos', JSON.stringify(prodArr));
          _productosCache = prodArr; _productosDirty = false; _productosMap = null;  // v95
          if (catArr && catArr.length > 0) {
            localStorage.setItem('axon_categorias', JSON.stringify(catArr));
            _categoriasCache = catArr; _categoriasDirty = false;
          }
        } finally { _syncCount--; }
        // Retry opening the catalog now that we have products
        openGestorCatalog();
      } else {
        showToast('No hay productos disponibles');
      }
    }).catch(() => { showToast('Error al cargar productos'); });
    return;
  }
  catalogCatFilter=null;expandedCatalogId=null;_showAgotados=false;
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
  // v35 FIX: By default, hide out-of-stock products. Toggle _showAgotados to show all.
  // Also fix catId mapping for products that use 'categoria' (string) instead of 'catId' (number).
  // Also fix photo URLs: resolve relative "photos/" paths to absolute URLs.
  const cats = getCategorias();
  const catNameToId = {};
  cats.forEach(c => { catNameToId[c.name] = c.id; });
  // v36: Shallow clone to avoid mutating cached product objects
  let allProds = getProductos().map(p => {
    const cp = {...p};
    if (!cp.catId && cp.categoria && catNameToId[cp.categoria]) {
      cp.catId = catNameToId[cp.categoria];
    }
    return cp;
  });
  // v35: Filter out agotados by default
  let prods = _showAgotados ? allProds : allProds.filter(p => (p.stock || 0) > 0);
  if(catalogCatFilter!==null)prods=prods.filter(p=>p.catId===catalogCatFilter);
  if(search)prods=prods.filter(p=>p.name.toLowerCase().includes(search));
  const c=document.getElementById('gestorCatalogList');
  if(!c) return;
  // v35: Count agotados for toggle label
  const agotadosCount = allProds.filter(p => (p.stock || 0) <= 0).length;
  const disponiblesCount = allProds.filter(p => (p.stock || 0) > 0).length;
  if(!prods.length){
    c.innerHTML=`<div class="es"><div class="es-icon">📦</div><div class="es-text">${_showAgotados?'Sin productos':'Sin productos disponibles'}${agotadosCount>0&&!_showAgotados?` <span style="color:var(--blue);cursor:pointer;text-decoration:underline;" onclick="_showAgotados=true;renderGestorCatalog()">(${agotadosCount} agotados)</span>`:''}</div></div>`;
    return;
  }
  c.innerHTML=`<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;font-size:11px;">
    <span style="color:var(--text-muted);">${prods.length} producto${prods.length!==1?'s':''}</span>
    ${agotadosCount>0?`<label style="display:flex;align-items:center;gap:4px;cursor:pointer;color:var(--text-muted);"><input type="checkbox" ${_showAgotados?'checked':''} onchange="_showAgotados=this.checked;renderGestorCatalog()" style="margin:0;"> Agotados (${agotadosCount})</label>`:''}
  </div>` + prods.map(p=>{
    const exp=expandedCatalogId===p.id;
    const fav = isFavorite(p.id);
    const photoUrl = _resolvePhotoUrl(p.photo);
    const isAgotado = (p.stock || 0) <= 0;
    return `<div style="border:1px solid var(--${exp?'blue':'gray-200'});border-radius:8px;margin-bottom:6px;overflow:hidden;transition:border-color .15s;${isAgotado?'opacity:0.65;':''}">
      <div style="display:flex;align-items:center;gap:10px;padding:8px;">
        ${photoUrl?`<img src="${escapeAttr(photoUrl)}" style="width:52px;height:52px;object-fit:cover;border-radius:6px;flex-shrink:0;" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div style="width:52px;height:52px;border-radius:6px;background:var(--gray-100);display:none;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;">📦</div>`:`<div style="width:52px;height:52px;border-radius:6px;background:var(--gray-100);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;">📦</div>`}
        <div style="flex:1;min-width:0;cursor:pointer;" onclick="toggleCatalogItem(${p.id})">
          <div style="font-weight:700;font-size:13px;color:var(--text);">${escapeHTML(p.name)}${isAgotado?' <span style="font-weight:600;font-size:10px;color:var(--red);background:rgba(239,68,68,.1);padding:1px 5px;border-radius:6px;">AGOTADO</span>':''}</div>
          ${p.precio?`<div style="color:var(--blue);font-weight:700;font-size:12px;margin-top:2px;">${escapeHTML(p.precio)}</div>`:''}
        </div>
        <button style="background:none;border:none;cursor:pointer;font-size:18px;padding:4px;color:${fav?'#F59E0B':'var(--gray-400)'};flex-shrink:0;" onclick="toggleFavorite(${p.id})" title="Favorito">${fav?'⭐':'☆'}</button>
        ${p.description?`<button style="background:none;border:none;cursor:pointer;font-size:14px;padding:4px;color:var(--gray-400);flex-shrink:0;" onclick="copyProductDesc(${p.id})" title="Copiar descripción">📋</button>`:''}
        <div style="font-size:13px;color:var(--gray-400);flex-shrink:0;cursor:pointer;margin-left:4px;" onclick="toggleCatalogItem(${p.id})">${exp?'▲':'▼'}</div>
      </div>
      ${exp?`<div style="padding:8px 12px 12px;border-top:1px solid var(--gray-200);background:var(--gray-50);">
        ${p.description?`<div style="font-size:12px;color:var(--text-muted);margin-bottom:10px;white-space:pre-line;line-height:1.5;">${escapeHTML(p.description)}</div>`:''}
        <div style="display:flex;flex-wrap:wrap;gap:5px;font-size:11px;">
          <span style="background:${!isAgotado?'var(--blue-lt)':'rgba(239,68,68,.1)'};color:${!isAgotado?'var(--blue)':'var(--red)'};padding:3px 9px;border-radius:10px;font-weight:700;">📦 ${!isAgotado?'Disponibles: '+p.stock:'Agotado'}</span>
          ${p.garantia?`<span style="background:var(--gray-100);color:var(--gray-600);padding:3px 9px;border-radius:10px;">🛡️ ${escapeHTML(p.garantia)}</span>`:''}
          ${p.comision?`<span style="background:#f0fdf4;color:var(--green);padding:3px 9px;border-radius:10px;font-weight:600;">Comisión: ${escapeHTML(p.comision)}</span>`:''}
          ${p.puntos?`<span style="background:var(--blue-lt);color:var(--blue);padding:3px 9px;border-radius:10px;">⭐ ${p.puntos} pts</span>`:''}
        </div>
      </div>`:''}
    </div>`;
  }).join('');
}

// ══════════════════════════════════════════
//  v33: CATALOG PDF GENERATION (with product images)
// ══════════════════════════════════════════
function generateCatalogPDF() {
  const cats = getCategorias();
  const prods = getProductos().filter(p => (p.stock || 0) > 0);
  if (!prods.length) { showToast('No hay productos disponibles para generar PDF'); return; }

  // v35: Build rich printable HTML with product photos, prices, and full descriptions
  const dateStr = new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' });
  let html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>AXONTECH - Catálogo ${dateStr}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', -apple-system, system-ui, sans-serif; color: #1a1a2e; line-height: 1.5; padding: 20px; }
  h1 { text-align: center; font-size: 28px; color: #006d8a; margin-bottom: 4px; letter-spacing: 4px; }
  .subtitle { text-align: center; font-size: 12px; color: #64748b; margin-bottom: 6px; letter-spacing: 2px; }
  .date { text-align: center; font-size: 10px; color: #94a3b8; margin-bottom: 28px; }
  .cat-section { margin-bottom: 28px; }
  .cat-name { font-size: 18px; font-weight: 800; color: #006d8a; border-bottom: 2px solid #006d8a; padding-bottom: 6px; margin-bottom: 14px; }
  .prod-card { display: flex; gap: 14px; padding: 12px 8px; border-bottom: 1px solid #e2e8f0; page-break-inside: avoid; align-items: flex-start; }
  .prod-img-wrap { width: 100px; height: 100px; flex-shrink: 0; border-radius: 8px; overflow: hidden; border: 1px solid #e2e8f0; background: #f0f4f8; display: flex; align-items: center; justify-content: center; }
  .prod-img { width: 100%; height: 100%; object-fit: cover; }
  .prod-noimg { font-size: 36px; color: #cbd5e1; }
  .prod-info { flex: 1; min-width: 0; }
  .prod-name { font-weight: 800; font-size: 14px; color: #1a1a2e; margin-bottom: 4px; line-height: 1.3; }
  .prod-price { font-weight: 900; font-size: 16px; color: #006d8a; margin-bottom: 6px; letter-spacing: 0.3px; }
  .prod-desc { font-size: 11px; color: #475569; line-height: 1.6; margin-bottom: 6px; white-space: pre-line; }
  .prod-badges { display: flex; flex-wrap: wrap; gap: 6px; }
  .badge { padding: 2px 8px; border-radius: 6px; font-size: 9px; font-weight: 700; }
  .badge-stock { background: #f0fdf4; color: #16a34a; border: 1px solid #bbf7d0; }
  .badge-garantia { background: #f8fafc; color: #64748b; border: 1px solid #e2e8f0; }
  .badge-puntos { background: #eff6ff; color: #2563eb; border: 1px solid #bfdbfe; }
  .footer { text-align: center; font-size: 9px; color: #94a3b8; margin-top: 36px; border-top: 1px solid #e2e8f0; padding-top: 10px; }
  @media print { body { padding: 12px; } .prod-card { page-break-inside: avoid; } .cat-section { page-break-after: auto; } }
</style></head><body>
<h1>AXONTECH</h1>
<div class="subtitle">CATÁLOGO DE PRODUCTOS</div>
<div class="date">${dateStr}</div>`;

  // Group by category
  const catMap = {};
  cats.forEach(c => { catMap[c.id] = c; });
  const grouped = {};
  prods.forEach(p => {
    const catName = (catMap[p.catId] || {}).name || 'Sin categoría';
    if (!grouped[catName]) grouped[catName] = [];
    grouped[catName].push(p);
  });

  for (const [catName, catProds] of Object.entries(grouped)) {
    html += `<div class="cat-section"><div class="cat-name">${escapeHTML(catName)}</div>`;
    catProds.forEach(p => {
      const photoUrl = _resolvePhotoUrl(p.photo);
      const hasPhoto = photoUrl && /^(https?:|data:image|blob:)/i.test(photoUrl);
      const desc = p.description || '';
      html += `<div class="prod-card">
<div class="prod-img-wrap">
${hasPhoto ? `<img class="prod-img" src="${escapeAttr(photoUrl)}" onerror="this.parentElement.innerHTML='<span class=prod-noimg>📦</span>'">` : `<span class="prod-noimg">📦</span>`}
</div>
<div class="prod-info">
  <div class="prod-name">${escapeHTML(p.name)}</div>
  ${p.precio ? `<div class="prod-price">${escapeHTML(p.precio)}</div>` : ''}
  ${desc ? `<div class="prod-desc">${escapeHTML(desc)}</div>` : ''}
  <div class="prod-badges">
    <span class="badge badge-stock">Stock: ${p.stock || 0}</span>
    ${p.garantia ? `<span class="badge badge-garantia">Garantía: ${escapeHTML(p.garantia)}</span>` : ''}
    ${p.puntos ? `<span class="badge badge-puntos">${p.puntos} pts</span>` : ''}
  </div>
</div>
</div>`;
    });
    html += `</div>`;
  }

  html += `<div class="footer">AXONTECH · Amistad #311 % San Rafael y San Jose, Centro Habana · ${dateStr}</div>
</body></html>`;

  // Open in new window for printing (user can save as PDF)
  const w = window.open('', '_blank', 'width=800,height=600');
  if (w) {
    w.document.write(html);
    w.document.close();
    // Wait for images to load before printing
    // v36: Use 'printed' flag to prevent double print dialog
    setTimeout(() => {
      const imgs = w.document.querySelectorAll('img');
      let loaded = 0;
      let printed = false;
      const total = imgs.length;
      const doPrint = () => { if (!printed) { printed = true; w.print(); } };
      if (total === 0) { doPrint(); return; }
      imgs.forEach(img => {
        if (img.complete) { loaded++; if (loaded >= total) doPrint(); }
        else { img.onload = () => { loaded++; if (loaded >= total) doPrint(); }; img.onerror = () => { loaded++; if (loaded >= total) doPrint(); }; }
      });
      // Fallback: print after 5s even if some images didn't load
      setTimeout(doPrint, 5000);
    }, 300);
  } else {
    // Fallback: download as HTML
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `AXONTECH-catalogo-${new Date().toISOString().slice(0,10)}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

// ══════════════════════════════════════════
//  ADMIN CATALOG (shared products, no out-of-stock, auto-updates from stock)
// ══════════════════════════════════════════
function renderAdminCatalogCats() {
  const cats=getCategorias();
  // v35: Show available products by default, with toggle for agotados
  const allProds=getProductos();
  const prods=_adminShowAgotados ? allProds : allProds.filter(p => (p.stock || 0) > 0);
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
  // v35: Filter agotados by default, fix catId mapping, fix photo URLs
  const cats = getCategorias();
  const catNameToId = {};
  cats.forEach(c => { catNameToId[c.name] = c.id; });
  // v36: Shallow clone to avoid mutating cached product objects
  let allProds=getProductos().map(p => {
    const cp = {...p};
    if (!cp.catId && cp.categoria && catNameToId[cp.categoria]) cp.catId = catNameToId[cp.categoria];
    return cp;
  });
  // v35: Filter out agotados by default
  let prods = _adminShowAgotados ? allProds : allProds.filter(p => (p.stock || 0) > 0);
  // v32: If no products, try force-syncing from Supabase
  if(!allProds.length && !_adminCatalogSyncing) {
    _adminCatalogSyncing = true;
    Promise.all([
      _sbRestGetCollection('productos').catch(e => []),
      _sbRestGetCollection('categorias').catch(e => [])
    ]).then(([prodArr, catArr]) => {
      if (prodArr && prodArr.length > 0) {
        _syncCount++;
        try {
          localStorage.setItem('axon_productos', JSON.stringify(prodArr));
          _productosCache = prodArr; _productosDirty = false; _productosMap = null;  // v95
          if (catArr && catArr.length > 0) {
            localStorage.setItem('axon_categorias', JSON.stringify(catArr));
            _categoriasCache = catArr; _categoriasDirty = false;
          }
        } finally { _syncCount--; }
        renderAdminCatalogCats();
        renderAdminCatalog();
      }
      _adminCatalogSyncing = false;
    }).catch(() => { _adminCatalogSyncing = false; });
  }
  if(adminCatalogCatFilter!==null)prods=prods.filter(p=>p.catId===adminCatalogCatFilter);
  if(search)prods=prods.filter(p=>p.name.toLowerCase().includes(search)||(p.description||'').toLowerCase().includes(search));
  const c=document.getElementById('catalogAdminGrid');
  if(!c)return;
  // v35: Count agotados for toggle
  const agotadosCount = allProds.filter(p => (p.stock || 0) <= 0).length;
  if(!prods.length){c.innerHTML=`<div class="es"><div class="es-icon">📦</div><div class="es-text">${_adminShowAgotados?'Sin productos':'Sin productos disponibles'}${agotadosCount>0&&!_adminShowAgotados?` <span style="color:var(--blue);cursor:pointer;text-decoration:underline;" onclick="_adminShowAgotados=true;renderAdminCatalogCats();renderAdminCatalog()">(${agotadosCount} agotados)</span>`:''}</div></div>`;return;}
  c.innerHTML=`<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;font-size:11px;">
    <span style="color:var(--text-muted);">${prods.length} producto${prods.length!==1?'s':''}</span>
    ${agotadosCount>0?`<label style="display:flex;align-items:center;gap:4px;cursor:pointer;color:var(--text-muted);"><input type="checkbox" ${_adminShowAgotados?'checked':''} onchange="_adminShowAgotados=this.checked;renderAdminCatalogCats();renderAdminCatalog()" style="margin:0;"> Agotados (${agotadosCount})</label>`:''}
  </div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;">`+
    prods.map(p=>{
      const cat=getCategorias().find(c=>c.id===p.catId);
      const photoUrl = _resolvePhotoUrl(p.photo);
      const isAgotado = (p.stock || 0) <= 0;
      return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;transition:box-shadow .2s,transform .15s;${isAgotado?'opacity:0.7;':''}" onmouseover="this.style.boxShadow='0 4px 14px rgba(0,0,0,.08)';this.style.transform='translateY(-2px)'" onmouseout="this.style.boxShadow='';this.style.transform=''">
        <div style="height:140px;background:var(--gray-100);display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative;">
          ${photoUrl?`<img src="${escapeAttr(photoUrl)}" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`:''}
          <div style="${photoUrl?'display:none;':''}width:100%;height:100%;align-items:center;justify-content:center;font-size:48px;">📦</div>
          ${cat?`<span style="position:absolute;top:8px;left:8px;background:var(--blue);color:white;padding:2px 8px;border-radius:10px;font-size:9px;font-weight:700;">${escapeHTML(cat.name)}</span>`:''}
          ${isAgotado?`<span style="position:absolute;top:8px;right:8px;background:var(--red);color:white;padding:2px 8px;border-radius:10px;font-size:9px;font-weight:700;">AGOTADO</span>`:''}
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
  const pPhotoRaw=p.photo||p.imagen||(p.imagenes&&p.imagenes.length?p.imagenes[0]:'')||'';
  const pPhoto=_resolvePhotoUrl(pPhotoRaw);
  const pGarantia=p.garantia||'';
  const esc=s=>JSON.stringify(s).replace(/<\//g,'<\\/');
  const waMsg=`Hola, me interesa el producto: ${pName}${pPrice?' - '+pPrice:''}. Esta disponible?`;
  const waLink=waPhone?`https://wa.me/${waPhone}?text=${encodeURIComponent(waMsg)}`:'';
  return `{id:${p.id},catId:${cat?cat.id:0},name:${esc(pName)},desc:${esc(pDesc)},price:${esc(pPrice)},photo:${esc(pPhoto)},catName:${esc(cat?cat.name:'')},catColor:'${color}',garantia:${esc(pGarantia)},waLink:${esc(waLink)}},`;
}

// ══════════════════════════════════════════
//  PUBLISH CATALOG TO GITHUB PAGES
// ══════════════════════════════════════════
// ── v84: compartir el catálogo por WhatsApp ─────────────────────────────────
// Hasta ahora el enlace solo aparecía después de pulsar "Generar / Publicar", así
// que para pasárselo a un cliente había que publicar otra vez aunque el catálogo
// ya estuviera en línea. La dirección es fija —depende del repo configurado—, así
// que se puede construir sin tocar GitHub.
function _urlCatalogo() {
  // v85: se deduce de dónde está corriendo la app. Si estás usando el panel en
  // https://…/AXONTECH/admin.html, el catálogo es …/AXONTECH/catalogo.html —
  // compartir un enlace no tiene por qué exigir configurar GitHub, que era lo
  // que pasaba antes.
  try {
    const base = window.location.origin + window.location.pathname.replace(/[^/]*$/, '');
    if (/^https?:/i.test(base)) return base + 'catalogo.html';
  } catch(e) {}
  // Solo si la app se abrió desde un archivo local (file://) hace falta el repo.
  const cfg = getConfig();
  const partes = ((cfg && cfg.ghRepo) || '').split('/').filter(Boolean);
  if (partes.length < 2) return null;
  const owner = partes[0], repo = partes.slice(1).join('/');
  return 'https://' + owner + '.github.io/' + repo + '/catalogo.html';
}
function compartirCatalogoWhatsApp() {
  const url = _urlCatalogo();
  if (!url) { showToast('No se pudo formar el enlace: abre el panel desde su dirección web'); return; }
  const texto = '🛍️ *Catálogo AXONTECH*\n\nMira aquí los productos disponibles y sus precios:\n' + url;
  // wa.me sin número: WhatsApp pregunta a quién enviárselo, que es lo que se
  // quiere — el enlace se manda a clientes distintos cada vez.
  window.open('https://wa.me/?text=' + encodeURIComponent(texto), '_blank');
}
function copiarLinkCatalogo() {
  const url = _urlCatalogo();
  if (!url) { showToast('No se pudo formar el enlace: abre el panel desde su dirección web'); return; }
  navigator.clipboard.writeText(url)
    .then(() => showToast('Enlace copiado ✓'))
    .catch(() => showToast('No se pudo copiar: ' + url));
}

async function publishCatalogToGitHub(htmlContent) {
  const cfg=getConfig();
  if(!ghToken()||!cfg.ghRepo){showToast('Configura GitHub primero en ⚙️ Config');return null;}
  const catalogPath='catalogo.html';
  const parts=cfg.ghRepo.split('/').filter(Boolean);
  if(parts.length < 2){showToast('Formato de repo inválido. Use: usuario/repositorio');return null;}
  const owner=parts[0];const repo=parts.slice(1).join('/');
  if([owner,repo].some(s => /\.\.|[^a-zA-Z0-9._\-\/]/.test(s))){showToast('Nombre de repo contiene caracteres inválidos');return null;}
  const headers={Authorization:`token ${ghToken()}`,Accept:'application/vnd.github.v3+json','Content-Type':'application/json'};
  const api=`https://api.github.com/repos/${owner}/${repo}`;
  try {
    // Usar Git Data API (soporta hasta 100MB) en vez de Contents API (limite 1MB)
    // 1. Rama por defecto + último commit
    const repoRes=await fetch(api,{headers});
    if(!repoRes.ok){showToast(`Error (${repoRes.status}) obteniendo repo`);return null;}
    const repoData=await repoRes.json();
    const branch=repoData.default_branch||'main';
    // 2. Obtener el SHA del último commit de la rama
    const refRes=await fetch(`${api}/git/refs/heads/${branch}`,{headers});
    if(!refRes.ok){showToast(`Error obteniendo ref de rama ${branch}`);return null;}
    const refData=await refRes.json();
    const lastCommitSha=refData.object.sha;
    // 3. Crear blob con el contenido del catálogo
    const blobRes=await fetch(`${api}/git/blobs`,{
      method:'POST',headers,
      body:JSON.stringify({content:utf8ToBase64(htmlContent),encoding:'base64'})
    });
    if(!blobRes.ok){showToast(`Error creando blob (${blobRes.status})`);return null;}
    const blobData=await blobRes.json();
    const blobSha=blobData.sha;
    // 4. Obtener el tree actual para no perder archivos
    const commitRes=await fetch(`${api}/git/commits/${lastCommitSha}`,{headers});
    const commitData=await commitRes.json();
    const baseTreeSha=commitData.tree.sha;
    // 5. Crear nuevo tree con el catálogo actualizado
    const treeRes=await fetch(`${api}/git/trees`,{
      method:'POST',headers,
      body:JSON.stringify({
        base_tree:baseTreeSha,
        tree:[{path:catalogPath,mode:'100644',type:'blob',sha:blobSha}]
      })
    });
    if(!treeRes.ok){showToast(`Error creando tree (${treeRes.status})`);return null;}
    const treeData=await treeRes.json();
    const newTreeSha=treeData.sha;
    // 6. Crear commit
    const newCommitRes=await fetch(`${api}/git/commits`,{
      method:'POST',headers,
      body:JSON.stringify({
        message:`Catalogo AXONTECH ${new Date().toLocaleString('es-ES')}`,
        tree:newTreeSha,
        parents:[lastCommitSha]
      })
    });
    if(!newCommitRes.ok){showToast(`Error creando commit (${newCommitRes.status})`);return null;}
    const newCommitData=await newCommitRes.json();
    const newCommitSha=newCommitData.sha;
    // 7. Actualizar la rama
    const updateRefRes=await fetch(`${api}/git/refs/heads/${branch}`,{
      method:'PATCH',headers,
      body:JSON.stringify({sha:newCommitSha})
    });
    if(!updateRefRes.ok){showToast(`Error actualizando rama (${updateRefRes.status})`);return null;}
    const pagesUrl=`https://${owner}.github.io/${repo}/${catalogPath}`;
    return pagesUrl;
  } catch(e) {
    console.error('GitHub publish error:',e);
    showToast('Error al publicar: '+e.message);
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
    setGhStatus(`✅ Publicado: <a href="${url}" target="_blank" style="color:var(--blue);word-break:break-all;">${url}</a><br><span style="font-size:10px;color:var(--gray-400);">GitHub Pages tarda ~1 min en actualizarse</span>`);
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
// v116: el reparto en los tres montones vive AQUÍ y solo aquí. Lo usan la
// tarjeta de la lista y el modal; si cada uno lo calculara por su cuenta,
// acabarían diciendo cosas distintas — que es como esta app se ha ido rompiendo
// otras veces (la tabla de estados estaba en tres sitios y a cada copia le
// faltaba algo).
// v104: la comisión cuenta desde que se entrega — ver _valeGeneraComision.
function _comisionesDe(gestorId) {
  const comVales = getVales().filter(v => v.gestorId === gestorId && _valeGeneraComision(v));
  return {
    pendientes: comVales.filter(v => !v.commissionPaid && v.commissionStatus !== 'en_sobre' && v.commissionStatus !== 'cobrado'),
    enSobre:    comVales.filter(v => v.commissionStatus === 'en_sobre'),
    cobrados:   comVales.filter(v => v.commissionPaid || v.commissionStatus === 'cobrado'),
  };
}

// ── v116: las comisiones se abren en un modal, no desplegando la tarjeta ────
// Al marcar una comisión como cobrada o en sobre se repinta la lista entera, y
// la lista se REORDENA por lo que se le debe a cada gestor. O sea: justo
// después de tocar un botón, el gestor que estabas mirando salta a otro sitio
// de la pantalla y hay que buscarlo otra vez. Con varias comisiones seguidas
// eso es inmanejable.
// En un modal el gestor se queda quieto: lo de detrás puede reordenarse todo lo
// que quiera, que no se mueve lo que estás usando.
function toggleComisionGestor(id) {
  activeComisionGestorId = id;
  const modal = document.getElementById('comisionesGestorModal');
  if (!modal) {                                  // sin modal en el HTML: como antes
    activeComisionGestorId = activeComisionGestorId === id ? null : id;
    renderComisiones();
    return;
  }
  // Foto del orden actual, para que la lista de detrás no baile mientras se
  // marcan comisiones. Se toma del DOM y no recalculando: es exactamente lo que
  // el admin tiene delante en este momento.
  _ordenGestoresCongelado = [...document.querySelectorAll('#adminGestoresPanel-list .gp-card')]
    .map(c => parseInt(c.dataset.gestorId, 10)).filter(n => !isNaN(n));
  if (!_ordenGestoresCongelado.length) _ordenGestoresCongelado = null;
  modal.dataset.gestorId = id;
  // El 'show' va ANTES de pintar: renderComisionesModal() se niega a escribir en
  // un modal cerrado (para que renderComisiones() no pinte a ciegas), así que al
  // revés se abría vacío.
  modal.classList.add('show');
  renderComisionesModal();
}
function closeComisionesModal() {
  const modal = document.getElementById('comisionesGestorModal');
  if (modal) modal.classList.remove('show');
  activeComisionGestorId = null;
  _ordenGestoresCongelado = null;  // se descongela: ahora sí puede reordenarse
  renderAdminGestoresList();
}
// Repinta SOLO el contenido del modal. Es lo que se llama después de cada
// botón: la lista de detrás se deja para cuando se cierre, así no se reordena
// bajo los pies.
function renderComisionesModal() {
  const modal = document.getElementById('comisionesGestorModal');
  if (!modal || !modal.classList.contains('show')) return false;
  const id = parseInt(modal.dataset.gestorId, 10);
  const g = gestorOf(id);
  const cuerpo = document.getElementById('comisionesModalBody');
  const titulo = document.getElementById('comisionesModalTitle');
  if (!g || !cuerpo) { closeComisionesModal(); return true; }
  const { pendientes, enSobre, cobrados } = _comisionesDe(id);
  if (titulo) titulo.textContent = '💰 ' + g.name;
  const sub = document.getElementById('comisionesModalSub');
  if (sub) {
    const s = sumCommissions(pendientes.concat(enSobre));
    const b = fmtComisionBadge(s.usd, s.mn, s.computed);
    sub.textContent = b ? `Se le deben ${b}` : 'No se le debe nada';
  }
  cuerpo.innerHTML = renderComisionBody(g, pendientes, enSobre, cobrados);
  return true;
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
  // ── v81: comisión congelada al crear el vale ────────────────────────────────
  // Hasta aquí la comisión se recalcula desde el catálogo CADA VEZ que se mira
  // un vale. Eso significaba que cambiar el precio o la comisión de un producto
  // reescribía las comisiones de todos los vales anteriores, incluidos los ya
  // pagados: un gestor podía ver que lo que cobró el mes pasado ya no coincide.
  // Al crear el vale se guarda cuánta comisión daba en ese momento, y si está
  // guardada, manda. Se aplica antes de la cesión para que lo cedido se reste
  // del importe congelado, no del recalculado.
  // Los vales anteriores a esto no la llevan y siguen calculándose del catálogo:
  // no se puede saber a posteriori qué comisión tenían el día que se hicieron.
  if (v && (v.comFijadaUSD != null || v.comFijadaMN != null)) {
    totalUSD = Math.max(0, parseFloat(v.comFijadaUSD || 0) || 0);
    totalMN  = Math.max(0, parseFloat(v.comFijadaMN  || 0) || 0);
    computable = true;
    if (!parts.length) parts.push({label:'Comisión del vale', com:'fijada al crearlo', currency:'USD'});
  }

  // ── v75: comisión cedida por el gestor ──────────────────────────────────────
  // El gestor puede renunciar a parte de su comisión al hacer el vale (cliente
  // frecuente, cierre de venta, producto con un defecto leve…). Ese dinero no va
  // a ningún sitio: simplemente deja de cobrarse.
  // Se descuenta AQUÍ, y no en cada pantalla, porque las trece vistas que
  // enseñan comisiones —la del gestor, el panel de gestores del admin, el
  // ranking, los totales por periodo— pasan todas por esta función. Restándolo
  // en un solo punto, todas muestran ya la cifra rebajada y no pueden discrepar
  // entre ellas.
  const _cedida = Math.max(0, parseFloat(v.comisionCedida || 0) || 0);
  if (_cedida > 0 && computable && parts.length) {
    const _monedaCedida = (v.comisionCedidaMoneda || 'USD').toUpperCase() === 'MN' ? 'MN' : 'USD';
    // Nunca por debajo de cero: ceder más de lo que se gana no tiene sentido, y
    // el formulario ya lo topa, pero el dato puede venir de otro dispositivo.
    if (_monedaCedida === 'MN') totalMN = Math.max(0, totalMN - _cedida);
    else totalUSD = Math.max(0, totalUSD - _cedida);
    parts.push({
      label: 'Cedido por el gestor',
      com: _monedaCedida === 'MN' ? ('−' + Math.round(_cedida) + ' MN') : ('−$' + _cedida.toFixed(2) + ' USD'),
      currency: _monedaCedida,
      cedido: true
    });
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
  // Una sola escritura de todo el array, no N patchVale (que eran N subidas a Supabase).
  // Ver AUDITORIA-AXONTECH.md MEDIO 21.
  const all=getVales();
  let changed=false;
  all.forEach(v=>{
    // v104: la comisión cuenta desde que se entrega — ver _valeGeneraComision.
    if(v.gestorId===gestorId&&!v.commissionPaid&&v.commissionStatus!=='en_sobre'&&v.commissionStatus!=='cobrado'&&_valeGeneraComision(v)){
      v.commissionPaid=false;v.commissionStatus='en_sobre';v.commissionEnSobreTs=ts;changed=true;
    }
  });
  if(changed) saveVales(all);
  gestoresTabDirty=true;
  renderComisiones();maybeAutoSync();
  showToast('Todas las comisiones marcadas En Sobre ✉️');
}
// ── v116: "Cobrar todas" cobra SOLO lo que está en el sobre ────────────────
// Este botón vive dentro de la sección "✉️ En sobre", pero se llevaba por
// delante TODAS las comisiones sin pagar del gestor: también las pendientes,
// que ni siquiera habían pasado por el sobre. Dabas por cobrado dinero que
// todavía no habías apartado ni contado, y para deshacerlo había que ir vale
// por vale con "↩ Pendiente".
//
// Los montones salen de _comisionesDe(), el mismo sitio del que se pinta la
// sección: así el botón no puede cobrar algo distinto de lo que tiene encima.
function markAllCommissionsCobrado(gestorId,e) {
  if(e)e.stopPropagation();
  const ids=new Set(_comisionesDe(gestorId).enSobre.map(v=>v.id));
  if(!ids.size){ showToast('No hay comisiones en el sobre'); return; }
  const ts=new Date().toISOString();
  // Una sola escritura de todo el array, no N patchVale.
  const all=getVales();
  let changed=false;
  all.forEach(v=>{
    if(ids.has(v.id)){
      v.commissionPaid=true;v.commissionStatus='cobrado';v.commissionPaidTs=ts;changed=true;
    }
  });
  if(changed) saveVales(all);
  gestoresTabDirty=true;
  renderComisiones();maybeAutoSync();
  const _n=ids.size;
  showToast(_n===1 ? '1 comisión del sobre marcada como cobrada 💰'
                   : `${_n} comisiones del sobre marcadas como cobradas 💰`);
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
// v116: si el modal está abierto, se repinta SOLO él. Repintar la lista de
// detrás la reordenaría —está ordenada por lo que se le debe a cada gestor— y
// el que estás gestionando saltaría de sitio a mitad de faena. La lista se
// pone al día al cerrar el modal.
function renderComisiones() {
  // v116: se repintan LAS DOS. La lista tiene el orden congelado mientras el
  // modal está abierto (ver toggleComisionGestor), así que se pone al día sin
  // moverse de sitio: las chapas del gestor reflejan al momento lo que acabas
  // de marcar, y al revertir una comisión vuelve a verse como pendiente.
  if (typeof renderComisionesModal === 'function') renderComisionesModal();
  renderAdminGestoresList();
}
// ── v119: la fecha del vale y sus notas, en el modal de comisiones ─────────
// Los tres montones (pendientes / en sobre / cobrados) pintaban la ficha por
// su cuenta, y ya habían divergido: 'cobrados' enseñaba adminNotes pero se
// dejaba fuera el motivo de la rebaja y el de la comisión cedida, que son
// justo las notas que se escriben en la práctica. Con un helper compartido no
// pueden volver a separarse.
//
// La fecha que se enseña es la del VALE (v.ts), no la de cuando se metió al
// sobre o se cobró: esas ya salen a la derecha y responden a otra pregunta.
// Aquí lo que hace falta es ubicar la venta —"¿de cuándo es esto?"— sin tener
// que abrirla.
function _valeFechaHTML(v) {
  if (!v || !v.ts) return '';
  const d = new Date(v.ts);
  if (isNaN(d.getTime())) return '';
  const fecha = d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
  const hora  = (typeof timeStr === 'function') ? timeStr(v.ts) : '';
  const num   = v.valeNum ? ('#' + v.valeNum + ' · ') : '';
  return `<span style="font-size:9.5px;color:var(--text-muted);white-space:nowrap;flex-shrink:0;font-variant-numeric:tabular-nums;">${num}${fecha}${hora ? ' ' + hora : ''}</span>`;
}
function _valeNotasHTML(v, chico) {
  if (!v) return '';
  const fs = chico ? 9 : 10;
  const notas = [];
  // 'Generado por Admin' no es una nota, es una etiqueta que pone la app sola.
  if (v.adminNotes && v.adminNotes !== 'Generado por Admin')
    notas.push(`<div style="background:var(--yellow);color:#1a1a2e;border-radius:4px;padding:2px 6px;font-size:${fs}px;font-weight:700;margin-top:3px;">📝 ${escapeHTML(v.adminNotes)}</div>`);
  if (v.rebajaAdminMotivo)
    notas.push(`<div style="color:var(--orange);font-size:${fs}px;font-weight:600;margin-top:3px;">🏷️ Rebaja: ${escapeHTML(v.rebajaAdminMotivo)}</div>`);
  if (v.comisionCedidaMotivo)
    notas.push(`<div style="color:var(--orange);font-size:${fs}px;font-weight:600;margin-top:3px;">🤝 Cedió comisión: ${escapeHTML(v.comisionCedidaMotivo)}</div>`);
  if (v.garantia && String(v.garantia).replace(/[-\s]/g, ''))
    notas.push(`<div style="color:var(--text-muted);font-size:${fs}px;margin-top:3px;">🛡️ Garantía: ${escapeHTML(v.garantia)}</div>`);
  return notas.join('');
}

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
            <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;">
              <span style="font-size:12px;font-weight:700;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHTML(v.cliente||'—')}</span>
              ${_valeFechaHTML(v)}
            </div>
            <div style="font-size:10px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHTML(v.articulo||'—')}</div>
            ${_valeNotasHTML(v)}
            <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;">
              ${r.parts.length?r.parts.map(p=>`<span style="background:${p.cedido?'rgba(245,158,11,.14)':'rgba(16,185,129,.12)'};color:${p.cedido?'var(--orange)':'var(--green)'};border-radius:20px;padding:1px 8px;font-size:10px;font-weight:600;">${escapeHTML(p.label)}: ${escapeHTML(p.com)}</span>`).join(''):`<span style="color:var(--gray-400);font-size:10px;">Sin comisión definida</span>`}
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
            ${enSobre.length>1?`<button class="btn btn-green btn-sm" onclick="markAllCommissionsCobrado(${g.id},event)" title="Solo las ${enSobre.length} que están en el sobre; las pendientes no se tocan">💰 Cobrar las ${enSobre.length} del sobre</button>`:''}
          </div>
        </div>`;
      html+=enSobre.map(v=>{
        const r=getValeCommissionParts(v);
        const vBadge=fmtComisionBadge(r.totalUSD||0,r.totalMN||0,r.totalUSD!==null||r.totalMN!==null);
        const ts=v.commissionEnSobreTs?new Date(v.commissionEnSobreTs).toLocaleDateString('es-ES',{day:'2-digit',month:'short'})+' '+timeStr(v.commissionEnSobreTs):'';
        return `<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:rgba(245,158,11,.06);border:1px solid rgba(245,158,11,.25);border-radius:9px;margin-bottom:6px;">
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;">
              <span style="font-size:12px;font-weight:700;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHTML(v.cliente||'—')}</span>
              ${_valeFechaHTML(v)}
            </div>
            <div style="font-size:10px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHTML(v.articulo||'—')}</div>
            ${_valeNotasHTML(v)}
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
            <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;">
              <span style="font-size:11px;font-weight:600;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHTML(v.cliente||'—')}</span>
              ${_valeFechaHTML(v)}
            </div>
            ${_valeNotasHTML(v, true)}
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
  // COMPLETO de vales y lo sincroniza a Supabase (ver el listener de 'vales' del
  // admin, más arriba). Un dispositivo de gestor NUNCA tiene en su caché local
  // (getVales()) los vales de los DEMÁS gestores — listenToMyVales() solo escucha
  // vales/{suPropioId} — así que recalcular "summary" desde getVales() aquí (como
  // se hacía antes) daba 0 pts para todos los gestores excepto el que tenía la
  // sesión abierta: el ranking estaba roto para todo el mundo salvo uno mismo.
  let summary = [];
  try { summary = JSON.parse(localStorage.getItem('axon_ranking_summary') || '[]'); } catch(e) { summary = []; }
  if (!Array.isArray(summary)) summary = [];

  const ranked=gestores.map(g=>{
    const s = summary.find(x => x.id === g.id);
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
          ${(() => {
            // v114: los puntos ahora vuelven a cero al llegar a la meta, así que
            // el mérito acumulado se enseña aquí: cuántas metas lleva cerradas.
            // Si no, reiniciar el contador parecería que le borran el trabajo.
            const _m = parseInt(g.metas, 10) || 0;
            return _m ? `<span style="background:rgba(245,158,11,.15);color:var(--yellow);border-radius:20px;padding:1px 6px;font-size:9px;font-weight:800;flex-shrink:0;" title="${_m} meta${_m>1?'s':''} completada${_m>1?'s':''}">🏆 ${_m}</span>` : '';
          })()}
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
    // v119: los dueños y los costos también. Faltaban desde que existen, así
    // que la copia de seguridad no los guardaba: restaurar desde el archivo
    // dejaba el catálogo entero sin dueño y sin precio de compra, sin avisar.
    // Se exportan solo si este es el admin — son los dos documentos que el
    // gestor no debe tener nunca (ver _SB_SINGLETON_ADMIN).
    duenos: IS_ADMIN ? getDuenosDoc() : undefined,
    costos: IS_ADMIN ? getCostos()    : undefined,
    // Include config but EXCLUDE ghToken for security — never export the token
    config:{...cfg, ghToken: undefined},
    timestamp:new Date().toISOString(),version:3
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
        // saveVales already enqueues the write to Supabase via _enqueueSB — no direct db.ref().set()
        saveVales(data.vales);
      }
      if(data.notifs)saveNotifs(data.notifs);
      // v119: dueños y costos. Solo los restaura el admin, y solo si el archivo
      // los trae: los backups anteriores a v119 no los llevan, y en ese caso hay
      // que DEJAR los que ya están en el teléfono. Restaurar un backup viejo no
      // puede borrar de quién es cada producto ni lo que costó comprarlo.
      if(IS_ADMIN && data.duenos && typeof data.duenos==='object'){
        try { _guardarDuenos(_normalizarDocDuenos(data.duenos)); } catch(e) {}
      }
      if(IS_ADMIN && data.costos && typeof data.costos==='object'){
        try {
          const _m = { ...getCostos(), ...data.costos };   // lo del backup manda, lo demás se conserva
          _safeSetLS('axon_costos', JSON.stringify(_m));
          _costosCache = _m; _costosDirty = false;
          setSB('costos', _m);
        } catch(e) {}
      }
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
      expandedCatalogId=null;activeComisionGestorId=null;adminCatalogCatFilter=null;_adminShowAgotados=false;
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
// ── v119: cambiar de modo ──────────────────────────────────────────────────
function setMetaModo(modo) {
  if(!['off','fija','mensual'].includes(modo))return;
  const cfg=getConfig()||{};
  // El número de la meta NO se borra al pasar a otro modo: si se vuelve a
  // 'fija' tiene que estar donde estaba, que es justo lo que pidió el usuario
  // al decir "deja los modos por si hay que volver a cambiar".
  saveConfig({...cfg, metaModo:modo});
  rankingCache=null; gestoresTabDirty=true;
  renderGestorRanking(); renderAdminGestoresList(); loadGhConfigUI();
  maybeAutoSync();
  showToast(modo==='off'?'Meta desactivada'
    : modo==='mensual'?'Ranking mensual activado · gana quien más puntos haga en el mes'
    : 'Meta fija activada');
}

// ── v119: reiniciar los puntos SIN borrar nada ─────────────────────────────
// No pone contadores a cero: apunta desde qué día cuentan. Los vales siguen
// enteros, así que el reinicio se deshace con un toque y lo de antes se puede
// seguir mirando. Un contador puesto a cero de verdad no tiene vuelta atrás, y
// aquí lo que está en juego es el ranking de la gente que trabaja contigo.
function reiniciarPuntos(skipConfirm) {
  if(!skipConfirm){
    const hoy=localDay(new Date());
    showConfirmAction('¿Reiniciar los puntos de todos?',
      `Los puntos empezarán a contar desde hoy (${hoy}).<br><span style="font-size:11px;color:var(--text-muted);">No se borra ninguna venta: esto se puede deshacer.</span>`,
      'Reiniciar','btn-blue',()=>reiniciarPuntos(true));
    return;
  }
  const cfg=getConfig()||{};
  saveConfig({...cfg, puntosDesde:localDay(new Date()), puntosDesdeTs:new Date().toISOString()});
  rankingCache=null; gestoresTabDirty=true;
  renderGestorRanking(); renderAdminGestoresList(); loadGhConfigUI();
  maybeAutoSync();
  showToast('Puntos reiniciados · cuentan desde hoy ✓');
}
function deshacerReinicioPuntos() {
  const cfg=getConfig()||{};
  if(!cfg.puntosDesde){showToast('No hay ningún reinicio que deshacer');return;}
  const copia={...cfg}; delete copia.puntosDesde; delete copia.puntosDesdeTs;
  saveConfig(copia);
  rankingCache=null; gestoresTabDirty=true;
  renderGestorRanking(); renderAdminGestoresList(); loadGhConfigUI();
  maybeAutoSync();
  showToast('Reinicio deshecho · los puntos vuelven a contarse enteros ✓');
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
  // El token NUNCA va a Supabase — solo localStorage de este dispositivo.
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
  // ── v119: modo del ranking, ayuda y estado del reinicio ──
  const _modo=metaModo();
  document.querySelectorAll('#metaModoChips button').forEach(b=>{
    const act=b.dataset.modo===_modo;
    b.className='btn btn-sm'+(act?' btn-blue':'');
    if(!act){b.style.border='1px solid var(--border)';b.style.background='none';b.style.color='var(--text-muted)';}
    else {b.style.border='';b.style.background='';b.style.color='';}
  });
  const _ayuda=document.getElementById('metaModoAyuda');
  if(_ayuda)_ayuda.innerHTML={
    off:'Los puntos se siguen viendo, pero no hay meta ni premio.',
    fija:'Al llegar a la meta se cierra un ciclo y el contador vuelve a empezar. Se puede lograr varias veces.',
    mensual:'Gana quien más puntos haga en el mes. <b>No hay que reiniciar nada</b>: el 1º de cada mes empieza de cero solo, y los meses anteriores se pueden seguir consultando.'
  }[_modo]||'';
  // El número de la meta solo pinta algo en el modo fijo, pero el campo se deja
  // visible siempre para no perder de vista lo que hay configurado al volver.
  const _fila=document.getElementById('metaFijaFila');
  if(_fila)_fila.style.opacity=(_modo==='fija')?'1':'.45';
  const _pd=document.getElementById('puntosDesdeStatus');
  const _btnUndo=document.getElementById('btnDeshacerReinicio');
  if(_pd){
    _pd.innerHTML=cfg.puntosDesde
      ? `<span style="color:var(--orange);">♻️ Los puntos cuentan desde el <b>${cfg.puntosDesde}</b></span>`
      : '<span style="color:var(--gray-400);">Los puntos cuentan desde siempre</span>';
  }
  if(_btnUndo)_btnUndo.style.display=cfg.puntosDesde?'inline-flex':'none';
  // v89: fuente de la tasa del dólar
  const tKey=document.getElementById('cfg-tasa-key');
  const tUrl=document.getElementById('cfg-tasa-url');
  if(tKey)tKey.value=tasaApiKey();
  if(tUrl)tUrl.value=cfg.tasaUrl||'';
  const tMar=document.getElementById('cfg-tasa-margen');
  if(tMar)tMar.value=tasaMargen()||'';
  _pintarEstadoMargen();
}
function _pintarEstadoMargen() {
  const st=document.getElementById('tasaMargenStatus');
  if(!st) return;
  const t=tasaUSD(), m=tasaMargen();
  if(!t){ st.innerHTML='<span style="color:var(--gray-400);">Aún sin tasa</span>'; return; }
  st.innerHTML=m
    ? `<span style="color:var(--green);">${t.valor} ${m>0?'+':'−'} ${Math.abs(m)} = <b>${tasaUSDFinal()}</b></span>`
    : `<span style="color:var(--gray-400);">Se ve tal cual: ${t.valor}</span>`;
}
// El margen se puede tocar desde dos sitios (Config y el modal del chip), pero
// la regla —validar y guardar— vive en guardarTasaMargen() y nada más. Aquí solo
// se le pasa el número del campo de Config.
function saveTasaMargenCfg() {
  const inp=document.getElementById('cfg-tasa-margen');
  // Campo vacío = sin ajuste, no "usa lo que hubiera".
  guardarTasaMargen(inp && inp.value !== '' ? inp.value : 0);
  _pintarEstadoMargen();
}
// v89: guarda de dónde sacar la tasa y prueba en el momento, para no dejar al
// admin sin saber si lo que acaba de pegar sirve o no.
function saveTasaFuente() {
  const cfg=getConfig()||{};
  const tKey=document.getElementById('cfg-tasa-key');
  const tUrl=document.getElementById('cfg-tasa-url');
  // La clave se queda SOLO en este teléfono, igual que el token de GitHub: el
  // config se sincroniza a Supabase y de allí lo lee cualquiera con la anon key,
  // que es pública. La dirección sí se comparte — no es un secreto y así los
  // gestores también pueden bajar la tasa por su cuenta.
  _safeSetLS('axon_tasa_key',(tKey&&tKey.value||'').trim());
  saveConfig({...cfg, tasaUrl:(tUrl&&tUrl.value||'').trim()});
  showToast('Fuente guardada · probando…');
  actualizarTasaUSD(true);
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
        // saveVales already enqueues the write to Supabase via _enqueueSB — no need for direct db.ref().set()
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

function factoryResetVales() {
  showConfirmAction('¿BORRAR TODOS LOS VALES?', 'Esta acción no se puede deshacer y vaciará el historial.', 'Sí, borrar todo', 'btn-red', () => {
    // v32: Track ALL current vale IDs as being deleted
    const currentVales = getVales();
    currentVales.forEach(v => _valesDirectDeleting.add(String(v.id)));
    saveVales([]);
    // v34 FIX: Delete ALL vales from Supabase directly using WHERE clause.
    // ANTES: _sbRestDeleteAll('vales') enviaba DELETE sin WHERE → 400 error.
    // AHORA: usa id=gt.0 como WHERE clause (ver _sbRestDeleteAll).
    _sbRestDeleteAll('vales').then(() => {
      // v34: Keep guard active for 5s to prevent _doRestPoll re-adding
      setTimeout(() => _valesDirectDeleting.clear(), 5000);
      showToast('Todos los vales eliminados ✓');
      // Force immediate poll to sync empty state
      if(typeof _doRestPoll === 'function') _doRestPoll();
    }).catch(e => {
      _valesDirectDeleting.clear();
      console.error('[factoryReset] Supabase vales delete error:', e);
      showToast('⚠️ Error al borrar de la nube — reintentar');
    });
    // Clear ranking cache and summary so points reset to 0
    rankingCache=null;
    try { localStorage.removeItem('axon_ranking_summary'); } catch(e){}
    _enqueueSB('ranking_summary', null, 'remove');
    gestoresTabDirty=true;statsTabDirty=true;
    showToast('Borrando todos los vales…');
    selectedValeId=null;
    refreshUI();
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
function clearGestoresData() {
  const vales = getVales();
  const notifs = getNotifs();
  const gestores = getGestores();

  // Count what will be deleted
  const gestorIds = new Set(gestores.map(g => g.id));
  const valesToRemove = vales.filter(v => v.gestorId && gestorIds.has(v.gestorId));
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
  const remainingVales = vales.filter(v => !(v.gestorId && gestorIds.has(v.gestorId)));
  saveVales(remainingVales);

  // v34 FIX: Also delete the removed vales from Supabase with proper guards.
  // ANTES: solo se borraban de localStorage. Al recargar, _doRestPoll los volvía a traer.
  valesToRemove.forEach(v => {
    _valesDirectDeleting.add(String(v.id));
    _sbRestDeleteVale(v.id, v.gestorId).then(() => {
      setTimeout(() => _valesDirectDeleting.delete(String(v.id)), 5000);
    }).catch(e => {
      _valesDirectDeleting.delete(String(v.id));
      console.warn('[clearGestoresData] vale delete error:', e);
    });
  });

  // 2) Clear all notifs
  saveNotifs([]);

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

  // 6) Status message
  const s = document.getElementById('clearGestoresStatus');
  if (s) {
    s.innerHTML = `<span style="color:var(--green);">✓ Se eliminaron ${vCount} vales y ${nCount} notificaciones. Listo para empezar.</span>`;
  }
  showToast(`🧹 Datos limpiados: ${vCount} vales, ${nCount} notifs`);
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
// ── v119: cerrar el mes y proclamar ganador ────────────────────────────────
// En modo mensual no hay meta que alcanzar, así que checkGoalReached no dispara
// nunca: sin esto, el modo mensual no tendría ganador ni celebración — el
// ranking se pondría a cero el día 1 y nadie se enteraría de quién ganó.
//
// Lo cierra SOLO el admin, y una sola vez: los gestores se enteran por el aviso,
// igual que con la meta fija. Si lo cerrara cada teléfono, el mismo mes se
// proclamaría varias veces y el historial saldría duplicado.
function _puntosEnMes(gestorId, mes) {   // mes = 'YYYY-MM'
  return getVales()
    .filter(v => v.gestorId === gestorId
      && ['confirmed','pending_payment'].includes(v.status)
      && String(_fechaEfectiva(v)).slice(0,7) === mes)
    .reduce((sum,v) => sum + (v.valeProductos||[]).reduce((t,p) => {
      const pr = productoOf(p.id); return t + ((pr && pr.puntos)||0) * p.qty; }, 0), 0);
}
function rankingDelMes(mes) {
  return getGestores().filter(g => g && !g._tienda)
    .map(g => ({ id:g.id, name:g.name, initials:g.initials, color:g.color, pts:_puntosEnMes(g.id, mes) }))
    .filter(x => x.pts > 0)
    .sort((a,b) => b.pts - a.pts);
}
function ganadoresMensuales() {
  const h = (getConfig()||{}).ganadoresMensuales;
  return Array.isArray(h) ? h : [];
}
function _cerrarMesSiToca() {
  if (metaModo() !== 'mensual') return;
  if (typeof IS_ADMIN === 'undefined' || !IS_ADMIN) return;
  const cfg = getConfig() || {};
  const mesAhora = localDay(new Date()).slice(0,7);
  const enCurso = cfg.mesRankingActual || '';
  // Primera vez en este modo: se apunta el mes en curso y ya está. No se
  // proclama nada de un mes que la app no estuvo contando.
  if (!enCurso) { saveConfig({ ...cfg, mesRankingActual: mesAhora }); return; }
  if (enCurso === mesAhora) return;                  // el mes no ha cambiado
  const ranking = rankingDelMes(enCurso);
  const hist = ganadoresMensuales().slice(-23);      // dos años de historial, de sobra
  if (ranking.length) {
    const g = ranking[0];
    hist.push({ mes:enCurso, gestorId:g.id, nombre:g.name, pts:g.pts,
                segundo:(ranking[1]||{}).name || '', ts:new Date().toISOString() });
    addNotif('mes_ganado', g.name, null, String(g.pts), g.id, 'mes_ganado:'+enCurso);
    _logAudit('mes_cerrado', enCurso + ' → ' + g.name + ' (' + g.pts + ' pts)');
  }
  saveConfig({ ...cfg, mesRankingActual: mesAhora, ganadoresMensuales: hist });
  rankingCache = null; gestoresTabDirty = true;
  if (ranking.length && typeof launchEpicGlowPulse === 'function') {
    // El admin ve el podio del mes que acaba de cerrar.
    try { launchEpicGlowPulse(ranking[0], ranking[0].pts, { mes:enCurso, ranking }); } catch(e) {}
  }
  try { renderGestorRanking(); } catch(e) {}
}

function getTop3Ranked() {
  const gestores=getGestores();
  // v119: se usa getGestorPoints en vez de recalcular aquí. Repetir la cuenta
  // en dos sitios ya costaba que el podio y la barra pudieran discrepar; ahora
  // además hay periodos (mes en curso, reinicio) y esta copia no los conocía:
  // en modo mensual el podio habría enseñado los puntos de siempre mientras la
  // barra enseñaba los del mes.
  const ranked=gestores.map(g=>({...g, pts:getGestorPoints(g.id)}))
    .sort((a,b)=>b.pts-a.pts);
  return ranked.slice(0,3);
}

// Get a specific gestor's current rank (1-based)
function getGestorRank(gestorId) {
  const gestores=getGestores();
  const confirmedVales=getVales().filter(v=>['confirmed','pending_payment'].includes(v.status));
  const ranked=gestores.map(g=>{
    // v114: puntos del ciclo en curso, igual que la barra de meta. Si el
    // ranking siguiera contando los de siempre, quien ya cerró varias metas se
    // quedaría arriba para siempre y resetear el contador no serviría de nada.
    const pts=Math.max(0, confirmedVales.filter(v=>v.gestorId===g.id).reduce((sum,v)=>
      sum+(v.valeProductos||[]).reduce((s,p)=>{const pr=productoOf(p.id);return s+((pr&&pr.puntos)||0)*p.qty;},0),0)
      - (parseFloat(g.puntosCanjeados)||0));
    return {id:g.id,pts};
  }).sort((a,b)=>b.pts-a.pts);
  const idx=ranked.findIndex(r=>r.id===gestorId);
  return idx>=0?idx+1:null;
}

// Get a specific gestor's total points
// Puntos que ha hecho un gestor DESDE SIEMPRE. Este número solo sube.
// ── v119: en qué modo está el ranking ──────────────────────────────────────
// Tres modos, no dos, porque son tres cosas distintas:
//   'off'     — no hay meta ni competencia; los puntos se ven pero no premian.
//   'fija'    — el de siempre: al llegar a N puntos se cierra un ciclo y el
//               contador vuelve a empezar. Se puede lograr varias veces.
//   'mensual' — gana quien más puntos hace en el mes. No hay que reiniciar
//               nada: los puntos salen de las ventas y las ventas tienen fecha,
//               así que el 1º a las 00:00 el ranking está a cero solo, y los
//               meses anteriores se pueden seguir consultando.
// Los modos se guardan por separado del número de la meta, para poder cambiar
// de uno a otro y volver sin perder lo configurado.
function metaModo() {
  const cfg = getConfig() || {};
  if (cfg.metaModo === 'off' || cfg.metaModo === 'fija' || cfg.metaModo === 'mensual') return cfg.metaModo;
  // Sin modo guardado (config de antes de v119): si había meta puesta, era el
  // modo fijo; si no, no había meta.
  return (parseFloat(cfg.metaPuntos) > 0) ? 'fija' : 'off';
}

// Desde cuándo cuentan los puntos. El botón de reiniciar no borra nada: apunta
// aquí la fecha y los puntos empiezan a contarse desde ahí. Así el reinicio se
// puede deshacer y el historial de ventas se queda intacto.
function puntosDesde() {
  const d = (getConfig() || {}).puntosDesde;
  return (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) ? d : '';
}

// El primer día del mes en curso, para el modo mensual.
function _inicioDelMes() {
  const h = new Date();
  return localDay(new Date(h.getFullYear(), h.getMonth(), 1));
}

// ¿Entra esta venta en el recuento de puntos de ahora mismo?
// Se mide por _fechaEfectiva —el día en que la venta se cerró— por lo mismo que
// el corte de Dueños: una venta cerrada el 1 de septiembre es de septiembre,
// aunque el vale se mandara el 31 de agosto.
function _valeCuentaPuntos(v) {
  if (!v) return false;
  const d = _fechaEfectiva(v);
  if (!d) return false;
  const desde = puntosDesde();
  if (desde && d < desde) return false;
  if (metaModo() === 'mensual' && d < _inicioDelMes()) return false;
  return true;
}

function getGestorPointsTotal(gestorId) {
  const confirmedVales=getVales().filter(v=>v.gestorId===gestorId
    &&['confirmed','pending_payment'].includes(v.status)
    &&_valeCuentaPuntos(v));   // v119: solo las del periodo en curso
  return confirmedVales.reduce((sum,v)=>
    sum+(v.valeProductos||[]).reduce((s,p)=>{const pr=productoOf(p.id);return s+((pr&&pr.puntos)||0)*p.qty;},0),0);
}
// ── v114: los puntos del CICLO en curso ────────────────────────────────────
// Antes esto devolvía el total de siempre, y eso rompía la meta de dos formas
// a la vez, que son justo las dos que se ven en la app:
//
//   · La animación saltaba UNA sola vez en la vida. checkGoalReached solo
//     celebraba si el gestor estaba por debajo de la meta ANTES de esa venta;
//     como el total nunca bajaba, a partir de la primera vez ya siempre estaba
//     por encima y no volvía a saltar nunca.
//   · El contador seguía subiendo para siempre: 10, 24, 137… La meta dejaba de
//     significar nada en cuanto se pasaba.
//
// Ahora, al llegar a la meta se "canjean" esos puntos (se apuntan en el gestor)
// y el contador vuelve a empezar. Lo que sobró NO se pierde: si la meta son 100
// y se llegó a 105, el ciclo nuevo empieza en 5.
function getGestorPoints(gestorId) {
  const g = gestorOf(gestorId);
  const canjeados = (g && parseFloat(g.puntosCanjeados)) || 0;
  return Math.max(0, getGestorPointsTotal(gestorId) - canjeados);
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
  const pi=Math.max(0,Math.min(place||1,3)-1);
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
  // Also write to Supabase notifs for real-time sync
  top3.forEach((g,i)=>{
    addNotif('ranking_top3',g.name,null,`${PLACE_LABEL[i]}|${g.pts}|Puesto #${i+1}`,g.id);
  });
}

// EPIC GLOW PULSE — Main celebration overlay
// v119: `ctx` es opcional. Sin él se comporta igual que siempre (meta fija).
// Con {mes, ranking} celebra el cierre de mes: el podio es el de ESE mes, no el
// del ranking en curso —que el día 1 ya está a cero y enseñaría a todos con 0
// puntos justo en la pantalla que proclama al ganador.
function launchEpicGlowPulse(triggerGestor, triggerPts, ctx) {
  // Remove any existing overlay
  const existing=document.querySelector('.glow-overlay');if(existing)existing.remove();

  const esMes = !!(ctx && ctx.mes);
  const top3 = esMes ? (ctx.ranking||[]).slice(0,3) : getTop3Ranked();
  const meta = esMes ? 0 : (getConfig().metaPuntos||0);
  const _mesTxt = esMes ? (()=>{ try {
      return new Date(ctx.mes+'-15T12:00:00').toLocaleDateString('es-ES',{month:'long',year:'numeric'});
    } catch(e){ return ctx.mes; } })() : '';

  // Build overlay HTML
  const overlay=document.createElement('div');
  overlay.className='glow-overlay';
  overlay.innerHTML=`
    <div class="glow-rings"></div>
    <button class="glow-close" onclick="closeEpicGlowPulse()">✕</button>
    <div class="glow-announcement">
      ${esMes?`<div class="glow-meta-label">📅 ${escapeHTML(_mesTxt)}</div>`
             :(meta>0?`<div class="glow-meta-label">🎯 Meta: ${meta} pts</div>`:'')}
      <div class="glow-title" id="glowTitle">${esMes?'🏆 ¡GANADOR DEL MES! 🏆':'🏆 ¡META ALCANZADA! 🏆'}</div>
      <div class="glow-winners-list" id="glowWinnersList">
        ${top3.map((g,i)=>`
          <div class="glow-winner-row" id="glowRow${i}" style="transition-delay:${.3+i*.25}s">
            <div class="glow-winner-place" style="color:${PLACE_COLOR[i]}">${i===0?'1°':i===1?'2°':'3°'}</div>
            <div class="glow-winner-avatar" style="background:${g.color}">${escapeHTML(g.initials)}</div>
            <div class="glow-winner-info">
              <div class="glow-winner-name">${escapeHTML(g.name)}</div>
              <div class="glow-winner-pts">${g.pts} pts${esMes?(i===0?' 👑 ¡Ganó el mes!':''):(i===0&&meta>0&&g.pts>=meta?' ⭐ ¡Meta alcanzada!':'')}</div>
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
  // v119: cerrar ciclos es cosa del modo 'fija'. En 'mensual' no hay meta que
  // alcanzar —gana el que más lleve al acabar el mes— y en 'off' no hay premio,
  // así que en los dos casos esto no debe tocar nada ni lanzar la animación.
  if(metaModo()!=='fija')return;
  const meta=parseFloat(getConfig().metaPuntos);
  if(!meta||meta<=0||!gestorId)return;
  const g=gestorOf(gestorId);if(!g||g._tienda)return;   // la tienda no compite
  if(getGestorPoints(gestorId)<meta)return;
  // v114: ya no hace falta comprobar si "esta venta" fue la que cruzó. Al
  // cerrar el ciclo el contador baja solo, así que la próxima vez que se
  // llegue a la meta esto vuelve a ser verdad — y la animación vuelve a salir.
  // Aquella comprobación era justo lo que la dejaba muda para siempre.
  //
  // Puede llegarse a la meta con MUCHO margen de una sola venta (meta 10 y una
  // venta de 25). El while cierra los ciclos que hagan falta en vez de dejar el
  // contador por encima de la meta otra vez.
  let cerrados=0, canjeados=(parseFloat(g.puntosCanjeados)||0);
  while(getGestorPointsTotal(gestorId)-canjeados>=meta && cerrados<50){
    canjeados+=meta; cerrados++;
  }
  if(!cerrados)return;
  // Se sube SOLO esta ficha (guardarGestores con ids), no la lista entera: es
  // el mismo cuidado que se le puso al stock, y por el mismo motivo.
  const lista=getGestores();
  const i=lista.findIndex(x=>x.id===gestorId);
  if(i===-1)return;
  const logradas=(parseInt(g.metasLogradas,10)||0)+cerrados;
  lista[i]={...lista[i], puntosCanjeados:canjeados, metasLogradas:logradas,
            ultimaMetaTs:new Date().toISOString()};
  guardarGestores(lista,[gestorId]);
  gestoresTabDirty=true; rankingCache=null;
  // El aviso viaja al teléfono del gestor. La animación de aquí abajo solo la
  // ve quien confirma la venta —el admin—; el gestor la lanza al recibir esto.
  // Ver _celebrarMetaDelGestor().
  addNotif('meta_alcanzada', g.name, null, String(meta), gestorId,
           'meta:'+gestorId+':'+logradas);
  launchEpicGlowPulse(g, meta);
  renderGestorRanking();
}

// ── v114: la animación en el teléfono del GESTOR ───────────────────────────
// checkGoalReached corre donde se confirma la venta, o sea en el teléfono del
// admin. El gestor —que es para quien es la fiesta— no veía nada. Al llegarle
// el aviso de su meta, su teléfono lanza la misma animación. Se apunta cuál se
// celebró ya para no repetirla en cada pasada del bucle.
function _celebrarMetaDelGestor() {
  if (typeof IS_ADMIN !== 'undefined' && IS_ADMIN) return;
  if (activeGestorId == null) return;
  // v119: en modo mensual el aviso es otro ('mes_ganado'), pero la celebración
  // y el "esta ya se vio" son los mismos. Se busca el más reciente de los dos.
  const mia = getNotifs()
    .filter(n => n && n.gestorId === activeGestorId
      && (n.type === 'meta_alcanzada' || n.type === 'mes_ganado'))
    .sort((a,b) => String(b.ts||'').localeCompare(String(a.ts||'')))[0];
  if (!mia) return;
  let visto = null;
  try { visto = localStorage.getItem('axon_meta_celebrada_' + activeGestorId); } catch(e) {}
  if (visto === String(mia.id)) return;                 // esta ya se celebró
  try { localStorage.setItem('axon_meta_celebrada_' + activeGestorId, String(mia.id)); } catch(e) {}
  const g = gestorOf(activeGestorId);
  if (!g) return;
  if (mia.type === 'mes_ganado') {
    // El podio del mes que ganó, no el del ranking de ahora (que el día 1 está
    // a cero y le enseñaría a todo el mundo con 0 puntos).
    const mes = String(mia.evt||'').split(':')[1] || localDay(new Date()).slice(0,7);
    launchEpicGlowPulse(g, parseFloat(mia.extra)||0, { mes, ranking: rankingDelMes(mes) });
  } else {
    launchEpicGlowPulse(g, parseFloat(mia.extra) || 0);
  }
}

// ══════════════════════════════════════════
//  CONFIRM ACTION MODAL
// ══════════════════════════════════════════
function showConfirmAction(title, sub, okLabel, okClass, cb) {
  confirmActionCb = cb;
  document.getElementById('confirmActionTitle').textContent = title;
  // v31 FIX: Use innerHTML for sub to support formatting (e.g. <b> tags)
  // and ensure the modal is visible even if called rapidly.
  const subEl = document.getElementById('confirmActionSub');
  if (subEl) subEl.innerHTML = sub;
  const btn = document.getElementById('confirmActionOk');
  btn.textContent = okLabel;
  btn.className = `btn ${okClass} btn-full`;
  btn.disabled = false;  // v35: ensure button is enabled when shown
  // v35 FIX: Prevent double-click and add disabled state during async operation
  btn.onclick = () => {
    if (btn.disabled) return;  // Already processing
    btn.disabled = true;
    btn.textContent = 'Procesando…';
    const cb = confirmActionCb;
    closeConfirmAction();
    // Re-enable after callback completes (for next invocation)
    try { cb && cb(); } catch(e) { console.error('confirmAction cb error:', e); }
    // Safety: re-enable after 3s even if cb hangs
    setTimeout(() => { btn.disabled = false; btn.textContent = okLabel; }, 3000);
  };
  document.getElementById('confirmActionModal').classList.add('show');
}
function closeConfirmAction() {
  document.getElementById('confirmActionModal').classList.remove('show');
  confirmActionCb = null;
}

// ══════════════════════════════════════════
//  REVERT CONFIRMED SALE
// ══════════════════════════════════════════
// ── v73: ¿este vale descontó stock del almacén? ─────────────────────────────
// Se comprobaba con `if (v.stockDecremented)` a secas en tres sitios, y valía
// undefined en todos los vales guardados antes de que la bandera empezara a
// sincronizarse (ver slimVale). Con undefined no se devolvía nada, que es el
// fallo visible: reviertes un vale y los productos no vuelven al stock.
// true = descontó · false = ya se devolvió, no tocar · undefined = vale antiguo,
// se deduce del estado, porque solo 'confirmed' y 'pending_payment' descuentan.
function _valeDescontoStock(v) {
  if (!v) return false;
  if (v.stockDecremented === true) return true;
  if (v.stockDecremented === false) return false;
  return v.status === 'confirmed' || v.status === 'pending_payment';
}
// Devuelve las unidades al almacén. Un solo sitio, para que las tres vías
// (revertir, cancelar y eliminar) no puedan volver a divergir.
function _devolverStockDeVale(v) {
  if (!_valeDescontoStock(v)) return false;
  // v96: devolver es sumar, así que va por delta igual que la venta. Con el
  // número absoluto, revertir un vale desde un teléfono con la lista vieja
  // devolvía el stock de HACE RATO —por ahí volvía a aparecer inventario que ya
  // se había vendido—; sumar +2 sobre el dato del servidor no tiene ese efecto.
  const prods = getProductos().slice();
  const deltas = {};
  let cambio = false;
  (v.valeProductos || []).forEach(({id:pid, qty}) => {
    const idx = prods.findIndex(p => p && p.id === pid);
    if (idx === -1 || !qty) return;
    prods[idx] = {...prods[idx], stock: Math.max(0, (prods[idx].stock || 0) + qty)};
    deltas[pid] = (deltas[pid] || 0) + qty;
    cambio = true;
  });
  if (cambio) guardarProductosPorDelta(prods, deltas);
  return true;
}

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
  _devolverStockDeVale(v);
  // Revert to appropriate previous state:
  // - Si tenía mensajero asignado, vuelve a 'assigned' (estado visible en el panel admin)
  // - Si no, vuelve a 'pending' (estado original)
  // Antes usaba 'delivered' pero nada en el código produce ese estado (mensajeroEntrega
  // pone 'pending_payment'), así que el vale quedaba huérfano: no aparecía en el panel
  // admin. Ver AUDITORIA-AXONTECH.md ALTO 8.
  const prevStatus = v.mensajeroId ? 'assigned' : 'pending';
  patchVale(id,{status:prevStatus,confirmedTs:null,commissionPaid:false,commissionStatus:null,commissionPaidTs:null,commissionEnSobreTs:null,stockDecremented:false});
  _logAudit('vale_reverted', 'vale:' + id + ' → ' + prevStatus);
  // v52: al revertir se borran los avisos de estado de ESTE vale. Así el gestor
  // deja de ver "venta cobrada" de algo que ya no lo está, y si el admin vuelve
  // a confirmarlo se genera un aviso nuevo (la clave `evt` ya no está ocupada).
  _clearValeEventNotifs(id);
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
  let vales=ordenarRecientesPrimero(getVales());
  // v53 FIX: el historial del admin SOLO debe mostrar vales ya procesados
  // (confirmed, pending_payment, cancelled, delivered, assigned). ANTES se
  // mostraban también los 'pending' → el usuario veía vales recién llegados
  // en el historial "sin haberse completado la venta", lo cual era confuso.
  // Los vales 'pending' se siguen viendo en la pestaña "Vales" (bandeja activa).
  vales=vales.filter(v=>{
    const s=v.status||'pending';
    return s==='confirmed'||s==='pending_payment'||s==='cancelled'||s==='delivered'||s==='assigned';
  });
  const from=fromEl?fromEl.value:'';
  const to=toEl?toEl.value:'';
  const search=searchEl?searchEl.value.trim().toLowerCase():'';
  if(from)vales=vales.filter(v=>_fechaEfectiva(v)>=from);
  if(to)  vales=vales.filter(v=>_fechaEfectiva(v)<=to);
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
  if(!vales.length){c.innerHTML='<div class="es"><div class="es-icon">📭</div><div class="es-text">'+(search?'Sin resultados para "'+escapeHTML(search)+'"':'Sin vales procesados en el periodo seleccionado · los vales pendientes se ven en la pestaña "Vales"')+'</div></div>';return;}
  // Group by date
  const groups={};
  vales.forEach(v=>{
    const d=_fechaEfectiva(v);   // v119: agrupado por el día en que contó, no en que se mandó
    if(!groups[d])groups[d]=[];
    groups[d].push(v);
  });
  let html='';
  Object.keys(groups).sort((a,b)=>b.localeCompare(a)).forEach(date=>{
    const day=new Date(date+'T12:00:00').toLocaleDateString('es-ES',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
    html+=`<div style="font-size:11px;font-weight:700;color:var(--gray-400);text-transform:uppercase;letter-spacing:.5px;padding:10px 0 5px;border-top:1px solid var(--border);margin-top:8px;">${day} <span style="background:var(--gray-100);border-radius:10px;padding:1px 7px;font-size:10px;">${groups[date].length}</span></div>`;
    groups[date].forEach(v=>{
      const g=gestorOf(v.gestorId);
      // v51 FIX: normalizar status
      const _vStatus = v.status || 'pending';
      const s=estadoVale(v);
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
          <span class="sp ${s.cls}" style="font-size:9px;">${s.icon?s.icon+' ':''}${s.label}</span>
          <div style="font-size:11px;font-weight:700;color:var(--blue);margin-top:2px;">${escapeHTML(v.total||'')}</div>
        </div>
      </div>`;
    });
  });
  c.innerHTML=html;
}
function selectValeFromHistorial(id) {
  // v84: se abre aquí mismo en vez de saltar a la pestaña Vales, que obligaba a
  // volver atrás para seguir repasando el historial.
  selectedValeId=id;
  const m = document.getElementById('valeHistorialModal');
  if (!m) { adminTab('vales'); setTimeout(()=>{renderValeDetail();},50); return; }
  m.classList.add('show');
  renderValeDetail('valeHistorialDetalle');
}
function closeValeHistorialModal() {
  const m = document.getElementById('valeHistorialModal');
  if (m) m.classList.remove('show');
  // Devolver el destino al panel de siempre, o la pestaña Vales dejaría de
  // refrescarse al confirmar o revertir desde ella.
  _valeDetailDestino = 'valeDetail';
  if (typeof renderHistorial === 'function') renderHistorial();
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
  if(!confirm("⚠️ ¿Estás seguro? Esto borrará Supabase entero y cargará la base limpia.")) return;
  if(!confirm("⚠️ ÚLTIMA VERIFICACIÓN: ¿Continuar con el reseteo total? Se creará un backup automático antes.")) return;
  try {
    // Step 1: Backup current data to localStorage + Supabase before nuking
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
    // Also enqueue the backup to Supabase so it survives even if localStorage is cleared
    _enqueueSB('backups/pre-nuke-' + Date.now(), backup, 'set');

    showToast("Descargando data.json limpio...");
    const res = await fetch('./data.json?t=' + Date.now());
    if(!res.ok) throw new Error("No se pudo leer data.json");
    const data = await res.json();

    // Step 2: Use atomic multi-location update instead of remove + update.
    // This sets all new nodes AND nulls out the old ones in a single operation,
    // so the database is never left in an empty state if the second step fails.
    showToast("Inyectando base de datos limpia (atómico)...");
    const updates = {};
    if(data.gestores) {
       localStorage.setItem('axon_gestores', JSON.stringify(data.gestores));
       updates['gestores'] = data.gestores;
    }
    if(data.mensajeros) {
       localStorage.setItem('axon_mensajeros', JSON.stringify(data.mensajeros));
       updates['mensajeros'] = data.mensajeros;
    }
    if(data.productos) {
       { data.productos.forEach(_normalizeProducto); localStorage.setItem('axon_productos', JSON.stringify(data.productos)); }
       updates['productos'] = data.productos;
    }
    if(data.categorias) {
       localStorage.setItem('axon_categorias', JSON.stringify(data.categorias));
       updates['categorias'] = data.categorias;
    }
    // Clear vales, notifs, ranking_summary, estafa in the same atomic update.
    // Do NOT clear 'backups' — that's where we just stored the pre-nuke snapshot.
    updates['vales'] = null;
    updates['notifs'] = null;
    updates['ranking_summary'] = null;
    updates['estafa'] = null;

    // Clear localStorage vales/notifs/estafa (but preserve backup, admin hash, audit log)
    ['axon_vales','axon_notifs','axon_ranking_summary','axon_estafa','axon_pending_writes','axon_failed_writes'].forEach(k => {
      try { localStorage.removeItem(k); } catch(e) {}
    });

    // Reset in-memory caches so the next read picks up the new data
    _gestoresCache=null;_gestoresDirty=true;
    _valesCache=null;_valesDirty=true;
    _mensajerosCache=null;_mensajerosDirty=true;
    _productosCache=null;_productosDirty=true;_productosMap=null;  // v95
    _categoriasCache=null;_categoriasDirty=true;
    _notifsCache=null;_notifsDirty=true;
    _estafaCache=null;_estafaDirty=true;

    // ── v28 BUGFIX: Aplicar el update a Supabase REST, no al mock Supabase ──
    // ANTES: db.ref('/').update(updates) era un no-op porque db es un mock.
    // Esto causaba que el nuke solo borrara localStorage pero NO Supabase,
    // creando un desync permanente (datos viejos en Supabase que nunca se borran).
    // Ahora usamos _enqueueSB que traduce correctamente a Supabase REST.
    try {
      // Borrar singleton rows (vales, notifs, ranking_summary, estafa)
      if (updates['vales'] === null) await _sbRestMetaDelete('vales').catch(()=>{});
      if (updates['notifs'] === null) await _sbRestMetaDelete('notifs').catch(()=>{});
      if (updates['ranking_summary'] === null) await _sbRestMetaDelete('ranking_summary').catch(()=>{});
      if (updates['estafa'] === null) await _sbRestMetaDelete('estafa').catch(()=>{});
      // Escribir colecciones con datos nuevos
      if (updates['gestores']) _enqueueSB('gestores', updates['gestores'], 'set');
      if (updates['mensajeros']) _enqueueSB('mensajeros', updates['mensajeros'], 'set');
      if (updates['productos']) _enqueueSB('productos', updates['productos'], 'set');
      if (updates['categorias']) _enqueueSB('categorias', updates['categorias'], 'set');
      if (updates['config']) _enqueueSB('config', updates['config'], 'set');
    } catch(nukeErr) {
      console.warn('[nuke] Supabase write error (non-fatal, local data is correct):', nukeErr);
    }
    _logAudit('nuke_rebuild', 'system');

    showToast("¡Listo! Recargando...");
    setTimeout(() => { window.location.href = './admin.html'; }, 1500);
  } catch(e) {
    showToast("Error: " + e.message + " — Backup disponible en localStorage");
    console.error('Nuke failed:', e);
  }
}

async function loadInitialData() {
  // ── Optimización para conexiones lentas ──
  // Antes: si getGestores() o getProductos() estaban vacíos, hacíamos
  // `await fetch('./data.json?t=' + Date.now())` que bajaba 1.2MB en 3G
  // (3-5s) y BLOQUEABA el init() — la UI no arrancaba hasta que terminaba.
  // Ahora:
  // 1. Si ya hay datos en localStorage (caso normal tras primer uso),
  //    NO hacemos fetch — los listeners de Supabase traerán cualquier
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
    // Ya tenemos datos locales — los listeners de Supabase traerán cambios.
    // Solo si el admin no tiene nada en Supabase podría querer popular,
    // pero eso ya lo maneja el bloque 'Initialize empty Supabase from local'
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
      if (data.productos) { data.productos.forEach(_normalizeProducto); localStorage.setItem('axon_productos', JSON.stringify(data.productos)); }
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
          _enqueueSB('gestores', localGestores, 'set');
          _enqueueSB('mensajeros', getMensajeros(), 'set');
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
  // v87: los modales que tienen su propia función de cierre la declaran en
  // data-cerrar. Quitarles la clase a mano dejaba estado a medias: el de
  // entregas seguía marcando al mensajero como "viendo entregas", y el del
  // historial dejaba el detalle del vale apuntando al modal cerrado.
  const cerrar = openModal.getAttribute('data-cerrar');
  if (cerrar && typeof window[cerrar] === 'function') { window[cerrar](); return; }
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
   'av-precioUSD','av-precioMN','av-vuelto','av-total','av-garantia','av-comisionGestor',
   'av-horaEntrega'].forEach(id => {
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

  // v107: con "👤 Admin" la venta es de la tienda y no da comisión a nadie. Se
  // dice aquí, en el propio campo, en vez de dejar que se escriba un número que
  // luego se va a ignorar al guardar.
  const _com = document.getElementById('av-comisionGestor');
  if (_com) {
    const _esTienda = avVal('av-gestor') === '0';
    _com.disabled = _esTienda;
    _com.placeholder = _esTienda ? 'Venta de la tienda · sin comisión' : '';
    if (_esTienda) _com.value = '';
    _com.style.opacity = _esTienda ? '.55' : '';
  }

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

function calcAdminAutoTotal() { _calcTotalDe('av'); }

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
  try {
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
    horaEntrega: avVal('av-horaEntrega'),          // v108
    valeProductos: adminValeProductos, valeText: buildAdminValeText(),
    status: 'pending', mensajeroId: null, confirmedTs: null,
    isNew: true, adminNotes: 'Generado por Admin',
  };
  // v107: una venta de la propia tienda no le da comisión a nadie. Se aprovecha
  // la comisión congelada, que ya manda sobre el cálculo del catálogo: puesta a
  // cero, todas las pantallas enseñan cero sin necesidad de un caso especial en
  // cada una. Si el admin elige un gestor de verdad, esto no se toca y la
  // comisión se calcula como siempre.
  if (gId === 0) {
    vale.comFijadaUSD = 0;
    vale.comFijadaMN = 0;
    vale.comisionGestor = '';
  }

  // ── 1. Guardar el vale LOCALMENTE y encolar write a Supabase (síncrono, rápido) ──
  // v65: .slice() por lo mismo que en patchVale — no mutar el caché vivo.
  const all = getVales().slice(); all.push(vale); saveVales(all);
  _logAudit('admin_vale_sent', 'vale:' + vale.id + ' gestor:' + gId);

  // ── 2. Feedback INMEDIATO al admin ──
  playSound('vale');
  showToast(`Vale ${valeNumStr(vale)} generado para ${g ? g.name : 'gestor'} ✓`);
  closeAdminValeModal();
  } catch (e) {
    // v111: antes, si algo fallaba aquí el error se perdía y el botón se
    // quedaba en "Generando..." para siempre, sin decir nada. Un botón que no
    // responde y no explica es exactamente lo que costó encontrar este fallo.
    console.error('[vale admin] no se pudo generar:', e);
    showToast('No se pudo generar el vale: ' + (e && e.message ? e.message : 'error'));
    const btn = document.getElementById('av-sendBtn');
    if (btn) { btn.disabled = false; btn.textContent = '📤 Generar Vale'; }
  } finally { _isSendingAdminVale = false; }

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
  // ── v110: agotados abajo y en gris, como en el selector del gestor ─────────
  // Este picker enseñaba TODO mezclado, sin distinguir lo que hay de lo que no.
  // Y al pulsar "+" en algo agotado no pasaba nada visible… salvo que el
  // producto se colaba en la lista con cantidad 0, que es lo que rompía el vale
  // entero (ver setAdminPickerQty). La misma regla que el picker del gestor:
  // lo que no se puede vender, al final y apagado.
  prods = prods.slice().sort((a,b)=>{
    const aB=((a.stock||0)===0||_isFullyReserved(a))?1:0;
    const bB=((b.stock||0)===0||_isFullyReserved(b))?1:0;
    return aB-bB;
  });
  grid.innerHTML = prods.map(p=>{
    const qty=adminPickerSelected[p.id]||0; const sel=qty>0;
    const catColor=_apcGetCatColor(p.catId);
    const catName=_apcGetCatName(p.catId);
    const oos=(p.stock||0)===0;
    const fullyRes=_isFullyReserved(p);
    const partRes=_isPartiallyReserved(p);
    const blocked=oos||fullyRes;
    const avail=_availableStock(p);
    const badge = oos ? `<span class="oos-badge">AGOTADO</span>`
      : fullyRes ? `<span class="reserved-badge picker-reserved-badge">🔒 RESERVADO</span>`
      : partRes ? `<span class="reserved-badge picker-reserved-badge partial">🔐 Disp ${avail}</span>` : '';
    const titulo = oos ? 'Producto agotado' : fullyRes ? 'Todo el stock está reservado' : '';
    return `<div class="apcard${sel?' picked':''}${blocked?' apcard-blocked':''}"${titulo?` title="${titulo}"`:''}>
      <div class="apcard-info">
        <div class="apcard-name"><span class="apcard-cat" style="background:${catColor}">${escapeHTML(catName)}</span>${escapeHTML(p.name)}${badge}${p.garantia?`<span class="apcard-garantia">🛡️ ${escapeHTML(p.garantia)}</span>`:''}</div>
        ${p.precio?`<div class="apcard-price">${escapeHTML(p.precio)}</div>`:''}
        ${!blocked?`<div style="font-size:9px;color:var(--text-muted);">Disponibles: ${avail}</div>`:''}
      </div>
      <div class="apcard-controls"${blocked?' style="pointer-events:none;"':''}>
        <button class="btn-minus" ${blocked?'disabled':''} onclick="event.stopPropagation();setAdminPickerQty(${p.id},-1)">−</button>
        <span class="qty-val">${qty}</span>
        <button class="btn-plus" ${blocked?'disabled':''} onclick="event.stopPropagation();setAdminPickerQty(${p.id},1)">+</button>
      </div>
    </div>`;
  }).join('');
}

function toggleAdminPickerProd(pid) {
  if(adminPickerSelected[pid]){delete adminPickerSelected[pid];return renderAdminPickerProducts(),renderAdminPickerSelected();}
  const prod=productoOf(pid);
  if(!prod||_availableStock(prod)<=0){showToast('Sin unidades disponibles');return;}   // v110
  adminPickerSelected[pid]=1;
  renderAdminPickerProducts(); renderAdminPickerSelected();
}
function setAdminPickerQty(pid, delta) {
  // ⚠ v110 — AQUÍ ESTABA EL "no funciona el botón Generar vale".
  // Este picker no tenía tope de stock, así que se le puso Math.min(max, q).
  // Pero con un producto AGOTADO ese max vale 0, y entonces pulsar "+" guardaba
  // el producto con cantidad CERO: aparecía en "Seleccionados" como "0×". A
  // partir de ahí caía todo en cadena — el precio de cero unidades es cero, así
  // que el bloque que rellena el total no se ejecutaba, el campo Total quedaba
  // vacío, y como Total es obligatorio el botón "Generar Vale" no se encendía
  // nunca. Nada en pantalla decía por qué.
  // Una cantidad de cero no significa nada: o se puede añadir, o no se añade.
  const prod=productoOf(pid);
  const max=prod?_availableStock(prod):0;
  const actual=adminPickerSelected[pid]||0;
  let q=actual+delta;
  if(q<=0){ delete adminPickerSelected[pid]; }
  else if(max<=0){ showToast('Sin unidades disponibles'); return; }
  else if(q>max){ adminPickerSelected[pid]=max; showToast(`Solo quedan ${max} disponible${max>1?'s':''}`); }
  else { adminPickerSelected[pid]=q; }
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
    const p=productoOf(parseInt(id)); return {id:parseInt(id),name:p?p.name:id,qty:parseInt(qty,10)||0};
  // v110: red de seguridad. Un producto con cantidad 0 no es una venta, y si se
  // cuela deja el total en blanco y el botón de generar apagado sin explicación.
  // Se filtra aquí además de impedirlo en el picker: es la última puerta antes
  // de que la cantidad entre en el vale.
  }).filter(i => i.qty > 0);
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
// v68: recuerdo de que la app YA está instalada en este dispositivo.
// _isStandaloneMode() solo es cierto cuando se ha abierto DESDE EL ICONO. Si el
// usuario abre la misma dirección desde el navegador teniéndola ya instalada,
// devuelve false y le salía el cartel de "instala la app" que ya tiene. Y al
// instalarse, el handler de 'appinstalled' encima borraba el "no molestar", con
// lo que el cartel volvía enseguida.
// Se marca en dos momentos: al instalar, y la primera vez que se abre desde el
// icono (que demuestra que está instalada). A partir de ahí no se vuelve a
// ofrecer. Si alguien la desinstala, el botón de instalar del encabezado sigue
// estando: mejor no molestar de más que insistir con algo que ya se tiene.
const PWA_INSTALLED_KEY = 'axon_pwa_instalada';
function _marcarPWAInstalada() {
  try { localStorage.setItem(PWA_INSTALLED_KEY, '1'); } catch(e) {}
}
function _pwaYaInstalada() {
  try { return localStorage.getItem(PWA_INSTALLED_KEY) === '1'; } catch(e) { return false; }
}
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
  // v68: abrirse desde el icono demuestra que está instalada; se anota para no
  // ofrecerla más adelante si el usuario entra por el navegador.
  if (_isStandaloneMode()) _marcarPWAInstalada();
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
    // v68: recordarlo. Antes se hacía removeItem(PWA_DISMISS_KEY), justo lo
    // contrario: borraba el "no molestar" y el cartel reaparecía en cuanto se
    // abría la web desde el navegador, ofreciendo instalar algo ya instalado.
    _marcarPWAInstalada();
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
    if (_isStandaloneMode() || _pwaYaInstalada()) return;  // v68
    if (!showBanner) return;
    if (_isDesktop()) return;
    if (_deferredInstallPrompt || _needsManualInstall() || _isWebView()) {
      _showPWAInstallBanner();
      return;
    }
    // Android con navegador que SÍ debería disparar beforeinstallprompt:
    // esperar gracia y mostrar banner con botón de compartir como fallback.
    setTimeout(() => {
      if (_isStandaloneMode() || _pwaYaInstalada() || _isInstallDismissed()) return;  // v68
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
  // Primer chequeo a los 3s (para no competir con la carga inicial de Supabase)
  setTimeout(() => checkVersion(false), 3000);
  // Polling cada 5 minutos
  setInterval(() => checkVersion(false), _VERSION_CHECK_INTERVAL);
  await loadInitialData();
  // ── v28 BUGFIX: Iniciar polling de Supabase REST ──
  // ANTES: _startRestPolling() se definía pero NUNCA se llamaba.
  // Esto causaba que los datos guardados en Supabase (estafa, config, etc.)
  // nunca se leyeran de vuelta. Si se borraba localStorage, los datos
  // se perdían aunque existieran en Supabase.
  _startRestPolling();
  // v54: detectar temprano si el RPC upsert_vale_from_gestor está disponible.
  // Esto determina si usamos el merge server-side (correcto) o el fallback v53
  // (slim con campos del admin stale). La detección es async pero no bloquea
  // el arranque — el primer write del gestor esperará al resultado si aún no
  // se ha resuelto.
  if (!IS_ADMIN) {
    _detectGestorRpc().catch(() => {});
    _detectStockRpc().catch(() => {});   // v96: saber ya si la venta puede ir por delta
  } else {
    // v107: sacar solas las fotos que estén dentro de la base de datos. Antes
    // había que acordarse de pulsar un botón, y un botón que hay que recordar
    // es un botón que no se pulsa: mientras tanto el catálogo entero —fotos
    // incluidas— se baja en cada cambio de stock. Se hace en segundo plano y
    // sin molestar; si falla, se reintenta en el siguiente arranque.
    //
    // v114: esta llamada estaba DENTRO del bloque del gestor, y la función
    // arranca con "si no soy el admin, me voy" — o sea, no corrió nunca. Y solo
    // el admin puede hacerlo: es el único que tiene el token de GitHub.
    setTimeout(() => { _aligerarCatalogoAuto().catch(() => {}); }, 8000);
    // v114: rescatar los costos que hubieran quedado dentro del producto.
    setTimeout(() => { try { _rescatarCostosDelProducto(); } catch(e) {} }, 9000);
    // v119: y los dueños que se quedaron sin subir — ver _rescatarDuenosNoSubidos.
    setTimeout(() => { _rescatarDuenosNoSubidos().catch(() => {}); }, 10000);
    // v119: ¿cambió el mes desde la última vez? Entonces toca proclamar al
    // ganador del anterior. Se comprueba al arrancar y no con un temporizador a
    // medianoche: la app no está abierta a esa hora, y el cierre tiene que
    // ocurrir igual la próxima vez que el admin entre.
    setTimeout(() => { try { _cerrarMesSiToca(); } catch(e) {} }, 3000);
  }
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
            // v34 FIX: Do NOT auto-send SKIP_WAITING here.
            // ANTES: se enviaba SKIP_WAITING automáticamente al detectar un nuevo SW,
            // lo que causaba recargas inesperadas y "se queda pegado" cuando el SW
            // se instala con cache incompleto. Ahora solo se activa el nuevo SW
            // cuando el usuario pulsa "Recargar ahora" en el banner de actualización.
            // checkVersion() se encarga de mostrar el banner si hay versión nueva.
            console.log('[SW] New version installed — will activate on user action via update banner');
          }
        });
      });
      // Verificar cada 60s si hay una nueva versión del SW
      setInterval(() => {
        reg.update().catch(() => {});
      }, 60000);
    }).catch(() => {});
    // When the new SW takes control (after skipWaiting), reload once
    // v34: Only reload if user initiated the update (via applyUpdate)
    let _reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // v34 FIX: Only auto-reload if the user explicitly applied the update
      if (!_reloaded && localStorage.getItem('axon_update_applying')) {
        _reloaded = true;
        window.location.reload();
      }
    });
    // Escuchar mensaje SW_UPDATED del SW (se envía en activate)
    navigator.serviceWorker.addEventListener('message', (ev) => {
      if (ev.data && ev.data.type === 'SW_UPDATED') {
        // v34 FIX: Only reload if user initiated the update
        if (localStorage.getItem('axon_update_applying')) {
          setTimeout(() => window.location.reload(), 500);
        }
      }
      // ── v15: Background Sync request del SW ──
      // El SW nos pide que procesemos la cola de writes pendientes.
      // Esto se dispara cuando el browser reanuda el SW tras un periodo
      // sin conexión (Background Sync API).
      if (ev.data && ev.data.type === 'SW_SYNC_REQUEST') {
        _ensurePendingValesEnqueued();
        _processSBQueue();
      }
    });
  }
  // PWA install prompt (Android + iPhone)
  setupPWAInstallPrompt();
  // ── Auto-seleccionar gestor fijado al inicio (si existe) ──
  _autoSelectPinnedGestor();
}
// ══════════════════════════════════════════
//  TASA DEL DÓLAR (v89)
// ══════════════════════════════════════════
// Chip en la cabecera con la tasa informal del USD en Cuba, la de elToque.
//
// Aquí no se puede dar por hecho que haya internet ni que la fuente responda:
// la app se usa en móviles cubanos y las webs de tasas cambian de sitio cada
// cierto tiempo. Por eso el valor SIEMPRE se guarda, se enseña aunque sea viejo
// (con su fecha, para que nadie cobre con una tasa de hace una semana creyendo
// que es de hoy) y se puede escribir a mano. La descarga automática es una
// ayuda, no el único camino.
const TASA_MIN = 20, TASA_MAX = 5000;            // rango de cordura del valor
const TASA_REFRESCO_MS = 3 * 60 * 60 * 1000;     // no reintentar antes de 3 h
const TASA_VIEJA_MS = 24 * 60 * 60 * 1000;       // a partir de aquí se marca en naranja
let _tasaBuscando = false;

function _tasaLocal() { try { return JSON.parse(localStorage.getItem('axon_tasa_usd') || 'null'); } catch(e) { return null; } }
// La clave de elToque vive solo en este teléfono, nunca en el config que se
// sincroniza — mismo criterio que el token de GitHub.
const tasaApiKey = () => { try { return localStorage.getItem('axon_tasa_key') || ''; } catch(e) { return ''; } };

// Lo que se enseña: lo más reciente entre lo que bajó este teléfono y lo que el
// admin compartió por el config sincronizado. Así un gestor sin acceso a la web
// de tasas ve igualmente la del admin.
function tasaUSD() {
  const cfg = getConfig() || {};
  const local = _tasaLocal();
  const compartida = cfg.tasaUSD ? { valor: cfg.tasaUSD, ts: cfg.tasaUSDTs || 0, fuente: cfg.tasaUSDFuente || 'admin' } : null;
  if (local && compartida) return (local.ts || 0) >= (compartida.ts || 0) ? local : compartida;
  return local || compartida || null;
}

const _tasaValida = n => (typeof n === 'number' && isFinite(n) && n >= TASA_MIN && n <= TASA_MAX) ? n : null;

// v90: el admin puede sumarle unos CUP a la tasa real. Si elToque marca 665 y el
// margen es +10, todo el mundo ve 675 — que es a lo que de verdad se vende.
// El margen se guarda en el config sincronizado, así que se pone una vez y todos
// los teléfonos calculan el mismo número, sin depender de que el admin tenga la
// app abierta cuando cambie la tasa.
function tasaMargen() {
  const cfg = getConfig() || {};
  const n = parseFloat(cfg.tasaMargen);
  return isFinite(n) ? n : 0;
}
// El número que se enseña. La tasa base se guarda SIEMPRE limpia, tal cual vino
// de la fuente, y el margen se suma al mostrarla: si se guardara ya sumado,
// cambiar el margen obligaría a rehacer la cuenta sobre un número ya tocado y
// al segundo cambio nadie sabría cuál era el original.
function tasaUSDFinal() {
  const t = tasaUSD();
  if (!t) return null;
  const v = Math.round((t.valor + tasaMargen()) * 100) / 100;
  return v > 0 ? v : null;
}

function _tasaFechaTxt(ts) {
  if (!ts) return 'sin fecha';
  const d = new Date(ts), min = Math.round((Date.now() - ts) / 60000);
  if (min < 60) return `hace ${Math.max(1, min)} min`;
  if (min < 60 * 24) return `hace ${Math.round(min / 60)} h`;
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }) + ' ' + timeStr(d.toISOString());
}

function renderTasaBadge() {
  const b = document.getElementById('tasaUSDBadge');
  if (!b) return;
  const val = document.getElementById('tasaUSDValor');
  const t = tasaUSD();
  const fin = tasaUSDFinal();
  b.style.display = 'inline-flex';
  if (!t || fin === null) {
    if (val) val.textContent = '—';
    b.title = 'Tasa del dólar · toca para actualizarla o escribirla a mano';
    b.style.borderColor = 'rgba(255,255,255,.15)';
    return;
  }
  if (val) val.textContent = String(fin);
  const vieja = (Date.now() - (t.ts || 0)) > TASA_VIEJA_MS;
  // Naranja = el dato tiene más de un día. No se esconde: un valor viejo con su
  // fecha es más útil que un guion, siempre que se vea que es viejo.
  b.style.borderColor = vieja ? 'rgba(245,158,11,.65)' : 'rgba(255,255,255,.15)';
  b.title = `1 USD = ${fin} CUP · ${_tasaFechaTxt(t.ts)} · ${t.fuente}${vieja ? ' · dato de más de un día' : ''}`;
}

// Guarda el valor y, si es el admin, lo comparte con todos por el config que ya
// se sincroniza. Solo el admin escribe: si lo hiciera cada teléfono, el mismo
// número se estaría subiendo a Supabase varias veces al día para nada.
function _aplicarTasa(valor, fuente) {
  const o = { valor: Math.round(valor * 100) / 100, ts: Date.now(), fuente: fuente || 'elToque' };
  _safeSetLS('axon_tasa_usd', JSON.stringify(o));
  if (typeof IS_ADMIN !== 'undefined' && IS_ADMIN) {
    const cfg = getConfig() || {};
    if (cfg.tasaUSD !== o.valor || !cfg.tasaUSDTs) {
      saveConfig({ ...cfg, tasaUSD: o.valor, tasaUSDTs: o.ts, tasaUSDFuente: o.fuente });
    }
  }
  renderTasaBadge();
  return o;
}

// Las respuestas de estas webs no tienen todas la misma forma, y cambian sin
// avisar. En vez de casar una estructura exacta se busca el número del USD por
// las claves donde suele venir, y se descarta lo que no esté en un rango
// razonable — así un cambio de formato no deja el chip clavado en un número
// absurdo.
// Claves donde estas webs suelen meter el número, en orden de preferencia: la
// mediana es la cifra que publica elToque como tasa del día.
const _TASA_CLAVES_VALOR = ['median', 'mediana', 'value', 'price', 'rate', 'tasa', 'avg', 'close', 'last'];
function _valorDeMoneda(o, ok) {
  if (!o || typeof o !== 'object') return null;
  for (const k of _TASA_CLAVES_VALOR) { const v = ok(o[k]); if (v) return v; }
  return null;
}
function _extraerTasaUSD(j, prof) {
  prof = prof || 0;
  if (j == null || prof > 6) return null;
  // Devuelve el número o null. Hay webs que mandan el valor como texto ("440"),
  // así que se acepta también eso; lo que no pase el rango se descarta.
  const ok = n => {
    if (typeof n === 'string' && /^\s*-?\d+([.,]\d+)?\s*$/.test(n)) n = parseFloat(n.trim().replace(',', '.'));
    return (typeof n === 'number' && isFinite(n) && n >= TASA_MIN && n <= TASA_MAX) ? n : null;
  };
  if (Array.isArray(j)) {
    for (let i = j.length - 1; i >= 0; i--) { const v = _extraerTasaUSD(j[i], prof + 1); if (v) return v; }
    return null;
  }
  if (typeof j !== 'object') return null;
  const cur = String(j.currency || j.cur || j.moneda || '').toUpperCase();
  if (cur === 'USD') { const v = _valorDeMoneda(j, ok); if (v) return v; }
  for (const k of ['USD', 'usd', 'Usd']) {
    const directo = ok(j[k]);
    if (directo) return directo;
    if (j[k] && typeof j[k] === 'object') {
      // Ya sabemos que este objeto ES el del dólar, así que aquí el número que
      // lleve dentro vale aunque no venga etiquetado otra vez como USD.
      const v = _valorDeMoneda(j[k], ok) || _extraerTasaUSD(j[k], prof + 1);
      if (v) return v;
    }
  }
  for (const k of ['tasas', 'rates', 'x_rates', 'data', 'result', 'results', 'items']) {
    if (j[k] != null) { const v = _extraerTasaUSD(j[k], prof + 1); if (v) return v; }
  }
  return null;
}

function _tasaFuentes() {
  const cfg = getConfig() || {};
  const hoy = new Date().toISOString().slice(0, 10);
  const lista = [];
  // 0) tasa.json, en el propio servidor de la app. Lo deja ahí GitHub Actions
  //    cada pocas horas (.github/workflows/tasa-usd.yml). Es la vía buena: al
  //    ser la misma dirección de la app no hay permiso de CORS que pedir, no
  //    hace falta clave y funciona desde cualquier teléfono. Las de abajo son
  //    la reserva por si el trabajo programado deja de ejecutarse.
  //    El ?t= es para saltarse la caché del service worker, igual que version.json.
  lista.push({
    url: './tasa.json?t=' + Date.now(), opts: {}, nombre: 'elToque',
    leer: j => j && j.valor, fuenteDe: j => (j && j.fuente) || 'elToque'
  });
  // 1) La que ponga el admin en Config, por si el día de mañana hay que cambiar
  //    de sitio sin tocar el código.
  if (cfg.tasaUrl) lista.push({ url: cfg.tasaUrl, opts: {}, nombre: 'propia' });
  // 2) La API oficial de elToque. Pide una clave que ellos dan al registrarse;
  //    sin clave no se intenta siquiera, para no gastar la conexión en un 401.
  const clave = tasaApiKey();
  if (clave) lista.push({
    url: `https://tasas.eltoque.com/v1/trmi?date_from=${hoy}%2000:00:01&date_to=${hoy}%2023:59:01`,
    opts: { headers: { Authorization: 'Bearer ' + clave } },
    nombre: 'elToque'
  });
  // 3) Espejos públicos de esos mismos datos, que no piden clave.
  lista.push({ url: 'https://api.cambiocuba.money/api/v1/x-rates-by-date-range-history?trmi=true&cur=USD&period=1', opts: {}, nombre: 'elToque (espejo)' });
  lista.push({ url: 'https://api.cambiocuba.money/api/v1/x-rates', opts: {}, nombre: 'elToque (espejo)' });
  return lista;
}

async function actualizarTasaUSD(manual) {
  if (_tasaBuscando) return null;
  const actual = tasaUSD();
  // ── v119: una tasa puesta A MANO no la pisa la búsqueda automática ──
  // Antes solo se miraba la antigüedad: pasadas 3 horas, el primer arranque
  // salía a buscar la tasa a internet y la guardaba encima. O sea, el admin
  // ponía su tasa, cerraba, y a la mañana siguiente se la había comido la de
  // elToque — sin avisar, y sin forma de saber que había pasado.
  //
  // Ponerla a mano es una decisión, no un valor de relleno a la espera de algo
  // mejor: si el admin vende a otro precio que el del mercado, esa es LA tasa.
  // Solo la reemplaza él, con el botón "🔄 Actualizar ahora" (manual=true).
  // Que se quede vieja no la esconde: el chip se pone naranja pasado un día y
  // dice de dónde salió, así que se ve que es suya y de cuándo es.
  if (!manual && actual && actual.fuente === 'a mano') return actual;
  if (!manual && actual && (Date.now() - (actual.ts || 0)) < TASA_REFRESCO_MS) return actual;
  if (!navigator.onLine) { if (manual) showToast('Sin conexión'); return null; }
  _tasaBuscando = true;
  renderTasaModal();
  try {
    for (const f of _tasaFuentes()) {
      try {
        // Timeout propio: en 2G una petición puede quedarse colgada minutos y
        // bloquear el intento de la siguiente fuente.
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 9000);
        let r;
        try { r = await fetch(f.url, { ...f.opts, signal: ctrl.signal, cache: 'no-store' }); }
        finally { clearTimeout(to); }
        if (!r || !r.ok) continue;
        const j = await r.json();
        // Las fuentes con formato propio (tasa.json) traen su lector; para el
        // resto se busca el número a ciegas. En los dos casos pasa por el mismo
        // control de rango: un valor absurdo no llega al chip.
        const bruto = (f.leer ? f.leer(j) : null);
        const valor = _tasaValida(bruto) || _extraerTasaUSD(j);
        if (valor) {
          const o = _aplicarTasa(valor, (f.fuenteDe ? f.fuenteDe(j) : f.nombre));
          if (manual) showToast(`Tasa actualizada: ${tasaUSDFinal()} CUP 💵`);
          return o;
        }
      } catch(e) { /* fuente caída o bloqueada — se prueba la siguiente */ }
    }
    if (manual) showToast('No se pudo leer la tasa · ponla a mano');
    return null;
  } finally { _tasaBuscando = false; renderTasaModal(); }
}

// ── Modal de la tasa ──
// Se construye desde aquí en vez de meterlo en index.html y admin.html, que
// obligaría a mantener el mismo bloque en dos sitios.
function openTasaModal() {
  let m = document.getElementById('tasaModal');
  if (!m) {
    m = document.createElement('div');
    m.className = 'modal-bg';
    m.id = 'tasaModal';
    m.setAttribute('data-cerrar', 'closeTasaModal');
    m.innerHTML = `<div class="modal" style="max-width:340px;"><div id="tasaModalBody"></div></div>`;
    document.body.appendChild(m);
  }
  m.classList.add('show');
  renderTasaModal();
  actualizarTasaUSD(false);
}
function closeTasaModal() { const m = document.getElementById('tasaModal'); if (m) m.classList.remove('show'); }
function renderTasaModal() {
  const c = document.getElementById('tasaModalBody');
  if (!c) return;
  const t = tasaUSD();
  const fin = tasaUSDFinal();
  const margen = tasaMargen();
  const esAdmin = (typeof IS_ADMIN !== 'undefined' && IS_ADMIN);
  const vieja = t && (Date.now() - (t.ts || 0)) > TASA_VIEJA_MS;
  // El desglose (tasa real + margen) solo lo ve el admin: al gestor le sirve el
  // número al que vende, y meterle dos cifras solo invita a equivocarse.
  const desglose = (esAdmin && t && margen) ? `
      <div style="font-size:11px;color:var(--gray-400);margin-top:6px;border-top:1px dashed var(--border);padding-top:6px;">
        elToque: <b>${escapeHTML(String(t.valor))}</b> · tu ajuste: <b style="color:${margen > 0 ? 'var(--green)' : 'var(--orange)'};">${margen > 0 ? '+' : ''}${escapeHTML(String(margen))}</b>
      </div>` : '';
  c.innerHTML = `
    <div class="modal-title">💵 Tasa del dólar</div>
    <div class="modal-sub">Mercado informal · elToque</div>
    <div style="text-align:center;background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:10px;">
      <div style="font-size:30px;font-weight:800;color:var(--blue);line-height:1.1;">${fin !== null ? escapeHTML(String(fin)) : '—'}</div>
      <div style="font-size:11px;color:var(--gray-400);margin-top:2px;">CUP por 1 USD</div>
      <div style="font-size:11px;color:${vieja ? 'var(--orange)' : 'var(--gray-400)'};margin-top:6px;font-weight:${vieja ? '700' : '400'};">
        ${t ? `${escapeHTML(_tasaFechaTxt(t.ts))} · ${escapeHTML(t.fuente || '')}` : 'Todavía sin dato'}
        ${vieja ? '<br>⚠️ Tiene más de un día' : ''}
      </div>
      ${desglose}
    </div>
    <button class="btn btn-blue btn-full" onclick="actualizarTasaUSD(true)" ${_tasaBuscando ? 'disabled' : ''}>${_tasaBuscando ? '⏳ Buscando…' : '🔄 Actualizar ahora'}</button>
    ${esAdmin ? `
    <div class="lbl" style="margin:12px 0 4px;">Sumar a la tasa (lo que ven los gestores)</div>
    <div style="display:flex;gap:6px;">
      <input type="number" inputmode="decimal" id="tasaMargenInput" value="${escapeHTML(String(margen))}" style="flex:1;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:9px 11px;font-size:14px;color:var(--text);">
      <button class="btn btn-blue" onclick="guardarTasaMargen()">Aplicar</button>
    </div>
    <div style="font-size:10px;color:var(--gray-400);margin-top:4px;">Ejemplo: si elToque marca 665 y pones 10, todos verán 675.</div>
    <div class="lbl" style="margin:12px 0 4px;">Poner la tasa a mano</div>
    <div style="display:flex;gap:6px;">
      <input type="number" inputmode="decimal" id="tasaManualInput" placeholder="${t ? escapeHTML(String(t.valor)) : 'Ej: 440'}" style="flex:1;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:9px 11px;font-size:14px;color:var(--text);">
      <button class="btn btn-green" onclick="guardarTasaManual()">Guardar</button>
    </div>
    <div style="font-size:10px;color:var(--gray-400);margin-top:4px;">Escribe aquí la tasa <b>sin</b> el ajuste — el ajuste se le suma después.</div>` : ''}
    <button class="btn btn-ghost btn-full" style="margin-top:12px;" onclick="closeTasaModal()">Cerrar</button>`;
}
// `valor` viene del campo de Config; sin argumento se lee el del modal.
function guardarTasaMargen(valor) {
  const inp = document.getElementById('tasaMargenInput');
  const bruto = (valor === undefined || valor === null || valor === '') ? (inp && inp.value || '0') : valor;
  const n = parseFloat(String(bruto).replace(',', '.'));
  if (!isFinite(n)) { showToast('Pon un número (puede ser negativo)'); return; }
  const t = tasaUSD();
  if (t && (t.valor + n) <= 0) { showToast('Con ese ajuste la tasa quedaría en cero o menos'); return; }
  const cfg = getConfig() || {};
  saveConfig({ ...cfg, tasaMargen: n });
  renderTasaBadge(); renderTasaModal();
  showToast(n ? `Los gestores verán ${tasaUSDFinal()} CUP ✓` : 'Ajuste quitado ✓');
}
function guardarTasaManual() {
  const inp = document.getElementById('tasaManualInput');
  const n = parseFloat((inp && inp.value || '').replace(',', '.'));
  if (!isFinite(n) || n < TASA_MIN || n > TASA_MAX) { showToast(`Pon un número entre ${TASA_MIN} y ${TASA_MAX}`); return; }
  _aplicarTasa(n, 'a mano');
  renderTasaModal();
  showToast(tasaMargen() ? `Guardada · los gestores verán ${tasaUSDFinal()} ✓` : 'Tasa guardada ✓');
}

function initGestorPage() {
  // Removed the 12-second setInterval that re-rendered everything — Supabase
  // listeners already trigger refreshUI on every remote change. Only refresh
  // the timeAgo labels every 60s (cheap and useful).
  setInterval(() => {
    if (typeof renderGestorNotifs === 'function') renderGestorNotifs();
    // v91: de paso el chip de la tasa, para que la antigüedad y el margen del
    // admin se reflejen aunque no pase nada más en la pantalla.
    if (typeof renderTasaBadge === 'function') renderTasaBadge();
  }, 60000);
  renderGestores();
  renderGestorNotifs();
  renderGestorRanking();
  renderTasaBadge(); actualizarTasaUSD(false);
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
  renderTasaBadge(); actualizarTasaUSD(false);
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
init().catch(e => console.error('[AXONTECH] init() failed:', e));
