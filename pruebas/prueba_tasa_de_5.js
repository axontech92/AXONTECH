// La tasa siempre de 5 en 5: el pico sube a partir de 3.
//
//   NODE_PATH=$(npm root -g) node pruebas/prueba_tasa_de_5.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const RAIZ = '/home/user/AXONTECH';
const MIME = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'};
const srv = http.createServer((q, r) => {
  const p = path.join(RAIZ, decodeURIComponent(q.url.split('?')[0]));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, {'Content-Type': MIME[path.extname(p)] || 'text/plain'});
  r.end(fs.readFileSync(p));
});
let fallos = 0;
const ok = (n, c, e) => { console.log((c?'✅ ':'❌ ')+n+(c?'':'  → '+JSON.stringify(e))); if(!c) fallos++; };

(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const nav = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const ctx = await nav.newContext({viewport:{width:430,height:1200}});
  await ctx.route('**/*', r => r.request().url().includes('127.0.0.1')
    ? r.continue() : r.fulfill({status:200, body:'[]'}));
  const p = await ctx.newPage();
  const errores = [];
  p.on('pageerror', e => errores.push(String(e).slice(0,200)));
  await p.goto(`http://127.0.0.1:${srv.address().port}/admin.html`, {waitUntil:'domcontentloaded'});
  await p.waitForTimeout(2400);
  await p.fill('#passInput','axon2024');
  await p.click('button:has-text("Entrar")');
  await p.waitForTimeout(900);
  await p.evaluate(() => { try { clearInterval(_restPollTimer); } catch(e) {} });

  // Se pone la tasa "de elToque" a mano, sin margen, y se mira qué enseña.
  const conTasa = async (valor, margen) => await p.evaluate(([v, m]) => {
    try { localStorage.removeItem('axon_tasa_usd'); } catch(e) {}
    saveConfig({...getConfig(), tasaUSD:v, tasaUSDTs:Date.now(), tasaUSDFuente:'elToque', tasaMargen:m||0});
    return tasaUSDFinal();
  }, [valor, margen||0]);

  console.log('══ EL PICO SUBE A PARTIR DE 3 ══');
  const casos = [
    [680, 680], [681, 680], [682, 680],   // pico 0,1,2 → baja
    [683, 685], [684, 685],               // pico 3,4   → sube
    [685, 685], [686, 685], [687, 685], [688, 690], [689, 690], [690, 690],
  ];
  for (const [entra, sale] of casos) {
    const r = await conTasa(entra);
    ok(`${entra} → ${sale}`, r === sale, r);
  }

  console.log('\n══ CON DECIMALES ══');
  ok('692,24 → 690', await conTasa(692.24) === 690, await conTasa(692.24));
  ok('687,50 → 685 (el pico es 2,5, todavía no llega a 3)',
     await conTasa(687.5) === 685, await conTasa(687.5));
  ok('688,10 → 690', await conTasa(688.1) === 690, await conTasa(688.1));

  console.log('\n══ EL AJUSTE SE SUMA ANTES DE REDONDEAR ══');
  ok('665 + 10 = 675 → 675', await conTasa(665, 10) === 675, await conTasa(665, 10));
  ok('682 + 10 = 692 → 690', await conTasa(682, 10) === 690, await conTasa(682, 10));
  ok('678 + 5 = 683 → 685', await conTasa(678, 5) === 685, await conTasa(678, 5));
  ok('un ajuste negativo también: 690 − 7 = 683 → 685',
     await conTasa(690, -7) === 685, await conTasa(690, -7));

  console.log('\n══ NUNCA UN NÚMERO CON PICO ══');
  const todos = [];
  for (let v = 600; v <= 720; v++) todos.push(await conTasa(v));
  ok('ninguna de 121 tasas seguidas acaba en otra cosa que 0 o 5',
     todos.every(n => n % 5 === 0), todos.filter(n => n % 5 !== 0).slice(0,5));
  ok('y ninguna se aleja más de 2 de la real',
     todos.every((n, i) => Math.abs(n - (600 + i)) <= 2), 'alguna se fue lejos');

  console.log('\n══ LO QUE SE VE EN PANTALLA ══');
  const pantalla = await p.evaluate(() => {
    saveConfig({...getConfig(), tasaUSD:682, tasaUSDTs:Date.now(), tasaUSDFuente:'elToque', tasaMargen:10});
    renderTasaBadge(); openTasaModal();
    return { chip:(document.getElementById('tasaUSDValor')||{}).textContent||'',
             modal:(document.getElementById('tasaModalBody')||{}).textContent||'' };
  });
  ok('el chip de arriba enseña 690', /690/.test(pantalla.chip), pantalla.chip);
  ok('y el detalle explica de dónde sale',
     /682/.test(pantalla.modal) && /690/.test(pantalla.modal) && /5 en 5/.test(pantalla.modal),
     pantalla.modal.replace(/\s+/g,' ').slice(0,260));

  console.log('\n══ LAS CUENTAS USAN LA TASA REDONDEADA ══');
  const cuentas = await p.evaluate(() => {
    saveConfig({...getConfig(), tasaUSD:682, tasaUSDTs:Date.now(), tasaMargen:0});
    // 6800 MN a una tasa de 680 son 10 USD justos.
    return { tasa:tasaUSDFinal(), enUSD:_aUSD({usd:0, mn:6800}) };
  });
  ok('la tasa que usan las conversiones es la de 5 en 5', cuentas.tasa === 680, cuentas);
  ok('6800 MN son 10 USD, no 9,97', cuentas.enUSD === 10, cuentas);

  console.log('\n══ SIN TASA SIGUE SIN INVENTARSE NADA ══');
  const sin = await p.evaluate(() => {
    try { localStorage.removeItem('axon_tasa_usd'); } catch(e) {}
    saveConfig({...getConfig(), tasaUSD:0, tasaUSDTs:0, tasaMargen:0});
    return { fin:tasaUSDFinal(), conv:_aUSD({usd:0, mn:6800}) };
  });
  ok('sigue diciendo "no lo sé" en vez de cero', sin.fin === null && sin.conv === null, sin);

  console.log('\n══ ERRORES DE JAVASCRIPT ══');
  const graves = errores.filter(e => !/favicon|manifest|sw\.js|Failed to load resource|net::ERR/i.test(e));
  ok('ninguno', graves.length === 0, graves.slice(0,5));

  await nav.close(); srv.close();
  console.log('\n' + (fallos ? '❌ ' + fallos + ' fallo(s)' : '✅ todo correcto'));
  process.exit(fallos ? 1 : 0);
})();
