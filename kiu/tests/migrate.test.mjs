/* migrate.test.mjs — tanda 8: ferry único de datos (js/kiu-migrate.js).
 * Los tres casos base ya están en secure.test.mjs; acá se cubren los bordes:
 *   1) marca kiu_ferried: el segundo arranque NO reimporta (idempotencia),
 *   2) origen viejo sin nada que migrar → manda '{}' y corta igual,
 *   3) payload corrupto en el ferry no rompe el arranque,
 *   4) exporta TODAS las claves de localStorage (loop completo).
 * node --test tests/migrate.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(path.join(here, '..', 'app', 'src', 'main', 'assets', 'www', 'js', 'kiu-migrate.js'), 'utf8');

function makeLS(data = {}) {
  const d = Object.assign({}, data);
  return {
    getItem: (k) => (k in d ? d[k] : null),
    setItem: (k, v) => { d[k] = String(v); },
    removeItem: (k) => { delete d[k]; },
    key: (i) => (Object.keys(d)[i] ?? null),
    get length() { return Object.keys(d).length; },
    _d: d,
  };
}

function boot({ search = '', ls = {}, bridge = null } = {}) {
  const storage = makeLS(ls);
  const window = { localStorage: storage, stop: () => { window.stopped = true; } };
  const ctx = {
    window,
    localStorage: storage,
    location: { search, href: 'https://appassets.androidplatform.net/assets/www/index.html' },
    JSON, Math, Date, Error,
    console,
  };
  if (bridge) window.KiuBridge = bridge;
  ctx.__storage = storage;
  vm.createContext(ctx);
  return ctx;
}

test('ferry idempotente: con kiu_ferried marcado no reimporta (solo descarta el sobrante)', () => {
  const payload = JSON.stringify({ nexo_settings: '{"lang":"en"}' });
  const calls = { clear: 0 };
  const bridge = {
    kiuFerryPut: () => { },
    kiuFerryGet: () => payload,
    kiuFerryClear: () => { calls.clear++; },
  };
  const ctx = boot({ bridge, ls: { kiu_ferried: '1700000000000' } });
  vm.runInContext(SRC, ctx, { filename: 'kiu-migrate.js' });
  assert.equal(ctx.__storage.getItem('nexo_settings'), null, 'NO reimportó (ya migró antes)');
  assert.equal(calls.clear, 1, 'descarta el ferry sobrante (sin reimportar)');
  assert.notEqual(ctx.window.stopped, true, 'el boot normal sigue');
});

test('origen viejo sin datos: manda {} para que Java recargue igual', () => {
  let saved = null;
  const bridge = { kiuFerryPut: (j) => { saved = j; }, kiuFerryGet: () => '', kiuFerryClear: () => { } };
  const ctx = boot({ bridge, search: '?ferry=1' });
  vm.runInContext(SRC, ctx, { filename: 'kiu-migrate.js' });
  assert.equal(saved, '{}', 'payload vacío explícito');
  assert.equal(ctx.window.stopped, true, 'corta el boot en el origen viejo igual');
});

test('payload corrupto en el ferry: no rompe el arranque y limpia', () => {
  let cleared = false;
  const bridge = { kiuFerryPut: () => { }, kiuFerryGet: () => 'esto no es json{{{', kiuFerryClear: () => { cleared = true; } };
  const ctx = boot({ bridge });
  vm.runInContext(SRC, ctx, { filename: 'kiu-migrate.js' }); // no debe lanzar
  assert.ok(ctx.__storage.getItem('kiu_ferried'), 'queda marcado como ferried');
  assert.equal(cleared, true, 'el ferry corrupto se descarta');
  assert.notEqual(ctx.window.stopped, true, 'el boot normal sigue');
});

test('exporta TODAS las claves del localStorage (loop completo)', () => {
  const saved = [];
  const bridge = { kiuFerryPut: (j) => saved.push(j), kiuFerryGet: () => '', kiuFerryClear: () => { } };
  const data = {};
  for (let i = 0; i < 50; i++) data['clave_' + i] = 'valor ' + i;
  const ctx = boot({ bridge, search: '?ferry=1', ls: data });
  vm.runInContext(SRC, ctx, { filename: 'kiu-migrate.js' });
  assert.equal(saved.length, 1);
  const parsed = JSON.parse(saved[0]);
  assert.equal(Object.keys(parsed).length, 50, 'las 50 claves viajan');
  assert.equal(parsed['clave_33'], 'valor 33');
});
