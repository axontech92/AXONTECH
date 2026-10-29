import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const ww = readFileSync(new URL('../app/src/main/java/com/kiu/agent/WakeWordEngine.java', import.meta.url), 'utf8');

test('pause() suelta el micrófono de verdad (no solo una bandera)', () => {
  const m = ww.slice(ww.indexOf('public void pause()'), ww.indexOf('public void resume()'));
  assert.match(m, /paused\.set\(true\)/);
  assert.match(m, /a\.stop\(\)/);
});

test('el bucle no lee mientras hay un comando y vuelve a abrir el micrófono después', () => {
  assert.match(ww, /if \(paused\.get\(\) \|\| MainActivity\.COMMAND_BUSY\) \{\s*try \{ a\.stop\(\); \}/);
  assert.match(ww, /a\.startRecording\(\);\s*\} catch \(Throwable t\) \{\s*err = "microfono: " \+ t;/);
});

test('un read() que falla porque pause() paró la grabación no cuenta como micrófono muerto', () => {
  assert.match(ww, /if \(n <= 0\) \{\s*if \(paused\.get\(\) \|\| MainActivity\.COMMAND_BUSY\) \{\s*continue;/);
});
