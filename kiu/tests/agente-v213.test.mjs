/* agente-v213.test.mjs — v2.13.0: motores locales que se cargan solos, herramientas
   nuevas (send_message, remember, now) y respuesta redactada por el modelo. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const here = path.dirname(fileURLToPath(import.meta.url));
const WWW = path.join(here, '..', 'app', 'src', 'main', 'assets', 'www', 'js');
const agSrc = readFileSync(path.join(WWW, 'kiu-agente.js'), 'utf8');
const motorSrc = readFileSync(path.join(WWW, 'app', 'motor.js'), 'utf8');
const uiSrc = readFileSync(path.join(WWW, 'app', 'app-ui.js'), 'utf8');

function agente(over = {}) {
  const ctx = {};
  ctx.window = ctx;
  ctx.S = over.S || { kiu: { ok: true, name: 'x.gguf' } };
  ctx.Kiu = over.Kiu;
  ctx.KiuBrain = { reply: () => ({ handled: false }), parseWhen: () => ({ when: null }) };
  ctx.KiuApp = over.app || {};
  ctx.KiuMem = over.mem;
  ctx.RAG = { on: false };
  ctx.rawBridge = () => false;
  ctx.console = console;
  ctx.setTimeout = setTimeout; ctx.clearTimeout = clearTimeout;
  vm.createContext(ctx);
  vm.runInContext(agSrc, ctx, { filename: 'kiu-agente.js' });
  return ctx.KiuAgente;
}

test('send_message resuelve el contacto y abre el SMS con el texto', () => {
  const calls = [];
  const A = agente({ app: {
    contactSearch: () => [{ name: 'Juan', num: '+54 11 5555-1234' }],
    bridgeCall: (fn, args) => { calls.push([fn, args]); return true; },
  } });
  const v = A.validate('send_message', { to: 'Juan', text: 'ya llegué' });
  assert.equal(v.ok, true);
  const r = A.get('send_message').run(v.args);
  assert.equal(r.ok, true);
  assert.equal(JSON.stringify(calls[0]), JSON.stringify(['sms', ['+541155551234', 'ya llegué']]));
  assert.match(r.text, /enviar/);
});

test('send_message no inventa números: sin contacto, falla con motivo', () => {
  const A = agente({ app: { contactSearch: () => [], bridgeCall: () => true } });
  const r = A.get('send_message').run({ to: 'Fulano', text: 'hola' });
  assert.equal(r.ok, false);
  assert.match(r.err, /no encontré el número/);
});

test('send_message pide permiso si falta el de contactos', () => {
  const A = agente({ app: { contactSearch: () => 'NEED_PERM' } });
  assert.match(A.get('send_message').run({ to: 'Ana', text: 'x' }).err, /permiso/);
});

test('remember guarda en la memoria del usuario', () => {
  const guardado = [];
  const A = agente({ mem: { addRecuerdo: (t) => guardado.push(t) } });
  const r = A.get('remember').run({ text: 'la clave del wifi está en la heladera' });
  assert.equal(r.ok, true);
  assert.equal(JSON.stringify(guardado), JSON.stringify(['la clave del wifi está en la heladera']));
});

test('now devuelve fecha y hora reales', () => {
  const A = agente({});
  const r = A.get('now').run({});
  assert.equal(r.ok, true);
  assert.match(r.text, new RegExp(String(new Date().getFullYear())));
  assert.match(r.text, /\d\d:\d\d/);
});

test('las herramientas nuevas están en la gramática con nombres GBNF válidos', () => {
  const g = agente({}).grammar();
  for (const n of ['send-message', 'remember', 'now']) assert.match(g, new RegExp('^' + n + ' ::=', 'm'));
  /* now no tiene argumentos: el objeto vacío tiene que ser legal */
  assert.match(g, /^now ::= .*args.*\{" "\}\}"/m);
});

