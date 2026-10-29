/* agente-util-v2142.test.mjs — v2.14.2: que el agente sea un AGENTE y no un
 * enrutador con memoria de adorno.
 *
 * El diagnóstico que justifie esta tanda, en corto:
 *
 *   · la memoria del usuario (recuerdos, tareas, notas) la escribía el agente
 *     (`remember`) pero NINGUNA herramienta la leía. El usuario le decía
 *     "acordate de que el dentista es el jueves" y el modelo no lo sabía: lo
 *     único que lo recuperaba era brain.js, con regex. Un modelo no escribe
 *     regex.
 *   · el prompt de DECISIÓN no tenía ni el nombre del usuario ni sus tareas
 *     pendientes: esa información solo estaba en el prompt de chat.
 *   · tres valores del enum de `device_action` ("maps", "web", "youtube")
 *     offering capacidades que la herramienta no tenía: el modelo los elegía y
 *     la llamada terminaba siempre en "no pude cumplir".
 *   · el riesgo era único por herramienta: leer la batería o listar tareas
 *     terminaba en un "¿Lo hago?" que no tiene sentido.
 *
 * Acá se prueba COMPORTAMIENTO, no la forma del código.
 * node --test tests/agente-util-v2142.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSandbox, loadAll, runScript, WWW } from './helpers.mjs';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const AGENTE = readFileSync(path.join(WWW, 'js', 'kiu-agente.js'), 'utf8');

/* ---------- arnés: memoria real + agente real ---------- */
function montar(over = {}) {
  const sb = newSandbox();
  loadAll(sb, ['js/app/env.js', 'js/app/memoria.js']);
  sb.S = over.S || { kiu: { ok: true }, name: 'Sasha' };
  sb.Kiu = over.Kiu || { ask() { } };
  sb.KiuBrain = over.brain || {
    reply: (t) => ({ handled: false }),
    parseWhen: (t) => (String(t).includes('mañana')
      ? { when: new Date(Date.now() + 86400000), whenTxt: 'mañana a las 15' }
      : { when: null, whenTxt: '' }),
  };
  sb.KiuApp = over.app || {};
  sb.RAG = over.rag || { on: false };
  sb.KiuState = { flash() { }, set() { }, clear() { } };
  sb.console = console;
  sb.rawBridge = () => false;
  runScript(sb, 'js/kiu-agente.js', AGENTE);
  return sb;
}

/* ================= 1 · la memoria se puede CONSULTAR ================= */

test('la memoria se busca por palabras, sin tildes ni mayúsculas', () => {
  const sb = montar();
  sb.KiuMem.addRecuerdo('La reunión con Ana es el jueves');
  sb.KiuMem.addRecuerdo('el dentista es el martes');
  const hits = sb.KiuMem.search('reunion');
  assert.equal(hits.length, 1, 'una sola coincidencia');
  assert.match(hits[0].text, /reunión con Ana/i, 'la tilde no puede impedir el match');
  assert.equal(hits[0].kind, 'recuerdos');
});

test('buscar sin query devuelve todo lo guardado (para "qué tenés anotado")', () => {
  const sb = montar();
  sb.KiuMem.addRecuerdo('r1');
  sb.KiuMem.addNota('n1');
  sb.KiuMem.addTarea('t1');
  const hits = sb.KiuMem.search('');
  assert.equal(hits.length, 3);
  /* el array viene de otra VM (otro realm): se compara como texto */
  const kinds = hits.map((h) => h.kind).sort().join(',');
  assert.equal(kinds, 'notas,recuerdos,tareas');
});

test('la búsqueda puede filtrar por tipo', () => {
  const sb = montar();
  sb.KiuMem.addRecuerdo('algo');
  sb.KiuMem.addNota('algo');
  const hits = sb.KiuMem.search('algo', ['notas']);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].kind, 'notas');
});

test('la memoria avisa a la UI cuando algo cambia (hooks)', () => {
  const sb = montar();
  let adds = 0, changes = 0;
  sb.KiuMem.hooks.onAdd = () => { adds++; };
  sb.KiuMem.hooks.onChange = () => { changes++; };
  sb.KiuMem.addTarea('comprar pan');
  assert.equal(adds, 1, 'la UI tiene que enterarse de lo que se agregó');
  assert.ok(changes >= 1, 'y de que la pantalla se refresque');
});

