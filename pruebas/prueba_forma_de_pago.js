// Pedido el 23/09: al llegar el vale al admin, poder apuntar cómo pagó el
// cliente — USD (por defecto, lo que dice el vale), Zelle, euro y MN — con el
// MN calculado a la tasa que ven todos (elToque + el ajuste de Config).
//
//   NODE_PATH=$(npm root -g) node pruebas/prueba_forma_de_pago.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const RAIZ = '/home/user/AXONTECH';
const MIME = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'};
const srv = http.createServer((q, r) => {
  const ruta = q.url.split('?')[0];
  if (ruta.endsWith('/data.json')) {
    r.writeHead(200, {'Content-Type':'application/json'});
    return r.end('{"gestores":[],"mensajeros":[],"productos":[],"categorias":[]}');
  }
  // La tasa que dejaría el trabajo de GitHub, ya con el euro.
  if (ruta.endsWith('/tasa.json')) {
    r.writeHead(200, {'Content-Type':'application/json'});
    return r.end(JSON.stringify({valor:720, fuente:'elToque', ts:Date.now(), eur:792, eurTs:Date.now()}));
  }
  const p = path.join(RAIZ, decodeURIComponent(ruta));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, {'Content-Type': MIME[path.extname(p)] || 'text/plain'});
  r.end(fs.readFileSync(p));
});
let fallos = 0;
const ok = (n, c, e) => { console.log((c?'✅ ':'❌ ')+n+(c?'':'  → '+JSON.stringify(e))); if(!c) fallos++; };

