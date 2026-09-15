// RECORRIDO 5 — Dos teléfonos contra una Supabase de mentira. Es donde la app
// se juega el inventario: el gestor manda sin cobertura, el admin confirma, y
// los dos tienen que acabar contando lo mismo.
//
//   NODE_PATH=$(npm root -g) node pruebas/recorrido_sync.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const RAIZ = '/home/user/AXONTECH';
const MIME = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'};
const srv = http.createServer((q, r) => {
  // data.json es la foto que el repositorio lleva para sembrar un teléfono
  // nuevo: son los ~100 productos y los 52 gestores de verdad. Aquí estorba —lo
  // que se prueba es la sincronización, no la siembra— así que se sirve vacía.
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

// ── La nube de mentira ──────────────────────────────────────────────────────
const NUBE = { meta:{}, tablas:{} };
let CAIDA = false;               // se puede "cortar la conexión" a voluntad
let MORDAZA = false;             // la nube responde vacío aunque tenga datos
const PETICIONES = [];
function nubeResponde(url, metodo, cuerpo) {
  if (CAIDA) return {status:503, body:'{"error":"sin conexión"}'};
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
  // El stock no se escribe con un número absoluto: se manda "quita 2" y el
  // servidor lo aplica. Así dos teléfonos vendiendo a la vez no se pisan. Aquí
  // se imita esa suma, incluido el tope en cero.
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
  // El gestor NO escribe la tabla directamente: manda su vale por un RPC del
  // servidor que fusiona y preserva los campos del admin (status, confirmedTs…).
  // Aquí se imita esa fusión, que es justo lo que hace en Supabase.
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
  if (MORDAZA) return {status:200, body:'[]'};
  const filas = Object.entries(NUBE.tablas[ruta]||{}).map(([id,v]) => ({id:Number(id), data:v.data, updated_at:v.updated_at}));
  return {status:200, body: JSON.stringify(filas)};
}

(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const puerto = srv.address().port;
  const nav = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const errores = [];
  const abrir = async (pagina, etiqueta) => {
    const ctx = await nav.newContext({viewport:{width:430,height:1200}});
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
    await pg.goto(`http://127.0.0.1:${puerto}/${pagina}`, {waitUntil:'domcontentloaded'});
    await pg.waitForTimeout(2300);
    return pg;
  };

  const PRODS = [{id:960, name:'Equipo', stock:6, precio:'$10 USD', comision:'$2 USD', puntos:1}];

  console.log('══ 1 · EL ADMIN PUBLICA EL CATÁLOGO ══');
  const A = await abrir('admin.html','admin');
  await A.fill('#passInput','axon2024');
  await A.click('button:has-text("Entrar")');
  await A.waitForTimeout(800);
  await A.waitForTimeout(1500);
  await A.evaluate(P => {
    saveProductos(P); saveCategorias([]); saveVales([]); saveNotifs([]);
    saveGestores([{id:1,name:'Ana',initials:'A',color:'#2563EB'}]);
    saveMensajeros([{id:50,name:'Yoel'}]);
  }, PRODS);
  await A.waitForTimeout(3000);
  ok('los productos llegan a la nube', !!NUBE.tablas.productos, Object.keys(NUBE.tablas));
  ok('y los gestores también', !!NUBE.tablas.gestores, Object.keys(NUBE.tablas));

  console.log('\n══ 2 · EL GESTOR ABRE SU APP Y LO RECIBE ══');
  const G = await abrir('index.html','gestor');
  await G.waitForTimeout(8000);
  const recibido = await G.evaluate(() => ({
    prods: getProductos().map(p => p.id+':'+p.name+':'+p.stock),
    gestores: getGestores().map(g => g.name),
  }));
  ok('el gestor ve el catálogo del admin', recibido.prods.length === 1, recibido.prods);
  ok('con el stock correcto', /:6$/.test(recibido.prods[0]||''), recibido.prods);
  ok('y la lista de gestores', recibido.gestores.join() === 'Ana', recibido.gestores);

  console.log('\n══ 3 · SE CAE LA CONEXIÓN Y EL GESTOR MANDA IGUAL ══');
  CAIDA = true;
  const sinRed = await G.evaluate(() => {
    doSelectGestor(1);
    currentValeProductos = [{id:960, name:'Equipo', qty:2}];
    const set = (i,v) => { const e=document.getElementById(i); if(e) e.value=v; };
    set('vf-cliente','Sin cobertura'); set('vf-telefono','55551111');
    set('vf-direccion','Calle X'); set('vf-articulo','×2 Equipo'); set('vf-total','$20 USD');
    onFormInput();
    sendVale();
    const v = getVales()[getVales().length-1];
    return { creado: !!v, synced: v && v.synced, cliente: v && v.cliente };
  });
  ok('el vale se crea sin conexión', sinRed.creado, sinRed);
  ok('y queda marcado como pendiente de subir', sinRed.synced === false, sinRed);
  await G.waitForTimeout(2500);
  ok('la nube NO tiene ese vale todavía',
     !Object.values(NUBE.tablas.vales||{}).some(v => v.data && v.data.cliente === 'Sin cobertura'),
     Object.keys(NUBE.tablas.vales||{}));

  console.log('\n── vuelve la conexión ──');
  CAIDA = false;
  // No se toca nada: la app tiene su propio reintento (_startPollIfPending
  // reencola cada 5 s mientras queden vales sin subir). Lo que se comprueba es
  // justo que suba SOLA, sin ayuda.
  const esperarA = async (cond, ms) => { const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await cond()) return true; await G.waitForTimeout(1000); } return false; };
  const subio = await esperarA(async () =>
    Object.values(NUBE.tablas.vales||{}).some(v => v.data && v.data.cliente === 'Sin cobertura'), 45000);
  ok('sube sola en cuanto vuelve la red, sin tocar nada', subio, Object.keys(NUBE.tablas));
  const yaSubido = await G.evaluate(() => (getVales()[0]||{}).synced);
  ok('y se marca como sincronizado', yaSubido !== false, yaSubido);

  console.log('\n══ 4 · AL ADMIN LE LLEGA Y LO CONFIRMA ══');
  const esperarAdmin = async (cond, ms) => { const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await cond()) return true; await A.waitForTimeout(1000); } return false; };
  await esperarAdmin(async () => await A.evaluate(() => !!getVales().find(x => x.cliente === 'Sin cobertura')), 30000);
  const enAdmin = await A.evaluate(() => {
    const v = getVales().find(x => x.cliente === 'Sin cobertura');
    return { llego: !!v, id: v && v.id, items: v && (v.valeProductos||[]).length };
  });
  ok('el vale del gestor llega al admin', enAdmin.llego, enAdmin);
  ok('con sus productos', enAdmin.items === 1, enAdmin);

  const confirmado = await A.evaluate(id => {
    confirmSale(id, 'confirmed', true);
    const v = getVales().find(x=>x.id===id);
    return { stock:_numStock(productoOf(960).stock), salido:v.stockSalido, status:v.status };
  }, enAdmin.id);
  ok('el admin descuenta: 6 − 2 = 4', confirmado.stock === 4, confirmado);
  ok('y apunta lo que salió', confirmado.salido && confirmado.salido['960'] === 2, confirmado.salido);

  console.log('\n══ 5 · EL GESTOR VE EL MISMO NÚMERO ══');
  await A.waitForTimeout(3000);
  await G.evaluate(() => { try { _ultimoPollLento = 0; _ultimoFetchReal.productos = 0; _ultimaTsVisto.productos = undefined; _doRestPoll(); } catch(e) {} });
  await G.waitForTimeout(7000);
  const enGestor = await G.evaluate(() => ({
    stock:_numStock(productoOf(960).stock),
    estado:(getVales()[0]||{}).status,
    pts:getGestorPointsTotal(1),
  }));
  ok('el gestor ve el stock ya descontado: 4', enGestor.stock === 4, enGestor);
  ok('y su vale como confirmado', enGestor.estado === 'confirmed', enGestor);
  ok('y sus puntos: 2 unidades × 1 punto', enGestor.pts === 2, enGestor);

  console.log('\n══ 6 · EL ADMIN REVIERTE Y EL GESTOR SE ENTERA ══');
  await A.evaluate(id => revertConfirmSale(id, true), enAdmin.id);
  await A.waitForTimeout(3000);
  // OJO con el tiempo: durante 60 s desde su último cambio local, el teléfono
  // del gestor defiende SU versión del vale frente a la de la nube
  // (_LOCAL_WINS_WINDOW_MS). Está puesto a propósito, para que una lectura vieja
  // no deshaga lo que se acaba de hacer aquí. Consecuencia: una reversión del
  // admin puede tardar hasta un minuto en verse en el teléfono del gestor. Se
  // espera a que pase esa ventana, que es lo que haría el gestor de verdad.
  await G.waitForTimeout(4000);
  await G.evaluate(() => { try { _ultimoPollLento = 0; _ultimoFetchReal.productos = 0; _ultimaTsVisto.productos = undefined; _doRestPoll(); } catch(e) {} });
  await G.waitForTimeout(16000);
  const enLaVentana = await G.evaluate(() => (getVales()[0]||{}).status);
  console.log('   (dentro de la ventana de 60 s el gestor aún ve:', enLaVentana + ')');
  await G.waitForTimeout(50000);
  await G.evaluate(() => { try { _doRestPoll(); } catch(e) {} });
  await G.waitForTimeout(8000);
  const trasRevertir = await G.evaluate(() => ({
    stock:_numStock(productoOf(960).stock),
    estado:(getVales()[0]||{}).status,
    pts:getGestorPointsTotal(1),
  }));
  ok('la mercancía vuelve y el gestor lo ve: 6', trasRevertir.stock === 6, trasRevertir);
  ok('pasada la ventana, su vale ya no está confirmado', trasRevertir.estado !== 'confirmed', trasRevertir);
  ok('y pierde los puntos de esa venta', trasRevertir.pts === 0, trasRevertir);

  console.log('\n══ 7 · LA NUBE CONTESTA VACÍO Y NO SE LLEVA NADA POR DELANTE ══');
  const antesDeVaciar = await G.evaluate(() => ({
    prods:getProductos().length, gestores:getGestores().length }));
  // Se vacían las tablas en la nube COMO SI fuera un fallo (sin borrar de verdad).
  // Ojo: no se vacía la nube de verdad. Se le pone una MORDAZA: sigue teniendo
  // las filas, pero contesta [] como si se hubiera caído. Es el fallo real —un
  // 404, un permiso mal puesto, una respuesta cortada— y lo que no puede pasar
  // es que el teléfono se crea ese vacío y borre lo suyo.
  MORDAZA = true;
  await G.evaluate(() => { try { _ultimoPollLento = 0; _ultimoFetchReal.productos = 0; _ultimoFetchReal.gestores = 0;
    _ultimaTsVisto.productos = undefined; _ultimaTsVisto.gestores = undefined; _doRestPoll(); } catch(e) {} });
  await G.waitForTimeout(7000);
  const trasVacio = await G.evaluate(() => ({
    prods:getProductos().length, gestores:getGestores().length }));
  ok('el catálogo NO se borra a la primera', trasVacio.prods === antesDeVaciar.prods, {antesDeVaciar, trasVacio});
  ok('la lista de gestores tampoco', trasVacio.gestores === antesDeVaciar.gestores, {antesDeVaciar, trasVacio});
  MORDAZA = false;

  console.log('\n══ ERRORES DE JAVASCRIPT ══');
  const graves = errores.filter(e => !/favicon|manifest|sw\.js|Failed to load resource|net::ERR/i.test(e));
  ok('ninguno', graves.length === 0, graves.slice(0,8));

  await nav.close(); srv.close();
  console.log('\n' + (fallos ? '❌ ' + fallos + ' fallo(s)' : '✅ todo correcto'));
  process.exit(fallos ? 1 : 0);
})();
