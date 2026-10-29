/* Tests del diagnóstico de voz (v2.9.3).

   Contexto: el reporte fue «el audio no funciona, no me reconoce la voz, no
   activa por reconocimiento de voz», y había CUATRO causas distintas con el
   mismo síntoma observable. Estos tests no comprueban que el diagnóstico sea
   lindo: comprueban que distinga las cuatro y que diga la grilla cuando algo
   está mal. Un diagnóstico que devuelve lo mismo en todos los casos es
   equivalente a no tener ninguno. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const WWW = path.join(here, '..', 'app', 'src', 'main', 'assets', 'www');
const appui = fs.readFileSync(path.join(WWW, 'js', 'app', 'app-ui.js'), 'utf8');
const diag = fs.readFileSync(path.join(WWW, 'js', 'app', 'diag-voz.js'), 'utf8');
const java = fs.readFileSync(path.join(here, '..', 'app', 'src', 'main', 'java', 'com', 'kiu', 'agent', 'MainActivity.java'), 'utf8');
const svc = fs.readFileSync(path.join(here, '..', 'app', 'src', 'main', 'java', 'com', 'kiu', 'agent', 'KiuService.java'), 'utf8');

/* app-ui.js tiene 4000 líneas y arrastra store, DOM y timers: cargarlo en un
   arnés mínimo revienta por dependencias que no tienen nada que ver con lo que
   se quiere probar, y el test "pasa" sin ejercitar nada. Por eso verReal() y
   diagVoz() viven en app/diag-voz.js, un módulo con una sola dependencia
   (bridge). Esto es lo que hace que el test sea real. */
function D(r, puente) {
  const ctx = {};
  ctx.window = ctx;
  ctx.rawBridge = () => JSON.stringify(r);
  /* el puente REAL tiene métodos como funciones: si el arnés los pone como
     números, la sonda de capacidades los ve ausentes y TODO el diagnóstico
     marca instalación mezclada — un falso positivo que hace inútil el test. */
  ctx.KiuBridge = puente || { kiuDiag() {}, kiuGenSetGrammar() {}, kiuWWStart() {}, wwPick() {} };
  vm.createContext(ctx);
  vm.runInContext(diag, ctx, { filename: 'diag-voz.js' });
  return ctx.KiuDiagVoz;
}

const TODO_BIEN = {
  version: '2.9.3', versionCode: 41, mic: true, recogn: true,
  recogSvcs: ['com.google.android.googlequicksearchbox'], ttsReady: true,
  ttsEngine: 'com.google.android.tts', ttsLang: 'es_AR',
  voskModel: true, voskSize: '39 MB', wwActive: true,
};

test('todo bien: ninguna fila con problema', () => {
  const UI_ = D(TODO_BIEN);
  const filas = UI_.diagVoz();
  const malas = filas.filter((f) => !f.ok);
  assert.equal(malas.length, 0, 'con todo bien no puede haber filas malas: ' + JSON.stringify(malas));
});

test('la versión NO se puede auto-detectar: el JS y el nativo salen del mismo árbol', () => {
  /* Este test existe para documentar un NO. La versión instalada y el código que
     corre vienen del mismo APK, así que SIEMPRE coinciden: cualquier chequeo
     "versión instalada < versión esperada" passaría siempre y no detectaría nada.
     Un número esperado escrito a mano en el JS sería la misma mentira que se
     quiso sacar. Por eso la fila es informativa y el problema se detecta por
     CAPACIDAD, en el test de abajo. */
  const m = D({ ...TODO_BIEN, version: '2.7', versionCode: 39 });
  const v = m.diagVoz().find((f) => f.titulo === 'Versión instalada');
  assert.match(v.detalle, /2\.7/, 'pero el número real se muestra igual, para que el usuario lo vea');
  assert.equal(v.ok, true, 'y no se marca como error: no hay forma honesta de saber que es viejo');
  assert.equal(m.ver, '2.7', 'y la versión sale del paquete, no de una constante');
});

