// RECORRIDO 1 — El ciclo de vida completo de un vale, con el ratón, de punta a
// punta: el gestor lo manda, el admin lo ve, lo asigna, el mensajero entrega,
// se cobra, y se comprueba que stock, comisión y puntos cuadran en CADA paso.
//
//   NODE_PATH=$(npm root -g) node pruebas/recorrido_vale.js
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
  {id:801, name:'Router MikroTik', stock:10, precio:'$100 USD', comision:'$10 USD', puntos:5, garantia:'6 meses'},
  {id:802, name:'Cable de red',    stock:200,precio:'150 MN',   comision:'20 MN',   puntos:1},
];

(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const puerto = srv.address().port;
  const nav = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const errores = [];
  const abrir = async (pagina, etiqueta) => {
    const ctx = await nav.newContext({viewport:{width:430,height:1200}});
    await ctx.route('**/*', r => r.request().url().includes('127.0.0.1')
      ? r.continue() : r.fulfill({status:200, body:'[]'}));
    const p = await ctx.newPage();
    p.on('pageerror', e => errores.push('['+etiqueta+'] ' + String(e).slice(0,200)));
    p.on('console', m => { if (m.type()==='error') errores.push('['+etiqueta+'] ' + m.text().slice(0,200)); });
    await p.goto(`http://127.0.0.1:${puerto}/${pagina}`, {waitUntil:'domcontentloaded'});
    await p.waitForTimeout(2400);
    return {ctx, p};
  };

  // ───────────────────────── EL GESTOR MANDA EL VALE ─────────────────────────
  console.log('══ 1 · EL GESTOR LLENA Y MANDA EL VALE ══');
  const G = await abrir('index.html', 'gestor');
  await G.p.evaluate(P => {
    try { clearInterval(_restPollTimer); } catch(e) {}
    saveProductos(P); saveCategorias([]); saveVales([]); saveNotifs([]);
    saveGestores([{id:1,name:'Ana',initials:'A',color:'#2563EB',phone:'55551111'}]);
    saveMensajeros([{id:50,name:'Yoel',phone:'55552222'}]);
  }, PRODS);
  await G.p.waitForTimeout(300);

  // Se elige el gestor tocando su tarjeta, como haría una persona.
  await G.p.click('#gestoresList [onclick*="selectGestor"], #gestoresList .g-card, #gestoresList > div').catch(()=>{});
  await G.p.evaluate(() => { if (activeGestorId == null) doSelectGestor(1); });
  await G.p.waitForTimeout(400);
  ok('queda seleccionado el gestor', await G.p.evaluate(() => activeGestorId) === 1,
     await G.p.evaluate(() => activeGestorId));

  // El picker de productos, de verdad.
  await G.p.evaluate(() => openProductPicker());
  await G.p.waitForTimeout(400);
  ok('se abre el selector de productos',
     await G.p.evaluate(() => { const m=document.getElementById('productPickerModal'); return !!m && m.classList.contains('show'); }),
     'no se abrió');
  await G.p.evaluate(() => { pickerAdj(801, 1); pickerAdj(802, 3); confirmPickerSelection(); });
  await G.p.waitForTimeout(300);
  const trasPicker = await G.p.evaluate(() => ({
    items: currentValeProductos.map(i => i.id + 'x' + i.qty),
    articulo: document.getElementById('vf-articulo').value,
    usd: document.getElementById('vf-precioUSD').value,
    mn: document.getElementById('vf-precioMN').value,
    com: document.getElementById('vf-comisionGestor').value,
    total: document.getElementById('vf-total').value,
  }));
  ok('coge los dos productos', trasPicker.items.join() === '801x1,802x3', trasPicker);
  ok('rellena el artículo solo', /Router/.test(trasPicker.articulo) && /Cable/.test(trasPicker.articulo), trasPicker.articulo);
  ok('separa USD y MN sin mezclarlos',
     /100/.test(trasPicker.usd) && /450/.test(trasPicker.mn), trasPicker);
  ok('y la comisión también va en las dos monedas',
     /10/.test(trasPicker.com) && /60/.test(trasPicker.com), trasPicker.com);

  await G.p.fill('#vf-cliente','Pedro Pérez');
  await G.p.fill('#vf-telefono','55558888');
  await G.p.fill('#vf-direccion','Calle 23 #456, Vedado');
  await G.p.evaluate(() => { const e=document.getElementById('vf-mensajeria'); if(e){e.value='$2 USD'; onFormInput();} });
  await G.p.waitForTimeout(300);

  const enviado = await G.p.evaluate(() => {
    const antes = getVales().length;
    sendVale();
    const v = getVales()[getVales().length-1];
    return { creado: getVales().length === antes+1, v: v ? {
      id:v.id, num:v.valeNum, status:v.status, gestorId:v.gestorId,
      items:(v.valeProductos||[]).length, synced:v.synced,
      comUSD:v.comFijadaUSD, comMN:v.comFijadaMN, texto:(v.valeText||'').slice(0,0)
    } : null, texto: v ? v.valeText : '' };
  });
  ok('el vale se crea', enviado.creado, enviado);
  ok('nace pendiente', enviado.v.status === 'pending', enviado.v);
  ok('con número de vale', enviado.v.num > 0, enviado.v);
  ok('marcado como no sincronizado todavía', enviado.v.synced === false, enviado.v);
  ok('con la comisión congelada en las dos monedas',
     enviado.v.comUSD === 10 && enviado.v.comMN === 60, enviado.v);
  ok('el texto del vale lleva los dos productos',
     /Router/.test(enviado.texto) && /Cable/.test(enviado.texto), enviado.texto.slice(0,200));
  ok('y el precio en las dos monedas', /100/.test(enviado.texto) && /450/.test(enviado.texto), '');

  console.log('\n── el stock NO se toca al mandar el vale ──');
  const stockTrasEnviar = await G.p.evaluate(() => [productoOf(801).stock, productoOf(802).stock]);
  ok('sigue en 10 y 200: la mercancía no ha salido', stockTrasEnviar.join() === '10,200', stockTrasEnviar);

  console.log('\n── lo que ve el gestor de lo suyo ──');
  const suyo = await G.p.evaluate(() => {
    renderMyVales(); renderGestorComisiones(); renderGestorDashboard();
    return {
      mis: (document.getElementById('gestorMyVales')||{}).textContent || '',
      pts: getGestorPointsTotal(1),
      comision: comisionPendienteDe(1),
    };
  });
  ok('el vale aparece en "Mis vales"', /Pedro/.test(suyo.mis), suyo.mis.slice(0,150));
  ok('un vale pendiente NO da puntos todavía', suyo.pts === 0, suyo.pts);

  // ───────────────────────── EL ADMIN LO RECIBE ─────────────────────────
  console.log('\n══ 2 · EL ADMIN LO RECIBE Y LO ASIGNA ══');
  const vale = await G.p.evaluate(() => getVales()[getVales().length-1]);
  const A = await abrir('admin.html', 'admin');
  await A.p.fill('#passInput','axon2024');
  await A.p.click('button:has-text("Entrar")');
  await A.p.waitForTimeout(800);
  await A.p.evaluate(([P, v]) => {
    try { clearInterval(_restPollTimer); } catch(e) {}
    saveProductos(P); saveCategorias([]); saveNotifs([]);
    saveGestores([{id:1,name:'Ana',initials:'A',color:'#2563EB',phone:'55551111'}]);
    saveMensajeros([{id:50,name:'Yoel',phone:'55552222'}]);
    saveVales([v]);
    adminTab('vales');
  }, [PRODS, vale]);
  await A.p.waitForTimeout(500);

  const bandeja = await A.p.evaluate(() => {
    renderAdminGestores();
    return { txt: (document.getElementById('adminGestoresList')||document.body).textContent || '',
             badge: (document.getElementById('adminBadge')||{}).textContent || '' };
  });
  // La bandeja agrupa por gestor y viene plegada: lo que se ve es el grupo con
  // su contador de nuevos.
  ok('el vale sale en la bandeja del admin, en el grupo de su gestor',
     /Ana/.test(bandeja.txt) && /1 nuevo/.test(bandeja.txt), bandeja.txt.slice(0,200));

  await A.p.evaluate(v => selectVale(v.id), vale);
  await A.p.waitForTimeout(400);
  const detalle = await A.p.evaluate(() => (document.getElementById('valeDetail')||{}).textContent || '');
  ok('el detalle enseña al cliente', /Pedro/.test(detalle), detalle.slice(0,200));
  ok('y los puntos que dará', /⭐/.test(detalle), detalle.slice(0,300));
  ok('marca el vale como visto', await A.p.evaluate(v => !!getVales().find(x=>x.id===v.id).seenByAdmin, vale), 'no');

  const asignado = await A.p.evaluate(v => {
    openShareModal(v.id);
    document.getElementById('mensajeroSelect').value = '50';
    asignarMensajeroSinMas();
    const x = getVales().find(y=>y.id===v.id);
    return { status:x.status, mensajeroId:x.mensajeroId, assignedTs: !!x.assignedTs };
  }, vale);
  ok('al asignar pasa a "assigned"', asignado.status === 'assigned', asignado);
  ok('con su mensajero', asignado.mensajeroId === 50, asignado);
  const stockTrasAsignar = await A.p.evaluate(() => [productoOf(801).stock, productoOf(802).stock]);
  ok('asignar tampoco toca el stock', stockTrasAsignar.join() === '10,200', stockTrasAsignar);

  // ───────────────────────── ENTREGA Y COBRO ─────────────────────────
  console.log('\n══ 3 · ENTREGA Y COBRO ══');
  // El mensajero entrega: la mercancía SALE aquí y el vale queda pendiente de
  // cobro. Es el camino normal —el cliente ya tiene el producto en la mano—.
  const entregado = await A.p.evaluate(v => {
    mensajeroEntrega(v.id, true);
    const x = getVales().find(y=>y.id===v.id);
    return { status:x.status, deliveredTs: !!x.deliveredTs, dec:x.stockDecremented,
             salido:x.stockSalido, stock:[productoOf(801).stock, productoOf(802).stock] };
  }, vale);
  ok('queda entregado y pendiente de cobro', entregado.status === 'pending_payment', entregado);
  ok('lleva la fecha de entrega', entregado.deliveredTs, entregado);
  ok('AQUÍ sale la mercancía: 9 y 197', entregado.stock.join() === '9,197', entregado.stock);
  ok('y queda apuntado qué salió', entregado.salido['801']===1 && entregado.salido['802']===3, entregado.salido);

  console.log('\n── un vale entregado pero sin cobrar YA da comisión y puntos ──');
  const sinCobrar = await A.p.evaluate(() => ({ pts:getGestorPointsTotal(1), com:comisionPendienteDe(1) }));
  ok('los puntos entran al entregar', sinCobrar.pts === 8, sinCobrar);

  const confirmado = await A.p.evaluate(v => {
    markAsPaid(v.id, true);
    const x = getVales().find(y=>y.id===v.id);
    return { status:x.status, dec:x.stockDecremented, salido:x.stockSalido,
             stock:[productoOf(801).stock, productoOf(802).stock],
             pts: getGestorPointsTotal(1),
             com: getValeCommissionParts(x) };
  }, vale);
  ok('al cobrar queda confirmada', confirmado.status === 'confirmed', confirmado.status);
  ok('cobrar NO vuelve a descontar: sigue en 9 y 197',
     confirmado.stock.join() === '9,197', confirmado.stock);
  ok('el apunte de lo que salió se conserva',
     confirmado.salido['801'] === 1 && confirmado.salido['802'] === 3, confirmado.salido);
  ok('el gestor gana sus puntos: 5 + 3×1 = 8', confirmado.pts === 8, confirmado.pts);
  ok('y su comisión, sin mezclar monedas',
     confirmado.com.totalUSD === 10 && confirmado.com.totalMN === 60, confirmado.com);

  console.log('\n── el aviso le llega al gestor ──');
  const avisos = await A.p.evaluate(() => getNotifs().map(n => n.type));
  ok('se avisa de la venta confirmada', avisos.includes('vale_confirmed'), avisos);
  ok('y del movimiento de stock', avisos.includes('sale_product'), avisos);

  // ───────────────────────── REVERTIR ─────────────────────────
  console.log('\n══ 4 · REVERTIR LO DEJA TODO COMO ESTABA ══');
  const revertido = await A.p.evaluate(v => {
    revertConfirmSale(v.id, true);
    const x = getVales().find(y=>y.id===v.id);
    return { status:x.status, dec:x.stockDecremented, salido:x.stockSalido,
             stock:[productoOf(801).stock, productoOf(802).stock],
             pts: getGestorPointsTotal(1) };
  }, vale);
  ok('el vale vuelve atrás', revertido.status !== 'confirmed', revertido.status);
  ok('la mercancía vuelve al almacén: 10 y 200', revertido.stock.join() === '10,200', revertido.stock);
  ok('se limpia la bandera de descontado', !revertido.dec, revertido.dec);
  ok('y el apunte de lo que salió', !revertido.salido, revertido.salido);
  ok('los puntos se van con la venta', revertido.pts === 0, revertido.pts);

  console.log('\n── y volver a confirmar no descuadra nada ──');
  const reconfirmado = await A.p.evaluate(v => {
    confirmSale(v.id, 'confirmed', true);
    return { stock:[productoOf(801).stock, productoOf(802).stock], pts:getGestorPointsTotal(1) };
  }, vale);
  ok('vuelve a 9 y 197', reconfirmado.stock.join() === '9,197', reconfirmado.stock);
  ok('y a 8 puntos', reconfirmado.pts === 8, reconfirmado.pts);

  console.log('\n══ ERRORES DE JAVASCRIPT EN TODO EL RECORRIDO ══');
  const graves = errores.filter(e => !/favicon|manifest|sw\.js|Failed to load resource|net::ERR/i.test(e));
  ok('ninguno', graves.length === 0, graves.slice(0,6));

  await nav.close(); srv.close();
  console.log('\n' + (fallos ? '❌ ' + fallos + ' fallo(s)' : '✅ todo correcto'));
  process.exit(fallos ? 1 : 0);
})();
