const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('app/src/main/assets/www/js/app/motor.js', 'utf8');

test('agotamiento de reintentos sincroniza el estado nativo', () => {
  const start = source.indexOf('if (attempt <= 8)');
  const end = source.indexOf('var afterGen = function ()', start);
  assert.ok(start >= 0 && end > start, 'se localiza el flujo startGen');
  const branch = source.slice(start, end);
  assert.match(branch, /rawBridge\('kiuResetBusy'\)/);
  assert.ok(branch.indexOf("rawBridge('kiuResetBusy')") < branch.indexOf("cb({ ok: false, err: 'el motor sigue ocupado"));
});

test('watchdog detiene y resetea el estado nativo antes de devolver timeout', () => {
  const start = source.indexOf('Red de seguridad: 10 minutos');
  const end = source.indexOf('};\n      startGen();', start);
  assert.ok(start >= 0 && end > start, 'se localiza el watchdog');
  const branch = source.slice(start, end);
  assert.match(branch, /rawBridge\('kiuGenStop'\)/);
  assert.match(branch, /rawBridge\('kiuResetBusy'\)/);
  assert.match(branch, /cbf2\(\{ ok: false, err: 'tardó demasiado'/);
});
