// Los cinco fallos reportados el 15/09.
//
// Se corre con:  NODE_PATH=$(npm root -g) node pruebas/prueba_cinco_fallos.js
// (playwright está instalado en global, no en el proyecto).
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

const PRODS = [
  {id:601, name:'Router', stock:5, precio:'$100 USD', comision:'$3 USD', puntos:2},
  {id:602, name:'Cable',  stock:9, precio:'$5 USD',   comision:'$1 USD', puntos:1},
  // El caso reportado: comisión escrita en USD pero con la moneda vieja pegada.
  {id:603, name:'Switch', stock:9, precio:'$50 USD',  comision:'$3 USD', puntos:1, comisionMoneda:'MN'},
];

(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const nav = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const ctx = await nav.newContext({viewport:{width:430,height:1200}});
  await ctx.route('**/*', r => r.request().url().includes('127.0.0.1')
    ? r.continue() : r.fulfill({status:200, body:'[]'}));
  const pag = await ctx.newPage();
  const errores = [];
  pag.on('pageerror', e => errores.push(String(e)));
  await pag.goto(`http://127.0.0.1:${srv.address().port}/admin.html`, {waitUntil:'domcontentloaded'});
  await pag.waitForTimeout(2400);
  await pag.fill('#passInput','axon2024');
  await pag.click('button:has-text("Entrar")');
  await pag.waitForTimeout(800);

  const montar = async () => await pag.evaluate(P => {
    try { clearInterval(_restPollTimer); } catch(e) {}
    saveProductos(P); saveCategorias([]);
    saveGestores([{id:1,name:'Ana',initials:'A',color:'#2563EB'}]);
    saveMensajeros([{id:50,name:'Yoel',phone:'55551234'}]);
    saveNotifs([]);
    const t = new Date().toISOString();
    saveVales([{id:5001, valeNum:1, gestorId:1, status:'pending', ts:t,
      cliente:'Pedro', telefono:'55559999', direccion:'Calle 1', mensajeria:'$2 USD',
      articulo:'×1 Router', valeProductos:[{id:601, name:'Router', qty:1}],
      precioUSD:'$100 USD', precioMN:'', vuelto:'', total:'$100 USD',
      valeText:'TEXTO VIEJO ×1 Router sin vuelto'}]);
    adminTab('vales'); selectVale(5001);
  }, PRODS);
  await montar();
  await pag.waitForTimeout(500);

  console.log('══ 1· EL TEXTO DE WHATSAPP SE REHACE AL EDITAR EL VALE ══');
  const antes = await pag.evaluate(() => (getVales().find(v=>v.id===5001)||{}).valeText || '');
  ok('de entrada tiene el texto de cuando se creó', /TEXTO VIEJO/.test(antes), antes.slice(0,60));
  const trasEditar = await pag.evaluate(() => {
    openEditValeModal(5001);
    editValeProductos = [{id:601, name:'Router', qty:1}, {id:602, name:'Cable', qty:2}];
    document.getElementById('ev-articulo').value = '×1 Router / ×2 Cable';
    document.getElementById('ev-vuelto') ? document.getElementById('ev-vuelto').value = '20 MN' : null;
    saveEditVale();
    const v = getVales().find(x=>x.id===5001);
    // Si el admin no tiene campo de vuelto en el modal, se pone a mano: lo que
    // se comprueba es que el TEXTO se rehaga con lo que el vale tenga.
    if (!v.vuelto) patchVale(5001, {vuelto:'20 MN'});
    const v2 = getVales().find(x=>x.id===5001);
    return { guardado: v2.valeText || '', regenerado: regenerateValeText(v2), vuelto: v2.vuelto };
  });
  ok('el texto congelado se borra al editar', !/TEXTO VIEJO/.test(trasEditar.guardado), trasEditar.guardado.slice(0,60));
  ok('el texto nuevo lleva el producto que se añadió',
     /Cable/.test(trasEditar.regenerado), trasEditar.regenerado.slice(0,400));
  ok('y lleva el vuelto', /Vuelto: 20 MN/.test(trasEditar.regenerado),
     (trasEditar.regenerado.match(/Vuelto.*/)||[''])[0]);

  console.log('\n══ 2· EL VALE QUE SE MANDA AL MENSAJERO ══');
  const share = await pag.evaluate(() => {
    const v = getVales().find(x=>x.id===5001);
    return buildShareText(v, mensajeroOf(50));
  });
  ok('lista los productos del vale, no el texto suelto',
     /Router/.test(share) && /Cable/.test(share), (share.match(/Artículo.*/)||[''])[0]);
  ok('y también el vuelto, que el mensajero tiene que llevarlo',
     /Vuelto: 20 MN/.test(share), (share.match(/Vuelto.*/)||['(no sale)'])[0]);

  console.log('\n══ 3· LA COMISIÓN EN USD NO SE CUENTA COMO MN ══');
  const com = await pag.evaluate(() => {
    const r = getValeCommissionParts({valeProductos:[{id:603, qty:1}]});
    return { usd: r.totalUSD, mn: r.totalMN, moneda: (productoOf(603)||{}).comisionMoneda,
             partes: r.parts.map(p => p.currency) };
  });
  ok('$3 USD se cuentan como USD', com.usd === 3 && com.mn === 0, com);
  ok('y la moneda guardada del producto se corrige sola', com.moneda === 'USD', com);

  console.log('\n══ 4· DOS VALES NO PUEDEN VENDER MÁS STOCK DEL QUE HAY ══');
  const exceso = await pag.evaluate(() => {
    saveProductos([{id:610, name:'Equipo', stock:5, precio:'$10 USD', comision:'$2 USD', puntos:1}]);
    const t = new Date().toISOString();
    saveVales([
      {id:6001, valeNum:10, gestorId:1, status:'delivered', ts:t, cliente:'Sin conexión',
       valeProductos:[{id:610, name:'Equipo', qty:1}], total:'$10 USD'},
      {id:6002, valeNum:11, gestorId:1, status:'delivered', ts:t, cliente:'Con conexión',
       valeProductos:[{id:610, name:'Equipo', qty:5}], total:'$50 USD'},
    ]);
    // El de 5 se confirma primero y se lleva todo.
    confirmSale(6002, 'confirmed', true);
    const trasPrimero = _numStock(productoOf(610).stock);
    // Ahora el otro: ya no queda nada. ¿Avisa?
    const falta = _faltaStockPara(getVales().find(v=>v.id===6001));
    confirmSale(6001, 'confirmed', true);          // se fuerza, como haría el admin
    const trasSegundo = _numStock(productoOf(610).stock);
    return { trasPrimero, trasSegundo, falta,
             salido1: getVales().find(v=>v.id===6001).stockSalido,
             salido2: getVales().find(v=>v.id===6002).stockSalido };
  });
  ok('el primer vale se lleva las 5', exceso.trasPrimero === 0, exceso);
  ok('el segundo AVISA de que no queda ninguna',
     exceso.falta.length === 1 && exceso.falta[0].hay === 0 && exceso.falta[0].pide === 1, exceso.falta);
  ok('el almacén no baja de cero', exceso.trasSegundo === 0, exceso);
  ok('y queda apuntado que del segundo no salió nada',
     exceso.salido1 && exceso.salido1['610'] === 0, exceso.salido1);
  ok('del primero salieron las 5', exceso.salido2 && exceso.salido2['610'] === 5, exceso.salido2);

  console.log('\n══ 5· AL REVERTIR SE DEVUELVE LO QUE SALIÓ, NI MÁS NI MENOS ══');
  const revertido = await pag.evaluate(() => {
    revertConfirmSale(6001, true);
    const tras1 = _numStock(productoOf(610).stock);
    revertConfirmSale(6002, true);
    const tras2 = _numStock(productoOf(610).stock);
    return { tras1, tras2 };
  });
  ok('revertir el que no sacó nada NO inventa una unidad', revertido.tras1 === 0, revertido);
  ok('revertir el que sacó 5 devuelve exactamente 5', revertido.tras2 === 5, revertido);
  ok('el almacén vuelve a estar como empezó (5)', revertido.tras2 === 5, revertido);

  console.log('\n══ Y LOS VALES VIEJOS, SIN EL APUNTE, SIGUEN FUNCIONANDO ══');
  const viejo = await pag.evaluate(() => {
    saveProductos([{id:620, name:'Viejo', stock:0, precio:'$10 USD', comision:'$1 USD', puntos:1}]);
    const t = new Date().toISOString();
    saveVales([{id:6100, valeNum:20, gestorId:1, status:'confirmed', ts:t, confirmedTs:t,
      cliente:'De antes', stockDecremented:true,   // sin stockSalido, como los de v121
      valeProductos:[{id:620, name:'Viejo', qty:3}], total:'$30 USD'}]);
    revertConfirmSale(6100, true);
    return _numStock(productoOf(620).stock);
  });
  ok('sin apunte se devuelve lo que dice el vale, como siempre', viejo === 3, viejo);

  console.log('\n══ ERRORES EN LA CONSOLA ══');
  const graves = errores.filter(e => !/favicon|manifest|sw\.js|Failed to load resource/i.test(e));
  ok('ninguno', graves.length === 0, graves.slice(0,3));

  await nav.close(); srv.close();
  console.log('\n' + (fallos ? '❌ ' + fallos + ' fallo(s)' : '✅ todo correcto'));
  process.exit(fallos ? 1 : 0);
})();
