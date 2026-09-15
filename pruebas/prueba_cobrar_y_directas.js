// Dos cosas pedidas el 15/09:
//   · el vale tiene que decir SIEMPRE lo que se le cobra al cliente
//   · un apartado de ventas directas del admin que no avise a nadie
//
// Se corre con:  NODE_PATH=$(npm root -g) node pruebas/prueba_cobrar_y_directas.js
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
  {id:701, name:'Bocina JBL', stock:6, precio:'$120 USD', comision:'$5 USD', puntos:2, categoria:'Audio'},
  {id:702, name:'Cargador',   stock:4, precio:'2500 MN',  comision:'200 MN', puntos:1, categoria:'Audio'},
  // Este no lo pide ningún vale: sirve para probar el caso de dejar el almacén a 0.
  {id:703, name:'Mouse',      stock:2, precio:'$10 USD',  comision:'$1 USD', puntos:1, categoria:'Audio'},
];

(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const nav = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const ctx = await nav.newContext({viewport:{width:1280,height:1400}});
  await ctx.route('**/*', r => r.request().url().includes('127.0.0.1')
    ? r.continue() : r.fulfill({status:200, body:'[]'}));
  const p = await ctx.newPage();
  const errores = [];
  p.on('pageerror', e => errores.push(String(e)));
  await p.goto(`http://127.0.0.1:${srv.address().port}/admin.html`, {waitUntil:'domcontentloaded'});
  await p.waitForTimeout(2400);
  await p.fill('#passInput','axon2024');
  await p.click('button:has-text("Entrar")');
  await p.waitForTimeout(900);

  await p.evaluate(P => {
    try { clearInterval(_restPollTimer); } catch(e) {}
    saveProductos(P); saveCategorias(['Audio']);
    saveGestores([{id:1, name:'Ana', initials:'A', color:'#2563EB'}]);
    saveMensajeros([{id:50, name:'Yoel', phone:'55551234'}]);
    saveNotifs([]);
    const t = new Date().toISOString();
    saveVales([
      // Sin rebaja ninguna: el caso que se reportó.
      {id:7001, valeNum:1, gestorId:1, status:'pending', ts:t, cliente:'Pedro',
       telefono:'55559999', direccion:'Calle 1', mensajeria:'$2 USD',
       articulo:'×1 Bocina JBL', valeProductos:[{id:701, name:'Bocina JBL', qty:1}],
       precioUSD:'$120 USD', precioMN:'', vuelto:'', total:'$122 USD', valeText:''},
      // Con rebaja del gestor y vuelto.
      {id:7002, valeNum:2, gestorId:1, status:'pending', ts:t, cliente:'Luisa',
       telefono:'55558888', direccion:'Calle 2', mensajeria:'',
       articulo:'×1 Bocina JBL', valeProductos:[{id:701, name:'Bocina JBL', qty:1}],
       precioUSD:'$120 USD', precioMN:'', vuelto:'30 MN', total:'$120 USD',
       comisionCedida:5, comisionCedidaMoneda:'USD', comisionCedidaMotivo:'cliente de siempre', valeText:''},
      // Rebaja en una moneda que el total no tiene: no se puede restar.
      {id:7003, valeNum:3, gestorId:1, status:'pending', ts:t, cliente:'Mario',
       telefono:'55557777', direccion:'Calle 3', mensajeria:'',
       articulo:'×1 Cargador', valeProductos:[{id:702, name:'Cargador', qty:1}],
       precioUSD:'', precioMN:'2500 MN', vuelto:'', total:'2500 MN',
       comisionCedida:5, comisionCedidaMoneda:'USD', valeText:''},
    ]);
    adminTab('vales');
  }, PRODS);
  await p.waitForTimeout(400);

  const detalle = async id => await p.evaluate(i => {
    selectVale(i);
    const c = document.getElementById('valeDetail') || document.getElementById('adminValeDetail');
    const raiz = c || document.body;
    const box = document.getElementById('valeACobrar');
    return {
      texto: raiz.textContent.replace(/\s+/g, ' '),
      hayCaja: !!box,
      monto: (document.getElementById('valeACobrarMonto') || {}).textContent || '',
      cajaTxt: box ? box.textContent.replace(/\s+/g,' ').trim() : '',
    };
  }, id);

  console.log('══ 1· EL VALE SIN REBAJA TAMBIÉN DICE LO QUE SE COBRA ══');
  const d1 = await detalle(7001);
  ok('sale el recuadro de cobrar al cliente', d1.hayCaja, d1.texto.slice(0, 200));
  ok('con el total del vale, $122 USD', /\$122\s*USD/.test(d1.monto), d1.monto);
  ok('y se lee "COBRAR AL CLIENTE"', /COBRAR AL CLIENTE/.test(d1.cajaTxt), d1.cajaTxt.slice(0,120));

  console.log('\n══ 2· CON REBAJA, YA VIENE RESTADA ══');
  const d2 = await detalle(7002);
  ok('sale el recuadro', d2.hayCaja, d2.cajaTxt.slice(0,120));
  ok('120 − 5 = 115, no 120', /\$115\s*USD/.test(d2.monto), d2.monto);
  ok('avisa de que la rebaja ya está restada', /rebaja restada/i.test(d2.cajaTxt), d2.cajaTxt.slice(0,200));
  ok('y recuerda el vuelto que hay que llevar', /30 MN/.test(d2.cajaTxt), d2.cajaTxt.slice(0,200));

  console.log('\n══ 3· REBAJA EN OTRA MONEDA: NO SE INVENTA LA CONVERSIÓN ══');
  const d3 = await detalle(7003);
  ok('sale el recuadro igual', d3.hayCaja, d3.cajaTxt.slice(0,160));
  ok('enseña el total tal cual, 2500 MN', /2500\s*MN/.test(d3.monto), d3.monto);
  ok('y avisa de que hay que restar a mano', /a mano/i.test(d3.cajaTxt), d3.cajaTxt.slice(0,220));

  console.log('\n══ 4· EL MENSAJERO VE LO QUE TIENE QUE COBRAR ══');
  const mens = await p.evaluate(() => {
    patchVale(7002, {mensajeroId:50, status:'assigned'});
    adminTab('mensajeros');
    const sel = document.getElementById('mensajeroSelector');
    try { mensajeroSeleccionado = 50; } catch(e) {}
    if (typeof renderMensajeroVales === 'function') renderMensajeroVales();
    const c = document.getElementById('mensajeroValesList') || document.body;
    return c.textContent.replace(/\s+/g,' ');
  });
  ok('en su tarjeta pone 115, no 120',
     !/\$120/.test(mens) || /\$115/.test(mens), mens.slice(0, 260));

  console.log('\n══ 5· LA VENTA DIRECTA NO AVISA A NADIE ══');
  const venta = await p.evaluate(() => {
    saveNotifs([]);
    adminTab('directas');
    document.getElementById('vdProducto').value = '701';
    vdRefresca();
    document.getElementById('vdCantidad').value = '2';
    document.getElementById('vdCobrado').value = '$210 USD';
    document.getElementById('vdNota').value = 'el vecino del 3ro';
    registrarVentaDirecta();
    const v = getVales().filter(x => x.ventaDirecta);
    return {
      notifs: getNotifs().length,
      cuantas: v.length,
      stock: (getProductos().find(x=>x.id===701)||{}).stock,
      total: v[0] && v[0].total,
      nota: v[0] && v[0].adminNotes,
      qty: v[0] && v[0].valeProductos[0].qty,
      estado: v[0] && v[0].status,
      comision: v[0] && v[0].commissionStatus,
      lista: (document.getElementById('vdLista')||{}).textContent.replace(/\s+/g,' '),
      resumen: (document.getElementById('vdResumen')||{}).textContent.replace(/\s+/g,' '),
    };
  });
  ok('ni una sola notificación', venta.notifs === 0, venta.notifs);
  ok('la venta queda apuntada', venta.cuantas === 1 && venta.qty === 2, venta);
  ok('el almacén baja de 6 a 4', venta.stock === 4, venta.stock);
  ok('se guarda lo que se cobró de verdad, no "Venta Local"',
     venta.total === '$210 USD', venta.total);
  ok('y la nota', venta.nota === 'el vecino del 3ro', venta.nota);
  ok('nace confirmada y sin comisión que pagar',
     venta.estado === 'confirmed' && venta.comision === 'cobrado', venta);
  ok('sale en la lista del apartado', /Bocina JBL x2/.test(venta.lista), venta.lista.slice(0,200));
  ok('y en el resumen del período', /210/.test(venta.resumen), venta.resumen.slice(0,200));

  console.log('\n══ 6· VACIAR EL ALMACÉN TAMPOCO AVISA ══');
  const agota = await p.evaluate(() => {
    saveNotifs([]);
    document.getElementById('vdProducto').value = '703';
    document.getElementById('vdCantidad').value = '2';
    document.getElementById('vdCobrado').value = '$20 USD';
    registrarVentaDirecta();
    return { notifs: getNotifs().map(n=>n.type), stock: (getProductos().find(x=>x.id===703)||{}).stock };
  });
  ok('el almacén queda en 0', agota.stock === 0, agota);
  ok('y NO se manda "stock agotado"', agota.notifs.length === 0, agota.notifs);

  console.log('\n══ 7· NO SE PUEDE VENDER MÁS DE LO QUE HAY ══');
  const pasado = await p.evaluate(() => {
    const antes = getVales().filter(x=>x.ventaDirecta).length;
    document.getElementById('vdProducto').value = '702';
    document.getElementById('vdCantidad').value = '99';
    document.getElementById('vdCobrado').value = '9999 MN';
    registrarVentaDirecta();
    return { antes, despues: getVales().filter(x=>x.ventaDirecta).length,
             stock:(getProductos().find(x=>x.id===702)||{}).stock };
  });
  ok('no deja registrarla', pasado.antes === pasado.despues, pasado);
  ok('y el almacén no se toca', pasado.stock === 4, pasado.stock);

  console.log('\n══ 8· LO RESERVADO NO SE PUEDE VENDER EN EL MOSTRADOR ══');
  const reservado = await p.evaluate(() => {
    // Un vale que ya salió con el mensajero aparta sus unidades aunque el stock
    // todavía no se haya descontado: esa mercancía va de camino al cliente.
    const t = new Date().toISOString();
    const todos = getVales();
    todos.push({id:7010, valeNum:9, gestorId:1, status:'assigned', mensajeroId:50, ts:t,
                cliente:'Otro', articulo:'×4 Cargador',
                valeProductos:[{id:702, name:'Cargador', qty:4}],
                total:'10000 MN', valeText:''});
    saveVales(todos);
    _refrescarReservas();
    // 4 en almacén y los 4 apartados → no queda ninguno libre.
    const disponible = _availableStock(productoOf(702));
    const antes = getVales().filter(x=>x.ventaDirecta).length;
    document.getElementById('vdProducto').value = '702';
    document.getElementById('vdCantidad').value = '2';
    document.getElementById('vdCobrado').value = '5000 MN';
    registrarVentaDirecta();
    return { disponible, antes, stock:(getProductos().find(x=>x.id===702)||{}).stock,
             despues:getVales().filter(x=>x.ventaDirecta).length };
  });
  ok('no queda ninguno libre de los 4', reservado.disponible === 0, reservado);
  ok('y pedir 2 no cuela', reservado.antes === reservado.despues, reservado);
  ok('el almacén sigue con sus 4', reservado.stock === 4, reservado);

  console.log('\n══ 9· DESHACER DEVUELVE LA MERCANCÍA, TAMBIÉN EN SILENCIO ══');
  const deshecho = await p.evaluate(async () => {
    saveNotifs([]);
    // La del Mouse, que dejó el almacén a 0.
    const v = getVales().filter(x => x.ventaDirecta &&
      (x.valeProductos||[]).some(it => it.id === 703))[0];
    borrarVentaDirecta(v.id);
    document.getElementById('confirmActionOk').click();
    await new Promise(r => setTimeout(r, 250));
    return { stock:(getProductos().find(x=>x.id===703)||{}).stock,
             quedan:getVales().filter(x=>x.ventaDirecta).length,
             notifs:getNotifs().map(n=>n.type) };
  });
  ok('vuelven las 2 unidades al almacén', deshecho.stock === 2, deshecho);
  ok('la venta desaparece de la lista', deshecho.quedan === 1, deshecho);
  ok('y reponer por aquí no manda "volvió a haber"', deshecho.notifs.length === 0, deshecho.notifs);

  console.log('\n══ 10· UN PRODUCTO DADO DE ALTA DESDE AQUÍ NO SE ANUNCIA ══');
  const nuevo = await p.evaluate(() => {
    saveNotifs([]);
    adminTab('directas');
    vdNuevoProducto();
    document.getElementById('pm-name').value = 'Lámpara LED';
    document.getElementById('pm-precio').value = '$15 USD';
    document.getElementById('pm-stock').value = '3';
    saveProduct();
    const p = getProductos().find(x => x.name === 'Lámpara LED');
    return { existe:!!p, elegido:document.getElementById('vdProducto').value,
             notifs:getNotifs().map(n=>n.type), id:p && p.id };
  });
  ok('el producto se guarda', nuevo.existe, nuevo);
  ok('queda ya elegido en el selector', nuevo.elegido === String(nuevo.id), nuevo);
  ok('y no se anuncia como novedad', nuevo.notifs.length === 0, nuevo.notifs);

  console.log('\n══ 11· DESDE CATÁLOGO SÍ SE SIGUE ANUNCIANDO ══');
  const normal = await p.evaluate(() => {
    saveNotifs([]);
    openAddProductModal();
    document.getElementById('pm-name').value = 'Teclado';
    document.getElementById('pm-precio').value = '$20 USD';
    document.getElementById('pm-stock').value = '2';
    saveProduct();
    return getNotifs().map(n => n.type);
  });
  ok('el alta normal sigue avisando', normal.includes('new_product'), normal);

  console.log('\n══ 12· LA VENTA DIRECTA ENTRA EN LAS CUENTAS ══');
  const cuentas = await p.evaluate(() => {
    const v = getVales().filter(x=>x.ventaDirecta);
    return { esDirecta: v.every(esVentaDirecta),
             enHistorial: v.every(x => x.status === 'confirmed'),
             tienda: v.every(x => x.gestorId === 'admin') };
  });
  ok('se reconocen como ventas directas', cuentas.esDirecta, cuentas);
  ok('cuentan como confirmadas', cuentas.enHistorial, cuentas);
  ok('y como mercancía de la tienda, no de un gestor', cuentas.tienda, cuentas);

  console.log('\n══ 13· EL BOTÓN DE LA FICHA LLEVA AL APARTADO ══');
  const desdeFicha = await p.evaluate(() => {
    adminTab('stock');
    venderDirecto(702);
    return { panel: document.getElementById('adminDirectasPanel').style.display,
             elegido: document.getElementById('vdProducto').value };
  });
  ok('abre Ventas directas', desdeFicha.panel === 'block', desdeFicha);
  ok('con el producto ya puesto', desdeFicha.elegido === '702', desdeFicha);

  console.log('\n══ 14· ESTÁ EN LA AYUDA ══');
  const ayuda = await p.evaluate(() => {
    adminTab('ayuda');
    document.getElementById('ayudaBuscador').value = 'directa';
    renderAyuda();
    const a = (document.getElementById('ayudaContenido')||{}).textContent || '';
    document.getElementById('ayudaBuscador').value = 'cobrar cliente';
    renderAyuda();
    const b = (document.getElementById('ayudaContenido')||{}).textContent || '';
    return { directas:a.replace(/\s+/g,' '), cobrar:b.replace(/\s+/g,' ') };
  });
  ok('la ayuda explica las ventas directas',
     /no se manda ninguna notificación/i.test(ayuda.directas), ayuda.directas.slice(0,200));
  ok('y explica lo de cobrar al cliente',
     /COBRAR AL CLIENTE/.test(ayuda.cobrar), ayuda.cobrar.slice(0,200));

  console.log('\n══ ERRORES DE JAVASCRIPT ══');
  const graves = errores.filter(e => !/favicon|manifest|sw\.js|Failed to load resource|net::ERR/i.test(e));
  ok('ninguno', graves.length === 0, graves.slice(0,5));

  await nav.close(); srv.close();
  console.log('\n' + (fallos ? '❌ ' + fallos + ' fallo(s)' : '✅ todo correcto'));
  process.exit(fallos ? 1 : 0);
})();