(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const nav = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const ctx = await nav.newContext({viewport:{width:1280,height:1400}});
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

  console.log('══ 1· LAS TASAS ══');
  const tasas = await p.evaluate(async () => {
    try { clearInterval(_restPollTimer); } catch(e) {}
    try { localStorage.removeItem('axon_tasa_usd'); localStorage.removeItem('axon_tasa_eur'); } catch(e) {}
    // Tasa del dólar 720 con +10 de ajuste en Config → 730.
    saveConfig({...getConfig(), tasaUSD:720, tasaUSDTs:Date.now(), tasaUSDFuente:'elToque', tasaMargen:10, tasaEUR:null, tasaEURTs:null});
    await actualizarTasaEUR(true);
    return { mn: tasaUSDFinal(), eur: (tasaEUR()||{}).valor, eurUSD: eurEnUSD(), enConfig: getConfig().tasaEUR };
  });
  ok('el MN sale a la tasa de todos: 720 + 10 = 730', tasas.mn === 730, tasas);
  ok('el euro se baja de tasa.json (792)', tasas.eur === 792, tasas);
  ok('1 EUR = 1.1 USD (792 / 720, sin el ajuste)', tasas.eurUSD === 1.1, tasas);
  ok('y el admin lo comparte en el config', tasas.enConfig === 792, tasas);

  await p.evaluate(() => {
    saveProductos([{id:901, name:'Laptop', stock:9, precio:'$100 USD', comision:'$10 USD'}]);
    saveGestores([{id:1, name:'Ana', initials:'A', color:'#2563EB'}]);
    saveNotifs([]);
    const t = new Date().toISOString();
    saveVales([
      {id:9001, valeNum:1, gestorId:1, status:'pending', ts:t, cliente:'Pedro',
       articulo:'×1 Laptop', valeProductos:[{id:901,name:'Laptop',qty:1}], total:'$100 USD', valeText:''},
      {id:9002, valeNum:2, gestorId:1, status:'pending', ts:t, cliente:'Luis',
       articulo:'×1 Laptop', valeProductos:[{id:901,name:'Laptop',qty:1}], mensajeria:'500 MN',
       total:'$100 USD + 500 MN', valeText:''},
      {id:9003, valeNum:3, gestorId:1, status:'pending', ts:t, cliente:'Rosa',
       articulo:'×1 Laptop', valeProductos:[{id:901,name:'Laptop',qty:1,cedidaUSD:4}], total:'$100 USD', valeText:''},
    ]);
    adminTab('vales');
  });

  const ver = async id => await p.evaluate(i => {
    selectVale(i);
    const b = document.getElementById('valePago');
    const v = getVales().find(x=>x.id===i);
    const val = k => (document.getElementById('pago-'+k)||{}).value || '';
    return { hay: !!b, usd: val('usd'), zelle: val('zelle'), eur: val('eur'), mn: val('mn'),
             estado: (document.getElementById('pagoEstado')||{}).textContent || '',
             texto: b ? b.textContent.replace(/\s+/g,' ') : '', pago: v.pago || null };
  }, id);

  console.log('\n══ 2· POR DEFECTO, COMO DICE EL VALE ══');
  const d = await ver(9001);
  ok('sale el bloque "¿Cómo pagó?"', d.hay, d);
  ok('USD efectivo viene relleno con 100', d.usd === '100', d);
  ok('y cuadra', /Cuadra/.test(d.estado), d.estado);
  ok('avisa de que aún no está apuntado', /Aún sin apuntar/.test(d.texto), d.texto.slice(0,200));
  ok('y no se guarda nada hasta que se toca', d.pago === null, d.pago);

  console.log('\n══ 3· PAGA PARTE EN USD: EL MN SE CALCULA SOLO ══');
  await p.evaluate(() => cambiarPago(9001, 'usd', '50'));
  const d3 = await ver(9001);
  ok('faltan $50 → 50 × 730 = 36500 MN', d3.mn === '36500', d3);
  ok('cuadra', /Cuadra/.test(d3.estado), d3.estado);
  ok('se guarda en el vale con la tasa congelada',
     d3.pago && d3.pago.usd === 50 && d3.pago.mn === 36500 && d3.pago.tasaMN === 730, d3.pago);

  console.log('\n══ 4· ZELLE Y EURO ══');
  await p.evaluate(() => { cambiarPago(9001, 'zelle', '20'); cambiarPago(9001, 'eur', '10'); });
  const d4 = await ver(9001);
  // 50 USD + 20 Zelle + 10 EUR (= 11 USD) = 81 → faltan 19 USD → 13870 MN
  ok('el Zelle cuenta 1 a 1 y el euro a 1.1', d4.mn === '13870', d4);
  ok('enseña cuánto es el euro en USD', /≈ \$11\.00/.test(d4.texto), d4.texto.slice(0,400));
  ok('cuadra', /Cuadra/.test(d4.estado), d4.estado);

  console.log('\n══ 5· EL MN ESCRITO A MANO SE RESPETA ══');
  await p.evaluate(() => cambiarPago(9001, 'mn', '10000'));
  const d5 = await ver(9001);
  ok('queda en 10000', d5.mn === '10000' && d5.pago.mnAuto === false, d5.pago);
  ok('y dice que falta (≈ $5.30)', /Falta \$5\.30/.test(d5.estado), d5.estado);
  await p.evaluate(() => cambiarPago(9001, 'usd', '60'));
  const d5b = await ver(9001);
  ok('cambiar otra casilla no le pisa el MN a mano', d5b.mn === '10000', d5b);
  ok('y ahora sobra, con el vuelto en MN', /Sobra \$4\.70/.test(d5b.estado) && /3430 MN/.test(d5b.estado), d5b.estado);
  await p.evaluate(() => pagoRestoEnMN(9001));
  const d5c = await ver(9001);
  // 60 + 20 + 11 = 91 → faltan 9 → 6570
  ok('"El resto en MN" lo vuelve a calcular', d5c.mn === '6570' && d5c.pago.mnAuto === true, d5c);

  console.log('\n══ 6· TODO EN MN / COMO DICE EL VALE ══');
  await p.evaluate(() => pagoTodoEnMN(9001));
  const d6 = await ver(9001);
  ok('todo en MN: 100 × 730 = 73000', d6.mn === '73000' && d6.usd === '' && d6.zelle === '' && d6.eur === '', d6);
  await p.evaluate(() => pagoComoElVale(9001));
  const d6b = await ver(9001);
  ok('como dice el vale: $100 USD y nada más', d6b.usd === '100' && d6b.mn === '', d6b);

  console.log('\n══ 7· LA TASA QUEDA CONGELADA ══');
  await p.evaluate(() => cambiarPago(9001, 'usd', '50'));
  await p.evaluate(() => saveConfig({...getConfig(), tasaUSD:740, tasaUSDTs:Date.now()+1000}));
  const d7 = await ver(9001);
  ok('si sube el dólar, el pago sigue a 730', d7.mn === '36500' && d7.pago.tasaMN === 730, d7);
  ok('y ofrece usar las tasas de hoy', /Usar las tasas de hoy/.test(d7.texto), d7.texto.slice(-200));
  await p.evaluate(() => pagoTasasDeHoy(9001));
  const d7b = await ver(9001);
  ok('con la de hoy (750): 50 × 750 = 37500', d7b.mn === '37500' && d7b.pago.tasaMN === 750, d7b.pago);
  await p.evaluate(() => saveConfig({...getConfig(), tasaUSD:720, tasaUSDTs:Date.now()+2000}));

  console.log('\n══ 8· UN VALE CON PARTE EN MN (MENSAJERÍA) ══');
  const d8 = await ver(9002);
  ok('por defecto: 100 USD y 500 MN', d8.usd === '100' && d8.mn === '500', d8);
  await p.evaluate(() => cambiarPago(9002, 'usd', '90'));
  const d8b = await ver(9002);
  ok('si paga $90, el MN es 500 + 10 × 730 = 7800', d8b.mn === '7800', d8b);
  ok('cuadra', /Cuadra/.test(d8b.estado), d8b.estado);

  console.log('\n══ 9· CON REBAJA, SE COBRA LO REBAJADO ══');
  const d9 = await ver(9003);
  ok('el gestor cedió $4: por defecto USD = 96', d9.usd === '96', d9);

  console.log('\n══ 10· AL CONFIRMAR SIN APUNTAR, SE CONGELA COMO DICE EL VALE ══');
  const d10 = await p.evaluate(() => {
    patchVale(9003, {status:'confirmed', confirmedTs:new Date().toISOString()});
    return getVales().find(x=>x.id===9003).pago;
  });
  ok('se guarda el pago por defecto con la tasa del día',
     d10 && d10.usd === 96 && d10.tasaMN === 730 && !d10.porDefecto, d10);

  console.log('\n══ 11· SUBE A LA NUBE CON EL VALE ══');
  const nube = await p.evaluate(() => {
    const capturas = [];
    const orig = window._enqueueSBChunked;
    window._enqueueSBChunked = (path, upd, m) => { capturas.push(JSON.parse(JSON.stringify(upd))); return orig(path, upd, m); };
    cambiarPago(9002, 'zelle', '5');
    window._enqueueSBChunked = orig;
    const fila = capturas.map(u => Object.values(u).find(x => x && x.id === 9002)).find(Boolean);
    return fila ? fila.pago : null;
  });
  ok('el pago va dentro de lo que se sube', nube && nube.zelle === 5, nube);

  console.log('\n══ 12· LA CAJA EN ESTADÍSTICAS ══');
  const caja = await p.evaluate(() => {
    patchVale(9001, {status:'confirmed', confirmedTs:new Date().toISOString()});
    patchVale(9002, {status:'confirmed', confirmedTs:new Date().toISOString()});
    adminTab('stats'); renderStats();
    return { t: totalesCaja(getVales()),
             html: (document.getElementById('statsCaja')||{}).textContent.replace(/\s+/g,' ') };
  });
  // 9001: 50 USD + 37500 MN (quedó con la tasa de hoy, 750) · 9002: 90 USD + 5 Zelle + 4150 MN · 9003: 96 USD
  ok('suma el USD en efectivo por su lado', caja.t.usd === 236, caja.t);
  ok('el Zelle por su lado', caja.t.zelle === 5, caja.t);
  ok('el MN por su lado', caja.t.mn === 37500 + 4150, caja.t);
  ok('tres ventas', caja.t.ventas === 3, caja.t);
  ok('y se pinta en Estadísticas', /USD efectivo/.test(caja.html) && /Zelle/.test(caja.html) && /MN/.test(caja.html), caja.html.slice(0,300));

  console.log('\n══ 13· ESTÁ EN LA AYUDA ══');
  const ayuda = await p.evaluate(() => {
    adminTab('ayuda');
    document.getElementById('ayudaBuscador').value = 'zelle';
    renderAyuda();
    return (document.getElementById('ayudaContenido')||{}).textContent || '';
  });
  ok('la ayuda lo explica', /Cómo pagó el cliente/.test(ayuda) && /Caja por forma de pago/.test(ayuda), ayuda.slice(0,200));

  console.log('\n══ ERRORES DE JAVASCRIPT ══');
  const graves = errores.filter(e => !/favicon|manifest|sw\.js|Failed to load resource|net::ERR/i.test(e));
  ok('ninguno', graves.length === 0, graves.slice(0,5));

  await nav.close(); srv.close();
  console.log('\n' + (fallos ? '❌ ' + fallos + ' fallo(s)' : '✅ todo correcto'));
  process.exit(fallos ? 1 : 0);
})();
