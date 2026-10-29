/* KIU local embedding adapter v1.
 * No model is bundled here. A real on-device runtime can register a provider
 * with embed(text) -> Promise<number[]>; until then the current RAG remains the
 * default. This prevents claiming neural semantics when no model is installed.
 */
(function (g) {
  'use strict';
  var provider = null;
  var cache = typeof WeakMap === 'function' ? new WeakMap() : null;
  var hits = 0, misses = 0;

  // Proveedor neuronal nativo: usa el modelo GGUF que ya está cargado por KIU.
  // No carga otro modelo ni realiza peticiones de red. Los modelos de chat no
  // están afinados para embeddings, así que se considera experimental y el RAG
  // híbrido tradicional sigue siendo la ruta de respaldo.
  function nativeProvider() {
    if (typeof window === 'undefined' || !window.KiuBridge || typeof window.KiuBridge.embedLocalText !== 'function') return null;
    return {
      name: 'kiu-native-hidden-state',
      get ready() { try { return !!window.KiuBridge.kiuLoaded && window.KiuBridge.kiuLoaded(); } catch (_) { return false; } },
      embed: function (text) {
        var raw = window.KiuBridge.embedLocalText(String(text || ''));
        if (!raw) throw new Error('El motor local no devolvió embeddings');
        var vector = JSON.parse(raw);
        if (!Array.isArray(vector) || !vector.length) throw new Error('Embedding nativo inválido');
        return vector;
      }
    };
  }
  try { var np = nativeProvider(); if (np) provider = np; } catch (_) {}

  function isReady() {
    try { return !!(provider && typeof provider.embed === 'function' && provider.ready !== false); }
    catch (_) { return false; }
  }
  function register(next) {
    if (!next || typeof next.embed !== 'function') throw new Error('El proveedor debe implementar embed(text)');
    provider = next;
    cache = typeof WeakMap === 'function' ? new WeakMap() : null;
    hits = 0; misses = 0;
    return true;
  }
  function embed(text) {
    if (!isReady()) return Promise.reject(new Error('No hay un modelo local de embeddings instalado'));
    return Promise.resolve(provider.embed(String(text || ''))).then(function (v) {
      if (!Array.isArray(v) && !(v && typeof v.length === 'number')) throw new Error('Vector de embedding inválido');
      var out = Array.prototype.slice.call(v).map(Number);
      if (!out.length || out.some(function (n) { return !isFinite(n); })) throw new Error('Vector de embedding vacío o no numérico');
      return out;
    });
  }
  function cosine(a, b) {
    if (!a || !b || a.length !== b.length || !a.length) return 0;
    var dot = 0, aa = 0, bb = 0;
    for (var i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
    return aa && bb ? dot / (Math.sqrt(aa) * Math.sqrt(bb)) : 0;
  }
  function rowVector(row) {
    if (cache && cache.has(row)) { hits++; return Promise.resolve(cache.get(row)); }
    misses++;
    return embed(row.text || '').then(function (v) { if (cache) cache.set(row, v); return v; });
  }
  function rank(query, rows, core, k) {
    if (!isReady()) return Promise.reject(new Error('Embeddings no disponibles'));
    rows = rows || [];
    var lex = core && core.score ? core.score(query, rows, (core.dfOf(rows)).df, rows.length, rows.reduce(function (n, r) { return n + (r.len || 0); }, 0), rows.length) : [];
    // Reranking neuronal acotado: evita ejecutar el modelo local cientos de veces
    // en el primer uso. BM25 propone hasta 24 candidatos; el vector decide el orden.
    var byKey = {}, candidates = [];
    for (var ri = 0; ri < rows.length; ri++) byKey[rows[ri].key] = rows[ri];
    for (var li = 0; li < lex.length && candidates.length < 24; li++) if (byKey[lex[li].key]) candidates.push(byKey[lex[li].key]);
    if (!candidates.length) candidates = rows.slice(0, 24);
    return Promise.all([embed(query), Promise.all(candidates.map(function (r) { return rowVector(r); }))]).then(function (pair) {
      var qv = pair[0], vectors = pair[1], sem = [];
      for (var i = 0; i < candidates.length; i++) {
        var sim = cosine(qv, vectors[i]);
        if (sim > 0) sem.push({ key: candidates[i].key, s: sim });
      }
      sem.sort(function (a, b) { return b.s - a.s; });
      var fused = {}, i;
      for (i = 0; i < sem.length; i++) fused[sem[i].key] = (fused[sem[i].key] || 0) + 1 / (60 + i + 1);
      for (i = 0; i < lex.length; i++) fused[lex[i].key] = (fused[lex[i].key] || 0) + 1 / (60 + i + 1);
      return Object.keys(fused).map(function (key) { return { key: key, s: fused[key] }; }).sort(function (a, b) { return b.s - a.s; }).slice(0, k || 3);
    });
  }
  function stats() { return { ready: isReady(), cache: !!cache, cacheHits: hits, cacheMisses: misses, provider: provider && provider.name || null }; }
  g.KiuLocalEmbeddings = { isReady: isReady, register: register, embed: embed, cosine: cosine, rank: rank, stats: stats };
})(typeof window !== 'undefined' ? window : self);
