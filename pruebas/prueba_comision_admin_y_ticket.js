// Reportado el 23/09:
//   · "cuando se rebaja la comisión del gestor desde el admin no hace la rebaja"
//   · "el ticket que se crea en el gestor para pasar al cliente no refleja el descuento"
//
//   NODE_PATH=$(npm root -g) node pruebas/prueba_comision_admin_y_ticket.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const RAIZ = '/home/user/AXONTECH';
const MIME = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'};
const srv = http.createServer((q, r) => {
  if (q.url.split('?')[0].endsWith('/data.json')) {
    r.writeHead(200, {'Content-Type':'application/json'});
    return r.end('{"gestores":[],"mensajeros":[],"productos":[],"categorias":[]}');
  }
  const p = path.join(RAIZ, decodeURIComponent(q.url.split('?')[0]));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, {'Content-Type': MIME[path.extname(p)] || 'text/plain'});
  r.end(fs.readFileSync(p));
});
let fallos = 0;
const ok = (n, c, e) => { console.log((c?'✅ ':'❌ ')+n+(c?'':'  → '+JSON.stringify(e))); if(!c) fallos++; };

const PRODS = [
  {id:801, name:'Router', stock:9, precio:'$100 USD', comision:'$10 USD', puntos:1},
  {id:802, name:'Cable',  stock:9, precio:'5000 MN',  comision:'1000 MN', puntos:1},
];

