/* rutinas-v2180.test.mjs — v2.18.0: rutinas (hora + días + condición + acción de LECTURA).
 * node --test tests/rutinas-v2180.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cargarAgente } from './evals/harness.mjs';

const WWW = path.join(process.cwd(), 'app/src/main/assets/www');

function montar() {
  const r = cargarAgente();
  const R = r.ctx.KiuRutinas;
  /* despertadores de Android de mentira: lo que App.addReminder/reminders/removeReminder hacen */
  const alarmas = [];
  r.ctx.KiuApp.addReminder = (t, d) => { alarmas.push({ id: 'a' + alarmas.length, title: t, time: d.getTime() }); return true; };
  r.ctx.KiuApp.reminders = () => alarmas;
  r.ctx.KiuApp.removeReminder = (id) => { const i = alarmas.findIndex((a) => a.id === id); if (i >= 0) alarmas.splice(i, 1); };
  return { ...r, R, alarmas };
}
const J = (x) => JSON.parse(JSON.stringify(x));   /* las listas de la VM no son del mismo realm */
const lunes8 = new Date(2026, 9, 26, 7, 0, 0);   // lunes 26/oct/2026 07:00

test('parseHora y parseDias entienden como habla la gente', () => {
  const { R } = montar();
  assert.equal(R.parseHora('8'), '08:00');
  assert.equal(R.parseHora('a las 20:30'), '20:30');
  assert.equal(R.parseHora('7.15'), '07:15');
  assert.equal(R.parseHora('25'), null);
  assert.equal(R.parseHora('mañana'), null);
  assert.deepEqual(J(R.parseDias('')), []);
  assert.deepEqual(J(R.parseDias('todos los días')), []);
  assert.deepEqual(J(R.parseDias('lunes y jueves')), [1, 4]);
  assert.deepEqual(J(R.parseDias('lunes a viernes')), [1, 2, 3, 4, 5]);
  assert.deepEqual(J(R.parseDias('fines de semana')), [0, 6]);
  assert.deepEqual(J(R.parseDias('viernes a lunes')), [0, 1, 5, 6], 'el rango da la vuelta a la semana');
});

test('add: valida, rechaza duplicados y respeta el tope', () => {
  const { R } = montar();
  assert.equal(R.add({ name: 'x', at: 'nunca' }, lunes8).ok, false);
  assert.equal(R.add({ name: 'x', at: '8', what: 'decir' }, lunes8).ok, false, 'decir sin texto');
  assert.equal(R.add({ name: 'Buen día', at: '8' }, lunes8).ok, true);
  assert.match(R.add({ name: 'buen dia', at: '9' }, lunes8).err, /ya existe/);
  for (let i = 0; i < R.MAX; i++) R.add({ name: 'r' + i, at: '9' }, lunes8);
  assert.match(R.add({ name: 'una más', at: '9' }, lunes8).err, /ya tenés/);
});

test('nextFire respeta los días y siempre es futuro', () => {
  const { R } = montar();
  const r = R.add({ name: 'finde', at: '9', days: 'sábado' }, lunes8).routine;
  const nf = R.nextFire(r, lunes8);
  assert.equal(nf.getDay(), 6);
  assert.equal(nf.getHours(), 9);
  assert.ok(nf > lunes8);
  /* justo a la hora: la próxima ya es la siguiente */
  const diaria = R.add({ name: 'diaria', at: '07:00' }, new Date(2026, 9, 25, 6, 0)).routine;
  assert.equal(R.nextFire(diaria, lunes8).getDate(), 27, 'a las 07:00 en punto, la de hoy ya pasó');
});

test('due: toca a la hora, una sola vez por día, y no revive rutinas viejas', () => {
  const { R } = montar();
  const r = R.add({ name: 'resumen', at: '8' }, lunes8).routine;      // creada 07:00: hoy sí corre
  assert.equal(R.due(new Date(2026, 9, 26, 7, 59)).length, 0, 'antes de la hora, no');
  assert.equal(R.due(new Date(2026, 9, 26, 8, 0)).length, 1);
  assert.equal(R.due(new Date(2026, 9, 26, 13, 0)).length, 1, 'hasta 6 h después sigue valiendo');
  assert.equal(R.due(new Date(2026, 9, 26, 15, 0)).length, 0, 'a las 15 el buen día ya no tiene sentido');
  const tarde = R.add({ name: 'tarde', at: '6' }, lunes8).routine;      // creada 07:00, su hora (6) ya pasó
  assert.equal(R.due(new Date(2026, 9, 26, 7, 30)).filter((x) => x.id === tarde.id).length, 0, 'no corre de inmediato al crearla');
  R.setEnabled('resumen', false);
  assert.equal(R.due(new Date(2026, 9, 26, 8, 0)).length, 0, 'pausada no corre');
});

test('tick: corre la acción, entrega el texto y marca el día', async () => {
  const { R } = montar();
  R.add({ name: 'resumen', at: '8' }, lunes8);
  const dados = [];
  const n = await R.tick((txt, r) => dados.push({ txt, r }), new Date(2026, 9, 26, 8, 1));
  assert.equal(n, 1);
  assert.match(dados[0].txt, /Hoy es/);
  assert.equal(await R.tick((t) => dados.push(t), new Date(2026, 9, 26, 8, 2)), 0, 'no se repite el mismo día');
  assert.equal(await R.tick((t) => dados.push(t), new Date(2026, 9, 27, 8, 1)), 1, 'al otro día sí');
});

