import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const cpp = fs.readFileSync('app/src/main/cpp/kiullama_jni.cpp', 'utf8');
const vendor = fs.readFileSync('scripts/vendor_llama.sh', 'utf8');

test('KV cache: el cambio respeta el pin de llama.cpp del proyecto', () => {
  assert.match(vendor, /LLAMA_TAG="v0\.7\.0"/);
  assert.match(vendor, /LLAMA_SHA="620d2225cc436ab0b001e3200e590e3b286ef9ab"/);
});

test('KV cache: intenta Q8_0 para K y V y conserva fallback FP16', () => {
  assert.match(cpp, /cp\.type_k = GGML_TYPE_Q8_0/);
  assert.match(cpp, /cp\.type_v = GGML_TYPE_Q8_0/);
  assert.match(cpp, /cp\.type_k = GGML_TYPE_F16/);
  assert.match(cpp, /cp\.type_v = GGML_TYPE_F16/);
  assert.ok(cpp.indexOf('GGML_TYPE_Q8_0') < cpp.indexOf('GGML_TYPE_F16'));
});

test('KV cache: la estimación de memoria contempla Q8 y FP16', () => {
  assert.match(cpp, /kv_bytes_estimate\([^)]*bool q8_cache = true/);
  assert.match(cpp, /bytes_per_value_x8 = q8_cache \? 9 : 16/);
});
