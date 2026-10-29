/* Sellado de build (v2.9.4).
   Motivo: «la versión que se instala es 2.7» con el repo en 2.9.3. El ZIP es
   solo código y no trae las .so (están en .gitignore), el build local falla, y
   si se instala igual queda el APK viejo — sin ninguna señal. Estos tests
   fijan que el sello exista, se genere, y sobre todo que el script NO apruebe
   un APK del que no sabe nada. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const gradle = fs.readFileSync(path.join(here, '..', 'app', 'build.gradle.kts'), 'utf8');
const script = path.join(here, '..', 'scripts', 'verificar-apk.sh');
const shRaw = fs.readFileSync(script, 'utf8');
/* sin comentarios: el script explica en prosa por qué NO usar `for arg in "$@"`,
   y un assert que mira la prosa entera ve exactamente lo que prohíbe. */
const sh = shRaw.replace(/^\s*#[^\n]*$/gm, '');

function apkCon(sello, conSo = true) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kiu-apk-'));
  fs.mkdirSync(path.join(d, 'assets'), { recursive: true });
  if (sello) fs.writeFileSync(path.join(d, 'assets', 'build-stamp.json'), sello);
  if (conSo) {
    fs.mkdirSync(path.join(d, 'lib', 'arm64-v8a'), { recursive: true });
    fs.writeFileSync(path.join(d, 'lib', 'arm64-v8a', 'libkiullama.so'), 'x');
  }
  const out = path.join(d, 'prueba.apk');
  execFileSync('zip', ['-qr', out, 'assets', 'lib'], { cwd: d });
  return out;
}

function correr(args) {
  try {
    return { code: 0, out: execFileSync('bash', [script, ...args], { encoding: 'utf8' }) };
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') };
  }
}

