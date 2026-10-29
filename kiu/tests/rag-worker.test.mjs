/* rag-worker.test.mjs — tanda 8: núcleo RAG compartido + Web Worker.
 * Verifica:
 *   1) KiuRagCore: tokenización (tildes/ñ/stopwords), fragmentación (párrafos,
 *      solapamiento, tope), filas con tf precalculado.
 *   2) score BM25: el doc relevante gana y el resultado es determinista.
 *   3) Protocolo del worker (simulado en una VM con importScripts): sync,
 *      drop, prep y search responden por postMessage con el mismo id.
 *   4) rag.js CON un Worker falso: searchAsync devuelve el MISMO formato que
 *      search() y ctxFor resuelve por el worker; addText usa el op 'prep'.
 *   5) rag.js SIN Worker: searchAsync responde igual (ruta síncrona).
 * node --test tests/rag-worker.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WWW = path.join(HERE, '..', 'app', 'src', 'main', 'assets', 'www');
const CORE_SRC = readFileSync(path.join(WWW, 'js', 'rag-worker.js'), 'utf-8');
const RAG_SRC = readFileSync(path.join(WWW, 'js', 'rag.js'), 'utf-8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* sandbox mínimo: window===global, storage falso, timers reales */
function newSb(opts) {
  opts = opts || {};
  const sb = {};
  sb.window = sb; sb.self = sb; sb.globalThis = sb;
  sb.console = console;
  sb.document = {
    getElementById: () => null,
    createElement: () => ({ style: {}, setAttribute() { } }),
    head: { appendChild() { } },
    addEventListener() { },
  };
  const ls = new Map();
  sb.localStorage = {
    getItem: (k) => (ls.has(k) ? ls.get(k) : null),
    setItem: (k, v) => ls.set(String(k), String(v)),
    removeItem: (k) => ls.delete(k),
    clear: () => ls.clear(),
  };
  sb.location = { href: 'https://appassets.androidplatform.net/assets/index.html', protocol: 'https:' };
  sb.navigator = { userAgent: 'RagWorkerTest/2.7' };
  sb.App = { toast() { } };
  sb.KiuAvatar = { flash() { } };
  sb.FileReader = function () { };
  sb.setTimeout = setTimeout;
  sb.clearTimeout = clearTimeout;
  sb.setInterval = () => 0;
  sb.clearInterval = () => { };
  vm.createContext(sb);
  return sb;
}

/* FakeWorker: puentea el rag-worker.js real en una VM hija, como un worker
 * de verdad pero en el mismo proceso (postMessage async por setTimeout). */
const FakeWorker = function FakeWorker(url) {
  const self = this;
  this.url = url;
  const wsb = {};
  wsb.self = wsb; wsb.globalThis = wsb; wsb.window = wsb;
  wsb.console = console;
  wsb.importScripts = function () { };
  wsb.postMessage = function (m) {
    setTimeout(function () { if (typeof self.onmessage === 'function') self.onmessage({ data: m }); }, 0);
  };
  vm.createContext(wsb);
  vm.runInContext(CORE_SRC, wsb, { filename: 'js/rag-worker.js' });
  this._wsb = wsb;
  this.onerror = null;
  this.onmessage = null;
};
FakeWorker.prototype.postMessage = function (m) {
  const wsb = this._wsb;
  setTimeout(function () { if (typeof wsb.onmessage === 'function') wsb.onmessage({ data: m }); }, 0);
};
FakeWorker.prototype.terminate = function () { };

function loadCore(sb) {
  vm.runInContext(CORE_SRC, sb, { filename: 'js/rag-worker.js' });
}

/* ---------- 1) núcleo ---------- */
test('núcleo: tok saca stopwords y tildes, conserva ñ', () => {
  const sb = newSb();
  loadCore(sb);
  const toks = vm.runInContext('KiuRagCore.tok("El Período de la Recolección en Ñuble fue rápido")', sb);
  assert.ok(toks.join('|').indexOf('nuble') >= 0, 'ñ → nuble normalizado: ' + toks.join('|'));
  assert.equal(toks.indexOf('el'), -1, 'stopword fuera');
  assert.equal(toks.indexOf('de'), -1, 'stopword fuera');
  assert.ok(toks.join('|').indexOf('recoleccion') >= 0, 'sin tildes');
});

