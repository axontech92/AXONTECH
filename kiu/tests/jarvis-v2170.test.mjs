/* jarvis-v2170.test.mjs — v2.17.0: segunda tanda "Jarvis".
 * Notificaciones, SMS, ubicación y música. Se prueba la parte JS contra un puente
 * nativo de mentira, y la parte Java con revisión de forma (el Java de Android no
 * compila sin SDK; la lógica pura de KiuNotifStore se EJECUTA en java.test-notif.mjs).
 * node --test tests/jarvis-v2170.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cargarAgente } from './evals/harness.mjs';

const RAIZ = path.join(process.cwd(), 'app/src/main');
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), 'utf8');

test('read_notifications: lista, filtra y pide acceso cuando falta', () => {
  const { A, puente } = cargarAgente();
  const t = A.get('read_notifications');
  const ok = t.run({});
  assert.equal(ok.ok, true);
  assert.match(ok.text, /WhatsApp — Ana: ¿vamos a cenar\?/);
  let pedido = null;
  puente.notifList = () => 'NEED_PERM';
  puente.requestPerm = (w) => { pedido = w; };
  const sin = t.run({});
  assert.equal(sin.ok, false);
  assert.match(sin.err, /Acceso a notificaciones/);
  assert.equal(pedido, 'notif', 'abre la pantalla de acceso a notificaciones');
  puente.notifList = () => '[]';
  assert.match(t.run({ from: 'Ana' }).text, /No encontré notificaciones de "Ana"/);
});

test('read_sms: lee, avisa sin permiso y es de solo lectura', () => {
  const { A, puente } = cargarAgente();
  const t = A.get('read_sms');
  assert.match(t.run({}).text, /BANCO: Tu código es 123456/);
  puente.smsList = () => 'NEED_PERM';
  assert.match(t.run({}).err, /permiso de SMS/);
  assert.equal(t.risk, 'read', 'leer SMS no pide confirmación de escritura');
});

test('media_control: manda la tecla, valida la acción, y falla honesto', () => {
  const { A, puente } = cargarAgente();
  const t = A.get('media_control');
  const vistas = [];
  puente.mediaKey = (a) => { vistas.push(a); return true; };
  assert.match(t.run({ action: 'next' }).text, /siguiente/);
  assert.deepEqual(vistas, ['next']);
  assert.equal(t.run({ action: 'saltar_al_infinito' }).ok, false);
  assert.equal(vistas.length, 1, 'una acción inválida no llega al puente');
  puente.mediaKey = () => false;
  assert.equal(t.run({ action: 'pause' }).ok, false);
});

test('get_weather sin ciudad usa la ubicación del teléfono; sin permiso lo pide', async () => {
  const { A, puente, ctx } = cargarAgente();
  const urls = [];
  const f0 = ctx.fetch;
  ctx.fetch = (u) => { urls.push(String(u)); return f0(u); };
  puente.locationGet = () => JSON.stringify({ lat: -12.04, lon: -77.03, acc: 900, t: 1 });
  const r = await A.get('get_weather').run({});
  assert.equal(r.ok, true);
  assert.match(r.text, /Hoy en tu ubicación/);
  assert.ok(urls.some((u) => u.includes('latitude=-12.04') && u.includes('longitude=-77.03')), 'va directo al pronóstico por coordenadas');
  assert.ok(!urls.some((u) => u.includes('geocoding')), 'sin geocodificar');
  let pedido = null;
  puente.locationGet = () => 'NEED_PERM';
  puente.requestPerm = (w) => { pedido = w; };
  const sin = await A.get('get_weather').run({});
  assert.equal(sin.ok, false);
  assert.equal(pedido, 'location');
});

test('selección: cada pedido nuevo cae en su herramienta', () => {
  const { A } = cargarAgente();
  assert.equal(A.seleccionar('qué notificaciones me llegaron')[0], 'read_notifications');
  assert.equal(A.seleccionar('leeme los sms del banco')[0], 'read_sms');
  assert.equal(A.seleccionar('pausá la música')[0], 'media_control');
});

/* ---- el lado Java: lo que se puede comprobar sin el SDK ---- */
test('el manifiesto declara los permisos y el servicio, y es XML válido', () => {
  const m = leer('AndroidManifest.xml');
  assert.match(m, /android\.permission\.READ_SMS/);
  assert.match(m, /android\.permission\.ACCESS_COARSE_LOCATION/);
  assert.doesNotMatch(m, /ACCESS_FINE_LOCATION/, 'para el clima alcanza con la ubicación aproximada');
  assert.match(m, /android:name="\.KiuNotifService"[\s\S]*?BIND_NOTIFICATION_LISTENER_SERVICE/,
    'el servicio tiene que exigir BIND_NOTIFICATION_LISTENER_SERVICE: sin eso cualquier app lo usa');
  assert.match(m, /android\.service\.notification\.NotificationListenerService/);
});

test('el puente expone los métodos nuevos y los permisos nuevos tienen camino', () => {
  const j = leer('java/com/kiu/agent/MainActivity.java');
  for (const f of ['notifAccess', 'notifList', 'smsList', 'locationGet', 'mediaKey']) {
    assert.match(j, new RegExp('@JavascriptInterface\\s+public \\w+ ' + f + '\\('), f + ' tiene que ser @JavascriptInterface');
  }
  assert.match(j, /"sms"\.equals\(str\)/);
  assert.match(j, /"location"\.equals\(str\)/);
  assert.match(j, /"notif"\.equals\(str\)/);
  assert.match(j, /i == REQ_SMS \|\| i == REQ_LOCATION/, 'la respuesta del permiso tiene que volver a JS');
  const mensajes = fs.readFileSync(path.join(RAIZ, 'assets/www/js/app/app-ui.js'), 'utf8');
  assert.match(mensajes, /what === 'sms'/);
  assert.match(mensajes, /what === 'location'/);
});

test('el servicio de notificaciones no persiste nada y usa el almacén acotado', () => {
  const s = leer('java/com/kiu/agent/KiuNotifService.java');
  assert.doesNotMatch(s, /SharedPreferences|openFileOutput|SQLite|FileWriter/, 'las notificaciones viven solo en RAM');
  assert.match(s, /FLAG_ONGOING_EVENT/);
  assert.match(s, /FLAG_GROUP_SUMMARY/);
  assert.match(leer('java/com/kiu/agent/KiuNotifStore.java'), /public static final int MAX = 40;/);
});
