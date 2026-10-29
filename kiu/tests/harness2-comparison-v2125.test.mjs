/* Harness²: comparación controlada del detector de peticiones web corteses.
 * No modifica automáticamente el router ni llama a servicios externos.
 * Ejecutar: node --test tests/harness2-comparison-v2125.test.mjs
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
// Detector anterior de 2.12.3: no acepta prefijos de cortesía ni signos iniciales.
const baselineWeb = /^(busca|buscar|busca|googlea|google|investiga|averigua|consulta en internet|busca en la web)(?:\s|$)/;
const normalize = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const CASES = [
  { text: 'Busca documentación de Kotlin', route: 'search', shouldImprove: false },
  { text: 'Investiga documentación oficial de Android', route: 'search', shouldImprove: false },
  { text: 'Por favor, busca documentación de Kotlin', route: 'search', shouldImprove: true },
  { text: '¿Puedes investigar documentación oficial de Android?', route: 'search', shouldImprove: true },
  { text: 'Oye, googlea cómo configurar Gradle', route: 'search', shouldImprove: true },
  { text: '¿Podrías buscar en la web ejemplos de React?', route: 'search', shouldImprove: true },
  { text: 'Disculpa, averigua la documentación de Git', route: 'search', shouldImprove: true },
  { text: 'Por favor, explícame qué es una API', route: 'code', shouldImprove: false },
  { text: 'Actualmente uso una aplicación para estudiar', route: 'chat', shouldImprove: false },
  { text: 'Tengo noticias buenas de mi familia', route: 'chat', shouldImprove: false },
];
test('Harness² comparación A/B: la variante detecta cortesía sin perder rutas anteriores', () => {
  const { Rtr } = boot();
  const rows = CASES.map(c => {
    const baseline = baselineWeb.test(normalize(c.text)) ? 'search' : 'other';
    const candidate = Rtr.classify(c.text, false, false);
    return { ...c, baseline, candidate };
  });
  const regressions = rows.filter(r => !r.shouldImprove && r.candidate !== r.route);
  const improvements = rows.filter(r => r.shouldImprove && r.baseline !== 'search' && r.candidate === r.route);
  assert.equal(regressions.length, 0, `Regresiones: ${JSON.stringify(regressions)}`);
  assert.equal(improvements.length, 5, `Mejoras detectadas: ${improvements.length}/5`);
  assert.ok(rows.filter(r => !r.shouldImprove && r.route === 'search').every(r => r.candidate === 'search'));
});
test('Harness² comparación A/B: las consultas generales no se desvían a web', () => {
  const { Rtr } = boot();
  for (const text of ['¿Qué es la fotosíntesis?', '¿Cómo se usa actualmente un bucle for?', 'Tengo noticias buenas de mi familia', '¿Qué significa precio en economía?']) {
    assert.equal(Rtr.classify(text, false, false), 'chat', `Ruta inesperada para: ${text}`);
  }
});
