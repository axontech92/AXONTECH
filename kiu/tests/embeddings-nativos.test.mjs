import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const cpp = fs.readFileSync('app/src/main/cpp/kiullama_jni.cpp', 'utf8');
const native = fs.readFileSync('app/src/main/java/com/kiu/agent/KiuNative.java', 'utf8');
const activity = fs.readFileSync('app/src/main/java/com/kiu/agent/MainActivity.java', 'utf8');
const adapter = fs.readFileSync('app/src/main/assets/www/js/local-embeddings.js', 'utf8');
const gradle = fs.readFileSync('app/build.gradle.kts', 'utf8');

test('JNI expone extracción de embeddings del modelo cargado', () => {
  assert.match(cpp, /Java_com_kiu_agent_KiuNative_embedText/);
  assert.match(cpp, /llama_get_embeddings_ith/);
  assert.match(cpp, /llama_memory_clear\(llama_get_memory\(g_ctx\), true\)/);
  assert.match(native, /native float\[\] embedText\(String text\)/);
});

test('Bridge expone los vectores como JSON sin llamadas de red', () => {
  assert.match(activity, /String embedLocalText\(String text\)/);
  assert.match(activity, /boolean kiuLoaded\(\)/);
  assert.match(adapter, /kiu-native-hidden-state/);
  assert.match(adapter, /JSON\.parse\(raw\)/);
});

test('embeddings se limitan a 96 tokens y normalizan el vector', () => {
  assert.match(cpp, /n_tokens > 96/);
  assert.match(cpp, /pooled\[\(size_t\)j\] \/= \(float\)norm/);
});

test('versión Android no retrocede de 2.12.7 / 81', () => {
  /* v2.13.0: antes fijaba la versión EXACTA, y por eso cada mejora obligaba a tocar este test
     (o se quedaba sin subir la versión). Ahora solo impide retroceder. */
  const vn = gradle.match(/kiuVersionName = "(\d+)\.(\d+)\.(\d+)"/);
  const vc = gradle.match(/kiuVersionCode = (\d+)/);
  assert.ok(vn && vc, 'faltan kiuVersionName / kiuVersionCode');
  const n = Number(vn[1]) * 1e6 + Number(vn[2]) * 1e3 + Number(vn[3]);
  assert.ok(n >= 2012007, 'versión por debajo de 2.12.7');
  assert.ok(Number(vc[1]) >= 81, 'versionCode por debajo de 81');
});
