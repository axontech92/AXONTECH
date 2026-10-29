import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const rd = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const cr = rd('app/src/main/java/com/kiu/agent/KiuCrypto.java');
const px = rd('app/src/main/java/com/kiu/agent/KiuApiProxy.java');
const main = rd('app/src/main/java/com/kiu/agent/MainActivity.java');
const sec = rd('app/src/main/assets/www/js/kiu-secure.js');
const st = rd('app/src/main/assets/www/js/app/state.js');

test('el descifrado usa un modo de Cipher válido (2 = DECRYPT_MODE), no 12', () => {
  assert.doesNotMatch(cr, /\.init\(\s*1[0-9]\s*,/);
  assert.match(cr, /cipher\.init\(2, key, new GCMParameterSpec\(128, copyOf\)\)/);
});

test('enc() verifica lo que cifra y cae a respaldo local en vez de guardar vacío', () => {
  assert.match(cr, /str\.equals\(keystoreDec\(viaKs\)\)/);
  assert.match(cr, /SOFT = "S1:"/);
  assert.match(cr, /public static boolean readable/);
});

test('el puente avisa si no pudo guardar y «has» exige que la clave se pueda leer', () => {
  assert.match(main, /public boolean kiuKeysSet/);
  assert.match(main, /KiuCrypto\.readable\(e\)/);
  assert.match(sec, /return r === undefined \? true : !!r/);
  assert.match(st, /okV = KiuVault\.set\(pid, val\) !== false/);
});

test('el proxy no manda «Bearer » vacío: corta con el motivo', () => {
  assert.match(px, /throws java\.io\.IOException \{/);
  assert.match(px, /No pude leer la clave de/);
  assert.match(px, /no es la del proveedor/);
});
