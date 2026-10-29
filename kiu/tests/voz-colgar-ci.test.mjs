import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const rd = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const svc = rd('app/src/main/java/com/kiu/agent/KiuService.java');
const main = rd('app/src/main/java/com/kiu/agent/MainActivity.java');
const ui = rd('app/src/main/assets/www/js/app/app-ui.js');
const wf = rd('.github/workflows/build.yml');
const gr = rd('app/build.gradle.kts');

test('el motor de «Kiu» por defecto es Google; Vosk solo de respaldo o a propósito', () => {
  assert.match(main, /boolean wwLocal = sp\.getBoolean\("wwLocalPref", false\) \|\| !googleOk;/);
  assert.match(main, /WakeWordEngine\.get\(\)\.stop\(\); \} catch \(Throwable ignored\) \{ \} \/\* un solo micrófono/);
});

test('despedidas mientras habla: callan y cuelgan', () => {
  const m = svc.match(/Pattern END = Pattern\.compile\("([^"]+)"\)/);
  assert.ok(m);
  const re = new RegExp(m[1]);
  for (const ok of ['chao', 'chau', 'cuelga', 'colgar', 'adios', 'hasta luego', 'cuelga ya', 'chau kiu']) assert.ok(re.test(ok), ok);
  for (const no of ['hola', 'el chao de ayer', 'que hora es']) assert.ok(!re.test(no), no);
  assert.match(svc, /MainActivity\.endCallByVoice\(getApplicationContext\(\)\)/);
  assert.match(main, /m\.js\("nexoEndCall\(\)"\)/);
  assert.match(ui, /window\.nexoEndCall = function/);
});

test('el servicio no queda suspendido para siempre', () => {
  assert.match(svc, /SUSPENDED && !MainActivity\.COMMAND_BUSY && !MainActivity\.SPEAKING\s*&& SystemClock\.elapsedRealtime\(\) - suspendedAt > 20000L/);
});

test('CI: una sola compilación release arm64, sin tests repetidos ni APK debug', () => {
  assert.match(wf, /assembleRelease -PkiuAbis=arm64-v8a/);
  assert.doesNotMatch(wf, /gradlew[^\n]*assembleDebug/);
  assert.doesNotMatch(wf, /gradlew[^\n]*testDebugUnitTest/);
  assert.doesNotMatch(wf, /gradlew[^\n]*lintDebug/);
  assert.doesNotMatch(wf, /Kiu-APK-debug/);
  assert.equal((wf.match(/node --test tests/g) || []).length, 1, 'los tests de Node corren una sola vez');
  assert.match(gr, /findProperty\("kiuAbis"\)/);
  assert.match(wf, /actions\/cache@v4/);
});
