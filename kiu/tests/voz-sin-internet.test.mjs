import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const rd = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const main = rd('app/src/main/java/com/kiu/agent/MainActivity.java');
const svc = rd('app/src/main/java/com/kiu/agent/KiuService.java');

test('la voz prefiere voces locales y salta las de red / no instaladas', () => {
  assert.match(main, /if \(!pickVoice\(false\)\) \{\s*pickVoice\(true\);/);
  assert.match(main, /needNet && !allowNet/);
  assert.match(main, /notInstalled/);
});

test('un fallo al hablar se reintenta una vez y luego se avisa', () => {
  assert.match(main, /ttsRetried/);
  assert.match(main, /nexoVoiceError\('sin voz: el motor de voz no pudo hablar/);
});

test('el reconocimiento prefiere el paquete sin conexión (comandos y despertar)', () => {
  assert.match(main, /android\.speech\.extra\.PREFER_OFFLINE/);
  assert.match(svc, /android\.speech\.extra\.PREFER_OFFLINE/);
});
