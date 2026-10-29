import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const main = fs.readFileSync(path.join(root, 'app/src/main/java/com/kiu/agent/MainActivity.java'), 'utf8');
const job = fs.readFileSync(path.join(root, 'app/src/main/java/com/kiu/agent/KiuGenJob.java'), 'utf8');
function method(name, nextName) {
  const start = main.indexOf('public void ' + name + '()');
  assert.notEqual(start, -1, `no se encuentra ${name}`);
  const end = main.indexOf('public ', start + 12);
  return main.slice(start, end === -1 ? undefined : end);
}
test('detener generación no libera busy antes de que termine el worker', () => {
  for (const name of ['kiuGenStop', 'kiuResetBusy']) {
    const body = method(name);
    assert.match(body, /KiuNative\.stopGen\(\)/);
    assert.doesNotMatch(body, /KiuGenJob\.busy\s*=\s*false/);
  }
  assert.match(job, /busy = false;/, 'el worker debe liberar busy al finalizar');
});
