// RECORRIDO 2 — El dinero. Rebaja del admin, comisión cedida, corte de dueños,
// ganancia y las dos monedas. Es donde un error se paga en efectivo.
//
//   NODE_PATH=$(npm root -g) node pruebas/recorrido_dinero.js
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
  const ctx = await nav.newContext({viewport:{width:430,height:1400}});
  await ctx.route('**/*', r => r.request().url().includes('127.0.0.1')
    ? r.continue() : r.fulfill({status:200, body:'[]'}));
  const p = await ctx.newPage();
  const errores = [];
  p.on('pageerror', e => errores.push(String(e).slice(0,200)));
  p.on('console', m => { if (m.type()==='error') errores.push(m.text().slice(0,200)); });
  await p.goto(`http://127.0.0.1:${srv.address().port}/admin.html`, {waitUntil:'domcontentloaded'});
  await p.waitForTimeout(2400);
  await p.fill('#passInput','axon2024');
  await p.click('button:has-text("Entrar")');
  await p.waitForTimeout(800);

  const montar = async () => await p.evaluate(() => {
    try { clearInterval(_restPollTimer); } catch(e) {}
    saveProductos([
      {id:901, name:'Equipo A', stock:50, precio:'$100 USD', comision:'$10 USD', puntos:2},
      {id:902, name:'Equipo B', stock:50, precio:'2000 MN',  comision:'100 MN',  puntos:1},
    ]);
    saveCategorias([]);
    saveGestores([{id:1,name:'Ana',initials:'A',color:'#2563EB'},
                  {id:2,name:'Beto',initials:'B',color:'#059669'}]);
    saveMensajeros([{id:50,name:'Yoel'}]);
    saveVales([]); saveNotifs([]);
    saveConfig({...getConfig(), tasaUSD:400, tasaUSDTs:Date.now(), tasaMargen:0, metaModo:'off', metaPuntos:0});
    try { localStorage.removeItem('axon_tasa_usd'); } catch(e) {}   // la que baja de tasa.json
    // El costo de compra y el dueño de cada producto.
    setCosto(901, '$60 USD'); setCosto(902, '1200 MN');
    const d1 = addDueno('Carlos'); const d2 = addDueno('Marta');
    setDuenoProducto(901, d1); setDuenoProducto(902, d2);
    return { d1, d2 };
  });
  const duenos = await montar();
  await p.waitForTimeout(300);
  ok('se crean los dos dueños', duenos.d1 && duenos.d2 && duenos.d1 !== duenos.d2, duenos);

  const ventaSimple = async () => await p.evaluate(() => {
    const t = new Date().toISOString();
    saveVales([{id:7001, valeNum:1, gestorId:1, status:'confirmed', ts:t, confirmedTs:t,
      cliente:'Cli', valeProductos:[{id:901, name:'Equipo A', qty:1}],
      precioUSD:'$100 USD', precioMN:'', total:'$100 USD',
      comFijadaUSD:10, comFijadaMN:0, stockDecremented:true}]);
  });

  console.log('══ 1 · UNA VENTA LIMPIA ══');
  await ventaSimple();
  const limpia = await p.evaluate(() => {
    const v = getVales()[0];
    return { venta:_ventaVale(v), cobrada:_ventaCobradaVale(v),
             com:getValeCommissionParts(v), pts:getGestorPointsTotal(1) };
  });
  ok('se vende por $100', limpia.venta.usd === 100 && limpia.venta.mn === 0, limpia.venta);
  ok('se cobra $100 (no hay rebaja)', limpia.cobrada.usd === 100, limpia.cobrada);
  ok('la comisión es $10', limpia.com.totalUSD === 10, limpia.com);
  ok('y da 2 puntos', limpia.pts === 2, limpia.pts);

  console.log('\n══ 2 · EL ADMIN SE REBAJA $15 ══');
  const conRebaja = await p.evaluate(() => {
    patchVale(7001, {rebajaAdmin:15, rebajaAdminMoneda:'USD', rebajaAdminMotivo:'cliente fiel'});
    const v = getVales()[0];
    return { venta:_ventaVale(v), cobrada:_ventaCobradaVale(v),
             com:getValeCommissionParts(v),
             lineas:[..._lineasPorDueno(getVales()).porDueno.values()].map(g=>({n:g.nombre,usd:g.ventaUSD})) };
  });
  ok('el precio de lista NO cambia: sigue $100', conRebaja.venta.usd === 100, conRebaja.venta);
  ok('pero lo COBRADO baja a $85', conRebaja.cobrada.usd === 85, conRebaja.cobrada);
  ok('la comisión del gestor no se toca: sigue $10',
     conRebaja.com.totalUSD === 10, conRebaja.com);

  console.log('\n── y la rebaja llega al corte del dueño ──');
  const corte = await p.evaluate(() => {
    const r = _lineasPorDueno(getVales());
    return [...r.porDueno.values()].map(g => ({ dueno:g.nombre, usd:g.ventaUSD, mn:g.ventaMN, com:g.comUSD }));
  });
  ok('sale el dueño del producto vendido', corte.length >= 1, corte);
  ok('y su venta va con la rebaja aplicada: $85, no $100',
     corte.some(c => c.usd === 85), corte);

  console.log('\n══ 3 · EL GESTOR CEDE PARTE DE SU COMISIÓN ══');
  const cedida = await p.evaluate(() => {
    patchVale(7001, {comisionCedida:4, comisionCedidaMoneda:'USD', comisionCedidaMotivo:'ayuda al cliente'});
    const v = getVales()[0];
    return { com:getValeCommissionParts(v), cobrada:_ventaCobradaVale(v) };
  });
  ok('al gestor le quedan $6 de los $10', cedida.com.totalUSD === 6, cedida.com);
  ok('y lo cedido también rebaja lo que paga el cliente: $81',
     cedida.cobrada.usd === 81, cedida.cobrada);

  console.log('\n══ 4 · LAS DOS MONEDAS NUNCA SE SUMAN ══');
  const dosMonedas = await p.evaluate(() => {
    const t = new Date().toISOString();
    saveVales([{id:7002, valeNum:2, gestorId:1, status:'confirmed', ts:t, confirmedTs:t,
      cliente:'Mixto', valeProductos:[{id:901, name:'A', qty:1},{id:902, name:'B', qty:1}],
      precioUSD:'$100 USD', precioMN:'2000 MN', total:'$100 USD + 2000 MN',
      comFijadaUSD:10, comFijadaMN:100, stockDecremented:true}]);
    const v = getVales()[0];
    return { venta:_ventaVale(v), com:getValeCommissionParts(v),
             enUSD:_aUSD(_ventaVale(v)), tasa:tasaUSDFinal() };
  });
  ok('el vale mixto guarda USD y MN por separado',
     dosMonedas.venta.usd === 100 && dosMonedas.venta.mn === 2000, dosMonedas.venta);
  ok('la comisión, igual', dosMonedas.com.totalUSD === 10 && dosMonedas.com.totalMN === 100, dosMonedas.com);
  ok('y al pasarlo todo a USD usa la tasa: 100 + 2000/400 = 105',
     dosMonedas.enUSD === 105, dosMonedas);

  console.log('\n── sin tasa, no se inventa un número ──');
  const sinTasa = await p.evaluate(() => {
    const cfg = getConfig();
    const antes = { v: cfg.tasaUSD, ts: cfg.tasaUSDTs, local: localStorage.getItem('axon_tasa_usd') };
    saveConfig({...cfg, tasaUSD:0, tasaUSDTs:0});
    try { localStorage.removeItem('axon_tasa_usd'); } catch(e) {}
    const r = _aUSD({usd:100, mn:2000});
    saveConfig({...getConfig(), tasaUSD:antes.v, tasaUSDTs:antes.ts});
    if (antes.local) localStorage.setItem('axon_tasa_usd', antes.local);
    return r;
  });
  ok('devuelve null ("no lo sé"), no cero', sinTasa === null, sinTasa);

  console.log('\n══ 5 · LA GANANCIA ══');
  const ganancia = await p.evaluate(() => {
    const t = new Date().toISOString();
    saveVales([{id:7003, valeNum:3, gestorId:1, status:'confirmed', ts:t, confirmedTs:t,
      cliente:'G', valeProductos:[{id:901, name:'A', qty:2}],
      precioUSD:'$200 USD', total:'$200 USD',
      comFijadaUSD:20, comFijadaMN:0, stockDecremented:true,
      costoFijadoDe:null}]);
    const v = getVales()[0];
    return { venta:_ventaVale(v).usd, costo:_aUSD(_montoMonedas(costoDe(901)))*2,
             com:getValeCommissionParts(v).totalUSD };
  });
  ok('vende 2 a $100 = $200', ganancia.venta === 200, ganancia);
  ok('le costaron $60 cada uno = $120', ganancia.costo === 120, ganancia);
  ok('y la comisión son $20', ganancia.com === 20, ganancia);
  console.log('   → ganancia esperada: 200 − 120 − 20 = $60');

  console.log('\n══ 6 · LA REBAJA NO PUEDE DEJAR EL COBRO EN NEGATIVO ══');
  const negativo = await p.evaluate(() => {
    const t = new Date().toISOString();
    saveVales([{id:7004, valeNum:4, gestorId:1, status:'confirmed', ts:t, confirmedTs:t,
      cliente:'Exagerado', valeProductos:[{id:901, name:'A', qty:1}],
      precioUSD:'$100 USD', total:'$100 USD', comFijadaUSD:10,
      rebajaAdmin:500, rebajaAdminMoneda:'USD', stockDecremented:true}]);
    return _ventaCobradaVale(getVales()[0]);
  });
  ok('con una rebaja mayor que el precio, se cobra 0 y no menos',
     negativo.usd === 0 && negativo.mn === 0, negativo);

  console.log('\n══ 7 · REBAJA EN UNA MONEDA, PRECIO EN OTRA ══');
  const cruzada = await p.evaluate(() => {
    const t = new Date().toISOString();
    saveVales([{id:7005, valeNum:5, gestorId:1, status:'confirmed', ts:t, confirmedTs:t,
      cliente:'Cruzado', valeProductos:[{id:901, name:'A', qty:1}],
      precioUSD:'$100 USD', precioMN:'', total:'$100 USD', comFijadaUSD:10,
      rebajaAdmin:1000, rebajaAdminMoneda:'MN', stockDecremented:true}]);
    return _ventaCobradaVale(getVales()[0]);
  });
  ok('una rebaja en MN NO se come los dólares del precio',
     cruzada.usd === 100, cruzada);
  ok('y no deja los pesos en negativo', cruzada.mn === 0, cruzada);

  console.log('\n══ ERRORES DE JAVASCRIPT ══');
  const graves = errores.filter(e => !/favicon|manifest|sw\.js|Failed to load resource|net::ERR/i.test(e));
  ok('ninguno', graves.length === 0, graves.slice(0,6));

  await nav.close(); srv.close();
  console.log('\n' + (fallos ? '❌ ' + fallos + ' fallo(s)' : '✅ todo correcto'));
  process.exit(fallos ? 1 : 0);
})();
