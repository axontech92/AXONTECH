import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const motor = fs.readFileSync('app/src/main/assets/www/js/app/motor.js', 'utf8');
const ui = fs.readFileSync('app/src/main/assets/www/js/app/app-ui.js', 'utf8');
const gradle = fs.readFileSync('app/build.gradle.kts', 'utf8');
const changelog = fs.readFileSync('CHANGELOG.md', 'utf8');

test('KIU incrementa versión visible y código Android', () => {
  assert.ok(((m) => m && (+m[1] * 1e6 + +m[2] * 1e3 + +m[3]) >= 2012007)(gradle.match(/val kiuVersionName = "(\d+)\.(\d+)\.(\d+)"/)), 'la versión no puede bajar de 2.12.7');
  assert.ok(+gradle.match(/val kiuVersionCode = (\d+)/)[1] >= 81, 'el versionCode no puede bajar de 81');
  assert.match(changelog, /## \[2\.12\.7\]/);
});

test('resumen se identifica por contenido y limita la caché', () => {
  assert.match(motor, /_key: function \(msgs\)/);
  assert.match(motor, /maxCache: 40/);
  assert.match(motor, /store\('nexo_comp_v2', this\.cache\)/);
});

test('el resumen no elimina historial si todavía no está listo', () => {
  assert.match(motor, /if \(!sum\) \{ this\.summarize\(old, key\); return msgs; \}/);
});

test('el prompt local conserva el resumen junto con mensajes recientes', () => {
  assert.match(ui, /h\[0\]\._kiuSummary/);
  /* v2.12.0: 6 turnos recientes (antes 4) ahora que el contexto del motor es de 2048+ tokens */
  assert.match(ui, /rec = \[h\[0\]\]\.concat\(h\.slice\(-6\)\)/);
});
