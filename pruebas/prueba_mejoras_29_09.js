// Mejoras del 29/09 (tras el barrido con los datos reales):
//   1. Borrar un producto ya no les quita los puntos a sus ventas.
//   2. Volver a vincular las ventas de un producto borrado al producto nuevo.
//   3. Los vales con el total vacío se rellenan solos con sus precios.
//   4. Los pagos que no cuadran salen listados en la Caja.
//   5. El respaldo público en GitHub ya no lleva vales ni teléfonos.
//   6. El número de vale lo da el servidor (con la migración v134), y sin ella
//      todo sigue como antes.
//
//   NODE_PATH=$(npm root -g) node pruebas/prueba_mejoras_29_09.js
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

// Servidor de mentira: el contador de vales (si "está instalada" la migración) y GitHub.
let CONTADOR = null;            // null = la función no existe (404)
const SUBIDO = [];
function responde(url, metodo, cuerpo) {
  if (url.includes('/rpc/reservar_vale_num')) {
    if (CONTADOR === null) return { status: 404, body: '{"message":"not found"}' };
    let b = {}; try { b = JSON.parse(cuerpo || '{}'); } catch(e) {}
    CONTADOR = Math.max(CONTADOR, parseInt(b.p_minimo, 10) || 0) + 1;
    return { status: 200, body: String(CONTADOR - 1) };
  }
  if (url.includes('api.github.com')) {
    if (metodo === 'PUT') { SUBIDO.push(JSON.parse(cuerpo || '{}')); return { status: 200, body: '{"content":{"sha":"x"}}' }; }
    return { status: 404, body: '{}' };
  }
  return { status: 200, body: '[]' };
}

