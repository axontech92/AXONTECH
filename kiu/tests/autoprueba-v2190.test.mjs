/* autoprueba-v2190.test.mjs — v2.19.0: "Probar agente" DENTRO del teléfono.
 * La app mide con el modelo cargado en el teléfono (sin PC) si elige bien las herramientas,
 * sin ejecutar ninguna. Acá el modelo es de mentira, pero el prompt, la selección, la gramática
 * y la corrección son los reales.
 * node --test tests/autoprueba-v2190.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cargarAgente } from './evals/harness.mjs';
import { ESCENARIOS } from './evals/escenarios.mjs';

const WWW = path.join(process.cwd(), 'app/src/main/assets/www');
const J = (x) => JSON.parse(JSON.stringify(x));
const corrida = (U, o) => new Promise((r) => U.correr(o, r));

/* un modelo que contesta lo que dice `responder(pedido)`; guarda lo que recibió */
function conModelo(responder, extra = {}) {
  const r = cargarAgente();
  const visto = [];
  r.ctx.S.kiu = { ok: true, name: 'Qwen3-0.6B-Q4_K_M.gguf' };
  r.ctx.Kiu = {
    ask(hist, maxT, cb, onTok, gbnf) {
      const pedido = hist[hist.length - 1].content;
      visto.push({ hist, gbnf, pedido });
      const out = responder(pedido, visto.length);
      if (extra.async) setTimeout(() => cb(out), 0); else cb(out);
    },
  };
  return { ...r, visto, U: r.ctx.KiuAutoprueba };
}
const perfecto = (ctx) => (pedido) => {
  const esc = ESCENARIOS.find((e) => e.pedido === pedido);
  return { ok: true, tps: 7.5, text: JSON.stringify({ tool: esc.espera.tool, args: esc.ejemplo || {} }) };
};

test('un modelo que acierta saca 100 % en la prueba completa y se guarda el resultado', async () => {
  const { U, ctx } = conModelo((p) => perfecto()(p));
  const r = J(await corrida(U, { completa: true }));
  assert.equal(r.total, U.CASOS.length);
  assert.equal(r.aciertos, r.total, JSON.stringify(r.fallos));
  assert.equal(r.nivel, 'bien');
  assert.match(r.texto, /sirve como agente/);
  assert.ok(r.tps > 7 && r.tps < 8);
  assert.equal(J(U.ultima('Qwen3-0.6B-Q4_K_M.gguf')).acierto, 1);
  assert.ok(ctx.localStorage.getItem('kiu_autoprueba'));
});

test('la rápida corre solo los casos marcados', async () => {
  const { U, visto } = conModelo((p) => perfecto()(p));
  const r = J(await corrida(U, {}));
  assert.equal(r.total, U.CASOS.filter((c) => c.rapido).length);
  assert.equal(visto.length, r.total);
  assert.ok(r.total >= 6 && r.total <= 10);
});

test('un modelo que siempre dice "listo" saca 0 % y el motivo es claro', async () => {
  const { U } = conModelo(() => ({ ok: true, text: '{"listo":true}' }));
  const r = J(await corrida(U, { completa: true }));
  assert.equal(r.aciertos, 0);
  assert.equal(r.nivel, 'mal');
  assert.match(r.fallos[0].motivo, /listo/);
});

test('un modelo que se equivoca de herramienta o de argumento lo dice', async () => {
  const { U } = conModelo((p) => {
    if (p.includes('alarma a las 7')) return { ok: true, text: JSON.stringify({ tool: 'set_alarm', args: { when: 'mañana a las 9' } }) };   // argumento sin 7
    if (p.includes('linterna')) return { ok: true, text: JSON.stringify({ tool: 'now', args: {} }) };                                       // herramienta mala
    return perfecto()(p);
  });
  const r = J(await corrida(U, { completa: true }));
  assert.equal(r.fallos.length, 2);
  assert.ok(r.fallos.some((f) => /con when/.test(f.motivo)));
  assert.ok(r.fallos.some((f) => /eligió now/.test(f.motivo)));
  assert.equal(r.nivel, 'bien', '19 de 21 sigue siendo ≥ 80 %');
});

test('NO ejecuta ninguna herramienta: no suena ninguna alarma ni se manda nada', async () => {
  const { U, puente, ctx } = conModelo((p) => perfecto()(p));
  const llamadas = [];
  for (const k of Object.keys(puente)) {
    const f = puente[k];
    if (typeof f === 'function') puente[k] = (...a) => { llamadas.push(k); return f(...a); };
  }
  ctx.localStorage.removeItem('nexo_alarmas');
  await corrida(U, { completa: true });
  const efectos = llamadas.filter((n) => /setReminder|sms|dial|share|openUrl|openApp|torch|maps|addCalendarEvent|startTimerNative|cancelReminder/.test(n));
  assert.deepEqual(efectos, [], 'la prueba solo mira lo que el modelo elegiría');
  assert.equal(ctx.localStorage.getItem('kiu_gastos'), null, 'ni anotó el gasto');
  assert.equal(ctx.localStorage.getItem('kiu_rutinas'), null, 'ni creó la rutina');
});

