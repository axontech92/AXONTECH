/* voz.test.mjs — regresión v2.8.1: los tres fallos que se reportaron.
 *
 *   1. La activación por voz y la conversación continua NO funcionaban. Y eran el
 *      mismo bug: al manifest le faltaba el <queries> de android.speech.RecognitionService.
 *      Desde Android 11 (API 30) la app no ve el servicio de voz del sistema, así que
 *      SpeechRecognizer.isRecognitionAvailable() devuelve false SIEMPRE →
 *        · KiuService.cycle() reprograma cada 6 s y nunca escucha (no hay wake word),
 *        · MainActivity.startSpeech() entra por la rama 'unavailable' (no hay continuo).
 *      Además, la wake word local (Vosk) detectaba «Kiu» y solo encendía un toast:
 *      no había forma de decir el pedido.
 *
 *   2. El bucle de conversación se rearmeaba solo si el usuario había apretado el botón
 *      del micro (_voiceDriven), así que arrancado por la palabra de activación o por el
 *      fin del TTS moría después del primer turno.
 *
 *   3. El hueco del bot en la pantalla de conversación no tenía caja: las clases .kav*
 *      eran del robot viejo (avatar.js, borrado en 2.7.0) y el `--kav-s` que declaraban
 *      ya no lo leía nadie, así que el div quedaba en 0x0 dentro de su flex y el bot se
 *      pintaba al tamaño de emergencia (64 px) encima del título «Kiu».
 *
 * Estos tests no necesitan un teléfono: fijan el contrato en el código que lo causa.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const W = 'app/src/main/assets/www/';
const J = 'app/src/main/java/com/kiu/agent/';
const read = (f) => fs.readFileSync(f, 'utf8');
/* Los comentarios explican el bug que se arregla, así que un `doesNotMatch` a pelo
   los dispararía. Para afirmar sobre CÓDIGO, primero se limpian. */
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
/* Porzione del cuerpo de una función, desde su firma hasta la llave que la cierra. */
function cuerpo(txt, firma) {
  const i = txt.indexOf(firma);
  assert.notEqual(i, -1, 'no encontré ' + firma);
  let nivel = 0, desde = txt.indexOf('{', i);
  for (let j = desde; j < txt.length; j++) {
    if (txt[j] === '{') nivel++;
    else if (txt[j] === '}' && --nivel === 0) return txt.slice(i, j + 1);
  }
  throw new Error('llaves sin cerrar en ' + firma);
}
const manifest = read('app/src/main/AndroidManifest.xml');
const ww = read(J + 'WakeWordEngine.java');
const main = read(J + 'MainActivity.java');
const ui = read(W + 'js/app/app-ui.js');
const av = read(W + 'js/kiu-avatar.js');
const boot = read(W + 'js/kiu-avatar-boot.js');
const css = read(W + 'css/app.css');
const html = read(W + 'index.html');

/* ================= 1 · el manifiesto deja ver los servicios de voz ================= */

test('el manifest declara <queries> con android.speech.RecognitionService', () => {
  // es el requisito literal de la documentación de SpeechRecognizer para targetSdk >= 30
  assert.match(manifest, /<queries>[\s\S]*android\.speech\.RecognitionService[\s\S]*<\/queries>/);
  // y va FUERA de <application>: adentro el parser lo rechaza
  const queries = manifest.match(/<queries>[\s\S]*?<\/queries>/)[0];
  const app = manifest.indexOf('<application');
  assert.ok(manifest.indexOf('<queries>') < app, '<queries> tiene que ir antes de <application>');
});

test('el manifiesto declara también el motor de TTS', () => {
  assert.match(manifest, /<intent>\s*<action android:name="android\.intent\.action\.TTS_SERVICE"\s*\/>\s*<\/intent>/);
});

test('targetSdk 30 o más: sin esto el fallo se dispara siempre', () => {
  const t = read('app/build.gradle.kts');
  assert.match(t, /targetSdk\s*=?\s*(3[0-9]|[4-9][0-9])/, 'targetSdk tiene que ser >= 30 para que el bug sea real');
});

