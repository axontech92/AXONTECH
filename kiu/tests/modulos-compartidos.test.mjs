// Regresión v2.7.5: (1) motor.js usa `Sys`, declarado en app-ui.js (otro script): debe vivir en window.
// (2) attachShadow no existe en <button>: ningún host [data-avatar] puede ser un <button> sin fallback.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const W = 'app/src/main/assets/www/';
const read = (f) => fs.readFileSync(W + f, 'utf8');

test('Sys se exporta a window (motor.js lo necesita)', () => {
  assert.match(read('js/app/app-ui.js'), /window\.Sys\s*=\s*Sys\s*;/);
  assert.match(read('js/app/motor.js'), /\bSys\.d\b/);
});

test('el avatar tiene fallback cuando attachShadow no está permitido (p. ej. <button>)', () => {
  const js = read('js/kiu-avatar.js');
  assert.match(js, /try\{\s*root=host\.shadowRoot\|\|host\.attachShadow/);
  assert.match(js, /kiu-shadow-host/);
});
