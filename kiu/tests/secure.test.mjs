/* Tests de los módulos de seguridad v2.3.0 (sección 2):
 *   - kiu-secure.js: bóveda KiuVault (Keystore vía puente) + shim de fetch
 *     (http://local y https://nube van por el proxy Java; el resto, fetch nativo).
 *   - kiu-migrate.js: ferry único de localStorage file:// → appassets.
 * Sin dependencias: Node puro + VM con stubs (igual que brain.test.mjs).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(path.join(here, '..', 'app', 'src', 'main', 'assets', 'www', 'js', p), 'utf8');

function makeAnchor() {
  const a = { protocol: '', hostname: '', pathname: '' };
  Object.defineProperty(a, 'href', {
    set(v) {
      const m = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]+)([^#]*)/i.exec(String(v));
      a.protocol = m ? m[1].toLowerCase() + ':' : '';
      a.hostname = m ? m[2].split('@').pop().split(':')[0].toLowerCase() : '';
      a.pathname = m ? (m[3] || '/') : '';
    }
  });
  return a;
}

function makeLS(data = {}) {
  const d = Object.assign({}, data);
  return {
    getItem: (k) => (k in d ? d[k] : null),
    setItem: (k, v) => { d[k] = String(v); },
    removeItem: (k) => { delete d[k]; },
    key: (i) => (Object.keys(d)[i] ?? null),
    get length() { return Object.keys(d).length; }
  };
}

function makeCtx({ bridge = null, search = '', ls = {} } = {}) {
  const storage = makeLS(ls);
  const window = { localStorage: storage, stop: () => { window.stopped = true; } };
  const ctx = {
    window,
    localStorage: storage,
    location: { search, href: 'https://appassets.androidplatform.net/assets/www/index.html' },
    document: { createElement: () => makeAnchor() },
    JSON, Math, Date, Promise, TypeError, Error,
    setInterval, clearInterval, setTimeout, clearTimeout, console,
  };
  if (bridge) window.KiuBridge = bridge;
  ctx.__storage = storage;
  vm.createContext(ctx);
  return ctx;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- kiu-secure.js ---------- */

test('KiuVault guarda y lee claves vía puente (Keystore)', () => {
  const store = {};
  const bridge = {
    kiuKeysSet: (n, v) => { store[n] = v; },
    kiuKeysGet: (n) => store[n] || '',
    kiuKeysHas: (n) => Object.prototype.hasOwnProperty.call(store, n),
    kiuKeysDel: (n) => { delete store[n]; },
    kiuKeysList: () => JSON.stringify({ openai: 'ab12' }),
    kiuApiStart: () => false, kiuApiPoll: () => '{}', kiuApiStop: () => { }
  };
  const ctx = makeCtx({ bridge });
  vm.runInContext(src('kiu-secure.js'), ctx, { filename: 'kiu-secure.js' });
  const V = ctx.window.KiuVault;
  assert.ok(V && V.ok, 'KiuVault debe estar disponible con el puente completo');
  V.set('openai', 'sk-test-123');
  assert.equal(V.get('openai'), 'sk-test-123');
  assert.equal(V.has('openai'), true);
  V.del('openai');
  assert.equal(V.has('openai'), false);
  assert.deepEqual(V.list(), { openai: 'ab12' });
});

test('fetch a http:// local va por el proxy Java (sin mixed-content)', async () => {
  const calls = [];
  const bridge = {
    kiuApiStart: (id, method, url, headersJson, body) => {
      calls.push({ id, method, url, headersJson, body });
      return true;
    },
    kiuApiPoll: (id) => JSON.stringify({ st: 'done', code: 200, ct: 'application/json', body: '{"hola":1}' }),
    kiuApiStop: () => { },
    kiuKeysSet: () => { }, kiuKeysGet: () => '', kiuKeysHas: () => false, kiuKeysDel: () => { }, kiuKeysList: () => '{}'
  };
  const ctx = makeCtx({ bridge });
  vm.runInContext(src('kiu-secure.js'), ctx, { filename: 'kiu-secure.js' });
  const res = await ctx.window.fetch('http://127.0.0.1:8080/api/tags', { method: 'GET' });
  await sleep(20);
  assert.equal(calls.length, 1, 'debe haber un solo kiuApiStart');
  assert.equal(calls[0].url, 'http://127.0.0.1:8080/api/tags');
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { hola: 1 });
});

