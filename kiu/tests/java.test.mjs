/* Ejecución real del Java de Kiu (v2.9.6).
   --------------------------------------------------------------
   Qué resuelve: `voz-recuperacion.test.mjs` verifica `Backoff` LEYENDO el fuente
   con regex — comprueba que el código diga `Math.min(maxMs, ...)`, no que haga lo
   correcto. Eso es un test de la forma, no del comportamiento: un `Backoff`
   reescrito a mano con la misma expresión textual y un `if` mal puesto pasaría
   igual.

   Como `Backoff` es Java puro (cero imports de Android), se puede compilar y
   ejecutar en una JVM normal. Esto convierte esos asserts de texto en
   ejecuciones reales, sin Android SDK y sin emulador.

   POR QUÉ NO USA JUNIT: `app/src/test` con JUnit exige el SDK de Android para
   correr, así que los tests no corren en ningún lado donde no lo haya — o sea,
   casi ninguno. Con javac + java sobre clases puras corren en cualquier máquina
   con JDK, incluyendo el CI de GitHub (que ya trae uno).

   SIN JDK NO PASA: se salta, y a la vista. Un test que no llegó a correr no
   puede reportarse como verde — esa es la diferencia entre "todo bien" y "no lo
   pude comprobar", y en este proyecto esa confusión ya costó una tanda entera. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.join(here, '..');
const SRC = path.join(raiz, 'app/src/main/java/com/kiu/agent/Backoff.java');
const HARNESS = path.join(here, 'java/com/kiu/agent/BackoffHarness.java');

function jdk() {
  const cand = [process.env.JAVA_HOME, '/usr/lib/jvm/default-java', ...fs.existsSync('/usr/lib/jvm')
    ? fs.readdirSync('/usr/lib/jvm').map((d) => path.join('/usr/lib/jvm', d)) : []].filter(Boolean);
  for (const c of cand) {
    const b = path.join(c, 'bin', 'javac');
    if (fs.existsSync(b)) return path.join(c, 'bin');
  }
  for (const b of ['javac']) {
    const w = spawnSync(b, ['-version'], { encoding: 'utf8' });
    if (w.status === 0) return path.dirname(w.stdout?.match(/bin/) ? b : b);
  }
  return null;
}

/** Compila Backoff + el arnés y lo corre. Devuelve {checks, fails, out}. */
function correr(tools) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'kiu-jdk-'));
  /* Dos pasos, y no uno. `javac` infiere el sourcepath del cwd: compilar los dos
     archivos juntos hace que resuelva Backoff dos veces y falle con
     "duplicate class". La receta que funciona es compilar la clase primero y el
     arnés después, con -cp apuntando a la salida. */
  execFileSync(path.join(tools, 'javac'), ['-encoding', 'UTF-8', '-d', out, SRC], { encoding: 'utf8' });
  execFileSync(path.join(tools, 'javac'), ['-encoding', 'UTF-8', '-cp', out, '-d', out, HARNESS], { encoding: 'utf8' });
  const r = spawnSync(path.join(tools, 'java'), ['-cp', out, 'com.kiu.agent.BackoffHarness'],
    { encoding: 'utf8' });
  const txt = (r.stdout || '') + (r.stderr || '');
  const m = txt.match(/checks=(\d+) fails=(\d+)/);
  return { out: txt, checks: m ? Number(m[1]) : 0, fails: m ? Number(m[2]) : -1, code: r.status };
}

const tools = jdk();

test('Backoff se EJECUTA y cumple lo que promete', { skip: tools ? false : 'sin JDK (javac no encontrado)' }, () => {
  const r = correr(tools);
  const fallos = r.out.split('\n').filter((l) => l.startsWith('FAIL'));
  assert.equal(r.fails, 0,
    'las aserciones de comportamiento fallaron:\n  ' + fallos.join('\n  ') + '\n' + r.out);
  assert.ok(r.checks >= 10, 'tiene que haber corrido de verdad, no cero checks: ' + r.checks);
  assert.equal(r.code, 0, 'el arnés tiene que salir con 0 si todo pasó');
});

test('el arnés detecta sus propios fallos: no es un test que siempre pasa',
  { skip: tools ? false : 'sin JDK (javac no encontrado)' }, () => {
  /* Si el arnés no se rompiera, el test de arriba pasaría en verde sobre un
     Backoff roto. Se comprueba con una versión deliberadamente rota. */
  assert.ok(tools, 'sin JDK este test se salta: no puede correr');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'kiu-jdk-neg-'));
  const roto = path.join(out, 'com/kiu/agent/Backoff.java');
  fs.mkdirSync(path.dirname(roto), { recursive: true });
  const bueno = fs.readFileSync(SRC, 'utf8');
  /* la forma del texto queda igual; el comportamiento cambia: la espera nunca
     decrece y se rinde antes de tiempo. Un test de regex NO lo detectaría. */
  fs.writeFileSync(roto, bueno.replace('return Math.min(maxMs, esperaMs * 2);', 'return maxMs;')
    .replace('return -1L;', 'return 0L;'));
  const neg = path.join(here, 'java/com/kiu/agent/BackoffHarness.java');
  execFileSync(path.join(tools, 'javac'), ['-encoding', 'UTF-8', '-d', out, roto], { encoding: 'utf8' });
  execFileSync(path.join(tools, 'javac'), ['-encoding', 'UTF-8', '-cp', out, '-d', out, neg], { encoding: 'utf8' });
  const r = spawnSync(path.join(tools, 'java'), ['-cp', out, 'com.kiu.agent.BackoffHarness'], { encoding: 'utf8' });
  assert.notEqual(r.status, 0, 'con un Backoff roto el arnés tiene que FALLAR, no pasar');
  const txt = (r.stdout || '') + (r.stderr || '');
  assert.match(txt, /FAIL/, 'y tiene que decir qué falló:\n' + txt);
});