test('run(): si el modelo no está cargado, lo carga (whenReady) y sigue', async () => {
  let listo = false, cargas = 0;
  const S = { kiu: { ok: false, name: 'x.gguf' } };
  const A = agente({
    S,
    Kiu: {
      whenReady(cb) { cargas++; setTimeout(() => { S.kiu.ok = true; listo = true; cb(true); }, 5); },
      ask(hist, maxT, cb) { cb({ ok: true, text: '{"listo":true}' }); },
    },
  });
  const r = await new Promise((res) => A.run({ habla: ['qué hora es'] }, res));
  assert.equal(cargas, 1);
  assert.equal(listo, true);
  assert.equal(r.ok, false, 'sin herramientas ejecutadas no hay respuesta del agente');
  assert.notEqual(r.err, 'sin modelo cargado');
});

test('run(): si la carga falla, avisa «sin modelo cargado» y no explota', async () => {
  const A = agente({
    S: { kiu: { ok: false } },
    Kiu: { whenReady: (cb) => cb(false, 'sin-modelo'), ask() { throw new Error('no debería preguntar'); } },
  });
  const r = await new Promise((res) => A.run({ habla: ['x'] }, res));
  assert.equal(r.err, 'sin modelo cargado');
});

test('run(): el modelo redacta la respuesta final cuando hay varios resultados', async () => {
  /* v2.14.2 · la redacción final se hace SOLO cuando aporta: con varios
     resultados (o uno largo) el modelo los ordena en un par de frases. Con un
     resultado único y corto, el texto de la herramienta ES la respuesta y
     redactarlo sería gastar una generación entera (ver el test de abajo). */
  const prompts = [];
  const respuestas = ['{"tool":"web_search","args":{"query":"dolar"}}', '{"listo":true}', 'El dólar está a 1000.'];
  const A = agente({
    app: {
      webSnippets: (q, cb) => cb([
        { t: 'Dólar', s: 'cotiza a 1000 pesos', u: '' },
        { t: 'Blue', s: 'cotiza a 1005 pesos', u: '' },
        { t: 'MEP', s: 'cotiza a 998 pesos', u: '' },
      ]),
    },
    Kiu: { ask(hist, maxT, cb) { prompts.push(hist); cb({ ok: true, text: respuestas.shift() }); } },
  });
  const r = await new Promise((res) => A.run({ habla: ['busca el dólar'] }, res));
  assert.equal(r.ok, true);
  assert.equal(r.text, 'El dólar está a 1000.');
  assert.match(r.crudo, /cotiza a 1000 pesos/, 'conserva el texto crudo de la herramienta');
  const ultimo = prompts[prompts.length - 1];
  assert.match(ultimo[0].content, /RESULTADOS:/);
  assert.match(ultimo[0].content, /Hoy es|cotiza/, 'el modelo ve lo que pasó');
});

test('run(): un resultado corto y único se muestra tal cual, sin segunda generación', async () => {
  /* v2.14.2 · UN TURNO = UNA GENERACIÓN. Un resultado corto de una sola
     herramienta no necesita que el modelo lo redacte: son segundos de
     prefill en el teléfono para decir lo mismo. */
  let n = 0;
  const cola = ['{"tool":"now","args":{}}', '{"listo":true}'];
  const A = agente({ Kiu: { ask(h, m, cb) { n++; cb({ ok: true, text: cola.shift() }); } } });
  const r = await new Promise((res) => A.run({ habla: ['¿qué hora es?'] }, res));
  assert.equal(n, 2, 'decisión + listo: ninguna redacción extra');
  assert.equal(r.ok, true);
  assert.match(r.text, /Hoy es/);
  assert.equal(r.crudo, undefined, 'no hubo redacción, así que no hay texto crudo aparte');
});

test('run(): si la redacción falla, vale el texto crudo de la herramienta', async () => {
  const cola = ['{"tool":"now","args":{}}', '{"listo":true}'];
  const A = agente({
    Kiu: { ask(h, m, cb) { const t = cola.shift(); cb(t ? { ok: true, text: t } : { ok: false, err: 'x' }); } },
  });
  const r = await new Promise((res) => A.run({ habla: ['hora'] }, res));
  assert.equal(r.ok, true);
  assert.match(r.text, /Hoy es/);
});

