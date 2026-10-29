/* skills.js — v2.5.0 (sección 4-a): skills instalables.
 * Un skill es un manifest JSON declarativo (SIN código ejecutable) que Kiu
 * combina con su cerebro: intents (qué mensajes dispara el skill) y replies
 * (qué contesta, con variables). Todo seguro por diseño: no hay eval ni JS
 * del usuario corriendo en el WebView.
 *
 * Formato del manifest:
 * {
 *   "id": "saludo-ninja",            // único, [a-z0-9-], máx 40
 *   "name": "Saludo ninja",          // máx 40
 *   "version": 1,                    // entero
 *   "desc": "Kiu saluda como ninja", // máx 140
 *   "intents": ["modo ninja"],       // 1..8 frases o "regex:patrón"
 *   "reply": "Silencio. {nombre}...",// string o array (elige al azar)
 *   "tts": false                     // opcional: leerlo en voz alta sí o sí
 * }
 *
 * Variables soportadas en reply: {nombre} {hora} {fecha} {bateria} {carga}
 * Persistencia: localStorage "kiu_skills" (tope 20 skills × 8 KB).
 * node --check js/skills.js
 */
window.KiuSkills = (function () {
  'use strict';

  var LS = 'kiu_skills';
  var MAX_SKILLS = 20;
  var MAX_SIZE = 8192;
  var RECIPE_KEY = 'kiu_procedural_recipes_v2138';
  var MAX_RECIPES = 30;
  var RECIPE_STOP = /^(?:para|como|cuando|donde|desde|hasta|quiero|necesito|puedes|podrias|hacer|hazme|hacerme|porfavor|favor|esto|esta|este|algo|todo|tengo|tiene|con|sin|una|uno|unos|unas|los|las|del|que|qué|por|mis|mis|me|mi|el|la|de|un|y|o|a|en|al|es|son|the|and|for|with|from|this|that)$/i;

  /* ---------- normalización (misma base que el cerebro) ---------- */
  function norm(s) {
    return (s || '').toLowerCase()
      .replace(/[áàä]/g, 'a').replace(/[éèë]/g, 'e').replace(/[íìï]/g, 'i')
      .replace(/[óòö]/g, 'o').replace(/[úùü]/g, 'u').replace(/ñ/g, 'n')
      .replace(/[?!¡¿.,;:"'()]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /* ---------- validación de manifest ---------- */
  function validate(m) {
    if (!m || typeof m !== 'object' || Array.isArray(m)) return 'el skill debe ser un objeto JSON';
    if (typeof m.id !== 'string' || !/^[a-z0-9][a-z0-9-]{1,39}$/.test(m.id)) return 'id inválido: minúsculas, números y guiones (2..40)';
    if (typeof m.name !== 'string' || !m.name.trim() || m.name.length > 40) return 'name inválido (1..40 caracteres)';
    if (typeof m.version === 'undefined') m.version = 1;
    if (typeof m.version !== 'number' || m.version < 1 || m.version > 9999 || m.version % 1 !== 0) return 'version debe ser un entero ≥ 1';
    if (typeof m.desc !== 'string') m.desc = '';
    if (m.desc.length > 140) return 'desc muy larga (máx 140)';
    if (!Object.prototype.toString.call(m.intents) || !Array.isArray(m.intents) || !m.intents.length || m.intents.length > 8) return 'intents: lista de 1 a 8 frases';
    for (var i = 0; i < m.intents.length; i++) {
      var it = m.intents[i];
      if (typeof it !== 'string' || it.trim().length < 2 || it.length > 80) return 'intent ' + (i + 1) + ' inválido (2..80 caracteres)';
      if (it.indexOf('regex:') === 0) {
        try { new RegExp(it.slice(6)); } catch (e) { return 'intent ' + (i + 1) + ': regex inválida'; }
      }
    }
    if (typeof m.reply === 'string' && m.reply.trim().length >= 1) { m.reply = [m.reply]; }
    else if (Object.prototype.toString.call(m.reply) === '[object Array]' && m.reply.length) {
      for (var r = 0; r < m.reply.length; r++) {
        if (typeof m.reply[r] !== 'string' || !m.reply[r].trim()) return 'reply[' + r + '] vacío';
        if (m.reply[r].length > 500) return 'reply[' + r + '] muy largo (máx 500)';
      }
    } else return 'reply: un texto o lista de textos';
    if (m.reply.length > 10) return 'reply: máx 10 variantes';
    if (typeof m.tts !== 'boolean') m.tts = false;
    return null;
  }

  /* ---------- persistencia ---------- */
  function all() {
    var l = null;
    try { l = JSON.parse(localStorage.getItem(LS) || '[]'); } catch (e) { l = null; }
    if (!Object.prototype.toString.call(l) || !Array.isArray(l)) l = [];
    return l;
  }
  function save(l) {
    try { localStorage.setItem(LS, JSON.stringify(l)); return true; } catch (e) { return false; }
  }

  /* ---------- variables ---------- */
  function vars() {
    var d = new Date();
    var dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    var meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    var bat = '';
    var charging = '';
    try {
      if (window.KiuApp && KiuApp.bridgeCall) {
        var raw = KiuApp.bridgeCall('sysInfo', []);
        if (raw) {
          var si = (typeof raw === 'string') ? JSON.parse(raw) : raw;
          if (si && typeof si.bat === 'number') bat = si.bat + '%';
          if (si) charging = si.charging ? 'cargando' : 'sin cargador';
        }
      }
    } catch (e) { }
    return {
      nombre: (window.S && S.name) ? S.name.split(' ')[0] : 'jefe',
      hora: String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'),
      fecha: dias[d.getDay()] + ' ' + d.getDate() + ' de ' + meses[d.getMonth()],
      bateria: bat || 'no disponible',
      carga: charging || 'no disponible'
    };
  }
  function fill(tpl, v) {
    return String(tpl).replace(/\{(\w+)\}/g, function (all, k) {
      return (v && Object.prototype.hasOwnProperty.call(v, k)) ? v[k] : all;
    });
  }

  /* ---------- match + run ---------- */
  function match(text) {
    var q = norm(text);
    if (!q) return null;
    var l = all();
    for (var i = 0; i < l.length; i++) {
      var sk = l[i];
      if (!sk.on) continue;
      var its = (sk.m && sk.m.intents) || [];
      for (var j = 0; j < its.length; j++) {
        var it = its[j];
        if (it.indexOf('regex:') === 0) {
          try { if (new RegExp(it.slice(6), 'i').test(text)) return l[i]; } catch (e) { }
        } else if (q.indexOf(norm(it)) >= 0) {
          return l[i];
        }
      }
    }
    return null;
  }

  function run(sk) {
    if (!sk || !sk.m) return null;
    var reps = sk.m.reply || [];
    var txt = reps[Math.floor(Math.random() * reps.length)] || '';
    txt = fill(txt, vars());
    /* el skill también puede terminar en acción del cerebro: "accion: ..." */
    var mAct = txt.match(/^\s*accion:(.+)$/i);
    if (mAct) {
      if (window.KiuBrain) {
        var res = KiuBrain.reply(mAct[1].trim());
        if (res && res.handled) return { text: res.text, tts: res.text, handled: true, skill: sk.m.id };
      }
      /* sin cerebro (o sin poder resolver), el skill no contesta nada raro */
      return null;
    }
    if (!txt) return null;
    return { text: txt, tts: txt, handled: true, skill: sk.m.id, say: !!sk.m.tts };
  }

  /* ---------- instalación ---------- */
  function installFromText(raw, opts) {
    opts = opts || {};
    if (!raw || typeof raw !== 'string') return { ok: false, err: 'archivo vacío' };
    if (raw.length > MAX_SIZE) return { ok: false, err: 'el skill supera los 8 KB' };
    var start = raw.indexOf('{'), end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return { ok: false, err: 'no encontré JSON adentro' };
    var m;
    try { m = JSON.parse(raw.slice(start, end + 1)); } catch (e) { return { ok: false, err: 'JSON inválido: ' + e.message }; }
    var err = validate(m);
    if (err) return { ok: false, err: err };
    var l = all();
    for (var i = 0; i < l.length; i++) {
      if (l[i].m && l[i].m.id === m.id) {
        /* re-instalación: misma id actualiza */
        l[i].m = m;
        if (typeof opts.on !== 'undefined') l[i].on = !!opts.on;
        save(l);
        return { ok: true, skill: l[i], updated: true };
      }
    }
    if (l.length >= MAX_SKILLS) return { ok: false, err: 'ya hay 20 skills: borrá uno primero' };
    var sk = { m: m, on: typeof opts.on === 'undefined' ? true : !!opts.on, ts: Date.now() };
    l.unshift(sk);
    save(l);
    return { ok: true, skill: sk, updated: false };
  }

  function remove(id) {
    var l = all();
    var out = [];
    for (var i = 0; i < l.length; i++) if (!l[i].m || l[i].m.id !== id) out.push(l[i]);
    save(out);
    return l.length !== out.length;
  }

  function setEnabled(id, on) {
    var l = all();
    for (var i = 0; i < l.length; i++) {
      if (l[i].m && l[i].m.id === id) { l[i].on = !!on; save(l); return true; }
    }
    return false;
  }

  function recipeAll() {
    var a = [];
    try { a = JSON.parse(localStorage.getItem(RECIPE_KEY) || '[]'); } catch (e) { a = []; }
    return Array.isArray(a) ? a.filter(function (r) {
      return r && Array.isArray(r.trigger_keywords) && Array.isArray(r.tool_sequence) && typeof r.id === 'string';
    }).slice(0, MAX_RECIPES) : [];
  }
  function recipeKeywords(task) {
    var words = norm(task).split(/[^a-z0-9]+/).filter(function (w) {
      return w.length >= 4 && !RECIPE_STOP.test(w) && !/^\d+$/.test(w);
    });
    var out = [];
    words.forEach(function (w) { if (out.indexOf(w) < 0 && out.length < 6) out.push(w); });
    return out;
  }
  function recordRecipe(task, sequence, validationRule) {
    if (!Array.isArray(sequence) || sequence.length < 3 || sequence.length > 8) return { ok: false, err: 'se requieren 3–8 pasos exitosos' };
    var safeSequence = sequence.map(function (x) { return String(x || ''); });
    if (safeSequence.some(function (x) { return !/^[a-z][a-z0-9_]{1,39}$/.test(x); })) return { ok: false, err: 'secuencia de herramientas inválida' };
    var keywords = recipeKeywords(task);
    if (keywords.length < 2) return { ok: false, err: 'no hay suficientes palabras clave genéricas' };
    var id = 'recipe-' + safeSequence.join('-').slice(0, 24) + '-' + keywords.slice(0, 2).join('-').slice(0, 20);
    var list = recipeAll().filter(function (r) { return r.id !== id; });
    list.unshift({ id: id, trigger_keywords: keywords, tool_sequence: safeSequence, validation_rule: String(validationRule || 'Solo sugerir la secuencia; validar argumentos actuales y confirmar acciones de escritura.' ).slice(0, 180), updated_at: Date.now(), uses: 0 });
    try { localStorage.setItem(RECIPE_KEY, JSON.stringify(list.slice(0, MAX_RECIPES))); return { ok: true, id: id, count: Math.min(list.length, MAX_RECIPES) }; }
    catch (e) { return { ok: false, err: 'no se pudo guardar la receta local' }; }
  }
  function matchRecipe(task) {
    var words = recipeKeywords(task), best = null, bestScore = 0;
    if (words.length < 2) return null;
    recipeAll().forEach(function (r) {
      var hits = r.trigger_keywords.filter(function (w) { return words.indexOf(w) >= 0; }).length;
      var score = hits / Math.max(2, Math.min(words.length, r.trigger_keywords.length));
      if (hits >= 2 && score >= 0.4 && score > bestScore) { best = r; bestScore = score; }
    });
    if (best) return { id: best.id, trigger_keywords: best.trigger_keywords.slice(), tool_sequence: best.tool_sequence.slice(), validation_rule: best.validation_rule, score: bestScore };
    return null;
  }
  function clearRecipes() { try { localStorage.removeItem(RECIPE_KEY); return true; } catch (e) { return false; } }
  function count() { return all().length; }

  /* ---------- ejemplos incorporados ---------- */
  var EXAMPLES = [
    {
      id: 'saludo-ninja', name: 'Saludo ninja', version: 1,
      desc: 'Si decís "modo ninja", Kiu contesta al estilo ninja.',
      intents: ['modo ninja', 'saludo ninja'],
      reply: ['Silencio... Un ninja saluda con la mirada, {nombre}.', 'Presente. Nadie me vio llegar, {nombre}.'],
      tts: false
    },
    {
      id: 'animo-flash', name: 'Ánimo flash', version: 1,
      desc: 'Pedí "dame animo" y Kiu te tira una frase para seguir.',
      intents: ['dame animo', 'animo flash', 'necesito animo'],
      reply: ['Dale {nombre}, que hoy la pelota es tuya.', 'Un paso chico ahora vale más que un plan grande después.', 'Ya estás más cerca de lo que pensás. Seguí.'],
      tts: true
    },
    {
      id: 'estado-express', name: 'Estado express', version: 1,
      desc: '"estado express" = batería y hora en una línea.',
      intents: ['estado express'],
      reply: ['A las {hora}: batería {bateria} ({carga}). Todo bajo control.', '{hora} · batería {bateria} · {carga}. Yo sigo de pie.'],
      tts: false
    }
  ];
  function installExamples() {
    var n = 0;
    for (var i = 0; i < EXAMPLES.length; i++) {
      var r = installFromText(JSON.stringify(EXAMPLES[i]), { on: true });
      if (r.ok && !r.updated) n++;
    }
    return n;
  }
  function hasExamples() {
    var l = all();
    for (var i = 0; i < l.length; i++) {
      if (l[i].m && l[i].m.id === EXAMPLES[0].id) return true;
    }
    return false;
  }

  /* export/import para la copia completa */
  function exportAll() {
    var l = all();
    var out = [];
    for (var i = 0; i < l.length; i++) {
      if (l[i].m && l[i].m.id.indexOf('saludo-ninja') === 0) continue; /* ejemplos no viajan */
      out.push({ m: l[i].m, on: !!l[i].on });
    }
    return out;
  }
  function importAll(list) {
    if (!Object.prototype.toString.call(list) || !Array.isArray(list)) return 0;
    var n = 0;
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (!it || typeof it.m !== 'object') continue;
      var r = installFromText(JSON.stringify(it.m), { on: it.on !== false });
      if (r.ok) n++;
    }
    return n;
  }

  return {
    norm: norm,
    validate: validate,
    all: all,
    match: match,
    run: run,
    installFromText: installFromText,
    installExamples: installExamples,
    hasExamples: hasExamples,
    remove: remove,
    setEnabled: setEnabled,
    count: count,
    recipeAll: recipeAll,
    recordRecipe: recordRecipe,
    matchRecipe: matchRecipe,
    clearRecipes: clearRecipes,
    exportAll: exportAll,
    importAll: importAll,
    EXAMPLES: EXAMPLES
  };
})();
