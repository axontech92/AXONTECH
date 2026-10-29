import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const motor = fs.readFileSync(path.join(root, 'app/src/main/assets/www/js/app/motor.js'), 'utf8');
const gradle = fs.readFileSync(path.join(root, 'app/build.gradle.kts'), 'utf8');
test('recupera generación local huérfana solo tras 180 segundos sin progreso', () => {
  assert.match(motor, /lastActivityAt/);
  assert.match(motor, /Date\.now\(\) - staleAt > 180000/);
  assert.match(motor, /rawBridge\('kiuGenStop'\)/);
  assert.match(motor, /rawBridge\('kiuResetBusy'\)/);
});
test('actualiza versionName y versionCode de Android', () => {
  assert.ok(((m) => m && (+m[1] * 1e6 + +m[2] * 1e3 + +m[3]) >= 2012007)(gradle.match(/val kiuVersionName = "(\d+)\.(\d+)\.(\d+)"/)), 'la versión no puede bajar de 2.12.7');
  assert.ok(+gradle.match(/val kiuVersionCode = (\d+)/)[1] >= 81, 'el versionCode no puede bajar de 81');
});
