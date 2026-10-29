/* Estructura del Java (v2.9.5).
   --------------------------------------------------------------
   El sandbox donde se escribe esto no tiene JDK, así que no se puede compilar
   la capa Java. No es la misma cosa que no poder mirarla: el error de sintaxis
   más común al editar a mano —una llave o un paréntesis que no cierra— se
   detecta con un escáner de una pasada, y ese fallo sí rompe el build entero
   sin avisar.

   El escáner es de una sola pasada y maneja comentarios, cadenas y literales de
   carácter EN EL ORDEN CORRECTO. Eso importa y no es un detalle: un checker
   ingenuo que quita comentarios después de las comillas se come el código
   entero cuando encuentra un apóstrofe en un comentario ("don't"), y reporta un
   balance que no existe. Le pasó a este mismo archivo durante la tanda: daba
   -1 en MainActivity.java, que estaba perfectamente bien. Un checker que
   miente es peor que no tener ninguno. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const JAVA = path.join(here, '..', 'app', 'src', 'main', 'java', 'com', 'kiu', 'agent');

export function escanearJava(src) {
  let i = 0, linea = 1;
  const pila = [];
  const pares = { '}': '{', ')': '(', ']': '[' };
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '\n') { linea++; i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i + 1 < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') linea++; i++; }
      i += 2; continue;
    }
    if (c === '"' || c === "'") {
      const q = c; i++;
      while (i < n && src[i] !== q) {
        if (src[i] === '\\') i++;
        if (i < n && src[i] === '\n') linea++;
        i++;
      }
      i++; continue;
    }
    if (c === '{' || c === '(' || c === '[') { pila.push([c, linea]); i++; continue; }
    if (c === '}' || c === ')' || c === ']') {
      if (!pila.length || pila[pila.length - 1][0] !== pares[c]) {
        return `cierre sobrante: ${c} en la línea ${linea}`;
      }
      pila.pop(); i++; continue;
    }
    i++;
  }
  if (pila.length) {
    const [c, l] = pila[pila.length - 1];
    return `sin cerrar: ${c} abierto en la línea ${l} (faltan ${pila.length} en total)`;
  }
  return null;
}

const java = fs.readdirSync(JAVA).filter((f) => f.endsWith('.java'));

test('todos los .java están balanceados', () => {
  assert.ok(java.length > 0, 'no se encontró ningún .java: el recorrido está mal');
  const malos = [];
  for (const f of java) {
    const err = escanearJava(fs.readFileSync(path.join(JAVA, f), 'utf8'));
    if (err) malos.push(`${f}: ${err}`);
  }
  assert.equal(malos.length, 0, 'Java desbalanceado (esto rompe el build entero):\n  ' + malos.join('\n  '));
});

test('el escáner detecta lo que tiene que detectar', () => {
  /* Si el escáner no se rompe, el test de arriba pasa en verde sobre un archivo
     roto, que es peor que no mirarlo. */
  assert.equal(escanearJava('class A { void f() { } }'), null, 'sano tiene que dar null');
  assert.match(escanearJava('class A { void f() { '), /sin cerrar/);
  assert.match(escanearJava('class A { } }'), /cierre sobrante/);
  assert.match(escanearJava('f(];'), /cierre sobrante/);
  /* las llaves dentro de cadenas y comentarios NO cuentan */
  assert.equal(escanearJava('String s = "{{{"; // {{{\n'), null, 'llaves en cadena y comentario');
  assert.equal(escanearJava('char c = \'{\';'), null, 'llave como literal de carácter');
  assert.equal(escanearJava('/* { } */ int x = 1;'), null, 'llaves en comentario de bloque');
  assert.equal(escanearJava('String s = "escaped \\" }";'), null, 'comilla escapada');
  /* el caso que hizo mentir al checker ingenuo: un apóstrofe en un comentario
     no puede abrir una cadena y comerse el resto del archivo */
  assert.equal(escanearJava('// don\'t worry\nclass A { int f() { return 1; } }'), null,
    'un apostrofe en un comentario no puede romper el escaneo');
});

test('los archivos que toqué en esta tanda están todos y balanceados', () => {
  for (const f of ['WakeWordEngine.java', 'MainActivity.java', 'Backoff.java', 'KiuNative.java']) {
    assert.ok(java.includes(f), 'falta ' + f);
    assert.equal(escanearJava(fs.readFileSync(path.join(JAVA, f), 'utf8')), null, f + ' está desbalanceado');
  }
});
