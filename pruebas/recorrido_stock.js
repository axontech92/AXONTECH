// RECORRIDO 4 — Stock y catálogo: alta, edición, borrado, reposición, merma,
// reservas y el buscador. Y el aviso de "poco stock".
//
//   NODE_PATH=$(npm root -g) node pruebas/recorrido_stock.js
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
  await p.evaluate(() => {
    try { clearInterval(_restPollTimer); } catch(e) {}
    saveProductos([]); saveCategorias([]); saveVales([]); saveNotifs([]);
    saveGestores([{id:1,name:'Ana',initials:'A',color:'#2563EB'}]);
    adminTab('stock');
  });
  await p.waitForTimeout(400);

  console.log('══ 1 · DAR DE ALTA UN PRODUCTO DESDE LA VENTANA ══');
  const alta = await p.evaluate(async () => {
    openAddProductModal();
    const set = (id,v) => { const e=document.getElementById(id); if(e) e.value=v; };
    set('pm-name','Router Nuevo'); set('pm-precio','$120 USD'); set('pm-stock','7');
    set('pm-puntos','3'); set('pm-garantia','6 meses');
    set('pm-comision-amount','15'); set('pm-comision-currency','USD');
    await saveProduct();
    const ps = getProductos();
    return { n:ps.length, p:ps[0] };
  });
  ok('se crea el producto', alta.n === 1, alta.n);
  ok('con su nombre y precio', alta.p.name === 'Router Nuevo' && /120/.test(alta.p.precio), alta.p);
  ok('el stock se guarda como número', alta.p.stock === 7, alta.p.stock);
  ok('la comisión queda "$15 USD"', /15/.test(alta.p.comision) && /USD/.test(alta.p.comision), alta.p.comision);
  ok('y su moneda apuntada como USD', alta.p.comisionMoneda === 'USD', alta.p.comisionMoneda);
  ok('lleva fecha de alta, para la chapa de nuevo', !!alta.p.creadoTs, alta.p.creadoTs);
  ok('y sale con la chapa 💎 NUEVO', await p.evaluate(id => _esProductoNuevo(productoOf(id)), alta.p.id), 'no');

  console.log('\n══ 2 · CAMBIARLE LA MONEDA DE LA COMISIÓN ══');
  const cambio = await p.evaluate(async id => {
    openEditProductModal(id);
    document.getElementById('pm-comision-amount').value = '500';
    document.getElementById('pm-comision-currency').value = 'MN';
    await saveProduct();
    const a = productoOf(id);
    openEditProductModal(id);
    document.getElementById('pm-comision-amount').value = '15';
    document.getElementById('pm-comision-currency').value = 'USD';
    await saveProduct();
    const b = productoOf(id);
    return { enMN:{c:a.comision, m:a.comisionMoneda},
             deVuelta:{c:b.comision, m:b.comisionMoneda},
             cuenta:getValeCommissionParts({valeProductos:[{id, qty:1}]}) };
  }, alta.p.id);
  ok('pasar a MN la deja en pesos', cambio.enMN.m === 'MN' && /MN/.test(cambio.enMN.c), cambio.enMN);
  ok('y volver a USD la devuelve a dólares', cambio.deVuelta.m === 'USD', cambio.deVuelta);
  ok('la cuenta la hace en USD, no en MN',
     cambio.cuenta.totalUSD === 15 && cambio.cuenta.totalMN === 0, cambio.cuenta);

  console.log('\n══ 3 · LA VENTANA DE STOCK ══');
  const stockModal = await p.evaluate(id => {
    openStockModal(id);
    document.getElementById('stockModalInput').value = '0';
    guardarStockModal();
    const agotado = _numStock(productoOf(id).stock);
    const avisos1 = getNotifs().map(n=>n.type);
    openStockModal(id);
    document.getElementById('stockModalInput').value = '25';
    guardarStockModal();
    return { agotado, repuesto:_numStock(productoOf(id).stock),
             avisos1, avisos2:getNotifs().map(n=>n.type) };
  }, alta.p.id);
  ok('dejarlo en cero lo agota', stockModal.agotado === 0, stockModal);
  ok('y avisa de agotado', stockModal.avisos1.includes('out_of_stock'), stockModal.avisos1);
  ok('reponer lo deja en 25', stockModal.repuesto === 25, stockModal);
  ok('y avisa de repuesto', stockModal.avisos2.includes('restocked'), stockModal.avisos2);

  console.log('\n── el aviso de "quedan pocos" ──');
  const pocos = await p.evaluate(id => {
    saveNotifs([]);
    openStockModal(id);
    document.getElementById('stockModalInput').value = '2';
    guardarStockModal();
    return { stock:_numStock(productoOf(id).stock), avisos:getNotifs().map(n=>n.type),
             umbral: typeof LOW_STOCK_THRESHOLD !== 'undefined' ? LOW_STOCK_THRESHOLD : null };
  }, alta.p.id);
  ok('bajar de 25 a 2 avisa de poco stock', pocos.avisos.includes('low_stock'), pocos);

  console.log('\n══ 4 · MERMA ══');
  const merma = await p.evaluate(id => {
    saveNotifs([]);
    const a = _numStock(productoOf(id).stock);
    const mid = registrarMerma(id, 1, 'Rotura', 'se cayó');
    const b = _numStock(productoOf(id).stock);
    const lista = listaMermas().length;
    const okDeshacer = deshacerMerma(mid);
    return { a, b, lista, tras:_numStock(productoOf(id).stock), okDeshacer,
             quedan:listaMermas().length };
  }, alta.p.id);
  ok('la merma saca la unidad del almacén', merma.b === merma.a - 1, merma);
  ok('y queda registrada', merma.lista === 1, merma);
  ok('deshacerla la devuelve', merma.tras === merma.a, merma);
  ok('y desaparece del registro', merma.quedan === 0, merma);

  const mermaImposible = await p.evaluate(id => {
    const antes = _numStock(productoOf(id).stock);
    const r = registrarMerma(id, 999, 'Rotura');
    return { r, despues:_numStock(productoOf(id).stock), antes };
  }, alta.p.id);
  ok('no se puede mermar más de lo que hay',
     mermaImposible.r === null && mermaImposible.despues === mermaImposible.antes, mermaImposible);

  console.log('\n══ 5 · RESERVAS ══');
  const reservas = await p.evaluate(id => {
    patchProducto(id, {stock:10, reserved:4});
    return { total:_reservedTotal(productoOf(id)), disp:_availableStock(productoOf(id)),
             todo:_isFullyReserved(productoOf(id)), parte:_isPartiallyReserved(productoOf(id)) };
  }, alta.p.id);
  ok('4 de 10 apartadas → quedan 6 libres',
     reservas.total === 4 && reservas.disp === 6, reservas);
  ok('y se marca como parcialmente reservado', reservas.parte && !reservas.todo, reservas);

  const reservaTotal = await p.evaluate(id => {
    patchProducto(id, {stock:4, reserved:4});
    return { disp:_availableStock(productoOf(id)), todo:_isFullyReserved(productoOf(id)) };
  }, alta.p.id);
  ok('con todo apartado no queda nada disponible',
     reservaTotal.disp === 0 && reservaTotal.todo, reservaTotal);

  const reservaExcesiva = await p.evaluate(id => {
    patchProducto(id, {stock:2, reserved:99});
    return { disp:_availableStock(productoOf(id)) };
  }, alta.p.id);
  ok('reservar más de lo que hay no da disponibles negativos',
     reservaExcesiva.disp === 0, reservaExcesiva);

  console.log('\n══ 6 · EL BUSCADOR DEL STOCK ══');
  const buscador = await p.evaluate(() => {
    saveProductos([
      {id:1001, name:'Router MikroTik hAP', stock:5, precio:'$100 USD', puntos:1},
      {id:1002, name:'Climatización split', stock:5, precio:'$300 USD', puntos:1},
      {id:1003, name:'Batería 12V',         stock:5, precio:'$50 USD',  puntos:1},
    ]);
    adminTab('stock');
    const buscar = q => {
      document.getElementById('stockBuscador').value = q;
      onBuscarStock();
      return [...document.querySelectorAll('#productGrid .prod-card')]
        .map(c => (c.querySelector('.prod-name')||{}).textContent || '');
    };
    const r = {
      mikrotik: buscar('mikrotik'),
      sinTilde: buscar('climatizacion'),
      bateria:  buscar('bateria'),
      dos:      buscar('router hap'),
      nada:     buscar('zzzz'),
    };
    limpiarBuscadorStock();
    r.todos = [...document.querySelectorAll('#productGrid .prod-card')].length;
    return r;
  });
  ok('busca por una palabra suelta', buscador.mikrotik.length === 1, buscador.mikrotik);
  ok('"climatizacion" sin tilde encuentra "Climatización"', buscador.sinTilde.length === 1, buscador.sinTilde);
  ok('"bateria" sin tilde encuentra "Batería"', buscador.bateria.length === 1, buscador.bateria);
  ok('dos palabras en cualquier orden', buscador.dos.length === 1, buscador.dos);
  ok('si no hay nada, no enseña nada', buscador.nada.length === 0, buscador.nada);
  ok('y al limpiar vuelven los tres', buscador.todos === 3, buscador.todos);

  console.log('\n══ 7 · BORRAR UN PRODUCTO QUE YA SE VENDIÓ ══');
  const borrar = await p.evaluate(() => {
    saveProductos([{id:1010, name:'Se va', stock:5, precio:'$10 USD', comision:'$1 USD', puntos:1}]);
    const t = new Date().toISOString();
    saveVales([{id:8801, valeNum:81, gestorId:1, status:'confirmed', ts:t, confirmedTs:t,
      cliente:'Cli', stockDecremented:true, stockSalido:{'1010':2},
      valeProductos:[{id:1010, name:'Se va', qty:2}], total:'$20 USD'}]);
    removeProducto(1010);
    document.getElementById('confirmActionOk').click();
    let err = null, pts = null, com = null;
    try { pts = getGestorPointsTotal(1); } catch(e) { err = 'puntos: '+e.message; }
    try { com = getValeCommissionParts(getVales()[0]); } catch(e) { err = err||'com: '+e.message; }
    let errRev = null;
    try { revertConfirmSale(8801, true); } catch(e) { errRev = e.message; }
    return { quedan:getProductos().length, err, errRev, pts, com };
  });
  ok('el producto se va del catálogo', borrar.quedan === 0, borrar);
  ok('y el vale que lo vendía no revienta nada', !borrar.err && !borrar.errRev, borrar);
  ok('revertirlo tampoco, aunque el producto ya no esté', !borrar.errRev, borrar.errRev);

  console.log('\n══ ERRORES DE JAVASCRIPT ══');
  const graves = errores.filter(e => !/favicon|manifest|sw\.js|Failed to load resource|net::ERR/i.test(e));
  ok('ninguno', graves.length === 0, graves.slice(0,8));

  await nav.close(); srv.close();
  console.log('\n' + (fallos ? '❌ ' + fallos + ' fallo(s)' : '✅ todo correcto'));
  process.exit(fallos ? 1 : 0);
})();
