import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rd = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const ui = rd('app/src/main/assets/www/js/app/app-ui.js');
const main = rd('app/src/main/java/com/kiu/agent/MainActivity.java');
const dl = rd('app/src/main/java/com/kiu/agent/KiuDownload.java');
const upd = rd('app/src/main/java/com/kiu/agent/KiuUpdate.java');
const prov = rd('app/src/main/java/com/kiu/agent/KiuApkProvider.java');
const mf = rd('app/src/main/AndroidManifest.xml');

test('la actualización se baja dentro de la app, no en el navegador', () => {
  assert.match(ui, /updCard: function/);
  assert.match(ui, /rawBridge\('updStart'/);
  assert.match(ui, /rawBridge\('updInstall'/);
  assert.doesNotMatch(ui, /id="upd-apk"/);
});

test('la tarjeta usa el diseño de los modelos (anillo, k2-model, Cancelar)', () => {
  const m = ui.slice(ui.indexOf('updCard: function'), ui.indexOf('Recomendarme modelos'));
  assert.match(m, /k2-model/);
  assert.match(m, /k2-ringwrap/);
  assert.match(m, /k2-iconbtn danger/);
});

test('el puente nativo expone updStart y updInstall', () => {
  assert.match(main, /public String updStart\(/);
  assert.match(main, /public String updInstall\(/);
});

test('solo se baja desde los Releases del repo y se instala solo lo de la carpeta updates', () => {
  assert.match(upd, /RELEASES = "https:\/\/github\.com\/Criptobox\/KIU\/releases\/download\/"/);
  assert.match(dl, /startsWith\(KiuUpdate\.RELEASES\)/);
  assert.match(upd, /getCanonicalPath\(\)\.equals\(d\.getCanonicalPath\(\)\)/);
  assert.match(prov, /MODE_READ_ONLY/);
});

test('el manifiesto declara el permiso de instalar y el provider sin exportar', () => {
  assert.match(mf, /REQUEST_INSTALL_PACKAGES/);
  assert.match(mf, /android:name="\.KiuApkProvider"[\s\S]*?android:exported="false"[\s\S]*?android:grantUriPermissions="true"/);
});