test('fetch a https:// nube va por el proxy con headers intactos', async () => {
  const calls = [];
  const bridge = {
    kiuApiStart: (id, method, url, headersJson, body) => {
      calls.push({ id, method, url, headers: JSON.parse(headersJson), body });
      return true;
    },
    kiuApiPoll: () => JSON.stringify({ st: 'done', code: 200, ct: 'application/json', body: '{"ok":true}' }),
    kiuApiStop: () => { },
    kiuKeysSet: () => { }, kiuKeysGet: () => '', kiuKeysHas: () => false, kiuKeysDel: () => { }, kiuKeysList: () => '{}'
  };
  const ctx = makeCtx({ bridge });
  vm.runInContext(src('kiu-secure.js'), ctx, { filename: 'kiu-secure.js' });
  await ctx.window.fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer {{key:openai}}' },
    body: '{"model":"gpt-4o-mini"}'
  });
  await sleep(20);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].headers.Authorization, 'Bearer {{key:openai}}', 'la clave real no viaja: placeholder');
  assert.equal(calls[0].body, '{"model":"gpt-4o-mini"}');
});

test('fetch a https:// que no es de la lista pasa al fetch nativo', async () => {
  const calls = [];
  const bridge = {
    kiuApiStart: () => { calls.push(1); return true; },
    kiuApiPoll: () => '{"st":"done","code":200,"body":""}', kiuApiStop: () => { },
    kiuKeysSet: () => { }, kiuKeysGet: () => '', kiuKeysHas: () => false, kiuKeysDel: () => { }, kiuKeysList: () => '{}'
  };
  const ctx = makeCtx({ bridge });
  vm.runInContext(src('kiu-secure.js'), ctx, { filename: 'kiu-secure.js' });
  await assert.rejects(
    () => ctx.window.fetch('https://ejemplo-raro.com/x'),
    /fetch no disponible/,
    'sin fetch nativo en el VM debe rechazar sin tocar el proxy'
  );
  assert.equal(calls.length, 0, 'el proxy no debe llamarse para hosts fuera de lista');
});

test('tanda 8: un proveedor NUEVO con ruta de API va por el proxy sin editar la lista', async () => {
  const calls = [];
  const bridge = {
    kiuApiStart: (id, method, url) => { calls.push(url); return true; },
    kiuApiPoll: () => JSON.stringify({ st: 'done', code: 200, ct: 'application/json', body: '{"ok":1}' }),
    kiuApiStop: () => { },
    kiuKeysSet: () => { }, kiuKeysGet: () => '', kiuKeysHas: () => false, kiuKeysDel: () => { }, kiuKeysList: () => '{}'
  };
  const ctx = makeCtx({ bridge });
  vm.runInContext(src('kiu-secure.js'), ctx, { filename: 'kiu-secure.js' });
  // host que NO está en CLOUD pero la ruta delata API estilo OpenAI
  await ctx.window.fetch('https://api.perplexity.ai/chat/completions', { method: 'POST', body: '{}' });
  await ctx.window.fetch('https://mi-servidor-ia.example.com/v1/models');
  await sleep(20);
  assert.deepEqual(calls, [
    'https://api.perplexity.ai/chat/completions',
    'https://mi-servidor-ia.example.com/v1/models',
  ], 'heurística de API: /chat/completions y /v1 van por Java');
  // el mismo host con ruta que NO es API sigue en fetch nativo
  await assert.rejects(() => ctx.window.fetch('https://mi-servidor-ia.example.com/pagina'), /fetch no disponible|proxy/);
  assert.equal(calls.length, 2, 'la página común no se proxifica');
});