test('el resumen de la memoria nombra las tareas pendientes', () => {
  const sb = montar();
  sb.KiuMem.addTarea('llamar al dentista');
  sb.KiuMem.addTarea('comprar pan');
  sb.KiuMem.addTarea('tarea vieja');
  sb.KiuMem.completeTarea('tarea vieja');
  const s = sb.KiuMem.summary(300);
  assert.match(s, /llamar al dentista/);
  assert.doesNotMatch(s, /tarea vieja/, 'una tarea hecha no es pendiente');
});

/* ================= 2 · el agente LEE lo que el usuario guardó ================= */

test('la herramienta recall le devuelve al agente lo que el usuario guardó', () => {
  const sb = montar();
  sb.KiuMem.addRecuerdo('el dentista es el martes a las 10');
  const r = sb.KiuAgente.get('recall').run({ query: 'dentista' });
  assert.equal(r.ok, true);
  assert.match(r.text, /dentista/);
});

test('recall sin memoria disponible lo dice, no inventa', () => {
  const sb = montar();
  sb.KiuMem = null;
  const r = sb.KiuAgente.get('recall').run({ query: 'dentista' });
  assert.equal(r.ok, false);
  assert.match(r.err, /memoria/);
});

test('recall no encuentra y lo dice honestamente', () => {
  const sb = montar();
  sb.KiuMem.addRecuerdo('el dentista es el martes');
  const r = sb.KiuAgente.get('recall').run({ query: 'hipoteca' });
  assert.equal(r.ok, true);
  assert.match(r.text, /No encontré nada/);
});

/* ================= 3 · las tareas y las alarmas ================= */

test('manage_task lista, agrega y completa tareas', () => {
  const sb = montar();
  const t = sb.KiuAgente.get('manage_task');
  let r = t.run({ action: 'add', text: 'comprar pan' });
  assert.equal(r.ok, true);
  assert.match(r.text, /comprar pan/);
  r = t.run({ action: 'list' });
  assert.match(r.text, /comprar pan/);
  r = t.run({ action: 'done', text: 'comprar pan' });
  assert.match(r.text, /marqué/);
  r = t.run({ action: 'list' });
  assert.match(r.text, /No tenés tareas pendientes/);
});

test('manage_task sin texto al agregar falla con motivo', () => {
  const sb = montar();
  const r = sb.KiuAgente.get('manage_task').run({ action: 'add' });
  assert.equal(r.ok, false);
  assert.match(r.err, /qué tarea agregar/);
});

test('manage_alarm lista y cancela recordatorios', () => {
  const llamadas = [];
  const sb = montar({
    app: {
      reminders: () => [{ id: 'r1', title: 'desayunar', date: 'Mañana 07:00' }],
      cancelReminderByTitle: (q) => {
        llamadas.push(q);
        return { id: 'r1', title: 'desayunar' };
      },
    },
  });
  const t = sb.KiuAgente.get('manage_alarm');
  let r = t.run({ action: 'list' });
  assert.match(r.text, /desayunar/);
  r = t.run({ action: 'cancel', which: 'desayunar' });
  assert.equal(r.ok, true);
  assert.match(r.text, /Cancelé/);
  assert.deepEqual(llamadas, ['desayunar']);
});

test('cancelar una alarma que no existe no finge que la canceló', () => {
  const sb = montar({
    app: { reminders: () => [], cancelReminderByTitle: () => null },
  });
  const r = sb.KiuAgente.get('manage_alarm').run({ action: 'cancel', which: 'nada' });
  assert.equal(r.ok, false);
  assert.match(r.err, /no encontré ninguna alarma/);
});

/* ================= 4 · el evento en el calendario ================= */

test('create_calendar_event abre el calendario con la fecha entendida', () => {
  const eventos = [];
  const sb = montar({
    app: { addCalendarEvent: (t, ms) => { eventos.push([t, ms]); return true; } },
  });
  const r = sb.KiuAgente.get('create_calendar_event').run({ title: 'dentista', when: 'mañana a las 15' });
  assert.equal(r.ok, true);
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0][0], 'dentista');
  assert.ok(eventos[0][1] > Date.now(), 'la fecha tiene que ser futura');
  assert.match(r.text, /Confirmalo/);
});

test('create_calendar_event con un horario imposible lo rechaza', () => {
  const sb = montar({ app: { addCalendarEvent: () => true } });
  const r = sb.KiuAgente.get('create_calendar_event').run({ title: 'x', when: 'cuando sea' });
  assert.equal(r.ok, false);
  assert.match(r.err, /no entendí el horario/);
});

/* ================= 5 · los valores del enum que NO FUNCIONABAN ================= */

