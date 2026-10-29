/* agente.test.mjs — v2.9.1/2.9.2: que el MODELO elija herramientas.
 *
 * Hasta acá Kiu no era un agente: `brain.js` tenía ~200 regex que decidían qué
 * era cada pedido y el modelo solo redactaba la respuesta final. `kiu-agente.js`
 * agrega el registro de herramientas y el bucle que le pregunta al modelo qué
 * hacer.
 *
 * Lo que se fija acá, en orden de importancia:
 *
 *   1. SEGURIDAD. El modelo no ejecuta lo que quiere. Nombre inventado, argumento
 *      inventado, argumento obligatorio que falta → se rechaza, y el motivo vuelve
 *      al modelo. Esto separa "el modelo elige" de "el modelo decide".
 *   2. Parse. Un modelo chico devuelve ```json, JSON con trailing comma, comillas
 *      tipográficas, o dos objetos. Todo eso tiene que ser recuperable.
 *   3. Degradación. Sin modelo cargado el bucle no se usa: el flujo viejo sigue.
 *   4. Una sola fuente de verdad: el manifiesto del prompt y la validación salen
 *      del mismo `args`. No pueden desalinearse.
 *   5. El prefill se mide, no se estima (v2.9.2): cada decisión paga el prompt
 *      entero en la CPU del teléfono, y ahí está el cuello de botella del motor.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const here = path.dirname(fileURLToPath(import.meta.url));
const WWW = path.join(here, '..', 'app', 'src', 'main', 'assets', 'www');
const src = readFileSync(path.join(WWW, 'js', 'kiu-agente.js'), 'utf8');
const html = readFileSync(path.join(WWW, 'index.html'), 'utf8');
const uiSrc = readFileSync(path.join(WWW, 'js', 'app', 'app-ui.js'), 'utf8');
const stateSrc = readFileSync(path.join(WWW, 'js', 'app', 'state.js'), 'utf8');
const vendorSh = readFileSync(path.join(here, '..', 'scripts', 'vendor_llama.sh'), 'utf8');
const buildYml = readFileSync(path.join(here, '..', '.github', 'workflows', 'build.yml'), 'utf8');

/* Motor falso: devuelve una cola de respuestas ya escritas, como si el modelo
   fuera diciendo cada una. También guarda los prompts que recibió, que es lo que
   hay que inspeccionar (¿vio el error del intento anterior?). */
function cargar(opts = {}) {
  const ctx = {};
  ctx.window = ctx;
  const prompts = [];
  const cola = (opts.respuestas || []).slice();
  ctx.S = opts.S || { kiu: { ok: opts.sinModelo ? false : true } };
  ctx.Kiu = {
    ask(hist, maxT, cb) {
      prompts.push({ hist, maxT });
      const r = cola.shift();
      if (r === undefined) { cb({ ok: false, err: 'sin más respuestas' }); return; }
      cb(typeof r === 'string' ? { ok: true, text: r } : r);
    },
  };
  ctx.KiuBrain = opts.brain || { reply: () => ({ handled: false }), parseWhen: (t) => ({ when: null, whenTxt: t }) };
  ctx.KiuApp = opts.app || {};
  ctx.KiuState = { flash() { }, set() { }, clear() { } };
  ctx.RAG = opts.rag || { on: false };
  ctx.console = console;
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: 'kiu-agente.js' });
  return { A: ctx.KiuAgente, prompts, ctx };
}

/* Corre el bucle y devuelve su resultado. Se pasa {A, ...loQuePide} y se le saca
   el A: antes esta línea era `opts.A.run(opts.run, res)`, que tiraba todo lo
   demás y corría el bucle con opts vacíos. Los tests pasaban igual (el tope de
   pasos coincidía con MAX_STEPS por casualidad, y pedido solo va al prompt),
   que es justo el tipo de test que no prueba nada. */
const correr = (o) => new Promise((res) => {
  const { A, ...args } = o;
  A.run(args, res);
});

/* ================= 1 · seguridad: el modelo no ejecuta lo que quiere ========= */

test('una herramienta que no existe se rechaza Y el motivo vuelve al modelo', async () => {
  const { A, prompts } = cargar({ respuestas: ['{"tool":"hackear_satélite","args":{}}', '{"listo":true}'] });
  await correr({ A, pedido: 'x' });
  assert.equal(prompts.length, 2, 'hubo un segundo intento');
  const segundo = prompts[1].hist[0].content;
  assert.match(segundo, /hackear_sat.lite/, 'el motivo del rechazo nombra la herramienta inventada');
  assert.match(segundo, /no existe/);
  assert.match(segundo, /read_calendar/, 'y le recuerda cuáles SÍ existen');
});

test('un argumento que no está en el esquema se rechaza', () => {
  const A = cargar().A;
  const v = A.validate('set_alarm', { when: 'a las 7', color: 'azul' });
  assert.equal(v.ok, false);
  assert.match(v.err, /"color" no existe/);
  assert.match(v.err, /when, label/, 'y le dice cuáles son los reales (los nombres del esquema)');
});

test('un argumento obligatorio que falta se rechaza', () => {
  const v = cargar().A.validate('set_alarm', { label: 'llamar al dentist' });
  assert.equal(v.ok, false);
  assert.match(v.err, /falta el argumento obligatorio "when"/);
});

test('los tipos se validan, no se confían', () => {
  const A = cargar().A;
  assert.equal(A.validate('search_docs', { query: 'receta' }).ok, true);
  assert.equal(A.validate('set_alarm', { when: 123 }).ok, true, 'un número donde va texto se convierte');
  const v = A.validate('device_action', { what: 'linterna', target: { a: 1 } });
  assert.equal(v.args.target, '[object Object]', 'un objeto se aplana, no se inyecta sin querer');
});