test('instalación MEZCLADA: se detecta por capacidad, no por número', () => {
  /* El caso real: assets viejos con nativo nuevo, o al revés. El síntoma es
     "me instala otra versión" sin explicación. Se reconoce porque a este código
     le falta un método del puente, y se dice CUÁL — que es accionable. */
  const viejo = { kiuDiag() {}, kiuWWStart() {}, wwPick() {} };   // sin setGrammar (v2.9.2)
  const v = D(TODO_BIEN, viejo).diagVoz().find((f) => f.titulo === 'Versión instalada');
  assert.equal(v.ok, false);
  assert.match(v.grilla, /kiuGenSetGrammar/, 'tiene que nombrar la capacidad que falta');
  const completo = D(TODO_BIEN).diagVoz().find((f) => f.titulo === 'Versión instalada');
  assert.equal(completo.ok, true, 'y con el puente completo no hay alarma: si la hay, es ruido');
});

test('sin puente readable, muestra ? en vez de una versión inventada', () => {
  const ctx = {};
  ctx.window = ctx;
  ctx.rawBridge = () => { throw new Error('sin puente'); };
  ctx.KiuBridge = {};
  vm.createContext(ctx);
  vm.runInContext(diag, ctx, { filename: 'diag-voz.js' });
  assert.equal(ctx.KiuDiagVoz.verReal(), '?', 'la respuesta honesta es incógnita, no un número plausible');
});

test('sin servicio de voz: distingue de "hay servicio pero no disponible"', () => {
  const a = D({ ...TODO_BIEN, recogn: false, recogSvcs: [] }).diagVoz().find((f) => f.titulo === 'Reconocimiento de voz');
  assert.equal(a.ok, false);
  assert.match(a.detalle, /isRecognitionAvailable\(\) = false/);
  const b = D({ ...TODO_BIEN, recogn: false, recogSvcs: ['com.x'] }).diagVoz().find((f) => f.titulo === 'Reconocimiento de voz');
  assert.notEqual(b.detalle, a.detalle, 'son dos fallos distintos y no pueden verse iguales');
});

test('sin modelo Vosk: dice que el camino local está muerto y da la grilla', () => {
  const f = D({ ...TODO_BIEN, voskModel: false, voskSize: '-' }).diagVoz().find((x) => x.titulo.includes('Vosk'));
  assert.equal(f.ok, false);
  assert.match(f.grilla, /40 MB/);
  assert.match(f.grilla, /no van en el repo/i, 'tiene que explicar por qué no está, si no parece un bug');
});

test('las cuatro causas se distinguen entre sí (no son el mismo diagnóstico)', () => {
  const causas = [
    { ...TODO_BIEN, version: '2.7', versionCode: 39 },
    { ...TODO_BIEN, mic: false },
    { ...TODO_BIEN, recogn: false, recogSvcs: [] },
    { ...TODO_BIEN, voskModel: false },
  ];
  const firmas = causas.map((c) => D(c).diagVoz().filter((f) => !f.ok).map((f) => f.titulo).sort().join('|'));
  const unicas = new Set(firmas);
  assert.equal(unicas.size, 4, 'las cuatro causas tienen que dar firmas distintas:\n' + firmas.join('\n'));
});

test('sin permiso de micrófono también se distingue del resto', () => {
  const firmas = [TODO_BIEN, { ...TODO_BIEN, mic: false }].map((c) => D(c).diagVoz().filter((f) => !f.ok).length);
  assert.deepEqual(firmas, [0, 1], 'el permiso es su propia fila, no se mezcla con otra causa');
});