/* ================= 1b · la wake word local escucha el comando ================= */

test('al detectar «Kiu» la wake word abre el micrófono, no solo un toast', () => {
  assert.match(ww, /MainActivity\.wakeHitAndListen\(/,
    'WakeWordEngine.check() tiene que pedir el comando, no solo avisar que te escuchan');
  const c = sinComentarios(cuerpo(main, 'static void wakeHitAndListen('));
  assert.match(c, /nexoWakeHit\(\)/, 'primero avisa que te escucha');
  assert.match(c, /startSpeech\(\)/, 'después abre el micrófono del comando');
  assert.ok(c.indexOf('nexoWakeHit()') < c.indexOf('startSpeech()'));
  // y no lo ata al modo manos libres: decir «Kiu» tiene que abrir el micro aunque
  // el toggle esté apagado (lo que sigue escuchando después sí lo decide ese toggle)
  assert.doesNotMatch(c, /handsFree/, 'la wake word no depende del toggle de manos libres');
});

test('la wake word cede el micrófono mientras el comando se escucha', () => {
  // hay un solo micro: Vosk y el reconocedor del comando no pueden estar los dos
  assert.match(main, /public static volatile boolean COMMAND_BUSY/);
  assert.match(ww, /MainActivity\.COMMAND_BUSY/,
    'el bucle de Vosk tiene que ver si el reconocedor del comando tiene el micro');
  assert.match(ww, /public void pause\(\)/);
  assert.match(ww, /public void resume\(\)/);
  // MainActivity pausa al abrir el comando…
  const abrir = sinComentarios(cuerpo(main, 'public void startSpeech()'));
  assert.match(abrir, /WakeWordEngine\.get\(\)\.pause\(\)/);
  assert.match(abrir, /COMMAND_BUSY = true/);
  // …y se lo devuelve al soltarlo, y siempre (también en la rama 'unavailable',
  // si no el micro queda en manos de nadie para siempre)
  const libre = sinComentarios(cuerpo(main, 'private void commandMicFree()'));
  assert.match(libre, /COMMAND_BUSY = false/);
  assert.match(libre, /ww\.resume\(\)/);
  assert.ok(abrir.indexOf('commandMicFree()') > -1);
});

test('el bucle de Vosk no gira al 100 % de CPU cuando el micro no lee', () => {
  /* El read-loop se movió a escucharUnaVez() cuando se le agregó la
     reconstrucción del AudioRecord, así que el test tiene que mirar ahí y no
     en un tramo de texto que ya no existe. El invariante NO cambió: cuando
     read() devuelve <= 0 y no es un error de micro, hay que ceder el hilo. */
  const loop = sinComentarios(cuerpo(ww, 'private int escucharUnaVez'));
  assert.match(loop, /if \(n <= 0\)/, 'tiene que seguir tratando el n <= 0');
  assert.doesNotMatch(loop, /if \(n <= 0\) \{\s*continue;\s*\}/,
    'read() <= 0 con continue a secas es un busy-spin infinito');
  assert.match(loop, /dormir\(/, 'tiene que ceder el hilo');
  /* y el helper al que llama tiene que dormir de verdad, no solo devolver */
  const d = sinComentarios(cuerpo(ww, 'private boolean dormir'));
  assert.match(d, /Thread\.sleep/, 'el helper tiene que dormir de verdad');
  assert.match(d, /catch \(InterruptedException/, 'y InterruptedException devuelve false, no se traga');
});

test('la wake word local se elige sola si el modelo está instalado', () => {
  // antes solo ocurría con la pref wwLocal puesta, y solo kiuWWStart() la ponía, y la UI
  // nunca llamaba a kiuWWStart → el motor local era código muerto
  const c = sinComentarios(cuerpo(main, 'public void startWakeNow()'));
  assert.match(c, /wwLocal[\s\S]{0,80}\|\|[\s\S]{0,60}WakeWordEngine\.modelPresent/);
});

test('wakeState() pregunta a los dos motores, no solo al servicio', () => {
  assert.match(main, /public boolean wakeState\(\)[\s\S]{0,400}WakeWordEngine\.get\(\)\.isRunning\(\)/);
  assert.match(main, /public boolean wakeState\(\)[\s\S]{0,600}KiuService\.ACTIVE/);
});

test('si no hay motor de voz, se avisa en vez de fingir que está despierto', () => {
  const c = sinComentarios(cuerpo(main, 'public void startWakeNow()'));
  const i = c.indexOf('isRecognitionAvailable');
  assert.notEqual(i, -1, 'startWakeNow tiene que preguntar si hay motor de voz');
  assert.ok(c.indexOf('nexoWakeError', i) > i, 'y si no hay, avisar por el puente');
  assert.match(c, /putBoolean\("wake", false\)/, 'sin falsificar que Kiu está despierto');
  assert.match(ui, /window\.nexoWakeError\s*=/, 'la UI tiene que saber escuchar el error');
});

/* ================= 2 · la conversación continua no muere al primer turno ================= */

test('el rearme del micro no depende de _voiceDriven', () => {
  /* v2.14.7: botSay creció un parametro (sinVoz, para las tarjetas de error
     que no se leen en voz alta). El rearme del micro tiene que seguir adentro. */
  const bot = sinComentarios(cuerpo(ui, 'botSay: function (text, liveEl, sinVoz)'));
  assert.doesNotMatch(bot, /_voiceDriven/,
    'con _voiceDriven el bucle solo sobrevive si el usuario apretó el botón del micro');
  assert.match(bot, /if \(S\.conv\)/);
  assert.match(bot, /_convT/);
  assert.match(bot, /setTimeout[\s\S]{0,200}startVoice\(\)/);
});

test('nexoListenStart marca que el micrófono está ocupado', () => {
  // si no, el JS cree que está libre cuando lo tiene abierto el bucle de Java
  assert.match(ui, /window\.nexoListenStart = function \(\) \{ App\.voiceBusy = true;/);
});

test('no se abren dos reconocedores a la vez', () => {
  const c = sinComentarios(cuerpo(main, 'public void openConvMic()'));
  assert.match(c, /if \(COMMAND_BUSY\)\s*\{\s*return;\s*\}/);
});

test('el TTS termina y reabre el micrófono para el turno siguiente', () => {
  const onDone = sinComentarios(cuerpo(main, 'public void onDone(String str)'));
  assert.match(onDone, /SPEAKING = false/);
  assert.match(onDone, /convOpen/);
});

/* ================= 3 · el avatar del chat tiene caja ================= */

/* Resolutor de cascada mínimo: alcanza para el contrato que importa acá
   (qué width/height/--kav-s gana para un host), no para pintar la pantalla. */
function cascada(host) {
  // los comentarios del CSS se sacan antes de parsear: explain() menciona
  // `[data-avatar]{width:var(--kav-s)}` y sus llaves falsean el parseo de reglas
  const plan = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const reglas = [...plan.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
  function calza(sel) {
    return sel.split(',').some((raw) => {
      const s = raw.trim();
      if (!s || /:(hover|active|focus|not|root)/.test(s)) return false;
      const partes = s.split(/\s+/);
      const ultima = partes[partes.length - 1];
      const tags = [...ultima.matchAll(/^[a-z][\w-]*/gi)].map((x) => x[0].toLowerCase());
      if (tags.length && tags[0] !== host.tag) return false;
      const ids = [...ultima.matchAll(/#([\w-]+)/g)].map((x) => x[1]);
      const clases = [...ultima.matchAll(/\.([\w-]+)/g)].map((x) => x[1]);
      const attrs = [...ultima.matchAll(/\[([\w-]+)/g)].map((x) => x[1]);
      return ids.every((i) => i === host.id)
        && clases.every((c) => host.cls.includes(c))
        && attrs.every((a) => a === host.attr);
    });
  }
  const out = {};
  for (const r of reglas) {
    if (!calza(r.sel)) continue;
    for (const d of r.body.split(';')) {
      const i = d.indexOf(':');
      if (i < 0) continue;
      out[d.slice(0, i).trim()] = d.slice(i + 1).trim();
    }
  }
  return out;
}

const hosts = [...html.matchAll(/<(\w+)([^>]*data-avatar(?:-mini)?[^>]*)>/g)].map((m) => ({
  tag: m[1].toLowerCase(),
  id: (m[2].match(/id="([^"]+)"/) || [])[1],
  cls: ((m[2].match(/class="([^"]+)"/) || [])[1] || '').split(/\s+/).filter(Boolean),
  attr: /data-avatar-mini/.test(m[2]) ? 'data-avatar-mini' : 'data-avatar',
}));

test('el HTML declara los huecos del bot', () => {
  assert.equal(hosts.length, 6);
  assert.deepEqual(hosts.map((h) => h.id), ['brand-avatar', 'hero-avatar', 'chat-avatar', 'profile-avatar', 'about-avatar', 'vp-avatar']);
});

test('TODO hueco del bot tiene caja propia en el CSS', () => {
  for (const h of hosts) {
    const d = cascada(h);
    assert.match(d.width || '', /^var\(--kav-s\)$/, `#${h.id} necesita width: var(--kav-s)`);
    assert.match(d.height || '', /^var\(--kav-s\)$/, `#${h.id} necesita height: var(--kav-s)`);
    assert.match(d['--kav-s'] || '', /^\d+px$/, `#${h.id} necesita un --kav-s en px`);
  }
});

test('el hueco del chat es el del chat, no el del mini', () => {
  // el host del chat es `kav-mini kav-big`: si el tamaño cuelga de la clase, gana la
  // última del archivo y se queda en el del mini
  const chat = hosts.find((h) => h.id === 'chat-avatar');
  assert.equal(cascada(chat)['--kav-s'], '44px');
  assert.equal(cascada(hosts.find((h) => h.id === 'profile-avatar'))['--kav-s'], '54px');
});

test('el tamaño lo lee el CSS, no una lista de números en el JS', () => {
  assert.match(av, /function declaredSize\(host\)/);
  assert.match(av, /getPropertyValue\('--kav-s'\)/);
  assert.doesNotMatch(av, /id==='chat-avatar'\?64/, 'el fallback por id ya no manda la medida');
  // y el piso no puede ser más grande que el hueco chico
  assert.match(av, /return Math\.max\(30,Math\.min\(200,s\)\)/);
  assert.match(av, /resize:function\(px\)\{if\(!px\|\|px<30\)return/);
});

test('refit no se salta los hosts sin layout (pantalla oculta)', () => {
  const f = boot.slice(boot.indexOf('function refit()'), boot.indexOf('/* ---------- 2) arranque'));
  assert.doesNotMatch(f, /continue;\s*\}\s*\n\s*var s =/, 'un host con rect 0x0 quedaba con el tamaño de emergencia para siempre');
  assert.match(f, /KiuAvatar\.declaredSize\s*\?/, 'refit cae al --kav-s del CSS cuando no hay layout');
});

test('el boot monta los minis con la medida del hueco, no con números fijos', () => {
  assert.doesNotMatch(boot, /var sz = \(els\[i\]\.id === 'about-avatar'\) \? 42 : 36/);
  assert.match(boot, /KiuAvatar\.mount\(els\[i\], \{\}\)/);
});

test('no quedan reglas del avatar muerto (el .kav que dimensionaba en px)', () => {
  assert.doesNotMatch(css, /\.kav-svg/, 'el robot viejo de pantalla LED se fue en 2.7.0');
  assert.doesNotMatch(css, /\.kav-hero\.kav|\.kav-mini\.kav/, 'selectores .kav sin ningún elemento que los use');
  assert.doesNotMatch(html, /class="logo-mini/, 'el cuadrito con degradado pisaba el ancho del hueco');
});
