import test from 'node:test';
import assert from 'node:assert/strict';
import { newSandbox, loadAll } from './helpers.mjs';

function boot() {
  const sb = newSandbox();
  loadAll(sb, ['js/kiu-migrate.js', 'js/i18n.js', 'js/brain.js', 'js/skills.js', 'js/react.js', 'js/tools.js', 'js/kiu-agente.js', 'js/kiu-estados.js', 'js/kiu-avatar.js', 'js/kiu-avatar-boot.js', 'js/local-embeddings.js', 'js/rag-worker.js', 'js/rag.js', 'js/kiu-secure.js', 'js/app/env.js', 'js/app/state.js', 'js/app/catalog.js', 'js/app/models.js', 'js/app/motor.js']);
  const spoken = [];
  sb.App = { speak: (s) => spoken.push(s) };
  return { sb, spoken };
}

test('voz streaming: encola solo oraciones completas y espera al fin de cada utterance', () => {
  const { sb, spoken } = boot();
  const T = sb.KiuSentenceTTS;
  T.begin(true);
  T.push('Hola. ');
  assert.deepEqual(spoken, ['Hola.']);
  T.push('Hola. Segunda oración. Tercera');
  assert.deepEqual(spoken, ['Hola.']);
  assert.equal(T.onDone(), true);
  assert.deepEqual(spoken, ['Hola.', 'Segunda oración.']);
  T.finish('Hola. Segunda oración. Tercera');
  assert.equal(T.onDone(), true);
  assert.deepEqual(spoken, ['Hola.', 'Segunda oración.', 'Tercera']);
  assert.equal(T.onDone(), false);
});

test('voz streaming: no pronuncia bloques de código ni llamadas a herramientas', () => {
  const { sb, spoken } = boot();
  const T = sb.KiuSentenceTTS;
  T.begin(true);
  T.push('Resultado listo. ```js\nalert(1)');
  assert.deepEqual(spoken, []);
  T.finish('Resultado listo. ```js\nalert(1)```');
  assert.deepEqual(spoken, []);
  T.begin(true);
  T.push('<tool_call>{"name":"set_alarm"}</tool_call>');
  assert.deepEqual(spoken, []);
});

test('voz streaming: desactivada no genera llamadas al TTS', () => {
  const { sb, spoken } = boot();
  const T = sb.KiuSentenceTTS;
  T.begin(false);
  T.push('Hola.');
  T.finish('Hola.');
  assert.deepEqual(spoken, []);
});


test('voz streaming: una línea completa termina chunk aunque no tenga puntuación', () => {
  const { sb, spoken } = boot();
  const T = sb.KiuSentenceTTS;
  T.begin(true);
  T.push('Primera línea\n');
  assert.deepEqual(spoken, ['Primera línea']);
  T.push('Primera línea\nSegunda línea\n');
  assert.equal(T.onDone(), true);
  assert.deepEqual(spoken, ['Primera línea', 'Segunda línea']);
});
