/* comp-busy-v2143.test.mjs — v2.14.3: el resumen de memoria no puede robarle
 * el motor a la respuesta del usuario.
 *
 * EL SÍNTOMA (el que reportó la gente en el teléfono):
 *
 *   "El motor interno no pudo responder (el motor sigue ocupado con una
 *    solicitud anterior; esperá a que termine o usá Liberar motor)."
 *
 * LA CAUSA, que no era una:
 *
 *   `kiuReply()` pide la respuesta en dos pasos:
 *
 *     1. `kiuMsgs()` arma el prompt. Ahí, si el historial es largo, se llama
 *        `Comp.apply()` → `summarize()` → `Kiu.ask(...)`: UNA GENERACIÓN DE
 *        RESUMEN en segundo plano.
 *     2. `Kiu.ask(...)`: la respuesta del usuario.
 *
 *   El resumen arrancaba en el paso 1 y se quedaba con el motor. En el paso 2
 *   el motor estaba ocupado → "el motor sigue ocupado".
 *
 *   Y era AUTO-AMPLIFICANTE: el mensaje de error es enorme (700 caracteres),
 *   con él el historial pasa los 3200 caracteres que disparan el resumen, y
 *   así cada mensaje posterior repetía el error. Un error se convertía en
 *   una condición permanente.
 *
 * Lo que se arregla:
 *   · el resumen se APARTA: no arranca mientras se está respondiendo, y corre
 *     cuando el motor queda libre y en calma;
 *   · el motor tiene COLA: si algo lo tiene tomado, el pedido espera en vez
 *     de rebotar con un error;
 *   · el usuario PASA ADELANTE: si lo que ocupa el motor es un trabajo de
 *     fondo, se interrumpe.
 *
 * node --test tests/comp-busy-v2143.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const WWW = path.join(here, '..', 'app', 'src', 'main', 'assets', 'www');

/* ---------- sandbox con reloj y puente controlables ---------- */
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
  for (const rel of ['js/app/env.js', 'js/app/state.js', 'js/app/catalog.js', 'js/kiu-estados.js', 'js/app/motor.js']) {
    vm.runInContext(readFileSync(path.join(WWW, rel), 'utf8'), ctx, { filename: rel });
  }
  ctx.S.kiu.ok = true;
  ctx.S.kiu.name = 'test.gguf';

  /* el puente nativo: una generación por vez, como el JNI real */
  let idGen = 0;
  const nativo = {
    ocupado: false,
    iniciado: 0,
    kiuAvailable: () => true,
    kiuIsLoaded: () => true,
    kiuLoaded: () => true,
    kiuGen: () => {
      if (nativo.ocupado) return false;
      nativo.ocupado = true;
      nativo.iniciado++;
      idGen++;
      return true;
    },
    kiuGenStatus: () => JSON.stringify({ id: idGen, text: 'texto', done: !nativo.ocupado, toks: 4, tps: 10 }),
    /* el nativo real: al parar la generación, el worker termina y postea el
       evento igual (con ok=false o el parcial). Si no, el JS queda esperando
       una respuesta que no llega. */
    kiuGenStop: () => {
      if (!nativo.ocupado) return;
      nativo.ocupado = false;
      ctx.kiuNativeDone({ op: 'gen', id: idGen, ok: false, err: 'detenida' });
    },
    kiuResetBusy: () => { nativo.ocupado = false; },
    kiuFree: () => { },
    /* el worker del nativo termina y avisa (el push) */
    terminar: (txt) => {
      nativo.ocupado = false;
      ctx.kiuNativeDone({ op: 'gen', id: idGen, ok: true, text: txt || 'respuesta' });
    },
  };
  ctx.KiuBridge = nativo;

  const reloj = {
    avanzar(ms) {
      const destino = ahora + ms;
      let vueltas = 0;
      while (vueltas++ < 5000) {
        const t = timers.filter((x) => !x.cancelado && (!x.corrio || x.intervalo) && x.at <= destino).sort((a, b) => a.at - b.at)[0];
        if (!t) { console.log('  [avanzar] sin candidatos, vueltas', vueltas); break; }
        if (t.intervalo) { t.at = ahora + t.ms; } else { t.corrio = true; }
        ahora = Math.max(ahora, t.at);
        try { t.fn(); } catch (e) { }
      }
      ahora = destino;
    },
  };
  return { ctx, timers, reloj, nativo, Kiu: ctx.Kiu, Comp: ctx.Comp };
}

