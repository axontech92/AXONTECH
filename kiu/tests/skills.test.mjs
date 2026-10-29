/* skills.test.mjs — tanda 5 (sección 4-a): skills instalables.
 * Manifiesto declarativo (sin código ejecutable): validación estricta,
 * match de intents con normalización, variables, enable/disable,
 * instalación desde texto (con basura alrededor del JSON) y export/import.
 * node --test tests/skills.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WWW = path.join(HERE, '..', 'app', 'src', 'main', 'assets', 'www');

function loadSkills() {
  const ctx = {
    window: {},
    localStorage: {
      _d: new Map(),
      getItem(k) { return this._d.has(k) ? this._d.get(k) : null; },
      setItem(k, v) { this._d.set(String(k), String(v)); },
      removeItem(k) { this._d.delete(k); },
    },
    Math, Date, JSON, RegExp, String, Number, Array, Object,
    parseInt, parseFloat, isNaN, btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  };
  ctx.localStorage.clear = function () { this._d.clear(); };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(path.join(WWW, 'js', 'skills.js'), 'utf8'), ctx, { filename: 'skills.js' });
  const K = ctx.window.KiuSkills;
  assert.ok(K, 'window.KiuSkills debe quedar definido tras cargar skills.js');
  return K;
}

const MANIFEST = JSON.stringify({
  id: 'saludo-ninja', name: 'Saludo ninja', version: 1,
  desc: 'Kiu saluda como ninja',
  intents: ['modo ninja', 'saludo ninja'],
  reply: ['Silencio... un ninja saluda, {nombre}.', 'Presente.'],
});

test('validate: manifiesto válido pasa y completo rellena defaults', () => {
  const K = loadSkills();
  const m = JSON.parse(MANIFEST);
  assert.equal(K.validate(m), null);
  assert.equal(m.tts, false, 'tts default false');
});

test('validate: rechaza id malo, sin intents y reply vacío', () => {
  const K = loadSkills();
  assert.ok(K.validate({ id: 'X!', name: 'n', intents: ['hola'], reply: 'x' }), 'id inválido');
  assert.ok(K.validate({ id: 'ok-id', name: 'n', intents: [], reply: 'x' }), 'sin intents');
  assert.ok(K.validate({ id: 'ok-id', name: 'n', intents: ['hola'], reply: [] }), 'reply vacío');
  assert.ok(K.validate({ id: 'ok-id', name: 'n', intents: ['regex:(['], reply: 'x' }), 'regex rota');
  assert.ok(K.validate(null), 'no objeto');
});

test('installFromText: instala con basura alrededor del JSON y persiste', () => {
  const K = loadSkills();
  const r = K.installFromText('blabla\n' + MANIFEST + '\nfin');
  assert.equal(r.ok, true, 'debe instalar: ' + (r.err || ''));
  assert.equal(K.count(), 1);
  const again = K.installFromText(MANIFEST);
  assert.equal(again.ok, true);
  assert.equal(again.updated, true, 're-instalar = update');
  assert.equal(K.count(), 1, 'no duplica por id');
});

test('match: encuentra por intent normalizado (tildes/ñ/mayúsculas)', () => {
  const K = loadSkills();
  K.installFromText(MANIFEST);
  assert.ok(K.match('Modo NINJA on'), 'matchea modo ninja');
  assert.ok(K.match('activá el saludo ninja'), 'matchea saludo ninja');
  assert.equal(K.match('qué hora es'), null, 'no matchea otra cosa');
});

test('run: responde con variable {nombre} y respeta toggle on/off', () => {
  const K = loadSkills();
  K.installFromText(JSON.stringify({
    id: 'animo', name: 'Ánimo', intents: ['dame animo'],
    reply: 'Dale {nombre}, que son las {hora}',
  }));
  const hit = K.match('dame ánimo');
  assert.ok(hit, 'match con tilde');
  const out = K.run(hit);
  assert.equal(out.handled, true);
  assert.ok(out.text.startsWith('Dale jefe,'), 'variable por defecto: ' + out.text);
  assert.match(out.text, /\d{2}:\d{2}/, 'variable hora');
  K.setEnabled('animo', false);
  assert.equal(K.match('dame animo'), null, 'apagado no matchea');
  K.setEnabled('animo', true);
  assert.ok(K.match('dame animo'), 'reactivado matchea');
});

test('run con action: delega en el cerebro cuando el reply pide accion:', () => {
  const K = loadSkills();
  K.installFromText(JSON.stringify({
    id: 'linterna-skill', name: 'Linterna', intents: ['tarea linterna'],
    reply: 'accion:enciende la linterna',
  }));
  const hit = K.match('tarea linterna');
  assert.ok(hit);
  /* sin KiuBrain cargado: el skill no contesta nada raro */
  const out0 = K.run(hit);
  assert.equal(out0, null, 'sin cerebro no hay respuesta');
});

test('installExamples: los 3 ejemplos entran una sola vez', () => {
  const K = loadSkills();
  const n1 = K.installExamples();
  assert.equal(n1, 3, '3 ejemplos nuevos');
  const n2 = K.installExamples();
  assert.equal(n2, 0, 'segunda vez: 0 nuevos');
  assert.equal(K.hasExamples(), true);
});

test('exportAll/importAll: viajan los skills, no duplican, ejemplos se quedan', () => {
  const K = loadSkills();
  K.installExamples();
  K.installFromText(MANIFEST.replace('"id":"saludo-ninja"', '"id":"saludo-custom"'));
  K.setEnabled('saludo-custom', false);
  const ex = K.exportAll();
  assert.ok(ex.length >= 2, 'al menos animo + saludo-custom');
  assert.ok(!ex.some((s) => s.m.id === 'saludo-ninja'), 'el ejemplo no viaja en la copia');
  assert.ok(ex.some((s) => s.m.id === 'saludo-custom' && s.on === false), 'el mío viaja apagado');
  const K2 = loadSkills();
  const n = K2.importAll(ex);
  assert.equal(n, ex.length, 're-importa todo');
  const sk = K2.all().find((s) => s.m.id === 'saludo-custom');
  assert.ok(sk, 'el skill re-importado existe');
  assert.equal(sk.on, false, 'conserva el estado on/off');
});

test('remove: borra por id y count baja', () => {
  const K = loadSkills();
  K.installFromText(MANIFEST);
  assert.equal(K.count(), 1);
  assert.equal(K.remove('no-existe'), false);
  assert.equal(K.remove('saludo-ninja'), true);
  assert.equal(K.count(), 0);
});
