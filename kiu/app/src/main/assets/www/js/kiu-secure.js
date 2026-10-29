/*!
 * kiu-secure.js — red segura del lado JS (v2.3.0 · sección 2 seguridad).
 *
 * Se carga ANTES de app.js y hace dos cosas:
 *
 * 1) KiuVault: bóveda de claves API respaldada por el Keystore de Android
 *    (puente kiuKeysSet/Get/Has/Del/List). La clave en claro JAMÁS se guarda en
 *    el WebView ni se entrega al JS: app.js guarda vía Vault y manda el
 *    placeholder {{key:proveedor}} en los headers; el proxy de Java lo reemplaza
 *    por la clave real al abrir el socket.
 *
 * 2) Shim de fetch: las llamadas a APIs de la nube (OpenAI/Groq/OpenRouter/…)
 *    y a servidores locales http:// (Ollama, LM Studio, motor interno) viajan
 *    por el proxy Java (kiuApiStart/Poll/Stop). Beneficios:
 *      - la WebView no abre sockets ni maneja la clave;
 *      - sin mixed-content al hablar con http:// local desde el origen https;
 *      - sin drama de CORS con los servidores locales.
 *    Todo lo demás (assets, data:, otros https) pasa por el fetch nativo.
 *
 * Sin KiuBridge (prueba en desktop) el shim es transparente: fetch nativo.
 */
