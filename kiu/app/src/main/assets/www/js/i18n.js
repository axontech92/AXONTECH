/* i18n.js — v2.4.0 (tanda 4 · sección 3-c): fundación i18n de KIU.
 * Traduce el "chrome" de la interfaz (navegación, inicio, etiquetas de
 * ajustes, botones comunes) usando atributos data-i18n en el HTML estático.
 * - El español es el idioma fuente: si S.lang === 'es' no se toca nada.
 * - Cualquier texto sin clave sigue en español (fallback por defecto).
 * - Las respuestas del cerebro (brain.js) siguen en español por ahora.
 * - KiuI18n.setLang('es'|'en') guarda en nexo_settings.lang, re-aplica y
 *   dispara el evento 'kiu-lang' para que la UI dinámica se refresque.
 */
(function () {
  'use strict';

  var DICT = {
    en: {
      /* navegación inferior */
      'nav.home': 'Home', 'nav.chat': 'Chat', 'nav.models': 'Models',
      'nav.memory': 'Memory', 'nav.settings': 'Settings',
      /* inicio */
      'home.sub': 'Your personal agent',
      'home.hero.title': 'What can I do for you today?',
      'home.hero.pill': 'Listens, thinks, acts for you',
      'home.hero.hi': 'Hi',
      'home.status.title': 'Local engine',
      'home.status.ready': 'Ready',
      'home.status.mode': '100% local',
      'home.status.device': 'Your phone',
      'quick.chat': 'Chat', 'quick.chat.sub': 'Smart conversation',
      'quick.voice': 'Voice', 'quick.voice.sub': 'Talk to me',
      'quick.tools': 'Tools', 'quick.tools.sub': 'Apps and utilities',
      'quick.memory': 'Memory', 'quick.memory.sub': 'Notes and tasks',
      'home.usage': "Today's usage",
      'home.usage.badge': 'real counters',
      /* flash */
      'common.off': 'Turn off',
      /* ajustes generales */
      'set.thermal': 'Thermal protection',
      'set.thermal.sub': "Stops the engine's generation if the phone goes past 46°",
      'set.wake': 'Voice wake-up',
      'set.wake.sub': 'Say "Kiu" and it listens, even with the app closed',
      'set.conv': 'Conversation mode',
      'set.conv.sub': 'Kiu keeps listening after answering: hands-free',
      'set.voice': 'Reply out loud',
      'set.voice.sub': 'Kiu reads its answers',
      'set.links': 'Links inside the chat',
      /* botones comunes */
      'btn.save': 'Save', 'btn.cancel': 'Cancel', 'btn.delete': 'Delete',
      'btn.close': 'Close', 'btn.stop': 'Stop', 'btn.add': 'Add'
    }
    /* 'es' es la identidad: no hace falta diccionario */
  };

  function settings() {
    try { return JSON.parse(localStorage.getItem('nexo_settings') || '{}') || {}; } catch (e) { return {}; }
  }

  function current() {
    var s = settings();
    return s.lang || 'es';
  }

  function t(key) {
    var l = current();
    if (l === 'es' || !DICT[l]) return null;
    return DICT[l][key] || null;
  }

  function apply(root) {
    var l = current();
    if (l === 'es' || !DICT[l]) return;
    var scope = root || document;
    try {
      var els = scope.querySelectorAll('[data-i18n]');
      for (var i = 0; i < els.length; i++) {
        var v = DICT[l][els[i].getAttribute('data-i18n')];
        if (v) els[i].textContent = v;
      }
      var phs = scope.querySelectorAll('[data-i18n-ph]');
      for (var j = 0; j < phs.length; j++) {
        var vp = DICT[l][phs[j].getAttribute('data-i18n-ph')];
        if (vp) phs[j].setAttribute('placeholder', vp);
      }
    } catch (e) { }
  }

  window.KiuI18n = {
    t: t,
    apply: apply,
    current: current,
    LANGS: [{ id: 'es', name: 'Español' }, { id: 'en', name: 'English' }],
    setLang: function (l) {
      var s = settings();
      s.lang = (l === 'en') ? 'en' : 'es';
      try { localStorage.setItem('nexo_settings', JSON.stringify(s)); } catch (e) { }
      try { if (typeof S !== 'undefined' && typeof saveS === 'function') { S.lang = s.lang; saveS(); } } catch (e2) { }
      apply();
      try { window.dispatchEvent(new Event('kiu-lang')); } catch (e3) { }
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { apply(); });
  else apply();
})();