test('un argumento gigante se rechaza (eso es prompt injection, no un dato)', () => {
  const v = cargar().A.validate('search_docs', { query: 'x'.repeat(5000) });
  assert.equal(v.ok, false);
  assert.match(v.err, /demasiado largo/);
});

test('las herramientas de efecto no se ejecutan si el nombre está mal escrito', async () => {
  const marcadas = [];
  const { A, prompts } = cargar({
    respuestas: ['{"tool":"call_contac","args":{"who":"mama"}}', '{"listo":true}'],
    brain: { reply: () => { marcadas.push(1); return { handled: false }; }, parseWhen: (t) => ({ when: null }) },
  });
  await correr({ A, pedido: 'llamá a mamá' });
  assert.equal(marcadas.length, 0, 'no se ejecutó nada');
  assert.equal(prompts.length, 2, 'se reintentó con el nombre correcto');
});

/* ================= 2 · parse de lo que devuelve el modelo ================== */

test('parsea las seis formas en que un modelo chico devuelve JSON', () => {
  const A = cargar().A;
  const casos = [
    '{"tool":"set_alarm","args":{"when":"a las 7"}}',
    '```json\n{"tool":"set_alarm","args":{"when":"a las 7"}}\n```',
    '```\n{"tool":"set_alarm","args":{"when":"a las 7"}}\n```',
    'Voy a usar la herramienta:\n{"tool":"set_alarm","args":{"when":"a las 7"}}\nlisto',
    '{"tool":"set_alarm","args":{"when":"a las 7"},}',
    '{\n  "tool": "set_alarm",\n  "args": {\n    "when": "a las 7",\n    "label": "despertar"\n  }\n}',
  ];
  for (const c of casos) {
    const d = A.parseDecision(c);
    assert.ok(d, 'no parseó: ' + c.slice(0, 40));
    assert.equal(d.tool, 'set_alarm', 'no extrajo la herramienta de: ' + c.slice(0, 30));
  }
});

test('entiende el formato de argumentos como string (OpenAI-style)', () => {
  const A = cargar().A;
  const d = A.parseDecision('{"tool":"set_alarm","args":"{\\"when\\":\\"a las 7\\"}"}');
  const r = A.readDecision(d);
  assert.equal(r.name, 'set_alarm');
  assert.equal(r.raw.when, 'a las 7');
});

test('un JSON roto da null, no una media decisión', () => {
  const A = cargar().A;
  assert.equal(A.parseDecision('{"tool":"set_alarm",'), null);
  assert.equal(A.parseDecision('no sé qué hacer'), null);
  assert.equal(A.parseDecision('[1,2,3]'), null, 'un array no es una decisión');
  assert.equal(A.parseDecision(''), null);
});

test('"listo" se reconoce, pero una herramienta presente gana', () => {
  const A = cargar().A;
  for (const v of ['{"listo":true}', '{"listo":"sí"}', '{"done":"listo"}', '{}']) {
    assert.equal(A.isDone(A.parseDecision(v)), true, 'no reconoció ' + v);
  }
  /* el bug de v2.9.1: esto se leía como "terminado" y el bucle cortaba antes de
     ejecutar nada. Un modelo que no entendió "si no necesitás ninguna:
     {listo:true}" y devuelve solo la herramienta dejaba a Kiu mudo. */
  assert.equal(A.isDone(A.parseDecision('{"tool":"set_alarm","args":{"when":"a las 7"}}')), false);
  assert.equal(A.isDone(A.parseDecision('{"tool":"set_alarm","args":{}}')), false);
});

/* ================= 3 · el bucle ================= */

test('el bucle ejecuta, recoge la observación y para cuando el modelo dice listo', async () => {
  const puestos = [];
  const { A, prompts } = cargar({
    respuestas: ['{"tool":"set_alarm","args":{"when":"mañana a las 7","label":"despertar"}}', '{"listo":true}'],
    app: { addReminder: (titulo, when) => { puestos.push([titulo, when]); return true; } },
    brain: { reply: () => ({ handled: false }), parseWhen: () => ({ when: new Date(2030, 0, 1, 7), whenTxt: 'mañana a las 7' }) },
  });
  const r = await correr({ A, pedido: 'despertame mañana a las 7' });
  assert.equal(puestos.length, 1, 'la alarma se puso una vez');
  assert.equal(puestos[0][0], 'despertar');
  assert.equal(r.ok, true);
  assert.match(r.text, /Listo: despertar/);
  assert.equal(r.steps, 2, 'un paso para actuar, otro para confirmar');
  assert.match(prompts[1].hist[0].content, /YA INTENTASTE/);
  assert.match(prompts[1].hist[0].content, /Listo: despertar/);
});

test('si la herramienta falla, el error vuelve al modelo y NO se reporta como hecho', async () => {
  const { A, prompts } = cargar({
    respuestas: [
      '{"tool":"set_alarm","args":{"when":"no sé cuándo"}}',
      '{"tool":"set_alarm","args":{"when":"a las 7"}}',
      '{"listo":true}',
    ],
    app: { addReminder: () => true },
    brain: {
      reply: () => ({ handled: false }),
      parseWhen: (t) => (/no sé/.test(t)
        ? { when: null, whenTxt: '?' }
        : { when: new Date(2030, 0, 1, 7), whenTxt: 'a las 7' }),
    },
  });
  const r = await correr({ A, pedido: 'poné una alarma' });
  assert.match(prompts[1].hist[0].content, /no entendí el horario/,
    'el modelo recibe el motivo exacto del fallo, no un "algo salió mal"');
  assert.equal(r.ok, true, 'el segundo intento sí funcionó');
  assert.match(r.text, /Listo/, 'y lo que se hizo se reporta, no el fallo');
});