test('la versión de la UI sale del paquete, no de una constante escrita a mano', () => {
  /* El bug que motivó todo: el rótulo decía 'Kiu v2.9.3' con una constante en el
     JS, así que un APK instalado de 2.7 no tenía por qué delatar nada. */
  /* se miran los comentarios: que la CHANGELOG o una nota digan «esto es v2.9.3»
     está bien y es necesario. Lo que no puede pasar es que el CÓDIGO arme el
     rótulo con un número escrito a mano. */
  const codAppui = appui.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const codDiag = diag.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(codAppui, /Kiu v2\.9\.\d/, 'el rótulo no puede llevar la versión escrita a mano');
  assert.match(appui, /'Kiu v' \+ verTxt/, 'el rótulo usa la versión leída del paquete');
  assert.match(appui, /verReal: function \(cb\) \{ return KiuDiagVoz\.verReal\(cb\); \}/, 'y tiene que delegar al módulo que sí lee el paquete');
  assert.doesNotMatch(codDiag, /'Kiu v2\.9\.\d/, 'ni el módulo nuevo puede hardcodearla');
});

test('kiuDiag lee la versión de PackageManager, no de una constante', () => {
  assert.match(java, /getPackageInfo\(MainActivity\.this\.getPackageName\(\), 0\)\.versionName/);
  assert.match(java, /kiuDiag\(\)/);
  /* los cuatro datos que hacen falta para no adivinar */
  for (const d of ['isRecognitionAvailable', 'RECORD_AUDIO', 'voskModel', 'ttsReady']) {
    assert.ok(java.includes(d), 'kiuDiag no reporta ' + d);
  }
});

test('kiuDiag escapa los strings: un nombre de servicio raro no rompe el JSON', () => {
  /* los nombres de paquete vienen del sistema, no de nosotros: si uno trae comilla
     o barra, el JSON entero se rompe y el diagnóstico —que es la herramienta de
     rescate— se cae justo cuando hace falta. */
  assert.match(java, /static String q\(String s\)/);
  const cuerpo = java.slice(java.indexOf('static String q(String s)'), java.indexOf('static String q(String s)') + 700);
  assert.match(cuerpo, /c == '"'/, 'escape la comilla doble');
  assert.match(cuerpo, /c == '\\\\'/, 'escape la barra invertida');
});

test('watchdog: si el recognizer se cuelga, Kiu deja de estar mudo para siempre', () => {
  /* El bucle se rearma SOLO desde onResults/onError. Sin ninguna de las dos, el
     recognizer quedó colgado: listening=true para siempre y cycle() volvía por
     el `if (listening) return`. Sin error, sin log, sin aviso. */
  assert.match(svc, /MAX_SESSION_MS/);
  const ciclo = svc.slice(svc.indexOf('if (this.listening)'), svc.indexOf('if (this.listening)') + 600);
  assert.match(ciclo, /MAX_SESSION_MS/, 'el watchdog tiene que estar DENTRO de la rama de listening');
  assert.match(ciclo, /destroy\(\)/, 'y hay que destructurar el recognizer colgado');
  assert.match(ciclo, /schedule\(/, 'y rearmar, o el watchdog no sirve de nada');
  assert.match(svc, /listenSince = System\.currentTimeMillis\(\)/, 'la sesión tiene que marcar cuándo arrancó');
});

test('el modelo Vosk se busca en am/final.mdl, que es donde lo deja el zip oficial', () => {
  /* BUG REAL encontrado auditando el arranque de voz. El layout oficial de
     vosk-model-small-es-0.42 es:

         vosk-model-small-es-0.42/
           am/final.mdl        <-- acá
           conf/mfcc.conf
           graph/...

     y el código chequeaba <dir>/final.mdl, en la RAÍZ. Con el modelo puesto
     donde dice la documentación, el chequeo daba false y el arranque se negaba
     con un error que decía «falta el modelo» — mentira, porque estaba, en su
     sitio, y la app no lo veía. El síntoma es el reportado: la palabra de
     activación nunca dispara. */
  const ww = fs.readFileSync(path.join(here, '..', 'app', 'src', 'main', 'java', 'com', 'kiu', 'agent', 'WakeWordEngine.java'), 'utf8');
  const cod = ww.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.match(cod, /"am\/final\.mdl"/, 'tiene que buscar el layout oficial');
  /* y se acepta el aplanado también: alguien puede copiar el contenido de am/ */
  assert.match(cod, /"final\.mdl"/, 'y también el layout aplanado');
  /* el que decide si arranca y el que informa si está presente tienen que
     coincidir: si uno busca am/ y el otro la raíz, uno miente igual */
  const mPresent = cod.slice(cod.indexOf('public static boolean modelPresent'), cod.indexOf('public static boolean modelPresent') + 400);
  const start = cod.slice(cod.indexOf('public boolean start'), cod.indexOf('public boolean start') + 900);
  assert.match(mPresent, /am\/final\.mdl/, 'modelPresent() busca el layout oficial');
  assert.match(start, /am\/final\.mdl/, 'start() busca el mismo layout que modelPresent()');
  /* y la carga le pasa la RAÍZ del modelo, que es lo que Vosk espera */
  assert.match(cod, /model = new Model\(dir\)/, 'Model() recibe la raíz, no el archivo .mdl');
});

/* ---- instalar el modelo desde la app (v2.9.7) ---- */

test('instalar el modelo existe y no promete nada en el navegador', () => {
  const ctx = {};
  ctx.window = ctx;
  ctx.rawBridge = () => JSON.stringify({ version: '2.9.7', versionCode: 45, voskModel: false });
  ctx.console = console;
  ctx.setTimeout = () => 0; ctx.clearInterval = () => {}; ctx.setInterval = () => 0;
  vm.createContext(ctx);
  vm.runInContext(diag, ctx, { filename: 'diag-voz.js' });
  const M = ctx.KiuDiagVoz;
  assert.equal(typeof M.instalar, 'function', 'instalar tiene que existir');
  /* en el navegador no hay puente: no puede fallar al llamarse, y el botón no
     debe aparecer (es peor ofrecer algo que no podés hacer). */
  assert.equal(M.puedeInstalar(), false, 'sin puente, no se puede instalar');
});

test('el botón de instalar sale solo cuando FALTA el modelo', () => {
  const D = (r) => {
    const ctx = {};
    ctx.window = ctx;
    ctx.rawBridge = () => JSON.stringify(r);
    ctx.KiuBridge = { wwInstall() {}, dlStatus() { return '{}'; }, wwUnzip() { return '{}'; }, wwUnzipStatus() { return '{}'; } };
    ctx.setTimeout = () => 0; ctx.setInterval = () => 0; ctx.clearInterval = () => {};
    vm.createContext(ctx);
    vm.runInContext(diag, ctx, { filename: 'diag-voz.js' });
    return ctx.KiuDiagVoz;
  };
  const base = { version: '2.9.7', versionCode: 45, mic: true, recogn: true, recogSvcs: ['g'], ttsReady: true, ttsEngine: 'e', ttsLang: 'es' };
  const fila = (m) => m.diagVoz().find((f) => f.titulo.indexOf('Vosk') >= 0);
  assert.equal(fila(D({ ...base, voskModel: false })).ok, false, 'sin modelo, la fila está mal');
  assert.equal(fila(D({ ...base, voskModel: true })).ok, true, 'con modelo, la fila está bien');
});

test('el SHA del modelo está fijado en el código', () => {
  /* Una descarga de 39 MB sin verificar es una puerta abierta: el archivo va
     directo al disco de la app y de ahí a Vosk. */
  const java = fs.readFileSync(path.join(here, '..', 'app', 'src', 'main', 'java', 'com', 'kiu', 'agent', 'KiuVoskInstall.java'), 'utf8');
  const m = java.match(/SHA256\s*=\s*"([0-9a-f]{64})"/);
  assert.ok(m, 'el SHA tiene que ser un hex de 64, no un placeholder');
  assert.match(java, /KiuDownload\.start\([^)]*SHA256\)/, 'y hay que pasárselo al motor de descargas');
});

test('los tres métodos del puente existen en Java y en el contrato', () => {
  const java = fs.readFileSync(path.join(here, '..', 'app', 'src', 'main', 'java', 'com', 'kiu', 'agent', 'MainActivity.java'), 'utf8');
  for (const m of ['wwInstall', 'wwUnzip', 'wwUnzipStatus']) {
    assert.match(java, new RegExp('public String ' + m + '\\('), 'falta ' + m + ' en el puente');
    assert.match(diag, new RegExp("'" + m + "'"), 'y el JS tiene que llamarlo');
  }
});
