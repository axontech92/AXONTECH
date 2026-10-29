/* Harness² Probe v2: evaluación reproducible y ampliada del enrutador KIU.
 * Ejecutar: node --test tests/harness2-probe.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { newSandbox, loadAll } from './helpers.mjs';
const SCRIPTS = [
  'js/kiu-migrate.js', 'js/i18n.js', 'js/brain.js', 'js/skills.js', 'js/react.js', 'js/tools.js',
  'js/kiu-agente.js', 'js/kiu-estados.js', 'js/kiu-avatar.js', 'js/kiu-avatar-boot.js',
  'js/rag-worker.js', 'js/rag.js', 'js/kiu-secure.js', 'js/app/env.js', 'js/app/memoria.js', 'js/app/state.js',
  'js/app/catalog.js', 'js/app/models.js', 'js/app/motor.js', 'js/app/diag-voz.js', 'js/app/app-ui.js',
];
function boot() { const sb = newSandbox(); loadAll(sb, SCRIPTS); return sb; }
const CASES = [
  { id: 'chat-factual', text: '¿Qué es la fotosíntesis?', expected: 'chat' },
  { id: 'chat-emotion', text: 'Hoy me siento mal, ¿qué hago?', expected: 'chat' },
  { id: 'chat-current-word', text: 'Actualmente trabajo en una panadería, ¿qué estudio?', expected: 'chat' },
  { id: 'web-news', text: 'Dame las últimas noticias', expected: 'search' },
  { id: 'web-price', text: 'Precio del dólar hoy', expected: 'search' },
  { id: 'web-weather', text: '¿Cómo está el clima hoy?', expected: 'search' },
  { id: 'web-explicit', text: 'Busca en internet documentación de React', expected: 'search' },
  { id: 'code', text: 'Revisa este código JavaScript y encuentra el bug', expected: 'code' },
  { id: 'reasoning', text: 'Explícame paso a paso por qué cambia la hora en invierno', expected: 'reason' },
  { id: 'long-message', text: 'Quiero que me ayudes a pensar en una decisión importante. '.repeat(6), expected: 'reason' },
  { id: 'image', text: '¿Qué aparece en esta imagen?', image: true, expected: 'vision' },
  { id: 'voice-chat', text: 'Cuéntame algo interesante', voice: true, expected: 'voice' },
  { id: 'chat-temporal-howto', text: '¿Cómo se usa actualmente un bucle for?', expected: 'chat' },
  { id: 'chat-family-news', text: 'Tengo noticias buenas de mi familia', expected: 'chat' },
  { id: 'chat-price-concept', text: '¿Qué significa la palabra precio en economía?', expected: 'chat' },
  { id: 'web-explicit-investigate', text: 'Investiga documentación oficial de Android', expected: 'search' },
  { id: 'web-exchange-live', text: '¿Cuál es el tipo de cambio del euro ahora mismo?', expected: 'search' },
  { id: 'code-python', text: 'Corrige este script Python que falla', expected: 'code' },
  { id: 'reason-compare', text: 'Compara las ventajas y desventajas de dos opciones', expected: 'reason' },
  { id: 'chat-normal-question', text: '¿Qué puedo cocinar con arroz y frijoles?', expected: 'chat' },
  { id: 'web-polite-search', text: 'Por favor, busca en internet documentación de Kotlin', expected: 'search' },
  { id: 'web-polite-research', text: '¿Puedes investigar documentación oficial de Android?', expected: 'search' },
  { id: 'web-polite-google', text: 'Oye, googlea cómo configurar Gradle', expected: 'search' },
  { id: 'chat-polite-concept', text: 'Por favor, explícame qué es un API', expected: 'code' },
];
test('Harness² Probe: matriz de enrutamiento y score reproducible', () => {
  const { Rtr } = boot();
  const results = CASES.map(c => {
    const actual = Rtr.classify(c.text, !!c.image, !!c.voice);
    return { id: c.id, expected: c.expected, actual, pass: actual === c.expected };
  });
  const passed = results.filter(r => r.pass).length;
  const score = Math.round((passed / results.length) * 1000) / 10;
  assert.equal(results.length, CASES.length);
  assert.equal(passed, results.length,
    `Harness² Probe: ${passed}/${results.length} (${score}%). Casos fallidos:\n` +
    results.filter(r => !r.pass).map(r => `${r.id}: esperado=${r.expected}, actual=${r.actual}`).join('\n'));
});
test('Harness² Probe: cada decisión conserva motivo y no registra el texto', () => {
  const { Rtr } = boot();
  Rtr.clearTrace();
  for (const c of CASES) Rtr.classify(c.text, !!c.image, !!c.voice);
  const trace = Rtr.getTrace();
  assert.equal(trace.length, Math.min(CASES.length, 40));
  assert.ok(trace.every(d => typeof d.reason === 'string' && d.reason.length > 0));
  assert.ok(trace.every(d => !Object.hasOwn(d, 'text')));
  assert.ok(trace.every(d => typeof d.length === 'number'));
});
