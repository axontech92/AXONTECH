// Supabase avisó el 29/09: "Log Ingestion 1.52 / 1 GB", por encima del plan
// gratis. Cada petición deja un registro y cada teléfono abierto hacía 3 cada
// 5 segundos. v137: una sola pregunta por vuelta (ultimos_cambios) y un ritmo
// más lento cuando nadie toca la app.
//
//   NODE_PATH=$(npm root -g) node pruebas/prueba_menos_peticiones.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const RAIZ = '/home/user/AXONTECH';
const MIME = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'};
const srv = http.createServer((q, r) => {
  const ruta = q.url.split('?')[0];
  if (ruta.endsWith('/data.json')) { r.writeHead(200, {'Content-Type':'application/json'});
    return r.end('{"gestores":[],"mensajeros":[],"productos":[],"categorias":[]}'); }
  const p = path.join(RAIZ, decodeURIComponent(ruta));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, {'Content-Type': MIME[path.extname(p)] || 'text/plain'});
  r.end(fs.readFileSync(p));
});
let fallos = 0;
const ok = (n, c, e) => { console.log((c?'✅ ':'❌ ')+n+(c?'':'  → '+JSON.stringify(e))); if(!c) fallos++; };


const T0 = '2026-09-29T06:14:20.661123+00:00';
let RPC = true;              // ¿está instalada la función?
let PETICIONES = [];
(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const nav = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const errores = [];
  const ctx = await nav.newContext({viewport:{width:1280,height:1400}});
  await ctx.route('**/*', r => {
    const url = r.request().url();
    if (url.includes('127.0.0.1')) return r.continue();
    if (url.includes('supabase.co')) PETICIONES.push(r.request().method() + ' ' + url.replace(/^.*\/rest\/v1\//, ''));
    if (url.includes('/rpc/ultimos_cambios')) {
      if (!RPC) return r.fulfill({ status: 404, contentType: 'application/json', body: '{}', headers: {'Access-Control-Allow-Origin':'*'} });
      return r.fulfill({ status: 200, contentType: 'application/json', headers: {'Access-Control-Allow-Origin':'*'},
        body: JSON.stringify({ vales: T0, vales_gestor: null, gestores: T0, mensajeros: T0, productos: T0, categorias: T0,
                               meta: { notifs: T0, vales_borrados: T0, config: T0 } }) });
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: '[]', headers: {'Access-Control-Allow-Origin':'*'} });
  });
  const p = await ctx.newPage();
  p.on('pageerror', e => errores.push(String(e).slice(0,200)));
  await p.goto(base + '/admin.html', {waitUntil:'domcontentloaded'});
  await p.waitForTimeout(2400);
  await p.fill('#passInput','axon2024'); await p.click('button:has-text("Entrar")'); await p.waitForTimeout(1500);
  await p.evaluate(() => { try { clearInterval(_restPollTimer); } catch(e) {} });
  await p.waitForTimeout(1500);

  console.log('══ 1· LAS HORAS SE COMPARAN BIEN (microsegundos incluidos) ══');
  const ts = await p.evaluate(() => ({
    igual: _tsMicro('2026-09-29T06:14:20.661123+00:00') === _tsMicro('2026-09-29T06:14:20.661123+00:00'),
    micro: _tsMicro('2026-09-29T06:14:20.661124+00:00') > _tsMicro('2026-09-29T06:14:20.661123+00:00'),
    zulu:  _tsMicro('2026-09-29T06:14:20.661Z') === _tsMicro('2026-09-29T06:14:20.661000+00:00'),
    sinFr: _tsMicro('2026-09-29T06:14:20+00:00') < _tsMicro('2026-09-29T06:14:20.000001+00:00'),
    malo:  _tsMicro('basura') }));
  ok('iguales, un µs más, Z y +00:00, sin fracción', ts.igual && ts.micro && ts.zulu && ts.sinFr && ts.malo === null, ts);

  console.log('\n══ 2· CON LA FUNCIÓN: UNA SOLA PETICIÓN POR VUELTA SI NO CAMBIA NADA ══');
  const prepara = (T0) => {
    _ultimaTsVisto.vales = T0; _ultimaTsVisto['meta:notifs'] = T0; _ultimaTsVisto['meta:vales_borrados'] = T0;
    const ahora = Date.now();
    _ultimoFetchReal.vales = ahora; _ultimoFetchReal['meta:notifs'] = ahora; _ultimoFetchReal['meta:vales_borrados'] = ahora;
    _ultimoPollLento = ahora;
  };
  await p.evaluate(prepara, T0);
  PETICIONES = [];
  await p.evaluate(async () => { await _doRestPoll(); });
  ok('una vuelta sin cambios = 1 petición (antes 3)', PETICIONES.length === 1 && /rpc\/ultimos_cambios/.test(PETICIONES[0]), PETICIONES);

  console.log('\n══ 3· SI ALGO CAMBIÓ, SE BAJA ESO ══');
  await p.evaluate(prepara, T0);
  await p.evaluate(() => { _ultimaTsVisto['meta:notifs'] = '2026-09-29T06:14:20.661122+00:00'; });   // 1 µs antes
  PETICIONES = [];
  await p.evaluate(async () => { await _doRestPoll(); });
  ok('los avisos cambiaron → se bajan, y nada más', PETICIONES.length === 2 && PETICIONES.some(x => /meta\?.*notifs/.test(x) && !/updated_at=gt/.test(x)), PETICIONES);

  console.log('\n══ 4· SIN LA FUNCIÓN INSTALADA, COMO ANTES ══');
  RPC = false;
  await p.evaluate(prepara, T0);
  await p.evaluate(() => { _cambiosRpc = null; });
  PETICIONES = [];
  await p.evaluate(async () => { await _doRestPoll(); });
  ok('pregunta, ve el 404 y hace las preguntas sueltas', PETICIONES[0].includes('ultimos_cambios') && PETICIONES.filter(x => /updated_at=gt/.test(x)).length === 3, PETICIONES);
  PETICIONES = [];
  await p.evaluate(prepara, T0);
  await p.evaluate(async () => { await _doRestPoll(); });
  ok('y no vuelve a llamar a la función que no existe', !PETICIONES.some(x => x.includes('ultimos_cambios')), PETICIONES);
  RPC = true;
  await p.evaluate(() => { _cambiosRpc = null; });

  console.log('\n══ 5· EL RITMO ══');
  const ritmo = await p.evaluate(() => {
    const r = {};
    _ultimoCambioVisto = 0;
    _ultimaActividad = Date.now();                 r.usando = _ritmoPoll();
    _ultimaActividad = Date.now() - 5 * 60000;     r.cincoMin = _ritmoPoll();
    _ultimaActividad = Date.now() - 20 * 60000;    r.veinteMin = _ritmoPoll();
    _ultimoCambioVisto = Date.now();               r.llegoAlgo = _ritmoPoll();
    _ultimoCambioVisto = 0;
    return r;
  });
  ok('10 s usándola, 30 s tras 2 min, 60 s tras 15 min', ritmo.usando === 10000 && ritmo.cincoMin === 30000 && ritmo.veinteMin === 60000, ritmo);
  ok('si acaba de llegar un cambio, vuelve a 10 s', ritmo.llegoAlgo === 10000, ritmo);

  console.log('\n══ 6· EN LA PRÁCTICA: QUIETA NO PREGUNTA; AL TOCARLA, SÍ ══');
  await p.evaluate((T0) => {
    _ultimaActividad = Date.now() - 20 * 60000; _ultimoCambioVisto = 0; _ultimoPollHecho = Date.now();
    _restPollTimer = setInterval(_tickPoll, _REST_POLL_MS);
  }, T0);
  PETICIONES = [];
  await p.waitForTimeout(16000);
  ok('16 s quieta tras una vuelta: ninguna petición (antes ~9)', PETICIONES.length === 0, PETICIONES);
  await p.mouse.click(5, 5);
  await p.waitForTimeout(1500);
  ok('al tocarla pregunta en el acto', PETICIONES.some(x => x.includes('ultimos_cambios')), PETICIONES);
  await p.evaluate(() => clearInterval(_restPollTimer));

  console.log('\n══ ERRORES DE JAVASCRIPT ══');
  ok('ninguno', !errores.length, errores);
  console.log(fallos ? `\n❌ ${fallos} fallo(s)` : '\n✅ todo correcto');
  await nav.close(); srv.close(); process.exit(fallos ? 1 : 0);
})();