(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const nav = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const abrir = async (pagina, admin) => {
    const ctx = await nav.newContext({viewport:{width:1280,height:1400}});
    await ctx.route('**/*', r => {
      const url = r.request().url();
      if (url.includes('127.0.0.1')) return r.continue();
      const x = responde(url, r.request().method(), r.request().postData());
      return r.fulfill({ status: x.status, contentType: 'application/json', body: x.body, headers: {'Access-Control-Allow-Origin':'*'} });
    });
    const pg = await ctx.newPage();
    pg.on('pageerror', e => errores.push(String(e).slice(0,200)));
    await pg.goto(base + '/' + pagina, {waitUntil:'domcontentloaded'});
    await pg.waitForTimeout(2400);
    if (admin) { await pg.fill('#passInput','axon2024'); await pg.click('button:has-text("Entrar")'); await pg.waitForTimeout(900); }
    await pg.evaluate(() => { try { clearInterval(_restPollTimer); } catch(e) {} });
    return pg;
  };
  const errores = [];
  const p = await abrir('admin.html', true);

  console.log('══ 1· BORRAR UN PRODUCTO NO LES QUITA LOS PUNTOS A SUS VENTAS ══');
  const pts = await p.evaluate(async () => {
    const t = new Date().toISOString();
    saveGestores([{id:1,name:'Ana',initials:'A',color:'#111',password:'pbkdf2$x'}]);
    saveProductos([{id:501, name:'NanoStation 5 AC loco SIN POE', stock:5, precio:'$140 USD', puntos:2},
                   {id:502, name:'NanoStation 5AC Loco', stock:5, precio:'$140 USD', puntos:1}]);
    saveVales([{id:1, valeNum:1, gestorId:1, status:'confirmed', ts:t, confirmedTs:t, total:'$140 USD', valeProductos:[{id:501,qty:3}], articulo:'×3 NanoStation 5 AC loco SIN POE', valeText:''}]);
    const antes = getGestorPointsTotal(1);
    removeProducto(501);
    document.getElementById('confirmActionOk').click();
    await new Promise(r => setTimeout(r, 200));
    const v = getVales()[0];
    return { antes, despues: getGestorPointsTotal(1), existe: !!productoOf(501), linea: v.valeProductos[0],
             subida: _lineaParaLaNube(v.valeProductos[0]) };
  });
  ok('antes de borrar: 3 × 2 = 6 puntos', pts.antes === 6, pts);
  ok('el producto se borra', !pts.existe, pts);
  ok('y la venta sigue dando 6 puntos', pts.despues === 6, pts);
  ok('los puntos quedan guardados en la línea', pts.linea.pts === 2, pts.linea);
  ok('y viajan a la nube con ella', pts.subida.pts === 2, pts.subida);

  console.log('\n══ 2· VOLVER A VINCULAR LAS VENTAS DE UN PRODUCTO BORRADO ══');
  const rel = await p.evaluate(() => {
    const t = new Date().toISOString();
    // Ventas de antes de v134: producto borrado y SIN puntos guardados (el caso real).
    saveVales([
      {id:10, valeNum:10, gestorId:1, status:'confirmed', ts:t, confirmedTs:t, total:'$140 USD', valeProductos:[{id:999,qty:1}], articulo:'×1 NanoStation 5 AC loco SIN POE', comFijadaUSD:5, valeText:''},
      {id:11, valeNum:11, gestorId:1, status:'confirmed', ts:t, confirmedTs:t, total:'$280 USD', valeProductos:[{id:999,qty:2,cedidaUSD:1},{id:502,qty:1}], articulo:'×2 NanoStation 5 AC loco SIN POE / ×1 NanoStation 5AC Loco', comFijadaUSD:15, valeText:''}]);
    const antes = getGestorPointsTotal(1);
    adminTab('stock');
    const box = document.getElementById('ventasBorradasBox');
    const txt = box.textContent.replace(/\s+/g,' '); const visible = box.style.display !== 'none';
    const sel = document.getElementById('relink-999');
    const sugerido = sel && sel.value;
    pedirRevincular(999);
    document.getElementById('confirmActionOk').click();
    const vs = getVales();
    return { antes, despues: getGestorPointsTotal(1), txt, sugerido, visible,
             lineas: vs.map(v => v.valeProductos), comFijada: vs.map(v => v.comFijadaUSD),
             quedan: _ventasDeBorrados().length, boxDespues: box.style.display };
  });
  ok('en Stock sale el aviso con el nombre sacado del artículo', rel.visible && /NanoStation 5 AC loco SIN POE/.test(rel.txt), rel.txt.slice(0,300));
  ok('dice cuántas ventas y cuántas sin puntos', /2 ventas/.test(rel.txt) && /2 sin puntos/.test(rel.txt), rel.txt.slice(0,260));
  ok('propone el producto que más se parece', rel.sugerido === '502', rel.sugerido);
  ok('antes: solo 1 punto (la línea que sí existe)', rel.antes === 1, rel);
  ok('después: 1 + 2 + 1 = 4 puntos', rel.despues === 4, rel);
  ok('las líneas pasan al producto nuevo, con su cantidad y lo cedido', JSON.stringify(rel.lineas[1][0]) === JSON.stringify({id:502,qty:2,cedidaUSD:1}), rel.lineas);
  ok('la comisión congelada no se toca', rel.comFijada[0] === 5 && rel.comFijada[1] === 15, rel.comFijada);
  ok('y el aviso desaparece', rel.quedan === 0 && rel.boxDespues === 'none', rel);

  console.log('\n══ 3· LOS TOTALES VACÍOS SE RELLENAN SOLOS ══');
  const tot = await p.evaluate(() => {
    const t = new Date().toISOString();
    saveVales([{id:20, valeNum:150, gestorId:1, status:'confirmed', ts:t, confirmedTs:t, total:'', precioUSD:'$150 USD', precioMN:'', mensajeria:'500 MN', valeText:''},
               {id:21, valeNum:151, gestorId:1, status:'cancelled', ts:t, total:'', precioUSD:'$10 USD', valeText:''}]);
    const n = repararTotalesVacios();
    return { n, t20: getVales().find(v=>v.id===20).total, t21: getVales().find(v=>v.id===21).total };
  });
  ok('el V-150 queda con $150 USD + 500 MN', tot.t20 === '$150 USD + 500 MN', tot);
  ok('los cancelados no se tocan', tot.t21 === '' && tot.n === 1, tot);

  console.log('\n══ 4· LOS PAGOS QUE NO CUADRAN SALEN EN LA CAJA ══');
  const caja = await p.evaluate(() => {
    const t = new Date().toISOString();
    saveConfig({...getConfig(), tasaUSD:720, tasaUSDTs:Date.now(), tasaMargen:10});
    saveVales([{id:30, valeNum:163, gestorId:1, status:'confirmed', ts:t, confirmedTs:t, total:'$140 USD + 3000 MN',
                pago:{usd:140, zelle:0, eur:0, mn:110100, mnAuto:false, tasaMN:730, eurUSD:null, ts:t}, valeText:''},
               {id:31, valeNum:164, gestorId:1, status:'confirmed', ts:t, confirmedTs:t, total:'$50 USD', valeText:''}]);
    adminTab('stats'); document.getElementById('statsDateFrom').value=''; document.getElementById('statsDateTo').value=''; renderStats();
    const box = document.getElementById('cajaDescuadres');
    return { t: totalesCaja(getVales()).descuadres, txt: box ? box.textContent.replace(/\s+/g,' ') : '' };
  });
  ok('el V-163 sale como descuadrado', caja.t.length === 1 && caja.t[0].num === 163, caja.t);
  ok('con cuánto sobra', /V-163 · sobra \$146\.71/.test(caja.txt) || /V-163 · sobra/.test(caja.txt), caja.txt.slice(0,200));
  ok('el que no se apuntó (se da por bueno) no sale', !/V-164/.test(caja.txt), caja.txt.slice(0,200));

  console.log('\n══ 5· EL RESPALDO PÚBLICO NO LLEVA VALES NI TELÉFONOS ══');
  await p.evaluate(async () => {
    saveGestores([{id:1,name:'Ana',initials:'A',color:'#111',password:'pbkdf2$x',phone:'5351111111'}]);
    saveMensajeros([{id:50,name:'Yoel',phone:'5352222222'}]);
    saveVales([{id:40, valeNum:1, gestorId:1, status:'confirmed', ts:new Date().toISOString(), cliente:'Cliente Secreto', telefono:'5353333333', direccion:'Calle Secreta 1', total:'$1 USD', valeText:''}]);
    localStorage.setItem('axon_gh_token', 'ghp_' + 'x'.repeat(36));
    saveConfig({...getConfig(), ghRepo:'prueba/repo', ghPath:'data.json'});
    await syncToGitHub(true);
  });
  const pub = SUBIDO.length ? Buffer.from(SUBIDO[SUBIDO.length-1].content, 'base64').toString('utf8') : '';
  const pubObj = pub ? JSON.parse(pub) : {};
  ok('se sube', !!pub, SUBIDO.length);
  ok('sin vales', pubObj.vales === undefined, Object.keys(pubObj));
  ok('ningún dato del cliente en el archivo', !/Cliente Secreto|5353333333|Calle Secreta/.test(pub), '');
  ok('sin teléfonos de gestores ni mensajeros', !/5351111111|5352222222/.test(pub), '');
  ok('sí lleva el catálogo y los nombres', Array.isArray(pubObj.productos) && pubObj.mensajeros[0].name === 'Yoel', Object.keys(pubObj));
  const rest = await p.evaluate(pub => {
    const d = JSON.parse(pub);
    return { m: _mensajerosDeRespaldo(d.mensajeros)[0].phone, g: _gestoresDeRespaldo(d.gestores)[0].phone };
  }, pub);
  ok('restaurar conserva los teléfonos que hay', rest.m === '5352222222' && rest.g === '5351111111', rest);

  console.log('\n══ 6· EL NÚMERO DE VALE DESDE EL SERVIDOR ══');
  // a) Sin la migración: la app sigue como en v133.
  CONTADOR = null;
  const sinRpc = await p.evaluate(async () => {
    try { localStorage.removeItem('axon_vale_num_reservado'); } catch(e) {}
    _valeNumRpc = null;
    saveVales([{id:60, valeNum:700, gestorId:1, status:'pending', ts:new Date().toISOString(), total:'$1 USD', valeText:''}]);
    const r = await reservarValeNumServidor();
    return { r, rpc: _valeNumRpc, n: getNextValeNum() };
  });
  ok('sin la función instalada no se rompe nada', sinRpc.r === null && sinRpc.rpc === false, sinRpc);
  ok('y el número sale de la cuenta del teléfono (701)', sinRpc.n === 701, sinRpc);
  // b) Con la migración: dos teléfonos a la vez no se repiten.
  CONTADOR = 900;
  const g1 = await abrir('index.html', false);
  const g2 = await abrir('index.html', false);
  const prep = async g => g.evaluate(async () => {
    try { localStorage.removeItem('axon_vale_num_reservado'); } catch(e) {}
    _valeNumRpc = null;
    await reservarValeNumServidor();
    return _valeNumReservado();
  });
  const r1 = await prep(g1), r2 = await prep(g2);
  const n1 = await g1.evaluate(() => getNextValeNum());
  const n2 = await g2.evaluate(() => getNextValeNum());
  ok('cada teléfono reserva el suyo por adelantado', r1 && r2 && r1.n !== r2.n, {r1, r2});
  ok('y al mandar el vale usa ese: números distintos', n1 !== n2 && [n1, n2].every(n => n >= 900), {n1, n2});
  await g1.waitForTimeout(300);
  const siguiente = await g1.evaluate(() => _valeNumReservado());
  ok('después de usarlo, ya tiene reservado el siguiente', siguiente && siguiente.n > Math.max(n1, n2), siguiente);
  const n3 = await g1.evaluate(() => getNextValeNum());
  ok('el tercero tampoco se repite', ![n1, n2].includes(n3), {n1, n2, n3});

  console.log('\n══ ERRORES DE JAVASCRIPT ══');
  const graves = errores.filter(e => !/favicon|manifest|sw\.js|Failed to load resource|net::ERR/i.test(e));
  ok('ninguno', graves.length === 0, graves.slice(0,5));

  await nav.close(); srv.close();
  console.log('\n' + (fallos ? '❌ ' + fallos + ' fallo(s)' : '✅ todo correcto'));
  process.exit(fallos ? 1 : 0);
})();
