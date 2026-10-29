/* version-coherente.test.mjs — la versión no se puede "olvidar" subir.
 * Dos veces una tanda salió sin tocar versionName/versionCode y el APK nuevo parecía el viejo
 * (Android y el actualizador de la app lo tratan como la misma versión). Este test hace que
 * subir cambios sin subir la versión deje el CI en rojo.
 * node --test tests/version-coherente.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const raiz = process.cwd();
const leer = (f) => fs.readFileSync(path.join(raiz, f), 'utf8');
const gradle = leer('app/build.gradle.kts');
const nombre = gradle.match(/val kiuVersionName = "([^"]+)"/)[1];
const codigo = Number(gradle.match(/val kiuVersionCode = (\d+)/)[1]);

test('el CHANGELOG abre con la versión que tiene el build', () => {
  const m = leer('CHANGELOG.md').match(/^## \[(\d+\.\d+\.\d+)\]/m);
  assert.ok(m, 'el CHANGELOG tiene que empezar con una versión numerada ("## [2.x.y]"), no "Sin publicar"');
  assert.equal(m[1], nombre, 'CHANGELOG dice ' + m[1] + ' pero app/build.gradle.kts dice ' + nombre);
});

test('el README nombra la misma versión', () => {
  assert.match(leer('README.md').split('\n')[2], new RegExp('Kiu ' + nombre.replace(/\./g, '\\.') + ' '),
    'la línea de versión del README quedó vieja');
});

test('versionCode y versionName avanzan juntos (piso: 2.19.2 = 104)', () => {
  const [a, b, c] = nombre.split('.').map(Number);
  const piso = a * 10000 + b * 100 + c;
  assert.ok(piso >= 21902, 'la versión no puede retroceder de 2.19.2');
  assert.ok(codigo >= 104, 'el versionCode no puede bajar de 104: ' + codigo);
});

test('la versión instalada se muestra en la pantalla de Modelos', () => {
  assert.match(leer('app/src/main/assets/www/index.html'), /id="mdl-agent-ver"/);
  assert.match(leer('app/src/main/assets/www/js/app/app-ui.js'), /Kiu instalada: /);
});