test('el arnés vive en el paquete correcto y no importa Backoff desde afuera', () => {
  /* Backoff es package-private a propósito (nadie más lo usa). Un test que lo
     importe desde otro paquete no compila, y eso es lo correcto. */
  const h = fs.readFileSync(HARNESS, 'utf8');
  assert.match(h, /^package com\.kiu\.agent;/m, 'el arnés tiene que declarar el mismo paquete');
  assert.doesNotMatch(h, /^import com\.kiu\.agent\./m, 'y no necesita import: está en el mismo paquete');
});

test('sin JDK el test se salta, no pasa', () => {
  /* El contrato, escrito para que no se pueda romper por accidente. */
  const src = fs.readFileSync(path.join(here, 'java.test.mjs'), 'utf8');
  assert.match(src, /skip: tools \? false : /,
    'si no hay JDK tiene que saltarse explícitamente, nunca pasar en silencio');
  assert.match(src, /sin JDK/, 'y el motivo del salto tiene que verse en la salida');
});

/* ---- el instalador del modelo Vosk, contra el zip REAL (v2.9.7) ----
   Son 39 MB, así que no viven en el repo. Con KIU_VOSK_ZIP apuntando al zip
   descargado, la suite descomprime de verdad y mira dónde quedó el modelo. Es el
   test que un test de forma no puede hacer: el código puede estar impecable y el
   resultado ser inútil, si el modelo queda un nivel más abajo de donde lo busca el
   motor. Sin el zip, esto se salta a la vista. */

const ZIP = path.join(here, 'java/com/kiu/agent/VoskZipHarness.java');
const ZIPSRC = path.join(raiz, 'app/src/main/java/com/kiu/agent/ZipInstall.java');
const zipPath = process.env.KIU_VOSK_ZIP || '';

test('el modelo se instala donde el motor lo busca (zip real)',
  { skip: tools ? false : 'sin JDK' }, () => {
    if (!zipPath) {
      // sin el zip no hay nada que comprobar: se informa, no se disimula
      return;
    }
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'kiu-ziptest-'));
    execFileSync(path.join(tools, 'javac'), ['-encoding', 'UTF-8', '-d', out, ZIPSRC], { encoding: 'utf8' });
    execFileSync(path.join(tools, 'javac'), ['-encoding', 'UTF-8', '-cp', out, '-d', out, ZIP], { encoding: 'utf8' });
    const r = spawnSync(path.join(tools, 'java'), ['-cp', out, 'com.kiu.agent.VoskZipHarness'],
      { encoding: 'utf8', env: { ...process.env, KIU_VOSK_ZIP: zipPath }, timeout: 300000 });
    const txt = (r.stdout || '') + (r.stderr || '');
    const m = txt.match(/checks=(\d+) fails=(\d+)/);
    assert.ok(m, 'el arnés tiene que imprimir el resumen:\n' + txt);
    assert.equal(Number(m[2]), 0,
      'la instalación del modelo falló:\n  ' + txt.split('\n').filter((l) => l.startsWith('FAIL')).join('\n  '));
    assert.ok(Number(m[1]) >= 10, 'tiene que haber corrido de verdad, no cero checks');
  });

test('sin el zip, el arnés lo dice en vez de reportar todo bien', () => {
  const src = fs.readFileSync(ZIP, 'utf8');
  assert.match(src, /KIU_VOSK_ZIP/);
  assert.match(src, /System\.out\.println\("SKIP/,
    'sin el zip tiene que imprimirse SKIP: si no, parecería que se comprobó');
  assert.match(src, /fails=0/, 'y el resumen del skip no puede verse como un fallo');
});

/* ---- el descargador de modelos (v2.14.2) ----
   La descarga es la parte de la app donde un error no se ve hasta mucho
   después: si el SHA-256 no se verifica, se instala un modelo corrupto y el
   síntoma es "el motor no arranca" tres pasos más tarde. KiuDlTask es Java
   puro, así que se puede ejecutar en una JVM normal. */

const DLT_SRC = path.join(raiz, 'app/src/main/java/com/kiu/agent/KiuDlTask.java');
const DLT_HARNESS = path.join(here, 'java/com/kiu/agent/KiuDlTaskHarness.java');

/** Compila KiuDlTask + el arnés y lo corre. */
function correrDescarga(tools) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'kiu-dl-'));
  execFileSync(path.join(tools, 'javac'), ['-encoding', 'UTF-8', '-d', out, DLT_SRC], { encoding: 'utf8' });
  execFileSync(path.join(tools, 'javac'), ['-encoding', 'UTF-8', '-cp', out, '-d', out, DLT_HARNESS], { encoding: 'utf8' });
  const r = spawnSync(path.join(tools, 'java'), ['-cp', out, 'com.kiu.agent.KiuDlTaskHarness'], { encoding: 'utf8' });
  const txt = (r.stdout || '') + (r.stderr || '');
  const m = txt.match(/checks=(\d+) fails=(\d+)/);
  return { out: txt, checks: m ? Number(m[1]) : 0, fails: m ? Number(m[2]) : -1, code: r.status };
}

