// Las ventas directas tienen que llegar a la nube, no quedarse solo en el
// teléfono que las registró — y el producto del catálogo que se elige es solo
// una referencia: su stock NO se toca para nada, ni en el teléfono que vende
// ni en la nube ni en un segundo teléfono que sincronice después.
//
//   NODE_PATH=$(npm root -g) node pruebas/prueba_directas_en_la_nube.js
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

// ── La misma nube de mentira que usa recorrido_sync.js ──────────────────────
const NUBE = { meta:{}, tablas:{} };
const PETICIONES = [];
function nubeResponde(url, metodo, cuerpo) {
  const u = new URL(url);
  const ruta = u.pathname.replace('/rest/v1/','');
  PETICIONES.push(metodo+' '+ruta);
  if (ruta === 'meta') {
    if (metodo === 'POST') {
      JSON.parse(cuerpo||'[]').forEach(f => { NUBE.meta[f.name] = {data:f.data, updated_at:new Date().toISOString()}; });
      return {status:201, body:'[]'};
    }
    const eq = (u.searchParams.get('name')||'').replace('eq.','');
    const fila = NUBE.meta[eq];
    if (!fila) return {status:200, body:'[]'};
    const gt = u.searchParams.get('updated_at');
    if (gt && gt.startsWith('gt.')) return {status:200, body: fila.updated_at > gt.slice(3) ? JSON.stringify([{name:eq}]) : '[]'};
    return {status:200, body: JSON.stringify([{data:fila.data, updated_at:fila.updated_at}])};
  }
  if (ruta === 'rpc/aplicar_delta_stock') {
    let b = {}; try { b = JSON.parse(cuerpo||'{}'); } catch(e) {}
    const t = NUBE.tablas.productos || {};
    const fila = t[b.p_id];
    if (!fila) return {status:200, body:'-1'};
    const antes = parseInt(fila.data.stock || 0, 10) || 0;
    const ahora = Math.max(0, antes + (parseInt(b.p_delta,10) || 0));
    fila.data = {...fila.data, stock: ahora};
    fila.updated_at = new Date().toISOString();
    return {status:200, body:String(ahora)};
  }
  if (ruta === 'rpc/upsert_vale_from_gestor') {
    let b = {}; try { b = JSON.parse(cuerpo||'{}'); } catch(e) {}
    if (b && b.p_id != null) {
      const t = (NUBE.tablas.vales = NUBE.tablas.vales || {});
      const antes = (t[b.p_id] && t[b.p_id].data) || {};
      const ADMIN = ['status','mensajeroId','assignedTs','confirmedTs','adminNotes','seenByAdmin',
                     'seenTs','commissionStatus','commissionPaid','stockDecremented','stockSalido',
                     'hiddenFromHistory','hiddenTs','unidoA','deliveredTs'];
      const fusion = {...antes, ...(b.p_data||{})};
      ADMIN.forEach(k => { if (antes[k] !== undefined) fusion[k] = antes[k]; });
      t[b.p_id] = {data:fusion, updated_at:new Date().toISOString()};
    }
    return {status:200, body:'{}'};
  }
  if (metodo === 'POST') {
    let filas = []; try { filas = JSON.parse(cuerpo||'[]'); } catch(e) {}
    if (!Array.isArray(filas)) filas = [];
    filas.forEach(f => { if (f && f.id != null) (NUBE.tablas[ruta] = NUBE.tablas[ruta]||{})[f.id] = {data:f.data, updated_at:new Date().toISOString()}; });
    return {status:201, body:'[]'};
  }
  if (metodo === 'DELETE') {
    const idq = (u.searchParams.get('id')||'').replace('eq.','');
    if (NUBE.tablas[ruta] && idq) delete NUBE.tablas[ruta][idq];
    return {status:204, body:''};
  }
  const filas = Object.entries(NUBE.tablas[ruta]||{}).map(([id,v]) => ({id:Number(id), data:v.data, updated_at:v.updated_at}));
  return {status:200, body: JSON.stringify(filas)};
}

