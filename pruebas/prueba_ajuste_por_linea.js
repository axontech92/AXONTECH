// Ajustes producto a producto: el gestor baja SU comisión en una línea y el
// admin rebaja el precio de otra, cada una en su moneda.
//
//   NODE_PATH=$(npm root -g) node pruebas/prueba_ajuste_por_linea.js
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

// El caso que se pidió: 10 nanos (comisión $10 c/u = $100) y 1 POE (10000 MN).
const PRODS = [
  {id:970, name:'Nanostation', stock:50, precio:'$50 USD',  comision:'$10 USD', puntos:1},
  {id:971, name:'POE',         stock:50, precio:'30000 MN', comision:'10000 MN', puntos:1},
];

(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const nav = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const ctx = await nav.newContext({viewport:{width:430,height:1400}});
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

  const montar = async (items, extra) => await p.evaluate(([P, its, ex]) => {
    try { clearInterval(_restPollTimer); } catch(e) {}
    saveProductos(P); saveCategorias([]);
    saveGestores([{id:1,name:'Ana',initials:'A',color:'#2563EB'}]);
    saveConfig({...getConfig(), tasaUSD:400, tasaUSDTs:Date.now(), tasaMargen:0, metaModo:'off'});
    try { localStorage.removeItem('axon_tasa_usd'); } catch(e) {}
    const t = new Date().toISOString();
    saveVales([{id:9100, valeNum:1, gestorId:1, status:'confirmed', ts:t, confirmedTs:t,
      cliente:'Cli', valeProductos:its,
      precioUSD:'$500 USD', precioMN:'30000 MN', total:'$500 USD + 30000 MN',
      stockDecremented:true, ...(ex||{})}]);
    const v = getVales()[0];
    return { com:getValeCommissionParts(v), cobrada:_ventaCobradaVale(v),
             venta:_ventaVale(v), rebaja:_rebajaVale(v) };
  }, [PRODS, items, extra]);

  console.log('══ SIN AJUSTES: LA COMISIÓN DEL CATÁLOGO ══');
  let r = await montar([{id:970, name:'Nanostation', qty:10}, {id:971, name:'POE', qty:1}]);
  ok('10 nanos dan $100 de comisión', r.com.totalUSD === 100, r.com);
  ok('y el POE, 10000 MN', r.com.totalMN === 10000, r.com);
  ok('el cliente paga el precio entero',
     r.cobrada.usd === 500 && r.cobrada.mn === 30000, r.cobrada);

  console.log('\n══ EL GESTOR BAJA 50 EN LOS NANOS Y 4000 EN EL POE ══');
  r = await montar([
    {id:970, name:'Nanostation', qty:10, cedidaUSD:50},
    {id:971, name:'POE',         qty:1,  cedidaMN:4000},
  ]);
  ok('le quedan $50 de comisión en los nanos', r.com.totalUSD === 50, r.com);
  ok('y 6000 MN en el POE', r.com.totalMN === 6000, r.com);
  ok('el cliente paga $50 menos', r.cobrada.usd === 450, r.cobrada);
  ok('y 4000 MN menos', r.cobrada.mn === 26000, r.cobrada);
  ok('el precio de lista NO cambia', r.venta.usd === 500 && r.venta.mn === 30000, r.venta);
  ok('el vale dice cuánto se rebajó en total',
     /50/.test(r.rebaja.rebajaTxt) && /4\.?000/.test(r.rebaja.rebajaTxt), r.rebaja.rebajaTxt);
  ok('y que lo rebajó el gestor', !!r.rebaja.gestor && !r.rebaja.admin, r.rebaja.gestor);

  console.log('\n══ EL ADMIN REBAJA EL PRECIO DE UNA LÍNEA ══');
  r = await montar([
    {id:970, name:'Nanostation', qty:10, rebajaUSD:80},
    {id:971, name:'POE',         qty:1},
  ]);
  ok('el cliente paga $80 menos', r.cobrada.usd === 420, r.cobrada);
  ok('los pesos no se tocan', r.cobrada.mn === 30000, r.cobrada);
  ok('y la comisión del gestor queda intacta',
     r.com.totalUSD === 100 && r.com.totalMN === 10000, r.com);
  ok('el vale dice que lo rebajó el admin', !!r.rebaja.admin && !r.rebaja.gestor, r.rebaja.admin);

  console.log('\n══ LOS DOS A LA VEZ, Y ADEMÁS LO GENERAL ══');
  r = await montar(
    [{id:970, name:'Nanostation', qty:10, cedidaUSD:50, rebajaUSD:30},
     {id:971, name:'POE',         qty:1,  cedidaMN:4000}],
    {comisionCedida:5, comisionCedidaMoneda:'USD', rebajaAdmin:1000, rebajaAdminMoneda:'MN'});
  ok('la comisión baja por lo de la línea Y por lo general: 100 − 50 − 5 = 45',
     r.com.totalUSD === 45, r.com);
  ok('en pesos: 10000 − 4000 = 6000', r.com.totalMN === 6000, r.com);
  ok('el cliente paga 500 − 50 − 30 − 5 = $415', r.cobrada.usd === 415, r.cobrada);
  ok('y 30000 − 4000 − 1000 = 25000 MN', r.cobrada.mn === 25000, r.cobrada);
  ok('el vale enseña lo del gestor y lo del admin por separado',
     !!r.rebaja.gestor && !!r.rebaja.admin, r.rebaja);

  console.log('\n══ NADA PUEDE QUEDAR EN NEGATIVO ══');
  r = await montar([{id:970, name:'Nanostation', qty:1, cedidaUSD:9999, rebajaUSD:9999}]);
  ok('la comisión se queda en cero, no en negativo', r.com.totalUSD === 0, r.com);
  ok('y lo que paga el cliente, también', r.cobrada.usd === 0, r.cobrada);

  console.log('\n══ EL CORTE DE DUEÑOS ══');
  const corte = await p.evaluate(() => {
    // addDueno devuelve la ficha entera, y setDuenoProducto quiere el id.
    const d1 = addDueno('Carlos'), d2 = addDueno('Marta');
    setDuenoProducto(970, d1.id); setDuenoProducto(971, d2.id);
    const t = new Date().toISOString();
    saveVales([{id:9200, valeNum:2, gestorId:1, status:'confirmed', ts:t, confirmedTs:t,
      cliente:'Cli', stockDecremented:true,
      valeProductos:[{id:970, name:'Nanostation', qty:10, rebajaUSD:80},
                     {id:971, name:'POE', qty:1}],
      precioUSD:'$500 USD', precioMN:'30000 MN', total:'$500 USD + 30000 MN'}]);
    const r = _lineasPorDueno(getVales());
    return [...r.porDueno.values()].map(g => ({n:g.nombre, usd:g.ventaUSD, mn:g.ventaMN}));
  });
  const carlos = corte.find(c => /Carlos/.test(c.n)) || {};
  const marta  = corte.find(c => /Marta/.test(c.n))  || {};
  ok('la rebaja de los nanos baja SOLO lo de Carlos: 500 − 80 = 420',
     carlos.usd === 420, corte);
  ok('y lo de Marta se queda entero: 30000 MN', marta.mn === 30000, corte);

  console.log('\n══ LOS VALES DE ANTES SIGUEN IGUAL ══');
  r = await montar([{id:970, name:'Nanostation', qty:10}, {id:971, name:'POE', qty:1}],
                   {comisionCedida:20, comisionCedidaMoneda:'USD'});
  ok('la cesión de todo el vale sigue funcionando sola', r.com.totalUSD === 80, r.com);
  ok('y baja lo que paga el cliente', r.cobrada.usd === 480, r.cobrada);

  console.log('\n══ LA PANTALLA DEL GESTOR ══');
  // El formulario del vale vive en index.html, no en el panel del admin.
  const ctxG = await nav.newContext({viewport:{width:430,height:1400}});
  await ctxG.route('**/*', r => r.request().url().includes('127.0.0.1')
    ? r.continue() : r.fulfill({status:200, body:'[]'}));
  const g = await ctxG.newPage();
  g.on('pageerror', e => errores.push('[gestor] ' + String(e).slice(0,200)));
  await g.goto(`http://127.0.0.1:${srv.address().port}/index.html`, {waitUntil:'domcontentloaded'});
  await g.waitForTimeout(2600);
  await g.evaluate(P => {
    try { clearInterval(_restPollTimer); } catch(e) {}
    saveProductos(P); saveCategorias([]); saveVales([]);
    saveGestores([{id:1,name:'Ana',initials:'A',color:'#2563EB'}]);
  }, PRODS);
  const gest = await g.evaluate(() => {
    doSelectGestor(1);
    pickerSelected = {}; currentValeProductos = []; selectedProductsUI = [];
    pickerAdj(970, 10); pickerAdj(971, 1);
    confirmPickerSelection();
    const casillas = [...document.querySelectorAll('#selectedProductsList input[data-linea]')]
      .map(i => ({ valor: i.value, max: i.max }));
    return { casillas, texto:(document.getElementById('selectedProductsList')||{}).textContent||'',
             com:(document.getElementById('vf-comisionGestor')||{}).value };
  });
  ok('sale una casilla de comisión por cada producto', gest.casillas.length === 2, gest.casillas);
  ok('la de los 10 nanos arranca en 100', gest.casillas[0].valor === '100', gest.casillas);
  ok('y la del POE en 10000', gest.casillas[1].valor === '10000', gest.casillas);
  ok('cada una dice en qué moneda va',
     /USD/.test(gest.texto) && /MN/.test(gest.texto), gest.texto.replace(/\s+/g,' ').slice(0,200));

  const tras = await g.evaluate(() => {
    cambiarComisionLinea(0, '50');      // 10 nanos: de 100 a 50
    cambiarComisionLinea(1, '6000');    // POE: de 10000 a 6000
    return { items: currentValeProductos.map(i => ({id:i.id, cU:i.cedidaUSD, cM:i.cedidaMN})),
             com:(document.getElementById('vf-comisionGestor')||{}).value,
             texto:(document.getElementById('selectedProductsList')||{}).textContent||'' };
  });
  ok('se guarda lo cedido en los nanos: 50 USD', tras.items[0].cU === 50, tras.items);
  ok('y en el POE: 4000 MN', tras.items[1].cM === 4000, tras.items);
  ok('la casilla de comisión del vale se pone al día sola',
     /50/.test(tras.com) && /6000/.test(tras.com), tras.com);
  ok('y se avisa de cuánto baja el cliente',
     /al cliente/.test(tras.texto), tras.texto.replace(/\s+/g,' ').slice(0,240));

  const noMas = await g.evaluate(() => {
    cambiarComisionLinea(0, '500');     // más de lo que da
    return currentValeProductos[0].cedidaUSD;
  });
  ok('no deja cobrar más de lo que da el producto', noMas === 0, noMas);

  const mandado = await g.evaluate(() => {
    cambiarComisionLinea(0, '50'); cambiarComisionLinea(1, '6000');
    const set=(i,v)=>{const e=document.getElementById(i); if(e) e.value=v;};
    set('vf-cliente','Cli'); set('vf-telefono','5555'); set('vf-direccion','X');
    onFormInput(); sendVale();
    const v = getVales()[getVales().length-1];
    return { items:(v.valeProductos||[]).map(i=>({cU:i.cedidaUSD,cM:i.cedidaMN})),
             fijadaUSD:v.comFijadaUSD, fijadaMN:v.comFijadaMN,
             com:getValeCommissionParts(v), cobrada:_ventaCobradaVale(v) };
  });
  ok('el vale guarda los ajustes de cada línea',
     mandado.items[0].cU === 50 && mandado.items[1].cM === 4000, mandado.items);
  ok('la comisión congelada guarda lo BRUTO (100 y 10000), no lo ya rebajado',
     mandado.fijadaUSD === 100 && mandado.fijadaMN === 10000, mandado);
  ok('y al leer el vale la comisión sale neta, sin restar dos veces',
     mandado.com.totalUSD === 50 && mandado.com.totalMN === 6000, mandado.com);
  ok('el cliente paga lo rebajado', mandado.cobrada.usd === 450, mandado.cobrada);

  console.log('\n══ LA PANTALLA DEL ADMIN ══');
  // El vale que acaba de mandar el gestor se lleva al panel del admin.
  const valeDelGestor = await g.evaluate(() => getVales()[getVales().length-1]);
  await p.evaluate(v => { saveVales([v]); }, valeDelGestor);
  const adm = await p.evaluate(() => {
    const v = getVales()[getVales().length-1];
    adminTab('vales'); selectVale(v.id);
    openRebajaAdminModal(v.id);
    const filas = [...document.querySelectorAll('#rebajaAdminLineas input')].map(i => i.max);
    return { filas, texto:(document.getElementById('rebajaAdminLineas')||{}).textContent||'' };
  });
  ok('el admin ve una casilla de rebaja por producto', adm.filas.length === 2, adm.filas);
  ok('con el precio de cada línea como tope', adm.filas[0] === '500', adm.filas);
  ok('y dice de cuánto es cada una', /500 USD/.test(adm.texto) && /30000 MN/.test(adm.texto),
     adm.texto.replace(/\s+/g,' ').slice(0,200));

  const admTras = await p.evaluate(() => {
    cambiarRebajaLinea(0, '80');
    const v = getVales()[getVales().length-1];
    return { items:(v.valeProductos||[]).map(i=>({rU:i.rebajaUSD, rM:i.rebajaMN})),
             cobrada:_ventaCobradaVale(v), com:getValeCommissionParts(v),
             resultado:(document.getElementById('rebajaAdminResultado')||{}).textContent||'' };
  });
  ok('se guarda la rebaja en esa línea', admTras.items[0].rU === 80, admTras.items);
  ok('el cliente paga 500 − 50 (gestor) − 80 (admin) = $370', admTras.cobrada.usd === 370, admTras.cobrada);
  ok('la comisión del gestor NO se toca con la rebaja del admin',
     admTras.com.totalUSD === 50, admTras.com);
  ok('y el modal dice en cuánto queda', /370/.test(admTras.resultado), admTras.resultado);

  const admNoMas = await p.evaluate(() => {
    cambiarRebajaLinea(0, '9999');
    const v = getVales()[getVales().length-1];
    return v.valeProductos[0].rebajaUSD;
  });
  ok('no deja rebajar más de lo que vale la línea', admNoMas === 500, admNoMas);

  console.log('\n══ ERRORES DE JAVASCRIPT ══');
  const graves = errores.filter(e => !/favicon|manifest|sw\.js|Failed to load resource|net::ERR/i.test(e));
  ok('ninguno', graves.length === 0, graves.slice(0,5));

  await nav.close(); srv.close();
  console.log('\n' + (fallos ? '❌ ' + fallos + ' fallo(s)' : '✅ todo correcto'));
  process.exit(fallos ? 1 : 0);
})();
