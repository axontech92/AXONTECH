/* evals.test.mjs — v2.14.2: el arnés de evaluación del agente.
 *
 * Lo que se verifica acá, sin modelo de verdad (el arnés tiene que poder
 * correr en el CI, sin red y sin GPU):
 *
 *   1. EL ARNÉS FUNCIONA. Con un modelo guionizado perfecto, el acierto es
 *      100 %; con uno que se equivoca, el arnés lo detecta. Si el arnés
 *      siempre dice que pasa, no está midiendo nada.
 *   2. EL JUEGO ESTÁ BIEN ARMADO. Cada escenario apunta a una herramienta que
 *      EXISTE, con argumentos que el esquema ACEPTA. Si un escenario apuntaba
 *      a una herramienta inexistente, el arnés mediría siempre un acierto
 *      imposible.
 *   3. LA COBERTURA ES REAL. Cada herramienta del registro tiene al menos un
 *      escenario: una herramienta que ningún pedido alcanza está muerta,
 *      aunque los tests condongan.
 *
 * El modelo de verdad (llama.cpp server, Ollama, LM Studio) se corre con
 * `node tests/evals/run.mjs`; ver el archivo.
 *
 * node --test tests/evals.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ESCENARIOS, UMBRALES } from './evals/escenarios.mjs';
import { correrEscenarios, reporte, modeloGuion, cargarAgente } from './evals/harness.mjs';

/* ================= 1 · el arnés mide de verdad ================= */

test('el arnés: un modelo que acierta siempre da 100 %', async () => {
  /* el modelo guionizado devuelve, para cada pedido, la herramienta correcta
     (deducida del propio escenario) */
  const guiones = {};
  for (const s of ESCENARIOS) {
    guiones[s.pedido] = [JSON.stringify({ tool: s.espera.tool, args: s.ejemplo || {} }), '{"listo":true}'];
  }
  const corrida = await correrEscenarios({ modelo: modeloGuion(guiones) });
  assert.equal(corrida.metricas.total, ESCENARIOS.length);
  assert.equal(corrida.metricas.aciertos, ESCENARIOS.length, 'el modelo perfecto tiene que acertar todo');
  assert.ok(corrida.metricas.pasosPromedio >= 1);
  assert.match(reporte(corrida).texto, /ARNÉS: OK/);
});

test('el arnés: con un modelo perfecto NO hay no-op (las herramientas funcionan)', async () => {
  /* v2.14.2 · este test encontró dos bugs reales que los tests de código no
     veían: device_action con "espacio" (el cerebro no entendía la palabra
     suelta) y el cancelamiento de una alarma con el título parafraseado
     ("desayuno" contra "desayunar"). Si el entorno está bien y el modelo
     acierta, NADA puede quedar sin hacer. */
  const guiones = {};
  for (const s of ESCENARIOS) {
    guiones[s.pedido] = [JSON.stringify({ tool: s.espera.tool, args: s.ejemplo || {} }), '{"listo":true}'];
  }
  const corrida = await correrEscenarios({ modelo: modeloGuion(guiones) });
  const noops = corrida.filas.filter((f) => f.noop).map((f) => f.id);
  assert.equal(noops.join(','), '', 'pedidos sin hacer nada con un modelo que acierta: ' + noops.join(', '));
});

test('el arnés: un modelo que se equivida NO pasa', async () => {
  /* el mismo modelo pero siempre eligiendo `now`: el arnés tiene que verlo */
  const guiones = {};
  for (const s of ESCENARIOS) guiones[s.pedido] = ['{"tool":"now","args":{}}', '{"listo":true}'];
  const corrida = await correrEscenarios({ modelo: modeloGuion(guiones) });
  assert.ok(corrida.metricas.acierto < 1, 'un modelo que siempre contesta lo mismo no puede acertar todo');
  const r = reporte(corrida);
  assert.match(r.texto, /ARNÉS: FALLA/, 'y el arnés tiene que fallar');
  assert.equal(r.pasa, false);
});

test('el arnés: un modelo que no hace nada es no-op', async () => {
  const corrida = await correrEscenarios({ modelo: modeloGuion({}) });
  assert.equal(corrida.metricas.noop, 1, 'si el modelo no elige nada, no se hizo nada');
  assert.equal(corrida.metricas.acierto, 0);
});

