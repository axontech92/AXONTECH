import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const adapterSrc = fs.readFileSync('app/src/main/assets/www/js/local-embeddings.js', 'utf8');
const coreSrc = fs.readFileSync('app/src/main/assets/www/js/rag-worker.js', 'utf8');
const ragSrc = fs.readFileSync('app/src/main/assets/www/js/rag.js', 'utf8');
const gradle = fs.readFileSync('app/build.gradle.kts', 'utf8');

function makeAdapter() {
  const window = {};
  vm.runInNewContext(adapterSrc, { window, Promise, WeakMap, Array, Number, String, Math, isFinite, Error, Object });
  return window.KiuLocalEmbeddings;
}

test('KIU incrementa versionName y versionCode para la integración RAG', () => {
  assert.ok(((m) => m && (+m[1] * 1e6 + +m[2] * 1e3 + +m[3]) >= 2012007)(gradle.match(/val kiuVersionName = "(\d+)\.(\d+)\.(\d+)"/)), 'la versión no puede bajar de 2.12.7');
  assert.ok(+gradle.match(/val kiuVersionCode = (\d+)/)[1] >= 81, 'el versionCode no puede bajar de 81');
});

test('el adaptador no afirma que hay modelo cuando no se ha registrado ninguno', () => {
  const a = makeAdapter();
  assert.equal(a.isReady(), false);
  assert.equal(a.stats().ready, false);
});

test('valida proveedor y vectores numéricos, y calcula coseno', async () => {
  const a = makeAdapter();
  assert.throws(() => a.register({}), /embed/);
  a.register({ name: 'mock-local', embed: async (s) => s.includes('manzana') ? [1, 0] : [0, 1] });
  assert.equal(a.isReady(), true);
  assert.equal(a.cosine([1, 0], [1, 0]), 1);
  assert.equal(a.cosine([1, 0], [0, 1]), 0);
  assert.deepEqual(Array.from(await a.embed('x')), [0, 1]);
  assert.equal(a.stats().provider, 'mock-local');
});

test('el reranking local combina similitud vectorial con BM25', async () => {
  const a = makeAdapter();
  a.register({ name: 'mock-local', embed: async (s) => /vehículo|coche/i.test(s) ? [1, 0] : [0, 1] });
  const window = {};
  const sb = { self: window, window };
  vm.runInNewContext(coreSrc, sb);
  const core = window.KiuRagCore;
  const rows = core.mkRows('d', ['Un vehículo eléctrico para transporte urbano.', 'Receta de pan y harina.']);
  const hits = await a.rank('coche', rows, core, 2);
  assert.equal(hits[0].key, rows[0].key);
});

test('RAG consulta el proveedor solo si está listo y conserva la ruta anterior de respaldo', () => {
  assert.match(ragSrc, /KiuLocalEmbeddings/);
  assert.match(ragSrc, /localEmb\.isReady\(\)/);
  assert.match(ragSrc, /catch\(function \(\) \{ cb\(self\.search\(q, k\)\); \}\)/);
  const html = fs.readFileSync('app/src/main/assets/www/index.html', 'utf8');
  assert.match(html, /js\/local-embeddings\.js/);
});