test('núcleo: chunk parte por párrafos, con solapamiento y tope', () => {
  const sb = newSb();
  loadCore(sb);
  const res = vm.runInContext(`
    var paras = [];
    for (var i = 0; i < 40; i++) paras.push('Parrafo numero ' + i + ' con texto suficiente para contar como contenido util del documento grande.');
    var parts = KiuRagCore.chunk(paras.join('\\n\\n'));
    JSON.stringify({ n: parts.length, sizes: parts.map(function (p) { return p.length; }) });
  `, sb);
  const o = JSON.parse(res);
  assert.ok(o.n >= 2, 'fragmenta en varias partes: ' + o.n);
  assert.ok(o.n <= 800, 'tope MAXC respetado');
  const empty = vm.runInContext('KiuRagCore.chunk("corto")', sb);
  assert.equal(empty.length, 0, 'texto muy corto → sin fragmentos');
});

test('núcleo: chunk semántico conserva el encabezado para recuperar el tema', () => {
  const sb = newSb();
  loadCore(sb);
  const input = '# Instalación de Ollama\n\nDescarga el binario, configura el servicio y comprueba que el servidor responde correctamente.\n\n# Copias de seguridad\n\nGuarda una copia en una ubicación externa y verifica que se pueda restaurar.';
  const chunks = vm.runInContext('KiuRagCore.chunk(' + JSON.stringify(input) + ')', sb);
  assert.ok(chunks.length >= 2, 'separar secciones temáticas');
  assert.match(chunks[0], /Instalación de Ollama/, 'el encabezado se conserva dentro del fragmento');
  assert.match(chunks[1], /Copias de seguridad/, 'la segunda sección mantiene su propio encabezado');
  const rows = vm.runInContext('KiuRagCore.mkRows("doc", ' + JSON.stringify(chunks) + ')', sb);
  const d = JSON.parse(vm.runInContext('JSON.stringify(KiuRagCore.dfOf(' + JSON.stringify(rows) + '))', sb));
  const ranked = vm.runInContext('KiuRagCore.score("copias de seguridad", ' + JSON.stringify(rows) + ', ' + JSON.stringify(d.df) + ', ' + d.N + ', ' + d.len + ', 1)', sb);
  assert.equal(ranked[0].key, rows[1].key, 'una consulta por el encabezado recupera la sección correcta');
});

test('núcleo: mkRows precalcula tf y len por fragmento', () => {
  const sb = newSb();
  loadCore(sb);
  const rows = vm.runInContext('KiuRagCore.mkRows("dX", ["El flan lleva huevo y huevo, leche", "segundo fragmento de prueba"])', sb);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].key, 'dX#0');
  assert.equal(rows[0].tf.huevo, 2, 'tf contada una sola vez');
  assert.ok(rows[0].len > 0 && rows[0].text.length > 0);
});

/* ---------- 2) BM25 ---------- */
test('score: el doc relevante gana y el resultado es determinista', () => {
  const sb = newSb();
  loadCore(sb);
  const script = `
    var rows = KiuRagCore.mkRows('a', ['Para instalar ollama en el servidor descargá el binario y corré ollama serve.'])
      .concat(KiuRagCore.mkRows('b', ['El flan se cocina a baño maría con huevo, leche y azúcar.']));
    var d = KiuRagCore.dfOf(rows);
    var r1 = KiuRagCore.score('instalar ollama en el servidor', rows, d.df, d.N, d.len, 1);
    var r2 = KiuRagCore.score('instalar ollama en el servidor', rows, d.df, d.N, d.len, 1);
    JSON.stringify({ top: r1[0] && r1[0].key, same: JSON.stringify(r1) === JSON.stringify(r2) });
  `;
  const o = JSON.parse(vm.runInContext(script, sb));
  assert.equal(o.top, 'a#0', 'gana el doc del servidor');
  assert.equal(o.same, true, 'determinista');
});

/* ---------- 3) protocolo del worker ---------- */
function fakeWorkerSb() {
  const sb = newSb();
  sb.importScripts = function () { };
  const inbox = [];
  sb.postMessage = (m) => inbox.push(m);
  vm.runInContext(CORE_SRC, sb, { filename: 'js/rag-worker.js' });
  return { sb, inbox };
}

