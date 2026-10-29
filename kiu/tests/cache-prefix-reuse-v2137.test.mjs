import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const cpp = fs.readFileSync('app/src/main/cpp/kiullama_jni.cpp', 'utf8');
const gradle = fs.readFileSync('app/build.gradle.kts', 'utf8');
const changelog = fs.readFileSync('CHANGELOG.md', 'utf8');

test('KV prefix reuse: only reuses a matching common token prefix', () => {
  assert.match(cpp, /g_cached_prompt_tokens/);
  assert.match(cpp, /g_cached_prompt_tokens\[\(size_t\)reuse_tokens\] == toks\[\(size_t\)reuse_tokens\]/);
  assert.match(cpp, /llama_memory_seq_rm\(prompt_mem, 0, reuse_tokens, -1\)/);
});

test('KV prefix reuse: reevaluates at least the final prompt token', () => {
  assert.match(cpp, /if \(reuse_tokens >= n_prompt\) reuse_tokens = n_prompt - 1/);
  assert.match(cpp, /int done = reuse_tokens/);
  assert.match(cpp, /n_pos = reuse_tokens/);
});

test('KV prefix reuse: invalidates on memory clearing and context shift', () => {
  assert.ok((cpp.match(/g_prompt_cache_valid = false/g) || []).length >= 4);
  assert.match(cpp, /context_shifted = true/);
  assert.match(cpp, /if \(ok && !context_shifted && done == n_prompt\)/);
});

test('Version is bumped consistently for the KV prefix implementation', () => {
  /* v2.14.2: la versión no se fija a un número exacto. Fijarla obliga a
     tocar este test en cada tanda y un día se olvida y el test mintió: es el
     mismo anti-patrón que el repo ya se corrigió una vez (ver KNOWN_ISSUES).
     Lo que importa es que la versión NO retroceda y que el código suba. */
  const ver = gradle.match(/val kiuVersionName = "(\d+)\.(\d+)\.(\d+)"/);
  assert.ok(ver, 'la versión tiene que estar declarada en el build');
  const n = (+ver[1] * 1e6) + (+ver[2] * 1e3) + (+ver[3]);
  assert.ok(n >= 2014001, 'la versión no puede bajar de 2.14.1');
  const code = +gradle.match(/val kiuVersionCode = (\d+)/)[1];
  assert.ok(code > 92, 'el versionCode tiene que subir: ' + code);
  assert.match(changelog, /^## \[2\.14\./m);
});
