/* Recuperación de voz (v2.9.5).
   --------------------------------------------------------------
   Tres bugs reales encontrados auditando la capa Java, que hasta ahora NO
   tenía ni un test (no existía app/src/test). Los tres se manifestan igual
   desde afuera: "el audio no funciona".

   ACLARACIÓN HONESTA: esto NO compila Java. El sandbox donde se escribió no
   tiene JDK (`javac` no está instalado). Estos tests verifican ESTRUCTURA por
   análisis del fuente —que exista la recuperación, que el error se limpie, que
   el reintento exista— y son reales en el sentido de que fallan si alguien
   revierte el arreglo, pero no sustituyen a compilar y probar en el teléfono.
   Para eso queda pendiente montar app/src/test con JUnit. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const J = (n) => path.join(here, '..', 'app', 'src', 'main', 'java', 'com', 'kiu', 'agent', n);
const ww = fs.readFileSync(J('WakeWordEngine.java'), 'utf8');
const main = fs.readFileSync(J('MainActivity.java'), 'utf8');
const backoff = fs.readFileSync(J('Backoff.java'), 'utf8');

/* sin comentarios: el código explica en prosa por qué hace cada cosa, y un
   assert sobre la prosa encuentra exactamente lo que el assert quería prohibir. */
const cod = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const cuerpo = (s, desde, hasta) => {
  const i = s.indexOf(desde);
  if (i < 0) throw new Error('no encontre el inicio: ' + desde);
  const j = hasta ? s.indexOf(hasta, i) : s.length;
  return s.slice(i, j > 0 ? j : s.length);
};
const wwC = cod(ww), mainC = cod(main), boC = cod(backoff);

/* ------------------------------------------------------------------ */

test('BUG 1 · un AudioRecord muerto se RECONSTRUYE, no se sigue leyendo', () => {
  /* El bug: read() devolvía error y el código hacía continue sobre el MISMO
     AudioRecord. En Android uno en estado de error no se recupera: hay que
     liberar y crear otro. El síntoma era "atendí un teléfono, corté, y la
     palabra de activación no volvió nunca más". */
  const loop = cuerpo(wwC, 'private int escucharUnaVez');
  assert.match(loop, /LECHO_MIC_MUERTO/,
    'un error de micro tiene que romper el read-loop para que lo de afuera lo reconstruya');

  const run = cuerpo(wwC, 'private void run(');
  assert.match(run, /escucharUnaVes|escucharUnaVez/, 'y el loop de afuera tiene que llamarlo');
  assert.match(run, /espera\.siguiente\(\)/, 'esperando con backoff antes de reintentar');
  /* si se rinden, TIENEN que decirlo, no quedarse mudos */
  assert.match(run, /if \(d < 0\)[\s\S]{0,300}?running\.set\(false\)/,
    'agotados los intentos tiene que dejar de fingir que escucha');
});

test('BUG 2 · el error se limpia cuando el micrófono vuelve, y se dice por qué se fue', () => {
  /* El bug: err solo se limpiaba en start(). Un fallo transitorio dejaba
     "micrófono ocupado" puesto para toda la sesión, aunque después anduviera
     perfecto — el mensaje mentía sobre el estado real. */
  const mic = cuerpo(wwC, 'private int escucharUnaVez');
  const abre = mic.indexOf('err = "";');
  assert.ok(abre > -1, 'tiene que limpiar el error al abrir el micrófono de verdad');
  assert.ok(abre > mic.indexOf('startRecording()'),
    'y DESPUÉS de arrancar la grabación: limpiar antes sería mentir igual, pero al revés');

  /* y cuando el micro muere tiene que decir POR QUÉ. Si se rinde sin explicar
     nada, el usuario ve que Kiu dejó de responder y no tiene un solo dato para
     seguir: es el mismo silencio del bug 3, del lado del micrófono. */
  const rama = mic.slice(mic.indexOf('if (n <= 0)'), mic.indexOf('if (n <= 0)') + 700);
  assert.match(rama, /ERROR_DEAD_OBJECT/, 'tiene que reconocer el caso de micro tomado');
  assert.match(rama, /err = "[^"]+"/, 'y dejar escrito el motivo antes de rendirse');
  assert.match(rama, /return LECHO_MIC_MUERTO;/, 'y salir del read-loop para que lo rearmen');
});