test('run(): componer:false devuelve el texto de la herramienta sin gastar otra generación', async () => {
  let n = 0;
  const cola = ['{"tool":"now","args":{}}', '{"listo":true}'];
  const A = agente({ Kiu: { ask(h, m, cb) { n++; cb({ ok: true, text: cola.shift() }); } } });
  const r = await new Promise((res) => A.run({ habla: ['hora'], componer: false }, res));
  assert.equal(n, 2);
  assert.match(r.text, /Hoy es/);
});

test('Qwen3: el prompt del agente lleva /no_think; otras familias no', () => {
  const q = agente({ S: { kiu: { ok: true, name: 'Qwen3-4B-Q4_K_M.gguf' } } });
  assert.match(q.systemPrompt('x', null, [], false), /\/no_think/);
  const l = agente({ S: { kiu: { ok: true, name: 'Llama-3.2-1B.gguf' } } });
  assert.doesNotMatch(l.systemPrompt('x', null, [], false), /no_think/);
});

/* ---- Kiu.whenReady (motor.js) y su uso en app-ui.js: contrato por código fuente ---- */
test('motor.js define Kiu.whenReady que espera una carga en curso y carga el último modelo', () => {
  assert.match(motorSrc, /whenReady: function \(cb\)/);
  assert.match(motorSrc, /this\.pending\.op === 'load'/, 'espera la carga en curso');
  assert.match(motorSrc, /S\.kiu\.name && S\.dl\.done\[S\.kiu\.name\]\) \? S\.kiu\.name : this\.best\(\)/);
});

