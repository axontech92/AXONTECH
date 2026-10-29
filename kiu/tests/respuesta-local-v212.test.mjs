/* respuesta-local-v212.test.mjs — v2.12.0: que el modelo local responda de verdad.
 * Prueba COMPORTAMIENTO (no regex sobre el código fuente):
 *   1) las reglas conversacionales del cerebro solo atrapan mensajes cortos,
 *   2) el router no manda a la web por un «hoy» suelto y entiende las tildes,
 *   3) la compuerta del agente deja pasar órdenes y frena preguntas,
 *   4) el prompt del modelo local lleva personalidad, memoria, documentos y un
 *      historial limpio (sin el pie «(motor interno …)»).
 * node --test tests/respuesta-local-v212.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { newSandbox, loadAll } from './helpers.mjs';

const SCRIPTS = [
  'js/kiu-migrate.js', 'js/i18n.js', 'js/brain.js', 'js/skills.js', 'js/react.js', 'js/tools.js',
  'js/kiu-agente.js', 'js/kiu-estados.js', 'js/kiu-avatar.js', 'js/kiu-avatar-boot.js',
  'js/rag-worker.js', 'js/rag.js', 'js/kiu-secure.js',
  'js/app/env.js', 'js/app/memoria.js', 'js/app/state.js', 'js/app/catalog.js', 'js/app/models.js',
  'js/app/motor.js', 'js/app/diag-voz.js', 'js/app/app-ui.js',
];
function boot() { const sb = newSandbox(); loadAll(sb, SCRIPTS); return sb; }

/* ---------- 1 · el cerebro de reglas ya no se come las preguntas reales ---------- */
test('charla de cortesía CORTA la resuelve el cerebro', () => {
  const { KiuBrain } = boot();
  for (const t of ['hola', 'gracias', 'chau', 'quien sos', 'ayuda', 'que hora es']) {
    assert.equal(KiuBrain.reply(t).handled, true, t);
  }
});

test('una pregunta que EMPIEZA con un saludo o contiene «ayuda/gracias/la hora» pasa al modelo', () => {
  const { KiuBrain } = boot();
  for (const t of [
    'hola, explicame como funciona la fotosintesis',
    'ayudame a entender los agujeros negros por favor',
    'gracias, y por que el cielo es azul de dia',
    'quien sos para decirme que hacer con mi vida laboral',
    'explicame por que cambia la hora en invierno en europa',
    'que haces cuando un modelo de lenguaje alucina datos',
  ]) {
    assert.equal(KiuBrain.reply(t).handled, false, t + ' debe llegar al modelo, no a una frase fija');
  }
});

/* ---------- 2 · router ---------- */
test('Rtr: «hoy» suelto es charla; datos que cambian siguen yendo a la web', () => {
  const { Rtr } = boot();
  assert.notEqual(Rtr.classify('hoy me siento mal, que hago'), 'search');
  assert.notEqual(Rtr.classify('actualmente trabajo en una panaderia, que me conviene estudiar'), 'search');
  assert.equal(Rtr.classify('cuáles son las noticias de hoy'), 'search');
  assert.equal(Rtr.classify('precio del dólar hoy'), 'search');
  assert.equal(Rtr.classify('cómo está el clima hoy'), 'search');
  assert.equal(Rtr.classify('buscá recetas de pan'), 'search');
});

test('Rtr: las frases de búsqueda funcionan CON tildes («última hora»)', () => {
  const { Rtr } = boot();
  assert.equal(Rtr.classify('dame las últimas noticias'), 'search');
  assert.equal(Rtr.classify('qué hay de última hora'), 'search');
});

/* ---------- 3 · compuerta del agente ---------- */
test('agentGate: órdenes sí; preguntas, textos y mensajes largos no', () => {
  const { App } = boot();
  assert.equal(App.agentGate('mandale un mensaje a Juan que ya llego'), true);
  assert.equal(App.agentGate('bajá el brillo al minimo'), true);
  assert.equal(App.agentGate('¿qué es la fotosíntesis?'), false);
  assert.equal(App.agentGate('qué es la fotosintesis'), false);
  assert.equal(App.agentGate('explicame la relatividad'), false);
  assert.equal(App.agentGate('escribí un poema sobre el mar'), false);
  assert.equal(App.agentGate('a'.repeat(250)), false);
  assert.equal(App.agentGate('uno dos tres cuatro cinco seis siete ocho nueve diez once doce trece catorce quince dieciseis diecisiete dieciocho diecinueve veinte veintiuno veintidos veintitres veinticuatro veinticinco'), false);
  /* v2.13.0: preguntas sobre el teléfono del usuario SÍ son órdenes para una herramienta */
  assert.equal(App.agentGate('¿qué tengo mañana?'), true);
  assert.equal(App.agentGate('que tengo en la agenda el viernes'), true);
  assert.equal(App.agentGate('¿cuánta batería me queda?'), true);
  assert.equal(App.agentGate('¿tengo dentista esta semana?'), true);
  assert.equal(App.agentGate('¿qué hora es?'), true);
  assert.equal(App.agentGate(''), false);
});

