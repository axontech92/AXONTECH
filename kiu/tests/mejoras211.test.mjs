/* mejoras211.test.mjs — v2.11.0: asistente de voz, actualizaciones, nivel de voz y firma. */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { WWW } from './helpers.mjs';

const ROOT = path.resolve(WWW, '../../../../..');
const ui = readFileSync(path.join(WWW, 'js/app/app-ui.js'), 'utf8');
const html = readFileSync(path.join(WWW, 'index.html'), 'utf8');
const css = readFileSync(path.join(WWW, 'css/app.css'), 'utf8');
const java = readFileSync(path.join(ROOT, 'app/src/main/java/com/kiu/agent/MainActivity.java'), 'utf8');
const yml = readFileSync(path.join(ROOT, '.github/workflows/build.yml'), 'utf8');
const gradle = readFileSync(path.join(ROOT, 'app/build.gradle.kts'), 'utf8');

test('asistente de voz: pasos, botones y apertura única la primera vez', () => {
  assert.match(html, /id="btn-asist-voz"/);
  for (const id of ['mic', 'rec', 'model', 'tts', 'bat', 'vol']) assert.match(ui, new RegExp("id: '" + id + "'"));
  assert.match(ui, /asistenteAuto: function/);
  assert.match(ui, /store\('kiu_asist_voz'\)/);
  assert.match(ui, /store\('kiu_asist_voz', 1\)/);
});

test('el puente Java tiene kiuAsist y los ajustes de batería de la app', () => {
  assert.match(java, /public String kiuAsist\(\)/);
  assert.match(java, /isIgnoringBatteryOptimizations\(MainActivity\.this\.getPackageName\(\)\)/);
  assert.match(java, /"bateriaapp"\.equals\(str\)/);
  assert.match(java, /IGNORE_BATTERY_OPTIMIZATION_SETTINGS/);
});

test('nivel de voz: Java limita el ritmo y la UI lo traduce a barras', () => {
  assert.match(java, /private long lastRmsMs/);
  assert.match(java, /now - MainActivity\.this\.lastRmsMs < 90/);
  assert.match(java, /nexoVoiceLevel\(" \+ f \+ "\)/);
  assert.match(ui, /window\.nexoVoiceLevel = function/);
  assert.match(ui, /vpLevel: function/);
  assert.match(css, /\.voice-pulse\.live\[data-st="listen"\] \.vp-bars i/);
});

test('el nivel de voz se apaga si dejan de llegar avisos o se sale de escucha', () => {
  assert.match(ui, /Date\.now\(\) - \(self\._vpLvlT \|\| 0\) > 1200/);
  assert.match(ui, /if \(m !== 'listen'\) this\.vpLive\(false\)/);
});

test('actualizaciones: prendidas por defecto (v2.11.8), cada 6 h, con notificación', () => {
  assert.match(html, /id="btn-upd"/);
  assert.match(html, /id="tg-upd"/);
  assert.match(ui, /releases\/latest/);
  assert.match(ui, /Date\.now\(\) - \(u\.last \|\| 0\) < 21600000\) return;/);
  assert.match(ui, /u\.auto === undefined/);
  assert.match(ui, /rawBridge\('notifyUpdate'/);
  assert.match(ui, /openUrl\(apk\.browser_download_url\)/);
  assert.doesNotMatch(ui, /REQUEST_INSTALL_PACKAGES/);
});

test('comparación de versiones', () => {
  const m = ui.match(/verNum: function \(v\) \{[\s\S]*?\n    \},/);
  assert.ok(m);
  const verNum = new Function('return {' + m[0].replace(/,\s*$/, '') + '}')().verNum;
  assert.deepEqual(verNum('v2.11.0'), [2, 11, 0]);
  assert.deepEqual(verNum('2.9'), [2, 9, 0]);
  assert.equal(verNum('?'), null);
  const cmp = (a, b) => { const x = verNum(a), y = verNum(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };
  assert.ok(cmp('v2.11.0', '2.10.1') > 0);
  assert.ok(cmp('2.10.1', '2.10.1') === 0);
  assert.ok(cmp('v2.9.7', '2.10.0') < 0);
});

test('build: verifica la firma con mensajes claros y deja la huella en el resumen', () => {
  assert.match(yml, /name: Verificar firma/);
  assert.match(yml, /if: env\.KIU_PASS != ''/);
  assert.match(yml, /KIU_KEYSTORE_PASSWORD no abre el keystore/);
  assert.match(yml, /no tiene el alias/);
  assert.match(yml, /GITHUB_STEP_SUMMARY/);
  assert.ok(yml.indexOf('name: Verificar firma') < yml.indexOf('name: Compilar'));
  assert.ok(existsSync(path.join(ROOT, 'docs/FIRMA.md')));
});

test('el keystore se busca igual para comprobar que existe y para firmar', () => {
  assert.match(gradle, /val ksFile = rootProject\.file\(ksPath\)/);
  assert.match(gradle, /ksFile\.exists\(\)/);
  assert.match(gradle, /storeFile = ksFile/);
  assert.ok(((m) => m && (+m[1] * 1e6 + +m[2] * 1e3 + +m[3]) >= 2012007)(gradle.match(/val kiuVersionName = "(\d+)\.(\d+)\.(\d+)"/)), 'la versión no puede bajar de 2.12.7');
  assert.ok(+gradle.match(/val kiuVersionCode = (\d+)/)[1] >= 81, 'el versionCode no puede bajar de 81');
});

/* ---- v2.11.1: el modelo estaba instalado y el diagnóstico decía SIN MODELO ---- */
test('el diagnóstico acepta am/final.mdl (layout oficial) igual que el motor', () => {
  const m = java.match(/"voskModel[\s\S]{0,40}|am\/final\.mdl[\s\S]{0,300}/);
  assert.match(java, /new java\.io\.File\(base, "am\/final\.mdl"\)/);
  assert.match(java, /mdl = WakeWordEngine\.modelPresent\(MainActivity\.this\)/);
  assert.doesNotMatch(java, /WakeWordEngine\.modelDir\(MainActivity\.this\), "final\.mdl"\)/);
});

test('el reconocedor: prefiere el de Google, prueba otros idiomas y dice el motivo del error', () => {
  assert.match(java, /ComponentName pickRecognizer\(\)/);
  assert.match(java, /googlequicksearchbox/);
  assert.match(java, /createSpeechRecognizer\(this, recPick\)/);
  assert.match(java, /SPEECH_LANGS = \{"es-US", "es-419", "es-AR", "es-MX", "es-ES", "es"\}/);
  assert.match(java, /if \(MainActivity\.this\.retrySpeech\(i\)\)/);
  assert.match(java, /nexoVoiceError\('err_" \+ i \+ "'\)/);
  assert.match(java, /^import android\.content\.ComponentName;/m);
  assert.match(ui, /vozErrTexto: function/);
  assert.match(ui, /err_\\d\+/);
});

test('cada reintento del reconocedor está acotado (no hay bucle infinito)', () => {
  assert.match(java, /speechLangIdx < SPEECH_LANGS\.length - 1/);
  /* v2.11.3: agotados los idiomas se prueba UNA vez el reconocedor del sistema (guardado por
     !recForceDefault); si vuelve a fallar, se resetea todo y se sale con false: sin bucle. */
  assert.match(java, /speechLangIdx = 0;[\s\S]{0,900}?if \(!recForceDefault\) \{[\s\S]{0,400}?return true;\s*\}\s*recForceDefault = false;[\s\S]{0,200}?return false;/);
  assert.match(java, /\(code == 5 \|\| code == 11\) && !recForceDefault/);
});