test('sin modelo cargado el bucle no se usa y no rompe nada', async () => {
  const { A, prompts } = cargar({ sinModelo: true, respuestas: ['{"listo":true}'] });
  const r = await correr({ A, pedido: 'poné una alarma' });
  assert.equal(r.ok, false);
  assert.match(r.err, /sin modelo cargado/);
  assert.equal(prompts.length, 0, 'ni se consultó al motor');
});

test('el bucle corta al tope de pasos (no se queda en bucle)', async () => {
  const { A, prompts } = cargar({
    respuestas: Array.from({ length: 20 }, () => '{"tool":"set_alarm","args":{"when":"a las 7"}}'),
    app: { addReminder: () => true },
    brain: { reply: () => ({ handled: false }), parseWhen: () => ({ when: new Date(), whenTxt: 'a las 7' }) },
  });
  const r = await correr({ A, pedido: 'poné alarmas', maxSteps: 3 });
  assert.equal(r.steps, 3, 'se paró en el tope');
  assert.equal(prompts.length, 3);
});

test('la decisión se pide corta: 120 tokens por defecto, no 512', async () => {
  const { A, prompts } = cargar({ respuestas: ['{"listo":true}'] });
  await correr({ A, pedido: 'x' });
  assert.ok(prompts[0].maxT <= 200, 'una decisión de herramienta no necesita un párrafo');
});

/* ================= 4 · una sola fuente de verdad ================= */

test('el manifiesto del prompt y la validación salen del mismo esquema', () => {
  const A = cargar().A;
  const m = A.manifest();
  for (const n of A.toolNames()) {
    assert.ok(m.includes(n + '('), n + ' esta en el prompt');
    const t = A.get(n);
    for (const k of Object.keys(t.args)) {
      assert.ok(m.includes(k + (t.args[k].required ? ':' : '?:')), n + '.' + k + ' esta documentado');
    }
  }
});

test('el llamador puede acotar qué herramientas ve el modelo', () => {
  const A = cargar().A;
  const m = A.manifest(['read_calendar']);
  assert.match(m, /read_calendar/);
  assert.doesNotMatch(m, /set_alarm\(/, 'las que no pidió no las ve: menos contexto, menos invenciones');
});

test('el prompt explica el formato y el "listo"', () => {
  const A = cargar().A;
  const p = A.systemPrompt('poné una alarma', null, []);
  assert.match(p, /\{"tool": "nombre", "args": \{"k": "v"\}\}/);
  assert.match(p, /poné una alarma/);
  /* v2.14.4 · en el PRIMER paso "listo" no se ofrece: el agente solo entra
     para órdenes, así que "no necesito ninguna herramienta" nunca es la
     respuesta correcta ahí. Medido con un modelo real: sin esto, el 97 % de
     los pedidos terminaban sin hacer nada. */
  assert.doesNotMatch(p, /\{"listo": true\}/, 'en el primer paso no se ofrece "listo"');
  assert.match(p, /Elegí SIEMPRE una herramienta/);
  /* después de trabajar, "listo" vuelve: ahí SÍ es la respuesta correcta */
  const p2 = A.systemPrompt('x', null, ['[set_alarm ok] listo']);
  assert.match(p2, /\{"listo": true\}/, 'después de un paso, "listo" sí se ofrece');
});

test('el historial de intentos aparece en el prompt siguiente', () => {
  const A = cargar().A;
  const p = A.systemPrompt('x', null, ['primero falló', 'después anduvo']);
  assert.match(p, /YA INTENTASTE/);
  assert.match(p, /1\) primero falló/);
  assert.match(p, /2\) después anduvo/);
});

/* ================= 5 · el registro en sí ================= */

test('las herramientas que el usuario pidió están todas', () => {
  const A = cargar().A;
  for (const n of ['set_alarm', 'read_calendar', 'call_contact', 'search_docs', 'device_action', 'find_contact']) {
    assert.ok(A.get(n), 'falta ' + n);
  }
});

test('device_action solo acepta valores de su lista', async () => {
  const { A } = cargar({ respuestas: ['{"tool":"device_action","args":{"what":"borrar_todo"}}', '{"listo":true}'] });
  const r = await correr({ A, pedido: 'x' });
  assert.equal(r.ok, false, 'una acción fuera de la lista no se ejecuta');
  /* v2.9.2: el enum del esquema lo corta en validate(), antes de llegar a run() */
  assert.match(r.obs[0], /no es un valor válido de "what"/);
  for (const w of A.DEVICE_WHAT) assert.equal(A.validate('device_action', { what: w }).ok, true);
});

test('las herramientas de efecto están marcadas como tales', () => {
  const A = cargar().A;
  assert.equal(A.get('call_contact').risk, 'write', 'llamar marca en el mundo real');
  assert.equal(A.get('device_action').risk, 'write');
  assert.equal(A.get('read_calendar').risk, 'read');
  assert.equal(A.get('search_docs').risk, 'read');
});

test('call_contact NO llama solo: abre el marcador', () => {
  const abiertos = [];
  const A = cargar({
    brain: { reply: (t) => { abiertos.push(t); return { handled: true, text: 'Te abrí el marcador' }; }, parseWhen: () => ({ when: null }) },
  }).A;
  const r = A.get('call_contact').run({ who: 'mamá' });
  assert.equal(r.ok, true);
  assert.match(r.text, /marcador/i, 'el texto dice que es el marcador, no que llamó');
  assert.deepEqual(abiertos, ['llama a mamá'], 'delega la resolución del contacto a brain.js');
});

test('el script está cargado en index.html', () => {
  assert.match(html, /<script src="js\/kiu-agente\.js"><\/script>/);
});

/* ================= 6 · el enrutado: no romper lo que ya andaba ============ */

test('el toggle del agente existe y avisa si no hay modelo', () => {
  assert.match(html, /id="tg-agent"/, 'sin el toggle la función existe pero nadie la puede usar');
  const i = html.indexOf('id="tg-agent"');
  const fila = html.slice(Math.max(0, i - 400), i);
  assert.match(fila, /Agente con herramientas/);
  assert.match(fila, /lo carga solo/,
    'el texto de la fila dice de qué depende, no solo el nombre (v2.13.2: el modelo se autocarga)');
});