/* un historial largo: más de 3200 caracteres, como un chat de un rato */
function historialLargo() {
  const h = [];
  for (let i = 0; i < 14; i++) {
    h.push({ role: i % 2 ? 'bot' : 'user', text: 'palabra de relleno '.repeat(30), ts: i });
  }
  return h;
}

/* ================= 1 · el resumen no se adueña del motor ================= */
test('un historial largo NO arranca una generación por su cuenta', () => {
  const { Comp, nativo } = montar();
  Comp.apply(historialLargo());
  assert.equal(nativo.iniciado, 0, 'el resumen no puede arrancar en el medio de una respuesta');
});

/* ================= 2 · LA PROPIEDAD QUE IMPORTA ================= */
test('con un historial largo, la respuesta del usuario NO falla con "ocupado"', () => {
  /* Esta es la propiedad que el usuario vio: su mensaje tiene que
     contestarse, no rebotar. Todo lo demás es detalle interno. */
  const { reloj, nativo, Kiu, Comp } = montar();
  Comp.apply(historialLargo());           /* paso 1: el prompt se arma */
  const respuesta = [];
  Kiu.ask([{ role: 'user', content: 'porque el cielo es azul' }], 200, (r) => respuesta.push(r));  /* paso 2 */
  assert.equal(nativo.iniciado, 1, 'la primera generación es la del usuario');
  nativo.terminar('el cielo es azul porque el azul del mar dispersa la luz');
  reloj.avanzar(500);
  assert.equal(respuesta.length, 1, 'la respuesta llegó');
  assert.equal(respuesta[0].ok, true, 'y NO es un error de motor ocupado');
  assert.match(respuesta[0].text || '', /cielo/);
});

/* ================= 3 · el motor tiene cola ================= */
test('un pedido que encuentra el motor ocupado ESPERA en vez de fallar', () => {
  const { reloj, nativo, Kiu } = montar();
  const resultados = [];
  Kiu.ask([{ role: 'user', content: 'trabajo de fondo' }], 100, (r) => resultados.push(['fondo', r]));
  assert.equal(nativo.iniciado, 1);
  Kiu.ask([{ role: 'user', content: 'la pregunta' }], 100, (r) => resultados.push(['usuario', r]));
  assert.equal(resultados.length, 0, 'todavía no hay respuestas: el segundo está en la cola');
  assert.ok(Kiu._waiters.length >= 1, 'el pedido quedó esperando su turno');
  nativo.terminar('la respuesta');
  reloj.avanzar(1000);
  assert.ok(nativo.iniciado >= 2, 'el pedido en cola arrancó cuando se liberó el motor');
  const delUsuario = resultados.find((r) => r[0] === 'usuario');
  if (delUsuario) {
    assert.equal(delUsuario[1].ok, true, 'y el del usuario no es un error de "ocupado"');
  }
});

/* ================= 4 · el resumen corre después, no antes ================= */
test('el resumen se guarda en la caché, una vez que el motor está libre', () => {
  const { reloj, nativo, Comp } = montar();
  Comp.apply(historialLargo());
  reloj.avanzar(6000);                    /* el motor está libre y en calma */
  assert.equal(nativo.iniciado, 1, 'el resumen arrancó cuando el motor estaba libre');
  nativo.terminar('un resumen');
  reloj.avanzar(1000);
  assert.ok(Object.keys(Comp.cache).length >= 1, 'y quedó en la caché');
});

/* ================= 5 · el usuario pasa adelante del trabajo de fondo ================= */
test('si el motor está con un resumen, el mensaje del usuario lo interrumpe', () => {
  const { reloj, nativo, Kiu, Comp, timers } = montar();
  Comp.apply(historialLargo());
  reloj.avanzar(6000);                    /* arranca el resumen de fondo */
  assert.equal(nativo.iniciado, 1, 'el resumen está corriendo');
  const respuesta = [];
  Kiu.ask([{ role: 'user', content: 'pará, te pregunté algo' }], 100, (r) => respuesta.push(r));
  assert.equal(nativo.ocupado, false, 'el resumen se interrumpió: el usuario pasa adelante');
  reloj.avanzar(1000);
  assert.ok(nativo.iniciado >= 2, 'y el mensaje del usuario arrancó su generación');
  nativo.terminar('la respuesta del usuario');
  reloj.avanzar(500);
  assert.equal(respuesta.length, 1, 'y el mensaje del usuario se contesta');
  assert.equal(respuesta[0].ok, true, 'sin errores de "ocupado"');
});