test('worker: prep fragmenta texto y sync+search responden con el mismo id', async () => {
  const w = fakeWorkerSb();
  assert.ok(w.sb.onmessage, 'worker debe registrar onmessage');
  // prep
  w.sb.onmessage({ data: { id: 'p1', op: 'prep', docId: 'd9', text: 'Documento de prueba con suficiente contenido para ser fragmentado por el nucleo del RAG de Kiu.' } });
  await sleep(5);
  assert.equal(w.inbox.length, 1);
  let m = w.inbox.shift();
  assert.equal(m.id, 'p1');
  assert.equal(m.ok, true);
  assert.ok(m.rows.length >= 1, 'prep devuelve rows');
  assert.ok(m.bytes > 0, 'prep devuelve bytes');
  // sync con filas SIN texto (como manda rag.js)
  const slim = JSON.parse(JSON.stringify(m.rows)).map((r) => ({ key: r.key, doc: r.doc, ci: r.ci, tf: r.tf, len: r.len }));
  w.sb.onmessage({ data: { id: 's1', op: 'sync', rows: slim } });
  w.sb.onmessage({ data: { id: 'q1', op: 'search', q: 'contenido del nucleo', k: 2 } });
  await sleep(5);
  m = w.inbox.shift();
  assert.equal(m.id, 's1'); assert.equal(m.ok, true); assert.equal(m.n, slim.length);
  m = w.inbox.shift();
  assert.equal(m.id, 'q1');
  assert.ok(Array.isArray(m.hits) && m.hits.length >= 1, 'search responde hits');
  assert.ok(String(m.hits[0].key).indexOf('d9#') === 0, 'hit del doc sincronizado');
  // drop
  w.sb.onmessage({ data: { id: 'd2', op: 'drop', docId: 'd9' } });
  w.sb.onmessage({ data: { id: 'q2', op: 'search', q: 'contenido del nucleo', k: 2 } });
  await sleep(5);
  m = w.inbox.shift(); assert.equal(m.id, 'd2'); assert.equal(m.n, 0);
  m = w.inbox.shift(); assert.equal(m.id, 'q2'); assert.equal(m.hits.length, 0, 'tras drop no hay hits');
});

test('worker: op desconocida responde ok:false sin colgar', async () => {
  const w = fakeWorkerSb();
  w.sb.onmessage({ data: { id: 'x1', op: 'noExiste' } });
  await sleep(5);
  const m = w.inbox[0];
  assert.equal(m.ok, false, 'responde error controlado');
  assert.equal(m.id, 'x1');
});

/* ---------- 4) rag.js con Worker falso ---------- */
test('rag.js + Worker: searchAsync ≡ search y addText usa el worker (op prep)', async () => {
  const sb = newSb();
  sb.Worker = FakeWorker;
  loadCore(sb);
  vm.runInContext(RAG_SRC, sb, { filename: 'js/rag.js' });
  await sleep(20);
  const r = sb.RAG;
  assert.ok(r.stats().worker, 'worker activo');
  r.addText('servidor', 'txt', 'Para instalar ollama en el servidor descargá el binario y corré ollama serve. El puerto por defecto es 11434 y responde en localhost.', function (e) { assert.ifError(e); });
  await sleep(30);
  assert.equal(r.docs.length, 1, 'doc agregado vía op prep del worker');
  r.on = true;
  const sync = r.search('instalar ollama en el servidor', 1);
  let async = 'PENDIENTE';
  r.searchAsync('instalar ollama en el servidor', 1, function (v) { async = v; });
  await sleep(30);
  assert.ok(async !== 'PENDIENTE', 'searchAsync respondió');
  assert.equal(async, sync, 'mismo formato que search');
  assert.ok(async && async.indexOf('[servidor') === 0);
  // ctxFor delega en searchAsync
  let ctx = 'PENDIENTE';
  r.ctxFor('puerto 11434 de ollama', 1, function (v) { ctx = v; });
  await sleep(30);
  assert.ok(ctx && ctx.indexOf('[servidor') === 0, 'ctxFor responde formato prompt');
});

test('rag.js + Worker: ctxFor con RAG apagado responde null al toque', async () => {
  const sb = newSb();
  sb.Worker = FakeWorker;
  loadCore(sb);
  vm.runInContext(RAG_SRC, sb, { filename: 'js/rag.js' });
  await sleep(10);
  let out = 'PENDIENTE';
  sb.RAG.ctxFor('lo que sea', 1, function (v) { out = v; });
  assert.equal(out, null, 'sin docs → null inmediato');
});

/* ---------- 5) rag.js sin Worker ---------- */
test('rag.js sin Worker: searchAsync responde síncrono igual a search', async () => {
  const sb = newSb(); // sin sb.Worker
  loadCore(sb);
  vm.runInContext(RAG_SRC, sb, { filename: 'js/rag.js' });
  await sleep(10);
  const r = sb.RAG;
  assert.equal(r.stats().worker, false, 'sin worker');
  r.addText('notas', 'txt', 'La reunión del equipo es el jueves a las nueve en la sala grande del edificio.', function (e) { assert.ifError(e); });
  await sleep(10);
  r.on = true;
  const sync = r.search('reunion del equipo el jueves', 1);
  let async = 'PENDIENTE';
  r.searchAsync('reunion del equipo el jueves', 1, function (v) { async = v; });
  assert.equal(async, sync, 'fallback síncrono al toque');
  assert.ok(async && async.indexOf('[notas') === 0);
});