test('el agente va DESPUÉS de cerebro/ReAct y no los reemplaza', () => {
  const iBrain = uiSrc.indexOf('var res = KiuBrain.reply(text);');
  const iReact = uiSrc.indexOf('KiuReAct.run(text)');
  const iAgent = uiSrc.indexOf('KiuAgente.run(');
  const iGen = uiSrc.indexOf('this.kiuReply(text, null)');
  assert.ok(iBrain > -1 && iReact > -1 && iAgent > -1 && iGen > -1);
  assert.ok(iBrain < iAgent, 'el cerebro sigue primero: lo conocido no gasta un token');
  assert.ok(iReact < iAgent, 'ReAct también: resuelve lo de varias partes sin modelo');
  assert.ok(iAgent < iGen, 'y el agente va antes de generar la respuesta final');
});

test('si el agente no hace nada, el flujo sigue igual (no se pierde el mensaje)', () => {
  assert.match(uiSrc, /tryAfterAgent: function/,
    'el camino que venía después del enrutado quedó en su propia función');
  assert.match(uiSrc, /selfA\.tryAfterAgent\(text, task\)/,
    'y se la llama cuando el agente no ejecutó nada: el mensaje no se pierde');
  const c = uiSrc.slice(uiSrc.indexOf('tryAfterAgent: function'));
  assert.match(c, /Orch\.targets\(task\)/);
  assert.match(c, /KiuBrain\.fallback\(\)/, 'el fallback final sigue existiendo');
});

test('el agente viene encendido pero con compuerta: no gasta una generación por cada mensaje', () => {
  /* v2.12.0: antes estaba apagado porque costaba una generación extra por mensaje.
     Ahora arranca encendido y App.agentGate() solo lo deja correr con órdenes
     (no con preguntas ni pedidos de texto). El comportamiento de la compuerta se
     prueba en respuesta-local-v212.test.mjs. */
  assert.match(stateSrc, /agentOn:\s*true/);
  assert.match(stateSrc, /if \(!S\._agentGateV2\) \{ S\._agentGateV2 = 1; \}/,
    'la migración marca la versión sin pisar agentOn guardado');
  assert.match(uiSrc, /S\.agentOn && this\.agentGate\(text\)/,
    'el agente solo se invoca si pasa la compuerta');
});

test('cancelar mientras el agente trabaja no lo deja hablando', () => {
  const c = uiSrc.slice(uiSrc.indexOf('KiuAgente.run('), uiSrc.indexOf('tryAfterAgent: function'));
  assert.match(c, /if \(selfA\._cancelled\) return;/,
    'el agente es asíncrono: sin esto, cancelar y después igual armar la alarma');
});

/* ================= 7 · el motor no puede volver a flotar ==================
   v2.9.2. El pin de llama.cpp pasó de opcional a obligatorio: sin él, un commit
   de upstream rompe el build sin que cambie nada del repo, y no hay forma de
   volver atrás. Estos tests evitan que alguien lo afloje sin darse cuenta. */

test('el pin de llama.cpp está fijado y no es opcional', () => {
  assert.match(vendorSh, /LLAMA_SHA="[0-9a-f]{40}"/, 'un SHA completo, no un prefijo');
  assert.match(vendorSh, /LLAMA_TAG="v[\d.]+"/);
  assert.doesNotMatch(vendorSh, /git clone --depth 1 https:\/\/github\.com\/ggml-org\/llama\.cpp/,
    'clonar sin pin = dependencia flotante');
  assert.doesNotMatch(vendorSh, /reset --hard origin\/master/,
    'reset a master = el local se pisa solo y no se puede volver atrás');
  assert.doesNotMatch(vendorSh, /fetch --depth 1 origin master/);
});

test('el script VERIFICA que el commit sea el esperado', () => {
  assert.match(vendorSh, /if \[ "\$GOT" != "\$LLAMA_SHA" \]/,
    'si upstream movió el tag, para con ruido en vez de compilar otro código');
  assert.match(vendorSh, /exit 1/);
});

test('el CI usa el mismo pin y lo muestra en el resumen', () => {
  assert.match(buildYml, /vendor_llama\.sh --show/);
  assert.match(buildYml, /GITHUB_STEP_SUMMARY/,
    'que un fallo de compilación diga contra qué commit fue, y se pueda reproducir');
});

test('el pin documenta cómo se cambia (que nadie lo afloje por las dudas)', () => {
  assert.match(vendorSh, /CÓMO SE CAMBIA EL PIN/);
  assert.match(vendorSh, /assembleDebug/, 'y dice dónde se ve si compila');
  assert.match(vendorSh, /shim/, 'y que un cambio de API se shimmea, no se esquiva bajando el requisito');
});

/* ================= 8 · el prefill se mide, no se estima =================
   v2.9.2. El agente paga un PREFILL por decisión, y el proyecto ya sabe que ahí
   está el cuello de botella (comentario de PROMPT LIVIANO en app-ui.js: el
   prompt grande "tardaba minutos en el prefill de la CPU del teléfono").

   El manifiesto eran 435 tokens: el 80 % de los 544 que costaba una decisión,
   para producir 120 de salida. Estos tests son el presupuesto: si alguien
   vuelve a escribir un párrafo en una descripción, se pone rojo. */

