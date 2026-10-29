/* Harness² Compose v2.13.5: perfil operativo del agente y rollback por fallos.
 * No afirma aprender ni cambiar pesos: selecciona límites de ejecución observables.
 * Los datos persistidos son contadores agregados, nunca prompts ni argumentos.
 */
(function (root) {
  'use strict';
  var KEY = 'kiu_active_harness_v2135';
  var BASE = { id: 'Harness-Local-Compact', maxTokens: 120, maxSteps: 4, consecutiveFailures: 0, successes: 0, failures: 0 };
  function storage() { try { return root.localStorage; } catch (e) { return null; } }
  function read() {
    try {
      var s = storage(), raw = s && s.getItem(KEY), p = raw && JSON.parse(raw);
      if (p && (p.id === 'Harness-Local-Compact' || p.id === 'Harness-Cloud-Rich') &&
          Number.isFinite(p.consecutiveFailures) && Number.isFinite(p.successes) && Number.isFinite(p.failures)) return p;
    } catch (e) { }
    return Object.assign({}, BASE);
  }
  function save(p) { try { var s = storage(); if (s) s.setItem(KEY, JSON.stringify(p)); } catch (e) { } }
  function choose(info) {
    var i = info || {}, name = String(i.modelName || '');
    var cloud = i.provider === 'cloud' || i.remote === true;
    var p = read();
    /* Selección explícita por origen; no inferir nube solo por el nombre del modelo. */
    p.id = cloud ? 'Harness-Cloud-Rich' : 'Harness-Local-Compact';
    p.maxTokens = cloud ? 180 : 120;
    p.maxSteps = 4;
    p.modelFamily = /hermes/i.test(name) ? 'hermes' : /qwen3/i.test(name) ? 'qwen3' : 'default';
    save(p);
    return Object.assign({}, p);
  }
  function record(ok, reason) {
    var p = read();
    if (ok) { p.successes++; p.consecutiveFailures = 0; }
    else {
      p.failures++; p.consecutiveFailures++;
      if (p.consecutiveFailures >= 2) {
        p.id = 'Harness-Local-Compact'; p.maxTokens = 120; p.maxSteps = 4;
        p.consecutiveFailures = 0; p.lastRollback = Date.now();
      }
    }
    p.lastOutcome = ok ? 'ok' : 'fail';
    /* Solo etiqueta categórica; no persistir texto de error, prompt ni datos personales. */
    p.lastReason = /grammar|gram[aá]tica/i.test(String(reason || '')) ? 'grammar' : /json|parse/i.test(String(reason || '')) ? 'parse' : 'execution';
    save(p); return Object.assign({}, p);
  }
  function status() { return read(); }
  function reset() { save(Object.assign({}, BASE)); return status(); }
  root.KiuHarness2 = { choose: choose, record: record, status: status, reset: reset, key: KEY };
})(window);