test('condición de lluvia: avisa solo si llueve ese día', async () => {
  const { R, ctx } = montar();
  ctx.localStorage.setItem('kiu_ciudad', 'Lima');
  R.add({ name: 'paraguas', at: '20', what: 'clima', ifRain: 'mañana' }, lunes8);
  const dados = [];
  /* el fetch del arnés devuelve mañana con 80 % de lluvia */
  assert.equal(await R.tick((t) => dados.push(t), new Date(2026, 9, 26, 20, 1)), 1);
  assert.match(dados[0], /Va a llover mañana \(80%\)/);
  /* ahora con 10 %: no avisa, pero igual marca el día (no insiste) */
  const f0 = ctx.fetch;
  ctx.fetch = (u) => String(u).includes('api.open-meteo.com') && !String(u).includes('geocoding')
    ? Promise.resolve({ ok: true, json: () => Promise.resolve({ current: { temperature_2m: 20, weather_code: 1, wind_speed_10m: 5 },
      daily: { time: ['a', 'b', 'c'], weather_code: [1, 1, 1], temperature_2m_max: [20, 20, 20], temperature_2m_min: [10, 10, 10], precipitation_probability_max: [5, 10, 5] } }) })
    : f0(u);
  assert.equal(await R.tick((t) => dados.push(t), new Date(2026, 9, 27, 20, 1)), 0);
  assert.equal(R.due(new Date(2026, 9, 27, 20, 30)).length, 0, 'marcada: no se reintenta');
});

test('sin datos del clima NO marca el día: reintenta en el próximo tick', async () => {
  const { R, ctx } = montar();
  ctx.localStorage.setItem('kiu_ciudad', 'Lima');
  R.add({ name: 'paraguas', at: '20', what: 'clima', ifRain: 'mañana' }, lunes8);
  const f0 = ctx.fetch;
  ctx.fetch = () => Promise.reject(new Error('offline'));
  assert.equal(await R.tick(() => { }, new Date(2026, 9, 26, 20, 1)), 0);
  ctx.fetch = f0;
  assert.equal(await R.tick(() => { }, new Date(2026, 9, 26, 20, 5)), 1, 'volvió la red: corre');
});

test('SEGURIDAD: una rutina solo puede leer', async () => {
  const { R, A } = montar();
  assert.deepEqual(J(R.ACCIONES).sort(), ['agenda', 'clima', 'decir', 'resumen', 'tareas']);
  /* cada acción permitida resuelve a una herramienta de LECTURA */
  for (const [what, args] of [['resumen', {}], ['clima', {}], ['agenda', { day: 'hoy' }], ['tareas', { action: 'list' }]]) {
    const tool = { resumen: 'daily_briefing', clima: 'get_weather', agenda: 'read_calendar', tareas: 'manage_task' }[what];
    assert.equal(A.riskOf(A.get(tool), args), 'read', tool + ' tiene que ser de lectura');
  }
  /* y una acción inventada no llega a ningún lado: cae al resumen, nunca a send_message */
  const r = R.add({ name: 'mala', at: '9', what: 'send_message' }, lunes8).routine;
  assert.equal(r.what, 'resumen');
  /* si alguien volviera de escritura una herramienta, la rutina no corre */
  const real = A.get('daily_briefing');
  const riesgo = real.risk;
  real.risk = 'write';
  const out = await R.correr(R.add({ name: 'x', at: '9' }, lunes8).routine, new Date(2026, 9, 26, 9, 1));
  real.risk = riesgo;
  assert.equal(out.ran, false);
  assert.match(out.err, /solo puede leer/);
});

test('despertadores: se programa la próxima, sin duplicar, y se retira al borrar', () => {
  const { R, alarmas } = montar();
  R.add({ name: 'resumen', at: '8' }, lunes8);
  assert.equal(R.programarDespertadores(lunes8), 1);
  assert.equal(alarmas[0].title, 'Rutina: resumen');
  assert.equal(R.programarDespertadores(lunes8), 0, 'no duplica');
  R.remove('resumen');
  assert.equal(alarmas.length, 0, 'borrar la rutina quita su alarma');
});

test('manage_routine (agente): crea, lista y borra; crear pide confirmación y listar no', () => {
  const { A } = montar();
  const t = A.get('manage_routine');
  assert.equal(t.riskFor({ action: 'list' }), 'read');
  assert.equal(t.riskFor({ action: 'add' }), 'write');
  assert.equal(t.riskFor({ action: 'remove' }), 'write');
  const c = t.run({ action: 'add', name: 'resumen', at: '8', what: 'resumen' });
  assert.equal(c.ok, true);
  assert.match(c.text, /Rutina creada — resumen: todos los días a las 08:00/);
  assert.match(c.text, /con la app cerrada te suena una alarma/, 'dice la limitación en vez de esconderla');
  assert.match(t.run({ action: 'list' }).text, /· resumen:/);
  assert.equal(t.run({ action: 'add', name: 'x', at: 'nunca' }).ok, false);
  assert.match(t.run({ action: 'remove', name: 'resumen' }).text, /Borré/);
  assert.equal(t.run({ action: 'remove', name: 'resumen' }).ok, false);
  assert.match(t.run({ action: 'list' }).text, /No tenés rutinas/);
});

test('cableado: index.html carga el módulo después del agente y la UI hace tick', () => {
  const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
  assert.ok(html.indexOf('js/kiu-agente.js') < html.indexOf('js/kiu-rutinas.js'), 'rutinas depende del agente');
  const ui = fs.readFileSync(path.join(WWW, 'js/app/app-ui.js'), 'utf8');
  assert.match(ui, /rutinasTick: function/);
  assert.match(ui, /setInterval\(function \(\) \{ self2\.rutinasTick\(\); \}, 60000\)/);
  assert.match(ui, /window\.nexoAlarmFired = function \(title\) \{\s*try \{ setTimeout\(function \(\) \{ self\.rutinasTick\(\)/);
});