test('kiuReply usa whenReady en vez de pedir que reenvíen el mensaje', () => {
  assert.match(uiSrc, /Kiu\.whenReady\(function \(okR, why\)/);
  assert.doesNotMatch(uiSrc, /mandame de nuevo tu mensaje en unos segundos/);
  assert.match(uiSrc, /kiuReply: function \(text, liveEl, img, tinyRetry, _ready\)/);
});

test('con el router apagado y modelos descargados, tryTargets igual autocarga el motor local', () => {
  assert.match(uiSrc, /if \(Kiu\.best\(\)\) \{ this\.kiuReply\(text, null\); return; \}/);
});

test('motor ocupado: tryTargets espera en vez de saltar a «no tengo modelo»', () => {
  assert.match(uiSrc, /Kiu\.available\(\) && Kiu\.busyG\) \{\s*this\._busyTries/);
});

test('el agente corre aunque el modelo no esté cargado, si hay uno descargado', () => {
  assert.match(uiSrc, /\(S\.kiu\.ok \|\| \(Kiu\.available\(\) && Kiu\.best\(\)\)\) && window\.KiuAgente && S\.agentOn/);
});

/* ---- v2.13.1: selección por turno, web_search asíncrona, registro y confirmación ---- */
test('seleccionar(): un pedido típico manda 1-3 herramientas y el prompt baja del presupuesto', () => {
  const A = agente({});
  const s1 = A.seleccionar('poneme una alarma a las 7');
  assert.ok(s1.includes('set_alarm') && s1.length <= 3, s1.join());
  const s2 = A.seleccionar('¿qué tengo mañana?');
  assert.ok(s2.includes('read_calendar') && !s2.includes('send_message'), s2.join());
  const s3 = A.seleccionar('mandale un mensaje a Juan que ya llegué');
  assert.ok(s3.includes('send_message'));
  for (const frase of ['poneme una alarma a las 7', '¿qué tengo mañana?', 'llama a mamá', 'anotá que compré leche']) {
    const lista = A.seleccionar(frase);
    const tok = Math.round(A.systemPrompt(frase, lista, [], true).length / 3.6);
    assert.ok(tok <= 300, frase + ': ' + tok + ' tokens con ' + lista.join());
  }
});

test('seleccionar(): sin ninguna coincidencia manda TODAS (no se le quita la herramienta correcta)', () => {
  const A = agente({});
  assert.equal(A.seleccionar('xyzzy plugh').length, A.toolNames().length);
});

test('seleccionar(): una herramienta sin palabra clave (nueva) va siempre', () => {
  const A = agente({});
  A.TOOLS.nueva = { name: 'nueva', desc: 'x', args: {}, run: () => ({ ok: true }), risk: 'read' };
  try { assert.ok(A.seleccionar('poneme una alarma').includes('nueva')); } finally { delete A.TOOLS.nueva; }
});

test('web_search espera la promesa y el resultado llega al usuario', async () => {
  const cola = ['{"tool":"web_search","args":{"query":"dolar hoy"}}', '{"listo":true}'];
  const prompts = [];
  const A = agente({
    app: { webSnippets: (q, cb) => setTimeout(() => cb([{ t: 'Dólar', s: 'cotiza a 1000 pesos', u: '' }]), 5) },
    Kiu: { ask(h, m, cb) { prompts.push(h); cb({ ok: true, text: cola.shift() }); } },
  });
  const r = await new Promise((res) => A.run({ habla: ['busca el dólar hoy'] }, res));
  assert.equal(r.ok, true);
  /* v2.14.2 · un solo resultado corto: se muestra tal cual, sin redactar */
  assert.match(r.text, /cotiza a 1000 pesos/);
  assert.match(String(r.obs), /web_search ok/, 'el modelo ve la observación estructurada');
});

test('web_search sin conexión informa el error al modelo y no cuelga el bucle', async () => {
  const A = agente({ app: { webSnippets: (q, cb) => cb([]) } });
  const r = await A.get('web_search').run({ query: 'x' });
  assert.equal(r.ok, false);
  assert.match(r.err, /sin conexión/);
});

test('el registro guarda herramienta, riesgo y resultado, y NUNCA los argumentos', async () => {
  const cola = ['{"tool":"remember","args":{"text":"mi clave secreta 1234"}}', '{"listo":true}'];
  const A = agente({
    mem: { addRecuerdo() { } },
    Kiu: { ask(h, m, cb) { const t = cola.shift(); cb({ ok: true, text: t }); } },
  });
  A.clearLog();
  await new Promise((res) => A.run({ habla: ['anotá mi clave'], componer: false }, res));
  const log = A.getLog();
  assert.equal(log.length, 1);
  assert.equal(log[0].tool, 'remember');
  assert.equal(log[0].risk, 'write');
  assert.equal(log[0].ok, true);
  assert.doesNotMatch(JSON.stringify(log), /1234/, 'el registro no puede guardar el contenido');
});

test('confirmar(): si el usuario dice que no, la acción NO se ejecuta', async () => {
  let guardado = 0;
  const cola = ['{"tool":"remember","args":{"text":"x"}}', '{"listo":true}'];
  const A = agente({
    mem: { addRecuerdo() { guardado++; } },
    Kiu: { ask(h, m, cb) { cb({ ok: true, text: cola.shift() }); } },
  });
  A.clearLog();
  const r = await new Promise((res) => A.run({ habla: ['anotá x'], confirmar: (n, a, cb) => cb(false) }, res));
  assert.equal(guardado, 0);
  assert.equal(r.ok, false);
  assert.equal(A.getLog()[0].ok, false);
  assert.match(A.getLog()[0].note, /cancelada/);
});

test('confirmar(): si dice que sí, se ejecuta; las de solo lectura no preguntan', async () => {
  let preguntas = 0, guardado = 0;
  const cola = ['{"tool":"now","args":{}}', '{"tool":"remember","args":{"text":"x"}}', '{"listo":true}'];
  const A = agente({
    mem: { addRecuerdo() { guardado++; } },
    Kiu: { ask(h, m, cb) { cb({ ok: true, text: cola.shift() }); } },
  });
  await new Promise((res) => A.run({ habla: ['hora y anotá x'], componer: false, confirmar: (n, a, cb) => { preguntas++; cb(true); } }, res));
  assert.equal(preguntas, 1, 'solo remember (write) pregunta; now (read) no');
  assert.equal(guardado, 1);
});

test('app-ui pasa confirmar al agente y confirm() avisa la cancelación (no cuelga el bucle)', () => {
  /* v2.14.2 · la llamada al agente creció: además de confirmar, le pasa
     `avanzar` para que la pastilla diga qué está haciendo. El contrato que
     importa sigue siendo que el llamador pase `confirmar`. */
  assert.match(uiSrc, /habla: \[text\],/);
  assert.match(uiSrc, /confirmar: function \(tool, args, cbC\)/);
  assert.match(uiSrc, /avanzar: function \(que, tool\)/, 'y que le avise en qué está');
  assert.match(uiSrc, /agentConfirm: function \(tool, args, cb\)/);
  assert.match(uiSrc, /if \(!S\.agentConfirm\) \{ cb\(true\); return; \}/, 'apagada por defecto');
  assert.match(uiSrc, /onCancel: function \(\) \{ once\(false\); \}/);
  assert.match(uiSrc, /setTimeout\(function \(\) \{ once\(false\); \}, 60000\)/, 'tope de 60 s');
  assert.match(uiSrc, /opts\.onCancel\(\)/);
});

const htmlSrc = readFileSync(path.join(WWW, '..', 'index.html'), 'utf8');
test('Ajustes tiene el interruptor «Confirmar antes de actuar» y está conectado a S.agentConfirm', () => {
  assert.match(htmlSrc, /id="tg-agent-confirm"/);
  assert.match(uiSrc, /getElementById\('tg-agent-confirm'\)/);
  assert.match(uiSrc, /S\.agentConfirm = !S\.agentConfirm; saveS\(\)/);
});
test('el aviso del agente ya no dice que exige un modelo ya cargado', () => {
  assert.doesNotMatch(htmlSrc, /Necesita un modelo cargado/);
  assert.match(htmlSrc, /lo carga solo/);
});

/* ---- v2.13.3: formato de chat según la plantilla del propio GGUF ---- */
test('famFromTemplate reconoce ChatML, Llama 3, Gemma y Mistral por su plantilla', () => {
  assert.match(motorSrc, /famFromTemplate: function \(tpl\)/);
  const fn = new Function('return ' + motorSrc.match(/famFromTemplate: (function \(tpl\) \{[\s\S]*?\n    \}),\n    famFor/)[1])();
  assert.equal(fn('{% for m in messages %}<|im_start|>{{m.role}}'), 'qwen');
  assert.equal(fn('<|start_header_id|>user<|end_header_id|>'), 'llama');
  assert.equal(fn('<start_of_turn>user'), 'gemma');
  assert.equal(fn('[INST] {{ m.content }} [/INST]'), 'mistral');
  assert.equal(fn('<|user|> {{x}} <|end|>'), null, 'Phi-3 no se reconoce: sigue el catálogo');
  assert.equal(fn(''), null);
});
test('Llama 3 con plantilla en el GGUF gana al nombre del archivo', () => {
  assert.match(motorSrc, /rawBridge\('kiuChatTemplate'\)/);
  assert.match(motorSrc, /solo se cachea cuando hay plantilla real/);
  assert.match(motorSrc, /var fam = this\.famFor\(\);/);
});
test('el formato Mistral arma [INST] … [/INST] y no repite el BOS', () => {
  assert.match(motorSrc, /fam === 'mistral'/);
  assert.match(motorSrc, /'\[INST\] '/);
  assert.doesNotMatch(motorSrc, /out = '<s>/);
});
test('el puente y el nativo exponen la plantilla de chat', () => {
  const cpp = readFileSync(path.join(here, '..', 'app', 'src', 'main', 'cpp', 'kiullama_jni.cpp'), 'utf8');
  const kn = readFileSync(path.join(here, '..', 'app', 'src', 'main', 'java', 'com', 'kiu', 'agent', 'KiuNative.java'), 'utf8');
  const ma = readFileSync(path.join(here, '..', 'app', 'src', 'main', 'java', 'com', 'kiu', 'agent', 'MainActivity.java'), 'utf8');
  assert.match(cpp, /Java_com_kiu_agent_KiuNative_chatTemplate/);
  assert.match(cpp, /llama_model_chat_template\(g_model, nullptr\)/);
  assert.match(cpp, /g_chat_tpl\.clear\(\)/, 'se limpia al liberar el modelo');
  assert.match(kn, /native String chatTemplate\(\)/);
  assert.match(ma, /public String kiuChatTemplate\(\)/);
});
