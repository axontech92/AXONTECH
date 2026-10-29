/* app/app-ui.js — módulo de app.js (tanda 4 · sección 3-a). UI completa: navegación, chat, modelos, ajustes, voz, memoria (arranca con App.init).
 * Cargado como script clásico en orden por index.html; los símbolos
 * compartidos viven en window para que los módulos se lean entre sí
 * igual que dentro del app.js original. */
(function () {
  'use strict';

  /* ================= MEMORIA (API pública) =================
     v2.14.2: la memoria vive ahora en su propio módulo (js/app/memoria.js),
     con búsqueda por palabras y un resumen para el agente. Acá no queda la
     definición: queda el ENGANCHE con la UI —registrar la actividad y refrescar
     la pantalla de Memoria cuando algo cambia— para que el módulo de datos no
     sepa qué es un toast. */
  var App;

  /* ================= SISTEMA EN VIVO (datos reales del teléfono) ================= */
  var Sys = {
    d: null,
    refresh: function () {
      var d = null;
      if (BR && BR.sysInfo) {
        try {
          d = JSON.parse(BR.sysInfo() || '{}');
        } catch (e) { d = null; }
      }
      if (!d) {
        d = { cores: (navigator.hardwareConcurrency || 0), ramTotal: 0, ramAvail: 0, diskTotal: 0, diskFree: 0, model: '', os: '', bat: 0, charging: false, temp: 0 };
        if (navigator.deviceMemory) d.ramApprox = navigator.deviceMemory;
      }
      this.d = d;
      /* Batería web como respaldo si el puente no la trajo */
      if (!d.bat && navigator.getBattery) {
        navigator.getBattery().then(function (b) {
          if (!Sys.d) return;
          Sys.d.bat = Math.round(b.level * 100);
          Sys.d.charging = b.charging;
          if (App.current === 'home') App.renderSys();
        }).catch(function () { });
      }
      if (App.current === 'home') App.renderSys();
      if (document.getElementById('brain-sub')) App.renderRealSubs();
    }
  };
  /* v2.7.5: motor.js (otro script) usa Sys en pickModel/best: tiene que vivir en window */
  window.Sys = Sys;

  /* ================= v2.8.0: ESTADOS DEL AVATAR =================
     Todo el estado del bot pasa por KiuState (js/kiu-estados.js), por capas y con
     prioridad. Antes esta capa y kiu-avatar-boot.js peleaban por el mismo estado:
     se pisaban, quedaban timers sueltos y el reposo se quedaba viejo. Ahora cada
     lugar que CAUSA una acción es el que avisa. */
  function KS() { return window.KiuState || null; }
  function stSet(layer, state, ms) { var k = KS(); if (k) k.set(layer, state, ms); }
  function stClear(layer) { var k = KS(); if (k) k.clear(layer); }
  function stFlash(state, ms) { var k = KS(); if (k) k.flash('flash', state, ms || 2200); }
  function stErr(state, ms) { var k = KS(); if (k) k.warn(state, ms || 2800); }
  /* 'Proveedor en pausa' tiene capa propia (65, arriba de 'Enrutando' 60): si fuera
     un flash común, 'Enrutando' —que está activo justo mientras se prueba el
     siguiente modelo— lo taparía y el usuario nunca vería el aviso. */
  function stPausa(ms) { var k = KS(); if (k) k.flash('pausa', 'Proveedor en pausa', ms || 2400); }
  /* 'Enrutando' siempre con red de seguridad (2 min): si la promesa del proveedor o
     el fetch de la web nunca resuelve, el estado se cae solo en vez de dejar al bot
     clavado. El temporizador lo maneja el controlador, no un setTimeout suelto. */
  function stRuta() { var k = KS(); if (k) k.set('ruta', 'Enrutando', 120000); }

  /* ================= USO DE HOY ================= */
  function usage() {
    var u = store('nexo_usage');
    var today = new Date().toDateString();
    if (!u || u.date !== today) u = { date: today, mensajes: 0, herramientas: 0, notas: 0 };
    return u;
  }
    /* ================= APP ================= */
  App = {
    current: 'home',
    memTab: 'recuerdos',
    biblioCat: 'todas',
    provFilter: 'todos',
    srvModels: {},
    /* v2.11.9 · PROBADOR DE MODELOS EN LA NUBE: estado de cada escaneo en curso */
    scan: {},
    /* ids que no son de chat (embeddings, audio, imagen, seguridad…): no se prueban */
    NOCHAT: /embed|rerank|whisper|tts|speech|audio|transcri|guard|moderat|safety|dall-e|imagen|diffusion|flux|sdxl|stable-|clip|reward|retriev|bge-|riva|cosmos|genmol|molmim|fourcast|deplot|paddleocr|parakeet|canary|\bocr\b|video|sora|veo|aqa|-tts|-asr/i,
    sysCache: null,
    _apiOpen: false,

    init: function () {
      var self = this;
      paintIcons(document);
      if (window.KiuAvatar) KiuAvatar.mount();
      loadKeys();
      this.applyTheme();
      ensureConv();
      document.addEventListener('click', function (e) { if (e.target && e.target.id === 'typing-cancel') App.cancelApi(); });
      /* Callbacks de voz: manejadores estables (Java los dispara en cualquier momento) */
      window.nexoOnVoice = function (text) { App.handleVoice(text); };
      window.nexoVoiceError = function (err) {
        if (err === 'unavailable') App.voiceError('El micrófono no está disponible ahora');
        else if (err === 'no_permission') App.voiceError('Falta permiso de micrófono');
        else if (err === 'no_match') App.voiceError('No te entendí. Probá de nuevo, más cerca del micrófono.');
        else if (/^err_\d+$/.test(String(err))) { var ec = parseInt(String(err).slice(4), 10); App.voiceError(App.vozErrTexto(ec) + ' [código ' + ec + ']'); }
        else App.voiceError(null);
      };
      /* v2.8.1: nexoListenStart marcaba la UI pero no App.voiceBusy, así que el JS
         creía que el micrófono estaba libre cuando en realidad lo tenía abierto el
         bucle de Java (palabra de activación o fin del TTS). Con voz apagada eso
         hacía que el rearme de la App chocara contra un reconocedor vivo. */
      window.nexoListenStart = function () { App.voiceBusy = true; App.showListening(true); };
      window.nexoListenEnd = function () { App.voiceBusy = false; App.showListening(false); };
      window.nexoVoicePartial = function (text) {
        App.partialVoice(text);
      };
      /* v2.11.0: nivel del micrófono (dB del reconocedor) → barras y brillo de Kiu */
      window.nexoVoiceLevel = function (db) { App.vpLevel(db); };
      window.nexoVoiceRms = function (db) {
        if (!isFinite(Number(db))) return;
        if (window.KiuDiagVoz) KiuDiagVoz.lastRmsDb = Number(db);
        var meter = document.getElementById('diag-voice-rms-value');
        if (meter) meter.textContent = Number(db).toFixed(1) + ' dBFS';
      };
      /* v2.8.0: el TTS avisa cuándo empieza y cuándo termina de verdad. Antes se
         calculaba la duración por el largo del texto (Math.min(45000, 3500 + len*70))
         y el bot cortaba o se Pasaba. Ahora manda el evento. */
      window.nexoTtsStart = function () { clearTimeout(App._avT); stSet('voz', 'Hablando'); };
      /* v2.11.13: «chao» / «cuelga» dichos mientras Kiu habla (los detecta el servicio) */
      window.nexoEndCall = function () { try { App.endCall(); } catch (e) { } };
      window.nexoTtsDone = function () {
        try { if (window.KiuSentenceTTS && KiuSentenceTTS.onDone()) return; } catch (eQueueTts) { }
        clearTimeout(App._avT);
        var kk = KS(); if (kk && kk.layer('voz') === 'Hablando') kk.clear('voz');
      };
      window.nexoWakeHit = function () {
        stSet('voz', 'Escuchando');
        App.toast('Kiu te escucha...');
      };
      window.nexoWakeCmd = function (text) {
        stSet('voz', 'Escuchando');
        App._convLive = Date.now();
        if (!App.inCall()) App.go('chat');
        App.sendMsg(text);
      };
      window.nexoWakeState = function (on) {
        S.wake = !!on; saveS();
        /* 'Palabra de activación' es un estado pegado mientras la wake word esté
           viva, no un aviso de 4 s. */
        stSet('voz', on ? 'Palabra de activación' : null);
        var tg = document.getElementById('tg-wake');
        if (tg) tg.classList.toggle('on', !!on);
        App.toast(on ? 'Despertar por voz activo: decí «Kiu»' : 'Despertar por voz apagado');
      };
      /* v2.8.1: si el motor no pudo arrancar (sin modelo, micro ocupado, sin servicio
         de voz del sistema) hay que decirlo. Antes el toast decía "activo" y después
         la app se quedaba en silencio sin explicación. */
      window.nexoWakeError = function (msg) {
        S.wake = false; saveS();
        stSet('voz', null);
        var tg = document.getElementById('tg-wake');
        if (tg) tg.classList.remove('on');
        stErr('Error', 3000);
        App.toast('No pude activar el despertar por voz: ' + (msg || 'motivo desconocido'));
      };      window.nexoPerm = function (what, ok) {
        if (what === 'contacts') {
          App.toast(ok ? 'Permiso de contactos concedido' : 'Sin permiso de contactos');
        } else if (what === 'calendar') {
          App.toast(ok ? 'Permiso de agenda concedido: ya sé qué tenés'
                       : 'Sin permiso de agenda: no puedo leer tus eventos');
        } else if (what === 'sms') {
          App.toast(ok ? 'Permiso de SMS concedido: volvé a preguntarme' : 'Sin permiso de SMS: no puedo leer tus mensajes');
        } else if (what === 'location') {
          App.toast(ok ? 'Permiso de ubicación concedido: volvé a preguntarme' : 'Sin permiso de ubicación: decime la ciudad');
        }
      };
      window.nexoTimerDone = function (label) {
        stFlash('Disparado', 3200);
        App.toast(label);
        App.speak(label);
      };
      /* Sincronizar ajustes nativos + estado del despertar con Android */
      setTimeout(function () {
        try {
          bridge('setRate', [S.rate || 1]);
          bridge('setPitch', [S.pitch || 1]);
          if (S.voiceName) bridge('setVoiceName', [S.voiceName]);
          bridge('setHandsFree', [S.conv !== false]);
          bridge('pageReady');
        } catch (e) { }
        var on = false;
        try { on = !!(BR && BR.wakeState && BR.wakeState()); } catch (e) { }
        if (S.wake && !on && BR && BR.startWake) { bridge('startWake'); on = true; }
        S.wake = on; saveS();
        var tg = document.getElementById('tg-wake');
        if (tg) tg.classList.toggle('on', on);
      }, 700);

      this.bindNav();
      this.bindModelTabs();
      this.bindHome();
      this.bindChat();
      this.bindMemory();
      this.bindSettings();
      this.bindApi();
      this.wireProviders();
      this.bindBiblio();
      this.bindModels();
      this.bindBrowser();
      /* v1.7.0: colgar — corta escucha y voz al instante */
      var hc = document.getElementById('hang-chip');
      if (hc) hc.addEventListener('click', function () { self.hangUp(); });
      var vph = document.getElementById('vp-hang');
      if (vph) vph.addEventListener('click', function () { self.hangUp(); });
      /* v2.11.0: «Escribir» corta la escucha y deja el cursor en el chat */
      var bav = document.getElementById('btn-asist-voz');
      if (bav) bav.addEventListener('click', function () { self.asistenteVoz(); });
      var best = document.getElementById('btn-estado');
      if (best) best.addEventListener('click', function () { self.verEstado(); });
      var bup = document.getElementById('btn-upd');
      if (bup) bup.addEventListener('click', function () { self.buscarUpdate(true); });
      S.upd = S.upd || {};
      if (S.upd.auto === undefined) { S.upd.auto = true; saveS(); } /* v2.11.8: antes nacía apagado y nunca avisaba */
      var tgb = document.getElementById('tg-barge');
      if (tgb) {
        if (S.barge === undefined) S.barge = true;
        tgb.classList.toggle('on', !!S.barge);
        bridge('setBargeIn', [!!S.barge]);
        tgb.addEventListener('click', function () {
          S.barge = !S.barge; saveS();
          tgb.classList.toggle('on', !!S.barge);
          bridge('setBargeIn', [!!S.barge]);
        });
      }
      /* v2.11.11 · GUARDIÁN DE LA CONVERSACIÓN. Si Kiu contestó sin voz, con error, o el micrófono no se
         reabrió, el ciclo moría y había que volver a tocar el micro. Si seguimos «en llamada» (hablaste o
         Kiu contestó en los últimos 45 s) y pasan 3 s sin escuchar, hablar ni pensar, se vuelve a escuchar.
         El tiempo NO se renueva solo: si no decís nada, la conversación termina. */
      setInterval(function () {
        try {
          if (S.conv === false || !self._convLive || document.hidden) return;
          if (Date.now() - self._convLive > 45000) { self._convLive = 0; return; }
          var kk = KS(), sv = (kk && kk.get) ? kk.get() : '';
          var busy = self.voiceBusy || (window.Kiu && Kiu.pending) || sv === 'Hablando' || sv === 'Escuchando' || sv === 'Generando' || sv === 'Pensando';
          if (busy) { self._kIdle = 0; return; }
          self._kIdle = (self._kIdle || 0) + 1;
          if (self._kIdle >= 3) { self._kIdle = 0; self.startVoice(); }
        } catch (e) { }
      }, 1000);
      /* tocar la pantalla de llamada mientras Kiu habla = callarlo y empezar a escuchar */
      var vpp = document.getElementById('voice-pulse');
      if (vpp) {
        vpp.addEventListener('click', function (e) {
          if (e.target.closest && e.target.closest('button')) return;
          if (vpp.getAttribute('data-st') === 'speak') { bridge('stopSpeak'); setTimeout(function () { bridge('listen'); }, 250); }
        });
      }
      var tgu = document.getElementById('tg-upd');
      if (tgu) {
        tgu.classList.toggle('on', !!(S.upd && S.upd.auto));
        tgu.addEventListener('click', function () {
          S.upd = S.upd || {}; S.upd.auto = !S.upd.auto; saveS();
          tgu.classList.toggle('on', !!S.upd.auto);
          if (S.upd.auto) self.buscarUpdate(false);
        });
      }
      setTimeout(function () { self.asistenteAuto(); }, 5000);
      setTimeout(function () { self.buscarUpdate(false); }, 9000);
      var drc = document.getElementById('dev-reco');
      if (drc) drc.addEventListener('click', function () { self.recomendar(); });
      var vpw = document.getElementById('vp-write');
      if (vpw) vpw.addEventListener('click', function () {
        self.stopVoice();
        self.go('chat');
        var ci = document.getElementById('chat-input'); if (ci) ci.focus();
      });
      var bd = document.getElementById('btn-diag');
      if (bd) bd.addEventListener('click', function () { self.diag(); });
      /* v2.9.3: leer la versión real del paquete apenas arranca, para que el
         rótulo de arriba diga la verdad incluso antes de que se toque nada. */
      this.verReal();
      var bdv = document.getElementById('btn-diag-voz');
      if (bdv) bdv.addEventListener('click', function () { self.renderDiagVoz(); });
      /* El botón de instalar se crea en cada render, así que se engancha por
         DELEGACIÓN en el contenedor y no por id: no hay que volver a buscarlo y no
         se acumulan listeners si el usuario abre y cierra el diagnóstico varias
         veces (que es lo que pasaba con cualquier forma de engancharlo directo). */
      var dvb = document.getElementById('diag-voz-box');
      if (dvb) {
        dvb.addEventListener('click', function (ev) {
          var tgt = ev.target;
          if (tgt && tgt.id === 'btn-tts-set') { bridge('openSettings', ['tts']); return; }
          if (tgt && tgt.id === 'btn-rec-set') { bridge('openSettings', ['voiceinput']); return; }
          if (tgt && tgt.id === 'btn-mic-perm') {
            bridge('listen');   /* pide el permiso; al concederlo empieza a escuchar */
            setTimeout(function () { KiuDiagVoz.verReal(); self.renderDiagVoz(); }, 4000);
            return;
          }
          if (tgt && tgt.id === 'btn-ww-import') {
            KiuDiagVoz.importar(function () { self.renderDiagVoz(); });
            return;
          }
          var b = tgt && tgt.id === 'btn-ww-install' ? tgt : null;
          if (!b) { return; }
          b.disabled = true;
          b.textContent = 'Bajando…';
          KiuDiagVoz.instalar(function () { self.renderDiagVoz(); });
        });
      }
      this.renderStatus();
      this.renderHome();
      this.renderChat();
      this.renderChips();
      this.renderToolsPanel();
      this.renderBiblio();
      this.renderCx();
      this.refreshMem();
      this.renderProviders();
      this.bindFlashlight();
      this.bindMsgActions();
      var tipEl = document.getElementById('tip-text');
      if (tipEl) tipEl.textContent = KiuBrain.tip();
      document.getElementById('chat-voice-toggle').classList.toggle('on', S.voiceOn);
      document.getElementById('chat-voice-toggle').innerHTML = icon('speaker', 18);
      var ctg = document.getElementById('chat-conv-toggle');
      if (ctg) { ctg.innerHTML = icon('wave', 18); ctg.classList.toggle('on', S.conv !== false); }
      var stg = document.getElementById('tg-conv');
      if (stg) stg.classList.toggle('on', S.conv !== false);
      var ttg = document.getElementById('chat-tools-toggle');
      if (ttg) ttg.innerHTML = icon('grid', 18);
      this.renderUsage();
      /* Sistema en vivo: primera lectura + refresco periódico */
      Sys.refresh();
      this.sysCache = Sys.d;
      setInterval(function () { Sys.refresh(); self.sysCache = Sys.d; }, 20000);
      /* Indicador de estado del chat */
      setInterval(function () { self.syncChatState(); }, 350);
      var self2 = this;
      setTimeout(function () { self2.syncReminders(); }, 900);
      /* Onboarding: primera vez, preguntamos el nombre */
      setTimeout(function () { self2.onboard(); }, 800);
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) { self2.syncReminders(); Sys.refresh(); self2.kiuReschedule(); self2.rutinasTick(); }
      });
      /* v2.18.0 · rutinas: un tick por minuto mientras la app vive, y uno al arrancar */
      setTimeout(function () { self2.rutinasTick(); }, 3000);
      setInterval(function () { self2.rutinasTick(); }, 60000);
      setTimeout(function () { self2.kiuReschedule(); }, 1400);
      /* v1.7.0: descargar lista real de modelos + auto-cargar motor interno */
      setTimeout(function () {
        Mod.sync(function () { App.renderModels(); Kiu.ensureLoaded(true); });
      }, 1200);
      /* v1.7.0: saludo por voz al entrar (buenas noches/tardes/días) */
      setTimeout(function () { self2.greet(); }, 1600);
      /* v2.8.0: avisos que llegan desde Java: una alarma disparada mientras la app
         está viva y las alarmas que Android restauró tras reiniciar/actualizar.
         Son los estados 'Disparado' y 'Reprogramado al reiniciar', que antes no
         los disparaba nadie. */
      window.nexoAlarmFired = function (title) {
        try { setTimeout(function () { self.rutinasTick(); }, 800); } catch (eRu) { }
        stFlash('Disparado', 3500);
        try { self.refreshMem(); } catch (eR) { }
        if (title) self.toast(title);
      };
      window.nexoRemindersRestored = function (n) {
        if (!n) return;
        stFlash('Reprogramado al reiniciar', 3200);
        try { self.syncReminders(); } catch (eS) { }
        self.toast('Restauré ' + n + ' alarma' + (n === 1 ? '' : 's') + ' que Android había borrado');
      };
      /* v2.8.0: el estado de reposo se calcula una vez con la verdad a la vista
         (motor disponible, modelos descargados, RAG) en vez de quedar en Inactivo
         y adivinarse. Los estados 'Motor no soportado', 'Usar nube/Ollama' y
         'Sin modelo' nunca se veían: acá se encienden. */
      setTimeout(function () { self2.avatarRest(); }, 900);
    },
    /* Estado de reposo del bot: qué puede hacer Kiu ahora mismo con este teléfono. */
    avatarRest: function () {
      var k = KS(); if (!k) return;
      var hasModel = false;
      try { for (var f in S.dl.done) if (Object.prototype.hasOwnProperty.call(S.dl.done, f)) { hasModel = true; break; } } catch (e) { }
      if (k.layer('rag') === null) k.set('rag', (window.RAG && RAG.on) ? 'RAG activo' : 'RAG apagado');
      if (Kiu.available() === false) {
        /* el teléfono no puede correr el motor interno: se avisa y se queda en la
           alternativa que sí sirve (nube u Ollama en la red) */
        k.flash('flash', 'Motor no soportado', 3200);
        k.set('rest', 'Usar nube/Ollama');
        return;
      }
      k.set('rest', hasModel ? 'Inactivo' : 'Sin modelo');
    },
    /* ---------- v1.7.0: saludo por voz al entrar ---------- */
    greet: function () {
      if (!S.greetOn) return;
      var last = store('nexo_greet') || 0;
      if (Date.now() - last < 20 * 60000) return;
      store('nexo_greet', Date.now());
      var h = new Date().getHours();
      var hi = h >= 6 && h < 13 ? 'Buenos días' : h >= 13 && h < 20 ? 'Buenas tardes' : 'Buenas noches';
      var who = S.name ? ', ' + S.name : '';
      var msg = hi + who + '. Soy Kiu. ¿Qué hacemos hoy? ¿En qué te puedo ayudar?';
      var el = document.getElementById('hero-hi');
      if (el) el.textContent = msg.split('. ').slice(0, 2).join('. ');
      stFlash('Respuesta lista', 3200);
      this.toast(msg);
      /* habla aunque la voz esté apagada: es la bienvenida. Se puede apagar en Ajustes → Voz */
      var clean = msg.replace(/\n+/g, '. ');
      if (!bridge('speak', [clean])) {
        try {
          var u = new SpeechSynthesisUtterance(clean);
          u.lang = 'es-AR';
          speechSynthesis.speak(u);
        } catch (e) { }
      }
    },
    /* v2.11.12 · ESTADO Y DIAGNÓSTICO: un informe único de voz, permisos, claves y modelos, con botón para
       copiarlo y mandármelo en vez de depender de capturas sueltas. */
    verEstado: function () {
      var self = this, J = {};
      try { J = JSON.parse(rawBridge('kiuStatus', []) || '{}') || {}; } catch (e) { J = {}; }
      var ok = function (b) { return b ? '✅' : '❌'; };
      var ago = function (s) { return s < 0 ? 'nunca' : (s < 90 ? s + ' s' : s < 5400 ? Math.round(s / 60) + ' min' : Math.round(s / 3600) + ' h') + ' atrás'; };
      var L = [];
      L.push('KIU ' + (J.version || '?') + ' · Android ' + (J.android || '?') + ' · ' + (J.device || ''));
      L.push('— VOZ —');
      L.push(ok(J.mic) + ' Permiso de micrófono');
      L.push(ok(J.sttAvail) + ' Servicio de reconocimiento de voz del teléfono');
      L.push('Reconocedor en uso: ' + (J.rec || 'todavía no se usó'));
      L.push('Último error de voz: ' + (J.errCode ? 'código ' + J.errCode + ' (' + self.vozErrTexto(J.errCode).slice(0, 70) + ') · ' + ago(J.errAgo) : 'ninguno'));
      L.push('Voz que habla: ' + (J.ttsVoice || 'todavía no se eligió') + (J.ttsErrAgo >= 0 ? ' · último fallo ' + ago(J.ttsErrAgo) : ''));
      L.push(ok(J.wakeSvc || J.voskRun) + ' Despertar por voz («Kiu») ' + (J.wakeSvc ? 'activo · motor de Google' : J.voskRun ? 'activo · motor local Vosk (no puede oír «chao» mientras habla)' : 'apagado'));
      L.push((J.voskModel ? '✅' : '➖') + ' Modelo de voz sin conexión ' + (J.voskModel ? 'instalado' : 'no instalado') + (J.offline ? ' · ' + J.offline : ''));
      L.push(ok(J.bargeIn) + ' Poder interrumpir a Kiu');
      L.push('— CLAVES Y RED —');
      L.push((J.crypto === 'keystore' ? '✅ Claves en el almacén seguro de Android' : J.crypto === 'respaldo' ? '⚠️ Claves en el respaldo local de la app (el almacén de Android falla en este teléfono)' : '❌ No se pueden guardar claves en este teléfono'));
      var ids = Object.keys(S.prov || {});
      ids.forEach(function (id) {
        var st = S.prov[id], d = null; try { d = provDef(id); } catch (e) { }
        if (!d || (!hasKey(id) && !st.on)) return;
        L.push((st.ok ? '✅ ' : hasKey(id) ? '⚠️ ' : '❌ ') + d.name + (hasKey(id) ? ' · clave ✓' : ' · sin clave') + (st.good && st.good.length ? ' · ' + st.good.length + ' modelos funcionan' : '') + (st.err ? ' · ' + st.err : '') + (st.on ? ' · activo' : ''));
      });
      L.push('— ACTUALIZACIÓN —');
      L.push(ok(J.installOk) + ' Permiso para instalar actualizaciones' + (J.installOk ? '' : ' (se pide al instalar)'));
      L.push(ok(J.notif) + ' Notificaciones');
      var txt = L.join('\n');
      var body = this.modal('Estado y diagnóstico',
        '<pre id="est-txt" style="white-space:pre-wrap;font:12.5px/1.55 ui-monospace,Menlo,monospace;margin:0 0 10px;max-height:52vh;overflow:auto">' + esc(txt) + '</pre>' +
        '<button class="btn-ghost full" id="est-copy" style="justify-content:center">Copiar informe</button>' +
        '<p class="set-hint small" style="margin:8px 0 0">No incluye claves ni datos personales. Copialo y pegalo en el chat con quien te ayuda.</p>');
      if (!body) return;
      body.querySelector('#est-copy').addEventListener('click', function () { self.copyText(txt); self.toast('Informe copiado'); });
    },
    /* v2.11.12: cierra ESTA charla (sin apagar el modo conversación de Ajustes) con un chau hablado */
    endCall: function () {
      this._convLive = 0;
      this.voiceBusy = false;
      this._voiceDriven = false;
      bridge('cancelListen');
      this.showListening(false, true);
      stClear('voz');
      if (S.voiceOn) {
        bridge('setHandsFree', [false]);               /* mientras dice chau, el micro no se reabre */
        this.speak('¡Dale! Acá estoy cuando me necesites.');
        setTimeout(function () { bridge('setHandsFree', [S.conv !== false]); }, 6000);
      } else {
        this.toast('Listo, hablamos 👋');
      }
    },
    /* ---------- v1.7.0: colgar (termina voz y conversación ya) ---------- */
    hangUp: function () {
      this._convLive = 0;
      this.voiceBusy = false;
      this._voiceDriven = false;
      bridge('cancelListen');
      bridge('stopSpeak');
      try { if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel(); } catch (e) { }
      if (S.conv) { S.conv = false; saveS(); bridge('setHandsFree', [false]);
        var a = document.getElementById('chat-conv-toggle'); if (a) a.classList.remove('on');
        var b = document.getElementById('tg-conv'); if (b) b.classList.remove('on');
      }
      this.showListening(false, true);
      stClear('voz');
      this.toast('Listo, corté la llamada');
    },
    onboard: function () {
      if (store('nexo_onb')) return;
      var self = this;
      var html =
        '<p class="set-hint" style="text-align:center;margin:2px 0 14px">Soy tu agente personal: funciono sin internet con mi cerebro local y puedo usar tu API cuando algo se me escape. Poné alarmas, recordatorios, linterna, lecturas reales del teléfono y mucho más.</p>' +
        '<label class="api-fields"><span style="color:var(--dim);font-size:12px;font-weight:600">¿Cómo te llamo?</span>' +
        '<input id="ob-name" placeholder="Tu nombre (opcional)"></label>' +
        '<button class="btn-primary full" id="ob-go">Empezar</button>';
      var body = this.modal('¡Hola! Soy Kiu', html);
      if (!body) return;
      setTimeout(function () { body.querySelector('#ob-name').focus(); }, 300);
      body.querySelector('#ob-go').addEventListener('click', function () {
        var v = body.querySelector('#ob-name').value.trim();
        if (v) self.setName(v);
        store('nexo_onb', 1);
        self.closeModal();
        self.toast(v ? '¡Dale, ' + v + '! Probá preguntarme la batería' : 'Listo, preguntame lo que quieras');
      });
    },

    /* ---------- Navegación ---------- */
    go: function (name) {
      /* v2.1: el botón «Volver» de Proveedores regresa a la pantalla desde la que entró */
      /* v2.10.1: «Proveedores» ya no es una pantalla aparte: es la pestaña Nube de
         Modelos. Todo lo que apuntaba a 'api' sigue funcionando y cae ahí. */
      if (name === 'api') { name = 'models'; this._mtab = 'nube'; }
      if (name === 'models' && this.current && this.current !== 'models') {
        var bk = document.querySelector('#screen-models .back-btn');
        if (bk) bk.setAttribute('data-go', this.current);
      }
      this.current = name;
      var screens = document.querySelectorAll('.screen');
      for (var i = 0; i < screens.length; i++) screens[i].classList.remove('active');
      var sc = document.getElementById('screen-' + name);
      if (sc) sc.classList.add('active');
      var btns = document.querySelectorAll('.nav-btn');
      for (var j = 0; j < btns.length; j++) {
        btns[j].classList.toggle('active', btns[j].getAttribute('data-go') === name);
      }
      if (name === 'chat') { this.scrollBottom(); this.syncChatState(); }
      if (name === 'memory') { this.syncReminders(); this.refreshMem(); }
      if (name === 'home') { this.renderSys(); this.renderUsage(); Sys.refresh(); }
      if (name === 'biblio') this.renderBiblio();
      if (name === 'settings') this.renderLocal();
      if (name === 'models') {
        this.modelsTab(this._mtab || 'tel');
        Mod.sync(function () { App.renderModels(); App.renderOrch(); });
      }
    },
    /* v2.10.1: pestañas de Modelos — Teléfono / Nube / Mi red */
    _mtab: 'tel',
    modelsTab: function (t) {
      if (t !== 'tel' && t !== 'nube' && t !== 'red') t = 'tel';
      this._mtab = t;
      var tabs = document.querySelectorAll('#mtabs .mtab');
      for (var i = 0; i < tabs.length; i++) {
        var on = tabs[i].getAttribute('data-mt') === t;
        tabs[i].classList.toggle('on', on);
        tabs[i].setAttribute('aria-selected', on ? 'true' : 'false');
      }
      var panes = document.querySelectorAll('.mpane');
      for (var j = 0; j < panes.length; j++) panes[j].classList.toggle('on', panes[j].id === 'mpane-' + t);
      if (t === 'nube') this.renderProviders();
      if (t === 'red' && document.getElementById('loc-status')) this.renderLocal();
    },
    bindModelTabs: function () {
      var self = this;
      var bar = document.getElementById('mtabs');
      if (!bar) return;
      bar.addEventListener('click', function (ev) {
        var b = ev.target.closest('[data-mt]');
        if (b) self.modelsTab(b.getAttribute('data-mt'));
      });
    },
    bindNav: function () {
      var self = this;
      document.addEventListener('click', function (ev) {
        var g = ev.target.closest('[data-go]');
        if (g) { self.go(g.getAttribute('data-go')); }
      });
    },

    /* ---------- Inicio ---------- */
    bindHome: function () {
      var self = this;
      document.getElementById('home-settings-btn').innerHTML = icon('gear', 20);
      document.getElementById('home-settings-btn').addEventListener('click', function () { self.go('settings'); });
      var hav = document.getElementById('hero-avatar');
      if (hav) hav.addEventListener('click', function () { self.startVoice(); });
      document.getElementById('hero-voice').addEventListener('click', function () { self.startVoice(); });
      document.getElementById('quick-voice').addEventListener('click', function () { self.startVoice(); });
      document.getElementById('recent-clear').addEventListener('click', function () {
        store('nexo_activity', []);
        self.renderHome();
        self.toast('Actividad limpiada');
      });
    },
    renderHome: function () {
      document.getElementById('hero-hi').textContent = KiuBrain.greeting(S.name);
      var act = store('nexo_activity') || [];
      var el = document.getElementById('recent-list');
      if (!act.length) {
        el.innerHTML = '<p class="empty-hint">Sin actividad todavía. Probá "recuérdame llamar a mamá a las 9" en el Chat.</p>';
      } else {
        var map = { recuerdos: 'bookmark', tareas: 'check', notas: 'note', prefs: 'heart', chat: 'chat', alarmas: 'alarm' };
        el.innerHTML = act.slice(0, 6).map(function (a) {
          return '<div class="list-row"><span class="list-ic">' + icon(map[a.type] || 'chat', 18) + '</span>' +
            '<div class="list-txt"><strong>' + esc(a.text) + '</strong><span>' + esc(a.label || a.type) + ' · ' + timeAgo(a.ts) + '</span></div></div>';
        }).join('');
      }
      this.renderSys();
      this.renderUsage();
    },
    addActivity: function (type, text) {
      var labels = { recuerdos: 'Recuerdo', tareas: 'Tarea', notas: 'Nota', prefs: 'Preferencia', alarmas: 'Alarma' };
      var act = store('nexo_activity') || [];
      act.unshift({ type: type, text: text.length > 60 ? text.slice(0, 60) + '…' : text, label: labels[type] || type, ts: Date.now() });
      if (act.length > 20) act.pop();
      store('nexo_activity', act);
      if (this.current === 'home') this.renderHome();
    },
    track: function (what) {
      var u = usage();
      if (u[what] !== undefined) u[what]++;
      store('nexo_usage', u);
      /* Estadística semanal: cuenta mensajes por día (7 días) */
      if (what === 'mensajes') {
        var days = store('nexo_days') || {};
        var k = new Date().toDateString();
        days[k] = (days[k] || 0) + 1;
        /* conservar solo los últimos 7 días */
        var keep = {};
        for (var i = 0; i < 7; i++) {
          var dk = new Date(Date.now() - i * 86400000).toDateString();
          if (days[dk] !== undefined) keep[dk] = days[dk];
        }
        store('nexo_days', keep);
      }
      if (this.current === 'home') this.renderUsage();
    },
    renderUsage: function () {
      var block = document.getElementById('usage-block');
      if (!block) return;
      var u = usage();
      var total = (u.mensajes || 0) + (u.herramientas || 0) + (u.notas || 0);
      if (total === 0) { block.classList.add('hidden'); return; }
      block.classList.remove('hidden');
      var rows = [
        { k: 'mensajes', lbl: 'Mensajes', cls: '' },
        { k: 'herramientas', lbl: 'Herramientas', cls: 'violet' },
        { k: 'notas', lbl: 'Notas', cls: 'green' }
      ];
      var max = 1;
      rows.forEach(function (r) { if (u[r.k] > max) max = u[r.k]; });
      document.getElementById('usage-rows').innerHTML = rows.map(function (r) {
        var pct = Math.round((u[r.k] || 0) / max * 100);
        return '<div class="usage-row"><span>' + r.lbl + '</span>' +
          '<div class="bar"><i class="' + r.cls + '" style="width:' + pct + '%"></i></div>' +
          '<b>' + (u[r.k] || 0) + '</b></div>';
      }).join('') + this.weekBarsHTML() + '<p class="sys-foot">Contadores reales, se reinician cada día</p>';
    },
    weekBarsHTML: function () {
      var days = store('nexo_days') || {};
      var vals = [], lbls = [], total = 0;
      var D = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
      for (var i = 6; i >= 0; i--) {
        var d = new Date(Date.now() - i * 86400000);
        vals.push(days[d.toDateString()] || 0);
        lbls.push(D[d.getDay()]);
        total += vals[vals.length - 1];
      }
      if (!total) return '';
      var mx = Math.max.apply(null, vals.concat([1]));
      var bars = vals.map(function (v, ix) {
        var h = v ? Math.max(14, Math.round(v / mx * 100)) : 4;
        return '<div class="wb-col"><i style="height:' + h + '%" class="' + (v ? '' : 'mute') + (ix === 6 ? ' hoy' : '') + '"></i><span>' + lbls[ix] + '</span></div>';
      }).join('');
      return '<div class="week-wrap"><div class="week-head"><strong>Últimos 7 días</strong><b>' + total + ' mensaje' + (total === 1 ? '' : 's') + '</b></div><div class="week-bars">' + bars + '</div></div>';
    },

    /* ---------- Estado del sistema (en vivo) ---------- */
    renderSys: function () {
      var d = Sys.d;
      if (!d) return;
      this.sysCache = d;
      var cpuEl = document.getElementById('sys-cpu');
      if (cpuEl) {
        var c = d.cores || (navigator.hardwareConcurrency || 0);
        cpuEl.textContent = c ? (c + ' núcleos · ' + (d.os ? 'Android ' + d.os : 'listo')) : 'Leyendo el teléfono…';
      }
      var pct = function (a, b) { return (a && b) ? Math.max(2, Math.min(100, Math.round(a / b * 100))) : 0; };
      var rbar = document.getElementById('bar-ram');
      if (rbar) {
        if (d.ramTotal) {
          var rp = pct(d.ramTotal - d.ramAvail, d.ramTotal);
          rbar.style.width = rp + '%';
          rbar.className = rp > 90 ? 'bad' : rp > 75 ? 'warn' : 'violet';
          document.getElementById('val-ram').textContent = fmtGB(d.ramTotal - d.ramAvail) + ' / ' + fmtGB(d.ramTotal) + ' GB';
        } else {
          rbar.style.width = '0%';
          document.getElementById('val-ram').textContent = '—';
        }
      }
      var dbar = document.getElementById('bar-disk');
      if (dbar) {
        if (d.diskTotal) {
          var dp = pct(d.diskTotal - d.diskFree, d.diskTotal);
          dbar.style.width = dp + '%';
          dbar.className = dp > 90 ? 'bad' : dp > 75 ? 'warn' : 'green';
          document.getElementById('val-disk').textContent = fmtGB(d.diskFree) + ' GB libres';
        } else {
          dbar.style.width = '0%';
          document.getElementById('val-disk').textContent = '—';
        }
      }
      var bbar = document.getElementById('bar-bat');
      if (bbar) {
        if (d.bat) {
          bbar.style.width = Math.max(3, d.bat) + '%';
          bbar.className = d.bat > 45 ? 'green' : d.bat > 20 ? 'warn' : 'bad';
          var txt = d.bat + '%';
          if (d.temp) txt += ' · ' + String(d.temp).replace('.', ',') + ' °C';
          if (d.charging) txt += ' · cargando';
          document.getElementById('val-bat').textContent = txt;
        } else {
          bbar.style.width = '0%';
          document.getElementById('val-bat').textContent = '—';
        }
      }
      var foot = document.getElementById('sys-foot');
      if (foot) {
        var bits = [];
        if (d.model) bits.push(d.model);
        if (d.os) bits.push('Android ' + d.os);
        foot.textContent = bits.length ? (bits.join(' · ') + ' · datos reales del teléfono') : 'Datos del teléfono';
      }
    },
    renderRealSubs: function () {
      var d = Sys.d;
      var el = document.getElementById('brain-sub');
      if (el && d) {
        var ram = d.ramTotal ? Math.round(d.ramTotal / 1073741824) + ' GB RAM' : (d.ramApprox ? d.ramApprox + ' GB RAM aprox' : 'RAM lista');
        el.textContent = ram + (d.cores ? ' · ' + d.cores + ' núcleos' : '') + ' · ' + this.modeLabel();
      }
      var md = document.getElementById('motor-device');
      if (md && d && d.model) md.textContent = d.model;
    },
    modeLabel: function () {
      return S.mode === 'local' ? 'Solo local' : S.mode === 'api' ? 'API' : 'Híbrido';
    },
    tempLabel: function (t) {
      var el = document.getElementById('gen-temp-lbl');
      if (!el) return;
      var lbl = t <= 0.3 ? 'Precisa' : t <= 0.8 ? 'Equilibrada' : 'Creativa';
      el.textContent = lbl + ' (' + (Math.round(t * 100) / 100).toString().replace('.', ',') + ')';
    },

    /* ---------- Estado (tarjeta motor + subtítulos) ---------- */
    renderStatus: function () {
      var dot = document.getElementById('status-dot');
      var t = document.getElementById('status-title');
      var m = document.getElementById('status-meta');
      var sub = document.getElementById('home-sub');
      var mm = document.getElementById('motor-mode');
      /* v2.14.8 · el modelo en monoespaciado y la RAM como barra. Antes el
         nombre del modelo aparecía al final de cada respuesta (ruido) y la RAM
         era un número suelto en el diagnóstico. */
      try {
        var mdl = document.getElementById('motor-model');
        var nombre = (S.kiu && S.kiu.name) ? String(S.kiu.name) : '';
        if (mdl) mdl.textContent = nombre || 'sin modelo cargado';
        var fill = document.getElementById('motor-ram-fill');
        var txt = document.getElementById('motor-ram-txt');
        if (fill && txt) {
          var d = Sys.d || {};
          var tot = d.ramTotal || 0, av = d.ramAvail || 0;
          if (tot) {
            var usado = Math.max(0, tot - av);
            fill.style.width = Math.min(100, Math.round(usado / tot * 100)) + '%';
            txt.textContent = 'RAM ' + (usado / 1073741824).toFixed(1) + '/' + (tot / 1073741824).toFixed(1) + ' GB';
          } else {
            fill.style.width = '0%';
            txt.textContent = 'RAM —';
          }
        }
      } catch (eRam) { }
      var act = this.activeProvs();
      var first = act.length ? act[0] : null;
      if (S.mode !== 'local' && first) {
        dot.className = 'status-dot api';
        if (first.def.local) {
          var lhost = (first.st.url || '').replace(/^https?:\/\//, '').split('/')[0] || 'Servidor local';
          t.textContent = 'Servidor local conectado';
          m.textContent = (first.st.model || 'modelo sin seleccionar') + ' · ' + lhost;
          mm.textContent = S.mode === 'hybrid' ? 'Local + API' : 'Servidor local';
          sub.textContent = 'Agente personal · servidor local';
        } else {
          t.textContent = 'API conectada';
          m.textContent = (first.st.model || first.def.name) + ' · ' + first.def.name;
          mm.textContent = S.mode === 'hybrid' ? 'Híbrido' : 'API';
          sub.textContent = S.mode === 'hybrid' ? 'Agente personal · local + API' : 'Agente personal · IA por API';
        }
      } else if (S.kiu && S.kiu.ok) {
        dot.className = 'status-dot api';
        t.textContent = 'Motor interno';
        m.textContent = 'Modelo cargado · ' + (S.kiu.name || 'GGUF').replace(/\.gguf$/i, '');
        mm.textContent = '100% local';
        sub.textContent = 'Agente personal · modelo ejecutándose en el teléfono';
      } else {
        dot.className = 'status-dot';
        t.textContent = S.mode === 'local' ? 'Motor local sin cargar' : 'Sin motor conectado';
        m.textContent = S.mode === 'local' ? 'Descarga o carga un modelo GGUF' : 'Conecta una API o carga un modelo local';
        mm.textContent = S.mode === 'local' ? 'Pendiente de modelo' : 'Desconectado';
        sub.textContent = 'Tu agente personal';
      }
      var pr = document.getElementById('profile-name');
      if (pr) pr.textContent = S.name || 'Tu nombre';
      var ps = document.getElementById('profile-sub');
      /* v2.10.1: this.ver nunca se asignaba (siempre «?»). La versión viene del
         paquete instalado, leída por el puente. */
      var verTxt = (window.KiuDiagVoz && KiuDiagVoz.ver) || this.ver || '?';
      if (ps) ps.textContent = 'Kiu v' + verTxt + ' · Agente personal';
      var av = document.getElementById('about-ver');
      if (av) av.textContent = 'Kiu ' + verTxt;
      var psub = document.getElementById('persona-sub');
      if (psub) psub.textContent = ({ normal: 'Normal', divertida: 'Divertida', tecnica: 'Técnica', breve: 'Breve' })[S.persona] + ' · ajustá cómo te habla';
      this.renderRealSubs();
      this.updateApiRow();
      if (document.getElementById('loc-status')) this.renderLocal();
    },
    /* v2.1: fila «APIs de internet» dentro de Modelos — estado de los proveedores */
    updateApiRow: function () {
      var act = this.activeProvs();
      var sub = document.getElementById('api-sub');
      var cnt = document.getElementById('api-count');
      if (sub) {
        if (!act.length) {
          sub.textContent = S.mode === 'local' ? 'Apagadas · modo solo local' : 'Tocá para conectar Gemini, Groq, OpenAI y más';
        } else {
          var names = act.map(function (pv) { return pv.def.name; });
          sub.textContent = names.length + ' activa' + (names.length > 1 ? 's' : '') + ' · ' + names.join(', ');
        }
      }
      if (cnt) cnt.textContent = act.length ? act.length + ' ACTIVAS' : 'OPCIONAL';
      var cn = document.getElementById('mt-count-nube');
      if (cn) cn.textContent = act.length ? '· ' + act.length : '';
    },
    activeProvs: function () {
      var out = [];
      for (var i = 0; i < PROV.length; i++) {
        var def = PROV[i];
        var st = pstate(def.id);
        if (!st.on) continue;
        if (!st.url) continue;
        if (!def.local && !hasKey(def.id)) continue;
        out.push({ def: def, st: st });
      }
      return out;
    },
    apiReady: function () {
      return S.mode !== 'local' && this.activeProvs().length > 0;
    },

    /* ---------- v1.7.0: pantalla Modelos (motor interno + descargas) — v2.0 rediseño ---------- */
    renderModels: function () {
      var eng = document.getElementById('mdl-eng');
      /* v2.0: el input oculto del motor ya no está en el HTML — se crea para no romper el flujo */
      if (!eng) {
        eng = document.createElement('span');
        eng.id = 'mdl-eng';
        eng.style.display = 'none';
        document.body.appendChild(eng);
      }
      /* v1.9.1: por defecto solo modelos compatibles con este teléfono */
      if (!S.mfilter) S.mfilter = 'compat';
      /* v2.0: héroe «Tu teléfono» — datos reales del bridge + userAgent */
      var devSub = document.getElementById('dev-sub');
      if (devSub) {
        var dH = (Sys && Sys.d) || {};
        var ramH = dH.ramTotal ? dH.ramTotal / 1073741824 : 0;
        var freeH = dH.diskFree ? dH.diskFree / 1073741824 : 0;
        var uaM = /Android\s+([\d.]+)/.exec(navigator.userAgent || '');
        var info = ['arm64'];
        if (uaM) info.push('Android ' + parseInt(uaM[1], 10));
        if (ramH) info.push(Math.round(ramH) + ' GB RAM');
        if (freeH) info.push(Math.round(freeH) + ' GB libres');
        if (dH.model) info.push(dH.model);
        devSub.textContent = info.join(' · ');
        var bEl = document.getElementById('dev-badge');
        if (bEl) {
          if (!ramH) { bEl.className = 'k2-badge b-d'; bEl.textContent = '…'; }
          else if (ramH >= 6) { bEl.className = 'k2-badge b-g'; bEl.textContent = '✓ OK PARA IA'; }
          else if (ramH >= 4) { bEl.className = 'k2-badge b-t'; bEl.textContent = 'LISTO'; }
          else if (ramH >= 3) { bEl.className = 'k2-badge b-a'; bEl.textContent = 'AJUSTADO'; }
          else { bEl.className = 'k2-badge b-r'; bEl.textContent = 'BÁSICO'; }
        }
        var fill = document.getElementById('dev-ram-fill');
        var lbl = document.getElementById('dev-ram-lbl');
        var hint = document.getElementById('dev-hint');
        if (ramH) {
          var comf = Math.max(0.8, ramH - 1);
          if (fill) fill.style.width = Math.min(100, Math.round(comf / 8 * 100)) + '%';
          if (lbl) lbl.textContent = 'hasta ~' + (comf >= 9.5 ? '9+' : Math.round(comf)) + ' GB';
          if (hint) {
            var comfB = comf >= 7 ? '8 B' : comf >= 4.5 ? '4 B' : comf >= 3 ? '3 B' : comf >= 2 ? '1,7 B' : comf >= 1.2 ? '1 B' : '0,5 B';
            var mmapB = ramH >= 16 ? '30 B (MoE)' : ramH >= 7.5 ? '8 B' : ramH >= 5.5 ? '4 B' : ramH >= 3.5 ? '3 B' : '2 B';
            hint.innerHTML = 'Podés correr modelos de hasta <b>' + comfB + ' cómodos</b> y de <b>' + mmapB + ' con mmap</b> (usa el disco como RAM). El catálogo ya viene filtrado por esto.';
          }
        } else if (hint) {
          if (fill) fill.style.width = '30%';
          if (lbl) lbl.textContent = '';
          hint.innerHTML = 'No pude leer la RAM del teléfono: el catálogo arranca con los modelos más livianos, que andan bien en cualquier equipo.';
        }
      }
      var mine = document.getElementById('mdl-mine');
      if (mine) {
        Mod.sync();
        var d0 = (Sys && Sys.d) || {};
        var ram0 = d0.ramTotal ? d0.ramTotal / 1073741824 : 0;
        /* v2.0: «Mis modelos» = TODO lo que hay en el disco (catálogo + importados) */
        var mrows = [];
        for (var mi = 0; mi < MODCAT.length; mi++) {
          var mc = MODCAT[mi];
          if (S.dl.done[mc.f] && Mod.fileByName(mc.f)) mrows.push({ f: mc.f, b: (S.dl.done[mc.f] || {}).b, c: mc });
        }
        var imp = Mod.files.filter(function (f) { return /\.gguf$/i.test(f.n) && f.g !== false && !Mod._purged[f.n] && !MODCAT.some(function (m) { return m.f === f.n; }); });
        for (var ii = 0; ii < imp.length; ii++) mrows.push({ f: imp[ii].n, b: imp[ii].b, c: modCatByFile(imp[ii].n), imp: true });
        mrows.sort(function (a, b) { return (S.kiu.name === b.f ? 1 : 0) - (S.kiu.name === a.f ? 1 : 0); });
        var cnt = document.getElementById('mdl-count');
        if (cnt) cnt.textContent = mrows.length + (mrows.length === 1 ? ' en disco' : ' en disco');
        var ct = document.getElementById('mt-count-tel');
        if (ct) ct.textContent = mrows.length ? '· ' + mrows.length : '';
        var quantOf = function (fn) {
          var q = /(?:i?q)(\d)_(k_m|k_s|0)$/i.exec(fn.replace(/\.gguf$/i, ''));
          if (!q) { var q2 = /(?:i?)(q\d[_a-z0-9]*)/i.exec(fn); return q2 ? q2[1].toUpperCase() : ''; }
          return ('Q' + q[1] + '_' + q[2]).toUpperCase();
        };
        var sizeOf = function (gbv, bytes) {
          if (gbv) return gbv < 1 ? Math.round(gbv * 1024) + ' MB' : gbv.toFixed(1).replace('.', ',') + ' GB';
          return Mod.gb(bytes || 0);
        };
        mine.innerHTML = mrows.length ? mrows.map(function (r) {
          var f = r.f, c = r.c;
          var loaded = S.kiu.ok && S.kiu.name === f;
          var loading = Kiu.busyG && S.kiu.name === f;
          var k = modKind(f);
          var canRun = k === 'text' && (!c || c.eng === 'kiu');
          var name = esc(prettyName(f));
          var badges = r.imp ? '<i class="k2-badge b-v">IMPORTADO</i>' : '';
          if (k === 'vision') badges += ' <i class="k2-badge b-v">VISIÓN</i>';
          var fitTxt = '';
          var need = c ? c.r : (r.b / 1073741824) * 1.5 + 1.0;
          if (ram0 && canRun) fitTxt = need <= ram0 - 1 ? 'listo para todo' : need <= ram0 ? 'justo de RAM' : 'puede no entrar';
          var sub = sizeOf(c ? c.gb : 0, r.b);
          if (c) sub = quantOf(c.f) + ' · ' + sizeOf(c.gb, r.b) + ' · RAM ~' + String(c.r).replace('.', ',') + ' GB';
          else sub = sizeOf(0, r.b);
          if (fitTxt) sub += ' · ' + fitTxt;
          if (!canRun && k === 'vision') sub += ' · usalo con tu servidor';
          var tile = loaded ? '<span class="k2-tile big tl-green">' + icon('check', 19) + '</span>'
            : k === 'vision' ? '<span class="k2-tile big tl-pink">' + icon('eye', 19) + '</span>'
              : '<span class="k2-tile big tl-violet">' + icon('brain', 19) + '</span>';
          var bar = '';
          if (loading) bar = '<div class="k2-lbar"><i style="width:' + (Kiu._loadPct || 5) + '%"></i></div><p class="k2-sub">Cargando… ' + (Kiu._loadPct || 0) + '%' + (Kiu._loadSec ? ' · ' + Kiu._loadSec + 's' : '') + '</p>';
          var acts = '<div class="k2-acts">';
          if (loaded) acts += '<button class="k2-pill" data-free="1">Liberar</button><button class="k2-minibtn" data-test="1">Probar</button>';
          else if (canRun && !loading) acts += '<button class="k2-pill solid" data-use="' + esc(f) + '">Cargar</button>';
          if (c && c.eng === 'server' && !canRun) acts += '<button class="k2-pill" data-serve="' + esc(c.n) + '">Con servidor</button>';
          if (r.imp && k !== 'text') acts += '<button class="k2-minibtn" data-kind="' + esc(f) + '">Es de texto</button>';
          acts += '<button class="k2-minibtn" data-del="' + esc(f) + '">Borrar</button></div>';
          return '<div class="k2-model">' + tile + '<div class="k2-mid"><p class="k2-name">' + name + (loaded ? ' <i class="k2-badge b-g">CARGADO</i>' : '') + '</p><p class="k2-sub">' + sub + '</p>' + (bar || (badges ? '<div class="k2-badges">' + badges + '</div>' : '')) + '</div>' + acts + '</div>';
        }).join('') : '<p class="k2-empty">Todavía no tenés modelos en el disco.<br>Descargá uno abajo o importá un archivo .gguf del teléfono.</p>';
      }
      var avail = Kiu.available();
      var dot = document.getElementById('mdl-dot');
      if (dot) dot.className = 'status-dot' + (S.kiu.ok ? ' api' : '');
      var sub2 = document.getElementById('mdl-eng-sub');
      if (sub2) sub2.textContent = !avail ? 'El motor interno no está disponible en este teléfono · usá el servidor local o una API'
        : (S.kiu.ok ? ('Motor interno corriendo · ' + prettyName(S.kiu.name) + (Kiu.busyG ? ' · cargando…' : ''))
          : (Mod.hasKiu() ? 'Motor listo · tocá «Cargar» en un modelo de abajo' : 'Descargá un modelo de abajo y tocá «Cargar»'));
      if (S.kiu.ok) {
        eng.textContent = Kiu.busyG ? ('Cargando… ' + (Kiu._loadPct || 0) + '%' + (Kiu._loadSec ? ' · ' + Kiu._loadSec + 's' : '')) : S.kiu.name.replace('.gguf', '');
      } else if (Kiu.busyG) {
        eng.textContent = 'Cargando… ' + (Kiu._loadPct || 0) + '%' + (Kiu._loadSec ? ' · ' + Kiu._loadSec + 's' : '');
      } else {
        eng.textContent = avail ? 'Sin modelo cargado' : 'No disponible';
      }
      var bl = document.getElementById('mdl-load'), bt = document.getElementById('mdl-test'), bf = document.getElementById('mdl-free');
      if (bl) bl.classList.toggle('hidden', !avail);
      if (bt) bt.classList.toggle('hidden', !avail || !S.kiu.ok);
      if (bf) bf.classList.toggle('hidden', !avail);
      var list = document.getElementById('mdl-list');
      if (!list) return;
      var jobByFile = {};
      for (var jk in Mod.jobs) {
        if (!Object.prototype.hasOwnProperty.call(Mod.jobs, jk)) continue;
        jobByFile[Mod.jobs[jk].name] = { id: jk, job: Mod.jobs[jk] };
      }
      var d = (Sys && Sys.d) || {};
      var ram = d.ramTotal ? d.ramTotal / 1073741824 : 0;
      /* v1.8.0: chips de filtro por tipo (texto / visión / multimodal) */
      var mchips = document.getElementById('mdl-filters');
      if (mchips) {
        var cs = mchips.querySelectorAll('.chip');
        for (var ci = 0; ci < cs.length; ci++) cs[ci].classList.toggle('active', cs[ci].getAttribute('data-mf') === S.mfilter);
      }
      var partSize = function (fn) {
        for (var pi = 0; pi < Mod.files.length; pi++) if (Mod.files[pi].n === fn + '.part') return Mod.files[pi].b || 0;
        return 0;
      };
      /* v1.9.1: filtro del catálogo — 'compat' (default) muestra SOLO los modelos
         que realmente corren en este teléfono (motor interno + entran en la RAM) */
      var mf = S.mfilter || 'compat';
      var mfit = function (c) {
        if (mf === 'todos') return true;
        if (mf === 'texto') return c.eng === 'kiu' && !c.vis;
        if (mf === 'vision') return !!c.vis || c.eng === 'server';
        if (c.eng !== 'kiu') return false;
        if (!ram) return c.gb <= 2.6;
        return c.r <= ram - 1;
      };
      var visCats = MODCAT.filter(mfit);
      if (mf === 'compat' && !visCats.length) {
        visCats = MODCAT.filter(function (c) { return c.eng === 'kiu'; }).sort(function (a, b) { return a.gb - b.gb; }).slice(0, 2);
      }
      /* v2.0: velocidad de descarga (delta entre renders, ~1 s) */
      var nowMs = Date.now();
      var spdTxt = function (job) {
        if (job._lt && nowMs > job._lt && job.got >= (job._lg || 0)) {
          var sp = (job.got - (job._lg || 0)) / ((nowMs - job._lt) / 1000);
          if (sp > 10240) job.spd = sp;
        }
        job._lg = job.got; job._lt = nowMs;
        return job.spd ? ((job.spd / 1048576) >= 10 ? Math.round(job.spd / 1048576) + ' MB/s' : (job.spd / 1048576).toFixed(1).replace('.', ',') + ' MB/s') : '';
      };
      var ringSvg = function (pct) {
        var C = 119.4;
        var off = (C - (C * Math.min(100, Math.max(0, pct)) / 100)).toFixed(1);
        return '<span class="k2-ringwrap"><svg width="46" height="46" viewBox="0 0 46 46"><circle cx="23" cy="23" r="19" fill="none" stroke="rgba(126,158,255,.16)" stroke-width="4"/><circle cx="23" cy="23" r="19" fill="none" stroke="#2DD4BF" stroke-width="4" stroke-linecap="round" stroke-dasharray="' + C + '" stroke-dashoffset="' + off + '" transform="rotate(-90 23 23)"/></svg><b>' + Math.round(pct) + '%</b></span>';
      };
      var kindTag = function (c) {
        if (c.moe) return 'MoE · 30B/3B';
        if (/coder|cód/i.test(c.n + ' ' + c.d)) return 'TEXTO · CÓDIGO';
        if (c.vis || modKind(c.f) === 'vision') return 'VISIÓN';
        if (c.gb <= 0.5) return 'SÚPER RÁPIDO';
        if (c.r >= 5.5 && c.eng === 'kiu') return 'CEREBRO FUERTE';
        if (c.eng === 'server') return 'SERVIDOR';
        return 'TEXTO';
      };
      var catRows = visCats.map(function (c) {
        var dn = Mod.done(c.f);
        var kind = modKind(c.f);
        var fitCls = '', fitTxt = '';
        if (ram) {
          fitTxt = c.r <= ram - 1 ? 'Entra ✓' : c.r <= ram ? 'Justo' : 'Falta RAM';
          fitCls = c.r <= ram - 1 ? 'fit-ok' : c.r <= ram ? 'fit-mid' : 'fit-no';
        }
        var ajustado = !!(ram && c.r > ram - 1 && c.r <= ram * 1.25);
        var sinRam = !!(ram && c.r > ram);
        var quant = quantOf(c.f);
        var subBase = (quant ? quant + ' · ' : '') + (c.gb < 1 ? Math.round(c.gb * 1024) + ' MB' : c.gb.toFixed(1).replace('.', ',') + ' GB') + ' · RAM ~' + String(c.r).replace('.', ',') + ' GB';
        var badges = '';
        if (sinRam) badges += '<i class="k2-badge b-r">FALTA RAM</i>';
        else if (ajustado) badges += '<i class="k2-badge b-a">AJUSTADO · USA MMAP</i>';
        else if (c.eng === 'kiu' && ram) badges += '<i class="k2-badge b-g">✓ COMPATIBLE</i>';
        else if (c.eng === 'server') badges += '<i class="k2-badge b-v">SERVIDOR</i>';
        badges += '<i class="k2-badge b-b">' + kindTag(c) + '</i>';
        var cardCls = ajustado && !dn ? ' warn' : (sinRam ? ' err' : '');
        var tileIdle = c.vis || kind === 'vision' ? '<span class="k2-tile big tl-pink">' + icon('eye', 19) + '</span>'
          : c.eng === 'server' ? '<span class="k2-tile big tl-violet">' + icon('cloud', 19) + '</span>'
            : '<span class="k2-tile big tl-blue">' + icon('cloudup', 19) + '</span>';
        var mid, acts;
        var jb = jobByFile[c.f];
        if (jb && (jb.job.st === 'run' || jb.job.st === 'queued')) {
          var pct = jb.job.total ? Math.min(100, Math.round(jb.job.got / jb.job.total * 100)) : 0;
          var sp = jb.job.st === 'queued' ? '' : spdTxt(jb.job);
          var resume = jb.job.re && jb.job.total ? ' · <span class="re">reanudando desde ' + Math.min(99, Math.round(jb.job.re / jb.job.total * 100)) + '%</span>' : '';
          mid = '<p class="k2-name">' + pct + '% · ' + esc(c.n) + '</p><p class="k2-sub">' + Mod.gb(jb.job.got) + (jb.job.total ? ' de ' + Mod.gb(jb.job.total) : '') + (sp ? ' · <span class="spd">' + sp + '</span>' : '') + resume + '</p><div class="k2-badges">' + badges + '</div>';
          acts = '<div class="k2-acts" style="flex-direction:row"><button class="k2-iconbtn" data-stop="' + esc(jb.id) + '" aria-label="Pausar">' + icon('pause', 13) + '</button><button class="k2-iconbtn danger" data-stopx="' + esc(jb.id) + '" data-f="' + esc(c.f) + '" aria-label="Cancelar">' + icon('xmark', 13) + '</button></div>';
          return '<div class="k2-model">' + ringSvg(pct) + '<div class="k2-mid">' + mid + '</div>' + acts + '</div>';
        }
        if (dn) {
          mid = '<p class="k2-name">' + esc(c.n) + '</p><p class="k2-sub">' + subBase + ' · ya en tu disco ✓</p><div class="k2-badges">' + badges + '</div>';
          acts = '<div class="k2-acts">' +
            (c.eng === 'kiu' ? '<button class="k2-pill solid" data-use="' + esc(c.f) + '">' + (S.kiu.name === c.f && S.kiu.ok ? 'Cargado' : 'Cargar') + '</button>' : '<button class="k2-pill" data-serve="' + esc(c.n) + '">Con servidor</button>') +
            '<button class="k2-minibtn" data-del="' + esc(c.f) + '">Borrar</button></div>';
          return '<div class="k2-model">' + '<span class="k2-tile big tl-green">' + icon('check', 19) + '</span>' + '<div class="k2-mid">' + mid + '</div>' + acts + '</div>';
        }
        var pb = partSize(c.f);
        var pillLbl = pb > 0 ? 'Reanudar' : 'Descargar';
        var pillCls = ajustado ? 'k2-pill amber' : 'k2-pill solid';
        mid = '<p class="k2-name">' + esc(c.n) + '</p><p class="k2-sub">' + subBase + '</p>' + (pb > 0 ? '<p class="k2-sub"><span class="re">Reanudá: ya tenés ' + Mod.gb(pb) + ' bajados</span></p>' : '') + '<div class="k2-badges">' + badges + '</div>';
        acts = '<div class="k2-acts"><button class="' + pillCls + '" data-dl="' + esc(c.f) + '">' + pillLbl + '</button></div>';
        return '<div class="k2-model' + cardCls + '">' + tileIdle + '<div class="k2-mid">' + mid + '</div>' + acts + '</div>';
      });
      list.innerHTML = catRows.length ? catRows.join('') : '<p class="k2-empty">No hay modelos en esta categoría para tu teléfono. Probá «Todos».</p>';
      var foot = document.getElementById('mdl-foot');
      if (foot) {
        var free = Mod.free();
        foot.textContent = 'Se guardan en el almacenamiento privado de Kiu · ' + (free ? Mod.gb(free) + ' libres en el disco' : 'espacio real del teléfono en la app');
      }
      this.renderOrch();
    },
    /* v2.10.1: progreso en sitio — toca solo el anillo y los textos, nunca los botones */
    paintDl: function (id, job) {
      var btn = document.querySelector('#mdl-list [data-stop="' + id + '"]');
      var row = btn && btn.closest('.k2-model');
      if (!row) return false;
      var pct = job.total ? Math.min(100, Math.round(job.got / job.total * 100)) : 0;
      var now = Date.now();
      if (job._lt && now > job._lt && job.got >= (job._lg || 0)) {
        var sp = (job.got - (job._lg || 0)) / ((now - job._lt) / 1000);
        if (sp > 10240) job.spd = sp;
      }
      job._lg = job.got; job._lt = now;
      var spd = job.spd ? ((job.spd / 1048576) >= 10 ? Math.round(job.spd / 1048576) + ' MB/s' : (job.spd / 1048576).toFixed(1).replace('.', ',') + ' MB/s') : '';
      var ring = row.querySelector('.k2-ringwrap');
      var name = row.querySelector('.k2-name');
      var sub = row.querySelector('.k2-sub');
      if (!ring || !name || !sub) return false;
      var C = 119.4;
      var arc = ring.querySelectorAll('circle')[1];
      if (arc) arc.setAttribute('stroke-dashoffset', (C - (C * pct / 100)).toFixed(1));
      var b = ring.querySelector('b');
      if (b) b.textContent = pct + '%';
      name.textContent = name.textContent.replace(/^\d+%/, pct + '%');
      sub.innerHTML = Mod.gb(job.got) + (job.total ? ' de ' + Mod.gb(job.total) : '') + (spd ? ' · <span class="spd">' + spd + '</span>' : '');
      return true;
    },
    bindModels: function () {
      var self = this;
      var list = document.getElementById('mdl-list');
      var mineEl = document.getElementById('mdl-mine');
      var bimp = document.getElementById('mdl-import');
      if (bimp) bimp.addEventListener('click', function () { Imp.start(); });
      /* v1.8.0: chips de filtro del catálogo */
      var mf = document.getElementById('mdl-filters');
      if (mf) mf.addEventListener('click', function (ev) {
        var c = ev.target.closest('.chip');
        if (!c) return;
        S.mfilter = c.getAttribute('data-mf') || 'todos';
        saveS();
        self.renderModels();
      });
      if (list) {
        var onMdl = function (ev) {
          var el = ev.target.closest('[data-dl],[data-use],[data-del],[data-stop],[data-stopx],[data-kind],[data-serve],[data-free],[data-test]');
          if (!el) return;
          var freeE = el.getAttribute('data-free');
          if (freeE) {
            Kiu.forceReset(); Kiu.unload();
            self.toast('Motor liberado');
            self.renderModels(); self.renderStatus();
            return;
          }
          var testE = el.getAttribute('data-test');
          if (testE) {
            if (!S.kiu.ok) return;
            el.textContent = 'Probando…';
            Kiu.ask([{ role: 'user', content: 'Contestá solo con: OK' }], 16, function (out) {
              if (out.ok && out.tps && window.KiuBench) KiuBench.rec(S.kiu.name, out.tps);
              self.renderModels();
              self.toast(out.ok ? ('Motor OK · ' + (out.tps ? out.tps.toFixed(1).replace('.', ',') + ' tok/s' : 'listo')) : ('Falló: ' + out.err));
            });
            return;
          }
          var stopX = el.getAttribute('data-stopx');
          if (stopX) {
            var partFile = el.getAttribute('data-f') || '';
            Mod.cancel(stopX);
            if (partFile) setTimeout(function () {
              try { rawBridge('dlDel', [partFile + '.part']); } catch (eSX) { }
              delete Mod.jobs[stopX];
              Mod.sync(function () { self.toast('Descarga cancelada y parcial borrado'); self.renderModels(); });
            }, 800);
            else self.toast('Cancelando…');
            return;
          }
          var f = el.getAttribute('data-dl');
          if (f) {
            var item = modCatByFile(f);
            if (item) Mod.start(item);
            return;
          }
          var use = el.getAttribute('data-use');
          if (use) {
            try {
              App.toast('Iniciando carga…');
              Kiu.load(use);
            } catch (eLoad) {
              App.toast('Error al cargar: ' + ((eLoad && eLoad.message) || eLoad));
            }
            return;
          }
          var kind = el.getAttribute('data-kind');
          if (kind) {
            S.dl.kind = S.dl.kind || {};
            S.dl.kind[kind] = modKind(kind) === 'vision' ? 'text' : 'vision';
            saveS();
            self.renderModels();
            self.toast('Tipo actualizado');
            return;
          }
          var serve = el.getAttribute('data-serve');
          if (serve) {
            self.toast(serve + ' corre en tu servidor: conectalo en «Servidor en tu red» más abajo');
            return;
          }
          var del = el.getAttribute('data-del');
          if (del) { Mod.del(del); return; }
          var stop = el.getAttribute('data-stop');
          if (stop) { Mod.cancel(stop); self.toast('Cancelando…'); }
        };
        list.addEventListener('click', onMdl);
        if (mineEl) mineEl.addEventListener('click', onMdl);
      }
      var bl = document.getElementById('mdl-load');
      if (bl) bl.addEventListener('click', function () {
        var best = S.kiu.name && S.dl.done[S.kiu.name] ? S.kiu.name : Kiu.best();
        if (!best) { self.toast('Primero descargá un modelo'); return; }
        self.toast('Iniciando carga de ' + best.replace(/\.gguf$/i,'').slice(0,24) + '…');
        try { Kiu.load(best); } catch (e2) { self.toast('Error: ' + e2); }
      });
      var bt = document.getElementById('mdl-test');
      if (bt) bt.addEventListener('click', function () {
        if (!S.kiu.ok) return;
        bt.textContent = 'Probando…';
        Kiu.ask([{ role: 'user', content: 'Contestá solo con: OK' }], 16, function (out) {
          bt.textContent = 'Probar motor';
          if (out.ok && out.tps && window.KiuBench) KiuBench.rec(S.kiu.name, out.tps);
          self.toast(out.ok ? ('Motor OK · ' + (out.tps ? out.tps.toFixed(1).replace('.', ',') + ' tok/s' : 'listo')) : ('Falló: ' + out.err));
        });
      });
      var bf = document.getElementById('mdl-free');
      if (bf) bf.addEventListener('click', function () { Kiu.forceReset(); Kiu.unload(); self.toast('Motor liberado'); });
      /* v2.19.0 · PROBAR AGENTE: mide, en este teléfono y con el modelo cargado, si elige bien las
         herramientas. Rápida = 8 pedidos; completa = los 21. No ejecuta nada. */
      var self3 = this;
      function probarAgente(completa, sinGram) {
        var res = document.getElementById('mdl-agent-res');
        var b1 = document.getElementById('mdl-agent-test'), b2 = document.getElementById('mdl-agent-full'), b3 = document.getElementById('mdl-agent-nogram');
        if (!window.KiuAutoprueba) return;
        if (!S.kiu.ok) { self3.toast('Cargá un modelo primero'); return; }
        if (self3._probandoAgente) { self3._cancelarAgente = true; self3.toast('Cancelando…'); return; }
        self3._probandoAgente = true; self3._cancelarAgente = false;
        var etq1 = b1 ? b1.textContent : '', etq2 = b2 ? b2.textContent : '', etq3 = b3 ? b3.textContent : '';
        (sinGram ? b3 : completa ? b2 : b1).textContent = 'Cancelar';
        KiuAutoprueba.correr({
          completa: completa,
          sinGramatica: !!sinGram,
          cancelar: function () { return self3._cancelarAgente; },
          progreso: function (i, n) { if (res) res.textContent = 'Probando ' + (i + 1) + ' de ' + n + '… (un modelo chico tarda unos segundos por pedido)'; }
        }, function (r) {
          self3._probandoAgente = false;
          if (b1) b1.textContent = etq1; if (b2) b2.textContent = etq2; if (b3) b3.textContent = etq3;
          if (!res) return;
          if (!r.ok) { res.textContent = r.err || 'No se pudo probar.'; return; }
          if (r.tps && window.KiuBench) { try { KiuBench.rec(S.kiu.name, r.tps); } catch (eB) { } }
          var pct = Math.round(r.acierto * 100);
          res.textContent = (r.parcial ? '(cancelada) ' : '') + (r.sinGramatica ? '[sin gramática] ' : '') + prettyName(r.modelo) + ': ' + r.aciertos + ' de ' + r.total + ' bien (' + pct + ' %) · ' +
            (r.msPromedio / 1000).toFixed(1).replace('.', ',') + ' s por decisión' + (r.tps ? ' · ' + r.tps.toFixed(1).replace('.', ',') + ' tok/s' : '') +
            '\n' + r.texto +
            (r.fallos.length ? '\nFalló: ' + r.fallos.slice(0, 4).map(function (f) { return '«' + f.pedido + '» → ' + f.motivo; }).join(' · ') : '');
        });
      }
      var ba = document.getElementById('mdl-agent-test'), bb = document.getElementById('mdl-agent-full');
      if (ba) ba.addEventListener('click', function () { probarAgente(false); });
      if (bb) bb.addEventListener('click', function () { probarAgente(true); });
      var bn = document.getElementById('mdl-agent-nogram');
      if (bn) bn.addEventListener('click', function () { probarAgente(false, true); });
      /* si la prueba anterior terminó con Android matando la app, se dice dónde */
      try {
        var mg = window.KiuAutoprueba && KiuAutoprueba.migasPendientes();
        var rs = document.getElementById('mdl-agent-res');
        if (mg && rs) {
          rs.textContent = '⚠ La prueba anterior cerró la app en el pedido ' + mg.n + ' de ' + mg.de + ' («' + mg.pedido + '») con ' + prettyName(mg.modelo) +
            ' · ' + (mg.gram ? 'con gramática' : 'sin gramática') + (mg.ramMB !== null && mg.ramMB !== undefined ? ' · RAM libre ' + mg.ramMB + ' MB' : '') +
            '.\nProbá «Sin gramática» (si no se cierra, la causa es la gramática) o un modelo más chico (si se cierra igual, es la memoria).';
          KiuAutoprueba.limpiarMigas();
        }
      } catch (eMg) { }
      this.bindOrch();
    },
    /* ---------- v1.8.0: panel del Orquestador — v2.0 mapa de roles ---------- */
    renderOrch: function () {
      var tg = document.getElementById('tg-orch');
      if (tg) tg.classList.toggle('on', !!S.router.on);
      var modeLbl = document.getElementById('orch-mode-lbl');
      if (modeLbl) modeLbl.textContent = S.router.on ? 'Auto decide' : 'Apagado';
      var body = document.getElementById('orch-body');
      if (body) body.classList.toggle('hidden', !S.router.on || !S.router.adv);
      var advBtn = document.getElementById('orch-adv-btn');
      if (advBtn) advBtn.classList.toggle('hidden', !S.router.on);
      /* v2.0: filas compactas por rol con el destino resuelto */
      var rowsEl = document.getElementById('orch-rows');
      if (rowsEl) {
        if (!S.router.on) {
          rowsEl.innerHTML = '<div class="k2-row" style="cursor:default"><span class="k2-tile tl-dim">' + icon('spark', 17) + '</span><div class="k2-row-mid"><p class="k2-row-tt">Apagado</p><p class="k2-row-sub">Se usa el orden de siempre: servidor → teléfono → APIs</p></div></div>';
        } else {
          var ROLES = [
            { id: 'fast', tt: 'Charla y voz', tile: 'tl-blue', ic: 'conv', pre: 'Rápido · ' },
            { id: 'brain', tt: 'Cerebro (razonar, código)', tile: 'tl-violet', ic: 'cpu', pre: 'Cerebro · ' },
            { id: 'vision', tt: 'Fotos (visión)', tile: 'tl-pink', ic: 'eye', pre: 'Visión · ' }
          ];
          rowsEl.innerHTML = ROLES.map(function (r) {
            var v = S.router[r.id] || 'auto';
            var sub, tag, tagCls = 'k2-tag t-' + (r.id === 'fast' ? 'blue' : r.id === 'brain' ? 'violet' : 'pink');
            if (v === 'auto') {
              var pick = Orch.pickModel(r.id);
              sub = r.id === 'vision' ? 'servidor o API con visión · si no hay, contesta el teléfono' : (pick ? r.pre + prettyName(pick) : (r.id === 'fast' ? 'el más chico descargado' : 'el más grande que entre en RAM'));
              tag = 'AUTO →';
            } else if (v === 'kiu') {
              var pref = r.id === 'brain' ? (S.router.kiuBrain || '') : r.id === 'vision' ? (S.router.kiuVis || '') : (S.router.kiuFast || '');
              sub = 'Motor interno del teléfono' + (pref ? ' · ' + prettyName(pref) : (r.id === 'vision' ? ' · responde al texto de la foto' : ''));
              tag = 'TELÉFONO'; tagCls = 'k2-tag t-teal';
            } else if (v === 'loc') {
              sub = 'Servidor en tu red (Ollama / LM Studio)';
              tag = 'SERVIDOR'; tagCls = 'k2-tag t-teal';
            } else {
              var pv = provDef(v.slice(5));
              sub = 'API · ' + (pv ? pv.name : v.slice(5));
              tag = (pv ? pv.name : v.slice(5)).toUpperCase().slice(0, 12); tagCls = 'k2-tag t-dim';
            }
            return '<button class="k2-row" data-orch-role="' + r.id + '"><span class="k2-tile ' + r.tile + '">' + icon(r.ic, 17) + '</span><div class="k2-row-mid"><p class="k2-row-tt">' + r.tt + '</p><p class="k2-row-sub">' + esc(sub) + '</p></div><span class="' + tagCls + '">' + tag + '</span></button>';
          }).join('');
        }
      }
      var setSeg = function (id, val) {
        var el = document.getElementById(id);
        if (!el) return;
        var bs = el.querySelectorAll('.seg-btn');
        for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('active', bs[i].getAttribute('data-rv') === val);
      };
      setSeg('orch-fast', S.router.fast || 'auto');
      setSeg('orch-brain', S.router.brain || 'auto');
      setSeg('orch-vision', S.router.vision || 'auto');
      /* modelos preferidos del teléfono por rol */
      var gufs = [];
      for (var k in S.dl.done) {
        if (!Object.prototype.hasOwnProperty.call(S.dl.done, k)) continue;
        var c = modCatByFile(k);
        if (c && c.eng === 'kiu' && modKind(k) === 'text') gufs.push(k);
      }
      gufs.sort();
      var fill = function (id, val, all) {
        var sel = document.getElementById(id);
        if (!sel) return;
        var opts = ['<option value="">— sin preferencia —</option>'].concat(gufs.map(function (g) {
          return '<option value="' + esc(g) + '"' + (g === val ? ' selected' : '') + '>' + esc(g.replace(/\.gguf$/i, '')) + '</option>';
        }));
        sel.innerHTML = opts.join('');
        sel.disabled = !gufs.length;
      };
      fill('orch-kiufast', S.router.kiuFast || '');
      fill('orch-kiubrain', S.router.kiuBrain || '');
      fill('orch-kiuvis', S.router.kiuVis || '');
      var sub = document.getElementById('orch-sub');
      if (sub) sub.textContent = S.router.on
        ? ('Charla: ' + Orch.chip('fast') + ' · Cerebro: ' + Orch.chip('brain') + ' · Fotos: ' + Orch.chip('vision'))
        : 'Apagado: se usa el orden de siempre';
    },
    bindOrch: function () {
      var self = this;
      var tg = document.getElementById('tg-orch');
      if (tg) tg.addEventListener('click', function () {
        S.router.on = !S.router.on;
        saveS();
        self.renderOrch();
        self.toast(S.router.on ? 'Orquestador activo: Kiu elige el modelo por tarea' : 'Orquestador apagado');
      });
      /* v2.0: tocar una fila de rol abre el ajuste fino */
      var rows = document.getElementById('orch-rows');
      if (rows) rows.addEventListener('click', function (ev) {
        var r = ev.target.closest('[data-orch-role]');
        if (!r) return;
        S.router.adv = true;
        saveS();
        self.renderOrch();
      });
      var advB = document.getElementById('orch-adv-btn');
      if (advB) advB.addEventListener('click', function () {
        S.router.adv = !S.router.adv;
        saveS();
        self.renderOrch();
      });
      var wireSeg = function (id, key) {
        var el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('click', function (ev) {
          var b = ev.target.closest('.seg-btn');
          if (!b) return;
          S.router[key] = b.getAttribute('data-rv') || 'auto';
          saveS();
          self.renderOrch();
        });
      };
      wireSeg('orch-fast', 'fast');
      wireSeg('orch-brain', 'brain');
      wireSeg('orch-vision', 'vision');
      var sf = document.getElementById('orch-kiufast');
      if (sf) sf.addEventListener('change', function () { S.router.kiuFast = this.value; saveS(); self.renderOrch(); });
      var sb = document.getElementById('orch-kiubrain');
      if (sb) sb.addEventListener('change', function () { S.router.kiuBrain = this.value; saveS(); self.renderOrch(); });
      var sv = document.getElementById('orch-kiuvis');
      if (sv) sv.addEventListener('change', function () { S.router.kiuVis = this.value; saveS(); self.renderOrch(); });
    },

    /* ---------- v2.9.3 · diagnóstico de voz ----------
       La lógica vive en app/diag-voz.js, que es un módulo chico con una sola
       dependencia (bridge). Estaba acá adentro y no se podía testear: cargar
       app-ui.js en un arnés arrastra media app (store, DOM, timers) y los tests
       pasaban sin ejercitar nada, que es la forma más fácil de tener un test
       que no prueba. */
    verReal: function (cb) { return KiuDiagVoz.verReal(cb); },
    diagVoz: function () { return KiuDiagVoz.diagVoz(); },
    renderDiagVoz: function () { return KiuDiagVoz.render(); },

    /* ---------- v1.7.0: diagnóstico «Revisar mi configuración» ---------- */
    diag: function () {
      var self = this;
      bcrumb('diagnóstico');
      var body = this.modal('Revisar mi configuración', '<p class="set-hint" id="diag-run">Revisando tu configuración…</p>');
      if (!body) return;
      var items = [];
      function add(ok, t, m, fix) { items.push({ ok: ok, t: t, m: m, fix: fix || null }); }
      var act = this.activeProvs();
      var ps = act.map(function (pv) {
        var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        var to = setTimeout(function () { if (ctrl) ctrl.abort(); }, 7000);
        var t0 = Date.now();
        return fetch(pv.st.url.replace(/\/+$/, '') + '/models', { headers: self.provHeaders(pv), signal: ctrl ? ctrl.signal : undefined })
          .then(function (r) {
            clearTimeout(to);
            var ms = Date.now() - t0;
            if (!r.ok) {
              var why = r.status === 401 || r.status === 403 ? 'la clave API que tienes guardada fue rechazada'
                : r.status === 429 ? 'llegaste al límite de uso del servicio'
                  : 'el servicio respondió con error ' + r.status;
              add(false, pv.def.name + ': no conecta', why, { lbl: 'Revisar ' + pv.def.name, go: 'api' });
              return null;
            }
            return r.json().then(function (j) {
              var n = (j && j.data && j.data.length) || 0;
              var have = !!(pv.st.model);
              add(true, pv.def.name + ': listo', 'Conecta bien (' + ms + ' ms)' + (n ? ' · ' + n + ' modelos disponibles' : '') + (have ? ' · modelo: ' + pv.st.model : ' · sin modelo fijado (Kiu elige solo)'));
              return null;
            });
          })
          .catch(function (e) {
            clearTimeout(to);
            var msg = (e && e.name === 'AbortError') ? 'no respondió en 7 segundos' : 'sin conexión hacia el servicio';
            add(false, pv.def.name + ': sin conexión', msg + '. Si es un servidor local, mirá que esté encendido y en la misma red.', { lbl: 'Revisar ' + pv.def.name, go: 'api' });
            return null;
          });
      });
      /* motor interno */
      var kiuOk = Kiu.available();
      Mod.sync(function () {
        var kf = Mod.hasKiu();
        if (!kiuOk) {
          add('warn', 'Motor interno', 'Este teléfono no puede correr el motor de Kiu (no tiene las librerías). Usá el servidor local o APIs.', { lbl: 'Ver servidor local', go: 'settings' });
        } else if (!kf) {
          add('warn', 'Motor interno', 'El teléfono puede correr modelos, pero no descargaste ninguno todavía. Sin internet, Kiu solo usa su cerebro local básico.', { lbl: 'Descargar un modelo', go: 'models' });
        } else if (!S.kiu.ok) {
          add('warn', 'Motor interno', 'Tienes ' + kf + ' modelo(s) descargado(s) pero ninguno está cargado en memoria. Cárgalo para que funcione sin internet.', { lbl: 'Cargar ahora', go: 'models' });
        } else {
          add(true, 'Motor interno', 'Listo: ' + S.kiu.name.replace('.gguf', '') + ' cargado en memoria. Kiu responde sin internet.');
        }
        /* servidor local */
        if (S.loc.url && !S.loc.ok) {
          add('warn', 'Servidor local', 'Guardaste la dirección ' + S.loc.url + ' pero ahora no responde. ¿Está encendido el PC o el Ollama?', { lbl: 'Probar de nuevo', go: 'settings' });
        } else if (S.loc.ok) {
          add(true, 'Servidor local', 'Conecta y responde (' + S.loc.latency + ' ms). Modelos: ' + (S.loc.models || []).length + '.');
        }
        /* espacio */
        var free = Mod.free();
        if (free && free < 2147483648) {
          add('warn', 'Espacio', 'Te quedan ' + Mod.gb(free) + ' libres. Para descargar un modelo conviene tener al menos 3 GB.', { lbl: 'Ver modelos', go: 'models' });
        } else if (free) {
          add(true, 'Espacio', Mod.gb(free) + ' libres: suficiente para modelos.');
        }
        /* RAM */
        var dd = Sys.d || {};
        if (dd.ramAvail) {
          var gb = dd.ramAvail / 1073741824;
          if (gb < 1.2) add('warn', 'RAM', 'Solo ' + Mod.gb(dd.ramAvail) + ' de RAM libre. Cerrá otras apps para que los modelos vayan fluidos.');
          else add(true, 'RAM', Mod.gb(dd.ramAvail) + ' libres de ' + Mod.gb(dd.ramTotal) + '.');
        }
        /* voz */
        var vs = 0;
        try { vs = (JSON.parse(BR.listVoices() || '[]') || []).length; } catch (e) { }
        if (BR && BR.listVoices) {
          if (vs) add(true, 'Voz', vs + ' voces disponibles para hablar contigo.');
          else add('warn', 'Voz', 'Tu teléfono no tiene voces instaladas. Instalá «Google TTS» o «Speech Services» en Ajustes del teléfono.', { lbl: 'Abrir ajustes de voz', act: 'tts' });
        }
        /* claves: sin configurar nada */
        if (!act.length && !S.kiu.ok && !S.loc.ok && !kf) {
          add('warn', 'Primer paso', 'Kiu funciona con su cerebro local, pero para todo su poder: activá una API gratis (Gemini o Groq) o descargá un modelo al teléfono.', { lbl: 'Activar una API', go: 'api' });
        }
        Promise.all(ps).catch(function () { }).then(function () { self.diagRender(items); });
      });
    },
    diagRender: function (items) {
      var bad = items.filter(function (i) { return i.ok === false; }).length;
      var warn = items.filter(function (i) { return i.ok === 'warn'; }).length;
      var head = bad ? ('Encontré ' + bad + ' problema' + (bad === 1 ? '' : 's') + (warn ? ' y ' + warn + ' aviso' + (warn === 1 ? '' : 's') : '') + '. Te explico cómo arreglarlos:')
        : warn ? ('Todo lo importante funciona. Tengo ' + warn + ' consejo' + (warn === 1 ? '' : 's') + ' para que vaya mejor:')
          : '¡Todo está bien! Así configurado, Kiu funciona a full.';
      var html = '<p class="set-hint" style="margin:2px 0 12px">' + esc(head) + '</p><div class="diag-list">' + items.map(function (it) {
        var ic = it.ok === true ? '<span class="diag-ic ok">' + icon('check', 15) + '</span>'
          : it.ok === false ? '<span class="diag-ic no">' + icon('x', 15) + '</span>'
            : '<span class="diag-ic wa">!</span>';
        var fix = '';
        if (it.fix) fix = '<button class="chip-btn" data-dfix="' + esc(it.fix.lbl) + '" data-dgo="' + esc(it.fix.go || '') + '" data-dact="' + esc(it.fix.act || '') + '">' + esc(it.fix.lbl) + '</button>';
        return '<div class="diag-item"><div class="diag-row">' + ic + '<div class="diag-txt"><strong>' + esc(it.t) + '</strong><span>' + esc(it.m) + '</span></div></div>' + fix + '</div>';
      }).join('') + '</div>';
      var body = this.modal('Revisar mi configuración', html);
      if (!body) return;
      body.addEventListener('click', function (ev) {
        var b = ev.target.closest('[data-dfix]');
        if (!b) return;
        var go = b.getAttribute('data-dgo');
        var act = b.getAttribute('data-dact');
        App.closeModal();
        if (go) App.go(go);
        if (act === 'tts') App.openUrl('https://play.google.com/store/apps/details?id=com.google.android.tts');
      });
    },

    /* ---------- v1.7.0: navegador dentro del chat ---------- */
    browser: function (url, note) {
      var p = document.getElementById('chat-browser');
      if (!p) { this.openUrl(url); return; }
      this.go('chat');
      p.classList.remove('hidden');
      document.getElementById('cb-url').value = url || '';
      document.getElementById('cb-msg').textContent = note || 'Algunas webs no dejan verse dentro de otras apps: si queda en blanco, usá «Abrir afuera».';
      document.getElementById('cb-frame').src = url || 'about:blank';
      /* v2.8.0: abrir una web NO es 'Indexando' (la lupa sobre un documento). Es
         Kiu yendo a buscar algo: estado 'Enrutando', y solo si nada más manda. */
      stRuta();
      var self = this;
      clearTimeout(this._cbT);
      this._cbT = setTimeout(function () { stClear('ruta'); }, 2600);
    },
    browserGo: function () {
      var u = document.getElementById('cb-url').value.trim();
      if (!u) return;
      if (u.indexOf('http') !== 0) u = 'https://' + u;
      this.browser(u);
    },
    browserClose: function () {
      var p = document.getElementById('chat-browser');
      p.classList.add('hidden');
      document.getElementById('cb-frame').src = 'about:blank';
    },
    bindBrowser: function () {
      var self = this;
      var go = document.getElementById('cb-go');
      if (go) go.addEventListener('click', function () { self.browserGo(); });
      var inp = document.getElementById('cb-url');
      if (inp) inp.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') self.browserGo(); });
      var x = document.getElementById('cb-close');
      if (x) x.addEventListener('click', function () { self.browserClose(); });
      var out = document.getElementById('cb-out');
      if (out) out.addEventListener('click', function () {
        var u = document.getElementById('cb-url').value.trim();
        if (u) self.openUrl(u);
      });
    },

    /* v1.7.0: chips de fuentes al final de la respuesta (DOM real, no texto) */
    appendSources: function (snips) {
      var el = document.getElementById('chat-messages');
      if (!el || !snips || !snips.length) return;
      var bar = document.createElement('div');
      bar.className = 'chips-bar';
      bar.style.marginTop = '6px';
      bar.innerHTML = snips.slice(0, 3).map(function (s) {
        return '<button class="chip" data-openurl="' + esc(s.u) + '">' + esc(s.t.slice(0, 34)) + '</button>';
      }).join('');
      el.appendChild(bar);
      el.scrollTop = el.scrollHeight;
    },

    /* ---------- v1.7.0: el agente busca en la web sin salir del chat ---------- */
    webSearch: function (q) {
      var self = this;
      bcrumb('buscando en la web: ' + String(q || '').slice(0, 40));
      stRuta();
      this.showTyping(true);
      this._cancelled = false;
      var enc = encodeURIComponent(q.replace(/^busca\s+/i, '').trim());
      var snippets = [], done = false;
      function to() { var c = (typeof AbortController !== 'undefined') ? new AbortController() : null; setTimeout(function () { if (c) c.abort(); }, 8000); return c ? c.signal : undefined; }
      var p1 = fetch('https://api.duckduckgo.com/?q=' + enc + '&format=json&no_html=1&skip_disambig=1', { signal: to() })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (!j) return;
          var t = (j.AbstractText || '').trim();
          if (t && j.AbstractURL) snippets.push({ t: (j.Heading || 'Fuente').slice(0, 60), s: t.slice(0, 500), u: j.AbstractURL });
          var rt = (j.RelatedTopics || []);
          for (var i = 0; i < rt.length && snippets.length < 3; i++) {
            if (rt[i] && rt[i].Text && rt[i].FirstURL) snippets.push({ t: rt[i].Text.slice(0, 60), s: rt[i].Text.slice(0, 400), u: rt[i].FirstURL });
          }
        }).catch(function () { });
      var p2 = fetch('https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=' + enc + '&format=json&origin=*&srlimit=3', { signal: to() })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          var hits = j && j.query && j.query.search || [];
          for (var i = 0; i < hits.length && snippets.length < 3; i++) {
            var sn = String(hits[i].snippet || '').replace(/<[^>]+>/g, '');
            snippets.push({ t: hits[i].title.slice(0, 60), s: sn.slice(0, 400), u: 'https://es.wikipedia.org/wiki/' + encodeURIComponent(String(hits[i].title).replace(/ /g, '_')) });
          }
        }).catch(function () { });
      var p3 = fetch('https://r.jina.ai/https://lite.duckduckgo.com/lite/?q=' + enc, { signal: to() })
        .then(function (r) { return r.ok ? r.text() : ''; })
        .then(function (t) {
          if (!t || snippets.length >= 2) return;
          var clean = String(t).replace(/\n{2,}/g, '\n').slice(0, 900);
          if (clean) snippets.push({ t: 'Resultados de la web', s: clean, u: 'https://lite.duckduckgo.com/lite/?q=' + enc });
        }).catch(function () { });
      Promise.all([p1, p2, p3]).then(function () {
        if (self._cancelled) return;
        self.showTyping(false);
        if (!snippets.length) {
          stClear('ruta');
          stErr('Error', 2600);
          self.botSay('No pude buscar en la web ahora (sin conexión o los servicios no respondieron). Probá de nuevo en un momento.');
          return;
        }
        var ctx = snippets.map(function (s, i) { return '[' + (i + 1) + '] ' + s.t + ': ' + s.s; }).join('\n');
        var pv = (S.mode !== 'local') ? Rtr.order('search')[0] : null;
        if (pv) {
          var msgs = self.apiMsgs(q, true, null);
          msgs[msgs.length - 1] = {
            role: 'user',
            content: q + '\n\n[Información encontrada en la web]\n' + ctx + '\n\nRespondé breve y claro con esa información. Si un dato no está en la lista, decilo en vez de inventarlo.'
          };
          stRuta();
          self.apiStream('', function () { }, pv, null, msgs).then(function (out) {
            if (out.ok) {
              Rtr.fine(pv.def.id);
              self.botSay(out.text);
              self.appendSources(snippets);
              var hist = chatHist();
              var last = hist[hist.length - 1];
              if (last && last.role === 'bot') { last.text += '\n\nFuentes: ' + snippets.slice(0, 3).map(function (s) { return s.t; }).join(' · '); saveHist(hist); }
            } else {
              Rtr.fail(pv.def.id, /clave|401|403|429/.test(out.err));
              stPausa();   /* ese proveedor se aparta un rato */
              self.botSay('Encontré esto en la web:\n\n' + ctx);
              self.appendSources(snippets);
            }
            stClear('ruta');
          });
        } else {
          self.botSay('Esto encontré en la web sobre «' + q + '»:\n\n' + ctx);
          self.appendSources(snippets);
          stClear('ruta');
        }
        setTimeout(function () { if (snippets[0]) self.browser(snippets[0].u, 'La búsqueda abrió en el navegador de Kiu, sin salir del chat.'); }, 600);
      });
    },

    /* ---------- Chat ---------- */
    bindChat: function () {
      var self = this;
      var inp = document.getElementById('chat-input');
      document.getElementById('btn-send').innerHTML = icon('send', 19);
      document.getElementById('btn-mic').innerHTML = icon('mic', 19);
      document.getElementById('btn-attach').innerHTML = icon('plus', 20);
      function submitChat() {
        var v = inp.value.trim();
        var img = self._pendingImg || null, th = self._pendingThumb || null;
        if (!v && !img) return;
        self.clearPhoto();
        inp.value = '';
        self.sendMsg(v || '¿Qué ves en esta imagen?', img, th);
      }
      document.getElementById('btn-send').addEventListener('click', submitChat);
      inp.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') submitChat();
      });
      /* v2.8.0: 'Entrada' solo cuando se escribe EN EL CHAT. Antes había un
         listener global en kiu-avatar-boot.js que reaccionaba a cualquier campo de
         texto: Ajustes, claves de API, el buscador del navegador... y el bot se
         ponía 'Entrada' mientras el usuario completaba su clave de OpenAI. */
      inp.addEventListener('input', function () { stFlash('Entrada', 1800); });
      document.getElementById('btn-mic').addEventListener('click', function () { self.startVoice(); });
      var convBtn = document.getElementById('chat-conv-toggle');
      if (convBtn) convBtn.addEventListener('click', function () { self.setConv(S.conv === false); });
      document.getElementById('chat-voice-toggle').addEventListener('click', function () {
        S.voiceOn = !S.voiceOn; saveS();
        document.getElementById('chat-voice-toggle').classList.toggle('on', S.voiceOn);
        self.toast(S.voiceOn ? 'Kiu va a responder en voz alta' : 'Respuestas de voz apagadas');
        if (!S.voiceOn) bridge('stopSpeak');
      });
      document.getElementById('btn-attach').addEventListener('click', function () { self.attachMenu(); self.track('herramientas'); });
      /* Foto para visión local (adjuntar → cámara/galería) */
      var photoIn = document.getElementById('photo-input');
      if (photoIn) {
        photoIn.addEventListener('change', function () {
          var f = photoIn.files && photoIn.files[0];
          if (!f) return;
          self.downscale(f, 1024, 0.82, function (full) {
            self._pendingImg = full;
            self.downscale(f, 240, 0.72, function (thumb) {
              self._pendingThumb = thumb;
              var bar = document.getElementById('photo-bar');
              var tmb = document.getElementById('photo-thumb');
              if (tmb) tmb.src = thumb;
              if (bar) bar.classList.remove('hidden');
              self.closeModal();
              self.toast('Foto lista · escribí qué querés saber y envía');
            });
          });
          photoIn.value = '';
        });
        var prRm = document.getElementById('photo-remove');
        if (prRm) {
          prRm.innerHTML = icon('x', 16);
          prRm.addEventListener('click', function () { self.clearPhoto(); self.toast('Foto quitada'); });
        }
      }
      var clv = document.getElementById('chat-conv-list');
      if (clv) { clv.innerHTML = icon('list', 18); clv.addEventListener('click', function () { self.convListModal(); }); }
      var ttg = document.getElementById('chat-tools-toggle');
      if (ttg) ttg.addEventListener('click', function () { self.toggleToolsPanel(); });
    },
    renderChips: function () {
      var h = new Date().getHours();
      var all = [
        ['¿Cuánta batería queda?', '¿Qué hora es?', 'Enciende la linterna', 'Temporizador 5 minutos', 'Recuérdame llamar a mamá a las 9'],
        ['Calcula 12.8 * 100', 'Genera una contraseña', '¿Cuánto espacio libre tengo?', 'Nota: idea para el proyecto', 'Pon alarma a las 7 y media'],
        ['Manda un whatsapp a Juan diciendo ya llego', 'Busca gatos en youtube', 'Mis recordatorios', 'Divide 24500 entre 4', 'Recuérdame tomar agua en 2 horas']
      ];
      var base = h >= 6 && h < 13 ? all[0] : h >= 13 && h < 20 ? all[1] : all[2];
      var chips = base.slice(0, 4).concat(all[(h >= 6 && h < 13 ? 1 : h >= 13 && h < 20 ? 2 : 0)].slice(0, 1));
      var bar = document.getElementById('chips-bar');
      bar.innerHTML = chips.map(function (c) { return '<button class="chip">' + esc(c) + '</button>'; }).join('');
      var self = this;
      bar.addEventListener('click', function (ev) {
        var c = ev.target.closest('.chip');
        if (!c) return;
        var txt = c.textContent;
        if (txt === 'Recuérdame llamar a mamá a las 9') {
          self.go('chat');
          document.getElementById('chat-input').value = 'Recuérdame ';
          document.getElementById('chat-input').focus();
          return;
        }
        self.sendMsg(txt);
      });
    },
    renderToolsPanel: function () {
      var panel = document.getElementById('tools-panel');
      if (!panel || !window.KiuTools) return;
      panel.innerHTML = KiuTools.TOOLS.map(function (t) {
        return '<button class="tp-btn" data-tool="' + t.id + '"><span class="ti ' + t.color + '">' + icon(t.ic, 19) + '</span><span>' + esc(t.name) + '</span></button>';
      }).join('');
      panel.addEventListener('click', function (ev) {
        var b = ev.target.closest('[data-tool]');
        if (!b) return;
        for (var i = 0; i < KiuTools.TOOLS.length; i++) {
          if (KiuTools.TOOLS[i].id === b.getAttribute('data-tool')) {
            KiuTools.TOOLS[i].open();
            App.track('herramientas');
          }
        }
        App.toggleToolsPanel(false);
      });
    },
    toggleToolsPanel: function (force) {
      var panel = document.getElementById('tools-panel');
      var btn = document.getElementById('chat-tools-toggle');
      var show = (typeof force === 'boolean') ? force : panel.classList.contains('hidden');
      panel.classList.toggle('hidden', !show);
      btn.classList.toggle('on', show);
    },
    renderChat: function () {
      var hist = chatHist();
      if (!hist.length) {
        hist = [{ role: 'bot', text: 'Hola, soy Kiu, tu agente personal. Vivo en tu teléfono con mi cerebro local, sin nube y sin vueltas.\n\nPuedo encender la linterna, poner alarmas, llamar a tus contactos, mandar WhatsApp, cronometrar, anotar recuerdos y leer la batería y el espacio reales del teléfono.\n\nTocá el micrófono una vez y sigo escuchando después de cada respuesta. Y si activás «Despertar por voz», decí «Kiu» y te escucho incluso con la app cerrada.', ts: Date.now() }];
        saveHist(hist);
      }
      var el = document.getElementById('chat-messages');
      el.innerHTML = hist.map(function (m) { return App.msgHTML(m); }).join('') + '<div class="chat-state" id="chat-state"><i></i><span>Listo para empezar</span></div>';
      this.scrollBottom();
    },
    msgHTML: function (m) {
      var isBot = m.role !== 'user';
      var html = '<div class="msg ' + (isBot ? 'bot' : 'user') + '" data-ts="' + (m.ts || 0) + '">' +
        '<div class="msg-bubble">' + (m.img ? '<img class="msg-img" src="' + m.img + '" alt="foto adjunta">' : '') + this.md(m.text) + '</div>';
      if (isBot) {
        html += '<div class="msg-actions">' +
          '<button class="act-btn" data-act="retry" title="Reintentar">' + icon('refresh', 15) + '</button>' +
          '<button class="act-btn" data-act="copy" title="Copiar">' + icon('copy', 15) + '</button>' +
          '<button class="act-btn" data-act="like" title="Me sirvió">' + icon('thumbs', 15) + '</button>' +
          '<button class="act-btn" data-act="share" title="Compartir">' + icon('share', 15) + '</button>' +
          '</div>';
      }
      html += '<div class="msg-time">' + (m.ts ? new Date(m.ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '') + '</div></div>';
      return html;
    },
    bindMsgActions: function () {
      var el = document.getElementById('chat-messages');
      el.addEventListener('click', function (ev) {
        /* v1.7.0: fuentes de la búsqueda web → navegador de Kiu */
        var ob = ev.target.closest('[data-openurl]');
        if (ob) { App.browser(ob.getAttribute('data-openurl')); return; }
        /* Enlaces de las respuestas: se abren con el puente, sin navegar el WebView */
        var lnk = ev.target.closest('a.msg-link');
        if (lnk) {
          ev.preventDefault();
          var href = lnk.getAttribute('data-href') || lnk.getAttribute('href');
          /* v1.7.0: los enlaces se abren en el navegador de Kiu, sin salir del chat */
          if (S.linksInApp && /^https?:/i.test(href)) App.browser(href);
          else if (!App.openUrl(href)) App.copyText(href);
          return;
        }
        /* v2.14.7: el botón de acción de la tarjeta de error */
        var acc = ev.target.closest('[data-kiu-act]');
        if (acc) {
          ev.preventDefault();
          var a2 = acc.getAttribute('data-kiu-act') || '';
          if (a2 === 'kiu://liberar-motor') { Kiu.forceReset(); Kiu.unload(); self.toast('Motor liberado'); self.go('models'); }
          else if (a2 === 'kiu://modelos') { self.go('models'); }
          else if (a2 === 'kiu://vision') { self.go('models'); self.toast('Conectá un servidor o una API con visión'); }
          else if (a2 === 'kiu://reintentar') {
            var hist2 = chatHist();
            var prev2 = null;
            for (var j2 = hist2.length - 1; j2 >= 0; j2--) {
              if (hist2[j2].role === 'user') { prev2 = hist2[j2]; break; }
            }
            if (prev2) { self.toast('Reintentando…'); self.sendMsg(prev2.text); }
            else self.toast('No encontré la pregunta original');
          }
          return;
        }
        /* Botón copiar de los bloques de código */
        var cc = ev.target.closest('.code-copy');
        if (cc) {
          App.copyText(decodeURIComponent(cc.getAttribute('data-code') || ''));
          cc.textContent = '¡Copiado!';
          setTimeout(function () { cc.textContent = 'Copiar'; }, 1400);
          return;
        }
        var btn = ev.target.closest('.act-btn');
        if (!btn) return;
        var row = btn.closest('.msg');
        var act = btn.getAttribute('data-act');
        var ts = parseInt(row.getAttribute('data-ts'), 10);
        var hist = chatHist();
        var idx = -1;
        for (var i = 0; i < hist.length; i++) if (hist[i].ts === ts) { idx = i; break; }
        var mine = idx >= 0 ? hist[idx] : { text: row.querySelector('.msg-bubble') ? row.querySelector('.msg-bubble').textContent : '' };
        if (act === 'copy') {
          App.copyText(mine.text);
          App.toast('Respuesta copiada');
        } else if (act === 'share') {
          if (!App.shareText(mine.text)) App.copyText(mine.text);
          App.toast('Abriendo para compartir');
        } else if (act === 'like') {
          btn.classList.toggle('liked');
          App.toast(btn.classList.contains('liked') ? '¡Me alegra que sirviera!' : '');
        } else if (act === 'retry') {
          var prev = null;
          for (var j = idx - 1; j >= 0; j--) {
            if (hist[j].role === 'user') { prev = hist[j]; break; }
          }
          if (prev) {
            App.toast('Reintentando…');
            App.sendMsg(prev.text);
          } else {
            App.toast('No encontré la pregunta original');
          }
        }
      });
    },
    /* v2.8.0: el pill se arma con los NOMBRES REALES de los 37 estados, no con los
       13 alias viejos. Antes todo lo que no fuera de esos 13 caía en 'idle' y la
       pastilla decía «Listo para empezar» mientras el bot estaba descargando un
       modelo o generando. */
    chatStateLabel: function () {
      var av = (window.KiuState && KiuState.get()) ? KiuState.get() : ((window.KiuAvatar && KiuAvatar.state()) || 'Inactivo');
      var map = {
        'Inactivo': ['Listo para empezar', ''],
        'Reposo de voz': ['Sin micrófono', ''],
        'Entrada': ['Escribiendo…', 'busy'],
        'Dictando': ['Te escucho…', 'voice'],
        'Escuchando': ['Te escucho…', 'voice'],
        'Hablando': ['Hablando…', 'voice'],
        'Manos libres': ['Te escucho…', 'voice'],
        'Palabra de activación': ['Esperando «Kiu»', 'voice'],
        'Armando prompt': ['Armando la respuesta…', 'busy'],
        'Reglas offline': ['Pensando…', 'busy'],
        'Enrutando': ['Investigando…', 'busy'],
        'Generando': ['Generando…', 'busy'],
        'Proveedor en pausa': ['Probando otro modelo…', 'busy'],
        'Respuesta lista': ['Listo', ''],
        'Detenido': ['Detenido', 'busy'],
        'Error': ['Ups, hubo un error', 'busy'],
        'Motor no soportado': ['Este teléfono no corre el motor', 'busy'],
        'Usar nube/Ollama': ['Usando nube u Ollama', ''],
        'Sin modelo': ['Descargá un modelo', ''],
        'Descargando': ['Descargando modelo…', 'busy'],
        'Error de descarga': ['Falló la descarga', 'busy'],
        'Descargado': ['Modelo descargado', ''],
        'Importando': ['Importando modelo…', 'busy'],
        'Cargando': ['Cargando modelo…', 'busy'],
        'Cargado': ['Modelo listo', ''],
        'Ocupado': ['Motor ocupado', 'busy'],
        'Liberado': ['Motor liberado', ''],
        'Acción del dispositivo': ['Trabajando…', 'busy'],
        'Sin permiso de alarma exacta': ['Falta permiso de alarma exacta', 'busy'],
        'Programado': ['Recordatorio programado', ''],
        'Disparado': ['¡Alarma!', 'busy'],
        'Cancelado': ['Cancelado', ''],
        'Reprogramado al reiniciar': ['Alarmas restauradas', ''],
        'Temporizador nativo': ['Temporizador en marcha', 'busy'],
        'RAG apagado': ['Sin documentos', ''],
        'Indexando': ['Leyendo documentos…', 'busy'],
        'RAG activo': ['Con tus documentos', '']
      };
      return { av: av, label: map[av] || map['Inactivo'] };
    },
    syncChatState: function () {
      var pill = document.getElementById('chat-state');
      var st = document.getElementById('chat-status');
      var cur = this.chatStateLabel();
      var av = cur.av, m = cur.label;
      if (pill && m[0]) {
        pill.querySelector('span').textContent = m[0];
        pill.className = 'chat-state' + (m[1] ? ' ' + m[1] : '');
      }
      if (st) {
        if (av === 'Inactivo') {
          var act = this.activeProvs();
          st.textContent = (S.mode !== 'local' && act.length) ? ('Listo · ' + act[0].def.name) : 'Listo para empezar';
        } else {
          st.textContent = m[0];
        }
      }
      /* v1.7.0: botón Colgar visible mientras Kiu escucha o habla
         (pero no cuando el overlay de voz ya trae su propio botón Colgar) */
      var hc = document.getElementById('hang-chip');
      var ov = document.getElementById('voice-pulse');
      if (hc) {
        var voice = (av === 'Escuchando' || av === 'Hablando' || av === 'Dictando');
        var busy = (voice || App.voiceBusy) && (!ov || ov.classList.contains('hidden'));
        hc.classList.toggle('hidden', !busy);
      }
    },
    md: function (txt) {
      var t = esc(txt);
      var blocks = [];
      /* 1) Bloques de código ```...```: se apartan para que nada los toque */
      t = t.replace(/```[a-zA-Z0-9+#-]*\n?([\s\S]*?)```/g, function (_, code) {
        var c = code.replace(/\n$/, '');
        var raw = c.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'); /* v2.7.1: copiar el codigo real, no las entidades HTML */
        blocks.push('<div class="codeblock"><button class="code-copy" data-code="' + encodeURIComponent(raw) + '">Copiar</button><pre><code>' + c + '</code></pre></div>');
        return '\u0000' + (blocks.length - 1) + '\u0000';
      });
      /* 1-bis) TARJETA DE ERROR (v2.14.7).
         Las líneas que empiezan con "!! " no son una respuesta del bot: son
         un problema de la app, y tienen que verse distinto, con su ícono y
         su acción. Sin esto, un fallo salía como un párrafo más mezclado con
         lo que Kiu dice, y la persona no sabía si Kiu había fallado.
         Formato:
           !! **Título**
           !! detalle
           !! → [Acción](kiu://accion) */
      t = t.replace(/(^|\n)((?:!! ?[^\n]*\n?)+)/g, function (_, pre, run) {
        var ls = run.split('\n').filter(function (x) { return x.indexOf('!!') === 0; });
        var acc = '';
        var mAcc = null;
        for (var ai = 0; ai < ls.length; ai++) {
          mAcc = ls[ai].match(/→\s*\[([^\]]+)\]\((kiu:\/\/[^)\s]+)\)/);
          if (mAcc) { ls[ai] = ls[ai].replace(/→\s*\[[^\]]+\]\([^)\s]+\)/, ''); break; }
        }
        var inner = ls.map(function (x) { return x.replace(/^!! ?/, '').trim(); }).filter(function (x) { return !!x; }).join('<br>');
        inner = inner.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
        if (mAcc) {
          acc = '<button class="errcard-act" data-kiu-act="' + esc(mAcc[2]) + '">' + esc(mAcc[1]) + '</button>';
        }
        blocks.push('<div class="errcard"><span class="errcard-ic">' + icon('alert', 16) + '</span><div class="errcard-body">' + inner + acc + '</div></div>');
        return pre + '\u0000' + (blocks.length - 1) + '\u0000';
      });
      /* 2) Código en línea */
      t = t.replace(/`([^`\n]+)`/g, function (_, code) { /* v2.7.2: se aparta para que negrita y links no se procesen dentro */
        blocks.push('<code>' + code + '</code>');
        return '\u0000' + (blocks.length - 1) + '\u0000';
      });
      /* 3) Enlaces [texto](url) */
      t = t.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" class="msg-link" data-href="$2">$1</a>');
      /* 4) Títulos markdown */
      t = t.replace(/^#{1,4}\s+(.+)$/gm, '<h4>$1</h4>');
      /* 5) Negrita y cursiva */
      t = t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
      t = t.replace(/(^|[\s(«"\u00A0])\*([^*\n]{2,})\*(?=[\s).,:;!?»"\u00A0]|$)/g, '$1<i>$2</i>');
      /* 6) Listas: agrupa líneas consecutivas con - • * o 1. */
      var lines = t.split('\n'), out = [], kind = null, items = [];
      function flush() {
        if (!kind) return;
        out.push('<' + kind + '>' + items.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</' + kind + '>');
        kind = null; items = [];
      }
      for (var i = 0; i < lines.length; i++) {
        var L = lines[i];
        var mU = L.match(/^\s*(?:[-*•])\s+(.*)$/);
        var mO = L.match(/^\s*(\d+)[.)]\s+(.*)$/);
        if (mU) {
          if (kind === 'ol') flush();
          kind = 'ul'; items.push(mU[1]);
        } else if (mO) {
          if (kind === 'ul') flush();
          kind = 'ol'; items.push(mO[2]);
        } else { flush(); out.push(L); }
      }
      flush();
      t = out.join('\n');
      /* 7) Saltos de línea (fuera de bloques) */
      t = t.replace(/\n/g, '<br>');
      t = t.replace(/(<\/(?:ul|ol|h4)>)<br>/g, '$1').replace(/<br>(<(?:ul|ol|h4)[ >])/g, '$1');
      /* 8) Vuelven los bloques de código */
      t = t.replace(/\u0000(\d+)\u0000/g, function (_, ix) { return blocks[parseInt(ix, 10)] || ''; });
      return t;
    },
    scrollBottom: function () {
      var el = document.getElementById('chat-messages');
      setTimeout(function () { el.scrollTop = el.scrollHeight; }, 60);
    },
    pushMsg: function (role, text, skipDom, imgThumb) {
      var hist = chatHist();
      var msg = { role: role, text: text, ts: Date.now() };
      if (imgThumb) msg.img = imgThumb;
      hist.push(msg);
      if (hist.length > 400) hist = hist.slice(-400);
      saveHist(hist);
      if (!skipDom) {
        var el = document.getElementById('chat-messages');
        var pill = document.getElementById('chat-state');
        if (pill) pill.remove();
        el.insertAdjacentHTML('beforeend', this.msgHTML(msg));
        if (pill) el.appendChild(pill);
        this.scrollBottom();
      }
      if (role === 'user') this.track('mensajes');
      return msg;
    },
    sendMsg: function (text, imgFull, imgThumb) {
      var self = this;
      bcrumb('enviando: ' + String(text || 'foto').slice(0, 40));
      if (!this.inCall()) this.go('chat');
      /* v2.8.0: al mandar un mensaje Kiu todavía no sabe a quién le va a preguntar.
         Se pone 'Enrutando' y cada rama apaga la suya al terminar. Antes esto usaba
         KiuAvatar.pick(), que adivinaba 'RAG activo' al pedir un poema. */
      stRuta();
      this._kiuStuck = false; /* v2.1.1: nuevo mensaje = nuevo derecho a reintento */
      this.pushMsg('user', text, false, imgThumb);
      this.showTyping(true);
      /* v1.7.0: aprender del usuario + registrar correcciones */
      try {
        if (KB.correct(text)) {
          this._wasCorrection = true;
        } else {
          this._wasCorrection = false;
          KB.extract(text);
        }
      } catch (e) { }
      /* v2.5.0 (sección 4-a): skills instalables — van primero porque el usuario
         los creó para personalizar a Kiu. Si ninguno matchea, sigue el cerebro. */
      try {
        if (window.KiuSkills && KiuSkills.count()) {
          var skHit = KiuSkills.match(text);
          if (skHit) {
            var skOut = KiuSkills.run(skHit);
            if (skOut && skOut.handled) {
              stClear('ruta'); stSet('tool', 'Reglas offline');
              setTimeout(function () {
                self.showTyping(false);
                stClear('tool');
                self.botSay(skOut.text);
                if (skOut.say && !S.voiceOn && self.speak) self.speak(skOut.text);
              }, 420);
              return;
            }
          }
        }
      } catch (eSk) { }
      /* Foto: la resuelve un modelo con visión (orquestador → visión) */
      if (imgFull) {
        var targets0 = Orch.targets('vision');
        /* v2.1: ya no depende de S.mode — si el motor del teléfono está disponible,
           las fotos también intentan resolverse acá (con nota honesta) */
        if (targets0.length) {
          this._cancelled = false;
          this.tryTargets(text, targets0, 0, null, imgFull, 'vision');
          return;
        }
        setTimeout(function () {
          self.showTyping(false);
          /* v2.14.7 · la visión también es una tarjeta: es una limitación
             concreta con una acción concreta, no una respuesta de Kiu. */
          self.botSay('!! **No puedo ver la foto**\n!! El motor del teléfono no tiene visión. Las fotos las contesta tu servidor en red o una API con visión (Gemini, OpenAI, OpenRouter).\n!! → [Conectar visión](kiu://vision)', null, true);
        }, 420);
        return;
      }
      var res = KiuBrain.reply(text);
      if (res.handled) {
        stClear('ruta'); stSet('tool', 'Reglas offline');
        setTimeout(function () {
          self.showTyping(false);
          stClear('tool');
          self.botSay(res.text);
          KB.reinforce(text);
        }, 420);
        return;
      }
      /* v1.8.0: ORQUESTADOR — arma la cadena de modelos según la tarea */
      var task = Rtr.classify(text, false, !!this._voiceDriven);
      /* Búsquedas: el agente investiga en la web con su navegador integrado, sin salir del chat */
      if (task === 'search') { this.webSearch(text); return; }
      /* v2.5.0 (sección 4-c): bucle ReAct — pedidos de varias partes se resuelven
         una por una con las herramientas locales (cerebro + documentos RAG).
         Si ninguna parte se puede, handled:false y sigue el flujo normal. */
      if (window.KiuReAct) {
        try {
          var ract = KiuReAct.run(text);
          if (ract && ract.handled) {
            stClear('ruta'); stSet('tool', 'Reglas offline');
            setTimeout(function () {
              self.showTyping(false);
              stClear('tool');
              self.botSay(ract.text);
              KB.reinforce(text);
            }, 420);
            return;
          }
        } catch (eRa) { }
      }
      /* v2.9.1 — AGENTE: que el MODELO elija la herramienta.
         Va DESPUÉS de skills, cerebro y ReAct a propósito: esas tres resuelven lo
         conocido al instante y sin gastar un solo token — y ninguna de las tres
         conoce una herramienta que todavía no existe. El agente entra para lo que
         los regex no saben, y solo si hay un modelo local cargado: sin modelo,
         Kiu.ask falla y el flujo sigue exactamente igual que antes.

         Va ANTES de la generación normal porque si el agente ejecutó algo, esa ES
         la respuesta: generar un párrafo encima sería tirar el trabajo. Si no
         ejecutó nada, se sigue como si nada. */
      if ((S.kiu.ok || (Kiu.available() && Kiu.best())) && window.KiuAgente && S.agentOn && this.agentGate(text)) {
        try {
          this.showTyping(true);
          stSet('ruta', 'Enrutando', 30000);
          var selfA = this;
          KiuAgente.run({
            habla: [text],
            confirmar: function (tool, args, cbC) { selfA.agentConfirm(tool, args, cbC); },
            /* v2.14.2 · el agente AVISA en qué está. Un turno puede dar 3-4 pasos
               y cada paso es una generación en la CPU del teléfono: sin esto el
               usuario ve "Enrutando" clavado y no sabe si está pensando,
               trabado o haciendo algo. */
            avanzar: function (que, tool) { selfA.agentAvanz(que, tool); },
            resultado: function (tool, ok, txt) { selfA.agentResultado(tool, ok, txt); }
          }, function (ag) {
            if (selfA._cancelled) return;
            if (ag && ag.ok && ag.text) {
              stClear('ruta'); stSet('tool', 'Acción del dispositivo');
              selfA.showTyping(false);
              stClear('tool');
              selfA.botSay(ag.text);
              KB.reinforce(text);
              return;
            }
            /* el agente no encontró nada que hacer: sigue el flujo normal */
            selfA.tryAfterAgent(text, task);
          });
          return;
        } catch (eAg) { /* si el agente explota, el flujo normal continúa */ }
      }
      this.tryAfterAgent(text, task);
    },
    /* v2.12.0 · compuerta del agente: ¿vale la pena gastar una generación para que el
       modelo elija una herramienta? Solo si el mensaje parece una ORDEN. Una pregunta,
       un pedido de texto (explicá, escribí, resumí…) o un mensaje largo se responden
       directo con el modelo: ahí el agente solo agregaba segundos de espera. */
    agentGate: function (text) {
      var t = String(text || '').trim();
      if (!t || t.length > 200) return false;
      var n = t.toLowerCase().normalize ? t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') : t.toLowerCase();
      /* v2.13.0: una pregunta sobre el TELÉFONO del usuario («¿qué tengo mañana?», «¿cuánta
         batería queda?», «¿tengo dentista?») es una orden para una herramienta, no charla. */
      var delTelefono = /\b(tengo|agenda|reunion|evento|cita|calendario|bateria|espacio|alarma|recordatorio|contacto|numero de|hora es|fecha es|dia es|mis (notas|tareas|recuerdos))\b/.test(n);
      if (/[?¿]/.test(t) && !delTelefono) return false;
      if (t.split(/\s+/).length > 24) return false;
      /* interrogativos (palabra entera) y raíces de verbos de «dame un texto» (tuteo y voseo) */
      if (!delTelefono && /^(que|quien|quienes|como|cual|cuales|cuando|donde|por que|porque|cuanto|cuantos)\b/.test(n)) return false;
      if (/^(explic|escrib|reescrib|redact|resum|traduc|compar|analiz|gener|invent|defin|describ|ensen|sugier|suger|recomend|corrig|parafras|cuentame|contame|dime|decime|crea un (cuento|poema|texto))/.test(n)) return false;
      return true;
    },
    /* v2.14.2 · QUÉ ESTÁ HACIENDO EL AGENTE. La pastilla de estado no dice
       "Enrutando" a secas: dice qué herramienta está usando. Es la diferencia
       entre "se trabó" y "está buscando en tu memoria". */
    agentAvanz: function (que, tool) {
      var ETIQUETA = {
        set_alarm: 'Pongo la alarma', read_calendar: 'Miro tu agenda',
        find_contact: 'Busco el contacto', call_contact: 'Marco el teléfono',
        search_docs: 'Busco en tus documentos', device_action: 'Toco el teléfono',
        send_message: 'Preparo el mensaje', remember: 'Guardo en tu memoria',
        recall: 'Busco en tu memoria', manage_task: 'Miro tus tareas',
        manage_alarm: 'Miro tus alarmas', create_calendar_event: 'Creo el evento',
        now: 'Miro la hora', web_search: 'Busco en la web', forget: 'Olvido eso',
        get_weather: 'Miro el clima', manage_routine: 'Miro tus rutinas', read_notifications: 'Miro tus notificaciones', read_sms: 'Leo tus SMS', media_control: 'Controlo la música', summarize_url: 'Leo la página', daily_briefing: 'Preparo tu resumen', log_expense: 'Anoto el gasto'
      };
      var txt = ETIQUETA[tool] || '';
      if (!txt) {
        if (que === 'pensando') txt = 'Pensando…';
        else if (que === 'corrigiendo') txt = 'Corrijo…';
      }
      if (!txt) return;
      stSet('tool', txt, 60000);
      /* v2.14.8 · Y ADEMÁS SE VE. La pastilla de arriba es un instante: la
         acción que Kiu está haciendo se queda en el chat como una TARJETA,
         que es lo que faltaba (el rediseño: "acciones, no logs"). */
      if (que === 'usando' && tool) this.insertToolCard(tool);
    },
    /* ---------- tarjeta de acción en el chat ---------- */
    TOOL_NOMBRE: {
      set_alarm: 'Alarma', read_calendar: 'Agenda', find_contact: 'Contacto',
      call_contact: 'Llamada', search_docs: 'Documentos', device_action: 'Acción del teléfono',
      send_message: 'Mensaje', remember: 'Memoria', recall: 'Memoria',
      manage_task: 'Tareas', manage_alarm: 'Alarmas', create_calendar_event: 'Evento',
      forget: 'Memoria', update_memory: 'Memoria', now: 'Hora', web_search: 'Web',
      get_weather: 'Clima', manage_routine: 'Rutinas', read_notifications: 'Notificaciones', read_sms: 'SMS', media_control: 'Música', summarize_url: 'Página', daily_briefing: 'Resumen', log_expense: 'Gastos'
    },
    TOOL_ICONO: {
      set_alarm: 'alarm', read_calendar: 'receipt', find_contact: 'users',
      call_contact: 'phone', search_docs: 'bookmark', device_action: 'flash',
      send_message: 'mail', remember: 'memory', recall: 'memory',
      manage_task: 'check', manage_alarm: 'alarm', create_calendar_event: 'receipt',
      forget: 'trash', update_memory: 'pencil', now: 'cal', web_search: 'grid',
      get_weather: 'pulse', manage_routine: 'timer', read_notifications: 'mail', read_sms: 'mail', media_control: 'flash', summarize_url: 'bookmark', daily_briefing: 'cal', log_expense: 'receipt'
    },
    insertToolCard: function (tool) {
      var el = document.getElementById('chat-messages');
      if (!el) return;
      var nombre = this.TOOL_NOMBRE[tool] || tool;
      var ic = this.TOOL_ICONO[tool] || 'bolt';
      var div = document.createElement('div');
      div.className = 'toolcard haciendo';
      div.innerHTML = '<span class="ti">' + icon(ic, 14) + '</span>' +
        '<span class="tc"><b>' + esc(nombre) + '</b><span>en curso…</span></span>';
      /* la tarjeta va ANTES del indicador de escritura: el orden es
         "tu pregunta" → "la acción" → "la respuesta" */
      var typing = document.getElementById('typing-ind');
      if (typing && typing.parentNode === el) el.insertBefore(div, typing);
      else el.appendChild(div);
      this._toolCard = div;
      this.scrollBottom();
    },
    agentResultado: function (tool, ok, txt) {
      var div = this._toolCard;
      if (!div) return;
      this._toolCard = null;
      div.className = 'toolcard' + (ok ? '' : ' falló');
      var nombre = this.TOOL_NOMBRE[tool] || tool;
      var ic = this.TOOL_ICONO[tool] || 'bolt';
      var resumen = String(txt || '').replace(/\s+/g, ' ').trim();
      if (resumen.length > 72) resumen = resumen.slice(0, 70) + '…';
      div.innerHTML = '<span class="ti">' + icon(ic, 14) + '</span>' +
        '<span class="tc"><b>' + esc(nombre) + '<span class="ok">' + (ok ? '✓' : '✕') + '</span></b>' +
        '<span>' + esc(resumen || (ok ? 'Listo' : 'No se pudo')) + '</span></span>';
    },
    /* v2.13.1 · confirmación de acciones con efecto (S.agentConfirm, apagada por defecto:
       llamar y mandar SMS ya abren el marcador/los mensajes y ahí se confirma). Con el
       ajuste encendido, el agente pregunta ANTES de ejecutar. Sin respuesta en 60 s se
       cancela: un modal ignorado no puede dejar el bucle colgado. */
    agentConfirm: function (tool, args, cb) {
      if (!S.agentConfirm) { cb(true); return; }
      var a = args || {};
      var txt = {
        send_message: 'Preparar un SMS para ' + (a.to || 'ese contacto') + '.',
        call_contact: 'Llamar a ' + (a.who || 'ese contacto') + '.',
        remember: 'Guardar esta nota: «' + String(a.text || '').slice(0, 80) + '».',
        set_alarm: 'Programar una alarma (' + (a.when || '') + ').',
        device_action: 'Hacer en el teléfono: ' + (a.what || '') + (a.target ? ' ' + a.target : '') + '.',
        /* v2.14.2 · las herramientas nuevas: el texto tiene que decir QUÉ va a
           pasar, no el nombre de la función. "¿Ejecutar manage_task?" no le
           dice nada a nadie. */
        manage_task: (a.action === 'add')
          ? 'Agregar la tarea: «' + String(a.text || '').slice(0, 80) + '».'
          : (a.action === 'done' ? 'Marcar una tarea como hecha.' : 'Ver tus tareas pendientes.'),
        manage_alarm: (a.action === 'cancel')
          ? 'Cancelar la alarma: «' + String(a.which || '').slice(0, 60) + '».'
          : 'Ver tus alarmas programadas.',
        create_calendar_event: 'Crear el evento "' + String(a.title || '').slice(0, 60) + '" (' + (a.when || '') + ').'
      }[tool] || ('Ejecutar ' + tool + '.');
      var fin = false;
      function once(v) { if (fin) return; fin = true; cb(v); }
      setTimeout(function () { once(false); }, 60000);
      this.confirm('¿Lo hago?', txt, function () { once(true); }, { okLabel: 'Hacerlo', danger: false, onCancel: function () { once(false); } });
    },
    /* lo que venía después del punto donde se inserta el agente */
    tryAfterAgent: function (text, task) {
      var self = this;
      var targets = Orch.targets(task);
      if (targets.length) {
        this._cancelled = false;
        this.tryTargets(text, targets, 0, null, null, task);
        return;
      }
      /* Sin destinos disponibles: motor interno del teléfono o cerebro local */
      if (S.kiu.ok) {
        this._autoTask = task;
        var r0 = Orch.roleOf(task);
        if (Orch.wantsSwap(r0) && Orch.swapAndReply(r0, text)) return;
        this.kiuReply(text, null);
        return;
      }
      setTimeout(function () {
        self.showTyping(false);
        stClear('ruta');
        var fb = KiuBrain.fallback();
        self.botSay(fb || 'Mmm, esa no la tengo.');
        KB.reinforce(text);
      }, 500);
    },
    /* v1.8.0: recorre la cadena de destinos del orquestador con relevo */
    tryTargets: function (text, targets, i, live, img, task) {
      var self = this;
      if (this._cancelled) return;
      if (i >= targets.length) {
        this.showTyping(false);
        if (live) live.remove();
        stClear('ruta');
        this.brainFallbackReply(text, img);
        return;
      }
      var tg = targets[i];
      if (tg.t === 'prov') {
        this.tryProvs(text, tg.pvs, 0, live, img, task, function () {
          self.tryTargets(text, targets, i + 1, live, img, task);
        });
        return;
      }
      if (tg.t === 'kiu') {
        /* v2.1: si un ciclo anterior murió sin callback, busyG queda huérfano y el
           motor cargado parecía "no hacer las tareas" — se recupera al vuelo */
        if (Kiu.busyG && !Kiu.pending) { Kiu.busyG = false; try { rawBridge('kiuResetBusy'); } catch (e) { } }
        /* v2.13.0: motor ocupado (otra generación o carga): esperar, no saltar a la
           nube ni a «no tengo modelo». Tope ~30 s. */
        if (Kiu.available() && Kiu.busyG) {
          this._busyTries = (this._busyTries || 0) + 1;
          if (this._busyTries <= 25) {
            this.showTyping(true);
            setTimeout(function () { self.tryTargets(text, targets, i, live, img, task); }, 1200);
            return;
          }
        }
        this._busyTries = 0;
        if (Kiu.available() && !Kiu.busyG) {
          var role = Orch.roleOf(task);
          this._autoTask = task;
          if (role === 'vision') {
            /* v2.1: visión con modelos locales — usa el modelo cargado tal cual
               (sin golpeteo de swaps); si no hay nada cargado, carga el preferido */
            if (S.kiu.ok) { this.kiuReply(text, null, img); return; }
            var wantVis = Orch.pickModel('vision');
            if (wantVis && S.dl.done[wantVis] && Orch.swapAndReply('vision', text)) return;
          } else {
            if (Orch.wantsSwap(role) && Orch.swapAndReply(role, text)) return;
            if (S.kiu.ok) { this.kiuReply(text, null); return; }
            if (Orch.swapAndReply(role, text)) return;
            /* v2.13.0: con el router apagado swapAndReply no hace nada y el motor local
               nunca se cargaba solo aunque hubiera modelos descargados */
            if (Kiu.best()) { this.kiuReply(text, null); return; }
          }
        }
        this.tryTargets(text, targets, i + 1, live, img, task);
        return;
      }
      this.tryTargets(text, targets, i + 1, live, img, task);
    },
    /* respaldo común: cerebro local */
    brainFallbackReply: function (text, img) {
      var self = this;
      stClear('ruta');
      if (S.kiu.ok) { this.kiuReply(text, null, img); return; }
      stErr('Error', 2400);
      var fb = KiuBrain.fallback();
      this.botSay('Ahora mismo no tengo un modelo disponible para eso. Descargá uno en Modelos (corre en tu teléfono) o conectá una API.\n\n' + (fb || ''));
      KB.reinforce(text);
    },
    /* v1.7.0: respuesta con el motor interno (llama.cpp dentro del teléfono)
       v1.9.0: streaming — la respuesta se pinta palabra por palabra en vivo */
    kiuReply: function (text, liveEl, img, tinyRetry, _ready) {
      var self = this;
      /* 'Generando' lo enciende Kiu.ask cuando arranca de verdad, no al entrar acá:
         entremedio ensureLoaded() puede estar recargando el modelo, y entonces lo
         que se ve es 'Cargando', que es la verdad. */
      stRuta();
      /* v2.1.2: verificación honesta del motor. Si el proceso se reinició, el
       * nativo ya no tiene el modelo aunque el sayState dijera "cargado": se
       * recarga sola y se le avisa al usuario en vez de fallar en vacío. */
      if (!tinyRetry && !_ready) {
        if (!(S.kiu.ok && Kiu.isLoaded())) {
          /* v2.13.0: no se le pide al usuario que reenvíe: se carga el modelo y se sigue */
          this.showTyping(true);
          Kiu.whenReady(function (okR, why) {
            if (self._cancelled) return;
            if (okR) { self.kiuReply(text, liveEl, img, tinyRetry, true); return; }
            self.showTyping(false);
            stClear('ruta');
            if (why === 'sin-modelo' || why === 'sin-motor') { self.brainFallbackReply(text); return; }
            if (why === 'ocupado') { self.botSay('El motor está ocupado con otra tarea. Esperá unos segundos y reintentá.'); return; }
            self.botSay('No pude cargar el modelo. Entrá a Modelos y cargalo de nuevo.');
          });
          return;
        }
      }
      /* v2.1.1: prompt liviano (sistema corto + últimos 4 turnos). En reintento,
         aún más chico (solo el mensaje). */
      /* v2.7.0: el contexto de documentos se calcula en el Web Worker
         (RAG.ctxFor → searchAsync); sin worker responde al toque, igual que
         siempre. Todo el resto de la respuesta corre adentro del callback. */
      window.RAG.ctxFor(text, 3, function (preCtx) {
      var msgs = self.kiuMsgs(text, !!tinyRetry, preCtx).filter(function (m) { return typeof m.content === 'string'; });
      /* v2.1: foto con el motor local — el GGUF no ve imágenes todavía; se lo decimos
         al modelo y al usuario, pero la tarea igual se responde con el texto */
      if (img && msgs.length) {
        var lastU = null;
        for (var mi = msgs.length - 1; mi >= 0; mi--) if (msgs[mi].role === 'user') { lastU = msgs[mi]; break; }
        if (lastU) lastU.content += '\n\n[El usuario envió una foto junto con este mensaje. El motor del teléfono todavía no puede ver imágenes: respondé al texto lo mejor posible.]';
      }
      var live = liveEl || null;
      var firstTok = true;
      /* v2.1.1: contador de segundos visible mientras el motor piensa + tope de
         tokens del chat bajado a 320 (con 400+ la respuesta tardaba de más) */
      var elT0 = Date.now();
      var elTimer = setInterval(function () {
        var sp = document.getElementById('kiu-elapsed');
        if (sp) sp.textContent = Math.round((Date.now() - elT0) / 1000) + ' s';
      }, 1000);
      try { if (window.KiuSentenceTTS) KiuSentenceTTS.begin(!!S.voiceOn); } catch (eStreamTts) { }
      Kiu.ask(msgs, Math.min(S.maxTok || 400, 480), function (out) {
        clearInterval(elTimer);
        /* v2.14.3 · Con la cola del motor, la respuesta puede llegar tarde:
           si el usuario ya canceló o ya mandó otra cosa, esta no se muestra
           (ni se habla). Antes, un pedido que esperaba al motor y el usuario
           cancelaba, igual le contestaba tarde. */
        if (self._cancelled) { try { if (window.KiuSentenceTTS) KiuSentenceTTS.finish(''); } catch (eFcT) { } return; }
        try { if (window.KiuSentenceTTS) KiuSentenceTTS.finish(out && out.text ? out.text : ''); } catch (eFinishTts) { }
        self.showTyping(false);
        if (out.ok && out.text) {
          self._kiuStuck = false;
          /* Kiu.ask ya apagó la capa 'job' y avisó 'Respuesta lista'; falta soltar
             'ruta', que si se queda tapa ese aviso (Enrutando 60 > flash 30). */
          stClear('ruta');
          var tps = out.tps ? ' · ' + out.tps.toFixed(1).replace('.', ',') + ' tok/s en tu teléfono' : '';
          var au = (S.router && S.router.on && self._autoTask) ? ' · Auto: ' + (Rtr.label(self._autoTask) || 'charla') : '';
          var rec = out.recovered ? ' · respuesta recuperada' : '';
          var mdlTag = (S.kiu && S.kiu.name) ? ' · ' + String(S.kiu.name).replace(/\.gguf$/i, '').slice(0, 28) : '';
          /* v2.14.6 · El pie de diagnóstico es OPCIONAL (S.detalles). Por
             defecto no se escribe: era ruido al final de cada respuesta.
             El detalle real vive en el diagnóstico, que siempre está. */
          var pie = S.detalles ? ('\n\n*(motor interno' + mdlTag + au + rec + tps + ')*') : '';
          /* v2.14.7 · "NO VEO LA FOTO" NO ES DIAGNÓSTICO: es una limitación
             funcional. Si se va con el pie opcional, el usuario se queda
             creyendo que Kiu miró la imagen. Va siempre, aparte. */
          var vis = img ? '\n\n_(no puedo ver la foto: el motor del teléfono no tiene visión. Conectá tu servidor en red o una API con visión para eso.)_' : '';
          self.botSay(out.text + pie + vis, live);
          KB.reinforce(text);
        } else {
          clearInterval(elTimer);
          if (live) live.remove();
          stClear('ruta');
          /* v2.1.2: respuesta vacía del motor = reintento liviano también */
          if (out.ok && !out.text && !self._kiuStuck) {
            self._kiuStuck = true;
            self.toast('El motor devolvió vacío · reintentando…');
            self.kiuReply(text, null, img, true);
            return;
          }
          /* v2.1.1: si el motor se colgó SIN responder, un reintento automático
             con prompt mínimo antes de rendirse — ya no se queda "Pensando…"
             eternamente ni tira "motor ocupado" sin más */
          if (out.stuck && !self._kiuStuck) {
            self._kiuStuck = true;
            stRuta();
            self.toast('El motor se trabó · reintentando en modo liviano…');
            self.kiuReply(text, null, img, true);
            return;
          }
          stErr('Error', 2400);
          /* v2.14.7 · TARJETA DE ERROR, no un párrafo más.
             Un fallo del motor no es la respuesta de Kiu: es un problema de la
             app, con su acción. Antes salía mezclado con lo que Kiu dice
             (y además era un muro de texto de 700 caracteres). */
          var motivo = String(out.err || 'error');
          var accion = /memoria/i.test(motivo)
            ? '→ [Liberar motor](kiu://liberar-motor)'
            : (/ocupado/i.test(motivo) ? '→ [Liberar motor](kiu://liberar-motor)' : '→ [Ver Modelos](kiu://modelos)');
          self.botSay('!! **No pude responder**\n!! ' + motivo.replace(/\n/g, ' ') + '\n!! ' + accion, null, true);
        }
      }, function (partial, st) {
        /* v1.9.0: streaming palabra por palabra; TTS recibe solo oraciones completas. */
        if (!partial) return;
        try { if (window.KiuSentenceTTS) KiuSentenceTTS.push(partial); } catch (ePushTts) { }
        var el = document.getElementById('chat-messages');
        if (!el) return;
        if (firstTok) {
          firstTok = false;
          clearInterval(elTimer);
          self.showTyping(false);
          /* sigue generando: Kiu.ask mantiene la capa 'job' en 'Generando'.
             Recién al terminar se apaga y sale 'Respuesta lista'. */
          var pill = document.getElementById('chat-state');
          if (pill) pill.remove();
          el.insertAdjacentHTML('beforeend', self.msgHTML({ role: 'bot', text: partial }));
          live = el.lastElementChild;
          var tm = live.querySelector('.msg-time');
          if (tm) tm.innerHTML = '<button class="typing-cancel" id="typing-cancel" type="button">Detener</button>';
          if (pill) el.appendChild(pill);
          var cbtn = document.getElementById('typing-cancel');
          if (cbtn) cbtn.addEventListener('click', function () {
            cbtn.disabled = true;
            cbtn.textContent = 'Detenida';
            App.cancelApi();
          });
        } else if (live) {
          var bb = live.querySelector('.msg-bubble');
          if (bb) bb.innerHTML = self.md(partial);
        }
        if (st && st.toks) {
          var tm2 = live ? live.querySelector('.msg-time') : null;
          if (tm2 && tm2.querySelector('.kiu-tps')) tm2.querySelector('.kiu-tps').textContent = st.toks + ' tok';
        }
        el.scrollTop = el.scrollHeight;
      });
      }); /* fin ctxFor */
    },
    tryProvs: function (text, provs, i, live, imgFull, task, next) {
      var self = this;
      if (this._cancelled) return;
      if (i >= provs.length) {
        /* Se acabó esta cadena: sigo con el próximo destino del orquestador */
        if (next) { next(); return; }
        this.showTyping(false);
        if (live) live.remove();
        stClear('ruta');
        this.brainFallbackReply(text);
        return;
      }
      var pv = provs[i];
      var liveEl = live;
      /* v2.8.0: 'Enrutando' mientras espera al proveedor; 'Proveedor en pausa'
         cuando uno falla y se aparta para probar el siguiente. Los dos estados
         nunca se veían porque nadie los emitía. */
      stRuta();
      this.apiStream(text, function (partial) {
        if (self._cancelled) return;
        var el = document.getElementById('chat-messages');
        if (!liveEl) {
          stClear('ruta');
          self.showTyping(false);
          var pill = document.getElementById('chat-state');
          if (pill) pill.remove();
          el.insertAdjacentHTML('beforeend', self.msgHTML({ role: 'bot', text: partial }));
          liveEl = el.lastElementChild;
          var tm = liveEl.querySelector('.msg-time');
          if (tm) tm.innerHTML = '<button class="typing-cancel" id="typing-cancel" type="button">Detener</button>';
          if (pill) el.appendChild(pill);
        } else {
          var bb = liveEl.querySelector('.msg-bubble');
          if (bb) bb.innerHTML = self.md(partial);
        }
        el.scrollTop = el.scrollHeight;
      }, pv, imgFull).then(function (out) {
        if (out.ok) {
          pv.st.ok = true;
          pv.st.latency = out.ms || pv.st.latency;
          saveS();
          Rtr.fine(pv.def.id);
          stClear('ruta');
          self.botSay(out.text, liveEl);
          KB.reinforce(text);
          return;
        }
        if (out.cancelled) {
          if (liveEl) liveEl.remove();
          stClear('ruta');
          stFlash('Detenido', 1500);
          self.toast('Respuesta cancelada');
          return;
        }
        /* Fallo: pausa para este proveedor + relevo al siguiente (sin bloqueos ni bucles) */
        pv.st.ok = false;
        pv.st.err = out.err;
        saveS();
        Rtr.fail(pv.def.id, /clave|401|403|429/.test(out.err));
        bcrumb('fallo ' + pv.def.id + ': ' + String(out.err || '').slice(0, 40));
        stPausa();
        var nextName = (i + 1 < provs.length) ? provs[i + 1].def.name : (next ? 'el próximo modelo de la cadena' : (S.kiu.ok ? 'el motor interno' : 'el cerebro local'));
        if (!liveEl) self.toast(pv.def.name + ' falló (' + out.err + ') · sigo con ' + nextName);
        self.tryProvs(text, provs, i + 1, liveEl, imgFull, task, next);
      });
    },
    botSay: function (text, liveEl, sinVoz) {
      this.pushMsg('bot', text, !!liveEl);
      if (liveEl) {
        var tm = liveEl.querySelector('.msg-time'), bb = liveEl.querySelector('.msg-bubble');
        if (tm) tm.textContent = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
        if (bb) bb.innerHTML = this.md(text);
        this.scrollBottom();
      }
      /* v2.14.7 · sinVoz: una TARJETA DE ERROR no se lee por el TTS. Un error
         leído en voz alta es un error más difícil de entender que un error
         leído, y encima corta la conversación.
         OJO: el rearme del micro (abajo) tiene que correr IGUAL en los dos
         casos: si la tarjeta de error se comía el rearme, la conversación se
         moría en silencio después de un fallo. */
      if (!sinVoz) {
        if (this.inCall()) { this._convLive = Date.now(); this.vpSay(String(text).replace(/[#*`>_]/g, '').trim(), 'KIU'); }
        this.speak(text);
      }
      if (!S.voiceOn) {
        /* sin voz no hay 'Hablando': el bot queda libre y muestra que terminó */
        stClear('ruta');
        stFlash('Respuesta lista', 1800);
        /* v2.8.1: el rearme pedía S.conv Y this._voiceDriven, pero _voiceDriven solo
           se encendía al apretar el botón del micro. Si la sesión la abrió la palabra
           de activación o el fin del TTS (que es justamente el modo manos libres), el
           bucle moría después del primer turno: hablás, Kiu contesta… y silencio.
           Ahora con el modo conversación encendido el micro vuelve siempre; si el
           TTS está apagado el loop lo maneja esta App, si está encendido lo maneja
           Java al terminar de hablar (acá no se pisan). */
        if (S.conv) {
          var self = this;
          clearTimeout(this._convT);
          this._convT = setTimeout(function () {
            if (S.conv && !self.voiceBusy) self.startVoice();
          }, 800);
        } else {
          /* v2.10.1: sin voz y sin conversación, nadie devolvía el micrófono al
             despertar por voz después de un comando suelto: quedaba suspendido
             hasta reiniciar. cancelListen lo reanuda (y es inocuo si no había
             nada escuchando). */
          bridge('cancelListen');
        }
      }
    },
    showTyping: function (on) {
      var el = document.getElementById('chat-messages');
      var ex = document.getElementById('typing-ind');
      if (on) {
        if (ex) return;
        var pill = document.getElementById('chat-state');
        if (pill) pill.remove();
        /* v2.1.1: «Detener» siempre visible (también para el motor local) +
           contador de segundos — antes el prefill lento se esperaba a ciegas */
        el.insertAdjacentHTML('beforeend', '<div class="msg bot" id="typing-ind"><div class="typing"><i></i><i></i><i></i></div><span id="kiu-elapsed"></span><button class="typing-cancel" id="typing-cancel" type="button">Detener</button></div>');
        if (pill) el.appendChild(pill);
        this.scrollBottom();
      } else if (ex) ex.remove();
    },
    /* v2.1.1: PROMPT LIVIANO para el motor local. El prompt grande (sistema +
       persona + KB + 16 turnos + RAG x3) tardaba minutos en el prefill de la
       CPU del teléfono: "demora cantidad y al final no contesta". El prompt
       completo queda para los proveedores API, que procesan rápido.
       v2.7.0: preCtx = contexto RAG ya calculado (por searchAsync/ctxFor, en el
       worker). undefined → ruta síncrona de siempre; null → sin documentos. */
    kiuMsgs: function (text, tiny, preCtx) {
      /* v2.12.0 · PROMPT DEL MODELO LOCAL.
         Antes era una sola frase generica, sin personalidad, sin lo que Kiu aprendio del
         usuario, con 1 fragmento de 500 caracteres de los documentos y turnos cortados a 400.
         Ahora: instrucciones que obligan a contestar lo preguntado, personalidad, memoria
         de largo plazo, hasta 3 fragmentos de documentos y un historial mas largo, sin el
         pie «(motor interno · tok/s)» que se le reinyectaba al modelo como si fuera charla. */
      var sys = 'Sos Kiu, un asistente personal que corre dentro del teléfono del usuario. Respondé en español, claro y directo, y contestá exactamente lo que se pregunta antes de agregar nada más. Si falta un dato para responder bien, pedilo con una sola pregunta corta. Si no sabés algo, decilo en vez de inventarlo. Sin emojis y sin markdown pesado. Si piden una alarma o un recordatorio, indicá el comando: "recuérdame [algo] a las [hora]".';
      try {
        if (!tiny) {
          if (window.PERSONAS && PERSONAS[S.persona]) sys += ' ' + PERSONAS[S.persona];
          if (S.personaX && String(S.personaX).trim()) sys += ' Además: ' + String(S.personaX).trim().slice(0, 300);
        }
      } catch (eP) { }
      if (S.name) sys += ' El usuario se llama ' + S.name + '.';
      if (!tiny) {
        /* lo aprendido del usuario (hechos + correcciones), acotado para no comerse el contexto */
        try { if (window.KB) sys += String(KB.context()).slice(0, 700); } catch (eK) { }
        /* recuerdos que el usuario pidió guardar */
        try {
          if (window.KiuMem) {
            var rcs = KiuMem.list('recuerdos').slice(0, 4).map(function (r) { return '- ' + String(r.text || '').slice(0, 90); });
            if (rcs.length) sys += '\n\nRecuerdos guardados por el usuario (usalos solo si vienen al caso):\n' + rcs.join('\n');
          }
        } catch (eM) { }
        try {
          if (window.RAG && RAG.on && typeof text === 'string') {
            var rg1 = (preCtx !== undefined) ? preCtx : RAG.search(text, 3);
            if (rg1) sys += '\n\n[Contexto de documentos del usuario. Usalo si es relevante y nombrá el archivo; si no alcanza para responder, decilo: ' + String(rg1).slice(0, 1200) + ']';
          }
        } catch (eR) { }
      }
      var msgs = [{ role: 'system', content: sys }];
      if (!tiny) {
        var h = chatHist();
        try { if (window.Comp) h = Comp.apply(h); } catch (eC) { }
        var rec;
        if (h.length && h[0] && h[0]._kiuSummary) rec = [h[0]].concat(h.slice(-6));
        else rec = h.slice(-6);
        for (var i = 0; i < rec.length; i++) {
          var tx = String(rec[i].text || '');
          if (rec[i].role !== 'user') tx = tx.replace(/\n\n\*\((?:motor interno|servidor|API)[^\n]*\)\*\s*$/i, '');
          msgs.push({ role: rec[i].role === 'user' ? 'user' : 'assistant', content: tx.slice(0, 700) });
        }
      } else {
        msgs.push({ role: 'user', content: text });
      }
      return msgs;
    },
    apiMsgs: function (text, withHist, imgFull, preCtx) {
      var sys = 'Sos Kiu, un agente personal directo y amigable. Respondés en español neutro, breve y útil, sin emojis y sin markdown pesado. Si te piden recordatorios, explicales que los comandos son: "recuérdame [algo] a las [hora]" o "recuérdame [algo] en [N] horas/minutos". Si el usuario te corrige, aceptalo con gusto y ajustate.';
      if (PERSONAS[S.persona]) sys += ' ' + PERSONAS[S.persona];
      if (S.personaX && S.personaX.trim()) sys += ' Además: ' + S.personaX.trim();
      /* v1.7.0: conocimiento progresivo (hechos + correcciones aprendidas) */
      try { sys += KB.context(); } catch (e) { }
      if (imgFull) sys += ' El usuario te envía una foto: describí concretamente lo que se ve y el texto que aparece.';
      var msgs = [{ role: 'system', content: sys }];
      if (S.name) msgs[0].content += ' El usuario se llama ' + S.name + '.';
      if (withHist) {
        var hist = chatHist();
        /* v1.9.0: compresión de contexto — con chats largos entra un resumen en vez de todo */
        try { if (window.Comp) hist = Comp.apply(hist); } catch (e0) { }
        var recent = hist.slice(-16);
        for (var i = 0; i < recent.length; i++) {
          msgs.push({ role: recent[i].role === 'user' ? 'user' : 'assistant', content: recent[i].text });
        }
      } else {
        msgs.push({ role: 'user', content: text });
      }
      /* v1.9.0: RAG local — si el usuario activó documentos, inyecta los fragmentos relevantes
         v2.7.0: preCtx (calculado en el worker vía RAG.ctxFor) evita el cálculo
         síncrono en el hilo de la UI; undefined mantiene la ruta de siempre. */
      try {
        if (!imgFull && window.RAG && RAG.on && typeof text === 'string') {
          var rag = (preCtx !== undefined) ? preCtx : RAG.search(text, 3);
          if (rag) msgs[0].content += '\n\n[Contexto extraído de los documentos del usuario, usalo si es relevante y citá el nombre del archivo]\n' + rag + '\n[/Contexto]';
        }
      } catch (e1) { }
      /* Foto actual: el último mensaje del usuario pasa a contenido multimodal */
      if (imgFull && msgs.length && msgs[msgs.length - 1].role === 'user') {
        msgs[msgs.length - 1] = {
          role: 'user',
          content: [
            { type: 'text', text: msgs[msgs.length - 1].content || '¿Qué ves en esta imagen?' },
            { type: 'image_url', image_url: { url: imgFull } }
          ]
        };
      }
      return msgs;
    },
    apiErr: function (status) {
      if (status === 401 || status === 403) return 'clave inválida';
      if (status === 404) return 'URL o modelo no encontrado';
      if (status === 429) return 'límite de uso alcanzado';
      return 'error ' + status;
    },
    /* Chat en streaming contra un proveedor concreto, con reintento y cancelación */
    apiStream: function (text, onDelta, pv, imgFull, msgsOverride) {
      var self = this, full = '', timedOut = false;
      var t0ms = Date.now();
      var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      this._abort = ctrl;
      var to = setTimeout(function () { timedOut = true; if (ctrl) ctrl.abort(); }, imgFull ? 90000 : 60000);
      /* v2.7.0: el contexto de documentos se calcula en el Web Worker
         (RAG.ctxFor); con msgsOverride (búsqueda web) o foto no se toca RAG.
         Sin worker la ruta síncrona responde al toque igual que siempre. */
      var launch = function (msgs) {
      /* Visión: si es el servidor local y hay modelo VL elegido, se usa ese */
      var mdl = pv.st.model || pv.def.model;
      if (imgFull && pv.def.id === 'ollama' && S.loc.visModel) mdl = S.loc.visModel;
      function parseFull(j) {
        var t = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
        if (t) { full = t; onDelta(full); return { ok: true, text: t.trim() }; }
        return { ok: false, err: 'respuesta vacía' };
      }
      function attempt(n) {
        return fetch(pv.st.url.replace(/\/+$/, '') + '/chat/completions', {
          method: 'POST',
          headers: self.provHeaders(pv),
          body: JSON.stringify({ model: mdl, messages: msgs, max_tokens: S.maxTok || 700, temperature: (typeof S.temp === 'number' ? S.temp : 0.7), stream: true }),
          signal: ctrl ? ctrl.signal : undefined
        }).then(function (r) {
          if (r.status >= 500 && n < 1) return new Promise(function (ok) { setTimeout(ok, 900); }).then(function () { return attempt(n + 1); });
          if (!r.ok) return { ok: false, err: self.apiErr(r.status) };
          var ct = (r.headers && r.headers.get('content-type')) || '';
          if (ct.indexOf('application/json') >= 0 || !r.body || !r.body.getReader || !window.TextDecoder) return r.json().then(parseFull);
          var reader = r.body.getReader(), dec = new TextDecoder('utf-8'), buf = '';
          function pump() {
            return reader.read().then(function (x) {
              if (x.done) return full ? { ok: true, text: full.trim() } : { ok: false, err: 'respuesta vacía' };
              buf += dec.decode(x.value, { stream: true });
              var lines = buf.split('\n'); buf = lines.pop();
              for (var i = 0; i < lines.length; i++) {
                var l = lines[i].trim();
                if (l.indexOf('data:') !== 0) continue;
                var d = l.slice(5).trim();
                if (!d || d === '[DONE]') continue;
                try {
                  var j = JSON.parse(d);
                  var dl = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
                  if (dl) { full += dl; onDelta(full); }
                } catch (e) { }
              }
              return pump();
            });
          }
          return pump();
        }).catch(function (e) {
          return { ok: false, err: (e && e.name === 'AbortError') ? (timedOut ? 'tardó demasiado' : 'cancelado') : 'sin conexión', ms: Date.now() - t0ms };
        });
      }
      /* v2.11.12 · SALTO AUTOMÁTICO DE MODELO: si el modelo falla (no existe, límite, error del servidor,
         respuesta vacía) y ya probaste este proveedor con «Buscar y probar modelos», Kiu pasa solo al
         siguiente que sí funcionaba (hasta 2 saltos), sin que tengas que tocar nada. */
      var tried = [mdl];
      function nextModel() {
        var g = (pv.st && pv.st.good) || [];
        for (var gi = 0; gi < g.length; gi++) if (tried.indexOf(g[gi].m) < 0) return g[gi].m;
        return '';
      }
      function run() {
        return attempt(0).catch(function (e) {
          if (self._cancelled) return { ok: false, cancelled: true, err: 'cancelado' };
          if (full) return { ok: true, text: full.trim() };
          return { ok: false, err: timedOut ? 'tardó demasiado' : 'sin conexión' };
        }).then(function (o) {
          if (o && !o.ok && !o.cancelled && !full && !timedOut && tried.length < 3 && /modelo|límite|error [45]|vacía/.test(String(o.err || ''))) {
            var nm = nextModel();
            if (nm) { var prev = mdl; tried.push(nm); mdl = nm; self.toast(prev + ' no respondió · pruebo con ' + nm); return run(); }
          }
          return o;
        });
      }
      return run().then(function (o) { clearTimeout(to); if (!o.ms) o.ms = Date.now() - t0ms; self._abort = null; return o; });
      };
      if (msgsOverride) return launch(msgsOverride);
      if (!(window.RAG && RAG.on && typeof text === 'string') || imgFull) return launch(this.apiMsgs(text, true, imgFull, null));
      return new Promise(function (doneCtx) { window.RAG.ctxFor(text, 3, function (pc) { doneCtx(pc); }); })
        .then(function (preCtx) { return launch(self.apiMsgs(text, true, imgFull, preCtx)); });
    },
    provHeaders: function (pv) {
      var h = { 'Content-Type': 'application/json' };
      /* v2.3.0 (sección 2): la clave real no viaja por el WebView. Si está en la
         bóveda Java (KiuVault) se manda el placeholder y el proxy de Java la
         inyecta al abrir el socket. Fallback: clave en claro vieja (desktop). */
      var kPl = pv.st.key || (window.KiuVault && KiuVault.has(pv.def.id) ? '{{key:' + pv.def.id + '}}' : '');
      if (kPl) h['Authorization'] = 'Bearer ' + kPl;
      if (pv.def.id === 'openrouter') h['HTTP-Referer'] = 'https://kiu.app';
      return h;
    },
    cancelApi: function () {
      this._cancelled = true;
      if (this._abort) { try { this._abort.abort(); } catch (e) { } }
      /* v2.1.1: el mismo botón también detiene al motor local si estaba generando */
      if (window.Kiu && Kiu.pending) {
        Kiu.cancelGen();
        this.showTyping(false);
        stClear('ruta');
        this.toast('Generación detenida');
      }
    },
    clearChat: function () {
      saveHist([]);
      this.renderChat();
    },

    /* ---------- Conversaciones múltiples ---------- */
    convListModal: function () {
      var self = this;
      var cur = curConvId();
      var l = convList().slice().sort(function (a, b) { return b.ts - a.ts; });
      var rows = l.map(function (c) {
        var n = (c.msgs || []).length;
        var ex = n ? ((c.msgs[0].role !== 'user' ? 'Bot' : 'Vos') + ' · ' + n + ' msj · ' + timeAgo(c.ts)) : 'Vacía';
        return '<div class="list-row cvrow' + (c.id === cur ? ' active' : '') + '" data-cid="' + c.id + '">' +
          '<span class="list-ic">' + icon('chat', 18) + '</span>' +
          '<div class="list-txt"><strong>' + esc(c.title || 'Nueva conversación') + '</strong><span>' + esc(ex) + '</span></div>' +
          '<span class="cx-acts">' +
          '<button class="mini-act" data-a="ren" title="Renombrar">' + icon('pencil', 15) + '</button>' +
          '<button class="mini-act" data-a="del" title="Eliminar">' + icon('trash', 15) + '</button>' +
          '</span></div>';
      }).join('') || '<p class="empty-hint">Todavía no hay conversaciones.</p>';
      var html =
        '<button class="btn-primary full" id="cv-new">' + icon('plus', 16) + ' Nueva conversación</button>' +
        '<div class="list" style="margin-top:14px;max-height:46vh;overflow:auto">' + rows + '</div>' +
        '<div class="conv-foot">' +
        '<button class="link-btn" id="cv-search">' + icon('search', 14) + ' Buscar en los chats</button>' +
        '<button class="link-btn" id="cv-export">' + icon('share', 14) + ' Exportar esta conversación</button>' +
        '<button class="link-btn danger" id="cv-clear">' + icon('trash', 14) + ' Vaciar esta conversación</button>' +
        '</div>';
      var body = this.modal('Tus conversaciones', html);
      if (!body) return;
      body.querySelector('#cv-new').addEventListener('click', function () { self.newConv(); });
      body.querySelector('#cv-search').addEventListener('click', function () { self.chatSearchModal(); });
      body.querySelector('#cv-export').addEventListener('click', function () { self.exportConv(); });
      body.querySelector('#cv-clear').addEventListener('click', function () {
        self.confirm('Vaciar conversación', 'Se borran los mensajes de esta conversación. Las demás quedan intactas.', function () {
          self.clearChat();
          self.closeModal();
          self.toast('Conversación vaciada');
        });
      });
      var list = body.querySelector('.list');
      if (list) list.addEventListener('click', function (ev) {
        var row = ev.target.closest('[data-cid]');
        if (!row) return;
        var id = row.getAttribute('data-cid');
        var act = ev.target.closest('[data-a]');
        if (act) {
          var a = act.getAttribute('data-a');
          if (a === 'ren') self.renameConv(id);
          else if (a === 'del') self.deleteConv(id);
          return;
        }
        self.switchConv(id);
      });
    },
    newConv: function () {
      var l = convList();
      var c = { id: 'c' + Date.now(), title: 'Nueva conversación', ts: Date.now(), msgs: [] };
      l.unshift(c);
      saveConvList(l);
      store('nexo_curconv', c.id);
      this.closeModal();
      this.renderChat();
      this.go('chat');
      this.toast('Conversación nueva lista');
      var inp = document.getElementById('chat-input');
      if (inp) inp.focus();
    },
    switchConv: function (id) {
      store('nexo_curconv', id);
      this.closeModal();
      this.renderChat();
      this.syncChatState();
      this.toast('Conversación abierta');
    },
    renameConv: function (id) {
      var self = this;
      var c = convById(id);
      if (!c) return;
      var html =
        '<input id="rn-in" class="tool-input" value="' + esc(c.title) + '" placeholder="Nombre de la conversación">' +
        '<button class="btn-primary full" id="rn-ok" style="margin-top:12px">Guardar</button>';
      var body = this.modal('Renombrar', html);
      if (!body) return;
      var inp = body.querySelector('#rn-in');
      setTimeout(function () { inp.focus(); inp.select(); }, 250);
      body.querySelector('#rn-ok').addEventListener('click', function () {
        var v = inp.value.trim();
        if (v) {
          var l = convList();
          for (var i = 0; i < l.length; i++) if (l[i].id === id) l[i].title = v;
          saveConvList(l);
          self.toast('Nombre guardado');
        }
        self.closeModal();
        self.convListModal();
      });
    },
    deleteConv: function (id) {
      var self = this;
      var c = convById(id);
      if (!c) return;
      if (convList().length <= 1) {
        self.confirm('Eliminar conversación', 'Es la única conversación: se vaciará y quedará lista para empezar de nuevo.', function () {
          var l = convList();
          for (var i = 0; i < l.length; i++) if (l[i].id === id) { l[i].msgs = []; l[i].title = 'Nueva conversación'; }
          saveConvList(l);
          if (curConvId() === id) self.renderChat();
          self.closeModal();
          self.convListModal();
          self.toast('Conversación vaciada');
        });
        return;
      }
      self.confirm('Eliminar conversación', 'Se elimina «' + c.title + '» con todos sus mensajes. No hay vuelta atrás.', function () {
        saveConvList(convList().filter(function (x) { return x.id !== id; }));
        if (curConvId() === id) {
          store('nexo_curconv', convList()[0].id);
          self.renderChat();
        }
        self.closeModal();
        self.convListModal();
        self.toast('Conversación eliminada');
      });
    },
    chatSearchModal: function () {
      var self = this;
      var html =
        '<input id="chq" class="tool-input" placeholder="Buscar en todas tus conversaciones...">' +
        '<div id="chq-res" style="margin-top:14px"></div>';
      var body = this.modal('Buscar en los chats', html);
      if (!body) return;
      var inp = body.querySelector('#chq'), box = body.querySelector('#chq-res');
      function render(q) {
        q = q.trim().toLowerCase();
        if (q.length < 2) { box.innerHTML = '<p class="set-hint small">Escribí al menos 2 letras. Busca en todas tus conversaciones.</p>'; return; }
        var hits = [];
        var l = convList();
        for (var i = 0; i < l.length; i++) {
          var msgs = l[i].msgs || [];
          for (var j = 0; j < msgs.length; j++) {
            if (msgs[j].text.toLowerCase().indexOf(q) >= 0) {
              hits.push({ conv: l[i], m: msgs[j] });
              if (hits.length >= 30) break;
            }
          }
          if (hits.length >= 30) break;
        }
        if (!hits.length) { box.innerHTML = '<p class="set-hint small">Nada encontrado para «' + esc(q) + '».</p>'; return; }
        box.innerHTML = hits.map(function (hh, ix) {
          var t = hh.m.text.length > 90 ? hh.m.text.slice(0, 90) + '…' : hh.m.text;
          return '<div class="list-row" data-hit="' + ix + '">' +
            '<span class="list-ic">' + icon(hh.m.role === 'user' ? 'mic' : 'chat', 16) + '</span>' +
            '<div class="list-txt"><strong>' + esc(t) + '</strong><span>' + esc(hh.conv.title) + ' · ' + (hh.m.role === 'user' ? 'Vos' : 'Kiu') + '</span></div></div>';
        }).join('');
        box.onclick = function (ev2) {
          var row = ev2.target.closest('[data-hit]');
          if (!row) return;
          var hh = hits[parseInt(row.getAttribute('data-hit'), 10)];
          self.switchConv(hh.conv.id);
        };
      }
      render('');
      inp.addEventListener('input', function () { render(inp.value); });
      setTimeout(function () { inp.focus(); }, 250);
    },
    exportConv: function () {
      var c = ensureConv();
      if (!c.msgs.length) { this.toast('Esta conversación está vacía'); return; }
      var txt = 'Kiu · ' + c.title + '\n' + new Date(c.ts).toLocaleString('es-AR') + '\n\n';
      for (var i = 0; i < c.msgs.length; i++) {
        var m = c.msgs[i];
        txt += '[' + new Date(m.ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) + '] ' + (m.role === 'user' ? 'Vos' : 'Kiu') + ': ' + m.text + '\n\n';
      }
      if (!this.shareText(txt)) {
        this.copyText(txt);
        this.toast('Conversación copiada al portapapeles');
      } else {
        this.toast('Abriendo para compartir');
      }
    },

    /* ---------- Menú adjuntar (+) ---------- */
    attachMenu: function () {
      var self = this;
      var html =
        '<button class="btn-ghost full" id="at-photo" style="justify-content:center;margin-bottom:14px">' + icon('camera', 17) + ' Analizar una foto (visión)</button>' +
        '<label class="api-fields"><span style="color:var(--dim);font-size:12px;font-weight:600">Nuevo recuerdo</span>' +
        '<input id="at-rec" placeholder="Ej: la contraseña del wifi es..."></label>' +
        '<label class="api-fields"><span style="color:var(--dim);font-size:12px;font-weight:600">Nueva tarea</span>' +
        '<input id="at-tar" placeholder="Ej: responder el mail del cliente"></label>' +
        '<label class="api-fields"><span style="color:var(--dim);font-size:12px;font-weight:600">Nueva nota</span>' +
        '<input id="at-not" placeholder="Ej: idea para el anuncio"></label>' +
        '<button class="btn-primary full" id="at-save" style="margin-top:14px">Guardar todo</button>';
      var body = this.modal('Agregar al chat y a la memoria', html);
      if (!body) return;
      body.querySelector('#at-photo').addEventListener('click', function () {
        var pi = document.getElementById('photo-input');
        if (pi) pi.click();
      });
      body.querySelector('#at-save').addEventListener('click', function () {
        var r = body.querySelector('#at-rec').value.trim();
        var t = body.querySelector('#at-tar').value.trim();
        var n = body.querySelector('#at-not').value.trim();
        var any = false;
        if (r) { KiuMem.addRecuerdo(r); any = true; }
        if (t) { KiuMem.addTarea(t); any = true; }
        if (n) { KiuMem.addNota(n); any = true; }
        self.closeModal();
        self.toast(any ? 'Guardado en tu Memoria' : 'No escribiste nada');
      });
    },
    /* ---------- Pantalla de proveedores (API) ---------- */
    bindApi: function () {
      var self = this;
      document.getElementById('mode-seg').addEventListener('click', function (ev) {
        var b = ev.target.closest('.seg-btn');
        if (!b) return;
        S.mode = b.getAttribute('data-mode');
        saveS();
        self.renderMode();
        self.renderStatus();
      });
      var gt = document.getElementById('gen-temp');
      if (gt) {
        gt.value = S.temp;
        this.tempLabel(S.temp);
        gt.addEventListener('input', function () {
          S.temp = parseFloat(gt.value);
          saveS();
          self.tempLabel(S.temp);
        });
      }
      var gl = document.getElementById('gen-len');
      if (gl) {
        var bs = gl.querySelectorAll('.seg-btn');
        for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('active', parseInt(bs[i].getAttribute('data-tok'), 10) === S.maxTok);
        gl.addEventListener('click', function (ev) {
          var b = ev.target.closest('.seg-btn');
          if (!b) return;
          var bs2 = gl.querySelectorAll('.seg-btn');
          for (var i = 0; i < bs2.length; i++) bs2[i].classList.remove('active');
          b.classList.add('active');
          S.maxTok = parseInt(b.getAttribute('data-tok'), 10) || 700;
          saveS();
          self.toast('Respuestas ' + b.textContent.toLowerCase());
        });
      }
      document.getElementById('prov-filters').addEventListener('click', function (ev) {
        var b = ev.target.closest('.chip');
        if (!b) return;
        var bs = document.querySelectorAll('#prov-filters .chip');
        for (var i = 0; i < bs.length; i++) bs[i].classList.remove('active');
        b.classList.add('active');
        self.provFilter = b.getAttribute('data-f');
        self.renderProviders();
      });
    },
    renderMode: function () {
      var bs = document.querySelectorAll('#mode-seg .seg-btn');
      for (var i = 0; i < bs.length; i++) {
        bs[i].classList.toggle('active', bs[i].getAttribute('data-mode') === S.mode);
      }
      var hint = document.getElementById('mode-hint');
      if (S.mode === 'hybrid') {
        hint.textContent = 'Híbrido (recomendado): Kiu elige el mejor modelo para cada tarea y si uno falla prueba el siguiente. Con el motor interno funciona hasta sin internet.';
      } else if (S.mode === 'api') {
        hint.textContent = 'Prioriza tus APIs: Kiu elige el modelo según la tarea (conversar, razonar, código, fotos, voz) y si un proveedor falla prueba el siguiente activo, sin quedarse colgado.';
      } else {
        hint.textContent = 'Solo local: el cerebro y los modelos de tu teléfono. Nada sale de acá.';
      }
    },
    provMatch: function (def) {
      /* v1.8.0: los servidores locales (Ollama / LM Studio) se configuran ahora
         en la pantalla Modelos → «Servidor en tu red». Acá solo APIs de nube. */
      if (def.local) return false;
      var f = this.provFilter;
      if (f === 'todos') return true;
      var st = pstate(def.id);
      if (f === 'listos') return !!st.ok;
      if (f === 'gratis') return !!def.free;
      return true;
    },
    renderProviders: function () {
      this.renderMode();
      this.updateApiRow();
      var self = this;
      var list = document.getElementById('prov-list');
      if (!list) return;
      var any = false;
      list.innerHTML = PROV.map(function (def) {
        if (!self.provMatch(def)) return '';
        any = true;
        var st = pstate(def.id);
        var statusTxt = '';
        if (st.ok) statusTxt = '<span class="prov-status ok">' + icon('check', 13) + ' OK · ' + st.latency + ' ms</span>';
        else if (st.err) statusTxt = '<span class="prov-status err">' + esc(st.err) + '</span>';
        return '<div class="prov-card' + (st.open ? ' open' : '') + '" data-prov="' + def.id + '">' +
          '<button class="prov-head" data-act="toggle">' +
          '<span class="prov-logo" style="background:' + def.color + '22;color:' + def.color + ';border:1px solid ' + def.color + '44">' + def.letter + '</span>' +
          '<span class="prov-name"><strong>' + esc(def.name) +
          (def.free ? '<i class="badge-free">GRATIS</i>' : '') +
          (def.local ? '<i class="badge-local">LOCAL</i>' : '') +
          (st.ok ? '<i class="prov-okdot"></i>' : '') + '</strong>' +
          '<span>' + esc(def.desc) + '</span></span>' +
          '<span class="switch' + (st.on ? ' on' : '') + '" data-act="switch"></span>' +
          '</button>' +
          '<div class="prov-body"><div class="prov-body-in">' +
          '<label class="api-fields"><span>URL base</span>' +
          '<input type="url" data-fld="url" value="' + esc(st.url) + '" placeholder="https://..."></label>' +
          '<label class="api-fields"><span>Clave API</span>' +
          '<span class="key-wrap"><input type="password" data-fld="key" data-last="' + esc(st.last4) + '" placeholder="' + (st.last4 ? '••••••••' + esc(st.last4) : 'sk-...') + '" autocomplete="off">' +
          '<button class="eye-btn" data-act="eye">' + icon('eye', 16) + '</button></span></label>' +
          '<label class="api-fields"><span>Modelo</span>' +
          '<input type="text" data-fld="model" value="' + esc(st.model) + '" placeholder="' + esc(def.model || 'modelo') + '"></label>' +
          '<p class="set-hint small" style="margin:4px 0 8px">Kiu elige el modelo según la tarea (conversar, razonar, código, fotos, voz). Podés fijar uno acá si querés.</p>' +
          '<div class="prov-actions">' +
          (def.keyUrl ? '<button class="chip-btn" data-act="getkey">Obtener clave</button>' : '<button class="chip-btn" data-act="getkey" disabled>Sin clave</button>') +
          '<button class="chip-btn" data-act="test">Probar</button>' +
          (def.local ? '<button class="chip-btn" data-act="models">Cargar modelos</button>'
            : '<button class="chip-btn" data-act="scan">' + (self.scan[def.id] && self.scan[def.id].run ? 'Detener' : 'Buscar y probar modelos') + '</button>') +
          '</div>' +
          '<div class="prov-models" data-pmods>' + (def.local ? self.srvChips(def.id, st) : self.cloudChips(def.id, st)) + '</div>' + statusTxt +
          '</div></div></div>';
      }).join('');
      if (!any) {
        list.innerHTML = '<p class="empty-hint">Ningún proveedor entra en este filtro. Probá con "Todos".</p>';
      }
    },
    bindProvCard: function (root) {
      /* delegación global: una sola vez en #prov-list */
    },
    wireProviders: function () {
      var self = this;
      var list = document.getElementById('prov-list');
      list.addEventListener('click', function (ev) {
        var pm = ev.target.closest('[data-pm]');
        if (pm) { self.phoneAct(pm); return; }
        var act = ev.target.closest('[data-act]');
        var card = ev.target.closest('[data-prov]');
        if (!card) return;
        var pk = ev.target.closest('[data-pick]');
        if (pk) {
          var pid = card.getAttribute('data-prov');
          var pst = pstate(pid);
          pst.model = pk.getAttribute('data-pick');
          pst.ok = false; pst.err = '';
          saveS();
          self.renderProviders();
          self.toast('Modelo elegido: ' + pst.model);
          return;
        }
        var id = card.getAttribute('data-prov');
        var def = provDef(id);
        var st = pstate(id);
        if (act) {
          var a = act.getAttribute('data-act');
          if (a === 'switch') {
            ev.stopPropagation();
            st.on = !st.on;
            st.err = '';
            saveS();
            self.renderProviders();
            self.renderStatus();
            self.toast(st.on ? def.name + ' activado' : def.name + ' desactivado');
            return;
          }
          if (a === 'eye') {
            ev.stopPropagation();
            var inp = card.querySelector('[data-fld="key"]');
            var showing = inp.getAttribute('type') === 'text';
            inp.setAttribute('type', showing ? 'password' : 'text');
            act.classList.toggle('on', !showing);
            return;
          }
          if (a === 'getkey') {
            if (def.keyUrl) self.openUrl(def.keyUrl);
            return;
          }
          if (a === 'test') { self.testProvider(id, card); return; }
          if (a === 'models') { self.loadServerModels(id, card); return; }
          if (a === 'scan') { self.scanProvider(id, false); return; }
          if (a === 'toggle') {
            card.classList.toggle('open');
            st.open = card.classList.contains('open');
            saveS();
            return;
          }
        }
      });
      list.addEventListener('change', function (ev) {
        var inp = ev.target.closest('[data-fld]');
        var card = ev.target.closest('[data-prov]');
        if (!inp || !card) return;
        var id = card.getAttribute('data-prov');
        var fld = inp.getAttribute('data-fld');
        var st = pstate(id);
        var v = inp.value.trim();
        if (fld === 'url') st.url = v;
        if (fld === 'model') st.model = v;
        if (fld === 'key') setProvKey(id, v);
        st.ok = false; st.err = '';
        saveS();
        self.renderStatus();
        /* v2.11.9: al cargar una clave, Kiu pide la lista de modelos y prueba uno por uno */
        if (fld === 'key' && v && !provDef(id).local) setTimeout(function () { self.scanProvider(id, true); }, 300);
      });
    },
    /* ---------- v2.11.9: modelos de la nube — listar, probar y dejar solo los que funcionan ---------- */
    cloudChips: function (id, st) {
      var sc = this.scan[id];
      var P = 'style="width:100%;margin:0"';
      var list = (sc && sc.run) ? (sc.good || []) : (st.good || []);
      var h = '';
      if (sc && sc.run) {
        var pct = sc.total ? Math.max(3, Math.round(sc.done / sc.total * 100)) : 5;
        h += '<div class="scan-bar"><i style="width:' + pct + '%"></i></div><p class="set-hint small" ' + P + '>' + esc(sc.msg || '') + '</p>';
      } else if (sc && sc.err) {
        h += '<p class="set-hint small" ' + P + '>' + esc(sc.err) + '</p>';
      } else if (st.good && st.good.length) {
        h += '<p class="set-hint small" ' + P + '>' + st.good.length + ' de ' + (st.nTot || st.good.length) + ' modelos funcionan con tu clave' + (st.tested ? ' · probado ' + timeAgo(st.tested) : '') + '. Tocá uno para usarlo.</p>';
      } else if (st.tested) {
        h += '<p class="set-hint small" ' + P + '>Probé los modelos y ninguno respondió con esta clave.</p>';
      }
      return h + list.map(function (g) {
        return '<button class="chip-btn' + (st.model === g.m ? ' sel' : '') + '" data-pick="' + esc(g.m) + '">' + esc(g.m) + (g.ms ? ' · ' + g.ms + ' ms' : '') + (g.lim ? ' ⏳' : '') + '</button>';
      }).join('');
    },
    paintScan: function (id, force) {
      var sc = this.scan[id]; if (!sc) return;
      var now = Date.now();
      if (!force && now - (sc.lastPaint || 0) < 350) return;
      sc.lastPaint = now;
      var box = document.querySelector('#prov-list [data-prov="' + id + '"] [data-pmods]');
      if (box) box.innerHTML = this.cloudChips(id, pstate(id));
    },
    scanProvider: function (id, auto) {
      var self = this, st = pstate(id), def = provDef(id);
      var cur = this.scan[id];
      if (cur && cur.run) {                       /* segundo toque = detener */
        cur.stop = true;
        for (var c = 0; c < cur.ctrls.length; c++) { try { cur.ctrls[c].abort(); } catch (e) { } }
        return;
      }
      if (!st.url) { if (!auto) this.toast('Poné la URL base primero'); return; }
      if (!hasKey(id)) { if (!auto) this.toast('Falta la clave API'); return; }
      var sc = this.scan[id] = { run: true, stop: false, total: 0, done: 0, ok: 0, good: [], ctrls: [], msg: 'Pidiendo la lista de modelos…' };
      this.renderProviders();
      var base = st.url.replace(/\/+$/, '');
      var hdr = this.provHeaders({ def: def, st: st });
      var authFail = false, bad = 0;
      function mkCtrl(ms) {
        var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        var to = setTimeout(function () { if (ctrl) ctrl.abort(); }, ms);
        if (ctrl) sc.ctrls.push(ctrl);
        return { ctrl: ctrl, done: function () { clearTimeout(to); } };
      }
      function testOne(m) {
        var k = mkCtrl(20000), t0 = performance.now();
        return fetch(base + '/chat/completions', {
          method: 'POST', headers: hdr, signal: k.ctrl ? k.ctrl.signal : undefined,
          body: JSON.stringify({ model: m, messages: [{ role: 'user', content: 'Respondé solo: ok' }], max_tokens: 16, temperature: 0, stream: false })
        }).then(function (r) {
          k.done();
          var ms = Math.round(performance.now() - t0);
          if (r.status === 429) return { ok: true, ms: ms, lim: true };   /* existe y la clave lo deja usar; solo está saturado */
          if (!r.ok) return { ok: false, auth: r.status === 401 };
          return r.json().then(function (j) { return { ok: !!(j && j.choices && j.choices.length), ms: ms }; }, function () { return { ok: false }; });
        }).catch(function () { k.done(); return { ok: false }; });
      }
      var kl = mkCtrl(15000);
      fetch(base + '/models', { headers: hdr, signal: kl.ctrl ? kl.ctrl.signal : undefined })
        .then(function (r) { kl.done(); if (!r.ok) throw new Error(self.apiErr(r.status)); return r.json(); })
        .then(function (j) {
          var arr = (j && (j.data || j.models)) || [], names = [], seen = {};
          for (var i = 0; i < arr.length; i++) {
            var n = String(arr[i].id || arr[i].name || arr[i].model || '').replace(/^models\//, '');
            if (n && !seen[n]) { seen[n] = 1; names.push(n); }
          }
          var chat = names.filter(function (n) { return !self.NOCHAT.test(n); });
          if (st.model) chat.sort(function (a, b) { return (b === st.model) - (a === st.model); });  /* el actual se prueba primero */
          chat = chat.slice(0, 150);
          if (!chat.length) throw new Error('la lista de modelos vino vacía');
          sc.total = chat.length; sc.names = names.length;
          sc.msg = 'Probando ' + chat.length + ' modelos…';
          self.paintScan(id, true);
          var idx = 0, active = 0;
          return new Promise(function (resolve) {
            function next() {
              if (sc.stop || authFail || idx >= chat.length) { if (active === 0) resolve(); return; }
              var m = chat[idx++]; active++;
              testOne(m).then(function (res) {
                active--; sc.done++;
                if (res.ok) { sc.ok++; sc.good.push({ m: m, ms: res.ms, lim: !!res.lim }); } else { bad++; if (res.auth) authFail = true; }
                sc.msg = 'Probando ' + sc.done + ' de ' + sc.total + ' · ' + sc.ok + ' funcionan';
                self.paintScan(id);
                next();
              });
            }
            for (var w = 0; w < 3; w++) next();
          });
        })
        .then(function () {
          sc.run = false;
          if (authFail) {
            sc.err = 'La clave no fue aceptada (401). Revisala y volvé a probar.';
            st.ok = false; st.err = 'clave inválida'; saveS();
            self.renderProviders(); self.renderStatus(); return;
          }
          var good = sc.good.slice().sort(function (a, b) { return a.ms - b.ms; });
          st.good = good; st.nTot = sc.done; st.tested = Date.now();
          st.ok = good.length > 0; st.err = good.length ? '' : 'ningún modelo respondió'; st.latency = good.length ? good[0].ms : 0;
          var cambio = '';
          if (good.length && !good.some(function (g) { return g.m === st.model; })) { st.model = good[0].m; cambio = ' · usaré ' + st.model; }
          sc.err = sc.stop ? 'Detenido: probé ' + sc.done + ' de ' + sc.total + '.' : '';
          saveS();
          self.renderProviders(); self.renderStatus();
          self.toast(def.name + ': ' + good.length + ' de ' + sc.done + ' modelos funcionan' + cambio);
        })
        .catch(function (e) {
          sc.run = false;
          sc.err = 'No pude leer los modelos: ' + ((e && e.message) ? e.message : 'sin conexión') + '. Revisá la URL base y la clave.';
          st.ok = false; saveS();
          self.renderProviders();
        });
    },
    /* ---------- v1.7.2: modelos disponibles en el servidor (Ollama / LM Studio) ---------- */
    srvChips: function (id, st) {
      var r = this.srvModels[id];
      if (!r) return '';
      if (r.err) return '<p class="set-hint small">' + esc(r.err) + '</p>';
      if (!r.list.length) return '<p class="set-hint small">El servidor no tiene modelos cargados todavía.</p>';
      return '<p class="set-hint small" style="width:100%;margin:0">' + r.list.length + ' modelo' + (r.list.length === 1 ? '' : 's') + ' en el servidor · tocá uno para usarlo</p>' +
        r.list.map(function (m) {
          return '<button class="chip-btn' + (st.model === m ? ' sel' : '') + '" data-pick="' + esc(m) + '">' + esc(m) + '</button>';
        }).join('');
    },
    loadServerModels: function (id, card) {
      var self = this;
      var st = pstate(id), def = provDef(id);
      if (!st.url) { this.toast('Poné la URL base primero'); return; }
      var btn = card.querySelector('[data-act="models"]');
      if (btn) { btn.textContent = 'Buscando…'; btn.disabled = true; }
      var base = st.url.replace(/\/+$/, '');
      var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var to = setTimeout(function () { if (ctrl) ctrl.abort(); }, 12000);
      function names(j) {
        var arr = (j && (j.data || j.models)) || [];
        var out = [];
        for (var i = 0; i < arr.length; i++) { var m = arr[i].id || arr[i].name || arr[i].model; if (m) out.push(String(m)); }
        return out;
      }
      function ok(list) {
        clearTimeout(to);
        self.srvModels[id] = { list: list };
        self.renderProviders();
        self.toast(list.length ? (list.length + ' modelos encontrados en ' + def.name) : 'Conecté, pero no hay modelos cargados');
      }
      function fail(e) {
        clearTimeout(to);
        self.srvModels[id] = { err: 'No pude leer los modelos: ' + ((e && e.message) ? e.message : 'sin conexión') + '. Revisá la URL base y que el servidor esté encendido.' };
        self.renderProviders();
      }
      fetch(base + '/models', { headers: this.provHeaders({ def: def, st: st }), signal: ctrl ? ctrl.signal : undefined })
        .then(function (r) { if (!r.ok) throw new Error(self.apiErr(r.status)); return r.json(); })
        .then(function (j) { ok(names(j)); })
        .catch(function (e1) {
          /* respaldo: API nativa de Ollama */
          fetch(base.replace(/\/v1$/, '') + '/api/tags', { signal: ctrl ? ctrl.signal : undefined })
            .then(function (r) { if (!r.ok) throw new Error(self.apiErr(r.status)); return r.json(); })
            .then(function (j) { ok(names(j)); })
            .catch(function () { fail(e1); });
        });
    },
    /* ---------- v1.7.2: tarjeta «Modelos en el teléfono» (filtro Local) ---------- */
    phoneCard: function () {
      Mod.sync();
      var avail = Kiu.available();
      var d = (Sys && Sys.d) || {};
      var ram = d.ramTotal ? d.ramTotal / 1073741824 : 0;
      var files = Mod.files.filter(function (f) { return /\.gguf$/i.test(f.n); });
      var rows = files.map(function (f) {
        var c = modCatByFile(f.n);
        var k = modKind(f.n);
        var canRun = k === 'text' && (!c || c.eng === 'kiu');
        var loaded = S.kiu.ok && S.kiu.name === f.n;
        var fit = '';
        if (ram && canRun) { var need = c ? c.r : (f.b / 1073741824) * 1.5 + 1.0; fit = need <= ram - 1 ? ' · entra en tu RAM ✓' : need <= ram ? ' · justo de RAM' : ' · puede no entrar'; }
        var note = canRun ? fit : (k === 'mmproj' ? ' · complemento de un modelo de visión' : k === 'vision' ? ' · visión: el motor interno solo lee texto, usalo con tu servidor' : ' · es para servidor');
        var tag = k === 'vision' ? ' <i class="badge-local">VISIÓN</i>' : k === 'mmproj' ? ' <i class="badge-local">MMPROJ</i>' : '';
        return '<div class="list-row dl-row"><span class="list-ic">' + icon(k === 'text' ? 'brain' : 'eye', 18) + '</span><div class="list-txt"><strong>' +
          esc(c ? c.n : f.n.replace(/\.gguf$/i, '')) + (c && c.imp ? ' <i class="badge-free">IMPORTADO</i>' : '') + tag + '</strong><span>' + Mod.gb(f.b) + note + '</span>' +
          '<div class="dl-acts">' + (canRun ? '<button class="chip-btn" data-pm="use" data-f="' + esc(f.n) + '">' + (loaded ? 'Cargado ✓' : 'Cargar') + '</button>' : '') +
          (k !== 'mmproj' ? '<button class="chip-btn" data-pm="kind" data-f="' + esc(f.n) + '">' + (k === 'vision' ? 'Es de texto' : 'Es de visión') + '</button>' : '') +
          '<button class="chip-btn" data-pm="del" data-f="' + esc(f.n) + '">Borrar</button></div></div></div>';
      });
      rows = groupRows(rows, files.map(function (f) { return modKind(f.n); }));
      var sub = avail
        ? (S.kiu.ok ? 'En memoria: ' + esc(S.kiu.name.replace('.gguf', '')) : 'Elegí un modelo y tocá «Cargar»')
        : 'Este teléfono no soporta el motor interno (necesita ARM64)';
      return '<div class="set-card phone-card" id="phone-card">' +
        '<div class="set-row"><div><strong>Modelos en el teléfono <i class="badge-local">LOCAL</i></strong><span>llama.cpp · privado · sin Internet</span></div><i class="status-dot' + (S.kiu.ok ? ' api' : '') + '"></i></div>' +
        '<p class="set-hint small" style="margin:2px 0 8px">' + sub + '</p>' +
        (rows ? '<div class="list">' + rows + '</div>' : '<p class="empty-hint">Todavía no tenés modelos en el teléfono. Importá un archivo .gguf o descargá uno del catálogo.</p>') +
        '<div class="loc-actions">' +
        '<button class="chip-btn" data-pm="import">Importar GGUF</button>' +
        '<button class="chip-btn" data-pm="catalog">Descargar del catálogo</button>' +
        (S.kiu.ok ? '<button class="chip-btn" data-pm="free">Liberar memoria</button>' : '') +
        '</div><p class="set-hint small" id="pm-imp"></p>' +
        '<p class="set-hint small">Tip: para tu equipo' + (ram ? ' (' + ram.toFixed(1).replace('.', ',') + ' GB de RAM)' : '') + ' andan mejor los modelos chicos en cuantización Q4_K_M (0,5 a 2 GB).</p>' +
        '</div>';
    },
    phoneAct: function (el) {
      var a = el.getAttribute('data-pm'), f = el.getAttribute('data-f');
      if (a === 'import') Imp.start();
      else if (a === 'catalog') this.go('models');
      else if (a === 'use') Kiu.load(f);
      else if (a === 'del') Mod.del(f);
      else if (a === 'kind') {
        S.dl.kind = S.dl.kind || {};
        S.dl.kind[f] = modKind(f) === 'vision' ? 'text' : 'vision';
        saveS(); this.renderProviders(); this.renderModels();
      }
      else if (a === 'free') { Kiu.unload(); this.toast('Memoria liberada'); }
    },
    renderImp: function () {
      var st = Imp.st;
      var txt = '';
      if (st && st.st === 'run') {
        var pct = st.total ? Math.min(100, Math.round(st.got / st.total * 100)) : 0;
        txt = 'Importando ' + (st.name || 'modelo') + ' · ' + (st.total ? pct + '% · ' : '') + Mod.gb(st.got || 0) + (st.total ? ' de ' + Mod.gb(st.total) : '') + ' · tocá acá para cancelar';
      }
      var ids = ['pm-imp', 'mdl-imp-status'];
      for (var i = 0; i < ids.length; i++) {
        var e = document.getElementById(ids[i]);
        if (!e) continue;
        e.textContent = txt;
        e.style.cursor = txt ? 'pointer' : '';
        e.onclick = txt ? function () { if (confirm('¿Cancelar la importación del modelo?')) Imp.cancel(); } : null; /* v2.7.4 */
      }
    },
    /* (v1.7.0: «Cargar modelos» por servidor se quitó; v1.7.2 lo vuelve con lista real) */
    testProvider: function (id, card) {
      var self = this;
      var st = pstate(id);
      var def = provDef(id);
      if (!st.url) { this.toast('Poné la URL base primero'); return; }
      if (!def.local && !hasKey(id)) { this.toast('Falta la clave API'); return; }
      var btn = card.querySelector('[data-act="test"]');
      var status = card.querySelector('.prov-status');
      btn.textContent = 'Probando…';
      btn.disabled = true;
      var t0 = performance.now();
      var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var to = setTimeout(function () { if (ctrl) ctrl.abort(); }, 15000);
      fetch(st.url.replace(/\/+$/, '') + '/models', { headers: this.provHeaders({ def: def, st: st }), signal: ctrl ? ctrl.signal : undefined })
        .then(function (r) {
          clearTimeout(to);
          var ms = Math.round(performance.now() - t0);
          if (!r.ok) throw new Error(self.apiErr(r.status));
          st.ok = true; st.latency = ms; st.err = '';
          saveS();
          btn.textContent = 'Probar';
          btn.disabled = false;
          self.renderProviders();
          self.renderStatus();
          self.toast(def.name + ': OK · ' + ms + ' ms');
        })
        .catch(function (e) {
          clearTimeout(to);
          st.ok = false; st.err = (e && e.message) ? e.message : 'sin conexión';
          saveS();
          btn.textContent = 'Probar';
          btn.disabled = false;
          self.renderProviders();
          self.toast(def.name + ': ' + st.err);
        });
    },
    /* ---------- Biblioteca (herramientas + conexiones) ---------- */
    BIB_CAT: { calc: 'cuentas', propina: 'cuentas', desc: 'cuentas', conv: 'cuentas', notas: 'notas', count: 'notas', timer: 'tiempo', imc: 'util', linterna: 'util', pass: 'util', decide: 'util', share: 'util' },
    bindBiblio: function () {
      var self = this;
      document.getElementById('biblio-search').addEventListener('input', function () { self.renderBiblio(); });
      document.getElementById('biblio-filters').addEventListener('click', function (ev) {
        var b = ev.target.closest('.chip');
        if (!b) return;
        var bs = document.querySelectorAll('#biblio-filters .chip');
        for (var i = 0; i < bs.length; i++) bs[i].classList.remove('active');
        b.classList.add('active');
        self.biblioCat = b.getAttribute('data-f');
        self.renderBiblio();
      });
    },
    renderBiblio: function () {
      if (!window.KiuTools) return;
      var q = (document.getElementById('biblio-search').value || '').toLowerCase();
      var grid = document.getElementById('tools-grid');
      var rows = KiuTools.TOOLS.filter(function (t) {
        if (App.biblioCat !== 'todas' && App.BIB_CAT[t.id] !== App.biblioCat) return false;
        if (q && (t.name + ' ' + t.desc).toLowerCase().indexOf(q) < 0) return false;
        return true;
      });
      if (!rows.length) {
        grid.innerHTML = '<p class="empty-hint" style="grid-column:1/-1">Nada coincide con esa búsqueda.</p>';
        return;
      }
      grid.innerHTML = rows.map(function (t) {
        return '<button class="tool-card" data-tool="' + t.id + '">' +
          '<span class="tool-ic ' + t.color + '">' + icon(t.ic, 20) + '</span>' +
          '<strong>' + t.name + '</strong><span>' + t.desc + '</span></button>';
      }).join('');
    },
    renderCx: function () {
      var self = this;
      var cx = [
        { name: 'Contactos', desc: 'Tu agenda real: llamá o escribile a cualquiera', ic: 'users', color: '#60A5FA', act: 'contacts' },
        { name: 'WhatsApp', desc: 'Chat directo con un número o contacto', ic: 'chat', color: '#25D366', act: 'wa' },
        { name: 'Llamadas', desc: 'Marcá un número al instante', ic: 'phone', color: '#34D399', act: 'dial' },
        { name: 'SMS', desc: 'Mensajes de texto listos para enviar', ic: 'note', color: '#FBBF24', act: 'sms' },
        { name: 'Correo', desc: 'Email con asunto y texto', ic: 'mail', color: '#FF6B6B', act: 'mail' },
        { name: 'Mapas', desc: 'Rutas y lugares al toque', ic: 'pin', color: '#FF8A4A', act: 'maps' },
        { name: 'Alarma del reloj', desc: 'Alarma exacta del sistema', ic: 'alarm', color: '#A78BFA', act: 'clock' },
        { name: 'YouTube', desc: 'Buscá y mirá al instante', ic: 'play', color: '#FF5D5D', act: 'yt' },
        { name: 'Calendario', desc: 'Creá eventos en tu agenda', ic: 'cal', color: '#2DD4BF', act: 'cal' }
      ];
      var el = document.getElementById('cx-list');
      el.innerHTML = cx.map(function (c, ix) {
        return '<button class="list-row" data-cx="' + ix + '">' +
          '<span class="list-ic cx" style="color:' + c.color + '">' + icon(c.ic, 18) + '</span>' +
          '<div class="list-txt"><strong>' + c.name + '</strong><span>' + c.desc + '</span></div>' +
          '<span style="font-size:11px;color:var(--teal);font-weight:700">Conectar</span></button>';
      }).join('');
      el.onclick = function (ev) {
        var b = ev.target.closest('[data-cx]');
        if (!b) return;
        var item = cx[parseInt(b.getAttribute('data-cx'), 10)];
        var fn = self['cx_' + item.act];
        if (fn) { fn.call(self); App.track('herramientas'); }
      };
    },
    /* ---------- Conexiones reales ---------- */
    cx_contacts: function () {
      var self = this;
      if (!BR || !BR.contacts) { this.toast('Disponible en la app del teléfono'); return; }
      var html =
        '<label class="api-fields"><span style="color:var(--dim);font-size:12px;font-weight:600">Buscar en tu agenda</span>' +
        '<input id="ct-q" placeholder="Nombre o número..."></label>' +
        '<button class="btn-primary full" id="ct-go" style="margin-top:12px">Buscar</button>' +
        '<div id="ct-res" style="margin-top:12px"></div>';
      var body = this.modal('Contactos', html);
      if (!body) return;
      function search() {
        var q = body.querySelector('#ct-q').value.trim();
        if (!q) { self.toast('Escribí un nombre o número'); return; }
        var res = self.contactSearch(q);
        var box = body.querySelector('#ct-res');
        if (res === 'NEED_PERM') {
          self.askPerm('contacts');
          box.innerHTML = '<p class="set-hint">Te va a saltar el permiso de contactos. Concedelo y buscá de nuevo.</p>';
          return;
        }
        if (!res || !res.length) {
          box.innerHTML = '<p class="set-hint">Sin resultados para "' + esc(q) + '".</p>';
          return;
        }
        box.innerHTML = res.map(function (c, ix) {
          return '<div class="list-row" data-ct="' + ix + '">' +
            '<span class="list-ic">' + icon('users', 16) + '</span>' +
            '<div class="list-txt"><strong>' + esc(c.name) + '</strong><span>' + esc(c.num) + '</span></div>' +
            '<span class="cx-acts">' +
            '<button class="mini-act" data-a="call" title="Llamar">' + icon('phone', 15) + '</button>' +
            '<button class="mini-act wa" data-a="wa" title="WhatsApp">' + icon('chat', 15) + '</button>' +
            '<button class="mini-act sms" data-a="sms" title="SMS">' + icon('mail', 15) + '</button>' +
            '</span></div>';
        }).join('');
        box.onclick = function (ev2) {
          var btn = ev2.target.closest('.mini-act');
          var row = ev2.target.closest('[data-ct]');
          if (!btn || !row) return;
          var c = res[parseInt(row.getAttribute('data-ct'), 10)];
          var a = btn.getAttribute('data-a');
          if (a === 'call') bridge('dial', [c.num]);
          if (a === 'wa') bridge('waChat', [c.num.replace(/\D/g, ''), '']);
          if (a === 'sms') bridge('sms', [c.num, '']);
          self.toast(a === 'call' ? 'Llamando a ' + c.name : (a === 'wa' ? 'WhatsApp: ' + c.name : 'SMS: ' + c.name));
        };
      }
      body.querySelector('#ct-go').addEventListener('click', search);
      body.querySelector('#ct-q').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') search(); });
    },
    cx_wa: function () {
      var self = this;
      var html =
        '<label class="api-fields"><span style="color:var(--dim);font-size:12px;font-weight:600">Número (con código de país)</span>' +
        '<input id="wa-num" type="tel" placeholder="Ej: 5491122334455"></label>' +
        '<label class="api-fields"><span style="color:var(--dim);font-size:12px;font-weight:600">Mensaje (opcional)</span>' +
        '<input id="wa-msg" placeholder="Hola!"></label>' +
        '<button class="btn-primary full" id="wa-go" style="margin-top:14px">Abrir chat de WhatsApp</button>';
      var body = this.modal('WhatsApp', html);
      if (!body) return;
      body.querySelector('#wa-go').addEventListener('click', function () {
        var num = body.querySelector('#wa-num').value.replace(/\D/g, '');
        if (!num) { self.toast('Poné un número válido'); return; }
        var msg = body.querySelector('#wa-msg').value.trim();
        var ok = bridge('waChat', [num, msg]);
        if (!ok) {
          var enc = encodeURIComponent(msg);
          self.openUrl('https://wa.me/' + num + (enc ? '?text=' + enc : ''));
        }
        self.closeModal();
      });
    },
    cx_dial: function () {
      var self = this;
      var html =
        '<label class="api-fields"><span style="color:var(--dim);font-size:12px;font-weight:600">Número a marcar</span>' +
        '<input id="dl-num" type="tel" placeholder="Ej: 2644555123"></label>' +
        '<button class="btn-primary full" id="dl-go" style="margin-top:14px">Abrir marcador</button>';
      var body = this.modal('Llamadas', html);
      if (!body) return;
      body.querySelector('#dl-go').addEventListener('click', function () {
        var num = body.querySelector('#dl-num').value.trim();
        if (!num) { self.toast('Poné un número'); return; }
        var ok = bridge('dial', [num]);
        if (!ok) self.openUrl('tel:' + num);
        self.closeModal();
      });
    },
    cx_sms: function () {
      var self = this;
      var html =
        '<label class="api-fields"><span style="color:var(--dim);font-size:12px;font-weight:600">Número</span>' +
        '<input id="sm-num" type="tel" placeholder="Ej: 2644555123"></label>' +
        '<label class="api-fields"><span style="color:var(--dim);font-size:12px;font-weight:600">Mensaje</span>' +
        '<input id="sm-msg" placeholder="Escribí el texto..."></label>' +
        '<button class="btn-primary full" id="sm-go" style="margin-top:14px">Abrir mensajes</button>';
      var body = this.modal('SMS', html);
      if (!body) return;
      body.querySelector('#sm-go').addEventListener('click', function () {
        var num = body.querySelector('#sm-num').value.trim();
        var msg = body.querySelector('#sm-msg').value.trim();
        if (!num) { self.toast('Poné un número'); return; }
        var ok = bridge('sms', [num, msg]);
        if (!ok) self.openUrl('sms:' + num);
        self.closeModal();
      });
    },
    cx_mail: function () {
      var self = this;
      var html =
        '<label class="api-fields"><span style="color:var(--dim);font-size:12px;font-weight:600">Para</span>' +
        '<input id="em-to" type="email" placeholder="algo@correo.com"></label>' +
        '<label class="api-fields"><span style="color:var(--dim);font-size:12px;font-weight:600">Asunto</span>' +
        '<input id="em-sub" placeholder="Asunto"></label>' +
        '<button class="btn-primary full" id="em-go" style="margin-top:14px">Abrir correo</button>';
      var body = this.modal('Correo', html);
      if (!body) return;
      body.querySelector('#em-go').addEventListener('click', function () {
        var to = body.querySelector('#em-to').value.trim();
        if (!to) { self.toast('Poné un correo válido'); return; }
        var sub = body.querySelector('#em-sub').value.trim();
        var ok = bridge('email', [to, sub, '']);
        if (!ok) self.openUrl('mailto:' + to + (sub ? '?subject=' + encodeURIComponent(sub) : ''));
        self.closeModal();
      });
    },
    cx_maps: function () {
      var self = this;
      var html =
        '<label class="api-fields"><span style="color:var(--dim);font-size:12px;font-weight:600">Destino o lugar</span>' +
        '<input id="mp-q" placeholder="Ej: Aeropuerto Ezeiza"></label>' +
        '<button class="btn-primary full" id="mp-go" style="margin-top:14px">Abrir en Mapas</button>';
      var body = this.modal('Mapas', html);
      if (!body) return;
      body.querySelector('#mp-go').addEventListener('click', function () {
        var q = body.querySelector('#mp-q').value.trim();
        if (!q) { self.toast('Escribí un destino'); return; }
        var ok = bridge('maps', [q]);
        if (!ok) self.openUrl('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q));
        self.closeModal();
      });
    },
    cx_clock: function () {
      var self = this;
      var html =
        '<label class="api-fields"><span style="color:var(--dim);font-size:12px;font-weight:600">Hora de la alarma</span>' +
        '<input id="cl-t" type="time"></label>' +
        '<button class="btn-primary full" id="cl-go" style="margin-top:14px">Poner alarma</button>';
      var body = this.modal('Alarma del reloj', html);
      if (!body) return;
      body.querySelector('#cl-go').addEventListener('click', function () {
        var v = body.querySelector('#cl-t').value;
        if (!v) { self.toast('Elegí una hora'); return; }
        var p = v.split(':');
        var ok = bridge('setAlarmDevice', [parseInt(p[0], 10), parseInt(p[1], 10)]);
        self.toast(ok ? 'Alarma puesta a las ' + v : 'No pude abrir el reloj');
        self.closeModal();
      });
    },
    cx_yt: function () {
      var self = this;
      var html =
        '<label class="api-fields"><span style="color:var(--dim);font-size:12px;font-weight:600">¿Qué querés mirar?</span>' +
        '<input id="yt-q" placeholder="Ej: cumbia 2026"></label>' +
        '<button class="btn-primary full" id="yt-go" style="margin-top:14px">Buscar en YouTube</button>';
      var body = this.modal('YouTube', html);
      if (!body) return;
      body.querySelector('#yt-go').addEventListener('click', function () {
        var q = body.querySelector('#yt-q').value.trim();
        if (!q) { self.toast('Escribí algo para buscar'); return; }
        var ok = bridge('ytSearch', [q]);
        if (!ok) self.openUrl('https://www.youtube.com/results?search_query=' + encodeURIComponent(q));
        self.closeModal();
      });
    },
    cx_cal: function () {
      var self = this;
      var html =
        '<label class="api-fields"><span style="color:var(--dim);font-size:12px;font-weight:600">Evento</span>' +
        '<input id="cal-title" placeholder="Ej: Turno médico"></label>' +
        '<label class="api-fields"><span style="color:var(--dim);font-size:12px;font-weight:600">Fecha y hora</span>' +
        '<input id="cal-when" type="datetime-local"></label>' +
        '<button class="btn-primary full" id="cal-go" style="margin-top:14px">Crear en mi calendario</button>';
      var body = this.modal('Calendario', html);
      if (!body) return;
      body.querySelector('#cal-go').addEventListener('click', function () {
        var t = body.querySelector('#cal-title').value.trim();
        var w = body.querySelector('#cal-when').value;
        if (!t || !w) { self.toast('Completá título y fecha'); return; }
        var ms = new Date(w).getTime();
        self.addCalendarEvent(t, ms);
        self.closeModal();
      });
    },
    bindFlashlight: function () {
      document.getElementById('flashlight-off').addEventListener('click', function () {
        KiuTools.closeLinterna();
      });
    },
    /* v2.8.0: Android borra TODAS las alarmas al reiniciar o al actualizar la app;
       BootReceiver las rearma. Cuando la WebView está viva llega el aviso por
       nexoRemindersRestored y se ve 'Reprogramado al reiniciar'. Cuando la app
       todavía no estaba abierta, el puente guarda el número y se consume acá
       (take-once: al leerlo se borra, así que no se repite). */
    kiuReschedule: function () {
      if (!BR || !BR.kiuTakeRescheduled) return;
      var n = 0;
      try { n = parseInt(BR.kiuTakeRescheduled(), 10) || 0; } catch (e) { return; }
      if (n > 0 && window.nexoRemindersRestored) window.nexoRemindersRestored(n);
    },
    /* ---------- Alarmas ---------- */
    reminders: function () { return store('nexo_alarmas') || []; },
    addReminder: function (title, when) {
      var id = 'r' + Date.now();
      var list = this.reminders();
      list.unshift({ id: id, title: title, time: when.getTime(), date: fmtWhen(when.getTime()) });
      store('nexo_alarmas', list);
      var ok = bridge('setReminder', [id, title, when.getTime()]);
      this.refreshMem();
      this.addActivity('alarmas', title);
      /* v2.8.0: Android 14 puede bloquear las alarmas exactas. Se programa igual
         (el puente cae a una alarma no exacta) pero se le dice al usuario, con un
         diálogo propio, que puede darle permiso para que suene en el minuto. */
      if (ok) this.avisoAlarmasExactas();
      return ok;
    },
    /* v2.8.0: diálogo del permiso de alarma exacta (estado del mapa:
       'Sin permiso de alarma exacta'). Antes solo había un botón suelto en
       Ajustes y ningún aviso al agendar un recordatorio. */
    exactoOk: function () {
      if (!BR || !BR.canExactAlarms) return true;
      try { return !!BR.canExactAlarms(); } catch (e) { return true; }
    },
    avisoAlarmasExactas: function (alProgramar) {
      if (this._exactoAvisado === this.exactoOk()) return;
      if (this.exactoOk()) return;
      var self = this;
      this._exactoAvisado = false;
      var k = KS(); if (k) k.flash('flash', 'Sin permiso de alarma exacta', 4000);
      this.confirm('Kiu no puede sonar exacto',
        (alProgramar
          ? 'La alarma quedó guardada, pero Android 12+ puede delayingarla unos minutos.\n\nSi me das permiso de «alarmas exactas», suena justo a la hora. '
          : 'Con este permiso Android me deja disparar las alarmas en el minuto exacto. ')
        + 'Te llevo a Ajustes del sistema; el botón dice «Permitir».',
        function () { bridge('openExactAlarmSettings'); },
        { okLabel: 'Abrir Ajustes', cancelLabel: 'Ahora no' });
    },
    cancelReminderByTitle: function (q) {
      q = (q || '').trim().toLowerCase();
      var list = this.reminders();
      var found = null;
      var i;
      for (i = 0; i < list.length; i++) {
        if (!q || list[i].title.toLowerCase().indexOf(q) >= 0) { found = list[i]; break; }
      }
      /* v2.14.2 · EL MODELO PARAFRASEA. El título de la alarma es
         "desayunar" y el usuario (y el modelo) dicen "la alarma del
         desayuno": el substring no encuentra y el cancelamiento falla
         aunque la alarma exista y se vea en la lista. Segunda pasada: se
         comparan los INICIOS de palabra ("desayuno" y "desayunar" comparten
         "desay"). Sin esto, el agente cancela la alarma equivocada o
         ninguna y contesta "no encontré ninguna alarma". */
      if (!found && q) {
        var palabras = q.split(/[^a-z0-9ñüáéíóú]+/).filter(function (w) { return w.length >= 4; });
        for (i = 0; i < list.length && !found; i++) {
          var t = String(list[i].title || '').toLowerCase();
          var tw = t.split(/[^a-z0-9ñüáéíóú]+/).filter(function (w) { return !!w; });
          for (var p = 0; p < palabras.length && !found; p++) {
            var pre = palabras[p].slice(0, Math.min(5, palabras[p].length));
            for (var w2 = 0; w2 < tw.length; w2++) {
              if (tw[w2].length >= 4 && tw[w2].slice(0, pre.length) === pre) { found = list[i]; break; }
            }
          }
        }
      }
      if (!found) return null;
      bridge('cancelReminder', [found.id]);
      store('nexo_alarmas', list.filter(function (r) { return r.id !== found.id; }));
      this.refreshMem();
      return found;
    },
    removeReminder: function (id) {
      bridge('cancelReminder', [id]);
      store('nexo_alarmas', this.reminders().filter(function (r) { return r.id !== id; }));
      this.refreshMem();
    },
    /* v2.18.0 · corre las rutinas que ya les toca y pone el resultado en el chat. Nunca lanza. */
    rutinasTick: function () {
      var self = this;
      try {
        if (!window.KiuRutinas || !window.KiuAgente) return;
        window.KiuRutinas.tick(function (texto, r) {
          self.botSay('**' + r.name + '**\n' + texto);
          self.toast(r.name);
        });
      } catch (e) { }
    },
    syncReminders: function () {
      if (!BR) return;
      try {
        var pend = JSON.parse(BR.pendingReminders() || '[]');
        var alive = {};
        for (var i = 0; i < pend.length; i++) alive[pend[i].id] = true;
        var list = this.reminders();
        var filtered = list.filter(function (r) { return !!alive[r.id]; });
        if (filtered.length !== list.length) {
          store('nexo_alarmas', filtered);
          this.refreshMem();
        }
      } catch (e) { }
    },
    addCalendarEvent: function (title, ms) {
      if (!ms || isNaN(ms)) { this.toast('Fecha inválida'); return; }
      var ok = bridge('addCalendarEvent', [title, ms]);
      this.toast(ok ? 'Abrí tu calendario con el evento' : 'No encontré una app de calendario');
    },

    /* ---------- Memoria ---------- */
    bindMemory: function () {
      var self = this;
      document.getElementById('mem-add').innerHTML = icon('plus', 20);
      document.getElementById('mem-add').addEventListener('click', function () { self.memAddModal(); });
      document.getElementById('mem-tabs').addEventListener('click', function (ev) {
        var b = ev.target.closest('.seg-btn');
        if (!b) return;
        var tabs = document.querySelectorAll('#mem-tabs .seg-btn');
        for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove('active');
        b.classList.add('active');
        self.memTab = b.getAttribute('data-tab');
        self.refreshMem();
      });
    },
    refreshMem: function () {
      if (document.getElementById('st-rec')) {
        document.getElementById('st-rec').textContent = KiuMem.count('recuerdos');
        document.getElementById('st-tar').textContent = KiuMem.count('tareas');
        document.getElementById('st-not').textContent = KiuMem.count('notas');
        document.getElementById('st-ala').textContent = this.reminders().length;
        var apr = document.getElementById('st-apr');
        if (apr) apr.textContent = KB.count();
      }
      var el = document.getElementById('mem-list');
      if (!el) return;
      var tab = this.memTab;
      var self = this;
      if (tab === 'alarmas') {
        var items = this.reminders();
        if (!items.length) {
          el.innerHTML = '<p class="empty-hint">Decile a Kiu "recuérdame [algo] a las 9" o "recuérdame [algo] en 2 horas" y suena acá.</p>';
          return;
        }
        el.innerHTML = items.map(function (it) {
          return '<div class="list-row" data-id="' + it.id + '">' +
            '<span class="list-ic">' + icon('alarm', 18) + '</span>' +
            '<div class="list-txt"><strong>' + esc(it.title) + '</strong><span>' + esc(it.date) + ' · ' + timeUntil(it.time) + '</span></div>' +
            '<button class="row-del" data-act="del">' + icon('trash', 17) + '</button></div>';
        }).join('');
        el.onclick = function (ev) {
          var row = ev.target.closest('[data-id]');
          if (!row) return;
          if (ev.target.closest('[data-act="del"]')) self.removeReminder(row.getAttribute('data-id'));
        };
        return;
      }
      var items2 = KiuMem.list(tab);
      if (!items2.length) {
        var hints = {
          recuerdos: 'Decile a Kiu "recuerda que..." en el Chat y aparece acá.',
          tareas: 'Agregá tareas con "tarea: ..." en el Chat o con el botón +.',
          notas: 'Guardá apuntes con "nota: ..." o desde Herramientas, Notas.',
          prefs: 'Acá van a quedar tus gustos y preferencias.'
        };
        el.innerHTML = '<p class="empty-hint">' + hints[tab] + '</p>';
        return;
      }
      el.innerHTML = items2.map(function (it) {
        if (tab === 'tareas') {
          return '<div class="list-row ' + (it.done ? 'done-txt' : '') + '" data-ts="' + it.ts + '">' +
            '<button class="mem-item-check ' + (it.done ? 'done' : '') + '" data-act="toggle"></button>' +
            '<div class="list-txt"><strong>' + esc(it.text) + '</strong><span>' + it.date + '</span></div>' +
            '<button class="row-del" data-act="del">' + icon('trash', 17) + '</button></div>';
        }
        var ic = tab === 'prefs' ? 'heart' : (tab === 'notas' ? 'note' : 'bookmark');
        return '<div class="list-row" data-ts="' + it.ts + '">' +
          '<span class="list-ic">' + icon(ic, 18) + '</span>' +
          '<div class="list-txt"><strong>' + esc(it.text) + '</strong><span>' + it.date + '</span></div>' +
          '<button class="row-del" data-act="del">' + icon('trash', 17) + '</button></div>';
      }).join('');
      el.onclick = function (ev) {
        var row = ev.target.closest('[data-ts]');
        if (!row) return;
        var ts = parseInt(row.getAttribute('data-ts'), 10);
        var del = ev.target.closest('[data-act="del"]');
        var tog = ev.target.closest('[data-act="toggle"]');
        if (del) KiuMem.remove(tab, ts);
        else if (tog) KiuMem.toggleTarea(ts);
      };
    },
    memAddModal: function () {
      var self = this;
      var html =
        '<div class="seg" id="ma-seg" style="margin:0 0 14px">' +
        '<button class="seg-btn active" data-t="recuerdos">Recuerdo</button>' +
        '<button class="seg-btn" data-t="tareas">Tarea</button>' +
        '<button class="seg-btn" data-t="notas">Nota</button>' +
        '<button class="seg-btn" data-t="alarmas">Alarma</button></div>' +
        '<textarea id="ma-txt" class="tool-textarea" placeholder="Escribí acá..."></textarea>' +
        '<div id="ma-alarm" class="hidden">' +
        '<input id="ma-title" class="tool-input" placeholder="Ej: Llamar al veterinario">' +
        '<input id="ma-when" class="tool-input" type="datetime-local" style="margin-top:10px">' +
        '</div>' +
        '<button class="btn-primary full" id="ma-save" style="margin-top:12px">Guardar</button>';
      var body = this.modal('Agregar a la memoria', html);
      if (!body) return;
      var type = 'recuerdos';
      body.querySelector('#ma-seg').addEventListener('click', function (ev) {
        var b = ev.target.closest('.seg-btn');
        if (!b) return;
        var bs = body.querySelectorAll('#ma-seg .seg-btn');
        for (var i = 0; i < bs.length; i++) bs[i].classList.remove('active');
        b.classList.add('active');
        type = b.getAttribute('data-t');
        var isAlarm = type === 'alarmas';
        body.querySelector('#ma-txt').classList.toggle('hidden', isAlarm);
        body.querySelector('#ma-alarm').classList.toggle('hidden', !isAlarm);
      });
      body.querySelector('#ma-save').addEventListener('click', function () {
        if (type === 'alarmas') {
          var ti = body.querySelector('#ma-title').value.trim();
          var w = body.querySelector('#ma-when').value;
          if (!ti || !w) { self.toast('Falta el título o la fecha'); return; }
          var ms = new Date(w).getTime();
          if (isNaN(ms) || ms <= Date.now()) { self.toast('Elegí una hora futura'); return; }
          var ok = self.addReminder(ti, new Date(ms));
          self.closeModal();
          self.toast(ok ? 'Alarma lista: ' + fmtWhen(ms) : 'Guardada (suena con la app instalada)');
          return;
        }
        var t = body.querySelector('#ma-txt').value.trim();
        if (!t) { self.toast('Escribí algo primero'); return; }
        if (type === 'tareas') KiuMem.addTarea(t);
        else if (type === 'notas') KiuMem.addNota(t);
        else KiuMem.addRecuerdo(t);
        self.closeModal();
        self.toast('Guardado');
      });
    },

    /* ---------- Ajustes ---------- */
    /* ---------- MOTOR LOCAL: servidor, perfiles, visión, catálogo ---------- */
    normUrl: function (u) {
      u = (u || '').trim();
      if (!u) return '';
      if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
      return u.replace(/\/+$/, '');
    },
    pickChatModel: function (models, prof) {
      var i;
      if (prof === 'deep') {
        for (i = 0; i < models.length; i++) if (/deepseek|r1|reason/i.test(models[i])) return models[i];
      }
      if (prof === 'qwen') {
        for (i = 0; i < models.length; i++) if (/qwen/i.test(models[i]) && !/(vl|vision|llava)/i.test(models[i])) return models[i];
      }
      for (i = 0; i < models.length; i++) {
        if (!/(vl|vision|llava|minicpm|embed|whisper|rerank|clip|guard)/i.test(models[i])) return models[i];
      }
      return models[0] || '';
    },
    pickVisModel: function (models) {
      for (var i = 0; i < models.length; i++) {
        if (/qwen.*vl|vl-|vision|vlmodel|llava|minicpm-v|gemma-3|pixtral|moondream|internvl/i.test(models[i])) return models[i];
      }
      return '';
    },
    bindLocal: function () {
      var self = this;
      var rl = document.getElementById('row-local');
      if (!rl) return;
      rl.addEventListener('click', function () {
        var b = document.getElementById('local-block');
        if (b) b.classList.toggle('hidden');
        self.renderLocal();
      });
      var urlIn = document.getElementById('loc-url');
      if (!urlIn) return;
      urlIn.value = S.loc.url || '';
      document.getElementById('loc-pc').addEventListener('click', function () {
        urlIn.value = 'http://192.168.1.10:1234/v1';
        self.toast('Poné la IP de tu PC · LM Studio → Developer → Start');
      });
      document.getElementById('loc-tel').addEventListener('click', function () {
        urlIn.value = 'http://127.0.0.1:11434/v1';
        self.toast('Ollama corriendo en este teléfono (Termux)');
      });
      document.getElementById('loc-connect').addEventListener('click', function () { self.locConnect(); });
      document.getElementById('loc-model').addEventListener('change', function () {
        S.loc.model = this.value;
        var o = pstate('ollama');
        o.model = this.value; o.ok = false; saveS();
        self.renderStatus();
        self.locProfSub();
      });
      document.getElementById('loc-vismodel').addEventListener('change', function () {
        S.loc.visModel = this.value; saveS();
        self.locProfSub();
      });
      document.getElementById('loc-profiles').addEventListener('click', function (ev) {
        var b = ev.target.closest('.seg-btn');
        if (!b) return;
        S.loc.prof = b.getAttribute('data-prof');
        self.locApplyProfile();
      });
      document.getElementById('loc-test').addEventListener('click', function () { self.locTestProfile(); });
      document.getElementById('loc-vistest').addEventListener('click', function () { self.locTestVision(); });
      document.getElementById('loc-detail').addEventListener('click', function (ev) {
        var b = ev.target.closest('.seg-btn');
        if (!b) return;
        var bs = document.querySelectorAll('#loc-detail .seg-btn');
        for (var i = 0; i < bs.length; i++) bs[i].classList.remove('active');
        b.classList.add('active');
        S.maxTok = parseInt(b.getAttribute('data-tok'), 10) || 700;
        saveS();
        var gl = document.getElementById('gen-len');
        if (gl) {
          var bs2 = gl.querySelectorAll('.seg-btn');
          for (var j = 0; j < bs2.length; j++) bs2[j].classList.toggle('active', parseInt(bs2[j].getAttribute('data-tok'), 10) === S.maxTok);
        }
        self.toast('Respuestas ' + b.textContent.toLowerCase());
      });
      document.getElementById('loc-catalog').addEventListener('click', function () { self.go('models'); });
      document.getElementById('loc-help').addEventListener('click', function () { self.locHelp(); });
      document.getElementById('loc-free').addEventListener('click', function () { self.locFreeRam(); });
    },
    renderLocal: function () {
      var dot = document.getElementById('loc-dot');
      if (!dot) return;
      var stTxt = document.getElementById('loc-status');
      var sub = document.getElementById('local-sub');
      var host = S.loc.url ? S.loc.url.replace(/^https?:\/\//, '').split('/')[0] : '';
      if (S.loc.ok && S.loc.models.length) {
        dot.className = 'status-dot api';
        stTxt.textContent = 'LISTO · ' + S.loc.models.length + ' modelo' + (S.loc.models.length === 1 ? '' : 's') + ' · ' + S.loc.latency + ' ms · ' + host;
        if (sub) sub.textContent = 'Servidor local · ' + (S.loc.model || 'sin modelo');
      } else if (S.loc.url) {
        dot.className = 'status-dot err';
        stTxt.textContent = 'Sin conexión · ' + host;
        if (sub) sub.textContent = 'Servidor guardado · toca Conectar';
      } else {
        dot.className = 'status-dot';
        stTxt.textContent = 'Sin conectar · todo queda en tu red';
        if (sub) sub.textContent = 'Servidor en tu red o teléfono · privado';
      }
      var models = S.loc.models || [];
      var selM = document.getElementById('loc-model');
      if (selM) {
        selM.innerHTML = models.length
          ? models.map(function (m) { return '<option value="' + esc(m) + '"' + (m === S.loc.model ? ' selected' : '') + '>' + esc(m) + '</option>'; }).join('')
          : '<option value="">Conectá el servidor primero</option>';
      }
      var selV = document.getElementById('loc-vismodel');
      if (selV) {
        selV.innerHTML = models.length
          ? models.map(function (m) { return '<option value="' + esc(m) + '"' + (m === S.loc.visModel ? ' selected' : '') + '>' + esc(m) + '</option>'; }).join('')
          : '<option value="">Sin modelos aún</option>';
      }
      var ps = document.querySelectorAll('#loc-profiles .seg-btn');
      for (var i = 0; i < ps.length; i++) ps[i].classList.toggle('active', ps[i].getAttribute('data-prof') === S.loc.prof);
      this.locProfSub();
      var ds = document.querySelectorAll('#loc-detail .seg-btn');
      for (var j = 0; j < ds.length; j++) ds[j].classList.toggle('active', parseInt(ds[j].getAttribute('data-tok'), 10) === S.maxTok);
      var ram = document.getElementById('loc-ram');
      if (ram) {
        var d = (Sys && Sys.d) || {};
        if (d.ramAvail) {
          ram.textContent = fmtGB(d.ramAvail) + ' GB libres de ' + fmtGB(d.ramTotal) + ' GB';
          if (d.appPssKb != null && isFinite(Number(d.appPssKb))) {
            ram.textContent += ' · KIU usa ' + (Number(d.appPssKb) / 1024).toFixed(0) + ' MB';
          }
          if (d.nativeLoaded) ram.textContent += ' · motor local activo';
        } else ram.textContent = 'Datos reales en la app del teléfono';
      }
    },
    locProfSub: function () {
      var el = document.getElementById('loc-prof-sub');
      var names = { qwen: 'Qwen rápido', deep: 'DeepSeek · Razonar', libre: 'Libre' };
      var vis = S.loc.visModel ? ' · visión: ' + S.loc.visModel : ' · sin visión';
      if (el) el.textContent = (names[S.loc.prof] || 'Libre') + ' · ' + (S.loc.model || 'sin modelo') + vis;
    },
    locConnect: function () {
      var self = this;
      var url = this.normUrl(document.getElementById('loc-url').value);
      var errEl = document.getElementById('loc-err');
      errEl.textContent = '';
      if (url.indexOf('http') !== 0) {
        errEl.textContent = 'Poné una URL válida, ej: http://192.168.1.10:1234/v1';
        return;
      }
      S.loc.url = url;
      var key = document.getElementById('loc-key').value.trim();
      var btn = document.getElementById('loc-connect');
      var old = btn.textContent;
      btn.disabled = true; btn.textContent = 'Conectando…';
      var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var to = setTimeout(function () { if (ctrl) ctrl.abort(); }, 9000);
      var t0 = Date.now();
      var h = { 'Content-Type': 'application/json' };
      if (key) h['Authorization'] = 'Bearer ' + key;
      fetch(url + '/models', { headers: h, signal: ctrl ? ctrl.signal : undefined })
        .then(function (r) {
          clearTimeout(to);
          if (!r.ok) throw new Error(self.apiErr(r.status));
          return r.json();
        })
        .then(function (j) {
          var arr = (j && j.data) || [];
          var models = [];
          for (var i = 0; i < arr.length; i++) if (arr[i] && arr[i].id) models.push(String(arr[i].id));
          if (!models.length) throw new Error('el servidor no devolvió modelos');
          models = models.slice(0, 60);
          var lat = Date.now() - t0;
          S.loc.models = models;
          S.loc.ok = true; S.loc.latency = lat; S.loc.err = '';
          if (key) setProvKey('ollama', key);
          var o = pstate('ollama');
          o.url = url; o.on = true; o.ok = true; o.latency = lat; o.err = '';
          o.model = (S.loc.model && models.indexOf(S.loc.model) >= 0) ? S.loc.model : self.pickChatModel(models, S.loc.prof);
          S.loc.model = o.model;
          var vis = self.pickVisModel(models);
          if (vis) S.loc.visModel = vis;
          saveS();
          self.renderLocal();
          self.renderProviders();
          self.renderStatus();
          self.toast('Conectado · ' + models.length + ' modelos · ' + lat + ' ms');
        })
        .catch(function (e) {
          S.loc.ok = false;
          S.loc.err = (e && e.message) || 'sin conexión';
          var o = pstate('ollama');
          o.ok = false; o.err = S.loc.err; saveS();
          errEl.textContent = 'No pude conectar: ' + S.loc.err + ' · mirá la Guía abajo (misma red, servidor prendido, "Serve on Local Network").';
          self.renderLocal();
        })
        .then(function () { btn.disabled = false; btn.textContent = old; });
    },
    locApplyProfile: function () {
      var models = S.loc.models || [];
      var pick = this.pickChatModel(models, S.loc.prof);
      if (pick) {
        S.loc.model = pick;
        var o = pstate('ollama');
        o.model = pick; o.ok = false;
      }
      if (S.loc.prof === 'deep' && S.maxTok < 1200) S.maxTok = 1200;
      if (S.loc.prof === 'qwen' && S.maxTok > 700) S.maxTok = 700;
      saveS();
      this.renderLocal();
      this.renderStatus();
      this.toast('Perfil: ' + ({ qwen: 'Qwen rápido', deep: 'DeepSeek · Razonar', libre: 'Libre' })[S.loc.prof]);
    },
    locTestProfile: function () {
      var self = this;
      if (!S.loc.ok || !S.loc.models.length) { this.toast('Conectá el servidor primero'); return; }
      var o = pstate('ollama');
      var btn = document.getElementById('loc-test');
      btn.textContent = 'Probando…';
      var t0 = Date.now();
      fetch((S.loc.url || o.url).replace(/\/+$/, '') + '/chat/completions', {
        method: 'POST',
        headers: this.provHeaders({ def: provDef('ollama'), st: o }),
        body: JSON.stringify({ model: S.loc.model || o.model, messages: [{ role: 'user', content: 'Contestá solo con: OK' }], max_tokens: 10, temperature: 0.1, stream: false })
      }).then(function (r) {
        if (!r.ok) throw new Error(self.apiErr(r.status));
        return r.json();
      }).then(function (j) {
        var txt = (j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
        o.ok = true; o.latency = Date.now() - t0; o.err = ''; saveS();
        self.toast('Perfil OK · ' + o.latency + ' ms · "' + String(txt).trim().slice(0, 24) + '"');
        btn.textContent = 'Probar perfil seleccionado';
        self.renderStatus();
      }).catch(function (e) {
        o.ok = false; saveS();
        self.toast('Falló la prueba: ' + ((e && e.message) || 'sin conexión'));
        btn.textContent = 'Probar perfil seleccionado';
      });
    },
    locTestVision: function () {
      var self = this;
      if (!S.loc.ok) { this.toast('Conectá el servidor primero'); return; }
      var vis = S.loc.visModel || this.pickVisModel(S.loc.models || []);
      if (!vis) { this.toast('Tu servidor no tiene un modelo de visión cargado'); return; }
      S.loc.visModel = vis;
      var inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'image/*';
      inp.onchange = function () {
        var f = inp.files && inp.files[0];
        if (!f) return;
        self.downscale(f, 768, 0.82, function (dataUrl) { self.visProbe(dataUrl, vis); });
      };
      inp.click();
    },
    visProbe: function (dataUrl, model) {
      var self = this;
      this.toast('Analizando la foto con ' + model + '…');
      var t0 = Date.now();
      fetch(S.loc.url.replace(/\/+$/, '') + '/chat/completions', {
        method: 'POST',
        headers: this.provHeaders({ def: provDef('ollama'), st: pstate('ollama') }),
        body: JSON.stringify({
          model: model,
          messages: [{ role: 'user', content: [{ type: 'text', text: 'Describí esta imagen en 2 frases y decí qué texto aparece, si hay.' }, { type: 'image_url', image_url: { url: dataUrl } }] }],
          max_tokens: 220, temperature: 0.4, stream: false
        })
      }).then(function (r) {
        if (!r.ok) throw new Error(self.apiErr(r.status));
        return r.json();
      }).then(function (j) {
        var txt = (j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || 'El modelo no devolvió texto.';
        S.loc.visOn = true; saveS();
        var html =
          '<img class="msg-img" style="max-width:170px" src="' + dataUrl + '" alt="foto de prueba">' +
          '<p class="set-hint" style="margin:10px 0 6px"><b>' + esc(model) + '</b> respondió en ' + (Date.now() - t0) + ' ms. Ya podés mandar fotos en el chat con el botón +.</p>' +
          '<div class="codeblock"><pre><code>' + esc(String(txt).trim().slice(0, 600)) + '</code></pre></div>';
        self.modal('Visión local funciona', html);
      }).catch(function (e) {
        self.modal('Visión local', '<p class="set-hint">No pude analizar la foto: <b>' + esc((e && e.message) || 'sin conexión') + '</b>.<br><br>En LM Studio cargá un modelo VL (y su mmproj). En Ollama: <code>ollama pull qwen2.5vl:3b</code> y elegilo arriba.</p>');
      });
    },
    downscale: function (file, maxSide, q, cb) {
      try {
        var fr = new FileReader();
        fr.onload = function () {
          var img = new Image();
          img.onload = function () {
            var sc = Math.min(1, maxSide / Math.max(img.width, img.height));
            var cv = document.createElement('canvas');
            cv.width = Math.max(1, Math.round(img.width * sc));
            cv.height = Math.max(1, Math.round(img.height * sc));
            cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
            cb(cv.toDataURL('image/jpeg', q));
          };
          img.onerror = function () { App.toast('No pude leer esa imagen'); };
          img.src = fr.result;
        };
        fr.readAsDataURL(file);
      } catch (e) { App.toast('No pude procesar la imagen'); }
    },
    clearPhoto: function () {
      this._pendingImg = null;
      this._pendingThumb = null;
      var bar = document.getElementById('photo-bar');
      if (bar) bar.classList.add('hidden');
      var th = document.getElementById('photo-thumb');
      if (th) th.removeAttribute('src');
    },
    CATALOG: [
      { g: 'Texto', n: 'Qwen3 1.7B Q4_K_M', s: '1,1 GB', r: 2.6, u: 'https://huggingface.co/Qwen/Qwen3-1.7B-GGUF' },
      { g: 'Texto', n: 'Qwen3 4B Q4_K_M', s: '2,5 GB', r: 4.2, u: 'https://huggingface.co/Qwen/Qwen3-4B-GGUF' },
      { g: 'Texto', n: 'Llama 3.2 3B Q4_K_M', s: '2,0 GB', r: 3.6, u: 'https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF' },
      { g: 'Texto', n: 'Gemma 3 4B Q4 (con visión)', s: '2,6 GB', r: 4.4, u: 'https://huggingface.co/google/gemma-3-4b-it-GGUF' },
      { g: 'Texto', n: 'Phi-4-mini 3.8B Q4', s: '2,4 GB', r: 4.0, u: 'https://huggingface.co/microsoft/Phi-4-mini-instruct-gguf' },
      { g: 'Texto', n: 'DeepSeek-R1 7B Q4 (razona)', s: '4,7 GB', r: 6.4, u: 'https://huggingface.co/unsloth/DeepSeek-R1-Distill-Qwen-7B-GGUF' },
      { g: 'Texto', n: 'Qwen3 8B Q4_K_M', s: '5,1 GB', r: 7.0, u: 'https://huggingface.co/Qwen/Qwen3-8B-GGUF' },
      { g: 'Visión', n: 'Qwen2.5-VL 3B Q4 (+mmproj)', s: '2,3 GB', r: 4.0, u: 'https://huggingface.co/Qwen/Qwen2.5-VL-3B-Instruct-GGUF' },
      { g: 'Visión', n: 'Qwen2.5-VL 7B Q4 (+mmproj)', s: '5,5 GB', r: 7.6, u: 'https://huggingface.co/Qwen/Qwen2.5-VL-7B-Instruct-GGUF' },
      { g: 'Visión', n: 'MiniCPM-V 2.6 Q4', s: '5,4 GB', r: 7.4, u: 'https://huggingface.co/openbmb/MiniCPM-V-2_6-gguf' }
    ],
    /* v2.11.0 · ASISTENTE DE VOZ. Junta lo que hace falta para que Kiu oiga y hable
       (micrófono, servicio de voz, modelo local, voz del teléfono, batería sin restricción,
       volumen) y deja arreglar cada cosa con un toque. Se abre solo la primera vez. */
    vozPasos: function () {
      try { KiuDiagVoz.verReal(); } catch (e) { }
      var d = KiuDiagVoz.raw || {};
      var x = {};
      try { x = JSON.parse(rawBridge('kiuAsist') || '{}'); } catch (e2) { }
      return [
        { id: 'mic', ok: !!d.mic, t: 'Micrófono', ok_d: 'Permiso concedido', bad_d: 'Falta el permiso para oírte', btn: 'Dar permiso' },
        { id: 'rec', ok: !!d.recogn, t: 'Servicio de voz del teléfono', ok_d: 'Disponible', bad_d: 'No hay un servicio de reconocimiento de voz activo', btn: 'Abrir ajustes' },
        { id: 'model', ok: !!d.voskModel, t: 'Despertar por voz sin internet', ok_d: 'Modelo instalado', bad_d: 'Falta el modelo de voz (39 MB). Sin él, «Kiu» necesita internet para despertarla', btn: 'Instalarlo' },
        { id: 'tts', ok: !!d.ttsReady, t: 'Voz de Kiu', ok_d: 'Lista', bad_d: 'El teléfono no arrancó su motor de voz: Kiu responde escrito pero no habla', btn: 'Abrir ajustes' },
        { id: 'bat', ok: x.bateriaLibre !== false, t: 'Batería sin restricciones', ok_d: 'Kiu puede escuchar en segundo plano', bad_d: 'Android puede cerrar la escucha con la pantalla apagada. Buscá Kiu y elegí «Sin restricciones»', btn: 'Abrir ajustes' },
        { id: 'vol', ok: !(x.vol >= 0 && x.vol < 20), t: 'Volumen de medios', ok_d: x.vol >= 0 ? 'Al ' + x.vol + '%' : 'Correcto', bad_d: 'Está muy bajo (' + x.vol + '%): no vas a oír a Kiu', btn: 'Subir volumen' }
      ];
    },
    asistenteVoz: function () {
      var self = this;
      var pasos = this.vozPasos();
      var malos = pasos.filter(function (p) { return !p.ok; });
      var html = '<p class="set-hint" style="margin:2px 0 10px">' + (malos.length ? 'Hay ' + malos.length + (malos.length === 1 ? ' cosa' : ' cosas') + ' para arreglar. Tocá cada botón; al volver, revisá de nuevo.' : 'Todo listo: Kiu puede oírte y hablarte.') + '</p><div class="list">';
      pasos.forEach(function (p) {
        html += '<div class="list-row"><span class="list-ic" style="color:' + (p.ok ? '#34D399' : '#FBBF24') + ';font-weight:900">' + (p.ok ? '✓' : '!') + '</span>' +
          '<div class="list-txt"><strong>' + esc(p.t) + '</strong><span>' + esc(p.ok ? p.ok_d : p.bad_d) + '</span></div>' +
          (p.ok ? '' : '<button class="chip-btn" data-av="' + p.id + '">' + esc(p.btn) + '</button>') + '</div>';
      });
      html += '</div><button class="btn-primary full" id="av-again" style="margin-top:12px">Revisar de nuevo</button>';
      var body = this.modal('Asistente de voz', html);
      if (!body) return;
      body.addEventListener('click', function (ev) {
        if (ev.target.closest('#av-again')) { self.asistenteVoz(); return; }
        var b = ev.target.closest('[data-av]');
        if (!b) return;
        var id = b.getAttribute('data-av');
        if (id === 'mic') { bridge('listen'); setTimeout(function () { self.asistenteVoz(); }, 4500); return; }
        if (id === 'rec') { bridge('openSettings', ['voiceinput']); return; }
        if (id === 'tts') { bridge('openSettings', ['tts']); return; }
        if (id === 'bat') { bridge('openSettings', ['bateriaapp']); return; }
        if (id === 'vol') { bridge('openSettings', ['sonido']); return; }
        if (id === 'model') {
          self.closeModal(); self.go('settings'); self.renderDiagVoz();
          setTimeout(function () { var bx = document.getElementById('diag-voz-box'); if (bx && bx.scrollIntoView) bx.scrollIntoView({ block: 'start' }); }, 250);
        }
      });
    },
    /* Primera vez: si falta algo de la voz, el asistente se abre solo (una sola vez). */
    asistenteAuto: function () {
      try {
        if (store('kiu_asist_voz') || !store('nexo_onb')) return;
        var root = document.getElementById('modal-root');
        if (root && !root.classList.contains('hidden')) return;
        var malos = this.vozPasos().filter(function (p) { return !p.ok; });
        store('kiu_asist_voz', 1);
        if (malos.length) this.asistenteVoz();
      } catch (e) { }
    },

    /* v2.11.0 · ACTUALIZACIONES. Consulta el último Release de GitHub y compara con la versión
       instalada. Solo abre la descarga: instalar lo hace Android, y solo acepta el APK si está
       firmado con la misma clave. */
    verNum: function (v) {
      var m = String(v || '').match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
      return m ? [+m[1], +(m[2] || 0), +(m[3] || 0)] : null;
    },
    buscarUpdate: function (manual) {
      var self = this;
      if (!manual) {
        var u = (S.upd = S.upd || {});
        if (u.auto === undefined) u.auto = true;
        if (!u.auto || Date.now() - (u.last || 0) < 21600000) return; /* cada 6 h */
        u.last = Date.now(); saveS();
      }
      var cur = '';
      try { KiuDiagVoz.verReal(); cur = KiuDiagVoz.ver || ''; } catch (e) { }
      if (manual) this.toast('Buscando versión nueva…');
      fetch('https://api.github.com/repos/Criptobox/KIU/releases/latest', { headers: { Accept: 'application/vnd.github+json' } })
        .then(function (r) {
          if (r.status === 404) {
            /* v2.14.9: el CI publica una release SOLO cuando hay un tag (v*).
               Sin tag no hay release y no hay de dónde bajar: decirlo con las
               palabras exactas, porque "no descarga" sin explicación hace
               pensar que la app está rota. */
            var e404 = new Error('todavía no hay versiones publicadas: el CI solo publica una release cuando hay un tag (v2.14.8, por ejemplo)');
            e404.soft = true;
            throw e404;
          }
          if (!r.ok) throw new Error('GitHub respondió ' + r.status);
          return r.json();
        })
        .then(function (rel) {
          var tag = String(rel.tag_name || '');
          var a = self.verNum(tag), b = self.verNum(cur);
          var nueva = !!(a && b && (a[0] - b[0] || a[1] - b[1] || a[2] - b[2]) > 0);
          if (!b) { if (manual) self.toast('No pude leer tu versión instalada; la última publicada es ' + tag); return; }
          if (!nueva) { if (manual) self.toast('Ya tenés la última versión (' + cur + ')'); return; }
          if (!manual) rawBridge('notifyUpdate', ['Kiu ' + tag + ' disponible', 'Tenés ' + cur + '. Tocá para descargarla e instalarla.']);
          store('kiu_upd_visto', tag);
          var apk = null, as = rel.assets || [];
          for (var i = 0; i < as.length; i++) if (/\.apk$/i.test(as[i].name) && /release/i.test(as[i].name)) { apk = as[i]; break; }
          if (!apk) for (var j = 0; j < as.length; j++) if (/\.apk$/i.test(as[j].name)) { apk = as[j]; break; }
          var notas = String(rel.body || '').replace(/[#*`>]/g, '').trim().slice(0, 500);
          /* v2.11.3: la descarga se hace dentro de la app, con la misma tarjeta que los modelos */
          var html = '<p class="set-hint" style="margin:2px 0 8px">Tenés <b>' + esc(cur) + '</b> y está disponible <b>' + esc(tag) + '</b>.</p>' +
            (notas ? '<p class="set-hint small" style="white-space:pre-wrap;margin:0 0 10px">' + esc(notas) + '</p>' : '') +
            (apk ? '<div id="upd-card"></div>' : '<p class="set-hint small">Esta versión no trae el APK adjunto todavía.</p>') +
            '<button class="btn-ghost full" id="upd-gh" style="justify-content:center;margin-top:8px">Ver en GitHub</button>' +
            '<p class="set-hint small" id="upd-hint" style="margin:10px 0 0">Se baja aquí mismo y Android te pide confirmar la instalación. Se actualiza sin borrar tus datos si el build está firmado con la misma clave.</p>';
          var body = self.modal('Hay una versión nueva', html);
          if (!body) return;
          if (apk) self.updCard(body, apk, tag);
          body.querySelector('#upd-gh').addEventListener('click', function () { if (!self.openUrl(rel.html_url)) self.copyText(rel.html_url); });
        })
        .catch(function (err) {
          if (manual) {
            self.toast('No pude buscar: ' + (err && err.message ? err.message : 'sin conexión'));
          } else if (err && err.soft) {
            /* sin red o sin releases: no es un fallo de la app */
            self.toast(err.message);
          }
        });
    },

    /* v2.11.3 · tarjeta de descarga de la actualización, con el diseño de «Modelos»: anillo con %,
       tamaño y velocidad, y botones Cancelar / Instalar. Baja con el mismo motor que los GGUF
       (updStart + dlStatus + dlCancel) y entrega el APK al instalador (updInstall). */
    updCard: function (body, apk, tag) {
      var self = this;
      var card = body.querySelector('#upd-card');
      var hint = body.querySelector('#upd-hint');
      if (!card) return;
      var C = 119.4, jid = '', timer = null, path = '', total = apk.size || 0, lastG = 0, lastT = 0, spd = 0, verif = false;
      var mb = function (b) { return b >= 1073741824 ? (b / 1073741824).toFixed(1).replace('.', ',') + ' GB' : Math.max(1, Math.round(b / 1048576)) + ' MB'; };
      var ring = function (pct) {
        return '<span class="k2-ringwrap"><svg width="46" height="46" viewBox="0 0 46 46"><circle cx="23" cy="23" r="19" fill="none" stroke="rgba(126,158,255,.16)" stroke-width="4"/><circle cx="23" cy="23" r="19" fill="none" stroke="#2DD4BF" stroke-width="4" stroke-linecap="round" stroke-dasharray="' + C + '" stroke-dashoffset="' + (C - C * pct / 100).toFixed(1) + '" transform="rotate(-90 23 23)"/></svg><b>' + pct + '%</b></span>';
      };
      var sizeTxt = total ? mb(total) : 'APK';
      var show = function (st, msg) {
        var h;
        if (st === 'run') {
          h = '<div class="k2-model">' + ring(0) + '<div class="k2-mid"><p class="k2-name">0% · Kiu ' + esc(tag) + '</p><p class="k2-sub">Empezando…</p></div>' +
            '<div class="k2-acts" style="flex-direction:row"><button class="k2-iconbtn danger" data-u="stop" aria-label="Cancelar">' + icon('xmark', 13) + '</button></div></div>';
        } else if (st === 'done') {
          h = '<div class="k2-model"><span class="k2-tile big tl-green">' + icon('check', 19) + '</span><div class="k2-mid"><p class="k2-name">Kiu ' + esc(tag) + ' · listo</p><p class="k2-sub">Descargado' + (total ? ' · ' + mb(total) : '') + (verif ? ' · huella SHA-256 verificada ✓' : (apk.digest ? ' · sin verificar (Android la verifica al instalar)' : ' · sin huella para comparar')) + '</p></div>' +
            '<div class="k2-acts"><button class="k2-pill solid" data-u="inst">Instalar</button></div></div>';
        } else {
          h = '<div class="k2-model' + (st === 'err' ? ' err' : '') + '"><span class="k2-tile big tl-violet">' + icon('save', 19) + '</span><div class="k2-mid"><p class="k2-name">Kiu ' + esc(tag) + '</p><p class="k2-sub">' + (st === 'err' ? esc(msg || 'No se pudo bajar') : 'Actualización · ' + sizeTxt) + '</p></div>' +
            '<div class="k2-acts"><button class="k2-pill solid" data-u="dl">' + (st === 'err' ? 'Reintentar' : 'Descargar') + '</button></div></div>';
        }
        card.innerHTML = h;
        paintIcons(card);
      };
      /* progreso en sitio: no se reconstruye la tarjeta, así el toque en Cancelar no se pierde */
      var paint = function (got, tot) {
        var pct = tot ? Math.min(100, Math.round(got / tot * 100)) : 0;
        var now = Date.now();
        if (lastT && now > lastT && got >= lastG) { var sp = (got - lastG) / ((now - lastT) / 1000); if (sp > 10240) spd = sp; }
        lastG = got; lastT = now;
        var sTxt = spd ? ((spd / 1048576) >= 10 ? Math.round(spd / 1048576) + ' MB/s' : (spd / 1048576).toFixed(1).replace('.', ',') + ' MB/s') : '';
        var rg = card.querySelector('.k2-ringwrap'), nm = card.querySelector('.k2-name'), sb = card.querySelector('.k2-sub');
        if (!rg || !nm || !sb) return;
        var arc = rg.querySelectorAll('circle')[1];
        if (arc) arc.setAttribute('stroke-dashoffset', (C - C * pct / 100).toFixed(1));
        var b = rg.querySelector('b'); if (b) b.textContent = pct + '%';
        nm.textContent = pct + '% · Kiu ' + tag;
        sb.innerHTML = mb(got) + (tot ? ' de ' + mb(tot) : '') + (sTxt ? ' · <span class="spd">' + sTxt + '</span>' : '');
      };
      var stop = function () { if (timer) { clearInterval(timer); timer = null; } };
      var poll = function () {
        stop();
        timer = setInterval(function () {
          var st = jparse(rawBridge('dlStatus', [jid]) || '{}', {});
          var alive = document.body.contains(card);
          if (st.st === 'downloading' || st.st === 'queued' || st.st === 'run') {
            if (st.total) total = st.total;
            if (alive) paint(st.got || 0, total);
            return;
          }
          stop();
          if (st.st === 'done' && total > 0 && (st.got || 0) > 0 && (st.got || 0) < total) st = { st: 'err', err: 'Se cortó al final: tocá Reintentar y sigue donde quedó' };
          if (st.st === 'done') {
            path = st.path || path;
            verif = !!st.verified;
            if (alive) show('done'); else self.toast('Actualización descargada · abrí Buscar versión nueva para instalarla');
          } else if (st.st === 'cancelled') {
            if (alive) { show('idle'); if (hint) hint.textContent = 'Cancelado. Lo que bajó queda guardado y sigue desde ahí.'; }
          } else if (alive) {
            show('err', (st.err || 'sin conexión').slice(0, 80));
          }
        }, 900);
      };
      var start = function () {
        var raw = rawBridge('updStart', [apk.browser_download_url, apk.name, String(apk.size || 0), String(apk.digest || '')]);
        if (raw === null) {
          /* sin el puente nativo (navegador): la descarga de siempre */
          if (!self.openUrl(apk.browser_download_url)) self.copyText(apk.browser_download_url);
          return;
        }
        var res = jparse(raw || '{}', {});
        if (res.st === 'done') { path = res.path || ''; if (res.b) total = res.b; verif = !!apk.digest; show('done'); return; }
        if (!res.id) { show('err', res.err || 'No pude empezar la descarga'); return; }
        jid = res.id; path = res.path || '';
        show('run');
        poll();
      };
      card.addEventListener('click', function (ev) {
        var el = ev.target.closest('[data-u]');
        if (!el) return;
        var a = el.getAttribute('data-u');
        if (a === 'dl') start();
        else if (a === 'stop') rawBridge('dlCancel', [jid]);
        else if (a === 'inst') {
          var r = rawBridge('updInstall', [path]);
          if (r === 'ok') self.toast('Android te pide confirmar la instalación');
          else if (r === 'perm') { if (hint) hint.textContent = 'Activá «Permitir de esta fuente» para Kiu y volvé a tocar Instalar.'; self.toast('Permití instalar apps desde Kiu y volvé a tocar Instalar'); }
          else {
            var msg = String(r == null ? '' : r).replace(/^err:/, '').trim();
            /* v2.14.9 · la FIRMA DISTINTA es el error clásico de "no me deja
               instalar". No es un archivo roto: es que el APK está firmado
               con otra clave y Android no deja ponerlo encima del que ya
               tenés. Se dice con palabras, no con un toast críptico. */
            if (/firma/i.test(msg)) {
              if (hint) hint.textContent = msg;
              self.botSay('!! **No se puede instalar encima**\n!! ' + msg.replace(/\n/g, ' ') +
                '\n!! → [Ver las versiones](https://github.com/Criptobox/KIU/releases/latest)', null, true);
            } else {
              self.toast('No pude abrir el instalador' + (msg ? ': ' + msg.slice(0, 60) : ''));
            }
          }
        }
      });
      show('idle');
    },

    /* v2.11.0 · «Recomendarme modelos para mi teléfono»: lee RAM, núcleos y espacio libre
       (sysInfo) y propone qué bajar, en texto (motor interno) y en visión (fotos). */
    recomendar: function () {
      var self = this;
      try { Sys.refresh(); } catch (e) { }
      var plan = window.KiuReco ? KiuReco.plan(Sys.d, { done: (S.dl && S.dl.done) || {}, vis: this.CATALOG, bench: S.bench || {} }) : { unknown: true };
      if (plan.unknown) {
        this.modal('Recomendados para tu teléfono', '<p class="set-hint">No pude leer la memoria de este dispositivo. Esto funciona dentro de la app del teléfono.</p>');
        return;
      }
      var g1 = function (n) { return (Math.round(n * 10) / 10).toString().replace('.', ','); };
      var LBL = { quality: 'Mejor calidad', balanced: 'Equilibrado', fast: 'Más rápido', code: 'Para código', reason: 'Razona' };
      var tier = { baja: 'Un teléfono de gama básica: te van mejor los modelos chicos.', media: 'Gama media: modelos de 1 a 4 mil millones de parámetros van bien.', alta: 'Mucha RAM: podés usar modelos grandes.' }[plan.tier];
      var row = function (r) {
        var c = r.c;
        var act = r.done ? '<i class="fit-badge fit-ok">Ya lo tenés ✓</i>' : '<button class="chip-btn" data-reco-dl="' + esc(c.f) + '">Descargar</button>';
        return '<div class="list-row"><span class="list-ic">' + icon('brain', 18) + '</span><div class="list-txt"><strong>' + LBL[r.k] + ' · ' + esc(prettyName(c.f)) + '</strong>' +
          '<span>' + (c.gb < 1 ? Math.round(c.gb * 1024) + ' MB' : g1(c.gb) + ' GB') + ' · RAM ~' + g1(c.r) + ' GB · ' + r.why + '</span></div>' + act + '</div>';
      };
      var html = '<div class="list-row"><span class="list-ic">' + icon('cpu', 18) + '</span><div class="list-txt"><strong>' + esc(plan.model || 'Tu teléfono') + '</strong>' +
        '<span>' + g1(plan.ram) + ' GB RAM · ' + (plan.cores || '?') + ' núcleos' + (plan.disk ? ' · ' + g1(plan.disk) + ' GB libres' : '') + '</span></div></div>' +
        '<p class="set-hint" style="margin:8px 0">' + tier + '</p>';
      html += '<p class="set-hint small" style="margin:10px 0 4px"><b>Texto</b> · corre dentro de Kiu, sin internet</p><div class="list">';
      html += plan.text.length ? plan.text.map(row).join('') : '<p class="set-hint small">Ningún modelo de la lista entra con la RAM y el espacio libres de ahora.</p>';
      html += '</div>';
      if (plan.extras.length) html += '<p class="set-hint small" style="margin:10px 0 4px"><b>Extras</b></p><div class="list">' + plan.extras.map(row).join('') + '</div>';
      if (plan.measured && plan.measured.length) {
        html += '<p class="set-hint small" style="margin:12px 0 4px"><b>Velocidad medida en tu teléfono</b></p>' +
          plan.measured.map(function (m) {
            return '<p class="set-hint small" style="margin:0 0 2px">' + esc(prettyName(m.c.f)) + ': ' + g1(m.tps) + ' tok/s' + (m.tps < 4 ? ' · lento' : m.tps >= 10 ? ' · fluido' : '') + '</p>';
          }).join('') +
          '<p class="set-hint small" style="margin:2px 0 0">Se mide sola al usar Kiu, o tocá «Probar motor» en Modelos.</p>';
      }
      html += '<p class="set-hint small" style="margin:12px 0 4px"><b>Visión</b> · entender fotos</p>' +
        '<p class="set-hint small" style="margin:0 0 6px">El motor interno de Kiu todavía lee solo texto. Para fotos se usa un modelo de visión en un servidor (Ollama en Termux, LM Studio en tu PC) o un proveedor en la nube.</p><div class="list">';
      var vrow = function (c, tag) {
        return '<div class="list-row" data-hf="' + esc(c.u) + '"><span class="list-ic">' + icon('eye', 18) + '</span><div class="list-txt"><strong>' + esc(c.n) + '</strong><span>' + c.s + ' · RAM ~' + g1(c.r) + ' GB · ' + tag + '</span></div><i class="fit-badge fit-ok">Abrir</i></div>';
      };
      if (plan.vision.phone) html += vrow(plan.vision.phone, 'el mejor para correr en este teléfono con Ollama');
      plan.vision.pc.forEach(function (c) { if (c !== plan.vision.phone) html += vrow(c, 'para tu PC o servidor'); });
      html += '</div>';
      if (plan.notes.length) html += plan.notes.map(function (n) { return '<p class="set-hint small" style="margin:8px 0 0">' + esc(n) + '</p>'; }).join('');
      html += '<button class="btn-primary full" id="reco-how" style="margin-top:12px">¿Cómo uso la visión con Kiu?</button>';
      var body = this.modal('Recomendados para tu teléfono', html);
      if (!body) return;
      body.addEventListener('click', function (ev) {
        var dl = ev.target.closest('[data-reco-dl]');
        if (dl) {
          var f = dl.getAttribute('data-reco-dl');
          for (var i = 0; i < MODCAT.length; i++) if (MODCAT[i].f === f) { self.closeModal(); Mod.start(MODCAT[i]); return; }
          return;
        }
        var row = ev.target.closest('[data-hf]');
        if (row) { if (!self.openUrl(row.getAttribute('data-hf'))) self.copyText(row.getAttribute('data-hf')); return; }
        if (ev.target.closest('#reco-how')) self.locHelp();
      });
    },
    locCatalog: function () {
      var self = this;
      var d = (Sys && Sys.d) || {};
      var tot = d.ramTotal || ((navigator.deviceMemory || 0) * 1073741824);
      var gb = tot ? tot / 1073741824 : 0;
      var rows = this.CATALOG.map(function (c) {
        var fit, cls, ex;
        if (!gb) { fit = 'RAM ?'; cls = 'fit-mid'; ex = 'sabrás en la app'; }
        else if (gb >= c.r + 0.8) { fit = 'Entra ✓'; cls = 'fit-ok'; ex = 'cómodo con ' + Math.round(gb) + ' GB'; }
        else if (gb >= c.r) { fit = 'Justo'; cls = 'fit-mid'; ex = 'cerrá apps antes'; }
        else { fit = 'Falta RAM'; cls = 'fit-no'; ex = 'necesita ~' + String(c.r).replace('.', ',') + ' GB'; }
        return '<div class="list-row" data-hf="' + esc(c.u) + '"><span class="list-ic">' + icon(c.g === 'Visión' ? 'eye' : 'brain', 18) + '</span>' +
          '<div class="list-txt"><strong>' + esc(c.n) + '</strong><span>' + c.s + ' · ~' + String(c.r).replace('.', ',') + ' GB RAM · ' + ex + '</span></div>' +
          '<i class="fit-badge ' + cls + '">' + fit + '</i></div>';
      }).join('');
      var html =
        '<p class="set-hint" style="margin:2px 0 10px">Modelos GGUF para tu servidor local. Tocá uno para abrir su página de descarga. El tamaño es el archivo; la RAM incluye el contexto.</p>' +
        '<div class="list" style="max-height:50vh;overflow:auto">' + rows + '</div>' +
        '<button class="btn-primary full" id="cat-how" style="margin-top:12px">¿Cómo los uso con Kiu?</button>';
      var body = this.modal('Catálogo de modelos GGUF', html);
      if (!body) return;
      body.querySelector('.list').addEventListener('click', function (ev) {
        var row = ev.target.closest('[data-hf]');
        if (!row) return;
        if (!self.openUrl(row.getAttribute('data-hf'))) self.copyText(row.getAttribute('data-hf'));
      });
      body.querySelector('#cat-how').addEventListener('click', function () { self.locHelp(); });
    },
    locHelp: function () {
      var html =
        '<p class="set-hint" style="margin:2px 0 10px">Kiu se conecta a cualquier servidor estilo OpenAI en tu red. Elegí una opción:</p>' +
        '<div class="cmd-list">' +
        '<div class="cmd-row"><span>PC · LM Studio</span><b>1) Descargá un modelo GGUF 2) Developer → Start Server (puerto 1234) 3) Activá «Serve on Local Network» 4) Poné http://IP-DE-TU-PC:1234/v1</b></div>' +
        '<div class="cmd-row"><span>PC · llama.cpp</span><b>llama-server -m modelo.gguf --port 8080 → http://IP-DE-TU-PC:8080/v1</b></div>' +
        '<div class="cmd-row"><span>Teléfono · Ollama (Termux)</span><b>1) Instalá Termux 2) pkg install ollama 3) ollama serve 4) ollama pull qwen3:1.7b 5) http://127.0.0.1:11434/v1</b></div>' +
        '<div class="cmd-row"><span>Visión</span><b>Cargá un modelo VL (Qwen2.5-VL, Gemma 3, LLaVA). En LM Studio descargá también el mmproj del mismo repositorio.</b></div>' +
        '</div>' +
        '<p class="set-hint small">Si no conecta: misma red WiFi, IP correcta (ipconfig / ifconfig) y el firewall permitiendo el puerto. Ollama en el propio teléfono (127.0.0.1) no necesita red.</p>';
      this.modal('Conectar tu servidor local', html);
    },
    locFreeRam: function () {
      var self = this;
      var d0 = (Sys && Sys.d && Sys.d.ramAvail) || 0;
      if (BR && BR.gc) {
        try { BR.gc(); } catch (e) { }
      } else {
        this.toast('Liberación real en la app del teléfono');
      }
      Sys.refresh();
      setTimeout(function () {
        var d1 = (Sys.d && Sys.d.ramAvail) || 0;
        if (d1) {
          var extra = (d0 && d1 > d0) ? ' (+' + fmtGB(d1 - d0) + ' GB)' : '';
          self.toast('RAM libre: ' + fmtGB(d1) + ' GB' + extra);
        }
        self.renderLocal();
      }, 700);
    },

    bindSettings: function () {
      var self = this;
      document.getElementById('profile-card').addEventListener('click', function () { self.editName(); });
      this.bindLocal();
      document.getElementById('row-voice').addEventListener('click', function () {
        var vb = document.getElementById('voice-block');
        vb.classList.toggle('hidden');
      });
      /* v1.7.0: saludo por voz al entrar, se puede apagar */
      var tgGreet = document.getElementById('tg-greet');
      if (tgGreet) {
        tgGreet.classList.toggle('on', S.greetOn);
        tgGreet.addEventListener('click', function () {
          S.greetOn = !S.greetOn; saveS();
          tgGreet.classList.toggle('on', S.greetOn);
          self.toast(S.greetOn ? 'Kiu te va a saludar al entrar' : 'Saludo de entrada apagado');
        });
      }
      /* v1.7.0: enlaces dentro del navegador de Kiu (o afuera) */
      var tgLink = document.getElementById('tg-links');
      if (tgLink) {
        tgLink.classList.toggle('on', S.linksInApp);
        tgLink.addEventListener('click', function () {
          S.linksInApp = !S.linksInApp; saveS();
          tgLink.classList.toggle('on', S.linksInApp);
          self.toast(S.linksInApp ? 'Los enlaces abren dentro del chat' : 'Los enlaces abren en tu navegador');
        });
      }
      document.getElementById('row-backup').addEventListener('click', function () { self.backupModal(); });
      document.getElementById('row-security').addEventListener('click', function () { self.securityModal(); });
      var rp = document.getElementById('row-persona');
      if (rp) rp.addEventListener('click', function () { self.personaModal(); });
      var ra = document.getElementById('row-appearance');
      if (ra) ra.addEventListener('click', function () { self.appearanceModal(); });
      /* v2.5.0 (sección 4): skills instalables + resumen matutino */
      var rSk = document.getElementById('row-skills');
      if (rSk) rSk.addEventListener('click', function () { self.skillsModal(); });
      var rMo = document.getElementById('row-morning');
      if (rMo) rMo.addEventListener('click', function () { self.morningModal(); });
      document.getElementById('tg-voice').classList.toggle('on', S.voiceOn);
      document.getElementById('tg-voice').addEventListener('click', function () {
        S.voiceOn = !S.voiceOn; saveS();
        document.getElementById('tg-voice').classList.toggle('on', S.voiceOn);
        document.getElementById('chat-voice-toggle').classList.toggle('on', S.voiceOn);
      });
      var tgConv = document.getElementById('tg-conv');
      if (tgConv) {
        tgConv.classList.toggle('on', S.conv !== false);
        tgConv.addEventListener('click', function () { self.setConv(S.conv === false); });
      }
      /* v2.9.1: el agente. Encenderlo sin modelo cargado no sirve de nada, así que
         el toggle lo avisa en vez de fingir que quedó activo. */
      /* v2.14.6 · interruptor de los detalles del motor */
      var tgDet = document.getElementById('tg-detalles');
      if (tgDet) {
        tgDet.classList.toggle('on', !!S.detalles);
        tgDet.addEventListener('click', function () {
          S.detalles = !S.detalles; saveS();
          tgDet.classList.toggle('on', S.detalles);
          self.toast(S.detalles
            ? 'Cada respuesta va a mostrar qué modelo respondió'
            : 'Listo: sin detalles al final de las respuestas');
        });
      }
      var tgAgentCf = document.getElementById('tg-agent-confirm');
      if (tgAgentCf) {
        tgAgentCf.classList.toggle('on', !!S.agentConfirm);
        tgAgentCf.addEventListener('click', function () {
          S.agentConfirm = !S.agentConfirm; saveS();
          tgAgentCf.classList.toggle('on', S.agentConfirm);
          self.toast(S.agentConfirm
            ? 'Kiu te va a preguntar antes de actuar'
            : 'Kiu actúa sin preguntar (llamadas y SMS igual se confirman en su app)');
        });
      }
      var tgAgent = document.getElementById('tg-agent');
      if (tgAgent) {
        tgAgent.classList.toggle('on', !!S.agentOn);
        tgAgent.addEventListener('click', function () {
          S.agentOn = !S.agentOn; saveS();
          tgAgent.classList.toggle('on', S.agentOn);
          if (S.agentOn && !S.kiu.ok && !(Kiu.available() && Kiu.best())) {
            self.toast('El agente necesita un modelo: descargá uno en Modelos y volvé a prenderlo');
            return;
          }
          self.toast(S.agentOn
            ? 'Agente activo: Kiu elige la herramienta con el modelo. Suma una generación por mensaje'
            : 'Agente apagado: Kiu sigue usando los patrones de siempre');
        });
      }
      /* v2.4.0: protección térmica del motor (sección 3-c) */
      var tgTh = document.getElementById('tg-thermal');
      if (tgTh) {
        if (typeof S.thermal === 'undefined') S.thermal = true;
        tgTh.classList.toggle('on', !!S.thermal);
        tgTh.addEventListener('click', function () {
          S.thermal = S.thermal === false;
          saveS();
          tgTh.classList.toggle('on', !!S.thermal);
          self.toast(S.thermal ? 'Protección térmica activa: pauso el motor a 46°' : 'Protección térmica apagada: el motor genera siempre');
        });
      }
      this.populateVoices();
      var ps = document.getElementById('pitch-slider');
      if (ps) {
        ps.value = S.pitch || 1;
        this.pitchLabel(S.pitch || 1);
        ps.addEventListener('input', function () {
          S.pitch = parseFloat(ps.value); saveS();
          self.pitchLabel(S.pitch);
          bridge('setPitch', [S.pitch]);
        });
      }
      var tgWake = document.getElementById('tg-wake');
      if (tgWake) {
        tgWake.classList.toggle('on', !!S.wake);
        tgWake.addEventListener('click', function () {
          var turnOn = !tgWake.classList.contains('on');
          if (turnOn) {
            bridge('startWake');
            if (!BR) self.toast('Disponible en la app del teléfono');
          } else {
            bridge('stopWake');
          }
        });
      }
      var bVc = document.getElementById('btn-vcmds');
      if (bVc) bVc.addEventListener('click', function () { self.voiceCommandsModal(); });
      var rs = document.getElementById('rate-slider');
      rs.value = S.rate;
      this.rateLabel(S.rate);
      rs.addEventListener('input', function () {
        S.rate = parseFloat(rs.value); saveS();
        self.rateLabel(S.rate);
        bridge('setRate', [S.rate]);
      });
      var bExact = document.getElementById('btn-exact');
      if (BR && BR.canExactAlarms) {
        try {
          var exact = !!BR.canExactAlarms();
          bExact.textContent = exact ? 'Listo' : 'Permitir';
          if (exact) bExact.disabled = true;
          self._exactoAvisado = exact;   /* si ya puede, no le volvemos a preguntar */
        } catch (e) { }
        bExact.addEventListener('click', function () { self.avisoAlarmasExactas(false); });
        document.getElementById('btn-test-alarm').addEventListener('click', function () {
          var when = new Date(Date.now() + 10000);
          var ok = self.addReminder('Prueba de alarma de Kiu', when);
          self.toast(ok ? 'Suena en 10 segundos' : 'Guardada (con la app instalada suena)');
        });
      } else {
        bExact.parentElement.parentElement.classList.add('hidden');
        var as = document.getElementById('alarm-section');
        if (as) as.classList.add('hidden');
      }
      this.refreshSkillsSub();
      this.refreshMorningSub();
      this.renderMode();
    },
    /* ---------- v2.5.0 (4-a): skills instalables ---------- */
    refreshSkillsSub: function () {
      var el = document.getElementById('skills-sub');
      if (!el || !window.KiuSkills) return;
      var n = KiuSkills.count();
      el.textContent = n ? (n + (n === 1 ? ' skill instalado' : ' skills instalados')) : 'Instalables: enseñale frases nuevas a Kiu';
    },
    skillsModal: function () {
      var self = this;
      var list = window.KiuSkills ? KiuSkills.all() : [];
      var rows = '';
      if (!list.length) {
        rows = '<p class="set-hint small" style="margin:4px 0 10px">Todavía no hay skills. Tocá «Ejemplos» para incorporar 3 listos para usar.</p>';
      }
      for (var i = 0; i < list.length; i++) {
        var sk = list[i], m = sk.m || {};
        rows += '<div class="set-row"><div><strong>' + esc(m.name || m.id) + '</strong><span>' + esc(m.desc || '') + '</span></div>' +
          '<div style="display:flex;gap:8px;align-items:center;flex-shrink:0">' +
          '<button class="chip-btn" data-skrm="' + esc(m.id) + '">Borrar</button>' +
          '<button class="toggle' + (sk.on ? ' on' : '') + '" data-sktg="' + esc(m.id) + '" aria-label="Activar skill"></button></div></div>';
      }
      var html =
        '<p class="set-hint" style="margin:2px 0 10px">Un skill enseña frases nuevas con recetas JSON (intents + respuestas con variables). Sin código: no pueden hacer nada raro.</p>' +
        '<div class="set-card" style="margin:0 0 14px;padding:0;background:transparent;box-shadow:none">' + rows + '</div>' +
        '<label class="api-fields"><span style="color:var(--dim);font-size:12px;font-weight:600">Pegar un skill (JSON)</span>' +
        '<textarea id="sk-json" class="tool-textarea" rows="5"></textarea></label>' +
        '<div style="display:flex;gap:10px;margin-top:12px">' +
        '<button class="btn-primary" id="sk-add" style="flex:1">Instalar</button>' +
        '<button class="btn-ghost" id="sk-file" style="flex:1">Desde archivo…</button>' +
        '<button class="btn-ghost" id="sk-demo" style="flex:1">Ejemplos</button></div>' +
        '<p class="set-hint small" style="margin-top:10px">Variables: {nombre} {hora} {fecha} {bateria} {carga} · podés declarar hasta 8 intents por skill.</p>';
      var body = this.modal('Skills de Kiu', html);
      if (!body) return;
      var skTa = body.querySelector('#sk-json');
      if (skTa) skTa.placeholder = '{"id":"mi-skill","name":"Mi skill","intents":["modo focus"],"reply":"Modo focus activado, {nombre}."}';
      body.addEventListener('click', function (ev) {
        var tOn = ev.target.closest('[data-sktg]');
        if (tOn) {
          var id1 = tOn.getAttribute('data-sktg');
          var nowOn = !tOn.classList.contains('on');
          KiuSkills.setEnabled(id1, nowOn);
          tOn.classList.toggle('on', nowOn);
          self.toast(nowOn ? 'Skill activado' : 'Skill en pausa');
          return;
        }
        var tRm = ev.target.closest('[data-skrm]');
        if (tRm) {
          var id2 = tRm.getAttribute('data-skrm');
          self.confirm('Borrar skill', 'Se elimina este skill. Los demás quedan intactos.', function () {
            KiuSkills.remove(id2);
            self.closeModal();
            self.skillsModal();
            self.refreshSkillsSub();
            self.toast('Skill borrado');
          });
        }
      });
      body.querySelector('#sk-add').addEventListener('click', function () {
        var raw = body.querySelector('#sk-json').value || '';
        if (!raw.trim()) { self.toast('Pegá el JSON del skill primero'); return; }
        var r = KiuSkills.installFromText(raw);
        if (r.ok) {
          self.toast((r.updated ? 'Skill actualizado: ' : 'Skill instalado: ') + (r.skill && r.skill.m ? r.skill.m.name : ''));
          self.closeModal();
          self.skillsModal();
          self.refreshSkillsSub();
        } else {
          self.toast('Skill rechazado: ' + r.err);
        }
      });
      body.querySelector('#sk-file').addEventListener('click', function () {
        if (BR && BR.kiuSkillImport) {
          if (!bridge('kiuSkillImport', [])) self.toast('No pude abrir el selector de archivos');
        } else {
          self.toast('Disponible en la app del teléfono');
        }
      });
      body.querySelector('#sk-demo').addEventListener('click', function () {
        var n = KiuSkills.installExamples();
        self.toast(n ? n + (n === 1 ? ' ejemplo instalado' : ' ejemplos instalados') : 'Los ejemplos ya estaban instalados');
        self.closeModal();
        self.skillsModal();
        self.refreshSkillsSub();
      });
    },
    /* ---------- v2.5.0 (4-b): resumen matutino ---------- */
    refreshMorningSub: function () {
      var el = document.getElementById('morning-sub');
      if (!el) return;
      var st = S.morning || {};
      el.textContent = st.on ? ('Todos los días · ' + (st.time || '08:00')) : 'Apagado · tu día en una notificación';
    },
    morningModal: function () {
      var self = this;
      var st = S.morning || { on: false, time: '08:00' };
      var html =
        '<p class="set-hint" style="margin:2px 0 12px">Todos los días a la hora elegida te paso el día en una notificación: fecha, tus recordatorios, batería y un tip. Funciona con la app cerrada.</p>' +
        '<div class="set-row"><div><strong>Activar resumen</strong><span>Notificación suave, sin sonido de alarma</span></div>' +
        '<button class="toggle" id="mo-on" aria-label="Activar resumen"></button></div>' +
        '<label class="api-fields"><span style="color:var(--dim);font-size:12px;font-weight:600">Hora del resumen</span>' +
        '<input id="mo-time" type="time" value="' + esc(st.time || '08:00') + '"></label>' +
        '<button class="btn-primary full" id="mo-save" style="margin-top:14px">Guardar resumen matutino</button>';
      var body = this.modal('Resumen matutino', html);
      if (!body) return;
      var on = !!st.on;
      var tgl = body.querySelector('#mo-on');
      tgl.classList.toggle('on', on);
      tgl.addEventListener('click', function () { on = !on; tgl.classList.toggle('on', on); });
      body.querySelector('#mo-save').addEventListener('click', function () {
        var tv = body.querySelector('#mo-time').value || '08:00';
        var pp = tv.split(':'), hh = parseInt(pp[0], 10), mm = parseInt(pp[1], 10);
        if (isNaN(hh) || isNaN(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) { self.toast('Hora inválida'); return; }
        S.morning = { on: on, time: (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm };
        saveS();
        if (BR && BR.kiuMorningSet) {
          var okB = !!bridge('kiuMorningSet', [hh, mm, on]);
          self.toast(okB ? (on ? 'Resumen listo para las ' + S.morning.time : 'Resumen matutino apagado') : 'Guardado: sonará cuando instales la app en el teléfono');
        } else {
          self.toast('Guardado: con la app instalada suena a las ' + S.morning.time);
        }
        self.closeModal();
        self.refreshMorningSub();
      });
    },
    /* ---------- Personalidad de Kiu ---------- */
    personaModal: function () {
      var self = this;
      var seg = ['normal', 'divertida', 'tecnica', 'breve'].map(function (k) {
        return '<button class="seg-btn' + (S.persona === k ? ' active' : '') + '" data-p="' + k + '">' + ({ normal: 'Normal', divertida: 'Divertida', tecnica: 'Técnica', breve: 'Breve' })[k] + '</button>';
      }).join('');
      var hints = {
        normal: 'Equilibrada: clara, amigable y al pie.',
        divertida: 'Con humor ligero, sin dejar de ser útil.',
        tecnica: 'Precisa, con datos y detalles.',
        breve: 'Respuestas cortitas, al grano.'
      };
      var html =
        '<p class="set-hint" style="margin:2px 0 12px">Elegí cómo quiere que te hable Kiu cuando usa tu API. El cerebro local ya tiene su propio estilo.</p>' +
        '<div class="seg" id="pn-seg">' + seg + '</div>' +
        '<p class="set-hint small" id="pn-hint" style="margin:10px 0 14px">' + hints[S.persona] + '</p>' +
        '<label class="api-fields"><span style="color:var(--dim);font-size:12px;font-weight:600">Instrucciones extra (opcional)</span>' +
        '<textarea id="pn-x" class="tool-textarea" placeholder="Ej: hablame de vos, llamame por mi apodo, evitá temas de fútbol...">' + esc(S.personaX || '') + '</textarea></label>' +
        '<button class="btn-primary full" id="pn-ok">Guardar personalidad</button>';
      var body = this.modal('Personalidad de Kiu', html);
      if (!body) return;
      var picked = S.persona;
      body.querySelector('#pn-seg').addEventListener('click', function (ev) {
        var b = ev.target.closest('.seg-btn');
        if (!b) return;
        var bs = body.querySelectorAll('#pn-seg .seg-btn');
        for (var i = 0; i < bs.length; i++) bs[i].classList.remove('active');
        b.classList.add('active');
        picked = b.getAttribute('data-p');
        body.querySelector('#pn-hint').textContent = hints[picked] || '';
      });
      body.querySelector('#pn-ok').addEventListener('click', function () {
        S.persona = picked;
        S.personaX = body.querySelector('#pn-x').value.trim().slice(0, 400);
        saveS();
        self.closeModal();
        self.renderStatus();
        self.toast('Personalidad guardada: ' + ({ normal: 'Normal', divertida: 'Divertida', tecnica: 'Técnica', breve: 'Breve' })[picked]);
      });
    },
    /* ---------- Apariencia ---------- */
    ACCENTS: [
      { id: '', name: 'Teal', c: '#2DD4BF' },
      { id: 'violeta', name: 'Violeta', c: '#A78BFA' },
      { id: 'rosa', name: 'Rosa', c: '#F472B6' },
      { id: 'verde', name: 'Verde', c: '#34D399' },
      { id: 'ambar', name: 'Ámbar', c: '#FBBF24' }
    ],
    applyTheme: function () {
      var acc = '#2DD4BF';
      for (var i = 0; i < this.ACCENTS.length; i++) if (this.ACCENTS[i].id === S.acc) acc = this.ACCENTS[i].c;
      var st = document.documentElement.style;
      st.setProperty('--acc', acc);
      st.setProperty('--teal', acc);
      document.body.classList.remove('fs-s', 'fs-m', 'fs-l');
      document.body.classList.add('fs-' + (S.chatFs || 'm'));
    },
    appearanceModal: function () {
      var self = this;
      var sw = this.ACCENTS.map(function (a) {
        return '<button class="acc-swatch' + ((S.acc || '') === a.id ? ' sel' : '') + '" data-acc="' + a.id + '" style="--sc:' + a.c + '"><i></i><span>' + a.name + '</span></button>';
      }).join('');
      var fs = ['s', 'm', 'l'].map(function (k) {
        return '<button class="seg-btn' + (S.chatFs === k ? ' active' : '') + '" data-fs="' + k + '">' + ({ s: 'Chica', m: 'Normal', l: 'Grande' })[k] + '</button>';
      }).join('');
      /* v2.4.0: selector de idioma (sección 3-c) — chrome de la interfaz */
      var curLang = (window.KiuI18n && KiuI18n.current()) || 'es';
      var langs = ['es', 'en'].map(function (l) {
        return '<button class="seg-btn' + (curLang === l ? ' active' : '') + '" data-lang="' + l + '">' + (l === 'es' ? 'Español' : 'English') + '</button>';
      }).join('');
      var html =
        '<p class="set-hint" style="margin:2px 0 12px">Color de acento: tiñe los botones, la barra inferior y los detalles vivos.</p>' +
        '<div class="acc-row">' + sw + '</div>' +
        '<div class="set-row col" style="margin-top:16px"><div><strong>Tamaño de letra del chat</strong><span>Se aplica a las conversaciones</span></div></div>' +
        '<div class="seg" id="fs-seg">' + fs + '</div>' +
        '<div class="set-row col" style="margin-top:16px"><div><strong>Idioma de la interfaz</strong><span>Menús e inicio · las respuestas siguen en español por ahora</span></div></div>' +
        '<div class="seg" id="lang-seg">' + langs + '</div>';
      var body = this.modal('Apariencia', html);
      if (!body) return;
      body.querySelector('.acc-row').addEventListener('click', function (ev) {
        var b = ev.target.closest('[data-acc]');
        if (!b) return;
        S.acc = b.getAttribute('data-acc');
        saveS();
        self.applyTheme();
        var ss = body.querySelectorAll('.acc-swatch');
        for (var i = 0; i < ss.length; i++) ss[i].classList.toggle('sel', ss[i].getAttribute('data-acc') === S.acc);
        self.toast('Acento aplicado');
      });
      body.querySelector('#fs-seg').addEventListener('click', function (ev) {
        var b = ev.target.closest('.seg-btn');
        if (!b) return;
        var bs = body.querySelectorAll('#fs-seg .seg-btn');
        for (var i = 0; i < bs.length; i++) bs[i].classList.remove('active');
        b.classList.add('active');
        S.chatFs = b.getAttribute('data-fs');
        saveS();
        self.applyTheme();
      });
      if (body.querySelector('#lang-seg')) {
        body.querySelector('#lang-seg').addEventListener('click', function (ev) {
          var b = ev.target.closest('.seg-btn');
          if (!b) return;
          var bs = body.querySelectorAll('#lang-seg .seg-btn');
          for (var i = 0; i < bs.length; i++) bs[i].classList.remove('active');
          b.classList.add('active');
          var l = b.getAttribute('data-lang');
          if (window.KiuI18n) KiuI18n.setLang(l);
          self.toast(l === 'en' ? 'Interface language: English' : 'Idioma de la interfaz: Español');
        });
      }
    },
    /* Copias de seguridad: exportar texto + restaurar copia de datos */
    backupModal: function () {
      var self = this;
      var safOk = !!(BR && BR.kiuDataExport && BR.kiuDataImport);
      var html =
        '<p class="set-hint" style="margin:2px 0 12px">Tu memoria, ajustes y alarmas se copian como texto. Guardalo donde quieras: sirve para pasar los datos a otra instalación de Kiu.</p>' +
        '<button class="btn-primary full" id="bk-export">' + icon('share', 16) + ' Exportar copia de datos</button>' +
        '<p class="set-hint small" style="margin:14px 0 8px">¿Tenés una copia? Pegala acá y la restauro:</p>' +
        '<textarea id="bk-import" class="tool-textarea" placeholder=\'Pegá acá el texto de la copia {"app":"Kiu"...}\'></textarea>' +
        '<button class="btn-ghost full" id="bk-restore" style="margin-top:10px;justify-content:center">' + icon('save', 16) + ' Restaurar copia de datos</button>' +
        (safOk
          ? '<p class="set-hint small" style="margin:16px 0 8px"><b>Copia completa (archivo)</b> · incluye también tus conversaciones y los documentos del RAG. Las claves API no viajan: quedan en el Keystore del teléfono.</p>' +
            '<div style="display:flex;gap:10px">' +
            '<button class="btn-ghost" id="bk-file-export" style="flex:1;justify-content:center">' + icon('save', 16) + ' Guardar copia completa</button>' +
            '<button class="btn-ghost" id="bk-file-import" style="flex:1;justify-content:center">' + icon('folder', 16) + ' Restaurar archivo</button>' +
            '</div>'
          : '');
      var body = this.modal('Copias de seguridad', html);
      if (!body) return;
      body.querySelector('#bk-export').addEventListener('click', function () { self.exportData(); });
      body.querySelector('#bk-restore').addEventListener('click', function () {
        var raw = body.querySelector('#bk-import').value.trim();
        if (!raw) { self.toast('Pegá primero el texto de la copia'); return; }
        self.importData(raw);
      });
      var bfe = body.querySelector('#bk-file-export');
      if (bfe) bfe.addEventListener('click', function () { self.exportDataFile(); });
      var bfi = body.querySelector('#bk-file-import');
      if (bfi) bfi.addEventListener('click', function () {
        if (!bridge('kiuDataImport')) self.toast('No pude abrir el selector de archivos');
      });
    },
    /* v2.4.0 (sección 1): copia COMPLETA como archivo .json vía SAF.
       Junta ajustes (sin claves), memoria, conversaciones, alarmas, KB, uso y RAG. */
    exportDataFile: function () {
      var self = this;
      self.toast('Preparando la copia completa…');
      var sCopy = {};
      for (var k in S) if (Object.prototype.hasOwnProperty.call(S, k)) sCopy[k] = S[k];
      sCopy.prov = {}; /* sin estados de proveedores: evita arrastrar restos de claves */
      var payload = {
        app: 'Kiu', v: 3, exportedAt: new Date().toISOString(),
        settings: sCopy,
        memoria: KiuMem.data,
        conversaciones: store('nexo_convs') || [],
        alarmas: store('nexo_alarmas') || [],
        kb: store('nexo_kb') || null,
        uso: store('nexo_usage') || null,
        skills: (window.KiuSkills ? KiuSkills.exportAll() : [])
      };
      var send = function () {
        var json = JSON.stringify(payload);
        if (!bridge('kiuDataExport', [json])) self.toast('No pude abrir el selector para guardar la copia');
      };
      try {
        if (window.RAG) RAG.exportAll(function (rag) { payload.rag = rag; send(); });
        else send();
      } catch (eR) { send(); }
    },
    importData: function (raw) {
      try {
        var start = raw.indexOf('{'), end = raw.lastIndexOf('}');
        var j = JSON.parse(raw.slice(start, end + 1));
        if (!j || !j.memoria) throw new Error('formato');
        var nRec = 0, nTar = 0, nNot = 0, nAla = 0, nSk = 0;
        if (j.memoria.recuerdos) { KiuMem.data.recuerdos = j.memoria.recuerdos; nRec = j.memoria.recuerdos.length; }
        if (j.memoria.tareas) { KiuMem.data.tareas = j.memoria.tareas; nTar = j.memoria.tareas.length; }
        if (j.memoria.notas) { KiuMem.data.notas = j.memoria.notas; nNot = j.memoria.notas.length; }
        if (j.memoria.prefs) { KiuMem.data.prefs = j.memoria.prefs; }
        KiuMem.save();
        /* v2.5.0: los skills viajan en la copia (los ejemplos no) */
        if (Object.prototype.toString.call(j.skills) === '[object Array]' && window.KiuSkills) {
          nSk = KiuSkills.importAll(j.skills);
        }
        if (j.settings && j.settings.name && !S.name) { S.name = j.settings.name; saveS(); }
        if (j.alarmas && j.alarmas.length) {
          for (var i = 0; i < j.alarmas.length; i++) {
            var a = j.alarmas[i];
            if (a.time && a.time > Date.now()) {
              var list = this.reminders();
              list.unshift({ id: a.id || ('r' + Date.now() + i), title: a.title, time: a.time, date: fmtWhen(a.time) });
              store('nexo_alarmas', list);
              bridge('setReminder', [a.id || ('r' + Date.now() + i), a.title, a.time]);
              nAla++;
            }
          }
        }
        this.refreshMem();
        this.renderStatus();
        this.renderHome();
        this.closeModal();
        this.toast('Copia restaurada: ' + nRec + ' recuerdos, ' + nTar + ' tareas, ' + nNot + ' notas' + (nAla ? ', ' + nAla + ' alarmas' : '') + (nSk ? ', ' + nSk + ' skills' : ''));
      } catch (e) {
        this.toast('No pude leer la copia: pegala completa, tal como se exportó');
      }
    },
    securityModal: function () {
      var self = this;
      var html =
        '<p class="set-hint" style="margin:2px 0 12px">Todo lo tuyo vive en este teléfono. Las claves API van cifradas y nadie más las lee.</p>' +
        '<button class="btn-ghost full" id="sc-chat" style="justify-content:center">' + icon('trash', 16) + ' Borrar conversaciones</button>' +
        '<button class="btn-ghost full" id="sc-wipe" style="justify-content:center;margin-top:10px;color:var(--danger);border-color:rgba(255,93,93,.4)">' + icon('trash', 16) + ' Borrar toda la memoria</button>';
      var body = this.modal('Seguridad y privacidad', html);
      if (!body) return;
      body.querySelector('#sc-chat').addEventListener('click', function () {
        self.confirm('Borrar conversaciones', 'Se elimina todo el historial del chat. Tus recuerdos y tareas quedan intactos.', function () {
          self.clearChat();
          self.toast('Conversaciones borradas');
        });
      });
      body.querySelector('#sc-wipe').addEventListener('click', function () {
        self.confirm('Borrar toda la memoria', 'Se borran recuerdos, tareas, notas, alarmas y ajustes. No hay vuelta atrás.', function () {
          var rem = self.reminders();
          for (var i = 0; i < rem.length; i++) bridge('cancelReminder', [rem[i].id]);
          KiuMem.data = { recuerdos: [], tareas: [], notas: [], prefs: [] };
          KiuMem.save();
          store('nexo_alarmas', []);
          S.name = ''; S.voiceOn = false; saveS();
          store('nexo_activity', []);
          self.clearChat();
          self.refreshMem();
          self.renderStatus();
          self.renderHome();
          self.toast('Todo en cero');
        });
      });
    },
    rateLabel: function (r) {
      var lbl = r < 0.8 ? 'Tranquila' : r > 1.2 ? 'Rápida' : 'Normal';
      document.getElementById('rate-label').textContent = lbl + ' (' + r.toFixed(1) + 'x)';
    },
    pitchLabel: function (p) {
      var lbl = p < 0.95 ? 'Grave' : p > 1.1 ? 'Agudo' : 'Natural';
      var el = document.getElementById('pitch-label');
      if (el) el.textContent = lbl + ' (' + p.toFixed(2) + ')';
    },
    populateVoices: function () {
      var sel = document.getElementById('voice-select');
      if (!sel) return;
      if (!BR || !BR.listVoices) {
        var row = sel.closest('.set-row');
        if (row) row.classList.add('hidden');
        return;
      }
      var vs = [];
      try { vs = JSON.parse(BR.listVoices() || '[]'); } catch (e) { }
      var self = this;
      var opts = ['<option value="">Automática (la mejor que encuentre)</option>'];
      for (var i = 0; i < vs.length; i++) {
        var v = vs[i];
        var lbl = v.locale + ' · ' + (v.net ? 'de red (HD)' : 'sin internet') + (v.q >= 400 ? ' · calidad alta' : '');
        opts.push('<option value="' + esc(v.name) + '"' + (S.voiceName === v.name ? ' selected' : '') + '>' + esc(lbl) + '</option>');
      }
      sel.innerHTML = opts.join('');
      sel.addEventListener('change', function () {
        S.voiceName = sel.value; saveS();
        bridge('setVoiceName', [S.voiceName]);
        self.toast(S.voiceName ? 'Voz cambiada. Probala abajo.' : 'Voz automática: buscaré la más natural');
      });
      var bt = document.getElementById('btn-voice-test');
      if (bt) bt.addEventListener('click', function () {
        self.speak('Hola, soy Kiu. Así suena mi voz en este teléfono. Si querés otra, elegila en la lista y probame de nuevo.');
      });
    },
    editName: function () {
      var self = this;
      var html =
        '<input id="nm-in" class="tool-input" placeholder="¿Cómo te llamo?" value="' + esc(S.name) + '">' +
        '<button class="btn-primary full" id="nm-ok" style="margin-top:12px">Guardar</button>';
      var body = this.modal('Tu nombre', html);
      if (!body) return;
      setTimeout(function () { body.querySelector('#nm-in').focus(); }, 250);
      body.querySelector('#nm-ok').addEventListener('click', function () {
        var v = body.querySelector('#nm-in').value.trim();
        self.setName(v);
        self.closeModal();
        self.toast(v ? 'Dale, ' + v : 'Nombre borrado');
      });
    },
    setName: function (v) {
      S.name = (v || '').trim(); saveS();
      this.renderStatus();
      document.getElementById('hero-hi').textContent = KiuBrain.greeting(S.name);
    },
    getName: function () { return S.name; },
    exportData: function () {
      var payload = {
        app: 'Kiu', version: '2.10.0', exported: new Date().toISOString(),
        settings: { name: S.name, mode: S.mode },
        memoria: KiuMem.data,
        alarmas: this.reminders(),
        actividad: store('nexo_activity') || []
      };
      var txt = JSON.stringify(payload, null, 2);
      if (!this.shareText('Mis datos de Kiu\n\n' + txt)) {
        this.copyText(txt);
        this.toast('Datos copiados al portapapeles');
      }
    },

    /* ---------- Voz (manos libres) ---------- */
    voiceBusy: false,
    _voiceDriven: false,
    startVoice: function () {
      var self = this;
      if (this.voiceBusy) { this.stopVoice(); return; }
      this.voiceBusy = true;
      this._voiceDriven = true;
      this.showListening(true);
      var ok = bridge('listen');
      if (ok) return;
      var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SR) {
        try {
          var rec = new SR();
          rec.lang = 'es-AR'; rec.interimResults = true; rec.continuous = false;
          rec.onresult = function (e) {
            var r = e.results[e.results.length - 1];
            if (r.isFinal) self.handleVoice(r[0].transcript);
            else self.partialVoice(r[0].transcript);
          };
          rec.onerror = function () { self.voiceError(null); };
          rec.onend = function () { if (self.voiceBusy) self.voiceError(null); };
          rec.start();
          return;
        } catch (e) { }
      }
      this.voiceError('Este teléfono no tiene reconocimiento de voz disponible');
    },
    stopVoice: function () {
      this._convLive = 0; /* v2.11.11: si lo cortás vos, el guardián de la conversación no lo reabre */
      this.voiceBusy = false;
      this._voiceDriven = false;
      bridge('cancelListen');
      this.showListening(false, true);
    },
    handleVoice: function (text) {
      this.voiceBusy = false;
      text = (text || '').trim();
      if (text) this.vpSay(text, 'ENTENDÍ');
      this.showListening(false);
      if (!text) return;
      /* v2.11.12 · «gracias», «chau»… dichos solos terminan la charla sin molestar al motor ni abrir el chat */
      var nrm = text.toLowerCase().normalize ? text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zñ0-9 ]/g, ' ').replace(/\s+/g, ' ').trim() : '';
      if (nrm && nrm.split(' ').length <= 4 && this.inCall() && /^(muchas )?(gracias|chau|chao|adios|hasta luego|nos vemos|eso es todo|nada mas|terminamos|colgar|cortar|corta)( kiu| listo| nada mas)?$/.test(nrm)) {
        this.endCall();
        return;
      }
      this._convLive = Date.now();
      if (!this.inCall()) this.go('chat');
      this.sendMsg(text);
      /* v2.11.8 · si el motor se queda «pensando» más de 90 s (frase mal entendida, modelo trabado) se corta
         solo y Kiu vuelve a estar libre, en vez de quedar mareado para siempre */
      clearTimeout(this._thinkWd);
      var selfW = this;
      this._thinkWd = setTimeout(function () {
        try {
          if (window.Kiu && Kiu.pending) {
            selfW.cancelApi();
            selfW.toast('Se trabó pensando. Probá con una frase más corta.');
          }
        } catch (e) { }
      }, 90000);
    },
    /* v2.11.1: códigos de SpeechRecognizer.ERROR_* en palabras. Antes se descartaban y Kiu
       «no entendía» sin decir por qué. */
    vozErrTexto: function (c) {
      var T = {
        1: 'El servicio de voz no respondió a tiempo. Revisá tu conexión.',
        2: 'El servicio de voz de Google necesita internet y no lo logra. Revisá tu conexión.',
        3: 'Error de audio: el micrófono no entregó sonido.',
        4: 'El servicio de voz falló. Probá de nuevo en un momento.',
        5: 'El servicio de voz no se pudo usar. Abrí Asistente de voz en Ajustes.',
        6: 'No te escuché. Hablá apenas aparezca «Te escucho».',
        7: 'No te entendí. Probá de nuevo, más cerca del micrófono.',
        8: 'El reconocedor está ocupado. Esperá un segundo.',
        9: 'Falta un permiso de voz. Abrí Asistente de voz en Ajustes.',
        10: 'Demasiados pedidos seguidos al servicio de voz. Esperá un momento.',
        11: 'El servicio de voz se cortó. Probá de nuevo.',
        12: 'Falta el español en el servicio de voz. En Ajustes del teléfono: Idioma de voz → Reconocimiento sin conexión → bajá el español. Probé también con el reconocedor del sistema.',
        13: 'El idioma español no está disponible sin internet en el servicio de voz.'
      };
      return T[c] || ('Error de voz (código ' + c + ')');
    },
    voiceError: function (msg) {
      this.voiceBusy = false;
      this.showListening(false, true);
      if (msg) {
        stErr('Error', 2000);
        this.toast(msg);
      }
    },
    /* v2.11.0 · pantalla de llamada: Kiu en el centro. Tres modos que siguen al estado
       real (KiuState): listen = escucha, think = piensa, speak = habla. En modo
       conversación la pantalla NO se cierra al terminar de escuchar: sigue abierta mientras
       Kiu piensa y habla, y se cierra sola si pasan 7 s sin actividad (red de seguridad). */
    vpMode: function (m) {
      var pulse = document.getElementById('voice-pulse'); if (!pulse) return;
      var T = {
        listen: ['Te escucho…', 'Hablá ahora · Kiu corta solo al terminar'],
        think: ['Pensando…', 'Un segundo, lo estoy resolviendo'],
        speak: ['Hablando…', 'Tocá Colgar para cortarlo']
      }[m] || ['Te escucho…', ''];
      pulse.setAttribute('data-st', m);
      if (m !== 'listen') this.vpLive(false);
      var t = document.getElementById('vp-text'); if (t) t.textContent = T[0];
      var h = document.getElementById('vp-hint'); if (h) h.textContent = T[1];
    },
    vpLive: function (on) {
      var pulse = document.getElementById('voice-pulse'); if (!pulse) return;
      if (on) { pulse.classList.add('live'); return; }
      pulse.classList.remove('live');
      pulse.style.removeProperty('--vp-lvl');
      var bars = pulse.querySelectorAll('.vp-bars i');
      for (var i = 0; i < bars.length; i++) bars[i].style.transform = '';
    },
    vpLevel: function (db) {
      var pulse = document.getElementById('voice-pulse');
      if (!pulse || pulse.classList.contains('hidden') || pulse.getAttribute('data-st') !== 'listen') return;
      var lvl = (Number(db) + 2) / 12;
      if (!isFinite(lvl)) lvl = 0;
      lvl = Math.max(0, Math.min(1, lvl));
      this._vpLvl = (this._vpLvl || 0) * 0.5 + lvl * 0.5;
      this._vpLvlT = Date.now();
      this.vpLive(true);
      pulse.style.setProperty('--vp-lvl', this._vpLvl.toFixed(2));
      var bars = pulse.querySelectorAll('.vp-bars i'), K = [0.55, 0.8, 1, 0.85, 0.95, 0.7, 0.5];
      for (var i = 0; i < bars.length; i++) bars[i].style.transform = 'scaleY(' + (0.2 + this._vpLvl * 0.8 * K[i % 7]).toFixed(2) + ')';
    },
    vpSay: function (text, label) {
      var card = document.getElementById('vp-card');
      var say = document.getElementById('vp-say'), lbl = document.getElementById('vp-lbl');
      if (!card || !say || !text) return;
      say.textContent = String(text).slice(0, 240);
      if (lbl) lbl.textContent = label || '';
      card.classList.remove('empty');
    },
    vpWatch: function () {
      var self = this;
      if (this._vpT) return;
      this._vpIdle = Date.now();
      this._vpT = setInterval(function () {
        var pulse = document.getElementById('voice-pulse');
        if (!pulse || pulse.classList.contains('hidden')) { clearInterval(self._vpT); self._vpT = null; return; }
        var k = KS(), st = (k && k.get) ? k.get() : '';
        var m = pulse.getAttribute('data-st');
        if (pulse.classList.contains('live') && Date.now() - (self._vpLvlT || 0) > 1200) self.vpLive(false);
        var next = st === 'Escuchando' ? 'listen' : (st === 'Generando' || st === 'Pensando') ? 'think' : st === 'Hablando' ? 'speak' : '';
        if (next) { self._vpIdle = Date.now(); if (next !== m) self.vpMode(next); }
        else if (m === 'listen') { self._vpIdle = Date.now(); }
        else if ((window.Kiu && Kiu.pending) || st === 'Hablando') { self._vpIdle = Date.now(); }  /* v2.11.11: no cerrar mientras Kiu piensa o habla */
        else if (Date.now() - self._vpIdle > 12000) { self.showListening(false, true); }
      }, 400);
    },
    /* v2.11.11 · ¿estamos en plena conversación por voz? Si sí, NO se salta a la pantalla de Chat: la
       charla sigue en la misma pantalla (la de llamada) y las respuestas igual quedan en el historial. */
    inCall: function () {
      var pulse = document.getElementById('voice-pulse');
      var vis = !!(pulse && !pulse.classList.contains('hidden'));
      return !!(S.conv !== false && (vis || (this._convLive && Date.now() - this._convLive < 120000)));
    },
    showListening: function (on, force) {
      var pulse = document.getElementById('voice-pulse');
      if (!pulse) return;
      if (on) {
        this.vpMode('listen');
        var card = document.getElementById('vp-card'); if (card) card.classList.add('empty');
        pulse.classList.remove('hidden');
        stSet('voz', 'Escuchando');
        this.vpWatch();
      } else {
        var kk = KS(); if (kk && kk.layer('voz') === 'Escuchando') kk.clear('voz');
        if (!force && S.conv && !pulse.classList.contains('hidden')) {
          this.vpMode('think');
          this._vpIdle = Date.now();
          this.vpWatch();
        } else {
          pulse.classList.add('hidden');
        }
      }
    },
    partialVoice: function (text) {
      if (text) this.vpSay(text, 'TE VOY ENTENDIENDO');
    },
    setConv: function (on) {
      S.conv = !!on; saveS();
      if (on && !S.voiceOn) {
        S.voiceOn = true; saveS();
        document.getElementById('tg-voice').classList.add('on');
        document.getElementById('chat-voice-toggle').classList.add('on');
      }
      bridge('setHandsFree', [!!on]);
      var a = document.getElementById('chat-conv-toggle');
      var b = document.getElementById('tg-conv');
      if (a) a.classList.toggle('on', !!on);
      if (b) b.classList.toggle('on', !!on);
      this.toast(on ? 'Modo conversación: hablás y Kiu responde, sin tocar nada' : 'Modo conversación apagado');
    },
    speak: function (text) {
      if (!S.voiceOn) return;
      var clean = String(text)
        .replace(/\*\*/g, '').replace(/`/g, '')
        .replace(/\n+/g, '. ')
        .replace(/[#>]/g, '')
        .slice(0, 600);
      /* v2.8.0: 'Hablando' dura lo que dura la voz, no lo que se estima por el largo
         del texto. En Android llega nexoTtsStart/nexoTtsDone; en el navegador de
         escritorio el onend hace lo mismo. El temporizador queda solo como red de
         seguridad para cuando el TTS no reporta nada. */
      this.vpSay(clean, 'KIU');
      clearTimeout(this._avT);
      var self2 = this;
      this._avT = setTimeout(function () {
        var k2 = KS(); if (k2 && k2.layer('voz') === 'Hablando') k2.clear('voz');
      }, Math.min(45000, 3500 + clean.length * 70));
      if (bridge('speak', [clean])) return;
      try {
        var u = new SpeechSynthesisUtterance(clean);
        u.lang = 'es-AR'; u.rate = S.rate;
        var self3 = this;
        u.onend = function () {
          try { if (window.KiuSentenceTTS && KiuSentenceTTS.onDone()) return; } catch (eQueueBrowser) { }
          clearTimeout(self3._avT);
          var k3 = KS(); if (k3 && k3.layer('voz') === 'Hablando') k3.clear('voz');
        };
        u.onerror = u.onend;
        speechSynthesis.speak(u);
      } catch (e) { }
    },

    /* ---------- Utilidades ---------- */
    vibrate: function (pat) { bridge('vibrate', [typeof pat === 'number' ? pat : 120]); },
    toast: function (msg) {
      if (!msg) return;
      var t = document.getElementById('toast');
      t.textContent = msg;
      t.classList.remove('hidden');
      clearTimeout(this._tt);
      var ms = Math.min(10000, Math.max(2400, 1800 + String(msg).length * 55));
      t.onclick = function () { clearTimeout(App._tt); t.classList.add('hidden'); };
      this._tt = setTimeout(function () { t.classList.add('hidden'); }, ms);
    },
    copyText: function (txt) {
      try {
        var ta = document.createElement('textarea');
        ta.value = txt;
        ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        return true;
      } catch (e) { return false; }
    },
    shareText: function (txt) { return bridge('share', [txt]); },
    openUrl: function (url) { return bridge('openUrl', [url]); },
    keepOn: function (on) { bridge('keepOn', [!!on]); },
    bright: function (on) { bridge('bright', [!!on]); },

    /* ---------- Puente extendido ---------- */
    bridgeCall: function (fn, args) { return bridge(fn, args); },
    /* v2.13.1 · fragmentos de la web SIN pintar nada en el chat, para que una herramienta
       del agente los lea y el modelo redacte. cb(lista) con hasta 3 {t, s, u}; lista vacía
       si no hay conexión o nadie respondió (nunca lanza). Tope 8 s. */
    webSnippets: function (q, cb) {
      var enc = encodeURIComponent(String(q || '').replace(/^busca\s+/i, '').trim().slice(0, 120));
      var snippets = [];
      var fin = false;
      function done() { if (fin) return; fin = true; cb(snippets.slice(0, 3)); }
      if (!enc || typeof fetch !== 'function') { done(); return; }
      function to() { var c = (typeof AbortController !== 'undefined') ? new AbortController() : null; setTimeout(function () { if (c) c.abort(); }, 8000); return c ? c.signal : undefined; }
      var p1 = fetch('https://api.duckduckgo.com/?q=' + enc + '&format=json&no_html=1&skip_disambig=1', { signal: to() })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (!j) return;
          var t = (j.AbstractText || '').trim();
          if (t) snippets.push({ t: (j.Heading || 'Fuente').slice(0, 60), s: t.slice(0, 400), u: j.AbstractURL || '' });
          var rt = j.RelatedTopics || [];
          for (var i = 0; i < rt.length && snippets.length < 3; i++) {
            if (rt[i] && rt[i].Text) snippets.push({ t: rt[i].Text.slice(0, 60), s: rt[i].Text.slice(0, 300), u: rt[i].FirstURL || '' });
          }
        }).catch(function () { });
      var p2 = fetch('https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=' + enc + '&format=json&origin=*&srlimit=3', { signal: to() })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          var hits = (j && j.query && j.query.search) || [];
          for (var i = 0; i < hits.length && snippets.length < 3; i++) {
            snippets.push({ t: String(hits[i].title).slice(0, 60), s: String(hits[i].snippet || '').replace(/<[^>]+>/g, '').slice(0, 300), u: '' });
          }
        }).catch(function () { });
      Promise.all([p1, p2]).then(done, done);
    },
    /* v2.16.0 · CLIMA. Open-Meteo no pide clave: geocodifica el nombre y devuelve el pronóstico.
       cb({place, cur:{temp,code,wind}, days:[{max,min,rain,code}]}) o cb(null) si no hay red,
       el lugar no existe o tardó más de 8 s. Nunca lanza. */
    weatherQuery: function (place, cb) {
      var fin = false;
      function done(v) { if (fin) return; fin = true; cb(v); }
      var coords = (place && typeof place === 'object' && isFinite(place.lat) && isFinite(place.lon)) ? place : null;
      var q = coords ? '' : String(place || '').trim().slice(0, 80);
      if ((!q && !coords) || typeof fetch !== 'function') { done(null); return; }
      var c = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      setTimeout(function () { if (c) c.abort(); done(null); }, 8000);
      var opt = c ? { signal: c.signal } : {};
      function pronostico(lat, lon, nombre) {
        return fetch('https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
          '&current=temperature_2m,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=3', opt)
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (f) {
            if (!f || !f.current || !f.daily) { done(null); return; }
            var d = f.daily, days = [];
            for (var i = 0; i < (d.time || []).length; i++) {
              days.push({ max: d.temperature_2m_max[i], min: d.temperature_2m_min[i], rain: d.precipitation_probability_max[i], code: d.weather_code[i] });
            }
            done({ place: nombre, cur: { temp: f.current.temperature_2m, code: f.current.weather_code, wind: f.current.wind_speed_10m }, days: days });
          });
      }
      if (coords) { pronostico(coords.lat, coords.lon, 'tu ubicación').catch(function () { done(null); }); return; }
      fetch('https://geocoding-api.open-meteo.com/v1/search?count=1&language=es&name=' + encodeURIComponent(q), opt)
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (g) {
          var r0 = g && g.results && g.results[0];
          if (!r0) { done(null); return null; }
          return pronostico(r0.latitude, r0.longitude, r0.name + (r0.country ? ', ' + r0.country : ''));
        }).catch(function () { done(null); });
    },
    /* v2.17.0 · TANDA 2. Las cuatro lecturas del teléfono siguen el molde de contactSearch():
       lista, 'NEED_PERM' (y se abre el permiso/pantalla para que el usuario lo dé) o null. */
    notifQuery: function (q, max) {
      if (!BR || !BR.notifList) return null;
      try {
        var r = BR.notifList(String(q || ''), max || 8);
        if (r === 'NEED_PERM') { this.askPerm('notif'); return 'NEED_PERM'; }
        return JSON.parse(r || '[]');
      } catch (e) { return null; }
    },
    smsQuery: function (q, max) {
      if (!BR || !BR.smsList) return null;
      try {
        var r = BR.smsList(String(q || ''), max || 5);
        if (r === 'NEED_PERM') { this.askPerm('sms'); return 'NEED_PERM'; }
        return JSON.parse(r || '[]');
      } catch (e) { return null; }
    },
    /* {lat, lon, acc} | 'NEED_PERM' | null (sin ubicación guardada) */
    locationNow: function () {
      if (!BR || !BR.locationGet) return null;
      try {
        var r = BR.locationGet();
        if (r === 'NEED_PERM') { this.askPerm('location'); return 'NEED_PERM'; }
        if (!r || r === 'NONE') return null;
        var o = JSON.parse(r);
        return (isFinite(o.lat) && isFinite(o.lon)) ? o : null;
      } catch (e) { return null; }
    },
    mediaKey: function (action) {
      if (!BR || !BR.mediaKey) return false;
      try { return !!BR.mediaKey(String(action || '')); } catch (e) { return false; }
    },
    /* v2.16.0 · TEXTO DE UNA PÁGINA, para que el agente la resuma. cb(texto|null).
       Solo https y nunca hosts locales/privados. Pasa por r.jina.ai (ya usado en la búsqueda web)
       para no depender de CORS ni de HTML crudo. Tope 12 s y 6000 caracteres. */
    pageText: function (url, cb) {
      var fin = false;
      function done(v) { if (fin) return; fin = true; cb(v); }
      var u = String(url || '').trim();
      if (!/^https:\/\/[^\s\/]+/i.test(u) || /^https:\/\/(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[|0\.)/i.test(u) || typeof fetch !== 'function') { done(null); return; }
      var c = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      setTimeout(function () { if (c) c.abort(); done(null); }, 12000);
      fetch('https://r.jina.ai/' + u, c ? { signal: c.signal } : {})
        .then(function (r) { return r.ok ? r.text() : null; })
        .then(function (t) { done(t ? String(t).slice(0, 6000) : null); })
        .catch(function () { done(null); });
    },
    contactSearch: function (q) {
      if (!BR || !BR.contacts) return null;
      try {
        var r = BR.contacts(String(q || ''));
        if (r === 'NEED_PERM') return 'NEED_PERM';
        return JSON.parse(r || '[]');
      } catch (e) { return null; }
    },
    /* v2.9.0 — leer la agenda. Mismo contrato que contactSearch(): JSON o 'NEED_PERM'. */
    calendarQuery: function (q, fromMs, toMs) {
      if (!BR || !BR.calendarList) return null;
      try {
        var r = BR.calendarList(String(q || ''), Math.round(fromMs || 0), Math.round(toMs || 0));
        if (r === 'NEED_PERM') return 'NEED_PERM';
        return JSON.parse(r || '[]');
      } catch (e) { return null; }
    },
    /* el permiso ya denied de forma permanente: volver a pedir no abre nada */
    calendarPermission: function (ok) {
      if (ok) { this.askPerm('calendar'); return; }
      this.toast('Sin permiso de agenda: no puedo leer tus eventos');
    },
    askPerm: function (what) { bridge('requestPerm', [what]); },
    torch: function (on) { return bridge('torch', [!!on]); },
    startTimerNative: function (secs, label) { return bridge('startTimerNative', [Math.round(secs), label || '']); },
    voiceCommandsModal: function () {
      var html =
        '<p class="set-hint">Pedíle estas cosas por el mic — o diciendo <b>«Kiu»</b> si el despertar está activo:</p>' +
        '<div class="cmd-list">' +
        '<div class="cmd-row"><span>Linterna</span><b>"enciende la linterna" · "apaga la linterna"</b></div>' +
        '<div class="cmd-row"><span>Batería</span><b>"¿cuánta batería queda?"</b></div>' +
        '<div class="cmd-row"><span>Alarma del reloj</span><b>"pon alarma a las 7 y media"</b></div>' +
        '<div class="cmd-row"><span>Temporizador</span><b>"temporizador de 10 minutos"</b></div>' +
        '<div class="cmd-row"><span>Llamar</span><b>"llama a mamá" · "llamá al 911"</b></div>' +
        '<div class="cmd-row"><span>WhatsApp</span><b>"manda un whatsapp a Juan diciendo ya llego"</b></div>' +
        '<div class="cmd-row"><span>SMS</span><b>"manda un mensaje a Ana diciendo voy"</b></div>' +
        '<div class="cmd-row"><span>Buscar</span><b>"busca gatos en youtube" · "busca clima"</b></div>' +
        '<div class="cmd-row"><span>Apps</span><b>"abre Spotify" · "abre WhatsApp"</b></div>' +
        '<div class="cmd-row"><span>Mapas</span><b>"cómo llego al centro"</b></div>' +
        '<div class="cmd-row"><span>Cámara</span><b>"sacá una foto"</b></div>' +
        '<div class="cmd-row"><span>Ajustes</span><b>"abre wifi" · "abre bluetooth"</b></div>' +
        '<div class="cmd-row"><span>Memoria</span><b>"recuérdame X a las 9" · "recuerda que..."</b></div>' +
        '</div>';
      this.modal('Comandos de voz', html);
    },

    /* ---------- Modal ---------- */
    modal: function (title, bodyHTML) {
      var root = document.getElementById('modal-root');
      root.innerHTML =
        '<div class="modal-sheet"><div class="modal-head"><strong>' + esc(title) + '</strong>' +
        '<button class="icon-btn" id="modal-x">' + icon('x', 18) + '</button></div>' +
        '<div class="modal-body">' + bodyHTML + '</div></div>';
      root.classList.remove('hidden');
      var self = this;
      document.getElementById('modal-x').addEventListener('click', function () { self.closeModal(); });
      root.addEventListener('click', function (ev) {
        if (ev.target === root) self.closeModal();
      });
      paintIcons(root);
      return root.querySelector('.modal-body');
    },
    closeModal: function () {
      var root = document.getElementById('modal-root');
      root.classList.add('hidden');
      root.innerHTML = '';
    },
    confirm: function (title, msg, onOk, opts) {
      var self = this;
      opts = opts || {};
      var okLbl = opts.okLabel || 'Borrar';
      var noLbl = opts.cancelLabel || 'Cancelar';
      var danger = (opts.danger !== false) && !opts.okLabel; // si pasás okLabel custom, no forzar rojo
      if (opts.danger === true) danger = true;
      if (opts.danger === false) danger = false;
      var okStyle = danger
        ? 'flex:1;background:var(--danger);box-shadow:none'
        : 'flex:1;background:var(--grad);box-shadow:none;color:#04211f';
      var html = '<p class="set-hint" style="margin:2px 0 16px">' + esc(msg) + '</p>' +
        '<div style="display:flex;gap:10px">' +
        '<button class="btn-ghost" id="cf-no" style="flex:1;justify-content:center">' + esc(noLbl) + '</button>' +
        '<button class="btn-primary" id="cf-yes" style="' + okStyle + '">' + esc(okLbl) + '</button></div>';
      var body = this.modal(title, html);
      if (!body) return;
      body.querySelector('#cf-no').addEventListener('click', function () { self.closeModal(); if (typeof opts.onCancel === 'function') opts.onCancel(); });
      body.querySelector('#cf-yes').addEventListener('click', function () {
        self.closeModal();
        onOk();
      });
    }
  };

  window.KiuApp = App;
  /* v2.14.2 · ENGANCHE memoria ↔ UI. El módulo de memoria (js/app/memoria.js)
     no conoce la pantalla: avisa por acá. `onAdd` mantiene la línea de tiempo
     de la app; `onChange` refresca la pestaña de Memoria. */
  if (window.KiuMem && window.KiuMem.hooks) {
    window.KiuMem.hooks.onAdd = function (type, text) {
      App.addActivity(type, text);
      if (type === 'notas' || type === 'recuerdos') App.track('notas');
    };
    window.KiuMem.hooks.onChange = function () { App.refreshMem(); };
  }
  /* v1.7.0: módulos expuestos para diagnóstico y pruebas */
  window.KiuRtr = Rtr;
  window.KiuMod = Mod;
  window.KiuOrch = Orch;
  window.KiuEng = Kiu;
  window.KiuKB = KB;
  window.KiuCat = MODCAT;
  /* v2.8.0: este alias se llamaba window.KiuState y chocaba de frente con el
     controlador de estados del avatar (js/kiu-estados.js), que también necesitaba
     ese nombre. S sigue siendo el nombre canónico de los ajustes; el alias queda
     como KiuSettings, que además dice qué es. */
  window.KiuSettings = S;

  /* v2.4.0 (sección 1): restaurar la copia completa que entrega Java (SAF).
     Formato: {app:'Kiu', v:3, settings, memoria, conversaciones, alarmas, kb, uso, rag}. */
  window.kiuDataRestore = function (data) {
    try {
      if (!data || data.app !== 'Kiu' || !data.v) { App.toast('Archivo de copia no reconocido'); return; }
      if (data.settings && typeof data.settings === 'object') {
        var s0 = data.settings;
        for (var k in s0) {
          if (!Object.prototype.hasOwnProperty.call(s0, k)) continue;
          if (k === 'prov') continue; /* las claves no viajan en la copia */
          S[k] = s0[k];
        }
        if (s0.prov && typeof s0.prov === 'object') {
          for (var pid in s0.prov) {
            if (!Object.prototype.hasOwnProperty.call(s0.prov, pid)) continue;
            var p0 = s0.prov[pid] || {}, tgt = pstate(pid);
            for (var pk in p0) {
              if (!Object.prototype.hasOwnProperty.call(p0, pk) || pk === 'key' || pk === 'last4') continue;
              tgt[pk] = p0[pk];
            }
          }
        }
        if (typeof S.thermal === 'undefined') S.thermal = true;
        saveS();
      }
      var nRec = 0, nDoc = 0, nConv = 0, nSk = 0;
      if (data.memoria && typeof data.memoria === 'object') {
        KiuMem.data = data.memoria;
        KiuMem.save();
        nRec = (data.memoria.recuerdos || []).length;
      }
      if (Array.isArray(data.conversaciones)) { store('nexo_convs', data.conversaciones); nConv = data.conversaciones.length; }
      if (Array.isArray(data.alarmas)) {
        store('nexo_alarmas', data.alarmas);
        for (var a = 0; a < data.alarmas.length; a++) {
          var al = data.alarmas[a];
          if (al && al.time && al.time > Date.now()) bridge('setReminder', [al.id || ('r' + Date.now() + a), al.title || 'Alarma', al.time]);
        }
      }
      if (data.kb) store('nexo_kb', data.kb);
      if (data.uso) store('nexo_usage', data.uso);
      /* v2.5.0: los skills viajan en la copia completa */
      if (Object.prototype.toString.call(data.skills) === '[object Array]' && window.KiuSkills) {
        nSk = KiuSkills.importAll(data.skills);
      }
      var finishR = function () {
        try {
          App.applyTheme();
          App.refreshMem();
          App.renderHome();
          App.renderStatus();
          App.renderModels();
        } catch (e2) { }
        App.toast('Copia completa restaurada ✓ ' + (nRec ? nRec + ' recuerdos · ' : '') + nConv + ' conversaciones' + (nDoc ? ' · ' + nDoc + ' documentos' : '') + (nSk ? ' · ' + nSk + ' skills' : ''));
      };
      if (data.rag && window.RAG) {
        RAG.importAll(data.rag, function (err, res) {
          if (!err && res) nDoc = res.docs;
          finishR();
        });
      } else finishR();
    } catch (e) {
      App.toast('No pude restaurar la copia: archivo dañado');
    }
  };

  /* v2.5.0 (sección 4-a): instalar un skill que llega desde Java (SAF, 7104) */
  window.kiuSkillInstall = function (raw) {
    try {
      if (!window.KiuSkills || !window.App) return;
      var r = KiuSkills.installFromText(String(raw || ''));
      if (r.ok) {
        App.toast((r.updated ? 'Skill actualizado: ' : 'Skill instalado: ') + (r.skill && r.skill.m ? r.skill.m.name : ''));
        App.refreshSkillsSub();
      } else {
        App.toast('Skill rechazado: ' + r.err);
      }
    } catch (e) { }
  };

  /* v2.5.0 (sección 4-b): el resumen matutino también queda en el chat
     cuando la app está abierta al dispararse la notificación */
  /* v2.13.8 · Nudge de memoria al quedar inactivo antes de descargar el modelo.
     Usa el compresor ya existente; solo actúa si hay historial suficiente y no hay
     generación activa. No crea hechos nuevos ni borra mensajes de la conversación. */
  window.KiuMemoryNudge = {
    run: function () {
      try {
        if (!window.Comp || !window.Kiu || Kiu.busyG || !S || !S.kiu || !S.kiu.ok) return false;
        var hist = chatHist();
        if (!hist || hist.length <= 8) return false;
        var before = !!Comp.busy;
        Comp.apply(hist);
        return !before && !!Comp.busy;
      } catch (eNudge) { return false; }
    }
  };

  window.kiuMorningSummary = function (text) {
    try {
      var t = String(text || '').trim();
      if (!window.App || !t) return;
      App.pushMsg('bot', t);
      if (S.voiceOn && App.speak) App.speak(t);
      App.scrollBottom();
    } catch (e) { }
  };

  document.addEventListener('DOMContentLoaded', function () {
    try { App.init(); window.__kiuBooted = true; }
    catch (e) {
      try { if (window.kiuShowError) window.kiuShowError('Fallo al iniciar Kiu:\n' + ((e && e.stack) ? e.stack : e)); } catch (e2) { }
    }
  });
  window.App = App;
})();

/* Compatibilidad: nombres anteriores (Nexo*) por si algo externo aún los usa */
window.addEventListener('load', function () {
  window.NexoApp = window.KiuApp; window.NexoMem = window.KiuMem;
  window.NexoBrain = window.KiuBrain; window.NexoTools = window.KiuTools;
});
