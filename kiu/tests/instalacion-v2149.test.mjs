/* instalacion-v2149.test.mjs — v2.14.9: por qué la APK no se instalaba.
 *
 * EL SÍNTOMA: "la descargué de GitHub y al intentar instalar dio error".
 *
 * LA CAUSA: Android NO deja instalar un APK encima de la app instalada si
 * los dos están firmados con claves distintas. El error del sistema es
 * críptico y parece que el archivo esté roto. Peor: el CI firmaba con la
 * clave debug cuando faltaban los secretos, y la clave debug sale de una
 * CACHE de GitHub: si la caché se expulsa, la clave cambia y TODA la app
 * instalada queda sin poder actualizarse.
 *
 * TRES CAPAS DE ARREGLO:
 *   1. la app COMPARA la firma antes de abrir el instalador y explica el
 *      motivo (y avisa de que desinstalar borra la memoria);
 *   2. el CI CORTA el build si la firma cambió, antes de publicar;
 *   3. el script de verificación puede comparar dos APK en local.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.join(here, '..');
const upd = readFileSync(path.join(raiz, 'app/src/main/java/com/kiu/agent/KiuUpdate.java'), 'utf8');
const uiSrc = readFileSync(path.join(raiz, 'app/src/main/assets/www/js/app/app-ui.js'), 'utf8');
const ci = readFileSync(path.join(raiz, '.github/workflows/build.yml'), 'utf8');
const script = readFileSync(path.join(raiz, 'scripts/verificar-apk.sh'), 'utf8');

/* ================= 1 · la app lo explica ================= */
test('la app compara la firma ANTES de abrir el instalador', () => {
  assert.match(upd, /certDe\(c, f\.getAbsolutePath\(\)\)/, 'compara el certificado del APK');
  assert.match(upd, /certDe\(c, null\)/, 'con el de la app instalada');
  assert.match(upd, /!propia\.equals\(nueva\)/, 'y si no coinciden, no lo instala');
});

test('el motivo dice que desinstalar BORRA los datos', () => {
  assert.match(upd, /err:firma distinta/, 'un motivo propio, no el del sistema');
  assert.match(upd, /perdés la memoria y los documentos/, 'y avisa de lo que se pierde');
});

test('la app lo muestra como tarjeta de error, no como un toast', () => {
  assert.match(uiSrc, /No se puede instalar encima/, 'el mensaje visible');
  assert.match(uiSrc, /firma/i, 'que menciona la firma');
  assert.match(uiSrc, /botSay\('!! /, 'y va como tarjeta');
});

/* ================= 2 · el CI lo previene ================= */
test('el CI corta el build si la firma cambió', () => {
  assert.match(ci, /La firma no puede cambiar entre versiones/, 'el paso existe');
  assert.match(ci, /verify --print-certs/, 'compara los certificados');
  assert.match(ci, /apksigner_bin/, 'con el apksigner del SDK');
  assert.match(ci, /LA FIRMA CAMBIÓ/, 'y corta con el motivo');
  /* el paso tiene que ir ANTES de publicar la release */
  const paso = ci.indexOf('La firma no puede cambiar');
  const publica = ci.indexOf('softprops/action-gh-release');
  assert.ok(paso > 0 && publica > 0 && paso < publica, 'el paso va antes de publicar');
});

test('el CI avisa cuando firma con la clave de prueba', () => {
  assert.match(ci, /Faltan los secretos KIU_KEYSTORE_BASE64/, 'el aviso existe');
  assert.match(ci, /no para actualizar la app ya instalada/, 'y dice para qué sirve');
});

/* ================= 3 · el script lo verifica en local ================= */
test('el script puede comparar dos APK por firma', () => {
  assert.match(script, /--firma/, 'la opción existe');
  assert.match(script, /FIRMA DISTINTA/, 'y dice cuándo es un problema');
  assert.match(script, /MISMA firma/, 'y cuándo está bien');
});

/* ================= 4 · y el "no descarga" ================= */
test('si no hay release publicada, la app lo dice con el motivo', () => {
  assert.match(uiSrc, /todavía no hay versiones publicadas/, 'el mensaje');
  assert.match(uiSrc, /solo publica una release cuando hay un tag/, 'y el motivo');
});
