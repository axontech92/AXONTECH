import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const ui = readFileSync(new URL('../app/src/main/assets/www/js/app/app-ui.js', import.meta.url), 'utf8');
const main = readFileSync(new URL('../app/src/main/java/com/kiu/agent/MainActivity.java', import.meta.url), 'utf8');

test('en conversación no se salta a la pantalla de Chat', () => {
  assert.match(ui, /inCall: function/);
  assert.match(ui, /if \(!this\.inCall\(\)\) this\.go\('chat'\);\s*this\.sendMsg\(text\);/);
  assert.match(ui, /bcrumb\('enviando: '[^\n]*\n\s*if \(!this\.inCall\(\)\) this\.go\('chat'\);/);
  assert.match(ui, /if \(!App\.inCall\(\)\) App\.go\('chat'\);/);
});

test('la pantalla de llamada no se cierra mientras Kiu piensa o habla', () => {
  assert.match(ui, /Kiu\.pending\) \|\| st === 'Hablando'\) \{ self\._vpIdle = Date\.now\(\); \}/);
});

test('hay guardián que reabre el micrófono y colgar o cortar lo apagan', () => {
  assert.match(ui, /self\._kIdle >= 3\) \{ self\._kIdle = 0; self\.startVoice\(\); \}/);
  assert.match(ui, /hangUp: function \(\) \{\s*this\._convLive = 0;/);
  assert.match(ui, /stopVoice: function \(\) \{\s*this\._convLive = 0;/);
});

test('la ventana para contestar es de 30 s', () => {
  assert.match(main, /SystemClock\.elapsedRealtime\(\) - j < 30000/);
});