(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const puerto = srv.address().port;
  const nav = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const errores = [];
  const abrir = async etiqueta => {
    const ctx = await nav.newContext({viewport:{width:1280,height:1400}});
    await ctx.route('**/*', async r => {
      const url = r.request().url();
      if (url.includes('127.0.0.1')) return r.continue();
      if (url.includes('supabase.co')) {
        const res = nubeResponde(url, r.request().method(), r.request().postData());
        return r.fulfill({status:res.status, contentType:'application/json', body:res.body,
                          headers:{'Access-Control-Allow-Origin':'*'}});
      }
      return r.fulfill({status:200, body:'[]'});
    });
    const pg = await ctx.newPage();
    pg.on('pageerror', e => errores.push('['+etiqueta+'] '+String(e).slice(0,180)));
    await pg.goto(`http://127.0.0.1:${puerto}/admin.html`, {waitUntil:'domcontentloaded'});
    await pg.waitForTimeout(2300);
    await pg.fill('#passInput','axon2024');
    await pg.click('button:has-text("Entrar")');
    await pg.waitForTimeout(900);
    return pg;
  };

  const esperarA = async (pg, cond, ms) => { const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await cond()) return true; await pg.waitForTimeout(500); } return false; };

  const PRODS = [{id:950, name:'Bocina Portátil', stock:8, precio:'$50 USD', comision:'$3 USD', puntos:1}];

  console.log('══ 1 · EL ADMIN A SIEMBRA EL CATÁLOGO Y VENDE DIRECTO ══');
  const A = await abrir('admin-A');
  await A.evaluate(P => {
    saveProductos(P); saveCategorias([]); saveVales([]); saveNotifs([]);
    saveGestores([{id:1,name:'Ana',initials:'A',color:'#2563EB'}]);
    saveMensajeros([]);
  }, PRODS);
  await A.waitForTimeout(2500);
  ok('el catálogo llega a la nube antes de vender', !!NUBE.tablas.productos, Object.keys(NUBE.tablas));

  await A.evaluate(() => {
    adminTab('directas');
    document.getElementById('vdProducto').value = '950';
    vdRefresca();
    document.getElementById('vdCantidad').value = '3';
    document.getElementById('vdCobrado').value = '$150 USD';
    document.getElementById('vdNota').value = 'cliente de la calle';
    registrarVentaDirecta();
  });

  console.log('\n══ 2 · EL VALE DE LA VENTA LLEGA A LA NUBE (no solo local) ══');
  // La comprobación es directamente sobre la NUBE de mentira, del lado Node —
  // no sobre lo que el teléfono CREE que mandó.
  const subioValeReal = await esperarA(A, async () =>
    Object.values(NUBE.tablas.vales || {}).some(v => v.data && v.data.ventaDirecta === true), 15000);
  ok('el vale de la venta directa aparece en la nube', subioValeReal,
     Object.values(NUBE.tablas.vales||{}).map(v=>v.data && v.data.cliente));
  const filaVale = Object.values(NUBE.tablas.vales || {}).find(v => v.data && v.data.ventaDirecta === true);
  ok('con ventaDirecta:true (para que otro teléfono la reconozca)',
     !!filaVale && filaVale.data.ventaDirecta === true, filaVale && filaVale.data);
  ok('con gestorId "admin"', filaVale && filaVale.data.gestorId === 'admin', filaVale && filaVale.data.gestorId);
  ok('con lo que se cobró de verdad, no "Venta Local"',
     filaVale && filaVale.data.total === '$150 USD', filaVale && filaVale.data.total);
  ok('ya confirmada', filaVale && filaVale.data.status === 'confirmed', filaVale && filaVale.data.status);

  console.log('\n══ 3 · EL PRODUCTO DE CATÁLOGO NO SE TOCA EN LA NUBE ══');
  await A.waitForTimeout(2500);
  const filaProd = (NUBE.tablas.productos || {})[950];
  ok('el producto en la nube sigue con sus 8, no baja a 5',
     !!filaProd && parseInt(filaProd.data.stock, 10) === 8, filaProd && filaProd.data);
  ok('y la venta NO llamó al RPC de delta de stock (esta mercancía no vive en el almacén)',
     !PETICIONES.includes('POST rpc/aplicar_delta_stock'), PETICIONES.filter(p=>/productos|delta/.test(p)));

  console.log('\n══ 4 · UN SEGUNDO TELÉFONO VE LA VENTA Y EL MISMO STOCK SIN TOCAR ══');
  const B = await abrir('admin-B');
  await B.waitForTimeout(6000);
  const vistoEnB = await B.evaluate(() => {
    const v = getVales().filter(x => x.ventaDirecta);
    const p = getProductos().find(x => x.id === 950);
    return { ventas: v.length, total: v[0] && v[0].total, stock: p && p.stock };
  });
  ok('el segundo teléfono ve la venta directa', vistoEnB.ventas === 1, vistoEnB);
  ok('con el mismo importe', vistoEnB.total === '$150 USD', vistoEnB.total);
  ok('y el mismo stock, sin tocar (8)', parseInt(vistoEnB.stock, 10) === 8, vistoEnB.stock);

  console.log('\n══ 5 · DESHACERLA TAMBIÉN VIAJA A LA NUBE ══');
  await A.evaluate(() => {
    const v = getVales().find(x => x.ventaDirecta);
    borrarVentaDirecta(v.id);
    document.getElementById('confirmActionOk').click();
  });
  const borradaEnNube = await esperarA(A, async () =>
    !Object.values(NUBE.tablas.vales || {}).some(v => v.data && v.data.ventaDirecta === true), 15000);
  ok('la venta desaparece de la nube al deshacerla', borradaEnNube,
     Object.values(NUBE.tablas.vales||{}).map(v=>v.data && v.data.ventaDirecta));
  await A.waitForTimeout(2500);
  const filaProdTrasDeshacer = (NUBE.tablas.productos || {})[950];
  ok('y el producto sigue con 8 en la nube (deshacer no "repone" lo que nunca se quitó)',
     !!filaProdTrasDeshacer && parseInt(filaProdTrasDeshacer.data.stock, 10) === 8,
     filaProdTrasDeshacer && filaProdTrasDeshacer.data);
  ok('deshacer tampoco llamó nunca al RPC de delta de stock',
     !PETICIONES.includes('POST rpc/aplicar_delta_stock'), PETICIONES.filter(p=>/delta/.test(p)));

  console.log('\n══ 6 · EL SEGUNDO TELÉFONO TAMBIÉN VE EL DESHACER ══');
  const vistoTrasDeshacer = await esperarA(B, async () => await B.evaluate(() =>
    getVales().filter(x => x.ventaDirecta).length === 0), 15000);
  ok('desaparece también del segundo teléfono', vistoTrasDeshacer,
     await B.evaluate(() => getVales().filter(x=>x.ventaDirecta).length));

  console.log('\n══ ERRORES DE JAVASCRIPT ══');
  const graves = errores.filter(e => !/favicon|manifest|sw\.js|Failed to load resource|net::ERR/i.test(e));
  ok('ninguno', graves.length === 0, graves.slice(0,5));

  await nav.close(); srv.close();
  console.log('\n' + (fallos ? '❌ ' + fallos + ' fallo(s)' : '✅ todo correcto'));
  process.exit(fallos ? 1 : 0);
})();
