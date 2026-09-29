// Pedido el 29/09: "al subir un producto o reponer, que pregunte si desea
// notificar a los gestores; si dice que no, no deben ser notificados". Pasa
// cuando el producto ya está en físico (y hasta reservado) pero faltaba en la
// página y solo se está completando.
//
//   NODE_PATH=$(npm root -g) node pruebas/prueba_avisar_o_no.js
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
  const errores = [];
  const ctx = await nav.newContext({viewport:{width:1280,height:1400}});
  await ctx.route('**/*', r => {
    const url = r.request().url();
    if (url.includes('127.0.0.1')) return r.continue();
    return r.fulfill({ status: 200, contentType: 'application/json', body: '[]', headers: {'Access-Control-Allow-Origin':'*'} });
  });
  const p = await ctx.newPage();
  p.on('pageerror', e => errores.push(String(e).slice(0,200)));
  await p.goto(base + '/admin.html', {waitUntil:'domcontentloaded'});
  await p.waitForTimeout(2400);
  await p.fill('#passInput','axon2024'); await p.click('button:has-text("Entrar")'); await p.waitForTimeout(900);
  await p.evaluate(() => { try { clearInterval(_restPollTimer); } catch(e) {} saveProductos([]); saveNotifs([]); });
  const avisos = () => p.evaluate(() => getNotifs().map(n => n.type + ':' + n.productName));
  const pregunta = async () => { try { await p.waitForSelector('#avisoGestoresModal.show', { timeout: 2000 }); return true; } catch(e) { return false; } };
  const contesta = async (si) => { await p.click('#avisoGestoresModal [data-r="' + (si ? 1 : 0) + '"]'); await p.waitForTimeout(400); };

  console.log('══ 1· PRODUCTO NUEVO: PREGUNTA, Y "NO" NO AVISA ══');
  await p.evaluate(() => openAddProductModal());
  await p.fill('#pm-name', 'Antena reservada'); await p.fill('#pm-stock', '3');
  await p.evaluate(() => { saveProduct(); });
  ok('pregunta si avisar', await pregunta());
  await contesta(false);
  const a1 = await p.evaluate(() => { const x = getProductos().find(q => q.name === 'Antena reservada'); return { hay: !!x, stock: x && x.stock, nuevo: _esProductoNuevo(x), sil: x && x.silencioso }; });
  ok('el producto se guarda', a1.hay && a1.stock === 3, a1);
  ok('sin aviso a los gestores', !(await avisos()).length, await avisos());
  ok('y sin la chapa 💎 NUEVO', a1.nuevo === false && a1.sil === true, a1);

  console.log('\n══ 2· PRODUCTO NUEVO CON "SÍ" ══');
  await p.evaluate(() => openAddProductModal());
  await p.fill('#pm-name', 'Router nuevo'); await p.fill('#pm-stock', '5');
  await p.evaluate(() => { saveProduct(); });
  ok('pregunta', await pregunta());
  await contesta(true);
  const a2 = await p.evaluate(() => { const x = getProductos().find(q => q.name === 'Router nuevo'); return { nuevo: _esProductoNuevo(x) }; });
  ok('avisa "Nuevo producto"', (await avisos()).includes('new_product:Router nuevo'), await avisos());
  ok('y lleva la chapa 💎 NUEVO', a2.nuevo, a2);

  console.log('\n══ 3· REPONER UN AGOTADO ══');
  const id = await p.evaluate(() => { saveNotifs([]); const x = getProductos().find(q => q.name === 'Antena reservada'); patchProducto(x.id, { stock: 0 }); return x.id; });
  await p.evaluate(id => { openStockModal(id); document.getElementById('stockModalInput').value = '4'; guardarStockModal(); }, id);
  ok('pregunta al reponer desde 0', await pregunta());
  await contesta(false);
  const a3 = await p.evaluate(id => ({ stock: productoOf(id).stock, abierto: document.getElementById('stockModal').classList.contains('show') }), id);
  ok('el stock queda en 4', a3.stock === 4 && !a3.abierto, a3);
  ok('sin aviso de "Repuesto"', !(await avisos()).length, await avisos());
  await p.evaluate(id => { openStockModal(id); document.getElementById('stockModalInput').value = '9'; guardarStockModal(); }, id);
  ok('de 4 a 9 no pregunta (no hay aviso que dar)', !(await pregunta()));
  ok('y queda en 9', (await p.evaluate(id => productoOf(id).stock, id)) === 9);
  await p.evaluate(id => { patchProducto(id, { stock: 0 }); saveNotifs([]); openStockModal(id); document.getElementById('stockModalInput').value = '2'; guardarStockModal(); }, id);
  ok('reponer otra vez: pregunta', await pregunta());
  await contesta(true);
  ok('con "Sí" avisa "Repuesto"', (await avisos()).includes('restocked:Antena reservada'), await avisos());

  console.log('\n══ 4· EDITAR UN AGOTADO Y PONERLE STOCK ══');
  await p.evaluate(id => { patchProducto(id, { stock: 0 }); saveNotifs([]); openEditProductModal(id); }, id);
  await p.fill('#pm-stock', '6'); await p.fill('#pm-precio', '$70 USD');
  await p.evaluate(() => { saveProduct(); });
  ok('pregunta', await pregunta());
  await contesta(false);
  const a4 = await p.evaluate(id => ({ stock: productoOf(id).stock, precio: productoOf(id).precio }), id);
  ok('se guarda stock y precio', a4.stock === 6 && a4.precio === '$70 USD', a4);
  ok('sin ningún aviso (ni repuesto ni cambio de precio)', !(await avisos()).length, await avisos());
  await p.evaluate(id => { saveNotifs([]); openEditProductModal(id); }, id);
  await p.fill('#pm-precio', '$75 USD');
  await p.evaluate(() => { saveProduct(); });
  ok('editar sin reponer no pregunta', !(await pregunta()));
  await p.waitForTimeout(300);
  ok('y el cambio de precio avisa como siempre', (await avisos()).some(a => a.startsWith('product_changed')), await avisos());

  console.log('\n══ ERRORES DE JAVASCRIPT ══');
  ok('ninguno', !errores.length, errores);
  console.log(fallos ? `\n❌ ${fallos} fallo(s)` : '\n✅ todo correcto');
  await nav.close(); srv.close(); process.exit(fallos ? 1 : 0);
})();
