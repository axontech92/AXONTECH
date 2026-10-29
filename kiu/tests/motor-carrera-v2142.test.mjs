/* motor-carrera-v2142.test.mjs — v2.14.2: las carreras del motor que dejaban
 * al agente en "motor ocupado" para siempre.
 *
 * El síntoma que reportaba la gente: "el agente no reconoce cuando hay un
 * modelo cargado, siempre pone motor ocupado" y "el despertar por voz para
 * dar instrucciones no funciona".
 *
 * La causa no era una: eran TRES carreras y un descarte silencioso.
 *
 *  1) EL WATCHDOG DE 10 MINUTOS MATABA LA GENERACIÓN SIGUIENTE.
 *     El temporizador de seguridad de `ask()` comprobaba `pending.op === 'gen'`
 *     en el MOMENTO de dispararse, no el pending que había creado. Diez
 *     minutos después de CUALQUIER generación (incluso una terminada hacía
 *     rato) mataba la que estuviera corriendo: la cortaba, le ponía "tardó
 *     demasiado" y liberaba el flag mientras el nativo seguía trabajando.
 *
 *  2) UN EVENTO DE CARGA TARDÍO LIBERABA EL FLAG DE UNA GENERACIÓN EN VUELO.
 *     `handle()` limpiaba `busyG` cuando llegaba un evento 'load' que no
 *     coincidía con el pending. El JS creía que el motor estaba libre
 *     mientras el nativo generaba: el pedido siguiente lo rechazaba el
 *     nativo y el usuario veía "el motor sigue ocupado".
 *
 *  3) UN PUSH TARDÍO CERRABA LA GENERACIÓN SIGUIENTE.
 *     El push 'gen' de una generación que el sondeo ya había cerrado podía
 *     llegar cuando el agente ya había arrancado el paso siguiente: le
 *     entregaba el texto VIEJO al callback nuevo y le borraba el pending. El
 *     motor se quedaba en "Generando" para siempre.
 *
 * Estos tests son de COMPORTAMIENTO: mueven el reloj y disparan los
 * temporizadores a mano, como haría un teléfono real.
 *
 * node --test tests/motor-carrera-v2142.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const WWW = path.join(here, '..', 'app', 'src', 'main', 'assets', 'www');
const raiz = path.join(here, '..');

/* ---------- un sandbox con reloj controlable ---------- */
function montar() {
  const timers = [];
  let ahora = 1000000;
  const ctx = {};
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.console = console;
  ctx.localStorage = {
    _m: new Map(),
    getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
    setItem(k, v) { this._m.set(k, String(v)); },
    removeItem(k) { this._m.delete(k); },
    clear() { this._m.clear(); },
  };
  ctx.setTimeout = (fn, ms) => { timers.push({ fn, at: ahora + (ms || 0), ms: ms || 0 }); return timers.length; };
  ctx.clearTimeout = (id) => { const t = timers[id - 1]; if (t) t.cancelado = true; };
  ctx.setInterval = (fn, ms) => { timers.push({ fn, at: ahora + (ms || 0), ms: ms || 0, intervalo: true }); return timers.length; };
  ctx.clearInterval = (id) => { const t = timers[id - 1]; if (t) t.cancelado = true; };
  ctx.Date = class extends Date {
    constructor(...a) { super(...(a.length ? a : [ahora])); }
    static now() { return ahora; }
  };
  ctx.navigator = { hardwareConcurrency: 8 };
  ctx.document = { getElementById: () => null, querySelectorAll: () => [], addEventListener: () => { } };
  ctx.App = {
    toast: () => { }, renderModels: () => { }, renderStatus: () => { }, renderSys: () => { },
    addActivity: () => { }, refreshMem: () => { }, track: () => { }, confirm: () => { },
  };
  vm.createContext(ctx);

  /* el puente nativo: se comporta como el JNI (acepta kiuGen y publica el
     evento al terminar). OJO: se pone ANTES de cargar los scripts, como en la
     app real (la interfaz se inyecta desde Java antes de loadUrl). */
  let idGen = 0;
  const nativo = {
    cargado: true,
    ocupado: false,
    evento: null,
    idActual: 0,
    ticks: 0,
    kiuAvailable: () => true,
    kiuIsLoaded: () => nativo.cargado,
    kiuLoaded: () => nativo.cargado,
    kiuGen: () => {
      if (nativo.ocupado) return false;
      nativo.ocupado = true;
      idGen++;
      nativo.idActual = idGen;
      return true;
    },
    kiuGenStatus: () => JSON.stringify({
      id: nativo.idActual,
      text: 'texto ' + (nativo.ticks++),
      done: !nativo.ocupado,
      toks: 3 + nativo.ticks,
      tps: 10,
    }),
    kiuGenStop: () => { nativo.ocupado = false; },
    kiuResetBusy: () => { nativo.ocupado = false; },
    kiuFree: () => { nativo.cargado = false; },
    /* el worker del nativo termina y libera su bandero de ocupado: eso pasa
       SOLO, nunca desde el push (el push es un aviso, no el fin del trabajo) */
    terminar: () => { nativo.ocupado = false; },
  };
  ctx.KiuBridge = nativo;

  for (const rel of ['js/app/env.js', 'js/app/state.js', 'js/app/catalog.js', 'js/kiu-estados.js', 'js/app/motor.js']) {
    vm.runInContext(readFileSync(path.join(WWW, rel), 'utf8'), ctx, { filename: rel });
  }
  ctx.S.kiu.ok = true;
  ctx.S.kiu.name = 'test.gguf';

  /* el reloj: dispara los temporizadores vencidos */
  const reloj = {
    avanzar(ms) {
      /* como un reloj real: los intervalos se repintan, los one-shot no */
      const destino = ahora + ms;
      let vueltas = 0;
      while (vueltas++ < 30000) {
        const t = timers.filter((x) => !x.cancelado && (!x.corrio || x.intervalo) && x.at <= destino).sort((a, b) => a.at - b.at)[0];
        if (!t) break;
        if (t.intervalo) { t.at = ahora + t.ms; } else { t.corrio = true; }
        ahora = Math.max(ahora, t.at);
        try { t.fn(); } catch (e) { /* un temporizador que revienta no rompe el test */ }
      }
      ahora = destino;
    },
    pendientes: () => timers.filter((t) => !t.cancelado && !t.corrio).length,
  };
  return { ctx, timers, reloj, nativo, Kiu: ctx.Kiu };
}

