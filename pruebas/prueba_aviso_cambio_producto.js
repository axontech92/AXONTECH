// Pedido el 27/09: cuando cambia el precio, la comisión "y cosas así" de un
// producto, que salga en la bandeja de notificaciones de los gestores.
//
//   NODE_PATH=$(npm root -g) node pruebas/prueba_aviso_cambio_producto.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const RAIZ = '/home/user/AXONTECH';
const MIME = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'};
const srv = http.createServer((q, r) => {
  const ruta = q.url.split('?')[0];
  if (ruta.endsWith('/data.json')) { r.writeHead(200, {'Content-Type':'application/json'});
    return r.end('{"gestores":[],"mensajeros":[],"productos":[],"categorias":[]}'); }
  const p = path.join(RAIZ, decodeURIComponent(ruta));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, {'Content-Type': MIME[path.extname(p)] || 'text/plain'});
  r.end(fs.readFileSync(p));
});
let fallos = 0;
const ok = (n, c, e) => { console.log((c?'✅ ':'❌ ')+n+(c?'':'  → '+JSON.stringify(e))); if(!c) fallos++; };

(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const nav = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const ctx = await nav.newContext({viewport:{width:1280,height:1400}});
  await ctx.grantPermissions(['notifications'], { origin: base });
  await ctx.route('**/*', r => r.request().url().includes('127.0.0.1')
    ? r.continue() : r.fulfill({status:200, body:'[]'}));
  const p = await ctx.newPage();
  const errores = [];
  p.on('pageerror', e => errores.push(String(e).slice(0,200)));

  await p.goto(base + '/admin.html', {waitUntil:'domcontentloaded'});
  await p.waitForTimeout(2400);
  await p.fill('#passInput','axon2024');
  await p.click('button:has-text("Entrar")');
  await p.waitForTimeout(900);
  await p.evaluate(() => {
    try { clearInterval(_restPollTimer); } catch(e) {}
    saveCategorias([]); saveVales([]); saveNotifs([]);
    saveGestores([{id:1, name:'Ana', initials:'A', color:'#2563EB'}]);
    saveProductos([{id:1001, name:'Router TP-Link', stock:5, precio:'$100 USD', comision:'$5 USD',
      comisionMoneda:'USD', puntos:1, garantia:'3 meses', desc:'Doble banda'}]);
  });

  // Abre la ficha, cambia lo que se pida y guarda — como lo haría el admin.
  const editar = async cambios => await p.evaluate(async c => {
    saveNotifs([]);
    openEditProductModal(1001);
    for (const [id, v] of Object.entries(c)) { const e = document.getElementById(id); if (e) e.value = v; }
    await saveProduct();
    return getNotifs().map(n => ({type:n.type, extra:n.extra, name:n.productName}));
  }, cambios);

  console.log('══ 1· CAMBIA EL PRECIO Y LA COMISIÓN ══');
  const n1 = await editar({'pm-precio':'$90 USD', 'pm-comision-amount':'8', 'pm-comision-currency':'USD'});
  const c1 = n1.find(n => n.type === 'product_changed');
  ok('sale un aviso de cambio', !!c1, n1);
  ok('dice el precio de antes y el de ahora', c1 && /Precio: \$100 USD → \$90 USD/.test(c1.extra), c1 && c1.extra);
  ok('y la comisión', c1 && /Comisión: \$5 USD → \$8 USD/.test(c1.extra), c1 && c1.extra);
  ok('y NO dice nada de lo que no cambió', c1 && !/Puntos|Garantía|Nombre/.test(c1.extra), c1 && c1.extra);
  ok('va a la bandeja de todos (sin gestor concreto)', c1 && n1.length === 1, n1);

  console.log('\n══ 2· PUNTOS, GARANTÍA Y NOMBRE TAMBIÉN ══');
  const n2 = await editar({'pm-puntos':'3', 'pm-garantia':'6 meses', 'pm-name':'Router TP-Link AX'});
  const c2 = n2.find(n => n.type === 'product_changed');
  ok('puntos 1 → 3', c2 && /Puntos: 1 → 3/.test(c2.extra), c2 && c2.extra);
  ok('garantía', c2 && /Garantía: 3 meses → 6 meses/.test(c2.extra), c2 && c2.extra);
  ok('y el nombre', c2 && /Nombre: Router TP-Link → Router TP-Link AX/.test(c2.extra), c2 && c2.extra);
  ok('el aviso lleva el nombre nuevo', c2 && c2.name === 'Router TP-Link AX', c2 && c2.name);

  console.log('\n══ 3· COMISIÓN QUE PASA DE USD A MN ══');
  const n3 = await editar({'pm-comision-amount':'2000', 'pm-comision-currency':'MN'});
  const c3 = n3.find(n => n.type === 'product_changed');
  ok('se nota el cambio de moneda', c3 && /Comisión: \$8 USD → 2000 MN/.test(c3.extra), c3 && c3.extra);

  console.log('\n══ 4· LO QUE NO LES IMPORTA NO SE AVISA ══');
  const n4 = await editar({'pm-desc':'Doble banda, 4 antenas'});
  ok('cambiar la descripción no avisa', !n4.some(n => n.type === 'product_changed'), n4);
  const n5 = await editar({'pm-costo':'$60 USD'});
  ok('el costo (solo del admin) no se avisa', !n5.some(n => n.type === 'product_changed'), n5);
  ok('ni sale en ningún texto', !JSON.stringify(n5).includes('60'), n5);
  const n6 = await editar({});
  ok('guardar sin tocar nada no avisa', n6.length === 0, n6);
  const n7 = await editar({'pm-stock':'0'});
  ok('solo el stock: sale "agotado", no "cambió"',
     n7.some(n => n.type === 'out_of_stock') && !n7.some(n => n.type === 'product_changed'), n7);

  const legacy = await p.evaluate(async () => {
    // Un producto viejo: la comisión guardada como "5" con la moneda aparte.
    patchProducto(1001, {comision:'5', comisionMoneda:'USD'});
    saveNotifs([]);
    openEditProductModal(1001);
    await saveProduct();
    return getNotifs().filter(n => n.type === 'product_changed').map(n => n.extra);
  });
  ok('una comisión vieja ("5") que el formulario reescribe como "$5 USD" no avisa', legacy.length === 0, legacy);

  console.log('\n══ 5· EL GESTOR LO VE EN SU BANDEJA ══');
  await p.evaluate(() => {
    saveNotifs([{id:Date.now(), type:'product_changed', productName:'Router TP-Link AX', productId:1001,
      ts:new Date().toISOString(), read:false, extra:'Precio: $100 USD → $90 USD · Comisión: $5 USD → $8 USD', gestorId:null}]);
  });
  await p.goto(base + '/index.html', {waitUntil:'domcontentloaded'});
  await p.waitForTimeout(2200);
  const bandeja = await p.evaluate(() => {
    try { clearInterval(_restPollTimer); } catch(e) {}
    doSelectGestor(1);
    renderGestorNotifs(); openNotifsModal();
    const el = document.getElementById('gestorNotifsList');
    return { txt: el ? el.textContent.replace(/\s+/g,' ') : '', html: el ? el.innerHTML : '' };
  });
  ok('sale "Cambió: Router TP-Link AX"', /Cambió:\s*Router TP-Link AX/.test(bandeja.txt), bandeja.txt.slice(0,200));
  ok('con el precio viejo tachado y el nuevo', /<s[^>]*>\$100 USD<\/s>/.test(bandeja.html) && /\$90 USD/.test(bandeja.txt), bandeja.txt.slice(0,300));
  ok('con su icono ✏️', /✏️/.test(bandeja.txt), '');

  console.log('\n══ 6· Y LE LLEGA AL TELÉFONO ══');
  const push = await p.evaluate(() => {
    const lanzados = [];
    const orig = window._pushConFoto;
    window._pushConFoto = (titulo, cuerpo) => { lanzados.push({titulo, cuerpo}); };
    const nueva = {id:Date.now()+5, type:'product_changed', productName:'Router TP-Link AX', productId:1001,
      ts:new Date().toISOString(), extra:'Precio: $90 USD → $85 USD'};
    const n = _pushDeProductos([], [nueva]);
    window._pushConFoto = orig;
    return { n, lanzados };
  });
  ok('se lanza el aviso del sistema', push.n === 1 && /Cambió un producto/.test((push.lanzados[0]||{}).titulo || ''), push);
  ok('con lo que cambió', /\$85 USD/.test((push.lanzados[0]||{}).cuerpo || ''), push);

  console.log('\n══ ERRORES DE JAVASCRIPT ══');
  const graves = errores.filter(e => !/favicon|manifest|sw\.js|Failed to load resource|net::ERR/i.test(e));
  ok('ninguno', graves.length === 0, graves.slice(0,5));

  await nav.close(); srv.close();
  console.log('\n' + (fallos ? '❌ ' + fallos + ' fallo(s)' : '✅ todo correcto'));
  process.exit(fallos ? 1 : 0);
})();
