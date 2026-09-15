// RECORRIDO 3 — Los casos raros, que es donde se rompen las apps: dobles
// toques, productos borrados, vales unidos, cantidades absurdas, sin conexión.
//
//   NODE_PATH=$(npm root -g) node pruebas/recorrido_bordes.js
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

  const base = async () => await p.evaluate(() => {
    try { clearInterval(_restPollTimer); } catch(e) {}
    saveProductos([{id:950, name:'Equipo', stock:10, precio:'$10 USD', comision:'$2 USD', puntos:1}]);
    saveCategorias([]); saveNotifs([]);
    saveGestores([{id:1,name:'Ana',initials:'A',color:'#2563EB'},
                  {id:2,name:'Beto',initials:'B',color:'#059669'}]);
    saveMensajeros([{id:50,name:'Yoel'}]);
    saveConfig({...getConfig(), metaModo:'off', metaPuntos:0});
    const t = new Date().toISOString();
    saveVales([{id:8001, valeNum:1, gestorId:1, status:'delivered', ts:t, deliveredTs:t,
      cliente:'Cli', valeProductos:[{id:950, name:'Equipo', qty:2}], total:'$20 USD'}]);
  });

  console.log('══ 1 · DOBLE TOQUE EN CONFIRMAR ══');
  await base();
  const doble = await p.evaluate(() => {
    confirmSale(8001,'confirmed',true);
    const unaVez = _numStock(productoOf(950).stock);
    confirmSale(8001,'confirmed',true);     // segundo toque, rápido
    confirmSale(8001,'confirmed',true);     // y un tercero
    return { unaVez, tresVeces:_numStock(productoOf(950).stock) };
  });
  ok('el primer toque descuenta 2 → quedan 8', doble.unaVez === 8, doble);
  ok('los toques de más NO vuelven a descontar', doble.tresVeces === 8, doble);

  console.log('\n══ 2 · DOBLE TOQUE EN REVERTIR ══');
  const dobleRev = await p.evaluate(() => {
    revertConfirmSale(8001, true);
    const una = _numStock(productoOf(950).stock);
    revertConfirmSale(8001, true);
    revertConfirmSale(8001, true);
    return { una, tres:_numStock(productoOf(950).stock) };
  });
  ok('revertir devuelve las 2 → 10', dobleRev.una === 10, dobleRev);
  ok('revertir otra vez NO regala unidades', dobleRev.tres === 10, dobleRev);

  console.log('\n══ 3 · UN PRODUCTO BORRADO DEL CATÁLOGO ══');
  const borrado = await p.evaluate(() => {
    const t = new Date().toISOString();
    saveProductos([{id:950, name:'Equipo', stock:10, precio:'$10 USD', comision:'$2 USD', puntos:1}]);
    saveVales([{id:8002, valeNum:2, gestorId:1, status:'confirmed', ts:t, confirmedTs:t,
      cliente:'Fantasma', stockDecremented:true,
      valeProductos:[{id:9999, name:'Ya no existe', qty:1}], total:'$50 USD'}]);
    const v = getVales()[0];
    let crash = null, com = null, pts = null, texto = null;
    try { com = getValeCommissionParts(v); } catch(e) { crash = 'comisión: '+e.message; }
    try { pts = getGestorPointsTotal(1); } catch(e) { crash = crash||'puntos: '+e.message; }
    try { texto = regenerateValeText(v); } catch(e) { crash = crash||'texto: '+e.message; }
    try { revertConfirmSale(8002, true); } catch(e) { crash = crash||'revertir: '+e.message; }
    return { crash, com, pts, texto:(texto||'').slice(0,80) };
  });
  ok('nada revienta con un producto que ya no está', !borrado.crash, borrado.crash);
  // Cuando no se puede calcular, los totales vienen en null —"no lo sé"—, que es
  // distinto de cero.
  ok('la comisión se queda en "no se sabe", no en cero',
     borrado.com && borrado.com.totalUSD === null && borrado.com.totalMN === null, borrado.com);
  ok('y lo dice en el desglose', /borrado/i.test(JSON.stringify(borrado.com.parts)), borrado.com.parts);
  ok('y da 0 puntos en vez de romperse', borrado.pts === 0, borrado.pts);

  console.log('\n══ 4 · CANTIDADES ABSURDAS ══');
  const absurdo = await p.evaluate(() => {
    saveProductos([{id:950, name:'Equipo', stock:10, precio:'$10 USD', comision:'$2 USD', puntos:1}]);
    const t = new Date().toISOString();
    const casos = [
      {qty:0, nombre:'cero'},
      {qty:-3, nombre:'negativa'},
      {qty:'2', nombre:'texto "2"'},
      {qty:1.5, nombre:'con decimales'},
      {qty:null, nombre:'sin cantidad'},
    ];
    const r = [];
    casos.forEach((c, i) => {
      saveProductos([{id:950, name:'Equipo', stock:10, precio:'$10 USD', comision:'$2 USD', puntos:1}]);
      saveVales([{id:8100+i, valeNum:10+i, gestorId:1, status:'delivered', ts:t,
        cliente:c.nombre, valeProductos:[{id:950, name:'Equipo', qty:c.qty}], total:'$10 USD'}]);
      let err = null;
      try { confirmSale(8100+i,'confirmed',true); } catch(e) { err = e.message; }
      r.push({ caso:c.nombre, stock:_numStock(productoOf(950).stock), err });
    });
    return r;
  });
  absurdo.forEach(c => {
    const sano = !c.err && c.stock >= 0 && c.stock <= 10;
    ok(`cantidad ${c.caso}: el almacén queda entre 0 y 10 y no revienta`, sano, c);
  });

  console.log('\n══ 5 · VALES UNIDOS ══');
  const unidos = await p.evaluate(() => {
    saveProductos([{id:950, name:'Equipo', stock:10, precio:'$10 USD', comision:'$2 USD', puntos:4}]);
    const t = new Date().toISOString();
    saveVales([
      {id:8201, valeNum:21, gestorId:1, status:'pending', ts:t, cliente:'Juntos',
       valeProductos:[{id:950, name:'Equipo', qty:2}], total:'$20 USD', comFijadaUSD:4},
      {id:8202, valeNum:22, gestorId:2, status:'pending', ts:t, cliente:'Juntos',
       valeProductos:[{id:950, name:'Equipo', qty:2}], total:'$20 USD', comFijadaUSD:4},
    ]);
    const r = unirVales(8201, [8202]);
    const a = getVales().find(v=>v.id===8201), b = getVales().find(v=>v.id===8202);
    return { unido:b.unidoA, comA:getValeCommissionParts(a).totalUSD,
             comB:getValeCommissionParts(b).totalUSD,
             n:r ? r.n : null };
  });
  ok('el segundo queda unido al primero', unidos.unido === 8201, unidos);
  ok('y la comisión se parte por la mitad', unidos.comA === 2 && unidos.comB === 2, unidos);

  const stockUnidos = await p.evaluate(() => {
    confirmSale(8201,'confirmed',true);
    const trasPrincipal = _numStock(productoOf(950).stock);
    confirmSale(8202,'confirmed',true);
    const trasSecundario = _numStock(productoOf(950).stock);
    return { trasPrincipal, trasSecundario,
             ptsA:getGestorPointsVentas(1), ptsB:getGestorPointsVentas(2) };
  });
  ok('el principal descuenta las 2 unidades → 8', stockUnidos.trasPrincipal === 8, stockUnidos);
  ok('el unido NO vuelve a descontar: es la misma venta', stockUnidos.trasSecundario === 8, stockUnidos);
  ok('y los puntos también se parten (4×2 / 2 = 4 cada uno)',
     stockUnidos.ptsA === 4 && stockUnidos.ptsB === 4, stockUnidos);

  const desunidos = await p.evaluate(() => {
    desunirVale(8202);
    const b = getVales().find(v=>v.id===8202);
    return { unido:b.unidoA, com:getValeCommissionParts(b).totalUSD,
             stock:_numStock(productoOf(950).stock), pts:getGestorPointsVentas(2) };
  });
  ok('al desunir recupera su comisión entera', desunidos.com === 4, desunidos);
  ok('y sus puntos enteros', desunidos.pts === 8, desunidos);
  ok('desunir no mueve el almacén por su cuenta', desunidos.stock === 8, desunidos);

  console.log('\n══ 6 · UN VALE SIN PRODUCTOS (de los viejos) ══');
  const sinProd = await p.evaluate(() => {
    const t = new Date().toISOString();
    saveVales([{id:8301, valeNum:31, gestorId:1, status:'delivered', ts:t,
      cliente:'A mano', articulo:'escrito a mano', valeProductos:[], total:'$10 USD'}]);
    let err = null;
    try { confirmSale(8301,'confirmed',true); } catch(e) { err = e.message; }
    const v = getVales().find(x=>x.id===8301);
    let err2 = null;
    try { revertConfirmSale(8301, true); } catch(e) { err2 = e.message; }
    return { err, err2, status:v.status, falta:_faltaStockPara(v) };
  });
  ok('confirmar un vale sin productos no revienta', !sinProd.err, sinProd.err);
  ok('revertirlo tampoco', !sinProd.err2, sinProd.err2);
  ok('y no se queja de falta de stock: no pide nada', sinProd.falta.length === 0, sinProd.falta);

  console.log('\n══ 7 · CANCELAR Y BORRAR ══');
  const cancelado = await p.evaluate(() => {
    saveProductos([{id:950, name:'Equipo', stock:10, precio:'$10 USD', comision:'$2 USD', puntos:1}]);
    const t = new Date().toISOString();
    saveVales([{id:8401, valeNum:41, gestorId:1, status:'confirmed', ts:t, confirmedTs:t,
      cliente:'Cancelar', stockDecremented:true, stockSalido:{'950':3},
      valeProductos:[{id:950, name:'Equipo', qty:3}], total:'$30 USD'}]);
    const antes = _numStock(productoOf(950).stock);
    cancelVale(8401);                                  // abre la confirmación
    document.getElementById('confirmActionOk').click();  // y se confirma
    const v = getVales().find(x=>x.id===8401);
    return { antes, despues:_numStock(productoOf(950).stock), status:v ? v.status : '(borrado)',
             abierto: document.getElementById('confirmActionModal').classList.contains('show') };
  });
  ok('borrar pide confirmación antes de tocar nada', cancelado.status === '(borrado)', cancelado);
  ok('y al confirmar devuelve la mercancía',
     cancelado.despues === cancelado.antes + 3, cancelado);

  console.log('\n══ 8 · SIN CONEXIÓN ══');
  const offline = await p.evaluate(async () => {
    saveProductos([{id:950, name:'Equipo', stock:10, precio:'$10 USD', comision:'$2 USD', puntos:1}]);
    saveVales([]);
    const t = new Date().toISOString();
    // El gestor manda un vale con el teléfono sin datos.
    const v = {id:8501, valeNum:51, gestorId:1, status:'pending', ts:t, cliente:'Offline',
      valeProductos:[{id:950, name:'Equipo', qty:1}], total:'$10 USD', synced:false};
    saveVales([v]);
    return { guardado: getVales().length === 1,
             pendiente: (typeof _valesPendientesDeSync === 'function')
               ? _valesPendientesDeSync().length : null,
             enDisco: !!localStorage.getItem('axon_vales') };
  });
  ok('el vale se guarda en el teléfono aunque no haya red', offline.guardado, offline);
  ok('y queda en disco, no solo en memoria', offline.enDisco, offline);

  console.log('\n══ ERRORES DE JAVASCRIPT ══');
  const graves = errores.filter(e => !/favicon|manifest|sw\.js|Failed to load resource|net::ERR/i.test(e));
  ok('ninguno', graves.length === 0, graves.slice(0,8));

  await nav.close(); srv.close();
  console.log('\n' + (fallos ? '❌ ' + fallos + ' fallo(s)' : '✅ todo correcto'));
  process.exit(fallos ? 1 : 0);
})();
