/* rediseño-v2147.test.mjs — v2.14.7: el rediseño, la visión y la tarjeta de error.
 *
 *   1. LA TARJETA DE ERROR. El rediseño Pro tiene tarjetas de estado para lo
 *      que Kiu hace, pero no tenía ninguna para lo que FALLA. Y un fallo no
 *      es una respuesta del bot: es un problema de la app, con su ícono y su
 *      acción. Antes salía como un párrafo más, mezclado con lo que Kiu dice.
 *   2. LA VISIÓN. El motor del teléfono no tiene soporte multimodal (el JNI
 *      no carga mmproj ni usa mtmd), así que una foto la tiene que contestar
 *      el servidor o la API. Antes el motor local se probaba PRIMERO en modo
 *      Auto: la foto nunca llegaba a quien podía verla. Y el "swap" de visión
 *      descargaba el modelo del usuario para poner un modelo de TEXTO (que
 *      tampoco ve), dejando el teléfono sin modelo.
 *   3. LOS TOKENS. El gris secundario daba 3,6:1 sobre el panel: por
 *      debajo del 4,5:1 de WCAG AA. O sea, el texto más chico era el menos
 *      legible. Este test CALCULA el contraste y lo exige.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cargarAgente } from './evals/harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.join(here, '..');
const WWW = path.join(raiz, 'app', 'src', 'main', 'assets', 'www');
const css = readFileSync(path.join(WWW, 'css', 'app.css'), 'utf8');
const uiSrc = readFileSync(path.join(WWW, 'js', 'app', 'app-ui.js'), 'utf8');
const motorSrc = readFileSync(path.join(WWW, 'js', 'app', 'motor.js'), 'utf8');
const htmlSrc = readFileSync(path.join(WWW, 'index.html'), 'utf8');

/* ---------- contraste WCAG ---------- */
function lum(hex) {
  const c = hex.replace('#', '').match(/../g).map((h) => {
    const v = parseInt(h, 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a, b) {
  const l1 = lum(a), l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
function token(nombre) {
  /* el token que CUENTA es el último: en CSS, la última declaración gana
     (misma especificidad). Buscar el primero mentiría. */
  const todos = [...css.matchAll(new RegExp('--' + nombre + '\\s*:\\s*(#[0-9A-Fa-f]{6})', 'g'))];
  assert.ok(todos.length, 'falta el token --' + nombre);
  return todos[todos.length - 1][1];
}

/* ================= 1 · la tarjeta de error ================= */
test('la tarjeta de error existe en el CSS, con ícono, cuerpo y acción', () => {
  assert.match(css, /\.errcard\s*\{/, 'falta la tarjeta');
  assert.match(css, /\.errcard-ic/, 'falta el ícono');
  assert.match(css, /\.errcard-act/, 'falta el botón de acción');
  assert.match(css, /\.msg-err/, 'falta el marcador para no leerla por el TTS');
});

test('las líneas "!!" se renderizan como tarjeta, no como párrafo', () => {
  const { ctx } = cargarAgente();
  const html = ctx.App.md('!! **No pude responder**\n!! el motor está ocupado\n!! → [Liberar motor](kiu://liberar-motor)');
  assert.match(html, /class="errcard"/, 'tiene que ser una tarjeta');
  assert.match(html, /No pude responder/, 'con el título');
  assert.match(html, /data-kiu-act="kiu:\/\/liberar-motor"/, 'y el botón con su acción');
  assert.match(html, /errcard-act/, 'el botón con su clase');
});

test('el texto normal NO se vuelve tarjeta', () => {
  const { ctx } = cargarAgente();
  const html = ctx.App.md('Hola, ¿qué tal?');
  assert.doesNotMatch(html, /errcard/);
});

test('el botón de la tarjeta ejecuta su acción', () => {
  assert.match(uiSrc, /data-kiu-act/, 'el handler del botón');
  assert.match(uiSrc, /kiu:\/\/liberar-motor/, 'libera el motor');
  assert.match(uiSrc, /kiu:\/\/vision/, 'lleva a configurar la visión');
  assert.match(uiSrc, /kiu:\/\/reintentar/, 'reintenta la pregunta');
});

test('la tarjeta de error NO se lee en voz alta, pero el micro se rearma', () => {
  /* v2.14.7: el rearme del micro tiene que correr también en la tarjeta: si la
     tarjeta se come el rearme, la conversación se muere en silencio. */
  assert.match(uiSrc, /botSay: function \(text, liveEl, sinVoz\)/);
  const i = uiSrc.indexOf('botSay: function (text, liveEl, sinVoz)');
  const cuerpo = uiSrc.slice(i, i + 2600);
  assert.match(cuerpo, /if \(!sinVoz\)/, 'la voz se saltea solo con sinVoz');
  assert.match(cuerpo, /if \(S\.conv\)/, 'pero el rearme del micro sigue adentro');
});

/* ================= 2 · la visión ================= */
test('en Auto, una foto NO se manda al motor del teléfono (no ve)', () => {
  const { ctx } = cargarAgente();
  ctx.S.router = { on: true, kiuVis: '', kiuFast: '', kiuBrain: '' };
  ctx.S.mode = 'nube';
  const sel = ctx.Orch.seleccionar ? null : null;
  /* el objetivo de visión se construye con Orch.targets('vision') */
  const targets = ctx.Orch.targets('vision');
  const hayMotor = targets.some((t) => t.t === 'kiu');
  assert.equal(hayMotor, false,
    'el motor del teléfono no ve fotos: tiene que quedar fuera de los objetivos de visión');
});

test('no hay cambio de modelo para visión: el que está cargado se queda', () => {
  const { ctx } = cargarAgente();
  ctx.S.router = { on: true, kiuVis: '', kiuFast: '', kiuBrain: '' };
  assert.equal(ctx.Orch.pickModel('vision'), '',
    'no hay a qué cambiar: el motor del teléfono no tiene visión');
});

test('la app lo dice claro: el teléfono no ve, la foto va al servidor o a la API', () => {
  assert.match(htmlSrc, /no ve/i, 'el ajuste de visión lo dice');
  assert.match(uiSrc, /No puedo ver la foto/, 'y la tarjeta de visión lo dice');
  assert.match(uiSrc, /servidor en red o una API con visión/, 'dónde está la solución');
});

/* ================= 3 · los tokens ================= */
test('el gris secundario pasa WCAG AA sobre el panel y el fondo', () => {
  const dim2 = token('dim2');
  const panel = token('p-panel');
  const fondo = token('bg');
  const r1 = ratio(dim2, panel), r2 = ratio(dim2, fondo);
  assert.ok(r1 >= 4.5, 'dim2 sobre el panel: ' + r1.toFixed(2) + ':1 (hace falta 4.5)');
  assert.ok(r2 >= 4.5, 'dim2 sobre el fondo: ' + r2.toFixed(2) + ':1 (hace falta 4.5)');
});

test('el acento teal y los colores de estado también pasan AA', () => {
  const panel = token('p-panel');
  for (const t of ['p-brand', 'p-ok', 'p-err']) {
    const r = ratio(token(t), panel);
    assert.ok(r >= 3, t + ' sobre el panel: ' + r.toFixed(2) + ':1');
  }
  const rTeal = ratio(token('acc'), panel);
  assert.ok(rTeal >= 4.5, 'el acento: ' + rTeal.toFixed(2) + ':1');
});

test('la escala tipográfica tiene un piso de 11 px para lo que se lee', () => {
  assert.match(css, /--fs-xs:\s*11px/, 'el piso está declarado');
  /* y las etiquetas que la gente tiene que leer no bajan de 11 px */
  const Floor = 11;
  for (const sel of ['.set-row span', '.row-txt span', '.chip']) {
    const i = css.indexOf(sel + ' {');
    if (i < 0) continue;
    const bloque = css.slice(i, css.indexOf('}', i));
    const m = bloque.match(/font-size:\s*(\d+(?:\.\d+)?)px/);
    if (m) {
      assert.ok(parseFloat(m[1]) >= Floor, sel + ' usa ' + m[1] + 'px (piso ' + Floor + 'px)');
    }
  }
});
