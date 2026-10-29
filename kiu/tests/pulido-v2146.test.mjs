/* pulido-v2146.test.mjs — v2.14.6: tres cosas que la gente pidió en voz alta.
 *
 *   1. EL PIE DE DIAGNÓSTICO ("(motor interno · modelo · 6,3 tok/s)").
 *      Ocupaba media pantalla al final de cada respuesta y el usuario no lo
 *      había pedido. Ahora está apagado por defecto y se enciende en Ajustes.
 *   2. EL CIERRE FORZADO. El motor vive dentro del proceso de la app: los
 *      pesos del modelo, el contexto y el WebView comparten la RAM del
 *      teléfono. Cuando eso se desborda, Android mata la app entera y el
 *      usuario no ve por qué ("le pedí que creara una web y se cerró").
 *      Ahora hay una guarda: si no hay memoria, se corta y se DICE por qué.
 *   3. LA VOZ RÓBOTICA. Se prefería la voz local del sistema (robótica)
 *      porque las de red necesitan internet y, si fallaban, Kiu quedaba
 *      mudo. Pero el TTS ya reintenta con una local si la de red falla, así
 *      que el miedo era infundado: ahora se usa la que suena humana y se cae
 *      a la local si no hay red.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.join(here, '..');
const WWW = path.join(raiz, 'app', 'src', 'main', 'assets', 'www');
const motorSrc = readFileSync(path.join(WWW, 'js', 'app', 'motor.js'), 'utf8');
const stateSrc = readFileSync(path.join(WWW, 'js', 'app', 'state.js'), 'utf8');
const uiSrc = readFileSync(path.join(WWW, 'js', 'app', 'app-ui.js'), 'utf8');
const htmlSrc = readFileSync(path.join(WWW, 'index.html'), 'utf8');
const mainJava = readFileSync(path.join(raiz, 'app', 'src', 'main', 'java', 'com', 'kiu', 'agent', 'MainActivity.java'), 'utf8');

/* ---------- 1 · el pie de diagnóstico ---------- */
test('el pie de diagnóstico está apagado por defecto y se puede encender', () => {
  assert.match(stateSrc, /detalles:\s*false/, 'por defecto apagado');
  assert.match(uiSrc, /var pie = S\.detalles \?/, 'el pie depende del ajuste');
  assert.match(htmlSrc, /id="tg-detalles"/, 'hay un interruptor para encenderlo');
  assert.match(uiSrc, /getElementById\('tg-detalles'\)/, 'y está enganchado');
});

/* ---------- 2 · la guarda de memoria ---------- */
test('sin memoria, el motor NO arranca y lo dice (en vez de que maten la app)', () => {
  const ctx = {};
  ctx.window = ctx;
  ctx.console = console;
  ctx.localStorage = { getItem: () => null, setItem: () => { }, removeItem: () => { } };
  ctx.setTimeout = () => 0; ctx.clearTimeout = () => { };
  ctx.setInterval = () => 0; ctx.clearInterval = () => { };
  ctx.navigator = { hardwareConcurrency: 8 };
  ctx.document = { getElementById: () => null, querySelectorAll: () => [], addEventListener: () => { } };
  ctx.App = { toast: () => { }, renderModels: () => { }, renderStatus: () => { }, renderSys: () => { } };
  let genero = 0;
  const puente = {
    sysInfo: () => JSON.stringify({ ramAvail: 90 * 1048576, ramTotal: 2000 * 1048576 }),
    kiuGen: () => { genero++; return true; },
    kiuGenStatus: () => JSON.stringify({ id: 1, text: 'hola', done: false, toks: 1 })
  };
  ctx.KiuBridge = puente;
  ctx.rawBridge = (fn) => (puente[fn] ? puente[fn]() : null);
  vm.createContext(ctx);
  vm.runInContext(readFileSync(path.join(WWW, 'js', 'app', 'env.js'), 'utf8'), ctx, { filename: 'env.js' });
  vm.runInContext(readFileSync(path.join(WWW, 'js', 'app', 'catalog.js'), 'utf8'), ctx, { filename: 'catalog.js' });
  vm.runInContext(motorSrc, ctx, { filename: 'motor.js' });
  ctx.S = { kiu: { ok: true, name: 'x.gguf' }, dl: { done: {} }, temp: 0.7 };
  ctx.Kiu = ctx.Kiu;

  let r = null;
  ctx.Kiu.ask([{ role: 'user', content: 'hola' }], 50, (out) => { r = out; });
  assert.equal(genero, 0, 'no se puede generar con esa memoria');
  assert.ok(r && r.ok === false, 'y la respuesta es un error, no una generación rota');
  assert.match(String(r.err), /memoria/i, 'que dice que la falta es de memoria');
  assert.match(String(r.err), /Liberar motor|más chico/, 'y qué hacer al respecto');
});

