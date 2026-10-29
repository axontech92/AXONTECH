/* app/state.js — módulo de app.js (tanda 4 · sección 3-a). estado persistente: ajustes (S), personalidades, conversaciones, bóveda Sec, proveedores.
 * Cargado como script clásico en orden por index.html; los símbolos
 * compartidos viven en window para que los módulos se lean entre sí
 * igual que dentro del app.js original. */
(function () {
  'use strict';

  /* ================= PERSONALIDADES ================= */
  var PERSONAS = {
    normal: '',
    divertida: 'Simpática y juguetona: usá humor ligero y ocasionales juegos de palabras, sin exagerar. Seguís siendo útil primero.',
    tecnica: 'Sos precisa y técnica: explicá con detalle, usá datos concretos y término correctos, sin rodeos.',
    breve: 'Respondés MUY breve: máximo 2 o 3 oraciones cortas, directo al punto, sin relleno.'
  };

  /* ================= CONVERSACIONES MÚLTIPLES =================
     Lista de chats con auto-título; la conversación vieja (nexo_chat)
     se migra sola la primera vez. */
  function convList() { return store('nexo_convs') || []; }
  function saveConvList(l) { store('nexo_convs', l); }
  function curConvId() {
    var id = store('nexo_curconv');
    var l = convList();
    if (id && l.some(function (c) { return c.id === id; })) return id;
    return l.length ? l[0].id : null;
  }
  function convById(id) {
    var l = convList();
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  }
  function ensureConv() {
    var l = convList();
    if (!l.length) {
      var old = store('nexo_chat');
      var msgs = (old && old.length) ? old : null;
      if (msgs && msgs.length > 1) {
        l = [{ id: 'c' + Date.now(), title: convTitle(msgs), ts: Date.now(), msgs: msgs }];
      } else {
        l = [{ id: 'c' + Date.now(), title: 'Nueva conversación', ts: Date.now(), msgs: msgs || [] }];
      }
      saveConvList(l);
      store('nexo_curconv', l[0].id);
      try { localStorage.removeItem('nexo_chat'); } catch (e) { }
    }
    return convById(curConvId()) || l[0];
  }
  function convTitle(msgs) {
    for (var i = 0; i < (msgs || []).length; i++) {
      if (msgs[i].role === 'user') return msgs[i].text.length > 38 ? msgs[i].text.slice(0, 38) + '…' : msgs[i].text;
    }
    return 'Nueva conversación';
  }
  function chatHist() { var c = ensureConv(); return c.msgs || []; }
  /* Siempre re-leer la lista (store re-parsea JSON) y guardar la lista entera */
  function saveHist(hist) {
    var id = curConvId();
    var l = convList();
    var c = null;
    /* Miniaturas de fotos: solo se conservan en los últimos 20 mensajes (ahorro de espacio) */
    var KEEPI = 20;
    for (var ii = 0; ii < hist.length - KEEPI; ii++) {
      if (hist[ii] && hist[ii].img) { delete hist[ii].img; }
    }
    for (var i = 0; i < l.length; i++) if (l[i].id === id) { c = l[i]; break; }
    if (!c) {
      c = { id: 'c' + Date.now(), title: 'Nueva conversación', ts: Date.now(), msgs: [] };
      l.unshift(c);
      store('nexo_curconv', c.id);
    }
    c.msgs = hist;
    c.ts = Date.now();
    if ((!c.title || c.title === 'Nueva conversación') && hist.length) c.title = convTitle(hist);
    saveConvList(l);
  }

  /* ================= SEGURIDAD: claves cifradas =================
     AES-GCM por proveedor; la llave vive en IndexedDB y no se puede exportar.
     En localStorage solo queda texto cifrado. Si el WebView no soporta
     WebCrypto/IndexedDB, se conserva el comportamiento anterior. */
  var Sec = (function () {
    var ok = !!(window.crypto && window.crypto.subtle && window.indexedDB && window.TextEncoder && window.TextDecoder);
    var kp = null;
    function idb() {
      return new Promise(function (res, rej) {
        var r = indexedDB.open('kiu_sec', 1);
        r.onupgradeneeded = function () { r.result.createObjectStore('k'); };
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { rej(r.error); };
      });
    }
    function getKey() {
      if (kp) return kp;
      kp = idb().then(function (db) {
        return new Promise(function (res, rej) {
          var g = db.transaction('k', 'readonly').objectStore('k').get('main');
          g.onerror = function () { rej(g.error); };
          g.onsuccess = function () {
            if (g.result) { res(g.result); return; }
            crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']).then(function (k) {
              var tx = db.transaction('k', 'readwrite');
              tx.objectStore('k').put(k, 'main');
              tx.oncomplete = function () { res(k); };
              tx.onerror = function () { rej(tx.error); };
            }, rej);
          };
        });
      });
      kp.catch(function () { kp = null; });
      return kp;
    }
    function b64(buf) { var a = new Uint8Array(buf), s = ''; for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); }
    function unb64(t) { var s = atob(t), a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
    /* v1.7.0: si el puente Android tiene Keystore, tiene prioridad (llave
       guardada en el hardware, imposible de extraer). WebCrypto = respaldo. */
    function ksEnc(text) {
      if (BR && BR.encSec) {
        try { var e = BR.encSec(String(text)); if (e) return Promise.resolve(e); } catch (e2) { }
      }
      return null;
    }
    function ksDec(t) {
      if (BR && BR.decSec) {
        try { var d = BR.decSec(String(t)); if (d) return Promise.resolve(d); } catch (e2) { }
      }
      return null;
    }
    return {
      ok: ok,
      ks: !!(BR && BR.encSec && BR.decSec),
      enc: function (text) {
        var via = ksEnc(text);
        if (via) return via;
        return getKey().then(function (k) {
          var iv = crypto.getRandomValues(new Uint8Array(12));
          return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, k, new TextEncoder().encode(text)).then(function (ct) {
            var out = new Uint8Array(12 + ct.byteLength); out.set(iv, 0); out.set(new Uint8Array(ct), 12);
            return b64(out);
          });
        });
      },
      dec: function (t) {
        var via = ksDec(t);
        if (via) return via;
        return getKey().then(function (k) {
          var raw = unb64(t);
          return crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, k, raw.slice(12)).then(function (pt) {
            return new TextDecoder().decode(pt);
          });
        });
      }
    };
  })();

  /* ================= PROVEEDORES ================= */
  var PROV = [
    { id: 'openai', name: 'OpenAI', url: 'https://api.openai.com/v1', model: 'gpt-4o-mini', color: '#10A37F', letter: 'O', free: false, local: false, keyUrl: 'https://platform.openai.com/api-keys', desc: 'GPT y toda la familia OpenAI', cap: ['chat', 'code', 'reason', 'vision', 'voice'] },
    { id: 'gemini', name: 'Gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.0-flash', color: '#4285F4', letter: 'G', free: true, local: false, keyUrl: 'https://aistudio.google.com/app/apikey', desc: 'Google AI Studio · capa gratuita', cap: ['chat', 'reason', 'vision', 'fast', 'voice'] },
    { id: 'groq', name: 'Groq', url: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', color: '#F55036', letter: 'G', free: true, local: false, keyUrl: 'https://console.groq.com/keys', desc: 'Llama 3.3 a velocidad extrema', cap: ['chat', 'fast', 'voice', 'code', 'reason'] },
    { id: 'nvidia', name: 'NVIDIA', url: 'https://integrate.api.nvidia.com/v1', model: 'meta/llama-3.3-70b-instruct', color: '#76B900', letter: 'N', free: true, local: false, keyUrl: 'https://build.nvidia.com/settings/api-keys', desc: 'NIM · cientos de modelos con créditos gratis', cap: ['chat', 'code', 'reason', 'vision', 'fast'] },
    { id: 'deepseek', name: 'DeepSeek', url: 'https://api.deepseek.com/v1', model: 'deepseek-chat', color: '#5A7CFF', letter: 'D', free: false, local: false, keyUrl: 'https://platform.deepseek.com/api_keys', desc: 'Razonamiento barato y potente', cap: ['chat', 'code', 'reason'] },
    { id: 'openrouter', name: 'OpenRouter', url: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini', color: '#8B5CF6', letter: 'OR', free: true, local: false, keyUrl: 'https://openrouter.ai/keys', desc: 'Cientos de modelos · hay gratis', cap: ['chat', 'code', 'reason', 'vision', 'fast'] },
    { id: 'kimi', name: 'Kimi', url: 'https://api.moonshot.ai/v1', model: 'moonshot-v1-8k', color: '#0FA895', letter: 'K', free: false, local: false, keyUrl: 'https://platform.moonshot.ai/console/api-keys', desc: 'Moonshot AI · contexto largo', cap: ['chat', 'code'] },
    { id: 'ollama', name: 'Ollama', url: 'http://localhost:11434/v1', model: 'llama3.2', color: '#CBD5E1', letter: 'O', free: true, local: true, keyUrl: '', desc: 'IA 100% en tu teléfono o PC', cap: ['chat', 'code', 'reason', 'fast', 'vision'] },
    { id: 'lmstudio', name: 'LM Studio', url: 'http://192.168.1.10:1234/v1', model: 'local-model', color: '#22D3EE', letter: 'L', free: true, local: true, keyUrl: '', desc: 'Tu PC como servidor de modelos', cap: ['chat', 'code', 'reason', 'fast'] },
    { id: 'otro', name: 'Otro / propia', url: '', model: '', color: '#64748B', letter: '+', free: false, local: false, keyUrl: '', desc: 'Cualquier servicio estilo OpenAI', custom: true, cap: ['chat', 'code', 'reason'] }
  ];
  function provDef(id) {
    for (var i = 0; i < PROV.length; i++) if (PROV[i].id === id) return PROV[i];
    return PROV[0];
  }

  /* ================= ESTADO ================= */
  var S = store('nexo_settings') || {
    name: '', mode: 'hybrid',
    apiUrl: '', apiKey: '', apiModel: '',
    voiceOn: true, rate: 1, conv: true, voiceName: '', pitch: 1,
    /* v2.9.1: que el MODELO elija herramientas. Costaba una generación extra por
       mensaje, por eso estaba apagado. v2.12.0: se enciende por defecto PERO con
       compuerta (App.agentGate): solo se consulta al modelo cuando el mensaje parece
       una orden. Preguntas, pedidos de texto y mensajes largos van directo a
       responder, sin esa generación extra. Kiu igual prueba primero cerebro y ReAct
       (gratis). */
    agentOn: true,
    agentConfirm: false,   /* v2.13.1: preguntar antes de ejecutar acciones con efecto */
    /* v2.14.6 · El pie "(motor interno · modelo · 6,3 tok/s)" al final de cada
       respuesta era ruido: el usuario no lo pidió y ocupaba media pantalla.
       Ahora está APAGADO por defecto y se enciende en Ajustes → Motor local
       cuando uno quiere ver qué motor respondió. */
    detalles: false,
    prov: {},
    persona: 'normal', personaX: '', temp: 0.7, maxTok: 700,
    acc: '', chatFs: 'm',
    lang: 'es',
    thermal: true
  };
  if (typeof S.conv === 'undefined') S.conv = true;
  if (typeof S.pitch !== 'number') S.pitch = 1;
  if (typeof S.rate !== 'number') S.rate = 1;
  if (typeof S.temp !== 'number') S.temp = 0.7;
  if ([350, 700, 1200].indexOf(S.maxTok) < 0) S.maxTok = 700;
  if (typeof S.persona !== 'string' || !PERSONAS[S.persona]) S.persona = 'normal';
  if (typeof S.personaX !== 'string') S.personaX = '';
  if (typeof S.acc !== 'string') S.acc = '';
  if (['s', 'm', 'l'].indexOf(S.chatFs) < 0) S.chatFs = 'm';
  /* v2.12.0: migración segura. El valor predeterminado para instalaciones nuevas
     ya está definido arriba; no sobrescribir un false guardado por el usuario. */
  if (!S._agentGateV2) { S._agentGateV2 = 1; }
  if (S.mode === 'api' && !S.prov) S.mode = 'hybrid';
  if (!S.prov) S.prov = {};
  /* Motor local v1.6.3: servidor estilo OpenAI en la red (LM Studio / Ollama / llama.cpp) */
  if (!S.loc || typeof S.loc !== 'object') S.loc = {};
  if (typeof S.loc.url !== 'string') S.loc.url = '';
  if (typeof S.loc.model !== 'string') S.loc.model = '';
  if (typeof S.loc.visModel !== 'string') S.loc.visModel = '';
  if (S.loc.prof !== 'qwen' && S.loc.prof !== 'deep' && S.loc.prof !== 'libre') S.loc.prof = 'qwen';
  if (typeof S.loc.visOn !== 'boolean') S.loc.visOn = false;
  if (Object.prototype.toString.call(S.loc.models) !== '[object Array]') S.loc.models = [];
  if (typeof S.loc.ok !== 'boolean') S.loc.ok = false;
  if (typeof S.loc.latency !== 'number') S.loc.latency = 0;
  if (typeof S.loc.err !== 'string') S.loc.err = '';
  /* Hereda lo que ya hubiera configurado el proveedor Ollama */
  (function locMigrate() {
    var o = S.prov && S.prov.ollama;
    if (!S.loc.url && o && o.url) S.loc.url = o.url;
    if (!S.loc.model && o && o.model && o.model !== 'llama3.2') S.loc.model = o.model;
  })();
  /* ===== v1.7.0: motor interno + descargas + saludo + enlaces ===== */
  if (!S.kiu || typeof S.kiu !== 'object') S.kiu = {};
  if (typeof S.kiu.path !== 'string') S.kiu.path = '';
  if (typeof S.kiu.name !== 'string') S.kiu.name = '';
  if (typeof S.kiu.ok !== 'boolean') S.kiu.ok = false;
  if (typeof S.kiu.auto !== 'boolean') S.kiu.auto = true;
  if (!S.dl || typeof S.dl !== 'object') S.dl = {};
  if (!S.dl.done || typeof S.dl.done !== 'object') S.dl.done = {};
  /* ===== v1.8.0: orquestador multi-modelo + filtro de catálogo ===== */
  if (!S.router || typeof S.router !== 'object') S.router = { on: true, fast: 'auto', brain: 'auto', vision: 'auto', kiuFast: '', kiuBrain: '' };
  if (typeof S.router.on !== 'boolean') S.router.on = true;
  if (typeof S.router.fast !== 'string') S.router.fast = 'auto';
  if (typeof S.router.brain !== 'string') S.router.brain = 'auto';
  if (typeof S.router.vision !== 'string') S.router.vision = 'auto';
  if (typeof S.router.kiuFast !== 'string') S.router.kiuFast = '';
  if (typeof S.router.kiuBrain !== 'string') S.router.kiuBrain = '';
  /* v2.1: modelo local preferido para fotos + ajuste fino visible al arrancar
     (el usuario pidió ver siempre las opciones de API y poder elegir Teléfono en visión) */
  if (typeof S.router.kiuVis !== 'string') S.router.kiuVis = '';
  if (typeof S.router.adv === 'undefined') S.router.adv = true;
  /* v1.9.1: default del catálogo = compatibles con este teléfono.
     Migración ÚNICA: si venía de una versión anterior sin elegir filtro, va a compat.
     Después la elección del usuario (Todos/Texto/…) se respeta para siempre. */
  if (!S.mfMig191) { S.mfMig191 = true; S.mfilter = 'compat'; }
  if (typeof S.greetOn !== 'boolean') S.greetOn = true;
  if (typeof S.linksInApp !== 'boolean') S.linksInApp = true;
  /* v2.5.0 (sección 4): skills instalables + resumen matutino */
  if (!S.skills || typeof S.skills !== 'object') S.skills = {};
  if (!S.morning || typeof S.morning !== 'object') S.morning = { on: false, time: '08:00' };
  if (typeof S.morning.on !== 'boolean') S.morning.on = false;
  if (typeof S.morning.time !== 'string' || !/^\d{1,2}:\d{2}$/.test(S.morning.time)) S.morning.time = '08:00';
  /* Migración desde la v1.4.x: clave única → proveedor */
  (function migrate() {
    var done = store('nexo_prov_migrated');
    if (done || !S.apiKey || !S.apiUrl) return;
    var hit = null;
    for (var i = 0; i < PROV.length; i++) {
      var u = PROV[i].url;
      if (u && S.apiUrl.indexOf(u.replace(/^https?:\/\//, '').split('/')[0]) >= 0) { hit = PROV[i].id; break; }
    }
    var pid = hit || 'otro';
    if (!S.prov[pid]) S.prov[pid] = {};
    S.prov[pid].url = S.prov[pid].url || S.apiUrl;
    S.prov[pid].key = S.prov[pid].key || S.apiKey;
    S.prov[pid].model = S.prov[pid].model || S.apiModel;
    S.prov[pid].on = true;
    S.prov[pid].last4 = (S.apiKey || '').slice(-4);
    store('nexo_prov_migrated', true);
  })();
  function pstate(id) {
    if (!S.prov[id]) {
      var d = provDef(id);
      S.prov[id] = { on: false, url: d.url, key: '', model: d.model, ok: false, latency: 0, last4: '' };
    }
    if (!S.prov[id].url && provDef(id).url && !provDef(id).custom) S.prov[id].url = provDef(id).url;
    if (!S.prov[id].model && provDef(id).model && !provDef(id).custom) S.prov[id].model = provDef(id).model;
    if (typeof S.prov[id].last4 !== 'string') S.prov[id].last4 = '';
    return S.prov[id];
  }

  var lastKeys = {}, keyOK = true;
  /* v2.3.0 (sección 2): ¿hay clave para este proveedor? Mira el estado y la
     bóveda Java (KiuVault) — la clave real no se guarda más en el WebView. */
  function hasKey(pid) {
    var st = pstate(pid);
    if (st.key) return true;
    return !!(window.KiuVault && KiuVault.ok && KiuVault.has(pid));
  }
  function stripCopy() {
    var copy = {};
    for (var k in S) if (Object.prototype.hasOwnProperty.call(S, k)) copy[k] = S[k];
    copy.prov = {};
    for (var id2 in S.prov) {
      if (!Object.prototype.hasOwnProperty.call(S.prov, id2)) continue;
      var p = S.prov[id2], c2 = {};
      for (var k2 in p) if (Object.prototype.hasOwnProperty.call(p, k2)) c2[k2] = p[k2];
      if (Sec.ok && keyOK) c2.key = '';
      copy.prov[id2] = c2;
    }
    return copy;
  }
  function saveS() {
    store('nexo_settings', stripCopy());
  }
  /* Guarda la clave de un proveedor: v2.3.0 la manda a la bóveda Java (Keystore);
     si no hay puente, cifra local con WebCrypto como antes. Solo los últimos 4
     quedan visibles. */
  function setProvKey(pid, val) {
    var st = pstate(pid);
    val = (val || '').trim();
    st.key = val;
    if (!val) {
      st.last4 = '';
      lastKeys[pid] = null;
      try { localStorage.removeItem('kiu_key_' + pid); } catch (e) { }
      if (window.KiuVault && KiuVault.ok) { try { KiuVault.del(pid); } catch (e6) { } }
      saveS();
      return;
    }
    if (window.KiuVault && KiuVault.ok) {
      var okV = false;
      try { okV = KiuVault.set(pid, val) !== false; } catch (e7) { okV = false; }
      if (okV) {
        st.key = '';
        st.last4 = val.slice(-4);
        lastKeys[pid] = null;
        keyOK = true;
        saveS();
        if (App && (App.current === 'models' || App.current === 'api')) App.renderProviders();
        return;
      }
      /* v2.11.10: la bóveda no la pudo guardar: la clave NO se borra de la memoria (antes se perdía) */
      st.last4 = val.slice(-4);
      saveS();
      if (App && App.toast) App.toast('No pude guardarla en el almacén seguro; queda solo mientras Kiu esté abierto');
      return;
    }
    if (!Sec.ok) { st.last4 = val.slice(-4); saveS(); return; }
    lastKeys[pid] = val;
    Sec.enc(val).then(function (v) {
      store('kiu_key_' + pid, v);
      st.last4 = val.slice(-4);
      st.key = '';
      keyOK = true;
      saveS();
      if (App && (App.current === 'models' || App.current === 'api')) App.renderProviders();
    }).catch(function () { keyOK = false; });
  }
  function loadKeys() {
    /* v2.3.0: migración única de claves viejas (WebCrypto en localStorage) hacia la
       bóveda Java; con la bóveda no hace falta “cargar” nada: el header sale con
       placeholder y Java inyecta la clave real. */
    if (window.KiuVault && KiuVault.ok) {
      for (var vi = 0; vi < PROV.length; vi++) {
        (function (vid) {
          var st0 = pstate(vid);
          /* clave en claro heredada de un arranque sin WebCrypto: re-bóvedala */
          if (st0.key) { setProvKey(vid, st0.key); return; }
          var encKey = store('kiu_key_' + vid);
          if (!encKey) return;
          if (KiuVault.has(vid)) { try { localStorage.removeItem('kiu_key_' + vid); } catch (eV0) { } return; }
          if (!Sec.ok) return;
          Sec.dec(encKey).then(function (k) {
            if (k) { try { KiuVault.set(vid, k); } catch (eV1) { } }
            try { localStorage.removeItem('kiu_key_' + vid); } catch (eV2) { }
          }).catch(function () { });
        })(PROV[vi].id);
      }
      return;
    }
    if (!Sec.ok) return;
    for (var i = 0; i < PROV.length; i++) {
      (function (id) {
        var encKey = store('kiu_key_' + id);
        var st = pstate(id);
        if (st.key) { setProvKey(id, st.key); return; }
        if (encKey) {
          Sec.dec(encKey).then(function (k) {
            st.key = k; lastKeys[id] = k; keyOK = true;
            if (window.KiuApp) KiuApp.renderStatus();
          }).catch(function () { });
        }
      })(PROV[i].id);
    }
  }

  /* exports del módulo (cross-módulo vía window) */
  window.PERSONAS = PERSONAS;
  window.convList = convList;
  window.saveConvList = saveConvList;
  window.curConvId = curConvId;
  window.convById = convById;
  window.ensureConv = ensureConv;
  window.convTitle = convTitle;
  window.chatHist = chatHist;
  window.saveHist = saveHist;
  window.Sec = Sec;
  window.PROV = PROV;
  window.provDef = provDef;
  window.S = S;
  window.pstate = pstate;
  window.hasKey = hasKey;
  window.stripCopy = stripCopy;
  window.saveS = saveS;
  window.setProvKey = setProvKey;
  window.loadKeys = loadKeys;
  window.lastKeys = lastKeys;
})();
