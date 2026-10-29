import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const CORE_SRC = fs.readFileSync(new URL('../app/src/main/assets/www/js/rag-worker.js', import.meta.url), 'utf8');
function load() { const sb = { console, self: null }; sb.self = sb; vm.createContext(sb); vm.runInContext(CORE_SRC, sb); return sb.KiuRagCore; }

test('RAG híbrido: sinónimo semántico puede recuperar contenido sin coincidencia literal', () => {
  const c = load();
  const rows = c.mkRows('a', ['El sistema presenta un fallo durante el arranque y no responde.'])
    .concat(c.mkRows('b', ['La receta de flan lleva huevo, leche y azúcar.']));
  const d = c.dfOf(rows);
  const lexical = c.score('problema', rows, d.df, d.N, d.len, 2);
  const hybrid = c.scoreHybrid('problema', rows, d.df, d.N, d.len, 2);
  assert.ok(hybrid.length > 0);
  assert.equal(hybrid[0].key, 'a#0');
  assert.ok(Array.isArray(lexical));
});

test('RAG híbrido: preserva coincidencias exactas y orden determinista', () => {
  const c = load();
  const rows = c.mkRows('a', ['Instalar el modelo local y configurar la memoria del asistente.'])
    .concat(c.mkRows('b', ['El flan se cocina con leche y huevo.']));
  const d = c.dfOf(rows);
  const a = c.scoreHybrid('instalar modelo', rows, d.df, d.N, d.len, 2);
  const b = c.scoreHybrid('instalar modelo', rows, d.df, d.N, d.len, 2);
  assert.equal(a[0].key, 'a#0');
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('versión Android incrementada a 2.12.4 / código 79', () => {
  const gradle = fs.readFileSync(new URL('../app/build.gradle.kts', import.meta.url), 'utf8');
  assert.ok(((m) => m && (+m[1] * 1e6 + +m[2] * 1e3 + +m[3]) >= 2012007)(gradle.match(/val kiuVersionName = "(\d+)\.(\d+)\.(\d+)"/)), 'la versión no puede bajar de 2.12.7');
  assert.ok(+gradle.match(/val kiuVersionCode = (\d+)/)[1] >= 81, 'el versionCode no puede bajar de 81');
});


test('RAG v2.11.18: cachea vectores por fila sin alterar el índice persistido', () => {
  const c = load();
  const rows = c.mkRows('a', ['El sistema presenta un fallo durante el arranque.'])
    .concat(c.mkRows('b', ['La receta de flan lleva huevo, leche y azúcar.']));
  c.semanticScore('problema', rows);
  const first = c.getVectorCacheStats();
  c.semanticScore('fallo', rows);
  const second = c.getVectorCacheStats();
  assert.equal(first.enabled, true);
  assert.equal(first.misses, 2);
  assert.ok(second.hits >= 2);
  assert.equal(Object.prototype.hasOwnProperty.call(rows[0], 'vec'), false);
});
