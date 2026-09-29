// Barrido del 29/09 con los datos reales: lo que salió y quedó arreglado.
//   1. Números de vale repetidos (192 en los datos): el contador retrocedía.
//   2. Vales unidos: se cobraban dos veces y la caja los contaba dos veces.
//   3. Diálogos de confirmación: pintaban como HTML lo que escribe el gestor.
//   4. Respaldo en GitHub (repositorio público): publicaba claves y teléfonos.
//   5. Borrar un producto con ventas: les quitaba los puntos sin avisar.
//   6. Vale con el total vacío (V-150).
//
//   NODE_PATH=$(npm root -g) node pruebas/prueba_barrido_29_09.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const RAIZ = '/home/user/AXONTECH';
const MIME = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'};
// data.json de mentira para la siembra: gestores SIN clave, como lo publica ahora.
const SEMILLA = {gestores:[{id:1,name:'Ana',initials:'A',color:'#2563EB'}],mensajeros:[],productos:[],categorias:[]};
const srv = http.createServer((q, r) => {
  const ruta = q.url.split('?')[0];
  if (ruta.endsWith('/data.json')) { r.writeHead(200, {'Content-Type':'application/json'}); return r.end(JSON.stringify(SEMILLA)); }
  const p = path.join(RAIZ, decodeURIComponent(ruta));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, {'Content-Type': MIME[path.extname(p)] || 'text/plain'});
  r.end(fs.readFileSync(p));
});
let fallos = 0;
const ok = (n, c, e) => { console.log((c?'✅ ':'❌ ')+n+(c?'':'  → '+JSON.stringify(e))); if(!c) fallos++; };

// Nube de mentira solo para `meta` (config), y GitHub de mentira.
const META = {};
const SUBIDO_A_GITHUB = [];
function nube(url, metodo, cuerpo) {
  const u = new URL(url); const ruta = u.pathname.replace('/rest/v1/','');
  if (ruta === 'meta') {
    if (metodo === 'POST') { JSON.parse(cuerpo||'[]').forEach(f => { META[f.name] = f.data; }); return '[]'; }
    const nm = (u.searchParams.get('name')||'').replace('eq.','');
    return META[nm] ? JSON.stringify([{data:META[nm], updated_at:new Date().toISOString()}]) : '[]';
  }
  return '[]';
}