test('usa el MISMO prompt y la MISMA gramática que el agente de verdad', async () => {
  const { U, visto, A } = conModelo((p) => perfecto()(p));
  await corrida(U, {});
  const v = visto.find((x) => x.pedido === 'qué tengo mañana');
  assert.ok(v.gbnf && /root/.test(v.gbnf), 'la gramática GBNF viaja');
  assert.equal(v.hist[0].role, 'system');
  assert.match(v.hist[0].content, /read_calendar/, 'el prompt lleva la herramienta que corresponde');
  assert.equal(v.hist[1].content, 'qué tengo mañana');
  assert.equal(A.seleccionar('qué tengo mañana')[0], 'read_calendar');
});

test('sin modelo cargado no inventa un resultado', async () => {
  const { U, ctx } = conModelo(() => ({ ok: true, text: '{}' }));
  ctx.S.kiu = { ok: false };
  const r = J(await corrida(U, {}));
  assert.equal(r.ok, false);
  assert.match(r.err, /cargá un modelo/);
});

test('si el motor está ocupado espera y reintenta; si falla, cuenta como fallo', async () => {
  let n = 0;
  const { U, ctx } = conModelo((p) => (++n === 1 ? { ok: false, err: 'motor ocupado' } : perfecto()(p)), { async: true });
  ctx.setTimeout = setTimeout;   /* el arnés trae timers de mentira; acá hace falta uno real */
  const t0 = Date.now();
  const r = J(await corrida(U, {}));
  assert.ok(Date.now() - t0 >= 1000, 'esperó antes de reintentar');
  assert.equal(r.aciertos, r.total);
  const mal = conModelo(() => ({ ok: false, err: 'se cayó' }));
  const r2 = J(await corrida(mal.U, {}));
  assert.equal(r2.aciertos, 0);
  assert.match(r2.fallos[0].motivo, /el motor no respondió/);
});

test('cancelar corta, lo marca parcial y NO guarda el resultado', async () => {
  const { U, ctx } = conModelo((p) => perfecto()(p));
  let vistos = 0;
  const r = J(await corrida(U, { completa: true, progreso: () => { vistos++; }, cancelar: () => vistos >= 3 }));
  assert.equal(r.total, 3);
  assert.equal(r.parcial, true);
  assert.equal(ctx.localStorage.getItem('kiu_autoprueba'), null, 'una corrida a medias no pisa la última completa');
});

test('veredicto: los umbrales son los del arnés de la PC', () => {
  const { U } = conModelo(() => ({}));
  assert.equal(U.veredicto(0.8).nivel, 'bien');
  assert.equal(U.veredicto(0.79).nivel, 'regular');
  assert.equal(U.veredicto(0.5).nivel, 'regular');
  assert.equal(U.veredicto(0.49).nivel, 'mal');
});

test('los casos de la app no se desincronizan del juego del arnés', () => {
  const { U } = conModelo(() => ({}));
  for (const c of U.CASOS) {
    const e = ESCENARIOS.find((x) => x.pedido === c.pedido);
    assert.ok(e, 'el pedido «' + c.pedido + '» tiene que existir en tests/evals/escenarios.mjs');
    assert.equal(c.tool, e.espera.tool, c.pedido);
    assert.deepEqual(J(c.acepta || []), e.espera.acepta || [], c.pedido);
    const mios = Object.keys(c.args || {}).sort();
    const suyos = Object.keys(e.args || {}).sort();
    assert.deepEqual(mios, suyos, 'mismos argumentos esperados en «' + c.pedido + '»');
    for (const k of mios) {
      const a = c.args[k], b = e.args[k];
      if (b instanceof RegExp) { assert.equal(a.re, b.source, k); assert.equal(!!a.i, b.ignoreCase, k); } else assert.equal(a, b, k);
    }
  }
});

test('cableado: botones, script y el motor de la UI', () => {
  const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
  assert.match(html, /id="mdl-agent-test"/);
  assert.match(html, /id="mdl-agent-full"/);
  assert.match(html, /id="mdl-agent-res"/);
  assert.ok(html.indexOf('js/kiu-agente.js') < html.indexOf('js/kiu-autoprueba.js'));
  const ui = fs.readFileSync(path.join(WWW, 'js/app/app-ui.js'), 'utf8');
  assert.match(ui, /KiuAutoprueba\.correr\(/);
});
