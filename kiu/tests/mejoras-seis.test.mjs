import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const rd = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const ui = rd('app/src/main/assets/www/js/app/app-ui.js');
const main = rd('app/src/main/java/com/kiu/agent/MainActivity.java');
const off = rd('app/src/main/java/com/kiu/agent/OfflineDictation.java');
const dl = rd('app/src/main/java/com/kiu/agent/KiuDownload.java');
const wf = rd('.github/workflows/build.yml');
const html = rd('app/src/main/assets/www/index.html');

test('1 · la clave de firma debug se reutiliza entre corridas', () => {
  assert.match(wf, /actions\/cache@v4[\s\S]{0,120}~\/\.android\/debug\.keystore/);
});

test('2 · si un modelo falla, salta al siguiente que funcionaba (máx. 2 saltos)', () => {
  assert.match(ui, /function nextModel\(\)/);
  assert.match(ui, /tried\.length < 3/);
  assert.match(ui, /no respondió · pruebo con/);
});

test('2 · el salto de modelo funciona de verdad (simulado)', async () => {
  const a = ui.indexOf('      var tried = [mdl];');
  const b = ui.indexOf('      return run().then(function (o) { clearTimeout(to);');
  assert.ok(a > 0 && b > a);
  const body = ui.slice(a, b);
  // arma un entorno mínimo: attempt() falla con el modelo malo y funciona con el siguiente
  const factory = new Function('pv', 'self', 'full', 'timedOut', 'mdl0', 'calls',
    'var mdl = mdl0; function attempt(){ calls.push(mdl); return Promise.resolve(mdl === "bueno" ? {ok:true,text:"hola"} : {ok:false,err:"URL o modelo no encontrado"}); }\n' + body + '\nreturn run();');
  const toasts = [];
  const calls = [];
  const r = await factory({ st: { good: [{ m: 'malo' }, { m: 'bueno' }] } }, { toast: (t) => toasts.push(t), _cancelled: false }, '', false, 'malo', calls);
  assert.equal(r.ok, true);
  assert.deepEqual(calls, ['malo', 'bueno']);
  assert.equal(toasts.length, 1);
});

test('3 · hay dictado sin Google y se usa cuando Google falla', () => {
  assert.match(off, /new Recognizer\(model, 16000\.0f\)/);
  assert.match(main, /OfflineDictation\.listen\(/);
  assert.match(main, /if \(MainActivity\.this\.offlineFallback\(i\)\)/);
  assert.match(main, /OfflineDictation\.cancel\(\);/);
});

test('4 · «gracias / chau» terminan la charla sin pasar por el motor', () => {
  const m = ui.match(/\^\(muchas \)\?\(gracias\|chau[^\n]*?\$\//);
  assert.ok(m, 'regex de despedida');
  const re = new RegExp(m[0].slice(1, -1));
  const n = (t) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zñ0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  for (const ok of ['Gracias', 'Chau', 'Adiós', 'Hasta luego', 'Eso es todo', 'Muchas gracias Kiu']) assert.ok(re.test(n(ok)), ok);
  for (const no of ['Gracias por la información sobre el clima', '¿Qué hora es?', 'Chau mundo cruel de todos']) assert.ok(!re.test(n(no)), no);
  assert.match(ui, /endCall: function/);
});

test('5 · existe Estado y diagnóstico', () => {
  assert.match(html, /id="btn-estado"/);
  assert.match(ui, /verEstado: function/);
  assert.match(main, /public String kiuStatus\(\)/);
});

test('6 · la actualización se verifica con la huella SHA-256 de GitHub', () => {
  assert.match(ui, /String\(apk\.digest \|\| ''\)/);
  assert.match(dl, /startApk\(Context context, String url, String name, String size, String sha\)/);
  assert.match(dl, /new KiuDlTask\(id, url, safe, dir\.getAbsolutePath\(\), null, want256\)/);
  assert.match(wf, /SHA256SUMS\.txt/);
});
