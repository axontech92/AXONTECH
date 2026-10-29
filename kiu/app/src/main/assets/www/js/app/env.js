/* app/env.js — módulo de app.js (tanda 4 · sección 3-a). helpers puros, iconos y puente Android (crudo + envuelto).
 * Cargado como script clásico en orden por index.html; los símbolos
 * compartidos viven en window para que los módulos se lean entre sí
 * igual que dentro del app.js original. */
(function () {
  'use strict';

  /* ================= ICONOS SVG ================= */
  var P = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9 21v-6h6v6"/>',
    chat: '<path d="M21 12a8 8 0 0 1-8 8H4l2.2-3.3A8 8 0 1 1 21 12z"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    memory: '<ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/><path d="M4 11.5v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h0a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 .3 1.9v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><path d="M12 19v3"/>',
    send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
    flash: '<path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12L13 2z"/>',
    calc: '<rect x="4" y="2" width="16" height="20" rx="3"/><path d="M8 6h8"/><path d="M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h.01M12 19h.01M16 19h.01"/>',
    note: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h4"/>',
    timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5"/><path d="M9 2h6"/>',
    key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m11 12 9-9"/><path d="M17 6l3 3"/>',
    dice: '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.5" cy="8.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="8.5" cy="15.5" r="1.2" fill="currentColor" stroke="none"/>',
    conv: '<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>',
    count: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
    bulb: '<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-4 10.5c.8.7 1 1.5 1 2.5h6c0-1 .2-1.8 1-2.5A6 6 0 0 0 12 3z"/>',
    speaker: '<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    pause: '<rect x="6" y="4" width="4" height="16" rx="1.2"/><rect x="14" y="4" width="4" height="16" rx="1.2"/>',
    xmark: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    bookmark: '<path d="M19 21 12 16 5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
    heart: '<path d="M19.5 12.6 12 20l-7.5-7.4A5 5 0 1 1 12 6.3a5 5 0 1 1 7.5 6.3z"/>',
    alarm: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5"/><path d="M5 3 2 6M19 3l3 3"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    receipt: '<path d="M4 2h16v20l-2.5-1.5L15 22l-3-1.5L9 22l-2.5-1.5L4 22z"/><path d="M8 7h8M8 11h8M8 15h5"/>',
    percent: '<path d="M19 5 5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
    pulse: '<path d="M3 12h4l2-7 4 14 2-7h6"/>',
    cal: '<rect x="3" y="4" width="18" height="17" rx="3"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    play: '<rect x="2" y="4" width="20" height="16" rx="5"/><path d="m10 9 5 3-5 3z"/>',
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.8a2 2 0 0 1-.4 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.9.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
    pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>',
    wave: '<path d="M3 10.5v3"/><path d="M7 7.5v9"/><path d="M12 4v16"/><path d="M17 7.5v9"/><path d="M21 10.5v3"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>',
    thumbs: '<path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
    eyeoff: '<path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 8 10 8a9.74 9.74 0 0 0 5.39-1.61"/><path d="m2 2 20 20"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>',
    chevr: '<path d="m9 18 6-6-6-6"/>',
    chevd: '<path d="m6 9 6 6 6-6"/>',
    chevl: '<path d="m15 18-6-6 6-6"/>',
    folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
    brain: '<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M12 5v13"/>',
    cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
    headset: '<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>',
    wallet: '<rect x="2" y="6" width="20" height="14" rx="3"/><path d="M2 10h20"/><path d="M16.5 15h.01"/>',
    shield: '<path d="M12 2 4 5.5V11c0 5 3.4 9.2 8 10.5 4.6-1.3 8-5.5 8-10.5V5.5L12 2z"/><path d="m9 12 2 2 4-4"/>',
    cloudup: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/><path d="M12 12v7"/><path d="m9 15 3-3 3 3"/>',
    battery: '<rect x="2" y="7" width="17" height="10" rx="2.5"/><path d="M22 11v2"/><path d="M6.5 10.5v3"/>',
    cpu: '<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="10" y="10" width="4" height="4"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4-4"/>',
    save: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
    spark: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"/>',
    list: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3.5 6h.01"/><path d="M3.5 12h.01"/><path d="M3.5 18h.01"/>',
    palette: '<circle cx="12" cy="12" r="9.5"/><circle cx="8.5" cy="10" r="1.4"/><circle cx="12" cy="7.5" r="1.4"/><circle cx="15.5" cy="10" r="1.4"/><path d="M12 21.5a3.5 3.5 0 0 1 0-7h1.5a2.5 2.5 0 0 0 0-5"/>',
    pencil: '<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>',
    sliders: '<path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/>',
    camera: '<path d="M3 8a2 2 0 0 1 2-2h2l2-3h6l2 3h2a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="4"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.8"/><path d="m21 15-5-5L5 21"/>',
    alert: '<path d="M12 9v4M12 17h.01M10.3 3.9 1.4 1.5a2 2 0 0 1 2 2.9v1.3a2 2 0 0 0 2 2.9 1.4-1.5 2.9-1.4 1.5-2.9Z"/>'
  };
  function icon(name, sz) {
    var s = sz || 24;
    return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (P[name] || '') + '</svg>';
  }
  function paintIcons(root) {
    var els = (root || document).querySelectorAll('[data-ic]');
    for (var i = 0; i < els.length; i++) {
      els[i].innerHTML = icon(els[i].getAttribute('data-ic'));
    }
  }

  /* ================= HELPERS ================= */
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function store(key, val) {
    try {
      if (val === undefined) {
        var raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      }
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) { return null; }
  }
  function timeAgo(ts) {
    var d = Date.now() - ts;
    var m = Math.floor(d / 60000);
    if (m < 1) return 'Ahora';
    if (m < 60) return 'Hace ' + m + ' min';
    var h = Math.floor(m / 60);
    if (h < 24) return 'Hace ' + h + ' h';
    var dd = Math.floor(h / 24);
    if (dd === 1) return 'Ayer';
    if (dd < 7) return 'Hace ' + dd + ' días';
    return new Date(ts).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
  }
  function todayStr() {
    return new Date().toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
  }
  function nowTime() {
    return new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  }
  function fmtWhen(ts) {
    var d = new Date(ts);
    var hoy = new Date();
    var m1 = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
    var m2 = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var diff = Math.round((m2 - m1) / 86400000);
    var hm = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    var pref = diff === 0 ? 'Hoy' : diff === 1 ? 'Mañana' : d.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' });
    return pref + ' ' + hm;
  }
  function timeUntil(ts) {
    var ms = ts - Date.now();
    if (ms <= 0) return 'ya pasó';
    var m = Math.max(1, Math.ceil(ms / 60000)); /* v2.7.1: ceil — antes 59 s decia "en 0 min" y 30:00 menos 1 ms, "en 29 min" */
    if (m < 60) return 'en ' + m + ' min';
    var h = Math.floor(m / 60);
    if (h < 24) return 'en ' + h + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '');
    var d = Math.floor(h / 24);
    return 'en ' + d + ' día' + (d === 1 ? '' : 's');
  }
  function fmtGB(bytes) {
    return (Math.round(bytes / 1073741824 * 10) / 10).toLocaleString('es-AR', { maximumFractionDigits: 1 });
  }

  /* ================= v1.7.0: PUENTE CRUDO ================= */
  /* v2.14.2 · EL PUENTE SE RESUELVE EN CADA LLAMADA, NO UNA SOLA VEZ.
     Antes `BR` se capturaba al cargar este archivo. Si en ese instante
     window.KiuBridge todavía no estaba, `BR` quedaba en null PARA SIEMPRE y
     todo lo nativo moría en silencio: `kiuGen` devolvía null, el motor
     "no arrancaba nunca" y el agente contestaba "el motor sigue ocupado"
     aunque el modelo estuviera cargado en la memoria. Ahora se resuelve en
     cada llamada, así que un puente que aparece tarde se usa igual. */
  var _brCache = null;
  function puente() {
    if (_brCache) return _brCache;
    try {
      _brCache = (typeof window.KiuBridge !== 'undefined' && window.KiuBridge) ? window.KiuBridge
        : ((typeof window.NexoBridge !== 'undefined' && window.NexoBridge) ? window.NexoBridge : null);
    } catch (e) { _brCache = null; }
    return _brCache;
  }
  function rawBridge(fn, args) {
    var b = puente();
    if (!b || !b[fn]) return null;
    try { return b[fn].apply(b, args || []); } catch (e) { return null; }
  }
  function jparse(s, fb) { try { return JSON.parse(s); } catch (e) { return fb; } }
  /* Migas de contexto para el diagnóstico (SafeBoot las muestra si hay error) */
  function bcrumb(m) { try { if (window.kiuBread) window.kiuBread(m); } catch (e) { } }

  /* ================= PUENTE ANDROID ================= */
  function bridge(fnName, args) {
    var b = puente();
    if (!b) return false;
    try { var r = b[fnName].apply(b, args || []); return (r === undefined) ? true : !!r; } catch (e) { return false; }
  }

  /* exports del módulo (cross-módulo vía window) */
  window.P = P;
  window.icon = icon;
  window.paintIcons = paintIcons;
  window.esc = esc;
  window.store = store;
  window.timeAgo = timeAgo;
  window.todayStr = todayStr;
  window.nowTime = nowTime;
  window.fmtWhen = fmtWhen;
  window.timeUntil = timeUntil;
  window.fmtGB = fmtGB;
  window.rawBridge = rawBridge;
  window.jparse = jparse;
  window.bcrumb = bcrumb;
  /* window.BR sigue siendo el puente, pero resuelto en cada lectura: el código
     que lo usa (app-ui.js) no tiene que saber que se resuelve solo. */
  try {
    Object.defineProperty(window, 'BR', { get: puente, configurable: true });
  } catch (eBR) { window.BR = puente(); }
  window.bridge = bridge;
})();
