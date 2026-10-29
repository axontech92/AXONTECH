/*
 * Tests de KiuBrain (app/src/main/assets/www/js/brain.js) — corren con Node puro:
 *
 *     node --test tests/
 *
 * Sin dependencias: se carga brain.js en un contexto VM con un stub de
 * `window`, igual que hace el WebView, y se prueba la API pública.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  path.join(here, '..', 'app', 'src', 'main', 'assets', 'www', 'js', 'brain.js'),
  'utf8',
);

function loadBrain() {
  return loadBrainAt();
}

/* v2.8.0: reloj congelado. parseWhen mira la hora actual, así que el mismo texto
   da 'a las 09:00' o 'mañana a las 09:00' según qué hora sea cuando corre el
   test. Con un reloj fijo el caso deja de depender del momento en que se ejecuta.
   FrozenDate se pasa como 'YYYY-MM-DDTHH:mm:ss' en hora local del proceso. */
function loadBrainAt(iso) {
  const fixed = iso ? new Date(iso).getTime() : null;
  const ctx = { window: {} };
  // genPass usa window.crypto si está; Node trae webcrypto
  ctx.window.crypto = globalThis.crypto;
  if (fixed !== null) {
    class FrozenDate extends Date {
      constructor(...a) { if (a.length) super(...a); else super(fixed); }
      static now() { return fixed; }
    }
    ctx.Date = FrozenDate;
  }
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: 'brain.js' });
  const brain = ctx.window.KiuBrain;
  assert.ok(brain, 'window.KiuBrain debe quedar definido tras cargar brain.js');
  return brain;
}

// Los objetos Date nacen dentro del contexto VM: instanceof Date del realm
// externo da false. Verificamos por duck-typing.
function isDate(x) {
  return Object.prototype.toString.call(x) === '[object Date]'
    && typeof x.getTime === 'function'
    && !Number.isNaN(x.getTime());
}

test('norm: minúsculas, acentos, ñ y puntuación', () => {
  const b = loadBrain();
  assert.equal(b.norm('  ¿HÓLA, Ñandú?  '), 'hola nandu');
  assert.equal(b.norm('Mamá... ¡ quéPAso !'), 'mama quepaso');
  assert.equal(b.norm(''), '');
  assert.equal(b.norm(null), '');
});

test('greeting: saludo según la hora y con nombre', () => {
  const b = loadBrain();
  const h = new Date().getHours();
  const esperado = h < 6 ? 'Buenas noches' : h < 13 ? 'Buen día' : h < 20 ? 'Buenas tardes' : 'Buenas noches';
  assert.ok(b.greeting().startsWith(esperado), `"${b.greeting()}" debería arrancar con "${esperado}"`);
  assert.ok(b.greeting('Juan').includes('Juan'));
});

