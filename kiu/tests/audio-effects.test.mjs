import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const base = new URL('../app/src/main/java/com/kiu/agent/', import.meta.url);
const helper = readFileSync(new URL('KiuAudioEffects.java', base), 'utf8');
const dictation = readFileSync(new URL('OfflineDictation.java', base), 'utf8');
const wake = readFileSync(new URL('WakeWordEngine.java', base), 'utf8');

test('los efectos de audio son opcionales y se asocian a la sesión de AudioRecord', () => {
  assert.match(helper, /AcousticEchoCanceler\.create\(session\)/);
  assert.match(helper, /NoiseSuppressor\.create\(session\)/);
  assert.match(helper, /AutomaticGainControl\.create\(session\)/);
  assert.match(helper, /isAvailable\(\)/);
  assert.match(helper, /void close\(\)/);
});

test('el dictado offline activa efectos y los libera en finally', () => {
  assert.match(dictation, /AudioSource\.VOICE_COMMUNICATION/);
  assert.match(dictation, /KiuAudioEffects\.attach\(ar\)/);
  assert.match(dictation, /audioEffects\.close\(\)/);
});

test('la escucha de palabra de activación activa efectos y los libera al rotar el micrófono', () => {
  assert.match(wake, /AudioSource\.VOICE_COMMUNICATION/);
  assert.match(wake, /KiuAudioEffects\.attach\(a\)/);
  assert.match(wake, /audioEffects\.close\(\)/);
});