test('el agente viene encendido por defecto en una instalación nueva', () => {
  const sb = boot();
  assert.equal(sb.S.agentOn, true);
});

test('la migración no reactiva el agente si el usuario lo había desactivado', () => {
  const sb = newSandbox();
  sb.localStorage.setItem('nexo_settings', JSON.stringify({ agentOn: false }));
  loadAll(sb, SCRIPTS);
  assert.equal(sb.S.agentOn, false, 'se conserva la preferencia explícita');
  assert.equal(sb.S._agentGateV2, 1, 'la migración queda marcada');
});

/* ---------- 4 · el prompt del modelo local ---------- */
test('kiuMsgs: lleva personalidad, aprendizaje, recuerdos y pide contestar lo preguntado', () => {
  const sb = boot();
  const k = Object.keys(sb.PERSONAS).find((x) => x !== 'normal' && sb.PERSONAS[x]);
  if (k) sb.S.persona = k;
  sb.S.name = 'Marta';
  sb.KB.data.facts = [{ t: 'le gusta el mate amargo', score: 3, ts: 1 }];
  sb.KiuMem.data.recuerdos = [{ text: 'la reunión es el lunes', ts: 1 }];
  const sys = sb.App.kiuMsgs('que me conviene llevar', false)[0].content;
  assert.match(sys, /contestá exactamente lo que se pregunta/);
  assert.match(sys, /Marta/);
  assert.match(sys, /mate amargo/, 'lo aprendido del usuario llega al modelo');
  assert.match(sys, /la reunión es el lunes/, 'los recuerdos llegan al modelo');
  if (k) assert.ok(sys.includes(sb.PERSONAS[k]), 'la personalidad elegida llega al modelo');
});

test('kiuMsgs: el contexto de documentos entra hasta 1200 caracteres', () => {
  const sb = boot();
  sb.RAG.on = true;
  const doc = 'X'.repeat(3000);
  const sys = sb.App.kiuMsgs('que dice el documento', false, doc)[0].content;
  const n = (sys.match(/X/g) || []).length;
  assert.ok(n >= 1000 && n <= 1200, 'entra recortado a 1200, no a 500; entró ' + n);
});

test('kiuMsgs: el historial no arrastra el pie «(motor interno …)» y usa hasta 6 turnos', () => {
  const sb = boot();
  const hist = [];
  for (let i = 1; i <= 8; i++) {
    hist.push({ role: 'user', text: 'pregunta ' + i, ts: i });
    hist.push({ role: 'bot', text: 'respuesta ' + i + '\n\n*(motor interno · qwen2.5-3b · 4,1 tok/s en tu teléfono)*', ts: i });
  }
  hist.push({ role: 'user', text: 'la ultima pregunta', ts: 99 });
  sb.ensureConv();
  sb.saveHist(hist);
  const msgs = sb.App.kiuMsgs('la ultima pregunta', false);
  const resto = msgs.slice(1);
  assert.equal(resto.length, 6, 'seis turnos recientes');
  assert.equal(resto[resto.length - 1].content, 'la ultima pregunta');
  for (const m of resto) assert.doesNotMatch(m.content, /motor interno|tok\/s/, 'sin el pie técnico');
});

test('kiuMsgs en reintento liviano sigue siendo mínimo', () => {
  const sb = boot();
  const msgs = sb.App.kiuMsgs('hola', true);
  assert.equal(msgs.length, 2);
  assert.equal(msgs[1].content, 'hola');
  assert.ok(msgs[0].content.length < 700, 'prompt liviano');
});


/* v2.12.1 · trazabilidad de rutas sin almacenar el texto del usuario. */
test('Rtr: traza la decisión con motivo y metadatos, nunca el contenido del mensaje', () => {
  const { Rtr } = boot();
  Rtr.clearTrace();
  assert.equal(Rtr.classify('precio del dólar hoy'), 'search');
  assert.equal(Rtr.lastDecision.task, 'search');
  assert.match(Rtr.lastDecision.reason, /información cambiante/);
  assert.equal(Rtr.lastDecision.length, 'precio del dólar hoy'.length);
  assert.equal(Object.prototype.hasOwnProperty.call(Rtr.lastDecision, 'text'), false);
  assert.equal(Rtr.getTrace().length, 1);
  Rtr.classify('qué es la fotosíntesis');
  assert.equal(Rtr.getTrace().length, 2);
  Rtr.clearTrace();
  assert.equal(Rtr.getTrace().length, 0);
});
