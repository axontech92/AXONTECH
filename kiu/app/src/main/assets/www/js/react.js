/* react.js — v2.5.0 (sección 4-c): bucle ReAct de pocos pasos.
 * Cuando el pedido tiene varias partes ("poné alarma a las 7 y buscá en mis
 * notas la receta"), en vez de contestar a medias, Kiu lo parte en pasos y
 * ejecuta un mini-bucle Razonar → Actuar → Observar por paso, con las
 * herramientas LOCALES que ya tiene:
 *   - cerebro (KiuBrain): alarmas, linterna, calculadora, fecha, batería…
 *   - documentos (RAG): búsqueda en los archivos que el usuario indexó.
 * Sin nube, sin modelo cargado: corre siempre. Si ninguna parte se puede
 * resolver, devuelve handled:false y el flujo normal (orquestador/API/local)
 * sigue como si nada.
 * Traza de cada paso queda en KiuReAct.lastTrace (útil para debug y para la
 * demo). node --check js/react.js
 */
window.KiuReAct = (function () {
  'use strict';

  var MAX_STEPS = 4;
  var MIN_PART = 3; /* caracteres mínimos por parte */
  var lastTraceV = []; /* traza del último run() */

  var CONECTORES = /\s*(?:,|;|\s+y\s+|\se\s+|\sdespués\s+|\sdespues\s+|\sluego\s+|\sademás\s+|\sademas\s+|\stambién\s+|\stambien\s+|\sand\s+)\s*/i;

  function norm(s) {
    return (s || '').toLowerCase()
      .replace(/[áàä]/g, 'a').replace(/[éèë]/g, 'e').replace(/[íìï]/g, 'i')
      .replace(/[óòö]/g, 'o').replace(/[úùü]/g, 'u').replace(/ñ/g, 'n')
      .replace(/[¿¡]/g, '').replace(/\s+/g, ' ').trim();
  }

  /* ---------- partir el pedido en pasos ---------- */
  function splitTasks(text) {
    var t = String(text || '').trim().replace(/\?|!|¿|¡/g, '');
    if (!t) return [];
    var parts = t.split(CONECTORES);
    var out = [];
    for (var i = 0; i < parts.length && out.length < MAX_STEPS; i++) {
      var p = parts[i].trim();
      if (p.length >= MIN_PART) out.push(p);
    }
    return out;
  }

  /* ---------- herramientas ---------- */
  function toolDocs(q) {
    /* ¿el paso pide algo que pueda estar en los documentos del usuario? */
    var n = norm(q);
    if (!/(mis documentos|mis notas|mis archivos|mis pdf|mis apuntes|busca en|buscame en|segun mis|en mis|que dice el|que dice la)/.test(n)) return false;
    if (!/(documento|nota|archivo|pdf|apunte|receta|contrato|manual|libro|guia)/.test(n)) return false;
    return true;
  }

  function searchDocs(q) {
    if (!window.RAG || !window.RAG.on) return null;
    try {
      /* v2.7.0: usa RAG.hits() (resultados estructurados). Antes llamaba a
       * RAG.search() esperando un array de {doc,txt}, pero search devuelve un
       * STRING para inyectar al prompt: el paso «docs» del ReAct terminaba
       * citando caracteres sueltos del string. Descontrato corregido. */
      if (typeof window.RAG.hits !== 'function') return null;
      var hits = window.RAG.hits(q, 3) || [];
      if (!hits.length) return null;
      var lines = [];
      for (var i = 0; i < hits.length && i < 2; i++) {
        var h = hits[i];
        var name = (h.name || h.doc || 'documento');
        var snip = String(h.txt || h.text || '').replace(/\s+/g, ' ').trim();
        if (!snip) continue;
        if (snip.length > 110) snip = snip.slice(0, 110) + '…';
        lines.push('«' + name + '»: ' + snip);
      }
      return lines.length ? lines.join('\n') : null;
    } catch (e) { return null; }
  }

  function tryBrain(q) {
    if (!window.KiuBrain || typeof window.KiuBrain.reply !== 'function') return null;
    try {
      var r = window.KiuBrain.reply(q);
      if (r && r.handled && r.text) return r.text;
      return null;
    } catch (e) { return null; }
  }

  /* ---------- clasificación de un paso ---------- */
  function classifyStep(q) {
    if (toolDocs(q)) return 'docs';
    return 'cerebro';
  }

  /* ---------- ¿vale la pena el bucle? ---------- */
  function suitable(text) {
    var n = norm(text);
    /* explícito: el usuario pide planificación */
    if (/(paso a paso|planifica|planificame|organizame|organiza|una por una|de a una)/.test(n)) return true;
    var parts = splitTasks(text);
    if (parts.length < 2) return false;
    /* implícito: 2+ partes y al menos una con cara de tarea local */
    var local = 0;
    for (var i = 0; i < parts.length; i++) {
      if (toolDocs(parts[i])) local++;
      else if (window.KiuBrain && window.KiuBrain.reply) {
        try { var r = window.KiuBrain.reply(parts[i]); if (r && r.handled) local++; } catch (e) { }
      }
    }
    return local >= 2;
  }

  /* ---------- el bucle ---------- */
  function run(text) {
    var parts = splitTasks(text);
    if (parts.length < 2) return null;
    var results = [];
    var trace = [];
    var handled = 0;
    lastTraceV = trace;
    for (var i = 0; i < parts.length && i < MAX_STEPS; i++) {
      var q = parts[i];
      var thought, action, obs;
      if (classifyStep(q) === 'docs') {
        thought = 'este paso menciona tus documentos → busco con RAG';
        action = 'buscar en documentos';
        obs = searchDocs(q);
        if (!obs) { thought = 'no hay nada en tus documentos que matchee'; obs = null; }
      } else {
        thought = 'este paso es una orden/conversión/hora → cerebro local';
        action = 'cerebro';
        obs = tryBrain(q);
      }
      trace.push({ step: i + 1, q: q, thought: thought, action: action, obs: obs });
      if (obs) { handled++; results.push((i + 1) + ') ' + obs); }
    }
    if (!handled) return { handled: false, text: '', trace: trace };
    var head = results.length > 1 ? 'Va, una cosa por vez:\n' : '';
    var tail = results.length < trace.length
      ? '\n\nLo que quedó (' + (trace.length - results.length) + ') no lo pude resolver con lo que tengo acá.'
      : '';
    return {
      handled: true,
      text: head + results.join('\n') + tail,
      trace: trace
    };
  }

  return {
    MAX_STEPS: MAX_STEPS,
    splitTasks: splitTasks,
    classifyStep: classifyStep,
    suitable: suitable,
    run: run,
    toolDocs: toolDocs,
    get lastTrace() { return lastTraceV; }
  };
})();