/* ---------- 1 · el watchdog de 10 minutos ---------- */
test('el watchdog de 10 minutos NO mata la generación siguiente', () => {
  const { ctx, timers, nativo, Kiu } = montar();
  const recibidos = [];
  /* generación 1: termina bien */
  Kiu.ask([{ role: 'user', content: 'hola' }], 20, (r) => recibidos.push(['g1', r]));
  nativo.terminar();
  ctx.kiuNativeDone({ op: 'gen', id: 1, ok: true, text: 'hola' });
  assert.equal(recibidos.length, 1, 'la primera generación terminó');
  assert.equal(Kiu.busyG, false, 'y el motor quedó libre');

  /* generación 2: queda en vuelo */
  Kiu.ask([{ role: 'user', content: 'otra' }], 20, (r) => recibidos.push(['g2', r]));
  assert.equal(Kiu.busyG, true, 'la segunda está corriendo');

  /* se dispara SOLO el watchdog de la primera (el de 10 minutos). Antes, ese
     temporizador comprobaba `pending.op === 'gen'` en vez de SU pending: como
     para entonces el pending era el de la segunda, la mataba. */
  const watchdogs = timers.filter((t) => t.ms === 600000 && !t.corrio);
  assert.ok(watchdogs.length >= 2, 'cada ask() arma su propio watchdog');
  watchdogs[0].fn();
  assert.equal(Kiu.busyG, true, 'la segunda generación sigue viva');
  assert.equal(recibidos.length, 1, 'y no se entregó ninguna respuesta falsa');
  assert.ok(Kiu.pending, 'el pending de la segunda sigue en pie');
});