test('el manifiesto entra en presupuesto', () => {
  const A = cargar().A;
  const tok = A.budget().manifiestoTok;
  assert.equal(typeof tok, 'number', 'budget() tiene que devolver un número');
  /* v2.14.2: el techo del manifiesto COMPLETO sube porque hay 14 herramientas
     (eran 10) y porque se agregaron las de memoria. Pero lo que se PAGA en el
     móvil es el manifiesto COMPACTO (perfil Harness-Local-Compact, el que
     corre por defecto): una línea por herramienta, sin descripciones. Ese es
     el número que importa, y tiene su propio techo, más estricto. */
  assert.ok(tok <= 620, 'manifiesto (worst case, con descripciones): ' + tok + ' tokens, el techo es 620');
  /* v2.14.2 · el compacto sube a ~119 tokens porque ahora lleva los VALORES
     de los enums (manage_task(action: list|add|done)): el modelo ya no tiene
     que adivinar el vocabulario, y un valor inventado costaba una generación
     entera. Lo que se paga por turno son solo las herramientas que el turno
     lleva (ver seleccionar()), así que el costo real es mucho menor que este
     techo, que es el peor caso. */
  const comp = A.budget().manifiestoCompactoTok;
  assert.ok(comp <= 145, 'manifiesto compacto (el que se paga en el móvil): ' + comp + ' tokens, el techo es 145');
});

test('el prompt completo de una decisión entra en presupuesto', () => {
  const A = cargar().A;
  const tok = A.budget().promptTok;
  assert.equal(typeof tok, 'number');
  assert.ok(tok <= 760, 'prompt: ' + tok + ' tokens (bajó de 544 pero hay 6 herramientas más), el techo es 760');
});

test('el perfil del usuario no infla el prompt de la decisión', () => {
  /* v2.14.2: el perfil (nombre + tareas + recuerdos) entra en CADA decisión.
     Si no está acotado, el prefill del móvil se dispara. */
  const { A } = cargar({ S: { kiu: { ok: true }, name: 'Sasha' } });
  const conPerfil = A.systemPrompt('poné una alarma a las 7', null, [], false);
  assert.match(conPerfil, /PERFIL DEL USUARIO:/, 'el perfil tiene que estar en el prompt');
  assert.match(conPerfil, /Sasha/);
  const largo = A.systemPrompt('x', null, [], false).length;
  /* v2.14.4 · el techo sube porque el prompt lleva EJEMPLOS: medido con un
     modelo real, sin ellos el 97 % de los pedidos terminaban sin hacer nada
     (el modelo contestaba {"listo":true}). 100 caracteres de ejemplo
     compraron 74 puntos de acierto. */
  assert.ok(largo < 2900, 'el prompt no puede pasar de ~2900 caracteres: ' + largo);
});

test('el mensaje del usuario va UNA vez, no dos', () => {
  const A = cargar().A;
  const conHist = A.systemPrompt('poné una alarma a las 7', null, [], true);
  assert.doesNotMatch(conHist, /TAREA:/, 'con historial la TAREA está repetida: son tokens tirados');
  assert.match(conHist, /HERRAMIENTAS:/, 'pero el manifiesto sigue ahí');
  const sinHist = A.systemPrompt('poné una alarma a las 7', null, [], false);
  assert.match(sinHist, /TAREA: poné una alarma a las 7/, 'sin historial (uso programático) sí va');
});

test('run() no manda el mensaje dos veces al motor', async () => {
  const { A, prompts } = cargar({ respuestas: ['{"listo":true}'] });
  await correr({ A, pedido: 'hola', habla: ['hola'] });
  const sys = prompts[0].hist[0].content;
  const user = prompts[0].hist.filter((m) => m.role === 'user').map((m) => m.content);
  assert.doesNotMatch(sys, /TAREA: hola/, 'la tarea no va en el system cuando ya está en el user');
  /* OJO: sin deepEqual. El array lo arma kiu-agente.js dentro de la VM, así que
     es de otro realm y assert/strict compara prototipos: dos arrays que se ven
     idénticos dan "no son iguales". A elemental. */
  assert.equal(user.length, 1, 'el mensaje del usuario va exactamente una vez, no dos');
  assert.equal(user[0], 'hola');
});

test('las descripciones son disparadores, no prosa', () => {
  const A = cargar().A;
  for (const n of A.toolNames()) {
    const t = A.get(n);
    assert.ok(t.desc.length <= 100, n + ': desc de ' + t.desc.length + ' car, tope 100');
    for (const k of Object.keys(t.args)) {
      const d = t.args[k].desc;
      assert.ok(d.length <= 110, n + '.' + k + ': desc de ' + d.length + ' car, tope 110');
    }
  }
});

test('quedan los disparadores que un modelo chico necesita para no inventar', () => {
  const A = cargar().A;
  const m = A.manifest();
  for (const palabra of ['alarma', 'agenda', 'contacto', 'documentos', 'marcador']) {
    assert.match(m, new RegExp(palabra, 'i'), 'falta el disparador "' + palabra + '"');
  }
  assert.match(A.get('device_action').args.what.desc, /linterna/,
    'la lista de valores cerrada tiene que estar: es lo que la gramática va a enumerar');
});

/* ================= 9 · la gramática GBNF =================
   v2.9.2. Deriva del MISMO `args` que valida y que arma el manifiesto, así que no
   hay tres lugares que mantener. El generador es JS puro y se testea entero acá;
   lo único que no se puede testear desde Node es el pegamento JNI
   (llama_sampler_init_grammar), que se verifica con un build. */

const rn = (n) => n.replace(/_/g, '-'); /* GBNF: nombres de regla sin guion bajo */

test('la gramática declara una regla por herramienta y una raíz', () => {
  const A = cargar().A;
  const g = A.grammar();
  for (const n of A.toolNames()) {
    assert.match(g, new RegExp('^' + rn(n) + ' ::=', 'm'), 'falta la regla de ' + n);
  }
  assert.match(g, /^root ::=/m, 'falta la raíz');
  assert.match(g, /\| root|root ::=/);
  /* la raíz tiene queMentionar TODAS las reglas, o alguna queda inalcanzable y el
     motor no puede elegirla */
  const raiz = g.match(/^root ::= (.*)$/m)[1];
  for (const n of A.toolNames()) assert.ok(raiz.includes(rn(n)), n + ' no está en la raíz');
  assert.ok(raiz.includes('done'), 'la raíz incluye "listo"');
});