(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const nav = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const ctx = await nav.newContext({viewport:{width:1280,height:1400}});
  await ctx.route('**/*', r => r.request().url().includes('127.0.0.1')
    ? r.continue() : r.fulfill({status:200, body:'[]'}));
  const p = await ctx.newPage();
  const errores = [];
  p.on('pageerror', e => errores.push(String(e).slice(0,200)));
  const base = `http://127.0.0.1:${srv.address().port}`;

  await p.goto(base + '/admin.html', {waitUntil:'domcontentloaded'});
  await p.waitForTimeout(2400);
  await p.fill('#passInput','axon2024');
  await p.click('button:has-text("Entrar")');
  await p.waitForTimeout(900);
  await p.evaluate(P => {
    try { clearInterval(_restPollTimer); } catch(e) {}
    saveProductos(P); saveCategorias([]); saveNotifs([]);
    saveGestores([{id:1, name:'Ana', initials:'A', color:'#2563EB'}]);
    const t = new Date().toISOString();
    saveVales([
      {id:8001, valeNum:1, gestorId:1, status:'pending', ts:t, cliente:'Pedro',
       telefono:'5555', direccion:'Calle 1', mensajeria:'',
       articulo:'×1 Router / ×1 Cable', valeProductos:[{id:801,name:'Router',qty:1},{id:802,name:'Cable',qty:1}],
       precioUSD:'$100 USD', precioMN:'5000 MN', total:'$100 USD + 5000 MN',
       comFijadaUSD:10, comFijadaMN:1000, comisionGestor:'$10 USD + 1000 MN', valeText:''},
      // Ya cobrado: stock descontado. Bajar la comisión no puede bloquearse.
      {id:8002, valeNum:2, gestorId:1, status:'confirmed', ts:t, confirmedTs:t, cliente:'Luis',
       articulo:'×1 Router', valeProductos:[{id:801,name:'Router',qty:1}],
       precioUSD:'$100 USD', total:'$100 USD', comFijadaUSD:10, comFijadaMN:0,
       stockDecremented:true, stockSalido:{'801':1}, valeText:''},
    ]);
  }, PRODS);

  console.log('══ 1· EL ADMIN BAJA LA COMISIÓN DEL GESTOR EN UNA LÍNEA ══');
  const r1 = await p.evaluate(() => {
    openEditValeModal(8001);
    const inputs = document.querySelectorAll('#ev-selectedProductsList .ev-comLinea');
    const n = inputs.length;
    // Router: de $10 deja $6 → cede $4. Cable: de 1000 deja 600 → cede 400.
    cambiarComisionLineaAdmin(0, '6');
    cambiarComisionLineaAdmin(1, '600');
    const casilla = document.getElementById('ev-comisionGestor').value;
    const soloLectura = document.getElementById('ev-comisionGestor').readOnly;
    // Antes de guardar, el vale guardado no se toca.
    const sinGuardar = JSON.stringify(getVales().find(x=>x.id===8001).valeProductos);
    saveEditVale();
    const v = getVales().find(x=>x.id===8001);
    const com = getValeCommissionParts(v);
    return { n, casilla, soloLectura, sinGuardar,
      lineas: v.valeProductos, comUSD: com.totalUSD, comMN: com.totalMN,
      cobrar: _aCobrarVale(v).txt, fijadaUSD: v.comFijadaUSD };
  });
  ok('sale una casilla de comisión por producto', r1.n === 2, r1.n);
  ok('la casilla general enseña lo que queda ($6 USD + 600 MN)',
     /\$6\s*USD/.test(r1.casilla) && /600\s*MN/.test(r1.casilla), r1.casilla);
  ok('y ya no se puede escribir a mano (no servía de nada)', r1.soloLectura, r1.soloLectura);
  ok('antes de guardar no toca el vale guardado', !/cedida/.test(r1.sinGuardar), r1.sinGuardar);
  ok('se guarda lo cedido en cada línea',
     r1.lineas[0].cedidaUSD === 4 && r1.lineas[1].cedidaMN === 400, r1.lineas);
  ok('la comisión del gestor baja de verdad: $6 USD', r1.comUSD === 6, r1);
  ok('y 600 MN', r1.comMN === 600, r1);
  ok('el cliente paga eso menos: $96 USD + 4600 MN',
     /\$96\s*USD/.test(r1.cobrar) && /4600\s*MN/.test(r1.cobrar), r1.cobrar);
  ok('la comisión congelada no se recalcula (no cambiaron los productos)', r1.fijadaUSD === 10, r1.fijadaUSD);

  console.log('\n══ 2· SE VE EN EL DETALLE DEL VALE ══');
  const det = await p.evaluate(() => {
    adminTab('vales'); selectVale(8001);
    return (document.getElementById('valeACobrarMonto')||{}).textContent || '';
  });
  ok('"COBRAR AL CLIENTE" con la rebaja', /\$96\s*USD/.test(det), det);

  console.log('\n══ 3· CANCELAR NO GUARDA NADA ══');
  const r3 = await p.evaluate(() => {
    openEditValeModal(8001);
    cambiarComisionLineaAdmin(0, '1');
    closeEditValeModal();
    return getVales().find(x=>x.id===8001).valeProductos[0].cedidaUSD;
  });
  ok('sigue en $4 cedidos, no en $9', r3 === 4, r3);

  console.log('\n══ 4· EN UN VALE YA COBRADO TAMBIÉN SE PUEDE ══');
  const r4 = await p.evaluate(() => {
    const stockAntes = productoOf(801).stock;
    openEditValeModal(8002);
    cambiarComisionLineaAdmin(0, '7');
    saveEditVale();
    const v = getVales().find(x=>x.id===8002);
    return { cedida: v.valeProductos[0].cedidaUSD, cobrar: _aCobrarVale(v).txt,
             stock: productoOf(801).stock, stockAntes };
  });
  ok('guarda la rebaja aunque el stock ya salió', r4.cedida === 3, r4);
  ok('cobrar: $97 USD', /\$97\s*USD/.test(r4.cobrar), r4.cobrar);
  ok('y el stock no se mueve', r4.stock === r4.stockAntes, r4);

  console.log('\n══ 5· CAMBIAR DE PRODUCTOS CONSERVA EL AJUSTE DE LOS QUE SIGUEN ══');
  const r5 = await p.evaluate(() => {
    openEditValeModal(8001);
    editValePickerSelected = {801:1};           // se quita el Cable
    confirmEditValePickerSelection();
    return editValeProductos;
  });
  ok('el Router sigue con sus $4 cedidos', r5.length === 1 && r5[0].cedidaUSD === 4, r5);
  await p.evaluate(() => closeEditValeModal());

  console.log('\n══ 6· EL TICKET DEL GESTOR REFLEJA EL DESCUENTO POR LÍNEA ══');
  await p.goto(base + '/index.html', {waitUntil:'domcontentloaded'});
  await p.waitForTimeout(2200);
  const tk = await p.evaluate(() => {
    try { clearInterval(_restPollTimer); } catch(e) {}
    doSelectGestor(1);
    currentValeProductos = [{id:801, name:'Router', qty:1}];
    selectedProductsUI = currentValeProductos;
    const set = (i,v) => { const e=document.getElementById(i); if(e) e.value=v; };
    set('vf-cliente','Maria'); set('vf-articulo','×1 Router'); set('vf-total','$100 USD');
    cambiarComisionLinea(0, '6');        // el gestor cobra $6 de $10 → cede $4
    openTicketModal(false);
    return {
      total: document.getElementById('tk-total').textContent,
      rebajaVisible: document.getElementById('tk-rebajaRow').style.display !== 'none',
      rebaja: document.getElementById('tk-rebaja').textContent,
    };
  });
  ok('el ticket dice $96 USD, no $100', /\$96\s*USD/.test(tk.total), tk);
  ok('y enseña la fila de rebaja', tk.rebajaVisible && /\$4/.test(tk.rebaja), tk);

  const tk2 = await p.evaluate(() => {
    document.getElementById('ticketModal').classList.remove('show');
    currentValeProductos = [{id:801, name:'Router', qty:1}];
    selectedProductsUI = currentValeProductos;
    openTicketModal(false);
    return { total: document.getElementById('tk-total').textContent,
             rebajaVisible: document.getElementById('tk-rebajaRow').style.display !== 'none' };
  });
  ok('sin rebaja, el ticket sigue con el total entero', /\$100\s*USD/.test(tk2.total) && !tk2.rebajaVisible, tk2);

  console.log('\n══ ERRORES DE JAVASCRIPT ══');
  const graves = errores.filter(e => !/favicon|manifest|sw\.js|Failed to load resource|net::ERR/i.test(e));
  ok('ninguno', graves.length === 0, graves.slice(0,5));

  await nav.close(); srv.close();
  console.log('\n' + (fallos ? '❌ ' + fallos + ' fallo(s)' : '✅ todo correcto'));
  process.exit(fallos ? 1 : 0);
})();
