/* jarvis-v2160.test.mjs — v2.16.0: primera tanda "Jarvis".
 * Clima real, leer páginas, gastos por voz y resumen del día.
 * Se prueba COMPORTAMIENTO con la red de mentira (misma forma que la real).
 * node --test tests/jarvis-v2160.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cargarAgente } from './evals/harness.mjs';

function montar(over = {}) {
  const r = cargarAgente(over);
  return r;
}

test('get_weather: pronóstico de mañana con lluvia', async () => {
  const { A } = montar();
  const r = await A.get('get_weather').run({ place: 'Córdoba', day: 'mañana' });
  assert.equal(r.ok, true);
  assert.match(r.text, /Mañana en Ciudad de prueba/);
  assert.match(r.text, /con lluvia/);
  assert.match(r.text, /80% de probabilidad/);
});

test('get_weather: sin ciudad ni historial pide la ciudad; con historial la reutiliza', async () => {
  const { A, ctx } = montar();
  const sin = await A.get('get_weather').run({});
  assert.equal(sin.ok, false);
  assert.match(sin.err, /ciudad/);
  await A.get('get_weather').run({ place: 'Lima' });
  assert.equal(ctx.localStorage.getItem('kiu_ciudad'), 'Lima');
  const con = await A.get('get_weather').run({});
  assert.equal(con.ok, true);
  assert.match(con.text, /^Hoy en/);
});

test('get_weather: sin conexión falla con un error honesto, sin colgar', async () => {
  const { A, ctx } = montar();
  ctx.fetch = () => Promise.reject(new Error('offline'));
  const r = await A.get('get_weather').run({ place: 'Lima' });
  assert.equal(r.ok, false);
  assert.match(r.err, /no pude consultar el clima/);
});

test('summarize_url: lee la página; rechaza http y hosts locales', async () => {
  const { A } = montar();
  const ok = await A.get('summarize_url').run({ url: 'https://example.com/nota' });
  assert.equal(ok.ok, true);
  assert.match(ok.text, /Una nota de prueba/);
  assert.equal((await A.get('summarize_url').run({ url: 'http://example.com' })).ok, false);
  for (const u of ['https://localhost/x', 'https://192.168.1.5/x', 'https://127.0.0.1/x', 'https://10.0.0.2/x']) {
    const r = await A.get('summarize_url').run({ url: u });
    assert.equal(r.ok, false, u + ' no debe leerse');
  }
});

test('log_expense: anota, suma el mes y lista; valida el monto', () => {
  const { A } = montar();
  const t = A.get('log_expense');
  assert.equal(t.run({ action: 'add', amount: 0, what: 'x' }).ok, false);
  assert.equal(t.run({ action: 'add', amount: 'abc' }).ok, false);
  assert.match(t.run({ action: 'add', amount: 12, what: 'almuerzo' }).text, /Anotado: 12 en almuerzo\. Este mes llevás 12/);
  assert.match(t.run({ action: 'add', amount: '8,5', what: 'café' }).text, /llevás 20,5/);
  assert.match(t.run({ action: 'total' }).text, /gastaste 20,5 en 2 gastos/);
  assert.match(t.run({ action: 'list' }).text, /café/);
});

test('log_expense: leer no pide confirmación, anotar sí', () => {
  const { A } = montar();
  const t = A.get('log_expense');
  assert.equal(t.riskFor({ action: 'total' }), 'read');
  assert.equal(t.riskFor({ action: 'add' }), 'write');
});

test('daily_briefing: junta fecha, agenda, tareas y clima; una pieza caída no lo rompe', async () => {
  const { A, ctx } = montar();
  ctx.localStorage.setItem('kiu_ciudad', 'Lima');
  ctx.KiuMem.addTarea('llamar al dentista');
  const r = await A.get('daily_briefing').run({});
  assert.equal(r.ok, true);
  assert.match(r.text, /Hoy es/);
  assert.match(r.text, /Tareas pendientes \(1\): llamar al dentista/);
  assert.match(r.text, /Hoy en Ciudad de prueba/);
  ctx.fetch = () => Promise.reject(new Error('offline'));
  const off = await A.get('daily_briefing').run({});
  assert.equal(off.ok, true, 'sin red igual entrega el resto');
  assert.doesNotMatch(off.text, /Ciudad de prueba/);
});

test('selección: el clima gana a web_search y los gastos a todo', () => {
  const { A } = montar();
  assert.equal(A.seleccionar('qué clima hace hoy')[0], 'get_weather');
  assert.equal(A.seleccionar('gasté 30 en el super')[0], 'log_expense');
  assert.equal(A.seleccionar('buen día')[0], 'daily_briefing');
});