test('device_action con "web" ahora busca de verdad', async () => {
  const pedidos = [];
  const sb = montar({
    app: { webSnippets: (q, cb) => { pedidos.push(q); cb([{ t: 'Fuente', s: 'un resultado' }]); } },
  });
  const r = await sb.KiuAgente.get('device_action').run({ what: 'web', target: 'clima' });
  assert.equal(r.ok, true);
  assert.deepEqual(pedidos, ['clima']);
  assert.match(r.text, /un resultado/);
});

test('device_action con "youtube" busca en YouTube', () => {
  const pedidos = [];
  const sb = montar({
    brain: {
      reply: (t) => { pedidos.push(t); return { handled: true, text: 'Buscando en YouTube.' }; },
      parseWhen: () => ({ when: null }),
    },
  });
  const r = sb.KiuAgente.get('device_action').run({ what: 'youtube', target: 'recetas' });
  assert.equal(r.ok, true);
  assert.match(pedidos[0], /recetas/);
  assert.match(pedidos[0], /youtube/);
});

test('device_action con "maps" abre la ruta', () => {
  const pedidos = [];
  const sb = montar({
    brain: {
      reply: (t) => { pedidos.push(t); return { handled: true, text: 'Te abrí Mapas.' }; },
      parseWhen: () => ({ when: null }),
    },
  });
  const r = sb.KiuAgente.get('device_action').run({ what: 'maps', target: 'el aeropuerto' });
  assert.equal(r.ok, true);
  assert.match(pedidos[0], /aeropuerto/);
});

/* ================= 6 · el riesgo se calcula con los argumentos ================= */

test('leer no pide confirmación: escribir sí', () => {
  const sb = montar();
  const A = sb.KiuAgente;
  assert.equal(A.riskOf(A.get('manage_task'), { action: 'list' }), 'read');
  assert.equal(A.riskOf(A.get('manage_task'), { action: 'add', text: 'x' }), 'write');
  assert.equal(A.riskOf(A.get('manage_alarm'), { action: 'list' }), 'read');
  assert.equal(A.riskOf(A.get('manage_alarm'), { action: 'cancel', which: 'x' }), 'write');
  assert.equal(A.riskOf(A.get('device_action'), { what: 'bateria' }), 'read');
  assert.equal(A.riskOf(A.get('device_action'), { what: 'linterna' }), 'write');
});

test('el bucle NO pide confirmación para una herramienta de lectura', async () => {
  const confirmados = [];
  const respuestas = ['{"tool":"manage_task","args":{"action":"list"}}', '{"listo":true}'];
  const sb = montar({
    Kiu: {
      ask(hist, maxT, cb) { cb({ ok: true, text: respuestas.shift() }); },
    },
  });
  await new Promise((res) => {
    sb.KiuAgente.run({
      habla: ['¿qué tareas tengo?'],
      confirmar: (tool, args, cb) => { confirmados.push(tool); cb(true); },
    }, () => res());
  });
  assert.deepEqual(confirmados, [], 'listar no es una acción con efecto');
});

test('el bucle SÍ pide confirmación para una herramienta de escritura', async () => {
  const confirmados = [];
  const respuestas = ['{"tool":"manage_task","args":{"action":"add","text":"comprar pan"}}', '{"listo":true}'];
  const sb = montar({
    Kiu: { ask(hist, maxT, cb) { cb({ ok: true, text: respuestas.shift() }); } },
  });
  await new Promise((res) => {
    sb.KiuAgente.run({
      habla: ['agregá comprar pan a mis tareas'],
      confirmar: (tool, args, cb) => { confirmados.push([tool, args.text]); cb(true); },
    }, () => res());
  });
  assert.equal(confirmados.length, 1);
  assert.equal(confirmados[0][0], 'manage_task');
  assert.equal(confirmados[0][1], 'comprar pan');
});

/* ================= 7 · el modelo sabe QUIÉN es el usuario ================= */

test('el prompt de decisión lleva el perfil del usuario', () => {
  const sb = montar();
  sb.KiuMem.addTarea('llamar al dentista');
  const p = sb.KiuAgente.systemPrompt('poné una alarma a las 7', null, [], false);
  assert.match(p, /PERFIL DEL USUARIO:/);
  assert.match(p, /Sasha/, 'el nombre del usuario');
  assert.match(p, /llamar al dentista/, 'y lo que tiene pendiente');
});

