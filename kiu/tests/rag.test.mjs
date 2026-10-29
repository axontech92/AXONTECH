/* rag.test.mjs — tanda 4 (sección 3-b): RAG v3 sobre IndexedDB + BM25.
 * Usa un shim de IndexedDB en memoria (eventos por microtarea) para probar:
 *   1) migración única del 'nexo_rag' viejo de localStorage hacia IDB,
 *   2) persistencia real entre "arranques" (misma base, sandbox nuevo),
 *   3) ranking BM25 (el doc relevante gana),
 *   4) tope de capacidad (~8 MB) con mensaje claro,
 *   5) exportAll/importAll (copia de seguridad SAF),
 *   6) del borra los chunks del doc en IDB,
 *   7) el interruptor on/off persiste entre boots,
 *   8) modo localStorage sin IDB sigue funcionando (WebView viejo).
 * node --test tests/rag.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WWW = path.join(HERE, '..', 'app', 'src', 'main', 'assets', 'www');
const RAG_SRC = readFileSync(path.join(WWW, 'js', 'rag.js'), 'utf-8');
const CORE_SRC = readFileSync(path.join(WWW, 'js', 'rag-worker.js'), 'utf-8');

/* ---------- shim de IndexedDB en memoria (persistente entre sandboxes) ---------- */
const IDB_SHIM = `
function makeIDB(state) {
  function keyOf(rec) { return rec.key !== undefined ? rec.key : (rec.id !== undefined ? rec.id : rec.k); }
  function mkReq(v) { var r = { onsuccess: null, onerror: null, result: v }; Promise.resolve().then(function () { if (r.onsuccess) r.onsuccess({ target: r }); }); return r; }
  function mkStore(m, tx) {
    return {
      put: function (rec) { m.set(keyOf(rec), rec); return {}; },
      get: function (k) { return mkReq(m.get(k)); },
      getAll: function () { return mkReq(Array.from(m.values())); },
      delete: function (k) { m.delete(k); return {}; },
      clear: function () { m.clear(); return {}; },
      count: function () { return m.size; },
      openCursor: function (range) {
        var keys = Array.from(m.keys()).filter(function (k) {
          if (!range) return true;
          var ge = range.lower === undefined ? true : (k >= range.lower && (range.lowerOpen ? k > range.lower : true));
          var le = range.upper === undefined ? true : (k <= range.upper && (range.upperOpen ? k < range.upper : true));
          return ge && le;
        });
        var i = 0;
        var req = { onsuccess: null, onerror: null };
        var cur = {
          get value() { return i < keys.length ? m.get(keys[i]) : null; },
          delete: function () { if (i < keys.length) m.delete(keys[i]); },
          continue: function () {
            i++;
            Promise.resolve().then(function () { if (req.onsuccess) req.onsuccess({ target: req }); });
          },
        };
        // en IDB real, request.result es el cursor mientras haya entradas y null al agotarse
        Object.defineProperty(req, 'result', {
          get: function () { return i < keys.length ? cur : null; },
        });
        Promise.resolve().then(function () { if (req.onsuccess) req.onsuccess({ target: req }); });
        return req;
      },
    };
  }
  return {
    open: function (name, ver) {
      var req = { onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null, result: null };
      var stores = state[name] || (state[name] = { docs: new Map(), chunks: new Map(), meta: new Map() });
      var theDb = {
        objectStoreNames: { contains: function (n) { return !!stores[n]; } },
        close: function () { },
        createObjectStore: function (n) { if (!stores[n]) stores[n] = new Map(); return {}; },
        transaction: function (names, mode) {
          var tx = { error: null, onerror: null, oncomplete: null, onabort: null, _stores: {} };
          tx.objectStore = function (n) { if (!tx._stores[n]) tx._stores[n] = mkStore(stores[n], tx); return tx._stores[n]; };
          Promise.resolve().then(function () { if (tx.oncomplete) tx.oncomplete(); });
          return tx;
        },
      };
      Promise.resolve().then(function () { req.result = theDb; if (req.onsuccess) req.onsuccess({ target: req }); });
      return req;
    },
  };
}
function fakeClassListX() {
  var s = new Set();
  return { add: function () { }, remove: function () { }, toggle: function () { }, contains: function () { return false; } };
}
`;

