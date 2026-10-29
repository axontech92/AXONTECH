/* pantalla-v2148.test.mjs — v2.14.8: la pantalla, por fin.
 *
 *   · LA TARJETA DEL MOTOR, como en el rediseño: la fila de estado, el MODELO
 *     en monoespaciado (que antes estaba al final de cada respuesta, como
 *     ruido) y la RAM como barra comparable.
 *   · LAS ACCIONES DEL AGENTE COMO TARJETAS en el chat, no como un párrafo
 *     más: "Linterna ✓ · Acción ejecutada" (el rediseño: acciones, no logs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cargarAgente } from './evals/harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.join(here, '..');
const WWW = path.join(raiz, 'app', 'src', 'main', 'assets', 'www');
const htmlSrc = readFileSync(path.join(WWW, 'index.html'), 'utf8');
const css = readFileSync(path.join(WWW, 'css', 'app.css'), 'utf8');
const uiSrc = readFileSync(path.join(WWW, 'js', 'app', 'app-ui.js'), 'utf8');
const agSrc = readFileSync(path.join(WWW, 'js', 'kiu-agente.js'), 'utf8');

/* ================= 1 · la tarjeta del motor ================= */
test('la tarjeta del motor tiene el modelo y la RAM', () => {
  assert.match(htmlSrc, /id="motor-model"/, 'el modelo en monoespaciado');
  assert.match(htmlSrc, /id="motor-ram-fill"/, 'la barra de RAM');
  assert.match(htmlSrc, /id="motor-ram-txt"/, 'el texto de la RAM');
  assert.match(css, /\.motor-model\{[^}]*monospace/, 'el modelo va en monoespaciado');
  assert.match(css, /\.motor-card\{[^}]*flex-direction:column/, 'la tarjeta es una columna');
});

test('el motor muestra el modelo cargado y la RAM', () => {
  const { ctx } = cargarAgente();
  ctx.S.kiu = { ok: true, name: 'qwen2.5-0.5b-instruct-q4_k_m.gguf' };
  ctx.Sys = { d: { ramTotal: 10.9 * 1073741824, ramAvail: 2.4 * 1073741824 } };
  /* el sandbox no tiene DOM real: se comprueba el código que llena los datos */
  assert.match(uiSrc, /getElementById\('motor-model'\)/, 'el modelo se llena');
  assert.match(uiSrc, /getElementById\('motor-ram-fill'\)/, 'la RAM se llena');
  assert.match(uiSrc, /ramAvail/, 'de la memoria real del sistema');
  assert.match(uiSrc, /textContent = 'RAM ' \+ \(usado \/ 1073741824\)\.toFixed\(1\)/, 'con GB legibles');
});

/* ================= 2 · las acciones como tarjetas ================= */
test('existe la tarjeta de acción en el chat', () => {
  assert.match(css, /\.toolcard\{/, 'la tarjeta');
  assert.match(css, /\.toolcard \.ti/, 'el ícono');
  assert.match(css, /\.toolcard\.falló/, 'y el estado de fallo');
  assert.match(uiSrc, /insertToolCard: function/, 'la función que la inserta');
  assert.match(uiSrc, /agentResultado: function/, 'y la que la actualiza con el resultado');
});

test('el agente avisa el resultado de la herramienta, no solo que empezó', () => {
  assert.match(agSrc, /o\.resultado\(t\.name, ok, txt\)/, 'el agente pasa el resultado');
  assert.match(uiSrc, /resultado: function \(tool, ok, txt\)/, 'y la app lo recibe');
});

test('la tarjeta se inserta antes de la respuesta y se actualiza con el resultado', () => {
  const { ctx } = cargarAgente();
  const App = ctx.App;
  assert.equal(typeof App.insertToolCard, 'function');
  assert.equal(typeof App.agentResultado, 'function');
  /* se inserta en el chat y queda referenciada para poder actualizarla */
  const chat = ctx.document.getElementById('chat-messages');
  App.insertToolCard('set_alarm');
  assert.ok(App._toolCard, 'la tarjeta queda referenciada');
  App.agentResultado('set_alarm', true, 'Listo: alarma a las 7.');
  assert.equal(App._toolCard, null, 'después de actualizarse, se suelta');
});

test('la tarjeta de acción no se mete en el historial (es UI, no conversación)', () => {
  /* si fuera un mensaje, aparecería en los chats guardados y en el resumen */
  assert.match(uiSrc, /insertToolCard: function \(tool\) \{[\s\S]{0,400}createElement/, 'se crea a mano, no como mensaje');
  assert.doesNotMatch(uiSrc, /insertToolCard: function \(tool\) \{[\s\S]{0,400}pushMsg/, 'no se guarda en el historial');
});
