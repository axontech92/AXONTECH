/*!
 * kiu-migrate.js — ferry único de datos entre orígenes (v2.3.0 · sección 2 seguridad).
 *
 * La app nueva sirve la UI por https://appassets.androidplatform.net (WebViewAssetLoader)
 * en vez de file:///android_asset. El localStorage del origen viejo NO se ve desde el
 * origen nuevo, así que al actualizar la app hacemos UN solo pasaje:
 *
 *   1) Java detecta que falta migrar → carga file:///android_asset/www/index.html?ferry=1
 *   2) Este script (se carga primero) ve ?ferry=1, exporta TODO el localStorage a JSON
 *      y se lo entrega a Java (KiuBridge.kiuFerryPut). Java lo guarda y recarga la app
 *      en el origen seguro. window.stop() corta el arranque normal en el origen viejo.
 *   3) En el origen nuevo, el script toma el JSON (KiuBridge.kiuFerryGet), reimporta
 *      todo, se marca y borra el ferry del lado Java. No vuelve a correr jamás.
 *
 * Sin KiuBridge (navegador, pruebas en desktop) todo esto es no-op: la app arranca igual.
 */
(function () {
  'use strict';
  var B = window.KiuBridge;
  var isFerry = /[?&]ferry=1/.test(location.search);

  function exportAll() {
    var o = {};
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k != null) o[k] = localStorage.getItem(k);
      }
    } catch (e) { }
    return o;
  }

  try {
    if (isFerry) {
      /* ------- origen viejo (file://) → exportar y salir volando ------- */
      if (B && typeof B.kiuFerryPut === 'function') {
        var payload = '';
        try { payload = JSON.stringify(exportAll()); } catch (e) { payload = '{}'; }
        if (!payload || payload === '{}') {
          /* nada que migrar: marcar listo y que Java recargue igual */
          try { B.kiuFerryPut('{}'); } catch (e2) { }
        } else {
          try { B.kiuFerryPut(payload); } catch (e3) { }
        }
        try { window.stop(); } catch (e4) { } /* no bootear dos veces en el origen viejo */
      }
      return;
    }

    /* ------- origen nuevo (https://appassets.androidplatform.net) ------- */
    if (B && typeof B.kiuFerryGet === 'function') {
      var raw = '';
      try { raw = B.kiuFerryGet() || ''; } catch (e5) { raw = ''; }
      if (raw) {
        var already = false;
        try { already = !!localStorage.getItem('kiu_ferried'); } catch (e6) { }
        if (!already) {
          try {
            var data = JSON.parse(raw);
            for (var k2 in data) {
              if (!Object.prototype.hasOwnProperty.call(data, k2)) continue;
              try { localStorage.setItem(k2, String(data[k2])); } catch (e7) { }
            }
          } catch (e8) { }
          try { localStorage.setItem('kiu_ferried', String(Date.now())); } catch (e9) { }
        }
        try { B.kiuFerryClear(); } catch (e10) { }
      }
    }
  } catch (e) { /* jamás bloquear el arranque por esto */ }
})();