/* ---------- sandbox mínimo con document/localStorage falsos ---------- */
function newSandbox(idbState, lsMap, opts) {
  opts = opts || {};
  const sb = {};
  sb.window = sb;
  sb.globalThis = sb;
  sb.console = console;
  sb.document = {
    getElementById: () => (opts.noCard ? null : { addEventListener() { }, querySelectorAll: () => [], innerHTML: '', style: {} }),
    createElement: () => ({ addEventListener() { }, appendChild() { }, set onload(v) { }, set onerror(v) { }, style: {} }),
    head: { appendChild() { } },
    addEventListener() { },
  };
  sb.localStorage = {
    _m: lsMap,
    getItem(k) { return lsMap.has(k) ? lsMap.get(k) : null; },
    setItem(k, v) { lsMap.set(String(k), String(v)); },
    removeItem(k) { lsMap.delete(k); },
    clear() { lsMap.clear(); },
  };
  if (idbState) {
    vm.createContext(sb); // necesario antes de inyectar el shim vía vm
    sb.indexedDB = null; // se inyecta por vm con el shim
    vm.runInContext(IDB_SHIM, sb, { filename: 'idb-shim.js' });
    sb.__idbState = idbState;
    vm.runInContext('window.indexedDB = makeIDB(__idbState); window.IDBKeyRange = { bound: function (l, u) { return { lower: l, upper: u, lowerOpen: false, upperOpen: false }; } };', sb);
  }
  sb.setTimeout = setTimeout;
  sb.clearTimeout = clearTimeout;
  sb.setInterval = () => 0;
  sb.clearInterval = () => { };
  sb.App = { toast() { }, renderMem() { } };
  sb.KiuAvatar = { flash() { }, set() { } };
  sb.FileReader = function () { };
  if (!idbState) vm.createContext(sb);
  return sb;
}
function loadRag(sb) {
  // tanda 8: el núcleo compartido (rag-worker.js) se carga antes, igual que en index.html
  vm.runInContext(CORE_SRC, sb, { filename: 'js/rag-worker.js' });
  vm.runInContext(RAG_SRC, sb, { filename: 'js/rag.js' });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const OLD_RAG = {
  docs: [
    { id: 'd1', name: 'recetas', ext: 'txt', ts: 1, chunks: ['El flan se hace con huevo, leche y azúcar. Se cocina a baño maría durante cuarenta minutos.'] },
    { id: 'd2', name: 'servidor', ext: 'txt', ts: 2, chunks: ['Para instalar ollama en el servidor hay que descargar el binario y correr ollama serve en el puerto 11434.'] },
  ],
  on: true,
};

test('migra el nexo_rag viejo de localStorage hacia IndexedDB (una vez)', async () => {
  const idbState = {};
  const ls = new Map([['nexo_rag', JSON.stringify(OLD_RAG)]]);
  const sb = newSandbox(idbState, ls);
  loadRag(sb);
  await sleep(30);
  const r = sb.RAG;
  assert.equal(r._mode, 'idb');
  assert.equal(r.docs.length, 2);
  assert.equal(r.on, true);
  assert.equal(ls.has('nexo_rag'), false, 'la clave vieja debe borrarse tras migrar');
  assert.ok(idbState['kiu-rag'].chunks.size >= 2, 'chunks persistidos en IDB');
  const hit = r.search('como hago flan', 1);
  assert.ok(hit && hit.indexOf('recetas') >= 0, 'busca sobre lo migrado');
});

test('persistencia real entre arranques (misma base IDB, memoria nueva)', async () => {
  const idbState = {};
  const ls = new Map([['nexo_rag', JSON.stringify(OLD_RAG)]]);
  const sb1 = newSandbox(idbState, ls);
  loadRag(sb1);
  await sleep(30);
  // arranque 2: localStorage vacío, la base IDB es la misma
  const sb2 = newSandbox(idbState, new Map());
  loadRag(sb2);
  await sleep(30);
  assert.equal(sb2.RAG.docs.length, 2, 'docs cargados desde IDB');
  assert.equal(sb2.RAG.on, true, 'el estado on persiste en meta');
  const hit = sb2.RAG.search('puerto 11434 de ollama', 1);
  assert.ok(hit && hit.indexOf('servidor') >= 0);
});

test('BM25: el documento relevante gana el ranking', async () => {
  const idbState = {};
  const sb = newSandbox(idbState, new Map());
  loadRag(sb);
  await sleep(20);
  const r = sb.RAG;
  r.addText('pasteleria', 'txt', 'Recetas de pastelería sin gluten. El flan lleva huevo, leche y azúcar, cocinado a baño maría durante cuarenta minutos. También hay chflan de vainilla y dulce de leche.', function (e) { assert.ifError(e); });
  await sleep(20);
  r.addText('servidor', 'txt', 'Para instalar ollama en el servidor descargá el binario y corré ollama serve. El puerto por defecto es 11434 y responde en http://localhost.', function (e) { assert.ifError(e); });
  await sleep(20);
  r.on = true;
  const hit = r.search('cómo instalo ollama en el servidor', 1);
  assert.ok(hit, 'debe haber resultado');
  assert.ok(hit.indexOf('[servidor') === 0, 'gana el doc del servidor: ' + hit.slice(0, 40));
  const hit2 = r.search('receta de flan sin gluten', 1);
  assert.ok(hit2 && hit2.indexOf('[pasteleria') === 0, 'gana el doc de pastelería: ' + hit2.slice(0, 40));
});

test('tope de capacidad (~8 MB) con mensaje claro', async () => {
  const sb = newSandbox({}, new Map());
  loadRag(sb);
  await sleep(20);
  const r = sb.RAG;
  r._bytes = r._mode === 'idb' ? r.MAX || 8000000 - 10 : 8000000 - 10;
  r._bytes = 8000000 - 10;
  r.addText('grande', 'txt', 'x'.repeat(200), function (err) {
    assert.ok(err && err.indexOf('llena') >= 0, 'mensaje de memoria llena: ' + err);
  });
});

test('exportAll / importAll: copia ida y vuelta entre modos', async () => {
  const idbState = {};
  const sb = newSandbox(idbState, new Map());
  loadRag(sb);
  await sleep(20);
  sb.RAG.addText('notas', 'txt', 'La reunión es el jueves a las nueve en la sala grande del edificio central de la empresa.', function (e) { assert.ifError(e); });
  await sleep(20);
  let data = null;
  sb.RAG.exportAll(function (d) { data = d; });
  assert.equal(data.v, 3);
  assert.equal(data.docs.length, 1);
  assert.ok(data.chunks.length >= 1);
  // destino: modo localStorage (sin IDB)
  const sb2 = newSandbox(null, new Map());
  loadRag(sb2);
  await sleep(10);
  sb2.RAG.importAll(data, function (err, res) {
    assert.ifError(err);
    assert.equal(res.docs, 1);
    assert.ok(res.chunks >= 1);
  });
  sb2.RAG.on = true;
  const hit = sb2.RAG.search('cuando es la reunion', 1);
  assert.ok(hit && hit.indexOf('notas') >= 0, 'importado searchable');
  assert.equal(sb2.RAG.stats().mode, 'ls');
});

test('del borra los chunks del documento en IDB', async () => {
  const idbState = {};
  const sb = newSandbox(idbState, new Map());
  loadRag(sb);
  await sleep(20);
  const r = sb.RAG;
  r.addText('temporal', 'txt', 'Este documento es temporal y sera borrado mas tarde por el test de eliminacion completa.', function (e) { assert.ifError(e); });
  await sleep(20);
  const before = idbState['kiu-rag'].chunks.size;
  assert.ok(before >= 1);
  const id = r.docs[0].id;
  r.del(id);
  await sleep(20);
  assert.equal(r.docs.length, 0);
  assert.equal(r._rows.length, 0);
  assert.equal(idbState['kiu-rag'].chunks.size, 0, 'chunks borrados de IDB');
  assert.equal(r.search('documento temporal de eliminacion', 1), null, 'sin on no busca');
  r.on = true;
  assert.equal(r.search('documento temporal de eliminacion', 1), null, 'sin docs no busca');
});

test('el interruptor on/off persiste entre boots', async () => {
  const idbState = {};
  const sb = newSandbox(idbState, new Map());
  loadRag(sb);
  await sleep(20);
  sb.RAG.on = true;
  sb.RAG.save();
  await sleep(20);
  const sb2 = newSandbox(idbState, new Map());
  loadRag(sb2);
  await sleep(20);
  assert.equal(sb2.RAG.on, true);
  sb2.RAG.on = false;
  sb2.RAG.save();
  await sleep(20);
  const sb3 = newSandbox(idbState, new Map());
  loadRag(sb3);
  await sleep(20);
  assert.equal(sb3.RAG.on, false);
});

test('sin IndexedDB funciona igual (modo localStorage, WebView viejo)', async () => {
  const ls = new Map([['nexo_rag', JSON.stringify(OLD_RAG)]]);
  const sb = newSandbox(null, ls);
  loadRag(sb);
  await sleep(10);
  const r = sb.RAG;
  assert.equal(r._mode, 'ls');
  assert.equal(r.docs.length, 2);
  const hit = r.search('instalar ollama serve', 1);
  assert.ok(hit && hit.indexOf('servidor') >= 0, 'BM25 también en modo ls');
  // del en modo ls: persiste el cambio
  r.del('d1');
  await sleep(10);
  const raw = JSON.parse(ls.get('nexo_rag'));
  assert.equal(raw.docs.length, 1);
  assert.equal(raw.docs[0].id, 'd2');
});
