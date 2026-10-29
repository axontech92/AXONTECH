import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const rd = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const svc = rd('app/src/main/java/com/kiu/agent/KiuService.java');
const main = rd('app/src/main/java/com/kiu/agent/MainActivity.java');
const ui = rd('app/src/main/assets/www/js/app/app-ui.js');
const html = rd('app/src/main/assets/www/index.html');

test('«Kiu» solo abre el micrófono de la app', () => {
  const m = main.slice(main.indexOf('static void wakePing'), main.indexOf('static String lastSpokenText'));
  assert.match(m, /wakeHitAndListen\(context\)/);
  assert.match(m, /KiuService\.AWAKE = false/);
});

test('el servicio sigue oyendo mientras Kiu habla y solo corta con «Kiu» suelto o palabra de parada sola', () => {
  assert.match(svc, /MainActivity\.SPEAKING && !MainActivity\.bargeInOn\(this\)/);
  assert.match(svc, /return bargeIn\(stringArrayList\)/);
  assert.match(svc, /\^\(para\|basta\|silencio\|detente\|callate\|alto\|stop\|espera\|ya basta\|ya esta\)\$/);
  assert.match(svc, /!WAKE\.matcher\(said\)\.find\(\)/);
});

test('hay interruptor, puente y toque en la pantalla de llamada para callar a Kiu', () => {
  assert.match(html, /id="tg-barge"/);
  assert.match(main, /public void setBargeIn\(boolean z\)/);
  assert.match(ui, /bridge\('stopSpeak'\); setTimeout\(function \(\) \{ bridge\('listen'\)/);
});

test('el motor trabado pensando se corta solo', () => {
  assert.match(ui, /_thinkWd/);
  assert.match(ui, /Kiu\.pending/);
});
