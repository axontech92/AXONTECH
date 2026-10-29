// estados.test.mjs — el controlador de estados del avatar (js/kiu-estados.js).
//
// Antes del v2.8.0 el estado del bot salía de dos lados a la vez: un Proxy sobre
// KiuBridge que adivinaba mirando cada llamada al puente, y los set() sueltos de
// app-ui / motor / models. Se pisaban entre sí. Estos tests fijan el contrato
// nuevo: un solo controlador, capas con prioridad y eventos explícitos.
//
// node --test tests/estados.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { newSandbox, runScript, WWW } from './helpers.mjs';
import path from 'node:path';

/* sandbox con KiuAvatar stub: el controlador solo necesita pintar, no pintar bien */
function newSb() {
  const sb = newSandbox();
  runScript(sb, 'js/kiu-estados.js');
  sb.__painted = [];
  sb.KiuAvatar = {
    states: ['Inactivo', 'Generando', 'Cargando', 'Descargando', 'Respuesta lista', 'Error', 'Cargado', 'Sin modelo', 'Hablando', 'Escuchando', 'Enrutando', 'Proveedor en pausa', 'Entrada', 'RAG apagado', 'RAG activo', 'Disparado'],
    set(n) { sb.__painted.push(n); return n; }
  };
  return sb;
}

/* el sandbox de helpers no dispara temporizadores: el flash no se cae solo por
   timeout, pero compute() compara contra flashUntil, así que avanzar el reloj
   alcanza para probar el vencimiento. */
const RealDate = globalThis.Date;
function clock(sb, ms) {
  const at = (sb.__at || RealDate.now()) + ms;   /* acumulativo: clock(1500) y luego clock(4000) = 5,5 s */
  sb.__at = at;
  sb.Date = class FrozenDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(at); }
    static now() { return at; }
  };
}
function unclock(sb) { delete sb.Date; sb.__at = 0; }

/* para los tests de regresión: mira el CÓDIGO, no los comentarios (los
   comentarios explican justamente qué dejó de pasar). */
