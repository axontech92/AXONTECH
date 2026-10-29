/* premium-v2142.test.mjs — v2.14.2: la capa premium del CSS.
 *
 * El mockup de la interfaz (vidrio esmerilado + tarjetas a relieve) se
 * llevó a `app.css` como una CAPA que solo AGREGA al final del archivo.
 * Este test vigila tres cosas:
 *
 *   1) QUE LA CAPA EXISTA y sea la que se descrebe en el mockup.
 *   2) QUE SEA ADITIVA: si alguien edita la capa y borra una regla de
 *      arriba, la app se rompe por abajo sin que se note. Este test lo
 *      agarra.
 *   3) QUE NO ROMPA EL RENDIMIENTO: el blur de verdad (backdrop-filter)
 *      es CARO en un WebView de Android. Por eso solo va en las
 *      superficies grandes; en las once tarjetas repetidas de
 *      Herramientas, el mismo efecto se consigue con relieve, sin blur.
 *      Un backdrop-filter en cada tarjeta baja los frames y hace que la
 *      app se vea "pro"... y se trabe.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.join(here, '..');
const css = readFileSync(path.join(raiz, 'app/src/main/assets/www/css/app.css'), 'utf8');
const capa = css.slice(css.indexOf('CAPA PREMIUM'));
const antes = css.slice(0, css.indexOf('CAPA PREMIUM'));

/* Reglas de una clase dentro de un bloque de texto. */
function bloque(texto, selector) {
  const i = texto.indexOf(selector);
  if (i < 0) return null;
  const j = texto.indexOf('}', i);
  return texto.slice(i, j + 1);
}

test('la capa premium está en el CSS y es identificable', () => {
  assert.ok(capa.length > 1500, 'la capa tiene que estar (y ser de verdad)');
  assert.match(capa, /VIDRIO/);
  assert.match(capa, /RELIEVE/);
  /* el orden importa: la capa va al final, si no, la app real la pisa */
  assert.ok(antes.length > 1000, 'las reglas de siempre tienen que seguir delante');
});

test('la capa es ADITIVA: las reglas de siempre siguen ahí', () => {
  for (const sel of ['.set-card {', '.hero-card {', '.motor-card {', '.quick-card {', '.tool-card {', '.msg-bubble {', '.toggle {', '.seg {', '.chip {']) {
    assert.ok(antes.includes(sel), 'faltó la regla original ' + sel);
  }
  /* y los tokens base no se tocan */
  assert.match(antes, /--r-xl:28px/);
  assert.match(antes, /--acc:#2DD4BF/);
  assert.match(antes, /--bg:#070B16/);
});

test('el vidrio de verdad va solo en las superficies grandes', () => {
  const conBlur = ['.hero-card', '.motor-card', '.prov-card', '.tip-card', '.modal-sheet'];
  for (const sel of conBlur) {
    const b = bloque(capa, sel + ',') || bloque(capa, sel + ' {');
    assert.ok(b, 'falta el bloque de ' + sel);
  }
  assert.match(capa, /backdrop-filter:blur\(18px\)/, 'el vidrio grande lleva blur');
  assert.match(capa, /backdrop-filter:blur\(24px\)/, 'el modal lleva blur');
});

test('las tarjetas repetidas NO llevan blur (el teléfono se traba)', () => {
  /* once .tool-card con backdrop-filter = once superfícies compuestas por
     frame. El efecto se consigue con relieve. */
  const b = bloque(capa, '.tool-card,');
  assert.ok(b, 'falta el bloque de las tarjetas repetidas');
  assert.doesNotMatch(b, /backdrop-filter/, '.tool-card no puede llevar blur');
  const q = bloque(capa, '.quick-card,');
  assert.doesNotMatch(q, /backdrop-filter/, '.quick-card no puede llevar blur');
  /* pero sí relieve: sombra dura + luz inversa */
  assert.match(b, /--p-dark/, 'y sí el relieve');
  assert.match(b, /--p-light/);
});

test('el relieve tiene las dos sombras (dura e inversa)', () => {
  assert.match(capa, /--p-dark:0 7px 18px/);
  assert.match(capa, /--p-light:-4px -4px 12px/);
  assert.match(capa, /--p-shine:inset 0 1px 0/);
  /* y al presionar, la sombra dura se va: el botón "baja" */
  assert.match(capa, /\.quick-card:active[\s\S]{0,400}var\(--p-light\)/);
});

test('el interruptor es una pieza física, no un rectángulo plano', () => {
  const t = bloque(capa, '.toggle {');
  assert.match(t, /inset 2px 2px 6px/, 'el surco del interruptor');
  assert.match(capa, /\.toggle\.on::after[\s\S]{0,300}2DD4BF/, 'la perilla encendida es teal');
});

test('la capa respeta prefers-reduced-motion', () => {
  assert.match(capa, /@media \(prefers-reduced-motion: reduce\)/);
});

test('el chat usa el mismo lenguaje de superficies', () => {
  const bot = bloque(capa, '.msg.bot .msg-bubble {');
  assert.match(bot, /--p-glass/, 'la burbuja del bot es vidrio');
  const user = bloque(capa, '.msg.user .msg-bubble {');
  assert.match(user, /rgba\(45,212,191/, 'la del usuario, teal');
  assert.match(user, /inset 0 1px 0/, 'con luz interior');
});
