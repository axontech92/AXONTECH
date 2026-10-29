/*!
 * kiu-avatar-boot.js — inicialización del avatar de Kiu (tanda 8 · v2.7.0 → v2.8.0).
 *
 * Qué hace (y qué NO hace, que es lo importante):
 *
 * 1) Monta el bot en TODOS los [data-avatar] (hero, chat, perfil) y en los
 *    mini-bots [data-avatar-mini] (esquina del home, bloque Acerca de) con
 *    tamaño fijo. Nada de adivinar layouts ajenos: el HTML declara los huecos.
 * 2) Reajusta el tamaño de cada bot cuando su hueco cambia (pantalla que se
 *    abre, giro del teléfono...).
 *
 * v2.8.0 — se fue el Proxy sobre window.KiuBridge. Antes este archivo envolvía el
 * puente y ADIVINABA el estado mirando cada llamada (kiuGen, kiuGenStatus,
 * kiuIsLoaded, kiuLoad, speak, dlStart…), y eso se pisaba con los set() de la app:
 *   - kiuIsLoaded se llama en cada mensaje (ensureLoaded) → "Cargado" siempre
 *   - a los 2,5 s sin sondeo marcaba la generación como terminada, cuando con el
 *     streaming por push ya no se sondea
 *   - el temporizador de 90 s de kiuLoad forzaba "Inactivo" sin que nadie lo cancelara
 * Ahora el estado lo pone KiuState (js/kiu-estados.js) con eventos explícitos que
 * emiten Kiu.ask, Mod.start, el TTS, las alarmas y app-ui. Este archivo ya no
 * adivina nada: solo monta y repinta. API de compat: KiuAvatarBoot.set/hold/flash/reset.
 */
(function () {
  'use strict';

  function log() { try { console.log.apply(console, ['[kiu-avatar]'].concat([].slice.call(arguments))); } catch (e) { } }

  /* capa de compatibilidad: el estado de verdad vive en KiuState (js/kiu-estados.js) */
  function st() { return window.KiuState || null; }
  function set(s) { if (st()) st().set('flash', s); else if (window.KiuAvatar) KiuAvatar.set(s); }
  function hold(s) { if (st()) st().set('rest', s); else if (window.KiuAvatar) KiuAvatar.hold(s); }
  function flash(s, ms) { if (st()) st().flash('flash', s, ms); else if (window.KiuAvatar) KiuAvatar.flash(s, ms); }
  function reset() { if (st()) st().reset(); else if (window.KiuAvatar) KiuAvatar.reset(); }

  /* ---------- 1) montaje: solo huecos declarados por el HTML ---------- */
  function mountMinis() {
    if (typeof KiuAvatar === 'undefined') return 0;
    var els = document.querySelectorAll('[data-avatar-mini]'), n = 0;
    for (var i = 0; i < els.length; i++) {
      if (els[i].getAttribute('data-kiu-mounted')) { n++; continue; }
      /* v2.8.1: sin tamaño fijo. KiuAvatar.fitSize() mide el hueco y, si la pantalla
         todavía no tiene layout, lee el --kav-s del CSS. El 36/42 fijo de antes
         quedaba corto apenas se ajustaba el ancho de pantalla. */
      try { KiuAvatar.mount(els[i], {}); n++; } catch (e) { log('mini no montada', els[i].id || i, e.message); }
    }
    return n;
  }
  function mountAll() {
    if (typeof KiuAvatar === 'undefined') return false;
    mountMinis();
    var hosts = document.querySelectorAll('[data-avatar]'), n = 0;
    for (var i = 0; i < hosts.length; i++) {
      if (hosts[i].getAttribute('data-kiu-mounted')) { n++; continue; }
      try { KiuAvatar.mount(hosts[i], {}); n++; } catch (e) { log('no pude montar en', hosts[i].id || i, e.message); }
    }
    if (n) log('bot montado en', n, 'hueco(s) [data-avatar]/[data-avatar-mini]');
    return n > 0;
  }

  /* Reajusta tamaños cuando el host cambia de dimensión (pantalla que se abre,
     giro del teléfono...). Barato: son 2-3 bots.
     v2.8.1: si el host todavía no tiene layout (pantalla oculta → rect 0x0) no se
     lo salta: usa el tamaño declarado en el CSS, que es el mismo que le va a tocar
     cuando la pantalla se abra. Antes esos huecos quedaban con el tamaño de
     emergencia para siempre. */
  function refit() {
    if (typeof KiuAvatar === 'undefined' || !KiuAvatar.mounted) return;
    var ds = KiuAvatar.mounted();
    for (var i = 0; i < ds.length; i++) {
      var h = ds[i].host; if (!document.contains(h)) continue;
      var r = h.getBoundingClientRect();
      var s;
      if (r && r.width >= 24 && r.height >= 24) s = Math.round(Math.min(r.width, r.height) * 0.95);
      else s = Math.round((KiuAvatar.declaredSize ? KiuAvatar.declaredSize(h) : 0) * 0.95);
      if (!(s >= 30)) continue;
      if (Math.abs(s - (h.__kiuSize || 0)) > 6) ds[i].av.resize(s);
    }
  }

  /* ---------- 2) arranque ---------- */
  function start() {
    mountAll();
    setTimeout(mountAll, 800);   /* por si algún módulo tardó en pintar su hueco */
    setTimeout(refit, 900); setTimeout(refit, 2500);
    window.addEventListener('resize', function () { clearTimeout(start._r); start._r = setTimeout(refit, 250); }, { passive: true });
    setInterval(refit, 1500);
  }
  window.KiuAvatarBoot = {
    set: function (n) { set(n); },
    hold: hold, flash: flash, reset: reset,
    /* el estado real, para diagnóstico y para los tests */
    state: function () { return st() ? st().get() : (window.KiuAvatar ? KiuAvatar.state() : 'Inactivo'); },
    get avatar() { return null; } /* compat: ya no hay bot de reemplazo */
  };
  start();
})();