function code(rel) {
  return readFileSync(path.join(WWW, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

test('el arranque del bot es ' + 'Inactivo' + ' y sin capas encendidas', () => {
  const sb = newSb();
  assert.equal(sb.KiuState.get(), 'Inactivo');
  const s = sb.KiuState.snapshot();
  assert.deepEqual({ ...s.layers }, { rest: 'Inactivo' });
});

test('un flash se ve y después vuelve al estado pegado', () => {
  const sb = newSb();
  sb.KiuState.set('job', 'Generando');
  assert.equal(sb.KiuState.get(), 'Generando');
  sb.KiuState.flash('flash', 'Respuesta lista', 2000);
  assert.equal(sb.KiuState.get(), 'Generando', 'un flash NO puede pisar a Generando');
  clock(sb, 2500);
  assert.equal(sb.KiuState.get(), 'Generando');
  sb.KiuState.clear('job');
  assert.equal(sb.KiuState.get(), 'Inactivo', 'al terminar la generación vuelve al reposo real');
  unclock(sb);
});

test('un flash SOLO se ve si no hay nada de mayor prioridad activo', () => {
  const sb = newSb();
  sb.KiuState.flash('flash', 'Cargado', 1000);
  assert.equal(sb.KiuState.get(), 'Cargado', 'sin nada encima, el flash se ve');
  sb.KiuState.set('job', 'Descargando');
  assert.equal(sb.KiuState.get(), 'Descargando', 'la descarga manda sobre el flash');
  sb.KiuState.set('voz', 'Hablando');
  assert.equal(sb.KiuState.get(), 'Descargando', 'trabajo pesado > voz');
  clock(sb, 2000);
  assert.equal(sb.KiuState.get(), 'Descargando', 'y el flash ya venció solo');
  unclock(sb);
});

test('regresión: "Cargado" ya no salta en cada mensaje (ensureLoaded → kiuIsLoaded)', () => {
  /* el bug: ensureLoaded() llama kiuIsLoaded antes de cada envío, el Proxy lo veía
     como "recién cargó" y ponía Inactivo + "Cargado" en medio de la respuesta. */
  const src = code('js/kiu-avatar-boot.js');
  assert.doesNotMatch(src, /new Proxy\(B/, 'kiu-avatar-boot.js ya no envuelve el puente para adivinar estados');
  assert.doesNotMatch(src, /kiuIsLoaded/, 'kiuIsLoaded no puede cambiar el estado del bot');
  assert.doesNotMatch(src, /kiuGenStatus/, 'el fin de la generación no se deduce por sondeo');
  const motor = code('js/app/motor.js');
  assert.doesNotMatch(motor.slice(motor.indexOf('ensureLoaded'), motor.indexOf('_thermArm')),
    /KiuAvatar/, 'ensureLoaded no toca el avatar');
});

test('regresión: la carga del modelo ya no tiene temporizador propio que fuerce Inactivo', () => {
  const boot = code('js/kiu-avatar-boot.js');
  assert.doesNotMatch(boot, /90000/, 'el timer suelto de 90 s se fue con el Proxy');
  const motor = code('js/app/motor.js');
  const load = motor.slice(motor.indexOf('load: function'), motor.indexOf('autoload:'));
  assert.match(load, /jobOn\('Cargando'\)/, 'la carga enciende la capa job');
  assert.doesNotMatch(load, /setTimeout\([^)]*90000/);
});

test('los alias viejos apuntan al estado que corresponde', () => {
  const src = readFileSync(path.join(WWW, 'js/kiu-avatar.js'), 'utf8');
  const grab = (k) => {
    const m = src.match(new RegExp(k + ":'([^']+)'"));
    return m && m[1];
  };
  assert.equal(grab('think'), 'Generando', 'think = Generando, no "Armando prompt"');
  assert.equal(grab('work'), 'Cargando', 'work = Cargando, no el engranaje de "Acción del dispositivo"');
  assert.equal(grab('search'), 'Enrutando', 'search = Enrutando, no "Indexando"');
  assert.equal(grab('create'), 'Generando', 'create = Generando, no "RAG activo"');
  assert.equal(grab('alert'), 'Acción del dispositivo', 'alert sigue siendo la acción en el teléfono');
});

test('state() devuelve el nombre real del estado del mapa, no el alias viejo', () => {
  const sb = newSandbox();
  runScript(sb, 'js/kiu-estados.js');
  runScript(sb, 'js/kiu-avatar.js');   /* el de verdad: el stub no tiene state() */
  sb.KiuState.set('job', 'Generando');
  assert.equal(sb.KiuAvatar.state(), 'Generando');
  sb.KiuState.set('rest', 'Sin modelo');
  sb.KiuState.clear('job');
  assert.equal(sb.KiuAvatar.state(), 'Sin modelo');
  assert.equal(sb.KiuAvatar.oldState(), 'idle', 'la vista vieja de 13 nombres sigue disponible');
});

test('los siete estados que nadie disparaba ahora tienen dueño', () => {
  const sb = newSb();
  /* cada estado huérfano se enciende desde una capa concreta */
  sb.KiuState.set('ruta', 'Enrutando');            assert.equal(sb.KiuState.get(), 'Enrutando');
  sb.KiuState.flash('pausa', 'Proveedor en pausa', 500);
  assert.equal(sb.KiuState.get(), 'Proveedor en pausa', 'la pausa tiene que ganarle a Enrutando para verse');
  clock(sb, 900);
  assert.equal(sb.KiuState.get(), 'Enrutando', 'y después se vuelve a Enrutando');
  sb.KiuState.clear('ruta');
  sb.KiuState.set('rest', 'Sin modelo');           assert.equal(sb.KiuState.get(), 'Sin modelo');
  sb.KiuState.set('rest', 'Usar nube/Ollama');     assert.equal(sb.KiuState.get(), 'Usar nube/Ollama');
  sb.KiuState.set('rag', 'RAG apagado');           assert.equal(sb.KiuState.get(), 'RAG apagado');
  sb.KiuState.flash('flash', 'Disparado', 400);    assert.equal(sb.KiuState.get(), 'Disparado');
  clock(sb, 900);
  sb.KiuState.flash('flash', 'Reprogramado al reiniciar', 400);
  assert.equal(sb.KiuState.get(), 'Reprogramado al reiniciar');
  unclock(sb);
});

test('regresión: "Entrada" solo se dispara desde el input del chat', () => {
  const boot = code('js/kiu-avatar-boot.js');
  assert.doesNotMatch(boot, /addEventListener\('input'/, 'ya no hay listener global de input');
  const ui = code('js/app/app-ui.js');
  const i = ui.indexOf("inp.addEventListener('input'");
  assert.ok(i > 0, 'el input del chat sí avisa "Entrada"');
  const ctx = ui.slice(ui.lastIndexOf('bindChat:', i), i);
  assert.match(ctx, /getElementById\('chat-input'\)/, 'y está atado al input del chat, no a un campo cualquiera');
});

test('el reposo no se queda viejo: reset() vuelve al estado base', () => {
  const sb = newSb();
  sb.KiuState.set('job', 'Generando');
  sb.KiuState.set('voz', 'Escuchando');
  sb.KiuState.reset('Inactivo');
  const s = sb.KiuState.snapshot();
  assert.deepEqual({ ...s.layers }, { rest: 'Inactivo' });
  assert.equal(sb.KiuState.get(), 'Inactivo');
});

test('cada cambio de estado visible avisa a los suscriptores una vez', () => {
  const sb = newSb();
  const seen = [];
  sb.KiuState.on((st) => seen.push(st));
  sb.KiuState.set('job', 'Generando');
  sb.KiuState.set('job', 'Generando');   // mismo valor: no repinta, no reavisa
  sb.KiuState.clear('job');
  assert.deepEqual(seen, ['Generando', 'Inactivo']);
});

test('una capa desconocida no rompe el avatar (typo creating, prioridad baja)', () => {
  const sb = newSb();
  sb.KiuState.set('job', 'Generando');
  sb.KiuState.set('typoDeCapa', 'Indexando');
  assert.equal(sb.KiuState.get(), 'Generando', 'una capa desconocida no tapa lo que está pasando');
  sb.KiuState.clear('typoDeCapa');
  assert.equal(sb.KiuState.get(), 'Generando');
});

test('sin KiuAvatar el controlador no revienta (carga de tests / WebView temprano)', () => {
  const sb = newSandbox();
  runScript(sb, 'js/kiu-estados.js');
  assert.equal(sb.KiuAvatar, undefined);
  sb.KiuState.set('job', 'Generando');
  assert.equal(sb.KiuState.get(), 'Generando');
});

test('una capa con caducidad se apaga sola si el evento de fin nunca llega', () => {
  const sb = newSb();
  /* red de seguridad de 'Enrutando': una promesa colgada no puede dejar al bot
     clavado en "Enrutando" para siempre (el fallo que se veía en el campo) */
  sb.KiuState.set('ruta', 'Enrutando', 1000);
  assert.equal(sb.KiuState.get(), 'Enrutando');
  clock(sb, 1500);
  assert.equal(sb.KiuState.get(), 'Inactivo', 'cayó sola por reloj, sin depender del setTimeout');
  unclock(sb);
});

test('un evento nuevo en la misma capa cancela la caducidad anterior', () => {
  const sb = newSb();
  sb.KiuState.set('ruta', 'Enrutando', 1000);
  sb.KiuState.set('ruta', 'Enrutando', 5000);   /* el segundo intento dura más */
  clock(sb, 1500);
  assert.equal(sb.KiuState.get(), 'Enrutando', 'la caducidad del evento viejo no lo tumba');
  clock(sb, 4000);
  assert.equal(sb.KiuState.get(), 'Inactivo');
  unclock(sb);
});

test('clear() siempre cancela la caducidad (no queda un timer zombie)', () => {
  const sb = newSb();
  sb.KiuState.set('ruta', 'Enrutando', 1000);
  sb.KiuState.clear('ruta');
  assert.equal(sb.KiuState.get(), 'Inactivo');
  clock(sb, 1500);
  assert.equal(sb.KiuState.get(), 'Inactivo', 'no vuelve a caer nada');
  unclock(sb);
});
