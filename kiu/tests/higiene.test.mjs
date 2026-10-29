/* Higiene de fuentes (v2.9.5).
   --------------------------------------------------------------
   Existence justificada: tres veces en una sola tanda se coló basura de otro
   alfabeto al escribir código — cirílico y CJK en comentarios de Java y JS
   (palabras a medio traducir que quedaron con caracteres sueltos dentro). Es
   exactamente el tipo de cosa que un linter de caracteres atrapa al instante
   y que a ojo no se ve hasta que alguien lee el archivo.

   Este archivo se escribe con escapes unicode a propósito: si el detector
   usara los caracteres literales, el propio test fallaría por contener lo que
   busca. Un detector que se dispara a sí mismo no se puede usar. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.join(here, '..');

/* cirílico y CJK. Son los que se colaron. El rango de punct de ancho completo
   (FF00-FFEF) queda fuera a proposito: hay un caracter de ese rango usado como
   glifo de boton en rag.js, y eso si es legitimo. */
const RARO = /[\u0400-\u04FF\u4E00-\u9FFF]/g;

/* Solo fuentes escritas a mano. El vendor de PDF.js es minificado y no lo
   escribimos nosotros: auditarlo no sirve y solo produce ruido. */
const VENDOR = new Set(['pdf.min.js', 'pdf.worker.min.js', 'js-yaml.min.js']);

function fuentes() {
  const out = [];
  (function walk(dir) {
    let entradas;
    try {
      entradas = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const x of entradas) {
      const p = path.join(dir, x.name);
      if (x.isDirectory()) {
        if (['node_modules', '.git', 'build', '.gradle', 'vendor', 'dist'].includes(x.name)) continue;
        walk(p);
      } else if (/\.(java|js|mjs|cpp|h|kt|xml|sh|gradle|yml|yaml)$/.test(x.name) && !VENDOR.has(x.name)) {
        out.push(p);
      }
    }
  })(raiz);
  return out;
}

test('ninguna fuente tiene cirílico ni CJK', () => {
  const malos = [];
  for (const f of fuentes()) {
    const lineas = fs.readFileSync(f, 'utf8').split('\n');
    for (let i = 0; i < lineas.length; i++) {
      const m = lineas[i].match(RARO);
      if (m) {
        malos.push(`${path.relative(raiz, f)}:${i + 1}  ${JSON.stringify(m.join(''))}  ${lineas[i].trim().slice(0, 70)}`);
      }
    }
  }
  assert.equal(malos.length, 0,
    'Caracteres de otro alfabeto, casi siempre basura de tipeo:\n  ' + malos.join('\n  '));
});

test('el detector funciona: se dispara con un cirílico y con un CJK de verdad', () => {
  /* Un test de higiene que nunca falla no sirve de nada. Este inyecta basura a
     proposito y tiene que verla. Si el regex se rompe (rango mal escrito, flag
     perdida), la prueba de arriba pasa en verde sobre un archivo roto. */
  assert.ok('el\u5200'.match(RARO), 'un CJK tiene que saltar');
  assert.ok('\u041a\u043e\u043e\u0444\u0438\u0446\u0438\u0435\u043d\u0442\u0435'.match(RARO), 'un cirílico tiene que saltar');
  assert.equal('eleyedeyente'.match(RARO), null, 'lo normal no puede saltar');
  assert.equal('\uff0b Agregar PDF'.match(RARO), null, 'el glifo de ancho completo esta permitido a proposito');
});

test('las fuentes escritas a mano están todas cubiertas por el recorrido', () => {
  const f = fuentes().map((x) => path.relative(raiz, x));
  for (const debe of [
    'app/src/main/java/com/kiu/agent/WakeWordEngine.java',
    'app/src/main/java/com/kiu/agent/Backoff.java',
    'app/src/main/java/com/kiu/agent/MainActivity.java',
    'app/src/main/java/com/kiu/agent/KiuService.java',
    'app/src/main/assets/www/js/kiu-agente.js',
    'app/src/main/assets/www/js/app/app-ui.js',
    'app/src/main/assets/www/js/app/diag-voz.js',
  ]) {
    assert.ok(f.includes(debe), 'el recorrido no esta viendo ' + debe);
  }
  assert.ok(!f.some((x) => x.includes('node_modules')), 'no deberia entrar node_modules');
  assert.ok(!f.some((x) => x.includes('vendor/pdf.min.js')), 'el vendor minificado queda fuera a proposito');
});