test('sin puente el shim es transparente (desktop)', () => {
  const ctx = makeCtx({});
  vm.runInContext(src('kiu-secure.js'), ctx, { filename: 'kiu-secure.js' });
  assert.equal(ctx.window.KiuVault.ok, false);
  assert.ok(ctx.window.KiuSecure, 'KiuSecure queda expuesto igual');
});

/* ---------- kiu-migrate.js ---------- */

test('ferry: en el origen viejo exporta localStorage y corta el boot', () => {
  let saved = null;
  const bridge = { kiuFerryPut: (j) => { saved = j; }, kiuFerryGet: () => '', kiuFerryClear: () => { } };
  const ctx = makeCtx({
    bridge, search: '?ferry=1',
    ls: { nexo_settings: '{"modo":"local"}', memoria: 'importante' }
  });
  vm.runInContext(src('kiu-migrate.js'), ctx, { filename: 'kiu-migrate.js' });
  assert.ok(saved, 'debe llamar kiuFerryPut');
  const parsed = JSON.parse(saved);
  assert.equal(parsed.nexo_settings, '{"modo":"local"}');
  assert.equal(parsed.memoria, 'importante');
  assert.equal(ctx.window.stopped, true, 'window.stop evita doble boot en el origen viejo');
});

test('ferry: en el origen seguro importa, marca y limpia', () => {
  const payload = JSON.stringify({ nexo_settings: '{"modo":"local"}', kiu_key_openai: 'x' });
  let cleared = false;
  const bridge = { kiuFerryPut: () => { }, kiuFerryGet: () => payload, kiuFerryClear: () => { cleared = true; } };
  const ctx = makeCtx({ bridge, search: '' });
  vm.runInContext(src('kiu-migrate.js'), ctx, { filename: 'kiu-migrate.js' });
  assert.equal(ctx.__storage.getItem('nexo_settings'), '{"modo":"local"}');
  assert.equal(ctx.__storage.getItem('kiu_key_openai'), 'x');
  assert.ok(ctx.__storage.getItem('kiu_ferried'), 'marca de ferry aplicado');
  assert.equal(cleared, true, 'borra el JSON del lado Java');
  assert.notEqual(ctx.window.stopped, true, 'no corta el arranque normal');
});

test('ferry: sin puente no hace nada (desktop)', () => {
  const ctx = makeCtx({ ls: { a: '1' } });
  vm.runInContext(src('kiu-migrate.js'), ctx, { filename: 'kiu-migrate.js' });
  assert.equal(ctx.__storage.getItem('kiu_ferried'), null);
});

/* ---------- v2.7.2: fetch(Request) conserva metodo, headers y body ---------- */
test('fetch(new Request(...)) por el proxy conserva POST, headers y body', async () => {
  const calls = [];
  const bridge = {
    kiuApiStart: (id, method, url, headersJson, body) => { calls.push({ method, url, headers: JSON.parse(headersJson), body }); return true; },
    kiuApiPoll: () => JSON.stringify({ st: 'done', code: 200, ct: 'text/plain', body: 'hola' }),
    kiuApiStop: () => { },
    kiuKeysSet: () => { }, kiuKeysGet: () => '', kiuKeysHas: () => false, kiuKeysDel: () => { }, kiuKeysList: () => '{}'
  };
  const ctx = makeCtx({ bridge });
  vm.runInContext(src('kiu-secure.js'), ctx, { filename: 'kiu-secure.js' });
  const req = { url: 'https://api.openai.com/v1/chat/completions', method: 'POST',
    headers: { Authorization: 'Bearer {{key:openai}}' }, clone() { return { text: () => Promise.resolve('{"x":1}') }; } };
  const res = await ctx.window.fetch(req);
  await sleep(20);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].body, '{"x":1}');
  assert.equal(calls[0].headers.Authorization, 'Bearer {{key:openai}}');
  assert.equal(await res.text(), 'hola');
});
