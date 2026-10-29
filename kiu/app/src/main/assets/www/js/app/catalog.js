/* app/catalog.js — módulo de app.js (tanda 4 · sección 3-a). catálogo de modelos verificados + clasificación (texto/visión/mmproj).
 * Cargado como script clásico en orden por index.html; los símbolos
 * compartidos viven en window para que los módulos se lean entre sí
 * igual que dentro del app.js original. */
(function () {
  'use strict';

  /* ================= v1.7.0: CATÁLOGO DE MODELOS (URLs y tamaños verificados) ================= */
  var MODCAT = [
    { n: 'Qwen 2.5 · 0.5B · veloz', f: 'qwen2.5-0.5b-instruct-q4_k_m.gguf', gb: 0.5, r: 1.6, eng: 'kiu', fam: 'qwen', u: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf', d: 'Chiquito y rapidísimo: ideal para el motor interno del teléfono', sha: '74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db' },
    { n: 'SmolLM2 · 360M · volador', f: 'smollm2-360m-instruct-q8_0.gguf', gb: 0.4, r: 1.3, eng: 'kiu', fam: 'qwen', u: 'https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct-GGUF/resolve/main/smollm2-360m-instruct-q8_0.gguf', d: 'El más rápido del catálogo: carga en segundos hasta en teléfonos humildes', sha: '48ab3034d0dd401fbc721eb1df3217902fee7dab9078992d66431f09b7750201' },
    { n: 'Qwen3 · 0.6B · veloz', f: 'Qwen_Qwen3-0.6B-Q4_K_M.gguf', gb: 0.5, r: 1.7, eng: 'kiu', fam: 'qwen', u: 'https://huggingface.co/bartowski/Qwen_Qwen3-0.6B-GGUF/resolve/main/Qwen_Qwen3-0.6B-Q4_K_M.gguf', d: 'Nueva generación, muy equilibrado para su tamaño', sha: '9acfc1e001311f34b4252001b626f2e466d592a42065f66571bff3790d4e1b14' },
    { n: 'Llama 3.2 · 1B · chat', f: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf', gb: 0.8, r: 2.4, eng: 'kiu', fam: 'llama', u: 'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf', d: 'El clásico de Meta: conversación natural', sha: '6f85a640a97cf2bf5b8e764087b1e83da0fdb51d7c9fab7d0fece9385611df83' },
    { n: 'Qwen2.5-Coder · 1.5B · código', f: 'qwen2.5-coder-1.5b-instruct-q4_k_m.gguf', gb: 1.0, r: 3.0, eng: 'kiu', fam: 'qwen', u: 'https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF/resolve/main/qwen2.5-coder-1.5b-instruct-q4_k_m.gguf', d: 'Especialista en programación: ideal como cerebro para código', sha: 'cc324af070c2ecbfd324a30884d2f951a7ff756aba85cb811a6ec436933bb046' },
    { n: 'Qwen3 · 1.7B · completo', f: 'Qwen_Qwen3-1.7B-Q4_K_M.gguf', gb: 1.2, r: 3.3, eng: 'kiu', fam: 'qwen', u: 'https://huggingface.co/bartowski/Qwen_Qwen3-1.7B-GGUF/resolve/main/Qwen_Qwen3-1.7B-Q4_K_M.gguf', d: 'La mejor calidad que corre cómoda dentro del teléfono', sha: '72c5c3cb38fa32d5256e2fe30d03e7a64c6c79e668ad84057e3bd66e250b24fb' },
    { n: 'DeepSeek-R1 · 1.5B · razona', f: 'DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M.gguf', gb: 1.1, r: 3.2, eng: 'kiu', fam: 'qwen', u: 'https://huggingface.co/unsloth/DeepSeek-R1-Distill-Qwen-1.5B-GGUF/resolve/main/DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M.gguf', d: 'Piensa paso a paso antes de contestar', sha: 'f3bdf9cf31dee4b57ae4e455a1cb0d01b5c2c1b50d72d3112141c195506c2840' },
    { n: 'Qwen3 · 4B · teléfono con RAM', f: 'Qwen3-4B-Q4_K_M.gguf', gb: 2.5, r: 4.4, eng: 'kiu', fam: 'qwen', u: 'https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf', d: 'Solo para teléfonos con 6 GB de RAM o más: calidad de PC en tu bolsillo', sha: '7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5' },
    { n: 'Llama 3.1 · 8B · grande', f: 'Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf', gb: 4.9, r: 8.2, eng: 'kiu', fam: 'llama', u: 'https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf', d: '8B reales en tu teléfono: con mmap se sirve desde el almacenamiento. Necesita 8 GB de RAM libres', sha: '7b064f5842bf9532c91456deda288a1b672397a54fa729aa665952863033557c' },
    { n: 'Qwen3 · 8B · grande', f: 'Qwen3-8B-Q4_K_M.gguf', gb: 5.0, r: 8.3, eng: 'kiu', fam: 'qwen', u: 'https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q4_K_M.gguf', d: '8B de nueva generación, razona muy bien. Carga con mmap (offload a almacenamiento): recomendado 8 GB de RAM o GPU', sha: 'd98cdcbd03e17ce47681435b5150e34c1417f50b5c0019dd560e4882c5745785' },
    { n: 'Qwen3-30B-A3B · MoE · experto', f: 'Qwen_Qwen3-30B-A3B-Instruct-2507-Q4_K_M.gguf', gb: 18.6, r: 22, eng: 'kiu', fam: 'qwen', moe: true, u: 'https://huggingface.co/bartowski/Qwen_Qwen3-30B-A3B-Instruct-2507-GGUF/resolve/main/Qwen_Qwen3-30B-A3B-Instruct-2507-Q4_K_M.gguf', d: 'MoE: 30B de conocimiento, solo 3B activos por respuesta (rápido para su tamaño). Requiere 24 GB de RAM o PC. Con mmap corre desde el almacenamiento', sha: '382b4f5a164d200f93790ee0e339fae12852896d23485cfb203ce868fea33a95' },
    { n: 'Llama 3.2 · 3B · servidor', f: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf', gb: 2.0, r: 4.2, eng: 'server', fam: 'llama', u: 'https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf', d: 'Para tu PC o servidor local (no corre dentro del teléfono)', sha: '6c1a2b41161032677be168d354123594c0e6e67d2b9227c84f296ad037c728ff' },
    { n: 'MiniCPM-V 2.6 · visión', vis: true, f: 'ggml-model-IQ4_XS.gguf', gb: 4.0, r: 6.5, eng: 'server', fam: 'qwen', u: 'https://huggingface.co/openbmb/MiniCPM-V-2_6-gguf/resolve/main/ggml-model-IQ4_XS.gguf', d: 'Modelo de visión multimodal para tu servidor (mirá la Guía para el mmproj)', sha: 'ba1e23aa5470520c8c920d7944479133af9ae091a23653529be4348f77ba1e18' }
  ];
  /* Perfiles de formato para modelos Hermes ya importados. No se publican como
     descargas: aquí no hay URL/hash de artefacto verificados, así que no se inventan. */
  var HERMES_PROFILES = [
    { id: 'nous-hermes-2-pro', match: /nous[-_ ]?hermes[-_ ]?2[-_ ]?pro/i, name: 'Nous-Hermes-2-Pro-Llama-3-8B', format: 'hermes2-tool-call', grammar: true },
    { id: 'hermes-2-theta', match: /hermes[-_ ]?2[-_ ]?theta/i, name: 'Hermes-2-Theta', format: 'hermes2-tool-call', grammar: true }
  ];
  function hermesProfile(name) {
    var n = String(name || '');
    for (var i = 0; i < HERMES_PROFILES.length; i++) if (HERMES_PROFILES[i].match.test(n)) return HERMES_PROFILES[i];
    return /hermes/i.test(n) ? { id: 'hermes-generic', name: n, format: 'hermes2-tool-call', grammar: true } : null;
  }
  function guessFam(n) {
    n = String(n || '').toLowerCase();
    if (n.indexOf('hermes') >= 0) return 'hermes';
    if (n.indexOf('llama') >= 0) return 'llama';
    if (n.indexOf('gemma') >= 0) return 'gemma';
    if (/mistral|mixtral/.test(n)) return 'mistral';
    return 'qwen';
  }
  /* v1.7.3: clasifica un modelo como texto / visión / mmproj (complemento de visión) */
  var VIS_RX = /(qwen[\w.\-]*vl|[-_.]vl[-_.]|vision|llava|minicpm-?v|moondream|pixtral|internvl|smolvlm|paligemma|mllama|idefics|molmo|glm-?4v)/i;
  function modKind(name) {
    try { if (S.dl && S.dl.kind && S.dl.kind[name]) return S.dl.kind[name]; } catch (e) { }
    if (/mmproj/i.test(name)) return 'mmproj';
    for (var i = 0; i < MODCAT.length; i++) if (MODCAT[i].f === name) return MODCAT[i].vis ? 'vision' : 'text';
    return VIS_RX.test(name) ? 'vision' : 'text';
  }
  function groupRows(rows, kinds) {
    var g = { text: [], vision: [], mmproj: [] };
    for (var i = 0; i < rows.length; i++) (g[kinds[i]] || g.text).push(rows[i]);
    var hd = function (t, n, h) { return '<p class="set-hint small" style="margin:12px 0 4px"><b>' + t + '</b> · ' + n + (h ? ' · ' + h : '') + '</p>'; };
    var out = '';
    if (g.text.length) out += hd('Modelos de texto', g.text.length, '') + g.text.join('');
    if (g.vision.length) out += hd('Modelos de visión', g.vision.length, 'entienden fotos (con servidor)') + g.vision.join('');
    if (g.mmproj.length) out += hd('Complementos de visión (mmproj)', g.mmproj.length, 'van junto a un modelo de visión') + g.mmproj.join('');
    return out;
  }
  function modCatByFile(name) {
    for (var i = 0; i < MODCAT.length; i++) if (MODCAT[i].f === name) return MODCAT[i];
    /* v1.7.2: modelos importados por el usuario (no están en el catálogo) */
    if (name && /\.gguf$/i.test(name) && !/mmproj/i.test(name) && typeof S !== 'undefined' && S.dl && S.dl.done && S.dl.done[name]) {
      var gb = ((S.dl.done[name].b) || 0) / 1073741824;
      return { n: name.replace(/\.gguf$/i, ''), f: name, gb: gb, r: gb * 1.5 + 1.0, eng: 'kiu', fam: guessFam(name), imp: true, d: 'Importado por vos' };
    }
    return null;
  }
  /* v2.0: nombre amigable — del catálogo usa los 2 primeros tramos; si no, limpia el archivo */
  function prettyName(f) {
    var c = (typeof modCatByFile === 'function') ? modCatByFile(f) : null;
    if (c && !c.imp) {
      var seg = c.n.split('·');
      return (seg.length >= 2 ? seg[0].trim() + ' · ' + seg[1].trim() : c.n).trim();
    }
    var b = String(f).replace(/\.gguf$/i, '').replace(/[-_]+/g, ' ');
    b = b.replace(/\b(i?q\d+\s?_?\s?(?:k\s?[ms]|0|xs|xl|km|ks|s|m|l))\b/gi, '');
    b = b.replace(/\b(instr|instruct|chat|ggml|model|final|merge|fixed)\b/gi, '');
    b = b.replace(/\s+/g, ' ').trim();
    b = b.replace(/(^|\s|\.)([a-zà-ÿ])/g, function (m1, m2, m3) { return m2 + m3.toUpperCase(); });
    b = b.replace(/(\d)\s+b\b/g, '$1B');
    return b || String(f).replace(/\.gguf$/i, '');
  }


  /* v2.11.0 · RECOMENDADOR SEGÚN EL TELÉFONO. Puro: recibe lo que informa sysInfo() y devuelve
     qué conviene bajar. Mismo criterio que «Entra ✓» en Modelos (RAM del modelo <= RAM total - 1).
     Texto: corre en el motor interno de Kiu. Visión: el motor interno solo lee texto, así que
     las fotos van por Ollama en el teléfono (Termux), un servidor en la PC o la nube. */
  function recomendar(dev, opts) {
    dev = dev || {}; opts = opts || {};
    var G = 1073741824;
    var ram = dev.ramTotal ? dev.ramTotal / G : (dev.ramApprox || 0);
    var disk = dev.diskFree ? dev.diskFree / G : 0;
    var cores = dev.cores || 0;
    var done = opts.done || {};
    var out = { unknown: !ram, ram: ram, disk: disk, cores: cores, model: dev.model || '', tier: '',
      text: [], extras: [], vision: { phone: null, pc: [] }, notes: [] };
    if (!ram) return out;
    out.tier = ram < 4 ? 'baja' : ram < 8 ? 'media' : 'alta';
    var cap = ram - 1;
    /* velocidad medida en ESTE teléfono: si un modelo anduvo lento, no se proponen los de su tamaño ni mayores */
    var bench = opts.bench || {}, slowR = 0;
    out.measured = [];
    MODCAT.forEach(function (c) {
      var m = bench[c.f];
      if (m && m.tps > 0) {
        out.measured.push({ c: c, tps: m.tps });
        if (m.tps < 4 && (!slowR || c.r < slowR)) slowR = c.r;
      }
    });
    if (slowR) {
      cap = Math.min(cap, slowR - 0.01);
      out.notes.push('Mediste poca velocidad con un modelo de ~' + String(slowR).replace('.', ',') + ' GB de RAM: por eso propongo solo modelos más chicos.');
    }
    if (dev.temp && dev.temp >= 42) out.notes.push('El teléfono está caliente (' + Math.round(dev.temp) + ' °C): esperá a que se enfríe antes de bajar o cargar un modelo grande.');
    if (dev.bat && dev.bat < 15 && !dev.charging) out.notes.push('Batería al ' + dev.bat + '% sin cargar: conectalo antes de bajar un modelo.');
    if (cores && cores <= 4) {
      cap = Math.min(cap, 3.5);
      out.notes.push('Tu teléfono tiene pocos núcleos (' + cores + '): te recomiendo modelos chicos para que respondan ágil.');
    }
    var diskOk = function (c) { return !disk || c.gb * 1.15 <= disk; };
    var local = MODCAT.filter(function (c) { return c.eng === 'kiu' && !c.vis && !c.moe; });
    var gen = local.filter(function (c) { return !/coder|deepseek/i.test(c.n); });
    var fit = gen.filter(function (c) { return c.r <= cap; });
    var list = fit.filter(diskOk).sort(function (a, b) { return b.r - a.r; });
    if (fit.length && !list.length) out.notes.push('Te queda poco espacio libre (' + disk.toFixed(1).replace('.', ',') + ' GB): liberá espacio para bajar un modelo.');
    var q = list[0] || null;
    var b = null, f = null, i;
    for (i = 0; i < list.length; i++) { if (list[i] !== q && list[i].r <= Math.max(2.4, cap * 0.6)) { b = list[i]; break; } }
    for (i = 0; i < list.length; i++) { if (list[i] !== q && list[i] !== b && list[i].gb <= 1.0) { f = list[i]; break; } }
    var add = function (k, c, why) { if (c) out.text.push({ k: k, c: c, why: why, done: !!done[c.f] }); };
    add('quality', q, 'la mejor calidad que entra cómoda en tu RAM');
    add('balanced', b, 'equilibrio entre calidad y velocidad');
    add('fast', f, 'responde casi al instante');
    local.forEach(function (c) {
      if (/coder|cód/i.test(c.n) && c.r <= cap && diskOk(c)) out.extras.push({ k: 'code', c: c, why: 'especializado en programar', done: !!done[c.f] });
      if (/deepseek/i.test(c.n) && c.r <= cap && diskOk(c)) out.extras.push({ k: 'reason', c: c, why: 'razona paso a paso', done: !!done[c.f] });
    });
    var vis = (opts.vis || []).filter(function (c) { return c.g === 'Visión'; }).sort(function (a, b2) { return a.r - b2.r; });
    var vp = vis.filter(function (c) { return c.r <= cap - 0.5; });
    out.vision.phone = vp.length ? vp[vp.length - 1] : null;
    out.vision.pc = vis;
    if (!out.vision.phone) out.notes.push('Con ' + Math.round(ram) + ' GB de RAM las fotos conviene analizarlas con un servidor en tu PC o un proveedor en la nube.');
    return out;
  }

  /* exports del módulo (cross-módulo vía window) */
  /* v2.11.0 · velocidad real (tokens/s) por modelo, medida en este teléfono. Se promedia con
     la medición anterior para que una sola prueba mala no condene a un modelo. */
  function benchRec(file, tps) {
    if (!file || !(tps > 0)) return;
    try {
      S.bench = S.bench || {};
      var prev = S.bench[file];
      var v = (prev && prev.tps) ? (prev.tps * 0.5 + tps * 0.5) : tps;
      S.bench[file] = { tps: Math.round(v * 10) / 10, ts: Date.now() };
      if (typeof saveS === 'function') saveS();
    } catch (e) { }
  }
  window.KiuBench = { rec: benchRec };
  window.KiuReco = { plan: recomendar };
  window.MODCAT = MODCAT;
  window.HERMES_PROFILES = HERMES_PROFILES;
  window.hermesProfile = hermesProfile;
  window.guessFam = guessFam;
  window.VIS_RX = VIS_RX;
  window.modKind = modKind;
  window.groupRows = groupRows;
  window.modCatByFile = modCatByFile;
  window.prettyName = prettyName;
})();