/* ---------- 2 · un evento de carga tardío ---------- */
test('un evento de carga tardío NO libera el flag de una generación en vuelo', () => {
  const { ctx, Kiu } = montar();
  Kiu.ask([{ role: 'user', content: 'hola' }], 20, () => { });
  assert.equal(Kiu.busyG, true, 'hay una generación en vuelo');
  /* llega el evento de una carga que se cerró antes (el sondeo ya la había
     cerrado) */
  ctx.kiuNativeDone({ op: 'load', ok: true, path: '/x/modelo.gguf' });
  assert.equal(Kiu.busyG, true, 'el flag sigue siendo de la generación en vuelo');
  assert.ok(Kiu.pending, 'y el pending sigue en pie');
});

/* ---------- 3 · un push tardío ---------- */
test('un push tardío NO cierra la generación siguiente', () => {
  const { ctx, nativo, Kiu } = montar();
  const recibidos = [];
  /* generación 1 */
  Kiu.ask([{ role: 'user', content: 'uno' }], 20, (r) => recibidos.push(['g1', r]));
  /* el sondeo la cerró: el pendiente se libera */
  nativo.terminar();
  ctx.kiuNativeDone({ op: 'gen', id: 1, ok: true, text: 'PRIMERA' });
  assert.equal(recibidos.length, 1);

  /* generación 2 (el agente encadena pasos y arranca la siguiente al toque) */
  Kiu.ask([{ role: 'user', content: 'dos' }], 20, (r) => recibidos.push(['g2', r]));
  assert.equal(Kiu.busyG, true);

  /* LLEGA TARDE el push de la primera: no puede tocar la segunda */
  ctx.kiuNativeDone({ op: 'gen', id: 1, ok: true, text: 'PRIMERA' });
  assert.equal(recibidos.length, 1, 'la segunda no recibió el texto viejo');
  assert.equal(Kiu.busyG, true, 'y la segunda sigue corriendo');
  assert.ok(Kiu.pending, 'con su pending en pie');
});

/* ---------- 4 · el evento que SÍ es de esta generación ---------- */
test('el push de ESTA generación la cierra y entrega el texto', () => {
  const { ctx, Kiu } = montar();
  const recibidos = [];
  Kiu.ask([{ role: 'user', content: 'hola' }], 20, (r) => recibidos.push(r));
  ctx.kiuNativeDone({ op: 'gen', id: 1, ok: true, text: 'hola' });
  assert.equal(recibidos.length, 1);
  assert.equal(recibidos[0].text, 'hola');
  assert.equal(Kiu.busyG, false);
  assert.equal(Kiu.pending, null);
});

/* ---------- 5 · Java: el comando de voz no se pierde ---------- */
test('el comando de la palabra de activación no se pierde si la página no está lista', () => {
  const main = fs.readFileSync(path.join(raiz, 'app/src/main/java/com/kiu/agent/MainActivity.java'), 'utf8');
  const i = main.indexOf('static void wakeDeliver(');
  assert.notEqual(i, -1, 'wakeDeliver tiene que existir');
  const cuerpo = main.slice(i, main.indexOf('\n    }', i));
  assert.match(cuerpo, /pageReady/, 'wakeDeliver tiene que mirar si la página está lista');
  assert.match(cuerpo, /pendingCmd/, 'y si no lo está, dejar el comando para pageReady()');
  /* y pageReady tiene que entregar lo que quedó */
  const j = main.indexOf('public void pageReady()');
  assert.notEqual(j, -1);
  const pr = main.slice(j, main.indexOf('\n        }', j));
  assert.match(pr, /pendingCmd/, 'pageReady entrega el comando pendiente');
  assert.match(pr, /nexoWakeCmd/, 'con la misma función que usa el flujo normal');
});

test('el evento de generación lleva el id (para que un push tardío se pueda descartar)', () => {
  const job = fs.readFileSync(path.join(raiz, 'app/src/main/java/com/kiu/agent/KiuGenJob.java'), 'utf8');
  assert.match(job, /\\"op\\":\\"gen\\",\\"id\\":/, 'el evento gen tiene que mandar el id');
  assert.match(job, /currentGenId\(\)/, 'y el id se lee del estado nativo');
});