test('sin memoria ni nombre, el prompt no inventa un perfil', () => {
  const sb = montar({ S: { kiu: { ok: true } } });
  const p = sb.KiuAgente.systemPrompt('hola', null, [], false);
  assert.doesNotMatch(p, /PERFIL DEL USUARIO:/);
});

/* ================= 8 · el bucle completo: el modelo consulta la memoria ===== */

test('el agente consulta la memoria y usa lo que encontró', async () => {
  const respuestas = [
    '{"tool":"recall","args":{"query":"dentista"}}',
    '{"listo":true}',
  ];
  const sb = montar({
    Kiu: { ask(hist, maxT, cb) { cb({ ok: true, text: respuestas.shift() }); } },
  });
  sb.KiuMem.addRecuerdo('el dentista es el martes a las 10');
  const res = await new Promise((r) => {
    sb.KiuAgente.run({ habla: ['¿cuándo es el dentista?'], componer: false }, r);
  });
  assert.equal(res.ok, true);
  assert.match(res.text, /dentista/);
  assert.match(res.text, /martes/);
});

/* ================= 9 · la gramática sigue siendo coherente ================= */

test('la gramática incluye las herramientas nuevas y sigue siendo derivable del esquema', () => {
  const sb = montar();
  const g = sb.KiuAgente.grammar();
  assert.match(g, /recall-?/);
  assert.match(g, /manage-task/);
  assert.match(g, /manage-alarm/);
  assert.match(g, /create-calendar-event/);
  /* el enum de manage_task tiene que estar en la gramática: es lo que impide
     que el modelo invente una acción que no existe */
  /* los valores del enum van dentro de un literal GBNF: van con barra */
  assert.match(g, /\\"list\\"/);
  assert.match(g, /\\"add\\"/);
  assert.match(g, /\\"done\\"/);
});

test('el manifiesto compacto (el que se paga en el móvil) entra en presupuesto', () => {
  const sb = montar();
  const tok = sb.KiuAgente.budget().manifiestoCompactoTok;
  assert.ok(tok <= 140, 'manifiesto compacto: ' + tok + ' tokens, el techo es 140');
});

/* ================= 11 · el modelo ve el VOCABULARIO de cada herramienta ==== */

