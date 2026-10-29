/* motor-gramatica-v2193.test.mjs — v2.19.3: la gramática cerraba la app.
 *
 * ESTE ES UN TEST DE FORMA (lee kiullama_jni.cpp): sin NDK ni teléfono no se puede ejecutar el
 * motor. Fija el orden de la cadena de muestreo y la red de seguridad, que es lo que, si alguien
 * lo revierte, vuelve a matar el proceso. El razonamiento está en el comentario del propio .cpp
 * y se verificó leyendo llama.cpp v0.7.0 (el que fija scripts/vendor_llama.sh).
 *
 *   llama_sampler_sample(): aplica la cadena y luego toma data[selected] y llama accept().
 *   greedy/dist fijan `selected`; la gramática solo pone -INFINITY y NO lo cambia.
 *   Si la gramática va DESPUÉS del selector y el token elegido no encaja, accept() lanza
 *   std::runtime_error ("Unexpected empty grammar stack…"): una excepción que cruza JNI es
 *   std::terminate = la app se cierra sin avisar.
 *
 * node --test tests/motor-gramatica-v2193.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const cpp = fs.readFileSync(path.join(process.cwd(), 'app/src/main/cpp/kiullama_jni.cpp'), 'utf8');
const pos = (re) => { const m = cpp.search(re); assert.ok(m >= 0, 'no encontré ' + re); return m; };

test('la gramática se agrega a la cadena ANTES de greedy y de dist', () => {
  const gram = pos(/llama_sampler_chain_add\(smpl, gs\)/);
  const greedy = pos(/llama_sampler_chain_add\(smpl, llama_sampler_init_greedy\(\)\)/);
  const minp = pos(/llama_sampler_chain_add\(smpl, llama_sampler_init_min_p/);
  const dist = pos(/llama_sampler_chain_add\(smpl, llama_sampler_init_dist/);
  assert.ok(gram < greedy, 'la gramática tiene que ir antes que greedy');
  assert.ok(gram < minp && gram < dist, 'y antes que min_p/temp/dist');
});

test('las penalizaciones van antes que la gramática (no cambian qué tokens son válidos)', () => {
  assert.ok(pos(/kiu_penalties\(64/) < pos(/llama_sampler_chain_add\(smpl, gs\)/));
});

test('el muestreo está protegido: una excepción se vuelve error, no muerte del proceso', () => {
  const sample = pos(/id = llama_sampler_sample\(smpl, g_ctx, -1\)/);
  const trozo = cpp.slice(sample - 120, sample + 500);
  assert.match(trozo, /try \{/);
  assert.match(trozo, /catch \(const std::exception&/);
  assert.match(trozo, /catch \(\.\.\.\)/);
  assert.match(trozo, /ok = false;\s*break;/, 'y corta la generación en vez de seguir');
  assert.match(cpp, /#include <exception>/);
});

test('crear el sampler de gramática tampoco puede dejar escapar una excepción', () => {
  assert.match(cpp, /try \{ gs = kiu_grammar\(gv, gbnf\.c_str\(\), "root"\); \} catch \(\.\.\.\)/);
});

test('el comentario viejo que justificaba "gramática al final" ya no está', () => {
  assert.doesNotMatch(cpp, /la gramatica va SIEMPRE al final de la cadena/);
  assert.match(cpp, /LA GRAMATICA VA ANTES DEL SELECTOR/);
});