test('el backoff se resetea al ABRIR el micrófono, no al terminar la sesión', () => {
  /* Este bug me lo metí yo al escribir el arreglo, y lo encontró el test de que
     el estado que lo colgaba no estuviera muerto. Estaba el reset en el loop de
     arriba, dependiendo de un LECHO_OK que nadie devolvía: el backoff nunca se
     reiniciaba y, tras 8 micro-fallos repartidos en una sesión, Kiu se rendía
     para siempre. El presupuesto de reintentos es POR MICROFONO. */
  const mic = cuerpo(wwC, 'private int escucharUnaVez');
  const abre = mic.indexOf('espera.reset()');
  assert.ok(abre > -1, 'el backoff se resetea al abrir el micrófono');
  assert.ok(abre > mic.indexOf('startRecording()'), 'y después de arrancar de verdad, no antes');
  assert.doesNotMatch(wwC, /LECHO_OK/, 'no puede quedar un estado que nadie devuelve');
  assert.doesNotMatch(cuerpo(wwC, 'private void run('), /LECHO_OK/, 'ni una rama que dependa de él');
});

test('BUG 3 · el TTS reintenta y, si no puede, lo dice', () => {
  /* El bug: initTts() se llamaba UNA vez en onCreate. Si el motor no estaba
     listo en ese instante, ttsReady quedaba false para toda la vida de la app,
     speak() hacía return en la primera línea, y no había ni toast ni error.
     "Kiu está pensando" y "Kiu no tiene voz" se veían igual. */
  const init = cuerpo(mainC, 'private void initTts(');
  assert.match(init, /doInitTts\(\)/, 'initTts tiene que delegar a un intento');
  assert.match(init, /new Backoff\(/, 'y arrancar con una política de reintentos');

  const reintento = cuerpo(mainC, 'private void retryTts(');
  assert.match(reintento, /siguiente\(\)/, 'tiene que pedir la espera al backoff');
  assert.match(reintento, /postDelayed\(/, 'y programar el reintento, no reintentar en boucle');
  assert.match(reintento, /if \(d < 0\)[\s\S]{0,300}?nexoVoiceError/,
    'agotados los intentos tiene que AVISAR: un fallo que no se anuncia no se puede arreglar');

  const intento = cuerpo(mainC, 'private void doInitTts(');
  assert.match(intento, /shutdown\(\)/, 'cada reintento tiene que cerrar el motor anterior');
});

test('Backoff: crece, tiene tope, y rendirse es explícito', () => {
  /* Estas reglas son la política de reintentos de TODO el audio de la app. Que
     vivan en una clase sin dependencias de Android es lo que permite razonarlas;
     que tengan un test escrito es lo que las fija. */
  assert.match(boC, /if \(intentos >= maxIntentos\) \{\s*return -1L;/,
    'agotados los intentos devuelve -1: rendirse es explícito, no un 0 ambiguo');
  assert.match(boC, /Math\.min\(maxMs, esperaMs \* 2\)/, 'la espera dobla con techo');
  assert.match(boC, /Math\.max\(1L, baseMs\)/,
    'y nunca puede ser 0 ni negativo: un 0 es un reintento instantáneo');
  assert.match(boC, /void reset\(\)/, 'reset() vuelve al primer intento');
  assert.match(boC, /boolean quedan\(\)/, 'y quedan() permite preguntar sin consumir uno');
});

test('Backoff no depende de Android: por eso se puede razonar y testear', () => {
  const imports = (backoff.match(/^import /gm) || []);
  assert.equal(imports.length, 0,
    'si Backoff importa algo de Android deja de ser testeable fuera de un teléfono: ' + imports.join(', '));
});

test('cada loop de audio tiene SU backoff, no uno compartido', () => {
  /* Un backoff compartido haría que un fallo del micro gastara los reintentos
     del TTS (y al revés). Son independientes. */
  assert.match(mainC, /private Backoff ttsBackoff;/);
  assert.match(wwC, /Backoff espera = new Backoff\(MIC_RETRY_BASE_MS/);
  assert.doesNotMatch(mainC, /new Backoff\(\s*MIC_RETRY/,
    'el TTS no puede arrancar con el presupuesto de reintentos del micrófono');
});