test('el manifiesto compacto lleva los valores del enum: el modelo no adivina', () => {
  /* v2.14.2 · en compacto el manifiesto era solo la firma
     (`manage_task(action, text?)`): el modelo no sabía que action valía
     list|add|done, se lo inventaba, la validación lo rechazaba y se perdía
     una generación entera. */
  const sb = montar();
  const c = sb.KiuAgente.manifest(null, true);
  assert.match(c, /manage_task\(action: list\|add\|done, text\?\)/);
  assert.match(c, /manage_alarm\(action: list\|cancel, which\?\)/);
  assert.match(c, /recall\(query\?, kind\?: recuerdos\|tareas\|notas\|prefs\)/);
  assert.match(c, /device_action\(what: linterna\|bateria\|/, 'y las acciones del teléfono');
});

test('el costo real de un turno es el de sus herramientas, no el del registro entero', () => {
  /* v2.14.2 · seleccionar() acota el manifiesto por turno. Un pedido típico
     lleva 2-4 herramientas, así que el prefill real es una fracción del
     registro completo. Esto es lo que hace pagable el manifiesto largo. */
  const sb = montar();
  const elegidas = sb.KiuAgente.seleccionar('poné una alarma a las 7');
  assert.ok(elegidas.length < sb.KiuAgente.toolNames().length, 'el turno no lleva todas');
  const tok = Math.round(sb.KiuAgente.manifest(elegidas, true).length / 3.6);
  assert.ok(tok <= 60, 'manifiesto del turno: ' + tok + ' tokens, el techo es 60');
});

/* ================= 12 · las observaciones le dicen qué pasó ================ */

test('la observación dice qué herramienta se ejecutó y si salió bien', async () => {
  /* v2.14.2 · antes volvía al modelo el texto pelado: no distinguía "no
     encontré nada" de "el dispositivo falló" y se equivocaba de herramienta
     en el paso siguiente. */
  const respuestas = [
    '{"tool":"recall","args":{"query":"hipoteca"}}',
    '{"listo":true}',
  ];
  const sb = montar({
    Kiu: { ask(h, m, cb) { cb({ ok: true, text: respuestas.shift() }); } },
  });
  sb.KiuMem.addRecuerdo('algo del trabajo');
  const r = await new Promise((res) => {
    sb.KiuAgente.run({ habla: ['buscá la hipoteca'], componer: false }, res);
  });
  const obs = String(r.obs);
  assert.match(obs, /\[recall ok\]/, 'observación con herramienta y estado');
});

/* ================= 10 · las preferencias dejan de ser un bucket vacío ===== */
test('"prefiero el mate amargo" llena las preferencias (nada las escribía)', () => {
  const sb = montar();
  loadAll(sb, ['js/app/state.js', 'js/app/catalog.js', 'js/app/models.js', 'js/app/motor.js']);
  const ok = sb.KB.extract('prefiero el mate amargo');
  assert.equal(ok, true, 'KB tiene que reconocer la preferencia');
  const prefs = sb.KiuMem.list('prefs');
  assert.equal(prefs.length, 1, 'y tiene que quedar en el bucket de preferencias');
  assert.match(prefs[0].text, /mate amargo/);
});

/* ================= 13 · la memoria se puede OLVIDAR y CORREGIR ============ */

test('forget borra lo que el usuario ya no quiere', () => {
  const sb = montar();
  sb.KiuMem.addRecuerdo('el dentista es el martes');
  sb.KiuMem.addNota('comprar leche');
  const r = sb.KiuAgente.get('forget').run({ text: 'dentista' });
  assert.equal(r.ok, true);
  assert.match(r.text, /Olvidé 1/);
  assert.equal(sb.KiuMem.list('recuerdos').length, 0, 'el recuerdo se borró');
  assert.equal(sb.KiuMem.list('notas').length, 1, 'y no se borró lo que no era');
});

test('forget no encuentra y lo dice honestamente', () => {
  const sb = montar();
  sb.KiuMem.addRecuerdo('otra cosa');
  const r = sb.KiuAgente.get('forget').run({ text: 'hipoteca' });
  assert.equal(r.ok, true);
  assert.match(r.text, /No encontré nada guardado/);
  assert.equal(sb.KiuMem.list('recuerdos').length, 1, 'no se borró nada por las dudas');
});

test('update_memory corrige en el lugar, sin dejar el viejo al lado', () => {
  const sb = montar();
  sb.KiuMem.addRecuerdo('el dentista es el martes');
  const r = sb.KiuAgente.get('update_memory').run({
    text: 'dentista es el martes',
    new_text: 'el dentista es el jueves'
  });
  assert.equal(r.ok, true);
  assert.match(r.text, /Corregí/);
  const recs = sb.KiuMem.list('recuerdos');
  assert.equal(recs.length, 1, 'no quedó el recuerdo viejo al lado del nuevo');
  assert.match(recs[0].text, /jueves/);
});

test('update_memory sin el texto nuevo no hace nada', () => {
  const sb = montar();
  sb.KiuMem.addRecuerdo('algo');
  const r = sb.KiuAgente.get('update_memory').run({ text: 'algo', new_text: '' });
  assert.equal(r.ok, false);
  assert.match(r.err, /falta el texto/);
});

/* ================= 14 · el usuario ve en qué está el agente ============== */

test('el agente avisa qué herramienta va a usar', async () => {
  /* v2.14.2 · un turno puede dar 3-4 pasos y cada paso es una generación en
     la CPU del teléfono. Sin esto, el usuario ve "Enrutando" clavado. */
  const pasos = [];
  const respuestas = ['{"tool":"manage_task","args":{"action":"list"}}', '{"listo":true}'];
  const sb = montar({
    Kiu: { ask(h, m, cb) { cb({ ok: true, text: respuestas.shift() }); } },
  });
  await new Promise((res) => {
    sb.KiuAgente.run({
      habla: ['qué tareas tengo'],
      componer: false,
      avanzar: (que, tool) => pasos.push([que, tool]),
    }, () => res());
  });
  const herramientas = pasos.filter((p) => p[0] === 'usando').map((p) => p[1]);
  assert.deepEqual(herramientas.join(','), 'manage_task', 'y sabe QUÉ herramienta se está usando');
});

test('el agente avisa cuando está corrigiendo una decisión inválida', async () => {
  const pasos = [];
  const respuestas = ['{"tool":"inventada","args":{}}', '{"listo":true}'];
  const sb = montar({
    Kiu: { ask(h, m, cb) { cb({ ok: true, text: respuestas.shift() }); } },
  });
  await new Promise((res) => {
    sb.KiuAgente.run({
      habla: ['algo'],
      componer: false,
      avanzar: (que, tool) => pasos.push(que),
    }, () => res());
  });
  assert.ok(pasos.indexOf('corrigiendo') >= 0, 'el usuario tiene que ver que el bot se está corrigiendo');
});
