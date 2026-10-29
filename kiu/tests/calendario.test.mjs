/* calendario.test.mjs — v2.9.0: leer la agenda.
 *
 * Kiu ya sabía escribir eventos (addCalendarEvent abre el calendario del sistema)
 * pero no leerlos, así que "¿qué tengo mañana?" no tenía respuesta. Esto fija el
 * contrato de los tres saltos quehad que hacer falta:
 *
 *   1. MainActivity.calendarList()  → JSON, o "NEED_PERM"
 *   2. App.calendarQuery()         → parsea ese JSON y propaga el NEED_PERM
 *   3. KiuBrain                     → reconoce la pregunta, pide la ventana correcta
 *                                    y arma una respuesta que no mienta
 *
 * El punto 3 es el que más puede mentir: si el permiso no está, la respuesta tiene
 * que decirlo, no devolver una agenda vacía (que el usuario lee como "no tenés
 * nada", que es un falsehood peor que un error).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const here = path.dirname(fileURLToPath(import.meta.url));
const WWW = path.join(here, '..', 'app', 'src', 'main', 'assets', 'www');
const brainSrc = readFileSync(path.join(WWW, 'js', 'brain.js'), 'utf8');
const mainJava = readFileSync(path.join(here, '..', 'app', 'src', 'main', 'java', 'com', 'kiu', 'agent', 'MainActivity.java'), 'utf8');
const manifest = readFileSync(path.join(here, '..', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
const uiSrc = readFileSync(path.join(WWW, 'js', 'app', 'app-ui.js'), 'utf8');
const morningJava = readFileSync(path.join(here, '..', 'app', 'src', 'main', 'java', 'com', 'kiu', 'agent', 'MorningReceiver.java'), 'utf8');

/* Reloj congelado: "qué tengo mañana" depende de qué día sea hoy. Arranco en un
   miércoles a las 10:00 hora local, así los casos de día de la semana tienen un
   "hoy" inequívoco y los vetting de la ventana son verificables. */
const HOY = '2026-10-14T10:00:00';   // miércoles

function cargar(opts = {}) {
  const fixed = new Date(HOY).getTime();
  /* v2.9.0: `window === global`, como en el WebView. El harness viejo
     (brain.test.mjs) usaba `{window:{}}`, o sea un objeto aparte: ahí cualquier
     referencia pelada a `KiuApp` es ReferenceError y el try/catch se la come.
     Por eso brain.test.mjs nunca exercises las ramas que usan KiuApp — contactos,
     acciones del dispositivo — sin que se notara. Acá el modelo es fiel. */
  const ctx = {};
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.crypto = globalThis.crypto;
  class FrozenDate extends Date {
    constructor(...a) { if (a.length) super(...a); else super(fixed); }
    static now() { return fixed; }
  }
  ctx.Date = FrozenDate;

  const agenda = opts.agenda || [];
  const permiso = opts.permiso !== false;
  const pedidos = [];

  ctx.window.KiuApp = {
    bridgeCall: () => true,
    shareText() { },
    setName() { },
    clearChat() { },
    sysCache: null,
    askPerm: (w) => { pedidos.push(w); },
    contactSearch: () => [],
    calendarQuery(q, from, to) {
      pedidos.push({ q, from, to });
      if (!permiso) return 'NEED_PERM';
      return agenda.filter((e) => e.b >= from && e.b < to
        && (!q || (e.t || '').toLowerCase().includes(q.toLowerCase())
                 || (e.w || '').toLowerCase().includes(q.toLowerCase())));
    },
  };
  vm.createContext(ctx);
  vm.runInContext(brainSrc, ctx, { filename: 'brain.js' });
  return { brain: ctx.KiuBrain, pedidos, KiuApp: ctx.KiuApp };
}

const d = (y, m, dd, h = 0, mi = 0) => new Date(y, m - 1, dd, h, mi).getTime();

/* ================= 1 · el puente Java ================= */

test('el manifiesto pide READ_CALENDAR (solo lectura)', () => {
  assert.match(manifest, /<uses-permission android:name="android\.permission\.READ_CALENDAR"\/>/);
  assert.doesNotMatch(manifest, /WRITE_CALENDAR/, 'no se escribe directo: se usa el Intent INSERT del sistema');
});