(function () {
  'use strict';
  var B = window.KiuBridge;
  var BR_OK = !!(B && B.kiuApiStart && B.kiuApiPoll && B.kiuApiStop);

  /* ---------- bóveda de claves ---------- */
  var Vault = {
    ok: !!(B && B.kiuKeysSet && B.kiuKeysGet && B.kiuKeysHas),
    has: function (n) { try { return !!B.kiuKeysHas(String(n)); } catch (e) { return false; } },
    get: function (n) { try { return B.kiuKeysGet(String(n)) || ''; } catch (e) { return ''; } },
    /* v2.11.10: devuelve false si el teléfono no pudo guardar la clave (antes se perdía en silencio) */
    set: function (n, v) { try { var r = B.kiuKeysSet(String(n), String(v || '')); return r === undefined ? true : !!r; } catch (e) { return false; } },
    del: function (n) { try { B.kiuKeysDel(String(n)); } catch (e) { } },
    list: function () {
      try { var r = B.kiuKeysList(); return (typeof r === 'string') ? JSON.parse(r) : (r || {}); }
      catch (e) { return {}; }
    }
  };
  window.KiuVault = Vault;

  /* ---------- ¿esta URL va por el proxy de Java? ---------- */
  var CLOUD = /(^|\.)(openai\.com|groq\.com|deepseek\.com|anthropic\.com|mistral\.ai|together\.xyz|cohere\.com|openrouter\.ai|nvidia\.com|generativelanguage\.googleapis\.com|duckduckgo\.com|wikipedia\.org|jina\.ai)$/;
  /* tanda 8 (KNOWN_ISSUES · hosts de nube): heurística general de API — un
   * proveedor nuevo ya NO exige editar esta lista. HTTPS distinto del origen
   * de la app con ruta con pinta de API (/v1, /v1beta, /api, /chat/completions,
   * /messages, /embeddings…) también va por el proxy de Java (que igual
   * exige HTTPS, limita a 8 MB y nunca expone la WebView). */
  var API_PATH = /\/(v\d\b|v1beta\b|api\b|api\.php\b|chat\/completions|completions|messages|embeddings|models)/;
  var APP_ORIGIN = (typeof location !== 'undefined' && location.host) ? location.host : '';
  function parse(url) {
    try {
      var a = document.createElement('a');
      a.href = url;
      return { proto: a.protocol, host: a.hostname, path: a.pathname || '' };
    } catch (e) { return { proto: '', host: '', path: '' }; }
  }
  function viaProxy(url) {
    var p = parse(url);
    if (p.proto === 'http:') return true; /* LAN/local: Java evita mixed-content */
    if (p.proto !== 'https:' || !p.host) return false;
    if (APP_ORIGIN && p.host === APP_ORIGIN) return false; /* assets propios: fetch nativo */
    if (CLOUD.test(p.host)) return true; /* nube conocida: Java inyecta claves */
    if (API_PATH.test(p.path)) return true; /* API nueva sin tocar la lista */
    return false;
  }

  /* ---------- helpers ---------- */
  function headersObj(h) {
    var o = {};
    if (!h) return o;
    try {
      if (typeof Headers !== 'undefined' && h instanceof Headers) {
        h.forEach(function (v, k) { o[k] = v; });
        return o;
      }
    } catch (e) { }
    if (Object.prototype.toString.call(h) === '[object Array]') {
      for (var i = 0; i < h.length; i++) o[h[i][0]] = h[i][1];
      return o;
    }
    for (var k in h) if (Object.prototype.hasOwnProperty.call(h, k)) o[k] = h[k];
    return o;
  }
  function abortErr() {
    var e;
    try { e = new DOMException('The operation was aborted.', 'AbortError'); }
    catch (x) { e = new Error('The operation was aborted.'); e.name = 'AbortError'; }
    return e;
  }
  function makeRes(code, ct, body) {
    var text = (body == null) ? '' : String(body);
    return {
      ok: code >= 200 && code < 300,
      status: code,
      statusText: code === 200 ? 'OK' : '',
      headers: {
        get: function (n) { return (String(n || '').toLowerCase() === 'content-type') ? ct : null; }
      },
      url: '',
      text: function () { return Promise.resolve(text); },
      arrayBuffer: function () {
        try { return Promise.resolve(new TextEncoder().encode(text).buffer); } catch (e) { return Promise.reject(e); }
      },
      blob: function () {
        try { return Promise.resolve(new Blob([text], { type: ct || 'text/plain' })); } catch (e) { return Promise.reject(e); }
      },
      json: function () {
        return new Promise(function (res, rej) {
          try { res(JSON.parse(text)); } catch (e) { rej(e); }
        });
      }
    };
  }

  /* ---------- fetch vía puente Java (start → poll 60 ms) ---------- */
  function proxyFetch(url, init) {
    return new Promise(function (resolve, reject) {
      var id = 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      var method = ((init && init.method) || 'GET').toUpperCase();
      var hs = headersObj(init && init.headers);
      var body = (init && typeof init.body === 'string') ? init.body : '';
      var launched = false;
      try { launched = B.kiuApiStart(id, method, url, JSON.stringify(hs), body); } catch (e) { launched = false; }
      if (!launched) { reject(new TypeError('proxy de red no disponible')); return; }

      var settled = false, iv = null, sig = init && init.signal;
      function finish(fn, arg) {
        if (settled) return;
        settled = true;
        if (iv) clearInterval(iv);
        if (sig) { try { sig.removeEventListener('abort', onAbort); } catch (e) { } }
        fn(arg);
      }
      function onAbort() {
        try { B.kiuApiStop(id); } catch (e) { }
        finish(reject, abortErr());
      }
      if (sig) {
        if (sig.aborted) { onAbort(); return; }
        try { sig.addEventListener('abort', onAbort); } catch (e) { }
      }
      iv = setInterval(function () {
        var o = null;
        try { o = JSON.parse(B.kiuApiPoll(id) || 'null'); } catch (e) { o = null; }
        if (!o || o.st === 'run') return;
        if (o.st === 'done') finish(resolve, makeRes(o.code, o.ct || '', o.body));
        else finish(reject, new TypeError(o.msg || 'fallo del proxy de red'));
      }, 60);
    });
  }

  /* ---------- parche de fetch ---------- */
  var nativeFetch = (typeof window.fetch === 'function') ? window.fetch.bind(window) : null;
  window.fetch = function (input, init) {
    var isReq = !!(input && typeof input === 'object' && typeof input.url === 'string');
    var url = (typeof input === 'string') ? input : isReq ? String(input.url) : String(input);
    if (BR_OK && viaProxy(url)) {
      if (isReq) {
        /* v2.7.2: fetch(new Request(...)) perdia metodo/headers/body (todo salia como GET) */
        var merged = { method: input.method, headers: input.headers, signal: input.signal };
        for (var k in (init || {})) if (Object.prototype.hasOwnProperty.call(init, k)) merged[k] = init[k];
        var m = String(merged.method || 'GET').toUpperCase();
        if (merged.body === undefined && m !== 'GET' && m !== 'HEAD' && typeof input.clone === 'function') {
          return input.clone().text().then(function (b) { merged.body = b; return proxyFetch(url, merged); });
        }
        return proxyFetch(url, merged);
      }
      return proxyFetch(url, init);
    }
    if (!nativeFetch) return Promise.reject(new TypeError('fetch no disponible'));
    return nativeFetch(input, init);
  };

  window.KiuSecure = { viaProxy: viaProxy, vault: Vault, version: '2.7.2' };
})();