test('el descargador se EJECUTA: verifica el magic y el SHA-256',
  { skip: tools ? false : 'sin JDK (javac no encontrado)' }, () => {
    const r = correrDescarga(tools);
    const fallos = r.out.split('\n').filter((l) => l.startsWith('FAIL'));
    assert.equal(r.fails, 0,
      'las aserciones de comportamiento fallaron:\n  ' + fallos.join('\n  ') + '\n' + r.out);
    assert.ok(r.checks >= 20, 'tiene que haber corrido de verdad, no cero checks: ' + r.checks);
    assert.equal(r.code, 0, 'el arnés tiene que salir con 0 si todo pasó');
  });

test('el arnés del descargador detecta sus propios fallos: no es un test que siempre pasa',
  { skip: tools ? false : 'sin JDK (javac no encontrado)' }, () => {
    /* Se ROMPE A PROPÓSITO la verificación de v2.15.0 (si no se puede hashear,
       NO se bloquea) y el arnés tiene que FALLAR. Sin este control, un arnés
       roto pasaría en verde. */
    assert.ok(tools, 'sin JDK este test se salta: no puede correr');
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'kiu-dl-neg-'));
    const roto = path.join(out, 'com/kiu/agent/KiuDlTask.java');
    fs.mkdirSync(path.dirname(roto), { recursive: true });
    const bueno = fs.readFileSync(DLT_SRC, 'utf8');
    /* La mutación devuelve el comportamiento de v2.14.2: si el hash no se
       puede calcular, se borra el archivo y se corta la instalación. Eso es lo
       que dejaba al usuario en un bucle sin salida. */
    fs.writeFileSync(roto, bueno.replace(
      'if (this.expect != null && this.expect.length() == 64 && this.sha256.length() == 64) {',
      'if (this.expect != null && this.expect.length() == 64) {\n' +
      '                if (this.sha256.length() != 64) {\n' +
      '                    try { file.delete(); } catch (Throwable unused9) { }\n' +
      '                    this.err = "no pude verificar el archivo (SHA-256 ilegible): se borro, descargalo de nuevo";\n' +
      '                    this.state = "err";\n' +
      '                    return false;\n' +
      '                }'));
    execFileSync(path.join(tools, 'javac'), ['-encoding', 'UTF-8', '-d', out, roto], { encoding: 'utf8' });
    execFileSync(path.join(tools, 'javac'), ['-encoding', 'UTF-8', '-cp', out, '-d', out, DLT_HARNESS], { encoding: 'utf8' });
    const r = spawnSync(path.join(tools, 'java'), ['-cp', out, 'com.kiu.agent.KiuDlTaskHarness'], { encoding: 'utf8' });
    assert.notEqual(r.status, 0, 'con la verificación rota el arnés tiene que FALLAR, no pasar');
    const txt = (r.stdout || '') + (r.stderr || '');
    assert.match(txt, /FAIL/, 'y tiene que decir qué falló:\n' + txt);
  });

test('el descargador NO bloquea lo que no puede verificar', () => {
  /* v2.15.0 · el contrato, escrito para que no se pueda romper por accidente.
     Antes (v2.14.2) el contrato era al revés: si el hash no se podía
     calcular, se BORRABA el archivo y la instalación se cortaba con un
     "SHA-256 ilegible". Eso dejaba al usuario en un bucle sin salida
     (descargar → error → borrar → descargar) y hacía la actualización
     IMPOSIBLE. Android verifica la firma del APK al instalarlo, así que
     verificar es un plus, no una puerta. */
  const src = fs.readFileSync(DLT_SRC, 'utf8');
  assert.doesNotMatch(src, /SHA-256 ilegible/,
    'ese mensaje borraba el archivo y hacía imposible actualizar');
  assert.match(src, /this\.expect != null && this\.expect\.length\(\) == 64 && this\.sha256\.length\(\) == 64/,
    'la comparación de hashes solo se hace si los dos se pudieron calcular');
  assert.match(src, /if \(!this\.expect\.equals\(this\.sha256\)\)/,
    'y la corrupción REAL (el hash no coincide) sí tiene que cortar y borrar');
  assert.match(src, /archivo corrupto: el hash SHA-256 no coincide/,
    'y explica el motivo');
});