test('calendarList devuelve JSON y propaga NEED_PERM', () => {
  const c = mainJava.slice(
    mainJava.indexOf('public String calendarList('),
    mainJava.indexOf('public boolean addCalendarEvent('),
  );
  assert.match(c, /checkSelfPermission\("android\.permission\.READ_CALENDAR"\)/);
  assert.ok(c.indexOf('return "NEED_PERM"') > -1);
  assert.match(c, /return arr\.toString\(\)/);
  assert.match(c, /catch \(Exception unused\) \{\s*return "\[\]"/, 'un fallo es una agenda vacía, no una excepción');
});

test('calendarList consulta Instances con rango y con texto', () => {
  const c = mainJava.slice(
    mainJava.indexOf('public String calendarList('),
    mainJava.indexOf('public boolean addCalendarEvent('),
  );
  assert.match(c, /CalendarContract\.Instances\.CONTENT_URI/);
  assert.match(c, /begin >= \? AND begin < \?/, 'sin texto: lo que empieza en la ventana');
  assert.match(c, /title LIKE \? OR event_location LIKE \?/, 'con texto: busca en título y lugar');
  assert.match(c, /deleted = 0/);
  assert.match(c, /arr\.length\(\) < 40/, 'tope: una agenda con 5000 eventos no es información, es ruido');
  assert.match(c, /60L \* 86400000L/, 'la ventana no se pide más lejos de 60 días aunque se le pase una torre');
});

test('el permiso de agenda tiene su propio request code y su handler', () => {
  assert.match(mainJava, /private static final int REQ_CALENDAR = 4245;/);
  assert.match(mainJava, /"calendar"\.equals\(str\)[\s\S]{0,200}READ_CALENDAR/);
  assert.match(mainJava, /i == REQ_CALENDAR/);
  assert.match(mainJava, /nexoPerm\('"/, 'avisa a la UI en vez de pedir que repitan la pregunta');
});

/* ================= 2 · la capa de la UI ================= */

test('App.calendarQuery parsea el JSON y propaga NEED_PERM', () => {
  assert.match(uiSrc, /calendarQuery: function \(q, fromMs, toMs\)/);
  const c = uiSrc.slice(uiSrc.indexOf('calendarQuery: function'), uiSrc.indexOf('askPerm: function'));
  assert.match(c, /BR\.calendarList/);
  assert.match(c, /if \(r === 'NEED_PERM'\) return 'NEED_PERM'/);
  assert.match(c, /JSON\.parse/);
  assert.ok(c.indexOf('if (r === \'NEED_PERM\')') < c.indexOf('JSON.parse'), 'el NEED_PERM no puede comérselo el parse');
});

test('la UI avisa el resultado del permiso de agenda', () => {
  assert.match(uiSrc, /what === 'calendar'/);
  assert.match(uiSrc, /Permiso de agenda concedido/);
});

/* ================= 3 · los intents ================= */

test('"¿qué tengo mañana?" trae lo de mañana, no lo de hoy', () => {
  const evts = [
    { t: 'Dentista', b: d(2026, 10, 14, 9, 0), e: d(2026, 10, 14, 10, 0), w: '' },   // HOY
    { t: 'Reunión equipo', b: d(2026, 10, 15, 11, 0), e: d(2026, 10, 15, 12, 0), w: 'Sala 3' }, // MAÑANA
  ];
  const { brain } = cargar({ agenda: evts });
  const r = brain.reply('¿qué tengo mañana?');
  assert.equal(r.handled, true);
  assert.match(r.text, /Reunión equipo/);
  assert.doesNotMatch(r.text, /Dentista/, 'el evento de hoy no va en la respuesta de mañana');
  assert.match(r.text, /Sala 3/, 'incluye el lugar');
  assert.match(r.text, /11:00/, 'incluye la hora');
});

test('"¿qué tengo hoy?" y "mañana" devuelven ventanas distintas', () => {
  const evts = [
    { t: 'Dentista', b: d(2026, 10, 14, 9, 0), e: d(2026, 10, 14, 10, 0), w: '' },
    { t: 'Gimnasio', b: d(2026, 10, 15, 19, 0), e: d(2026, 10, 15, 20, 0), w: '' },
  ];
  const h = cargar({ agenda: evts }).brain.reply('¿qué tengo hoy?');
  const m = cargar({ agenda: evts }).brain.reply('¿qué tengo mañana?');
  assert.match(h.text, /Dentista/);
  assert.doesNotMatch(h.text, /Gimnasio/);
  assert.match(m.text, /Gimnasio/);
  assert.doesNotMatch(m.text, /Dentista/);
});

test('el día de la semana resuelve bien desde el miércoles', () => {
  const evts = [
    { t: 'Jueves gym', b: d(2026, 10, 15, 8, 0), e: d(2026, 10, 15, 9, 0), w: '' },
    { t: 'ViernesDentista', b: d(2026, 10, 16, 9, 0), e: d(2026, 10, 16, 10, 0), w: '' },
    { t: 'Domingo cena', b: d(2026, 10, 18, 21, 0), e: d(2026, 10, 18, 23, 0), w: '' },
  ];
  const r = cargar({ agenda: evts }).brain.reply('¿tengo algo el viernes?');
  assert.match(r.text, /ViernesDentista/);
  assert.doesNotMatch(r.text, /Jueves gym/);
  const d2 = cargar({ agenda: evts }).brain.reply('¿qué tengo el domingo?');
  assert.match(d2.text, /Domingo cena/);
});

test('sin permiso NO dice "no tenés nada" (sería mentir)', () => {
  const { brain, pedidos } = cargar({ permiso: false, agenda: [{ t: 'X', b: d(2026, 10, 15, 9), e: d(2026, 10, 15, 10), w: '' }] });
  const r = brain.reply('¿qué tengo mañana?');
  assert.equal(r.handled, true);
  assert.match(r.text, /permiso de calendario/i);
  assert.doesNotMatch(r.text, /no tenés nada|no tenes nada/i,
    'devolver una agenda vacía cuando falta el permiso hace creer al usuario que no tiene eventos');
  assert.equal(pedidos.filter((x) => x === 'calendar').length, 1, 'y pide el permiso exactamente una vez');
  assert.equal(pedidos.length, 2, 'una consulta + un pedido de permiso, nada más');
});

test('agenda vacía de verdad sí lo dice', () => {
  const { brain } = cargar({ agenda: [] });
  const r = brain.reply('¿qué tengo mañana?');
  assert.match(r.text, /No tenés nada agendado mañana|Nada agendado para mañana/i);
});

test('la búsqueda por contenido encuentra el evento', () => {
  const evts = [
    { t: 'Dentista', b: d(2026, 10, 15, 9, 0), e: d(2026, 10, 15, 10, 0), w: '' },
    { t: 'Gimnasio', b: d(2026, 10, 15, 19, 0), e: d(2026, 10, 15, 20, 0), w: '' },
  ];
  const r = cargar({ agenda: evts }).brain.reply('¿tengo dentista mañana?');
  assert.equal(r.handled, true);
  assert.match(r.text, /Dentista/);
  assert.doesNotMatch(r.text, /Gimnasio/);
});

test('la agenda no se come las preguntas que no son de la agenda', () => {
  const { brain } = cargar({ agenda: [] });
  /* esto debe seguir yendo a donde iba antes */
  assert.equal(brain.reply('¿qué hora es?').handled, true);
  assert.equal(brain.reply('enciende la linterna').handled, true);
  const buscar = brain.reply('busca gatos en youtube');
  assert.equal(buscar.handled, true);
  assert.doesNotMatch(buscar.text, /agenda/i);
});

test('avisa cuando hay más de 8 eventos', () => {
  const evts = [];
  for (let i = 0; i < 12; i++) {
    evts.push({ t: 'Evento ' + i, b: d(2026, 10, 15, 8 + i, 0), e: d(2026, 10, 15, 8 + i, 30), w: '' });
  }
  const r = cargar({ agenda: evts }).brain.reply('¿qué tengo mañana?');
  assert.match(r.text, /y 4 más/, 'no corta la lista en silencio: dice how many hay');
  assert.match(r.text, /a las 08:00/, 'y dice cuándo empieza el primero (con cero adelante: es una hora de reloj)');
});

/* ================= 4 · el resumen matutino ================= */

// El bloque va del comentario que lo anuncia hasta el de la bateria: asi el test
// no depende de que la linea que lo cierra siga siendo la de siempre.
function bloqueAgenda() {
  return morningJava.slice(
    morningJava.indexOf('v2.9.0: la agenda del día'),
    morningJava.indexOf('/* batería */'),
  );
}

test('el resumen de la mañana incluye la agenda del día', () => {
  const c = bloqueAgenda();
  assert.match(c, /checkSelfPermission\("android\.permission\.READ_CALENDAR"\) == 0/,
    'sin permiso el resumen se arma igual: no le pide nada a nadie a las 8am');
  assert.match(c, /CalendarContract\.Instances\.CONTENT_URI/);
  assert.match(c, /begin >= \? AND begin < \?/);
  assert.match(c, /en < 5/, 'tope: cinco cosas en un resumen, no veinte');
  assert.match(c, /Agenda de hoy/);
});

test('sin permiso el resumen NO dice "no tenés nada"', () => {
  const c = bloqueAgenda();
  const iIf = c.indexOf('if (c.checkSelfPermission');
  const iUso = c.indexOf('sb.append("\\nAgenda de hoy');
  assert.ok(iIf > -1, 'el bloque arranca con el chequeo de permiso');
  assert.ok(iUso > iIf, 'y lo que imprime la agenda está adentro de ese if, no antes');
  assert.doesNotMatch(c, /else[^{]*\{[^}]*Agenda/, 'no hay una rama "si no tenés permiso → no tenés nada"');
  /* y el "No tengo recordatorios" de arriba sigue siendo incondicional: es un
     hecho sobre los recordatorios de Kiu, no sobre el calendario del sistema */
  const rec = morningJava.indexOf('No tengo recordatorios');
  const agenda = morningJava.indexOf('v2.9.0: la agenda del día');
  assert.ok(rec > -1 && rec < agenda);
});