/* Un validador de GBNF chiquito. llama.cpp hace throw si la gramática está mal
   formada, y eso no lo ves hasta el build. Estos chequeos son los que de verdad
   importan: paréntesis y comillas balanceados, y una raíz que mencione todo. */
function chequeaGBNF(g) {
  const reglas = [];
  for (const linea of g.split('\n')) {
    const m = linea.match(/^([\w-]+) ::=(.*)$/);
    if (m) reglas.push({ nombre: m[1], cuerpo: m[2] });
    else if (linea.trim() && !/^\s*\|/.test(linea)) {
      throw new Error('línea que no es regla ni continuación: ' + linea);
    }
  }
  for (const r of reglas) {
    // comillas: par
    const comillas = (r.cuerpo.match(/"/g) || []).length;
    if (comillas % 2 !== 0) throw new Error(r.nombre + ': comillas desbalanceadas');
    /* Solo paridad, no "comilla sin escapar": una comilla DENTRO de una clase
       de caracteres ([^"...]) es legal en GBNF, y un chequeo heurístico de eso
       da falso positivo en todas las reglas que aceptan texto. */
    // paréntesis
    let p = 0;
    for (const ch of r.cuerpo) {
      if (ch === '(') p++;
      else if (ch === ')') { p--; if (p < 0) throw new Error(r.nombre + ': cierra de más'); }
    }
    if (p !== 0) throw new Error(r.nombre + ': paréntesis sin cerrar');
    if (!r.cuerpo.trim()) throw new Error(r.nombre + ': regla vacía');
  }
  return reglas;
}

test('la gramática está bien formada (llama.cpp tira si no)', () => {
  const A = cargar().A;
  let reglas;
  assert.doesNotThrow(() => { reglas = chequeaGBNF(A.grammar()); },
    'una gramática mal formada revienta el nativo en runtime, no acá');
  for (const n of A.toolNames()) {
    assert.ok(reglas.some((r) => r.nombre === rn(n)), 'falta la regla ' + n);
  }
  assert.ok(reglas.some((r) => r.nombre === 'root'));
  assert.ok(reglas.some((r) => r.nombre === 'done'));
});

test('la raíz menciona TODAS las reglas (si no, alguna herramienta es inalcanzable)', () => {
  const A = cargar().A;
  const reglas = chequeaGBNF(A.grammar());
  const raiz = reglas.find((r) => r.nombre === 'root').cuerpo;
  for (const n of A.toolNames()) {
    assert.ok(raiz.includes(rn(n)), n + ' no está en la raíz: el motor no puede elegirla');
  }
  assert.ok(raiz.includes('done'), 'la raíz incluye "listo"');
});

test('cada herramienta declara sus campos con el nombre exacto del esquema', () => {
  const A = cargar().A;
  const g = A.grammar();
  for (const n of A.toolNames()) {
    const t = A.get(n);
    for (const k of Object.keys(t.args)) {
      assert.ok(g.includes('\\"' + k + '\\"'), n + '.' + k + ' no está en la gramática');
    }
  }
});

test('los argumentos opcionales generan las alternativas que existen', () => {
  const A = cargar().A;
  const g = A.grammar();
  /* set_alarm: 1 requerido + 1 opcional = 2 ramas (solo when, y when+label).
     v2.14.4: las alternativas van en la MISMA línea. En GBNF un salto de
     línea termina la regla, así que el "|" al principio de la línea
     siguiente hacía que la gramática NO PARSEARA (verificado contra el
     parser real de llama.cpp: "failed to parse grammar"). */
  const linea = g.split('\n').find((l) => l.includes('\\"tool\\":\\"set_alarm\\"')) || '';
  const ramas = linea.split('|').filter((x) => x.includes('\\"tool\\":\\"set_alarm\\"'));
  assert.equal(ramas.length, 2, 'dos ramas: con y sin el opcional');
  assert.ok(ramas.some((l) => !l.includes('label')), 'la rama sin el opcional');
  assert.ok(ramas.some((l) => l.includes('label')), 'la rama con el opcional');
  /* y ninguna regla puede terminar con un "|" suelto al principio de línea */
  assert.ok(!/^\s*\|/m.test(g), 'ninguna alternativa puede empezar la línea: en GBNF el salto de línea termina la regla');
  /* read_calendar no tiene requeridos: un objeto vacío tiene que ser legal */
  assert.ok(g.includes('\\"read_calendar\\",\\"args\\":{" "}}"'),
    'read_calendar tiene que admitir args vacíos');
});

test('los ENUM quedan enumerados en la gramática (ahí es donde se ahorra)', () => {
  const A = cargar().A;
  const g = A.grammar();
  const linea = g.split('\n').find((l) => l.includes('\\"what\\":" ( "\\"linterna\\""'));
  assert.ok(linea, 'device_action.what no está enumerado');
  for (const w of A.DEVICE_WHAT) {
    assert.ok(linea.includes('\\"' + w + '\\"'), 'falta el valor ' + w + ' en la gramática');
  }
  /* y NO puede aparecer como string libre al lado */
  assert.doesNotMatch(linea.split('"target')[0], /\bstr\b/, 'what es enum, no texto libre');
});

test('el enum se valida aunque la gramática no esté activa', () => {
  const A = cargar().A;
  /* esto es lo que corta cuando no hay JNI, o cuando la decisión va por un
     proveedor: la gramática sola no alcanza */
  const v = A.validate('device_action', { what: 'borrar_todo' });
  assert.equal(v.ok, false);
  assert.match(v.err, /no es un valor válido/);
  assert.match(v.err, /linterna/, 'y le pasa la lista de los válidos');
  for (const w of A.DEVICE_WHAT) {
    assert.equal(A.validate('device_action', { what: w }).ok, true, w + ' debería pasar');
  }
});

test('la gramática escapa comillas y barras de los literales', () => {
  const A = cargar().A;
  assert.equal(A.lit('a"b'), '"a\\"b"');
  assert.equal(A.lit('a\\b'), '"a\\\\b"');
  assert.equal(A.lit('normal'), '"normal"');
});

test('agregar un argumento no obliga a tocar la gramática a mano', () => {
  /* la garantía que importa: el esquema es la única fuente. Si esto se rompe,
     es porque alguien hardcodeó algo en grammar(). */
  const A = cargar().A;
  A.TOOLS.prueba = {
    name: 'prueba',
    desc: 'x',
    args: { a: { type: 'string', required: true, desc: 'a' }, b: { type: 'string', required: false, desc: 'b' } },
    run: () => ({ ok: true }),
    risk: 'read',
  };
  try {
    const g = A.grammar();
    assert.match(g, /^prueba ::=/m);
    assert.ok(g.includes('\\"a\\":'));
    assert.ok(g.includes('\\"b\\":'));
    assert.match(A.manifest(), /prueba\(/, 'y el manifiesto también lo toma solo');
    assert.equal(A.validate('prueba', { a: '1' }).ok, true);
  } finally {
    delete A.TOOLS.prueba;
  }
});

/* ================= 10 · el camino completo: gramática → puente → motor =====
   v2.9.2. El generador ya estaba testeado; lo que faltaba era que la gramática
   LLEGUE al motor. Eso se verifica por el lado JS (el puente la recibe y la pasa
   a Kiu.ask); el C++ que la aplica no se puede compilar ni probar desde Node, así
   que lo que se chequea acá es el contrato: que se mande, que se mande una sola
   vez y que el sistema NO se entere de que existe fuera de una decisión. */

test('la gramática se pasa al motor, y solo cuando el motor la soporta', () => {
  const llamadas = [];
  const ctx = {};
  ctx.window = ctx;
  ctx.S = { kiu: { ok: true } };
  ctx.Kiu = {
    ask(hist, maxT, cb, onTok, gbnf) { llamadas.push({ hist, maxT, gbnf }); cb({ ok: true, text: '{"listo":true}' }); },
  };
  ctx.KiuBrain = { reply: () => ({ handled: false }) };
  ctx.KiuApp = {}; ctx.KiuState = {}; ctx.RAG = { on: false };
  /* OJO: el agente llama a rawBridge(), no a bridge(). rawBridge vive en
     app/env.js y lee window.KiuBridge. Si el arnés no lo define, el ReferenceError
     lo come el try/catch del agente y gbnf queda null — que pasa un assert de
     "typeof === string" como si fuera un objeto. Un test que pasa porque la
     ruta real nunca se ejercitó. */
  let ok = true;
  ctx.rawBridge = (fn) => (fn === 'kiuGenGrammarOk' ? ok : true);
  ctx.console = console;
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: 'kiu-agente.js' });
  const A = ctx.KiuAgente;
  return new Promise((res) => A.run({ pedido: 'x' }, () => {
    assert.equal(llamadas.length, 1);
    const g = llamadas[0].gbnf;
    assert.notEqual(g, null, 'la gramática tiene que llegar al motor, no null');
    assert.equal(typeof g, 'string');
    assert.match(g, /^set-alarm ::=/m, 'y ser la derivada del esquema');
    assert.match(g, /^root ::=/m);
    res();
  }));
});

test('si el motor no soporta gramática, se genera igual y sin gramática', () => {
  const llamadas = [];
  const ctx = {};
  ctx.window = ctx;
  ctx.S = { kiu: { ok: true } };
  ctx.Kiu = {
    ask(hist, maxT, cb, onTok, gbnf) { llamadas.push(gbnf); cb({ ok: true, text: '{"listo":true}' }); },
  };
  ctx.KiuBrain = { reply: () => ({ handled: false }) };
  ctx.KiuApp = {}; ctx.KiuState = {}; ctx.RAG = { on: false };
  ctx.rawBridge = (fn) => (fn === 'kiuGenGrammarOk' ? false : true);
  ctx.console = console;
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: 'kiu-agente.js' });
  const A = ctx.KiuAgente;
  return new Promise((res) => A.run({ pedido: 'x' }, () => {
    /* v2.14.4 · LA GRAMÁTICA SE PONE SIEMPRE.
       Antes se ponía solo si `kiuGenGrammarOk()` devolvía true, y ese valor
       dice si la gramática ANTERIOR se pudo aplicar: en la primera decisión
       nunca hubo una anterior, así que la primera tampoco la ponía; y como
       esa nunca se aplicó, la segunda tampoco. El agente NUNCA tuvo
       gramática. Ahora se manda siempre y, si el nativo no la aplicó, queda
       registrado para el diagnóstico. */
    assert.equal(llamadas.length, 1, 'igual se consultó al motor');
    assert.ok(llamadas[0] && typeof llamadas[0] === 'string' && llamadas[0].length > 50,
      'y se le manda la gramática, la haya aplicable la anterior o no');
    res();
  }));
});