test('el sello se genera y trae versión, código, commit y fecha', () => {
  assert.match(gradle, /val kiuBuildStamp by tasks\.registering/);
  for (const campo of ['version', 'versionCode', 'git', 'builtAt']) {
    assert.match(gradle, new RegExp('"' + campo + '"'), 'falta el campo ' + campo);
  }
  /* y se empaqueta como asset, que es lo que hace que se pueda leer con unzip
     sin Android SDK */
  assert.match(gradle, /build-stamp\.json/);
  assert.match(gradle, /assets\.srcDir\(/, 'el directorio generado tiene que ser origen de assets');
});

test('la versión se declara UNA sola vez en todo el build', () => {
  /* Dos lugares donde poner un número = aparece el que se queda viejo. Y el
     lugar que se queda viejo es el sello, que es justamente el que dice qué APK
     estás instalando: mentiría con autoridad. */
  const decl = gradle.match(/val kiuVersionName\s*=/g) || [];
  assert.equal(decl.length, 1, 'kiuVersionName tiene que declararse una sola vez');
  assert.equal((gradle.match(/val kiuVersionCode\s*=/g) || []).length, 1, 'kiuVersionCode una sola vez');
  assert.match(gradle, /versionName = kiuVersionName/, 'defaultConfig usa la val');
  assert.doesNotMatch(gradle, /versionName = "/, 'y no una cadena literal aparte');
});

test('el script lee la versión del APK y dice cuál es', () => {
  const r = correr([apkCon('{"version":"2.9.4","versionCode":42,"git":"abc1234","builtAt":"2026-10-16T20:00:00Z","builtHere":"local"}')]);
  assert.equal(r.code, 0);
  assert.match(r.out, /2\.9\.4/);
  assert.match(r.out, /42/);
  assert.match(r.out, /abc1234/);
});

test('detecta el APK viejo: el caso exacto del reporte', () => {
  const r = correr([apkCon('{"version":"2.7","versionCode":39,"git":"x","builtAt":"y","builtHere":"local"}'), '--esperar', '2.9.4']);
  assert.equal(r.code, 1, 'tiene que fallar, no avisar y salir con éxito');
  assert.match(r.out, /2\.7/);
  assert.match(r.out, /Esperabas 2\.9\.4/);
});

test('sin sello NO aprueba: no poder confirmar no es lo mismo que estar bien', () => {
  /* El fallo más grave que podía tener este script: sin sello no sabe nada del
     APK, y si igual sale con 0 convence de que el APK es correcto. Con
     --esperar tiene que fallar. */
  const r = correr([apkCon(null), '--esperar', '2.9.4']);
  assert.equal(r.code, 1, 'sin sello + --esperar tiene que fallar');
  assert.match(r.out, /No puedo confirmar/);
});

test('avisa si al APK no le faltan las .so del motor', () => {
  const r = correr([apkCon('{"version":"2.9.4","versionCode":42,"git":"a","builtAt":"b","builtHere":"local"}', false)]);
  assert.match(r.out, /SIN librerías nativas/);
  assert.match(r.out, /no puede generar/);
});

test('el parseo de argumentos no confunde --esperar con el APK', () => {
  /* Este bug existió de verdad: con `for arg in "$@"` la lista se congela al
     empezar, el shift no surte efecto y el valor de --esperar se tomaba como
     nombre de archivo. El script "-funcionaba" y pedía un archivo que no era. */
  assert.match(sh, /while \[ \$# -gt 0 \]/, 'tiene que parsear con while+shift, no con for');
  assert.doesNotMatch(sh, /for arg in "\$@"/);
  const r = correr(['/no/existe.apk', '--esperar', '2.9.4']);
  assert.match(r.out, /No existe/, 'el error tiene que ser del archivo, no de --esperar');
});

test('argumentalitos inválidos fallan con código de error, no con 0', () => {
  assert.equal(correr(['--esperar']).code, 2, '--esperar sin valor');
  assert.equal(correr(['a.apk', 'b.apk']).code, 2, 'dos archivos');
  assert.equal(correr(['/no/existe.apk']).code, 2, 'archivo inexistente');
  assert.equal(correr([]).code, 2, 'sin argumentos');
});

/* ---- los dos gotchas de Kotlin DSL que rompieron el CI (v2.9.8) ----
   Esto se verificó con kotlinc: en un `.kt` normal `java.time.Instant` compila
   bien y el `mapOf` sin tipo también. Los dos errores solo pasan en un
   `.gradle.kts`, donde `java` es la extensión de Gradle. Por eso el guard es
   estructural sobre el archivo real, y no un harness que dé la impresión de
   reproducir el fallo sin reproducirlo. */

test('el sello de build compila en Kotlin DSL', () => {
  const g = fs.readFileSync(path.join(here, '..', 'app', 'build.gradle.kts'), 'utf8');
  /* 1 · `java` dentro de un .gradle.kts es la EXTENSIÓN de Gradle, no el paquete.
     Sin el import explícito, java.time.Instant no resuelve y el build entero
     muere en la línea 167. */
  assert.match(g, /^import java\.time\.Instant$/m,
    'falta el import explícito de Instant: sin él, java.time no resuelve');
  /* el código sin comentarios Y sin imports: el import tiene que seguir ahí, pero
     no es «uso en línea» de java.time — es justamente lo que lo arregla. */
  const codigo = g
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^import .*$/gm, '');
  assert.doesNotMatch(codigo, /[^.\w]java\.time\./,
    'no hay que usar java.time. en línea: se escribe Instant a secas, con el import');
  /* 2 · mapOf con valores de tipos distintos (Int, String, String?) hace que Kotlin
     infiera el común más arriba y el Pair deje de casar con lo que espera el
     joinToString. El tipo tiene que estar declarado. */
  assert.match(codigo, /val stamp: Map<String, String> = mapOf\(/,
    'el mapa del sello tiene que declarar Map<String, String> explícito');
  assert.match(codigo, /kiuVersionCode\.toString\(\)/,
    'y el versionCode tiene que convertirse a texto: un Int en el mapa rompe la inferencia');
});

test('el harness de Kotlin dice de frente qué verifica y qué no', () => {
  /* Un test que aparenta cubrir un bug que en realidad no cubre es peor que
     ninguno: da confianza falsa sobre lo único que no se está comprobando. */
  const k = fs.readFileSync(path.join(here, 'kotlin', 'SelloBuildCheck.kt'), 'utf8');
  assert.match(k, /LIMITACIÓN/, 'tiene que declarar la limitación');
  assert.match(k, /NO reproduce los dos errores/);
  assert.match(k, /extension|extensión/,
    'y decir por qué no puede reproducirlos: el bug es del .gradle.kts');
});