test('el JS descarta un evento de generación que no es el suyo', () => {
  const src = fs.readFileSync(path.join(WWW, 'js/app/motor.js'), 'utf8');
  assert.match(src, /difGen !== 1/, 'el JS compara el id del evento con el de su pending');
  assert.match(src, /genBase/, 'y el pending guarda el id base de su generación');
});

/* ---------- 6 · el puente se resuelve en cada llamada ---------- */
test('el puente se resuelve en cada llamada: si aparece tarde, se usa', () => {
  /* v2.14.2: `BR` se capturaba UNA vez al cargar env.js. Si en ese instante
     window.KiuBridge no estaba (la interfaz la inyecta Java), el puente
     quedaba muerto PARA SIEMPRE: kiuGen devolvía null, el motor no arrancaba
     nunca y el agente contestaba "el motor sigue ocupado" con el modelo
     cargado en la memoria. */
  const ctx = {};
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.console = console;
  ctx.localStorage = { getItem: () => null, setItem: () => { }, removeItem: () => { } };
  ctx.setTimeout = () => 0; ctx.clearTimeout = () => { };
  ctx.setInterval = () => 0; ctx.clearInterval = () => { };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(path.join(WWW, 'js/app/env.js'), 'utf8'), ctx, { filename: 'env.js' });

  assert.equal(ctx.rawBridge('kiuIsLoaded'), null, 'sin puente no hay nada');
  /* el puente aparece tarde (la interfaz nativa se inyecta después) */
  ctx.KiuBridge = { kiuIsLoaded: () => true, kiuGen: () => true };
  assert.equal(ctx.rawBridge('kiuIsLoaded'), true, 'y apenas aparece, se usa');
  assert.equal(ctx.bridge('kiuGen'), true, 'bridge() también');
  assert.equal(ctx.BR.kiuIsLoaded(), true, 'window.BR sigue siendo el puente');
});

/* ---------- 7 · el agente espera al motor ocupado ---------- */
test('el agente ESPERA al motor ocupado en vez de rendirse al instante', async () => {
  /* v2.14.2: el camino normal del chat reintenta hasta 30 s cuando el motor
     está ocupado (app-ui · tryTargets). El agente se rendía en el acto y
     contestaba "el motor está ocupado": era el síntoma reportado. */
  const timers = [];
  let ahora = 1000000;
  const ctx = {};
  ctx.window = ctx; ctx.globalThis = ctx; ctx.console = console;
  ctx.setTimeout = (fn, ms) => { timers.push({ fn, at: ahora + (ms || 0) }); return timers.length; };
  ctx.clearTimeout = () => { };
  ctx.setInterval = () => 0; ctx.clearInterval = () => { };
  ctx.rawBridge = () => false;
  vm.createContext(ctx);
  vm.runInContext(readFileSync(path.join(WWW, 'js/kiu-agente.js'), 'utf8'), ctx, { filename: 'kiu-agente.js' });

  let intentos = 0;
  ctx.S = { kiu: { ok: true, name: 't.gguf' } };
  ctx.Kiu = {
    available: () => true,
    isLoaded: () => true,
    whenReady: (cb) => cb(true),
    ask(hist, maxT, cb) {
      intentos++;
      if (intentos === 1) { cb({ ok: false, err: 'el motor sigue ocupado con una solicitud anterior' }); return; }
      cb({ ok: true, text: '{"listo":true}' });
    },
  };
  let listo = null;
  const p = new Promise((res) => { listo = res; });
  ctx.KiuAgente.run({ habla: ['qué hora es'], componer: false }, listo);
  assert.equal(intentos, 1, 'la primera pregunta chocó con el motor ocupado');
  assert.ok(timers.length >= 1, 'y el agente agendó un reintento en vez de rendirse');
  /* pasa el tiempo: se dispara el reintento */
  timers.forEach((t) => { if (!t.corrio) { t.corrio = true; t.fn(); } });
  const r = await p;
  assert.equal(intentos, 2, 'el agente reintentó en vez de rendirse');
  assert.equal(r.ok, false, 'y el bucle terminó (sin herramientas, sin resultado)');
});