/* ================= 2 · el juego está bien armado ================= */

test('cada escenario apunta a una herramienta que existe', () => {
  const { A } = cargarAgente();
  for (const s of ESCENARIOS) {
    assert.ok(A.get(s.espera.tool), 'la herramienta "' + s.espera.tool + '" del escenario ' + s.id + ' no existe');
    for (const alt of s.espera.acepta || []) {
      assert.ok(A.get(alt), 'la alternativa "' + alt + '" del escenario ' + s.id + ' no existe');
    }
  }
});

test('cada escenario tiene un id único y un pedido con contenido', () => {
  const ids = new Set();
  for (const s of ESCENARIOS) {
    assert.ok(s.id && !ids.has(s.id), 'id repetido o vacío: ' + s.id);
    ids.add(s.id);
    assert.ok(s.pedido && s.pedido.length > 3, 'pedido vacío en ' + s.id);
    assert.ok(s.espera && s.espera.tool, 'falta la herramienta esperada en ' + s.id);
  }
  assert.ok(ESCENARIOS.length >= 25, 'el juego tiene que ser grande: hay ' + ESCENARIOS.length);
});

test('los argumentos esperados de un escenario validan contra el esquema', () => {
  const { A } = cargarAgente();
  for (const s of ESCENARIOS) {
    if (!s.espera.args) continue;
    const v = A.validate(s.espera.tool, s.espera.args);
    assert.equal(v.ok, true, 'el escenario ' + s.id + ' pide argumentos que el esquema rechaza: ' + v.err);
  }
});

test('el ejemplo de cada escenario es ejecutable (pasa la validación del esquema)', () => {
  const { A } = cargarAgente();
  for (const s of ESCENARIOS) {
    const v = A.validate(s.espera.tool, s.ejemplo || {});
    assert.equal(v.ok, true, 'el escenario ' + s.id + ' no es ejecutable: ' + v.err);
  }
});

/* ================= 3 · cobertura: ninguna herramienta muerta ================= */

test('toda herramienta del registro tiene al menos un escenario', () => {
  const { A } = cargarAgente();
  const cubiertas = new Set();
  for (const s of ESCENARIOS) {
    cubiertas.add(s.espera.tool);
    for (const alt of s.espera.acepta || []) cubiertas.add(alt);
  }
  const muertas = A.toolNames().filter((n) => !cubiertas.has(n));
  /* el array viene de la VM: se compara como texto, no por identidad */
  assert.equal(muertas.join(','), '', 'herramientas sin ningún escenario: ' + muertas.join(', '));
});

test('el arnés usa los umbrales del repo y no los permite aflojar sin querer', () => {
  assert.ok(UMBRALES.acierto >= 0.8, 'el acierto no puede bajar del 80 %');
  assert.ok(UMBRALES.pasosMax <= 3);
  assert.ok(UMBRALES.noopMax <= 0.1);
});

/* ================= 4 · las palabras clave tienen que servir =================
 * El arnés de evaluación encontró que la selección de herramientas fallaba
 * para la mitad de los pedidos reales: las palabras clave eran regex
 * demasiado angostas ("llévame al aeropuerto" no matcheaba nada) y, cuando
 * no matcheaba nada, se devolvían las 16 herramientas en el orden del
 * registro. El ejemplo del prompt era entonces el de set_alarm, y el modelo
 * copiaba el ejemplo: armaba una alarma donde le habían pedido un mapa.
 *
 * Este test ata las palabras clave a los pedidos REALES del arnés: para cada
 * escenario, la herramienta que va primera tiene que ser la correcta (o una
 * de las aceptables).
 */
test('para cada pedido real, la herramienta que va primera es la correcta', async () => {
  const { ESCENARIOS } = await import('./evals/escenarios.mjs');
  const { A } = cargarAgente();
  const malos = [];
  for (const s of ESCENARIOS) {
    const sel = A.seleccionar(s.pedido);
    const aceptadas = [s.espera.tool].concat(s.espera.acepta || []);
    if (!sel.length || !aceptadas.includes(sel[0])) {
      malos.push(s.id + ' (' + s.pedido + ') -> ' + (sel[0] || 'nada'));
    }
  }
  assert.equal(malos.join(' | '), '', 'estas peticiones no eligen bien la herramienta: ' + malos.join(' | '));
});
