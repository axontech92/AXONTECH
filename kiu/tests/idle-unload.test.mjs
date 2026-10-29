import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const java = fs.readFileSync('app/src/main/java/com/kiu/agent/KiuGenJob.java', 'utf8');
const gradle = fs.readFileSync('app/build.gradle.kts', 'utf8');
const changelog = fs.readFileSync('CHANGELOG.md', 'utf8');

test('versión Android se incrementa para esta actualización', () => {
  assert.ok(((m) => m && (+m[1] * 1e6 + +m[2] * 1e3 + +m[3]) >= 2012007)(gradle.match(/val kiuVersionName = "(\d+)\.(\d+)\.(\d+)"/)), 'la versión no puede bajar de 2.12.7');
  assert.ok(+gradle.match(/val kiuVersionCode = (\d+)/)[1] >= 81, 'el versionCode no puede bajar de 81');
});

test('modelo local se libera tras diez minutos de inactividad', () => {
  assert.match(java, /IDLE_UNLOAD_MS = 10L \* 60L \* 1000L/);
  assert.match(java, /KiuNative\.freeModel\(\)/);
  assert.match(java, /if \(busy\)/);
});

test('la siguiente generación puede recargar el último modelo', () => {
  assert.match(java, /lastModelPath != null/);
  assert.match(java, /KiuNative\.loadModel\(lastModelPath, lastContext, lastThreads\)/);
  assert.match(java, /synchronized \(MODEL_LOCK\)/);
});

test('changelog documenta versión y limitación de APK no compilada', () => {
  assert.match(changelog, /## \[2\.12\.7\]/);
  assert.match(changelog, /No se incluye una APK compilada/);
});
