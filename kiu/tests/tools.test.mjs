/* v2.7.4: calculadora — el boton % es porcentaje (antes modulo: "50%" daba "Cuenta invalida"). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, '..', 'app', 'src', 'main', 'assets', 'www', 'js', 'tools.js'), 'utf8');
function load() {
  const ctx = { window: {}, console, Math, Date, setTimeout, clearTimeout };
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: 'tools.js' });
  return ctx.window.KiuTools;
}

test('calc: porcentajes como una calculadora normal', () => {
  const T = load();
  assert.equal(T.calcEval('200+10%'), 220);
  assert.equal(T.calcEval('200-10%'), 180);
  assert.equal(T.calcEval('50%'), 0.5);
  assert.equal(T.calcEval('200×10%'), 20);
  assert.equal(T.calcEval('5×200+10%'), 1100);
});

test('calc: lo de siempre sigue igual y lo malo se rechaza', () => {
  const T = load();
  assert.equal(T.calcEval('2+3×4'), 14);
  assert.equal(T.calcEval('(1+2)÷4'), 0.75);
  assert.equal(T.calcEval('1÷0'), null);
  assert.equal(T.calcEval('alert(1)'), null);
  assert.equal(T.calcEval('5%%'), null);
});
