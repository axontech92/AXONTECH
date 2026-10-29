/* react.test.mjs — tanda 5 (sección 4-c): bucle ReAct de pocos pasos.
 * Con stubs de KiuBrain y RAG se verifica: partición del pedido en pasos,
 * clasificación de herramientas, bucle con observaciones, composición del
 * final, tope de pasos y honestidad (handled:false cuando nada se puede).
 * node --test tests/react.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WWW = path.join(HERE, '..', 'app', 'src', 'main', 'assets', 'www');

function loadReact(stubs) {
  const ctx = {
    window: {},
    Math, Date, JSON, RegExp, String, Number, Array, Object,
    parseInt, parseFloat, isNaN,
  };
  if (stubs && stubs.brain) ctx.window.KiuBrain = stubs.brain;
  if (stubs && stubs.rag) ctx.window.RAG = stubs.rag;
  vm.createContext(ctx);
  vm.runInContext(readFileSync(path.join(WWW, 'js', 'react.js'), 'utf8'), ctx, { filename: 'react.js' });
  const R = ctx.window.KiuReAct;
  assert.ok(R, 'window.KiuReAct debe quedar definido tras cargar react.js');
  return R;
}

const BRAIN = {
  reply(q) {
    const n = q.toLowerCase();
    if (n.includes('alarma')) return { handled: true, text: 'Alarma puesta a las 7:00.' };
    if (n.includes('linterna')) return { handled: true, text: 'Linterna encendida.' };
    if (n.includes('cuanto es 2 x 3') || n.includes('cuánto es 2 x 3')) return { handled: true, text: '6' };
    return { handled: false };
  },
};

const RAG = {
  on: true,
  hits() { return [{ name: 'receta.txt', doc: 'd1', ci: 0, text: 'fideos con tuco, 20 minutos', s: 3.2 }]; },
};

test('splitTasks: parte por conectores y comas, con tope interno', () => {
  const R = loadReact({});
  /* comparación realm-segura (los arrays nacen dentro de la VM) */
  assert.equal(
    R.splitTasks('poné alarma a las 7 y encende la linterna').join('|'),
    ['poné alarma a las 7', 'encende la linterna'].join('|'),
  );
  assert.equal(R.splitTasks('una sola cosa').length, 1);
  assert.equal(R.splitTasks('').join('|'), '');
});

test('classifyStep: documentos vs cerebro', () => {
  const R = loadReact({});
  assert.equal(R.classifyStep('busca en mis documentos la receta de ñoquis'), 'docs');
  assert.equal(R.classifyStep('poné alarma a las 7'), 'cerebro');
  assert.equal(R.classifyStep('cuanto es 2 x 3'), 'cerebro');
});

test('suitable: sí para multi-paso con herramientas, no para charla simple', () => {
  const R = loadReact({ brain: BRAIN });
  assert.equal(R.suitable('poné alarma a las 7 y encende la linterna'), true);
  assert.equal(R.suitable('planificame el día'), true, 'explícito: planificame');
  assert.equal(R.suitable('hola cómo andas'), false);
  assert.equal(R.suitable('poné alarma a las 7'), false, 'una sola tarea');
});

test('run: dos pasos resueltos → final numerado con ambas observaciones', () => {
  const R = loadReact({ brain: BRAIN, rag: RAG });
  const out = R.run('poné alarma a las 7 y encende la linterna');
  assert.equal(out.handled, true);
  assert.ok(out.text.includes('1)'), 'numerado');
  assert.ok(out.text.includes('Alarma puesta'), 'obs 1');
  assert.ok(out.text.includes('Linterna encendida'), 'obs 2');
  assert.equal(out.trace.length, 2, 'traza de 2 pasos');
  assert.ok(R.lastTrace.length === 2, 'lastTrace expuesta');
});

test('run: paso de documentos usa RAG y el resto el cerebro', () => {
  const R = loadReact({ brain: BRAIN, rag: RAG });
  const out = R.run('busca en mis notas la receta y encende la linterna');
  assert.equal(out.handled, true);
  assert.ok(out.text.includes('receta.txt'), 'observación del RAG');
  assert.ok(out.text.includes('Linterna encendida'), 'observación del cerebro');
});

test('run: nada resuelto → handled:false para no secuestrar el flujo', () => {
  const R = loadReact({ brain: { reply() { return { handled: false }; } }, rag: { on: true, hits() { return []; } } });
  const out = R.run('cuál es la capital de kiribati y quién ganó en 1987');
  assert.equal(out.handled, false);
  assert.equal(out.text, '');
});

test('run: tope de 4 pasos', () => {
  const R = loadReact({ brain: BRAIN });
  const out = R.run('poné alarma a las 7 y encende la linterna y cuanto es 2 x 3 y que hora es y mañana que dia es y otra cosa mas');
  assert.ok(out.trace.length <= R.MAX_STEPS, 'máx ' + R.MAX_STEPS + ' pasos, fue ' + out.trace.length);
});

test('run: si sobran pasos sin resolver, lo dice honestamente', () => {
  const R = loadReact({ brain: BRAIN, rag: { on: true, hits() { return []; } } });
  const out = R.run('poné alarma a las 7 y resolveme el teorema de fermat');
  assert.equal(out.handled, true);
  assert.ok(/no lo pude resolver/.test(out.text), 'avisa lo que quedó: ' + out.text);
});

test('searchDocs: el stub viejo con search() string ya no confunde al paso docs', () => {
  /* tanda 8: RAG.search devuelve STRING (contrato real); react ahora usa hits().
     Con un RAG que solo tiene search (stub desactualizado), searchDocs no
     inventa basura: devuelve null y el paso queda sin observación. */
  const R = loadReact({ brain: BRAIN, rag: { on: true, search() { return 'texto plano inyectable'; } } });
  const out = R.run('busca en mis notas la receta y encende la linterna');
  assert.equal(out.handled, true);
  assert.ok(out.trace[0].obs === null, 'sin hits no hay observación');
  assert.ok(out.text.includes('Linterna encendida'));
});
