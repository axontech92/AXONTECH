// Regresión v2.7.5: los movimientos del cuerpo del bot deben escalar con su tamaño (--u = tamaño/190).
// Antes eran px fijos pensados para el bot de 190 px: en el mini de 36 px "iba de un lado a otro".
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync('app/src/main/assets/www/js/kiu-avatar.js', 'utf8');
const css = eval(src.match(/var CSS=(".*?");\nvar SVG/s)[1]);

test('keyframes del cuerpo escalan con --u (sin px sueltos)', () => {
  for (const n of ['fl', 'nd', 'sw', 'sd', 'bn', 'tr', 'sh', 'sk', 'hp', 'ds', 'jt', 'zg', 'ld', 'vb', 'tb', 'jp']) {
    const m = css.match(new RegExp('@keyframes ' + n + '\\{.*'));
    const body = m[0].split('@keyframes')[1];
    const sinCalc = body.replace(/calc\(var\(--u,1\)\*-?[\d.]+px\)/g, '');
    assert.doesNotMatch(sinCalc.split('}}')[0], /\d+px/, 'keyframes ' + n + ' con px fijos');
  }
});

test('el montaje y el resize fijan --u', () => {
  assert.equal((src.match(/setProperty\('--u'/g) || []).length, 2);
});

test('el bot pequeño (<60 px) no se desplaza de lado: solo flota', () => {
  assert.match(css, /\.bot\.mini\.b-sd[^{]*\{animation:fl /);
  for (const c of ['sd', 'sw', 'zg', 'sh', 'tr', 'jt', 'vb']) {
    assert.ok(css.includes('.bot.mini.b-' + c), 'falta .mini para b-' + c);
  }
  // v2.8.0: el className del cuerpo se arma en una variable y solo se reasigna si
  // cambió, para no reiniciar la animación en cada set(). La regresión que
  // importa sigue siendo: el sufijo ' mini' se decide por el tamaño.
  assert.match(src, /var body='bot b-'\+c\[3\]\+\(size<60\?' mini':''\)/);
  assert.match(src, /if\(body!==lastBody\)\{bt\.className=body/);
  assert.match(src, /classList\.toggle\('mini',size<60\)/);
});
