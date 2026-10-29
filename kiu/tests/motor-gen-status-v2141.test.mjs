import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const cpp = fs.readFileSync(path.join(root, 'app/src/main/cpp/kiullama_jni.cpp'), 'utf8');
const motor = fs.readFileSync(path.join(root, 'app/src/main/assets/www/js/app/motor.js'), 'utf8');
const gradle = fs.readFileSync(path.join(root, 'app/build.gradle.kts'), 'utf8');
const nativeJava = fs.readFileSync(path.join(root, 'app/src/main/java/com/kiu/agent/KiuNative.java'), 'utf8');
const mainJava = fs.readFileSync(path.join(root, 'app/src/main/java/com/kiu/agent/MainActivity.java'), 'utf8');
test('genStatus identifica solicitudes y marca done aunque no haya tokens', () => {
  assert.match(cpp, /g_gen_id\.fetch_add\(1\)/);
  assert.match(cpp, /bool done = !running/);
  assert.match(cpp, /char buf\[160\]/);
  assert.match(cpp, /\\"running\\":%s,\\"id\\":%llu/);
});
test('JS no reutiliza el texto de la generación anterior', () => {
  assert.match(motor, /genBaselineId/);
  assert.match(motor, /statusId === genBaselineId/);
  assert.match(motor, /no inició la solicitud/);
});
test('el camino nativo comprueba reservas críticas', () => {
  assert.match(cpp, /if \(smpl == nullptr\)/);
  assert.match(cpp, /if \(batch == nullptr\)/);
  assert.match(cpp, /if \(one == nullptr\)/);
  assert.match(cpp, /cp\.abort_callback = kiu_abort_llama/);
  assert.match(cpp, /bool kiu_abort_llama\(void\*\) \{ return g_stop\.load\(\); \}/);
});
test('versión incrementada sin reutilizar versionCode', () => {
  /* v2.14.2: no se fija el número exacto (ver cache-prefix-reuse-v2137): la
     versión no puede retroceder y el versionCode tiene que subir. */
  const ver = gradle.match(/val kiuVersionName = "(\d+)\.(\d+)\.(\d+)"/);
  assert.ok(ver, 'la versión tiene que estar declarada en el build');
  const n = (+ver[1] * 1e6) + (+ver[2] * 1e3) + (+ver[3]);
  assert.ok(n >= 2014001, 'la versión no puede bajar de 2.14.1');
  const code = +gradle.match(/val kiuVersionCode = (\d+)/)[1];
  assert.ok(code > 92, 'el versionCode tiene que subir: ' + code);
});

test('la carga fallida de libkiullama conserva y muestra su causa', () => {
  assert.match(nativeJava, /loadError = th\.getClass\(\)\.getSimpleName\(\)/);
  assert.match(nativeJava, /public static String loadError\(\)/);
  assert.match(mainJava, /kiuNativeLoadError/);
  assert.match(motor, /rawBridge\('kiuNativeLoadError'\)/);
});
