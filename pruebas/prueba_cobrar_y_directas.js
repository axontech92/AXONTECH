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
      // Total sin ninguna cifra (vales viejos tipo "Venta Local"): aquí sí no
      // hay nada de qué restar y se cae al aviso de "a mano" de verdad.
      {id:7005, valeNum:5, gestorId:1, status:'pending', ts:t, cliente:'Ana',
       telefono:'55556666', direccion:'Calle 5', mensajeria:'',
       articulo:'×1 Cargador', valeProductos:[{id:702, name:'Cargador', qty:1}],
       precioUSD:'', precioMN:'', vuelto:'', total:'Venta Local',
       comisionCedida:5, comisionCedidaMoneda:'USD', valeText:''},
      // El caso reportado el 15/09: la rebaja del gestor trae DOS monedas
      // ($15 USD general + 2000 MN de una línea), pero el total del vale es
      // solo en USD. La parte en USD sí se puede restar; la de MN, no.
      {id:7004, valeNum:4, gestorId:1, status:'pending', ts:t, cliente:'Rene',
       telefono:'64656626', direccion:'Ndjjrkriro', mensajeria:'',
       articulo:'×4 Bocina JBL', valeProductos:[
         {id:701, name:'Bocina JBL', qty:4, cedidaMN:2000, cedidaMoneda:'MN'}],
       precioUSD:'$640 USD', precioMN:'', vuelto:'', total:'$640 USD',
       comisionCedida:15, comisionCedidaMoneda:'USD', comisionCedidaMotivo:'', valeText:''},
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
  ok('y avisa de que no se pudo restar la rebaja en USD',
     /no se pudo restar/i.test(d3.cajaTxt) && /\$5\s*USD/.test(d3.cajaTxt), d3.cajaTxt.slice(0,260));

  console.log('\n══ 3b· REBAJA MIXTA: SE APLICA LA PARTE QUE SÍ CALZA (bug 15/09) ══');
  const d4 = await detalle(7004);
  ok('sale el recuadro', d4.hayCaja, d4.cajaTxt.slice(0,160));
  ok('resta los $15 USD del total ($640 → $625), no deja el total intacto',
     /\$625\s*USD/.test(d4.monto), d4.monto);
  ok('avisa de que los 2000 MN no se pudieron restar',
     /no se pudo restar/i.test(d4.cajaTxt) && /2000\s*MN/.test(d4.cajaTxt), d4.cajaTxt.slice(0,260));

  console.log('\n══ 3c· TOTAL SIN NINGUNA CIFRA: AHÍ SÍ ES "A MANO" DE VERDAD ══');
  const d5 = await detalle(7005);
  ok('sale el recuadro', d5.hayCaja, d5.cajaTxt.slice(0,160));
  ok('enseña el total tal cual, sin inventar nada', /Venta Local/.test(d5.monto), d5.monto);
  ok('y avisa de restar a mano', /a mano/i.test(d5.cajaTxt), d5.cajaTxt.slice(0,220));

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

  console.log('\n══ 5· LA VENTA DIRECTA NO AVISA A NADIE, Y NO TOCA EL ALMACÉN ══');
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
      stockDecremented: v[0] && v[0].stockDecremented,
      lista: (document.getElementById('vdLista')||{}).textContent.replace(/\s+/g,' '),
      resumen: (document.getElementById('vdResumen')||{}).textContent.replace(/\s+/g,' '),
    };
  });
  ok('ni una sola notificación', venta.notifs === 0, venta.notifs);
  ok('la venta queda apuntada', venta.cuantas === 1 && venta.qty === 2, venta);
  // v127: esta mercancía no vive en el almacén — vender 2 NO le toca el stock
  // al producto de catálogo elegido, que sigue con sus 6 unidades intactas.
  ok('el almacén NO se toca: sigue en 6, no baja a 4', venta.stock === 6, venta.stock);
  ok('el vale queda marcado explícito como que no descontó stock',
     venta.stockDecremented === false, venta.stockDecremented);
  ok('se guarda lo que se cobró de verdad, no "Venta Local"',
     venta.total === '$210 USD', venta.total);
  ok('y la nota', venta.nota === 'el vecino del 3ro', venta.nota);
  ok('nace confirmada y sin comisión que pagar',
     venta.estado === 'confirmed' && venta.comision === 'cobrado', venta);
  ok('sale en la lista del apartado', /Bocina JBL x2/.test(venta.lista), venta.lista.slice(0,200));
  ok('y en el resumen del período', /210/.test(venta.resumen), venta.resumen.slice(0,200));

  console.log('\n══ 6· SE PUEDE VENDER AUNQUE EL CATÁLOGO MARQUE 0 (esta mercancía no vive ahí) ══');
  const sinStock = await p.evaluate(() => {
    saveNotifs([]);
    patchProducto(703, {stock: 0});   // el catálogo ya está en 0 de por sí
    const antes = getVales().filter(x=>x.ventaDirecta).length;
    document.getElementById('vdProducto').value = '703';
    document.getElementById('vdCantidad').value = '2';
    document.getElementById('vdCobrado').value = '$20 USD';
    registrarVentaDirecta();
    return { notifs: getNotifs().map(n=>n.type),
             stock: (getProductos().find(x=>x.id===703)||{}).stock,
             despues: getVales().filter(x=>x.ventaDirecta).length, antes };
  });
  ok('deja registrarla igual, con el catálogo en 0', sinStock.despues === sinStock.antes + 1, sinStock);
  ok('el catálogo se queda en 0, no se pone en negativo', sinStock.stock === 0, sinStock.stock);
  ok('y sigue sin avisar nada', sinStock.notifs.length === 0, sinStock.notifs);

  console.log('\n══ 7· NO HAY TOPE DE CANTIDAD: EL ALMACÉN NO APLICA AQUÍ ══');
  const muchas = await p.evaluate(() => {
    const antes = getVales().filter(x=>x.ventaDirecta).length;
    document.getElementById('vdProducto').value = '702';
    document.getElementById('vdCantidad').value = '99';
    document.getElementById('vdCobrado').value = '9999 MN';
    registrarVentaDirecta();
    return { antes, despues: getVales().filter(x=>x.ventaDirecta).length,
             stock:(getProductos().find(x=>x.id===702)||{}).stock };
  });
  ok('sí deja registrarla, aunque "99" no quepa en el catálogo',
     muchas.despues === muchas.antes + 1, muchas);
  ok('y el almacén del producto de catálogo sigue con sus 4, intacto',
     muchas.stock === 4, muchas.stock);

  console.log('\n══ 8· UNA RESERVA DE OTRO VALE NO BLOQUEA NADA AQUÍ ══');
  const conReserva = await p.evaluate(() => {
    // Un vale que ya salió con el mensajero aparta sus unidades aunque el stock
    // todavía no se haya descontado — esto es del sistema normal de almacén,
    // ajeno del todo a las ventas directas.
    const t = new Date().toISOString();
    const todos = getVales();
    todos.push({id:7010, valeNum:9, gestorId:1, status:'assigned', mensajeroId:50, ts:t,
                cliente:'Otro', articulo:'×4 Cargador',
                valeProductos:[{id:702, name:'Cargador', qty:4}],
                total:'10000 MN', valeText:''});
    saveVales(todos);
    _refrescarReservas();
    const disponible = _availableStock(productoOf(702));   // 0: todo reservado
    const antes = getVales().filter(x=>x.ventaDirecta).length;
    document.getElementById('vdProducto').value = '702';
    document.getElementById('vdCantidad').value = '2';
    document.getElementById('vdCobrado').value = '5000 MN';
    registrarVentaDirecta();
    return { disponible, antes, stock:(getProductos().find(x=>x.id===702)||{}).stock,
             despues:getVales().filter(x=>x.ventaDirecta).length };
  });
  ok('el almacén normal no tenía nada libre', conReserva.disponible === 0, conReserva);
  ok('pero la venta directa se registra igual, sin mirar eso',
     conReserva.despues === conReserva.antes + 1, conReserva);
  ok('y el stock del producto no se mueve', conReserva.stock === 4, conReserva.stock);

  console.log('\n══ 9· DESHACER NO TOCA EL ALMACÉN — TAMPOCO LE "DEVUELVE" NADA ══');
  const deshecho = await p.evaluate(async () => {
    saveNotifs([]);
    const stockAntes = (getProductos().find(x=>x.id===703)||{}).stock;
    const v = getVales().filter(x => x.ventaDirecta &&
      (x.valeProductos||[]).some(it => it.id === 703))[0];
    borrarVentaDirecta(v.id);
    document.getElementById('confirmActionOk').click();
    await new Promise(r => setTimeout(r, 250));
    return { stockAntes, stockDespues:(getProductos().find(x=>x.id===703)||{}).stock,
             quedan:getVales().filter(x=>x.ventaDirecta && (x.valeProductos||[]).some(it=>it.id===703)).length,
             notifs:getNotifs().map(n=>n.type) };
  });
  ok('el stock del catálogo no cambia al deshacer (seguía en 0, sigue en 0)',
     deshecho.stockDespues === deshecho.stockAntes, deshecho);
  ok('la venta desaparece de la lista', deshecho.quedan === 0, deshecho);
  ok('y deshacer tampoco manda ningún aviso', deshecho.notifs.length === 0, deshecho.notifs);

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