(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const nav = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const ctx = await nav.newContext({viewport:{width:1280,height:1400}});
  await ctx.route('**/*', async r => {
    const url = r.request().url(), m = r.request().method();
    if (url.includes('127.0.0.1')) return r.continue();
    if (url.includes('supabase.co')) return r.fulfill({status:200, contentType:'application/json', body:nube(url, m, r.request().postData()), headers:{'Access-Control-Allow-Origin':'*'}});
    if (url.includes('api.github.com')) {
      if (m === 'PUT') { SUBIDO_A_GITHUB.push(JSON.parse(r.request().postData()||'{}')); return r.fulfill({status:200, contentType:'application/json', body:'{"content":{"sha":"x"}}', headers:{'Access-Control-Allow-Origin':'*'}}); }
      return r.fulfill({status:404, contentType:'application/json', body:'{}', headers:{'Access-Control-Allow-Origin':'*'}});
    }
    return r.fulfill({status:200, body:'[]'});
  });
  const p = await ctx.newPage();
  const errores = [];
  p.on('pageerror', e => errores.push(String(e).slice(0,200)));
  await p.goto(base + '/admin.html', {waitUntil:'domcontentloaded'});
  await p.waitForTimeout(2400);
  await p.fill('#passInput','axon2024');
  await p.click('button:has-text("Entrar")');
  await p.waitForTimeout(900);
  await p.evaluate(() => { try { clearInterval(_restPollTimer); } catch(e) {} });

  console.log('══ 1· EL NÚMERO DE VALE NUNCA RETROCEDE ══');
  const num = await p.evaluate(() => {
    const t = new Date().toISOString();
    saveVales([{id:1, valeNum:400, gestorId:1, status:'pending', ts:t, total:'$1 USD', valeText:''}]);
    try { localStorage.removeItem('axon_vale_num_hw'); } catch(e) {}
    // Config vieja: el contador dice 390 aunque ya hay un V-400.
    _safeSetLS('axon_config', JSON.stringify({...getConfig(), nextValeNum:390})); _configDirty = true;
    const a = getNextValeNum();
    const b = getNextValeNum();
    // Baja de la nube una config con el contador aún más atrás.
    const bajada = _configConContadorAlDia({nextValeNum:380, tasaMargen:10});
    return { a, b, bajada: bajada.nextValeNum, margen: bajada.tasaMargen };
  });
  ok('con un V-400 ya visto, el siguiente es 401 (no 390)', num.a === 401, num);
  ok('y el siguiente 402', num.b === 402, num);
  ok('una config que baja con 380 no lo hace retroceder', num.bajada === 403, num);
  ok('y conserva el resto de la config', num.margen === 10, num);
  // La app sube su propia config en segundo plano (la tasa recién bajada, el
  // contador de los vales de arriba). Se espera a que termine para que esas
  // subidas no se crucen con las de la prueba.
  await p.evaluate(async () => { for (let i = 0; i < 60; i++) { if (!_sbProcessing && !_sbWriteQueue.length) break; await new Promise(r => setTimeout(r, 250)); } });
  const nubeMax = await p.evaluate(async () => {
    await _sbRestMetaUpsert('config', {nextValeNum: 500, tasaMargen: 10});
    await _sbRestMetaMerge('config', {nextValeNum: 450});                 // un teléfono con copia vieja
    const trasMerge = (await _sbRestGetMeta('config')).nextValeNum;
    await _sbRestMetaUpsert('config', {nextValeNum: 420, tasaMargen: 12}); // saveConfig del admin, copia vieja
    const trasUpsert = await _sbRestGetMeta('config');
    return { trasMerge, trasUpsert };
  });
  ok('en la nube, una subida con 450 no baja el 500', nubeMax.trasMerge === 500, nubeMax);
  ok('ni la config entera del admin con 420', nubeMax.trasUpsert.nextValeNum === 500, nubeMax);
  ok('pero el resto de esa config sí se guarda', nubeMax.trasUpsert.tasaMargen === 12, nubeMax);

  console.log('\n══ 2· UN VALE UNIDO NO SE COBRA DOS VECES ══');
  const unido = await p.evaluate(() => {
    const t = new Date().toISOString();
    saveGestores([{id:1,name:'Ana',initials:'A',color:'#111',password:'pbkdf2$x'},{id:2,name:'Luis',initials:'L',color:'#222',password:'pbkdf2$y'}]);
    saveVales([
      {id:10, valeNum:10, gestorId:1, status:'confirmed', ts:t, confirmedTs:t, total:'$100 USD', valeText:''},
      {id:11, valeNum:11, gestorId:2, status:'pending', ts:t, total:'$100 USD', unidoA:10, valeText:''},
    ]);
    patchVale(11, {status:'confirmed', confirmedTs:t});
    adminTab('vales'); selectVale(11);
    return { cobrar: _aCobrarVale(getVales().find(x=>x.id===11)),
             caja: totalesCaja(getVales()),
             pagoSec: getVales().find(x=>x.id===11).pago || null,
             bloquePago: !!document.getElementById('valePago'),
             monto: (document.getElementById('valeACobrarMonto')||{}).textContent || '' };
  });
  ok('el vale unido no pide cobro: remite al principal', unido.cobrar.unido && /principal/.test(unido.cobrar.nota), unido.cobrar);
  ok('en su detalle no sale "¿Cómo pagó?"', !unido.bloquePago, unido);
  ok('al confirmarlo no se le congela un pago', unido.pagoSec === null, unido.pagoSec);
  ok('la caja cuenta $100, no $200', unido.caja.usd === 100 && unido.caja.ventas === 1, unido.caja);

  console.log('\n══ 3· LOS DIÁLOGOS NO EJECUTAN LO QUE ESCRIBE EL GESTOR ══');
  const X = '<img src=x onerror="window.__xss=(window.__xss||0)+1">';
  const dlg = await p.evaluate(X => {
    const t = new Date().toISOString();
    saveVales([{id:20, valeNum:20, gestorId:1, status:'confirmed', ts:t, confirmedTs:t, cliente:X, articulo:X, total:'$5 USD '+X, stockDecremented:true, valeText:''},
               {id:21, valeNum:21, gestorId:1, status:'delivered', ts:t, cliente:X, articulo:X, total:'$5 USD '+X, valeText:''}]);
    adminDeleteVale(20);
    const sub = document.getElementById('confirmActionSub').innerHTML;
    document.getElementById('confirmActionModal') && document.getElementById('confirmActionModal').classList.remove('show');
    revertConfirmSale(20);
    try { confirmSale(21, 'confirmed'); } catch(e) {}
    return { sub };
  }, X);
  await p.waitForTimeout(400);
  const xss = await p.evaluate(() => window.__xss || 0);
  ok('ni borrar, ni revertir, ni confirmar ejecutan código', xss === 0, xss);
  ok('el texto sale escapado, como texto', /&lt;img/.test(dlg.sub), dlg.sub.slice(0,120));

  console.log('\n══ 4· EL RESPALDO EN GITHUB NO LLEVA CLAVES NI TELÉFONOS ══');
  await p.evaluate(async () => {
    saveGestores([{id:1,name:'Ana',initials:'A',color:'#111',password:'CLAVEPLANA',phone:'5351234567'},
                  {id:2,name:'Luis',initials:'L',color:'#222',password:'pbkdf2$100000$abc$def',phone:'5359999999'}]);
    localStorage.setItem('axon_gh_token', 'ghp_' + 'x'.repeat(36));
    saveConfig({...getConfig(), ghRepo:'prueba/repo', ghPath:'data.json'});
    await syncToGitHub(true);
  });
  const subido = SUBIDO_A_GITHUB.length ? JSON.parse(Buffer.from(SUBIDO_A_GITHUB[SUBIDO_A_GITHUB.length-1].content, 'base64').toString('utf8')) : null;
  ok('se sube el respaldo', !!subido, SUBIDO_A_GITHUB.length);
  ok('sin claves de los gestores', subido && subido.gestores.every(g => g.password === undefined), subido && subido.gestores);
  ok('sin sus teléfonos', subido && subido.gestores.every(g => g.phone === undefined), subido && subido.gestores);
  ok('y el texto no contiene la clave en ninguna parte', subido && !JSON.stringify(subido).includes('CLAVEPLANA'), '');
  const rest = await p.evaluate(sub => {
    const r = _gestoresDeRespaldo(sub.gestores);
    return r.map(g => ({id:g.id, password:g.password, phone:g.phone}));
  }, subido);
  ok('restaurar desde ese respaldo conserva las claves que ya hay', rest[0].password === 'CLAVEPLANA' && rest[1].password.startsWith('pbkdf2$'), rest);
  ok('y los teléfonos', rest[0].phone === '5351234567', rest);

  console.log('\n══ 5· UN TELÉFONO NUEVO NO ENTRA SIN CLAVE CON LA SIEMBRA ══');
  const ctx2 = await nav.newContext({viewport:{width:430,height:1200}});
  await ctx2.route('**/*', r => r.request().url().includes('127.0.0.1') ? r.continue() : r.fulfill({status:200, body:'[]'}));
  const g = await ctx2.newPage();
  g.on('pageerror', e => errores.push(String(e).slice(0,200)));
  await g.goto(base + '/index.html', {waitUntil:'domcontentloaded'});
  await g.waitForTimeout(3500);
  const semilla = await g.evaluate(() => {
    try { clearInterval(_restPollTimer); } catch(e) {}
    const ana = getGestores().find(x => x.id === 1);
    selectGestor(1);
    return { sembrada: !!ana, marca: ana && ana._semilla, entro: activeGestorId === 1,
             pideClave: document.getElementById('gestorPassModal').classList.contains('show') };
  });
  ok('la lista se siembra (se ven los nombres)', semilla.sembrada, semilla);
  ok('marcada como semilla', semilla.marca === true, semilla);
  ok('y NO deja entrar sin clave', !semilla.entro, semilla);
  await ctx2.close();

  console.log('\n══ 6· BORRAR UN PRODUCTO CON VENTAS AVISA ══');
  const borrar = await p.evaluate(() => {
    const t = new Date().toISOString();
    saveProductos([{id:77, name:'Cámara', stock:3, precio:'$50 USD', puntos:2}, {id:78, name:'Funda', stock:3, precio:'$5 USD'}]);
    saveVales([{id:30, valeNum:30, gestorId:1, status:'confirmed', ts:t, confirmedTs:t, total:'$50 USD', valeProductos:[{id:77,qty:1}], valeText:''},
               {id:31, valeNum:31, gestorId:1, status:'confirmed', ts:t, confirmedTs:t, total:'$50 USD', valeProductos:[{id:77,qty:1}], valeText:''}]);
    removeProducto(77);
    const con = document.getElementById('confirmActionSub').innerHTML;
    const boton = document.getElementById('confirmActionOk').textContent;
    removeProducto(78);
    const sin = document.getElementById('confirmActionSub').innerHTML;
    return { con, boton, sin };
  });
  ok('dice cuántas ventas tiene', /Tiene 2 ventas/.test(borrar.con), borrar.con.slice(0,160));
  ok('y que dejan de dar puntos', /dejan de dar puntos/.test(borrar.con), '');
  ok('el botón es "Borrar igual"', borrar.boton === 'Borrar igual', borrar.boton);
  ok('un producto sin ventas no lleva el aviso', !/ventas/.test(borrar.sin), borrar.sin);

  console.log('\n══ 7· EL TOTAL NO SE PUEDE GUARDAR VACÍO ══');
  const total = await p.evaluate(() => {
    const t = new Date().toISOString();
    saveVales([{id:40, valeNum:40, gestorId:1, status:'pending', ts:t, total:'$50 USD', precioUSD:'$50 USD', valeProductos:[{id:77,qty:1}], valeText:''}]);
    openEditValeModal(40);
    document.getElementById('ev-total').value = '';
    saveEditVale();
    return getVales().find(x=>x.id===40).total;
  });
  ok('si se borra, se recalcula de los precios', /\$50 USD/.test(total || ''), total);

  console.log('\n══ 8· LAS CLAVES EN TEXTO PLANO SE ENCRIPTAN SOLAS ══');
  const claves = await p.evaluate(async () => {
    saveGestores([{id:1,name:'Ana',initials:'A',color:'#111',password:'k7m2qp9x'},        // plana, minúsculas
                  {id:2,name:'Luis',initials:'L',color:'#222',password:'ZX45RT88'},        // plana
                  {id:3,name:'Eva',initials:'E',color:'#333',password:'pbkdf2$100000$c2FsdA==$00'}]);
    const n = await encriptarClavesViejas();
    const gs = getGestores();
    const plano = gs.filter(g => !String(g.password).startsWith('pbkdf2$')).map(g => g.name);
    return { n, plano, eva: gs[2].password,
      anaMay: await _gestorPassMatches('K7M2QP9X', gs[0].password),
      anaMin: await _gestorPassMatches('k7m2qp9x', gs[0].password),
      luis:   await _gestorPassMatches('zx45rt88', gs[1].password),
      mala:   await _gestorPassMatches('OTRACOSA', gs[1].password) };
  });
  ok('encripta las dos que estaban en texto plano', claves.n === 2 && claves.plano.length === 0, claves);
  ok('no toca la que ya estaba encriptada', claves.eva === 'pbkdf2$100000$c2FsdA==$00', claves.eva);
  ok('cada gestor sigue entrando con su clave de siempre', claves.anaMay && claves.anaMin && claves.luis, claves);
  ok('y una clave mala sigue sin valer', !claves.mala, claves);

  console.log('\n══ ERRORES DE JAVASCRIPT ══');
  const graves = errores.filter(e => !/favicon|manifest|sw\.js|Failed to load resource|net::ERR/i.test(e));
  ok('ninguno', graves.length === 0, graves.slice(0,5));

  await nav.close(); srv.close();
  console.log('\n' + (fallos ? '❌ ' + fallos + ' fallo(s)' : '✅ todo correcto'));
  process.exit(fallos ? 1 : 0);
})();
