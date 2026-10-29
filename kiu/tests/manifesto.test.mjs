/* El manifiesto tiene que ser XML de verdad (v2.9.9).
   --------------------------------------------------------------
   Existence justificada: al sacar `android:extractNativeLibs` (que AGP marca como
   «tiene que estar en el archivo de build») dejé el comentario explicativo
   ADENTRO del start-tag de `<application>`, entre los atributos. En XML un
   comentario no puede ir ahí, y el manifiesto entero deja de parsear. El aviso
   igual llegó tarde: el warning de extractNativeLibs —el que originó el cambio—
   estaba en la línea 52 del log del CI, y yo estaba mirando la 1800. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const RUTA = path.join(here, '..', 'app', 'src', 'main', 'AndroidManifest.xml');
const xml = fs.readFileSync(RUTA, 'utf8');

/* Parser de XML mínimo: no alcanza con contar tags, hay que obeyedecer la regla de
   que un comentario no puede ir adentro de un tag. Eso es justo lo que falló. */
function errorDeXml(s) {
  let i = 0, n = s.length, linea = 1, col = 1;
  let dentroDeTag = false;
  const avanzar = () => { if (s[i] === '\n') { linea++; col = 1; } else { col++; } i++; };
  while (i < n) {
    if (s[i] === '<' && s.startsWith('<!--', i)) {
      if (dentroDeTag) {
        return 'comentario adentro de un tag (línea ' + linea + ', col ' + col + '): en XML no se puede';
      }
      const fin = s.indexOf('-->', i);
      if (fin < 0) return 'comentario sin cerrar (línea ' + linea + ')';
      for (; i < fin + 3; avanzar());
      continue;
    }
    if (s[i] === '<') { dentroDeTag = true; avanzar(); continue; }
    if (s[i] === '>') { dentroDeTag = false; avanzar(); continue; }
    if (s[i] === '"') {
      const cierre = s.indexOf('"', i + 1);
      if (cierre < 0) return 'comilla sin cerrar (línea ' + linea + ')';
      for (; i < cierre + 1; avanzar());
      continue;
    }
    avanzar();
  }
  return null;
}

test('el manifiesto es XML bien formado', () => {
  assert.equal(errorDeXml(xml), null, 'el manifiesto no parsea: ' + errorDeXml(xml));
});

test('el parser detecta los dos fallos que importan', () => {
  /* Un validador que nunca falla no valida. Estos dos casos son los que aparecen:
     el comentario en el lugar equivocado y el atributo sin cerrar. */
  assert.match(errorDeXml('<a>\n  <b\n  <!-- x -->\n  c="1"/>\n</a>') || '', /comentario adentro/,
    'tiene que detectar el comentario dentro del tag');
  assert.match(errorDeXml('<a c="roto\n/>\n') || '', /comilla sin cerrar/,
    'tiene que detectar la comilla sin cerrar');
  assert.equal(errorDeXml('<a c="1"><!-- ok --><b/></a>'), null, 'un XML sano tiene que dar null');
});

test('extractNativeLibs está en el build, no en el manifiesto', () => {
  /* El warning que originó todo esto. */
  assert.doesNotMatch(xml, /android:extractNativeLibs=/,
    'no puede estar en el manifiesto: AGP avisa que va en el archivo de build');
  const g = fs.readFileSync(path.join(here, '..', 'app', 'build.gradle.kts'), 'utf8');
  assert.match(g, /jniLibs\.useLegacyPackaging\s*=\s*true/,
    'y tiene que estar en el build, o el modelo deja de cargarse descomprimido');
});