test('con memoria de sobra, el motor arranca normal', () => {
  const ctx = {};
  ctx.window = ctx;
  ctx.console = console;
  ctx.localStorage = { getItem: () => null, setItem: () => { }, removeItem: () => { } };
  ctx.setTimeout = () => 0; ctx.clearTimeout = () => { };
  ctx.setInterval = () => 0; ctx.clearInterval = () => { };
  ctx.navigator = { hardwareConcurrency: 8 };
  ctx.document = { getElementById: () => null, querySelectorAll: () => [], addEventListener: () => { } };
  ctx.App = { toast: () => { }, renderModels: () => { }, renderStatus: () => { }, renderSys: () => { } };
  let genero = 0;
  const puente = {
    sysInfo: () => JSON.stringify({ ramAvail: 1200 * 1048576, ramTotal: 4000 * 1048576 }),
    kiuGen: () => { genero++; return true; },
    kiuGenStatus: () => JSON.stringify({ id: 1, text: 'hola', done: false, toks: 1 })
  };
  ctx.KiuBridge = puente;
  ctx.rawBridge = (fn) => (puente[fn] ? puente[fn]() : null);
  vm.createContext(ctx);
  vm.runInContext(readFileSync(path.join(WWW, 'js', 'app', 'env.js'), 'utf8'), ctx, { filename: 'env.js' });
  vm.runInContext(readFileSync(path.join(WWW, 'js', 'app', 'catalog.js'), 'utf8'), ctx, { filename: 'catalog.js' });
  vm.runInContext(motorSrc, ctx, { filename: 'motor.js' });
  ctx.S = { kiu: { ok: true, name: 'x.gguf' }, dl: { done: {} }, temp: 0.7 };
  ctx.Kiu.ask([{ role: 'user', content: 'hola' }], 50, () => { });
  assert.equal(genero, 1, 'con memoria hay que generar');
});

/* ---------- 3 · la voz ---------- */
test('la voz: primero la de red (que suena humana) y se cae a la local si no hay red', () => {
  assert.match(mainJava, /if \(hayRed\(\) && pickVoice\(true\)\)/,
    'con internet se elige la mejor voz (de red)');
  assert.match(mainJava, /if \(!pickVoice\(false\)\) \{\s*pickVoice\(true\);/,
    'sin internet se usa la local, y la de red es el último recurso');
  assert.match(mainJava, /private boolean hayRed\(\)/, 'hay un chequeo de red');
  assert.match(mainJava, /NET_CAPABILITY_INTERNET/, 'que mira la capacidad de internet de verdad');
  /* y el reintento con voz local ya existía (por eso el cambio es seguro) */
  assert.match(mainJava, /ttsRetried[\s\S]{0,400}pickVoice\(false\)/,
    'si la voz de red falla, se reintenta con una local');
});

test('lo que se habla está limpio: sin URLs ni símbolos sueltos', () => {
  const ctx = {};
  ctx.window = ctx;
  ctx.console = console;
  ctx.localStorage = { getItem: () => null, setItem: () => { }, removeItem: () => { } };
  ctx.setTimeout = () => 0; ctx.clearTimeout = () => { };
  ctx.setInterval = () => 0; ctx.clearInterval = () => { };
  ctx.navigator = { hardwareConcurrency: 8 };
  ctx.document = { getElementById: () => null, querySelectorAll: () => [], addEventListener: () => { } };
  ctx.S = { voiceOn: false };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(path.join(WWW, 'js', 'app', 'env.js'), 'utf8'), ctx, { filename: 'env.js' });
  vm.runInContext(readFileSync(path.join(WWW, 'js', 'app', 'catalog.js'), 'utf8'), ctx, { filename: 'catalog.js' });
  vm.runInContext(motorSrc, ctx, { filename: 'motor.js' });
  const L = ctx.KiuSentenceTTS.limpiar;
  assert.equal(typeof L, 'function', 'la limpieza tiene que poder probarse');
  const conUrl = L('Mirá https://ejemplo.com por favor');
  assert.doesNotMatch(conUrl, /https?:/, 'las URLs no se hablan');
  assert.match(conUrl, /Mirá/, 'pero el resto de la frase sí');
  assert.match(L('A & B'), / y /, 'los símbolos se traducen');
  assert.equal(L('**'), '', 'un símbolo suelto no se habla');
  assert.match(L('Hola. Kiu te espera'), /Hola/, 'una frase normal queda igual');
});