test('el puente expone set/consume/ok con los tres métodos del nativo', () => {
  const jni = readFileSync(path.join(here, '..', 'app', 'src', 'main', 'java', 'com', 'kiu', 'agent', 'KiuNative.java'), 'utf8');
  const bridge = readFileSync(path.join(here, '..', 'app', 'src', 'main', 'java', 'com', 'kiu', 'agent', 'MainActivity.java'), 'utf8');
  const cpp = readFileSync(path.join(here, '..', 'app', 'src', 'main', 'cpp', 'kiullama_jni.cpp'), 'utf8');
  for (const m of ['setGrammar', 'grammarPending', 'grammarOk']) {
    assert.match(jni, new RegExp('native .*' + m + '\\('), 'falta ' + m + ' en KiuNative');
    assert.match(cpp, new RegExp('Java_com_kiu_agent_KiuNative_' + m), 'falta el JNI de ' + m);
  }
  /* los tres tienen que existir del lado JS con el prefijo kiuGen */
  assert.match(bridge, /public void kiuGenSetGrammar\(String/);
  assert.match(bridge, /public String kiuGenGrammarPending\(\)/);
  assert.match(bridge, /public boolean kiuGenGrammarOk\(\)/);
});

test('la gramática se CONSUME: no queda pegada a la generación siguiente', () => {
  const cpp = readFileSync(path.join(here, '..', 'app', 'src', 'main', 'cpp', 'kiullama_jni.cpp'), 'utf8');
  /* este es el forgetting con forma de bug fantasma: si la gramática de una
     decisión queda esperando, el chat normal de al lado sale forzado a emitir un
     {"tool":...} y parece un bug de otro lado, en otra pantalla, más tarde. */
  assert.match(cpp, /gbnf\.swap\(g_grammar_pending\)/, 'la generación tiene que consumirse la gramática');
  assert.match(cpp, /Java_com_kiu_agent_KiuNative_stopGen[\s\S]{0,400}g_grammar_pending\.clear\(\)/,
    'y stopGen() también la limpia: si se cancela, no queda esperando');
});

test('la gramática va al FINAL de la cadena de samplers', () => {
  const cpp = readFileSync(path.join(here, '..', 'app', 'src', 'main', 'cpp', 'kiullama_jni.cpp'), 'utf8');
  const start = cpp.indexOf('// sampler: greedy');
  const bloque = cpp.slice(start, cpp.indexOf('llama_batch_ext_init(g_ctx)', start));
  const iUltimo = bloque.lastIndexOf('llama_sampler_chain_add(smpl, gs)');
  assert.ok(iUltimo > -1, 'no agrega el sampler de gramática a la cadena');
  const iAnteriores = bloque.lastIndexOf('llama_sampler_chain_add(smpl, llama_sampler_init_dist');
  assert.ok(iUltimo > iAnteriores,
    'la gramática tiene que ir después de los demás: es la que decide si el token se puede emitir');
});

test('si el motor no soporta la firma, el build NO se rompe', () => {
  const cpp = readFileSync(path.join(here, '..', 'app', 'src', 'main', 'cpp', 'kiullama_jni.cpp'), 'utf8');
  /* mismo criterio que el shim de las penalidades: si upstream cambia la firma,
     cae al overload que devuelve nullptr y se omite el sampler. Perder una mejora
     opcional no puede romper el APK. */
  assert.match(cpp, /kiu_grammar_impl\(long, A\.\.\.\) \{ return nullptr; \}/);
  assert.match(cpp, /kiu_grammar_impl\(0, a\.\.\.\)/);
});

test('motor.js manda temp 0 cuando manda gramática', () => {
  const m = readFileSync(path.join(WWW, 'js', 'app', 'motor.js'), 'utf8');
  assert.match(m, /if \(gbnf\) \{\s*\n\s*genTemp = 0;/,
    'con temperatura alta el sampler aleatorio pelea con la gramática');
  assert.match(m, /rawBridge\('kiuGenSetGrammar'/);
  /* y la gramática es opcional: el resto de la app la ignora */
  const c = m.slice(m.indexOf('ask: function'));
  assert.match(c, /gbnf\)/, 'ask() la acepta como argumento opcional');
});


/* v2.12.8 · reglas que la versión anterior violaba y ningún test miraba:
   llama.cpp rechaza la gramática entera (y el agente cae sin restricción) si
   un nombre de regla lleva guion bajo o si hay sintaxis suelta fuera de literales. */
test('la gramática usa solo nombres de regla válidos de GBNF ([a-zA-Z0-9-])', () => {
  const g = cargar().A.grammar();
  for (const l of g.split('\n')) {
    const m = l.match(/^(\S+) ::=/);
    if (m) assert.match(m[1], /^[a-zA-Z0-9-]+$/, 'nombre de regla inválido: ' + m[1]);
  }
});

test('toda rama de la gramática produce el JSON que parseDecision/validate leen', () => {
  const A = cargar().A;
  /* Se genera el literal de una rama a mano a partir del texto de la gramática:
     debe ser JSON parseable y con {"tool","args"}. */
  const g = A.grammar();
  const rama = g.split('\n').find((l) => l.includes('set-alarm ::='));
  const lits = [...rama.matchAll(/"((?:\\.|[^"\\])*)"/g)].map((m) => m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
  /* lits = [cabecera, '"when":', ... '}}'] ; se rellena el str con "a las 7" */
  const json = lits[0] + lits[1] + '"a las 7"' + lits[2].replace(/^,.*$/, '') ;
  const doc = json.endsWith('}}') ? json : json + '}}';
  const d = A.parseDecision(doc);
  assert.ok(d, 'no parsea: ' + doc);
  assert.equal(d.tool, 'set_alarm');
  assert.equal(A.validate(d.tool, d.args).ok, true);
});

test('{"listo":true} es una salida legal de la gramática y la lee isDone', () => {
  const A = cargar().A;
  assert.match(A.grammar(), /^done ::= "\{\\"listo\\":true\}"$/m);
  assert.equal(A.isDone(A.parseDecision('{"listo":true}')), true);
});

test('grammar(solo) respeta la lista de herramientas', () => {
  const A = cargar().A;
  const g = A.grammar(['set_alarm']);
  assert.match(g, /^set-alarm ::=/m);
  assert.doesNotMatch(g, /^find-contact ::=/m);
  assert.doesNotMatch(g, /^root ::=.*find-contact/m);
});