test('genPass: largo pedido y solo caracteres del alfabeto', () => {
  const b = loadBrain();
  const pass = b.genPass(20);
  assert.equal(pass.length, 20);
  assert.match(pass, /^[A-HJ-NP-Za-km-z2-9!#$%&*+\-?]{20}$/);
  // dos llamadas no deberían dar la misma cadena
  assert.notEqual(pass, b.genPass(20));
});

test('fallback: sin proveedor nube sugiere comandos locales', () => {
  const b = loadBrain();
  const msg = b.fallback();
  assert.ok(msg, 'sin KiuApp (API apagada) el fallback debe devolver texto');
  assert.ok(msg.includes('motor local'));
  assert.ok(msg.includes('modelo no esté cargado'));
  assert.ok(!msg.includes('activá un proveedor'));
});

test('tip: devuelve una pista no vacía', () => {
  const b = loadBrain();
  const t = b.tip();
  assert.ok(typeof t === 'string' && t.length > 5);
});

test('parseWhen: "en 20 minutos" calcula el momento correcto', () => {
  const b = loadBrain();
  const antes = Date.now();
  const r = b.parseWhen('despiertame en 20 minutos');
  assert.ok(r && isDate(r.when) && r.whenTxt);
  const ms = r.when.getTime() - antes;
  assert.ok(ms > 19 * 60000 && ms <= 21 * 60000 + 50, `delta=${ms}ms`);
});

test('parseWhen: "en 2 horas" y "en 3 dias"', () => {
  const b = loadBrain();
  const h = b.parseWhen('en 2 horas');
  assert.ok(Math.abs((h.when.getTime() - Date.now()) - 2 * 3600000) < 1000);
  const d = b.parseWhen('en 3 dias');
  assert.ok(Math.abs((d.when.getTime() - Date.now()) - 3 * 86400000) < 1000);
});

test('parseWhen: "a las 9 de la noche" = 21:00', () => {
  const b = loadBrain();
  const r = b.parseWhen('pon alarma a las 9 de la noche');
  assert.ok(r, 'debería parsear la hora');
  assert.equal(r.when.getHours(), 21);
  assert.equal(r.when.getMinutes(), 0);
});

test('parseWhen: "a las 8 y media" = 08:30', () => {
  const b = loadBrain();
  const r = b.parseWhen('a las 8 y media');
  assert.ok(r);
  assert.equal(r.when.getHours(), 8);
  assert.equal(r.when.getMinutes(), 30);
});

// OJO contrato interno: reply() siempre normaliza con norm() (ñ→n) ANTES de
// llamar a parseWhen. Por eso acá le pasamos el texto normalizado, igual que
// hace el flujo real. Con "ñ" cruda no matchea (regex usan ASCII).
test('parseWhen: "mañana" sin hora cae a las 9:00 del día siguiente', () => {
  const b = loadBrain();
  const r = b.parseWhen(b.norm('recordame mañana de llamar a Ana'));
  assert.ok(r);
  const esperado = new Date();
  esperado.setDate(esperado.getDate() + 1);
  assert.equal(r.when.getDate(), esperado.getDate());
  assert.equal(r.when.getHours(), 9);
});

test('reply: aritmética en lenguaje natural ("cuanto es 2 x 3")', () => {
  const b = loadBrain();
  const r = b.reply('cuanto es 2 x 3');
  assert.ok(r && r.handled, 'reply debe manejar la cuenta en modo local');
  assert.ok(r.text.includes('6'), `texto: "${r.text}"`);
});

test('reply: no maneja texto que no es suyo (deja pasar a la nube)', () => {
  const b = loadBrain();
  const r = b.reply('explícame la fotosíntesis de las plantas marinas');
  assert.ok(r === null || r.handled === false || r.text === undefined,
    'temas abiertos sin nube no deberían dar respuesta final');
});

test('parseWhen: basura entrante devuelve null (sin falsos positivos)', () => {
  const b = loadBrain();
  assert.equal(b.parseWhen('hola que tal'), null);
  assert.equal(b.parseWhen(''), null);
});


/* ---------- v2.7.1: regresiones de parseWhen ----------
   v2.8.0: el caso "de la manana" usaba la hora real, así que a partir de las 9:00
   fallaba aunque el código estuviera bien (a las 10, las 9 de la mañana ya pasaron
   y la próxima ocurrencia ES mañana). Se congela el reloj para que el test diga
   lo que dice, y se agrega explícitamente el caso del rollover. */
test('parseWhen: "de la manana" con reloj fijo antes de las 9 = hoy a las 9', () => {
  const b = loadBrainAt('2026-03-10T08:00:00');
  const r = b.parseWhen('a las 9 de la manana');
  assert.ok(r, 'debería parsear la hora');
  assert.equal(r.when.getHours(), 9);
  assert.equal(r.when.getMinutes(), 0);
  assert.equal(r.whenTxt, 'a las 09:00', 'no es el día siguiente');
});

test('parseWhen: pasadas las 9, "a las 9 de la manana" cae a mañana (por la hora, no por la palabra)', () => {
  const b = loadBrainAt('2026-03-10T10:30:00');
  const r = b.parseWhen('a las 9 de la manana');
  assert.ok(r);
  const esperado = new Date('2026-03-10T08:00:00');
  esperado.setDate(esperado.getDate() + 1);
  esperado.setHours(9, 0, 0, 0);
  assert.equal(r.when.getDate(), esperado.getDate());
  assert.equal(r.when.getHours(), 9);
  assert.equal(r.whenTxt, 'mañana a las 09:00');
});

test('parseWhen: 12 de la noche = medianoche; esta noche a las 10 = 22:00', () => {
  const b = loadBrain();
  assert.equal(b.parseWhen('a las 12 de la noche').when.getHours(), 0);
  assert.equal(b.parseWhen('esta noche a las 10').when.getHours(), 22);
});

test('parseWhen: media hora, hora y media, menos cuarto', () => {
  const b = loadBrain();
  const t0 = Date.now();
  const a = b.parseWhen('en media hora').when.getTime() - t0;
  assert.ok(Math.abs(a - 30 * 60000) < 5000);
  const c = b.parseWhen('en 1 hora y media').when.getTime() - t0;
  assert.ok(Math.abs(c - 90 * 60000) < 5000);
  const d = b.parseWhen('a las 9 menos cuarto').when;
  assert.equal(d.getHours(), 8); assert.equal(d.getMinutes(), 45);
});

test('genPass: longitud exacta y sin simbolos cuando se pide', () => {
  const b = loadBrain();
  for (let i = 0; i < 200; i++) {
    const len = 8 + (i % 25);
    assert.equal(b.genPass(len, true).length, len);
    assert.match(b.genPass(len, true), /^[A-Za-z0-9]+$/);
    assert.equal(b.genPass(len).length, len);
  }
});
