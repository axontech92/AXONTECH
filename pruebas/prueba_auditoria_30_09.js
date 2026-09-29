// Auditoría del 30/09: cuatro revisores independientes demostraron fallos con
// escenarios reales. Esta prueba repite los principales para que no vuelvan.
//
//   NODE_PATH=$(npm root -g) node pruebas/prueba_auditoria_30_09.js
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




const META = {};
let POSTS_VALES = 0, FALLAR_VALES = 0, SUBIDAS_CONFIG = [];
function responde(url, metodo, cuerpo) {
  if (url.includes('/rest/v1/meta')) {
    if (metodo === 'POST') {
      let b = []; try { b = JSON.parse(cuerpo || '[]'); } catch(e) {}
      (Array.isArray(b) ? b : [b]).forEach(r => { if (r && r.name) { META[r.name] = r.data; if (r.name === 'config') SUBIDAS_CONFIG.push(r.data); } });
      return { status: 201, body: '[]' };
    }
    const m = /name=eq\.([^&]+)/.exec(url);
    if (m) { const n = decodeURIComponent(m[1]); if (/updated_at=gt/.test(url)) return { status: 200, body: '[]' };
      return { status: 200, body: JSON.stringify(n in META ? [{ name: n, data: META[n], updated_at: '2026-09-30T10:00:00+00:00' }] : []) }; }
  }
  if (url.includes('/rest/v1/vales') && metodo === 'POST') {
    POSTS_VALES++;
    if (FALLAR_VALES > 0) { FALLAR_VALES--; return { status: 503, body: '{"message":"Service Unavailable"}' }; }
    return { status: 201, body: '[]' };
  }
  if (url.includes('/rpc/')) return { status: 404, body: '{}' };
  return { status: 200, body: '[]' };
}
(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const nav = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const errores = [];
  const ctx = await nav.newContext({viewport:{width:1280,height:1400}});
  await ctx.route('**/*', r => {
    const url = r.request().url();
    if (url.includes('127.0.0.1')) return r.continue();
    const x = responde(url, r.request().method(), r.request().postData());
    return r.fulfill({ status: x.status, contentType: 'application/json', body: x.body, headers: {'Access-Control-Allow-Origin':'*'} });
  });
  const p = await ctx.newPage();
  p.on('pageerror', e => errores.push(String(e).slice(0,200)));
  await p.goto(base + '/admin.html', {waitUntil:'domcontentloaded'});
  await p.waitForTimeout(2400);
  await p.fill('#passInput','axon2024'); await p.click('button:has-text("Entrar")'); await p.waitForTimeout(1200);
  await p.evaluate(() => { try { clearInterval(_restPollTimer); } catch(e) {} });
  const colaVacia = () => p.waitForFunction(() => !_sbProcessing && !_sbWriteQueue.length, null, { timeout: 60000 }).catch(() => {});

  console.log('══ 1· DINERO ══');
  const d = await p.evaluate(() => {
    const t = new Date().toISOString(), r = {};
    saveGestores([{ id: 1, name: 'Ana', initials: 'AN', color: '#123' }, { id: 2, name: 'Beto', initials: 'BE', color: '#456' }]);
    saveProductos([{ id: 1, name: 'Router', stock: 50, precio: '$100 USD', comision: '$10', puntos: 3 }]);
    saveVales([]);
    const _v = _crearVentaDirecta(1, 3, '$270 USD', '');
    r.directa = _ventaVale(_v).usd; r.directaCom = getValeCommissionParts(_v).totalUSD || 0;
    // Cesión en MN con comisión en USD: se descuenta a la tasa, con tope.
    const tasa = tasaUSDFinal();
    const v2 = { id: 5, gestorId: 1, status: 'pending', ts: t, total: '$100 USD', valeProductos: [{ id: 1, qty: 1 }], comFijadaUSD: 10, comisionCedida: tasa * 4, comisionCedidaMoneda: 'MN' };
    r.tasa = tasa; r.comTrasCeder = getValeCommissionParts(v2).totalUSD;
    const v3 = { ...v2, comisionCedida: tasa * 50 };   // cede el equivalente a $50 con $10 de comisión
    const rb = _rebajaVale(v3); r.rebajaTopada = rb ? rb.partes.filter(x => x.quien === 'gestor').reduce((s, x) => s + (x.moneda === 'MN' ? x.importe / tasa : x.importe), 0) : 0;
    r.comTopada = getValeCommissionParts(v3).totalUSD;
    // Unión cobrada: no se deshace.
    saveVales([{ id: 10, gestorId: 1, status: 'confirmed', stockDecremented: true, ts: t, confirmedTs: t, total: '$100 USD', valeProductos: [{ id: 1, qty: 1 }] },
               { id: 11, gestorId: 2, status: 'confirmed', stockDecremented: true, ts: t, confirmedTs: t, total: '$100 USD', valeProductos: [{ id: 1, qty: 1 }], unidoA: 10 }]);
    r.desunir = desunirVale(11);
    // Revertir suelta el costo congelado y el pago automático.
    saveVales([{ id: 20, gestorId: 1, status: 'delivered', ts: t, total: '$100 USD', valeProductos: [{ id: 1, qty: 1 }] }]);
    setCosto(1, '60');
    patchVale(20, { status: 'confirmed', confirmedTs: t });
    r.costoAntes = costoFijadoDe(20); r.pagoAntes = !!getVales().find(x => x.id === 20).pago; r.precioLinea = getVales().find(x => x.id === 20).valeProductos[0].precio;
    patchVale(20, { status: 'delivered', confirmedTs: null });
    r.costoDespues = costoFijadoDe(20); r.pagoDespues = getVales().find(x => x.id === 20).pago;
    return r;
  });
  ok('venta directa: vale lo cobrado ($270), sin comisión', d.directa === 270 && d.directaCom === 0, d);
  ok('ceder 4 USD en MN baja la comisión de $10 a $6', Math.abs(d.comTrasCeder - 6) < 0.02, d);
  ok('no se puede ceder más de lo que se gana (tope $10)', Math.abs(d.rebajaTopada - 10) < 0.05 && d.comTopada === 0, d);
  ok('una unión ya cobrada no se deshace', d.desunir === false, d);
  ok('al confirmar se congelan costo, pago y precio de la línea', d.costoAntes === 60 && d.pagoAntes && d.precioLinea === '$100 USD', d);
  ok('al revertir se sueltan costo y pago automático', d.costoDespues === null && !d.pagoDespues, d);

  console.log('\n══ 2· DATOS PREPARADOS (XSS) ══');
  const x = await p.evaluate(() => {
    window.__h = 0;
    saveGestores([{ id: 1, name: 'Ana', initials: "A'><img src=x onerror=__h++>", color: 'red;background:url(x)" onmouseover="__h++', photo: 'javascript:__h++' },
                  { id: '1);__h++;(', name: 'Malo', initials: 'M', color: '#000' }]);
    saveNotifs([{ id: 9, type: 'ranking_top3', gestorId: 1, productName: 'Ana', extra: '<img src=x onerror=__h++>|<b>|Puesto #1', evt: 'ranking_top3:x:0', ts: new Date().toISOString() }]);
    const g = getGestores();
    return { n: g.length, color: g[0].color, ini: g[0].initials, foto: g[0].photo };
  });
  ok('la ficha con id falso se descarta', x.n === 1, x);
  ok('color, iniciales y foto se limpian', x.color === '#64748B' && !/[<>'"]/.test(x.ini) && x.foto === '', x);
  await p.evaluate(() => { adminTab('gestores'); gestoresTabDirty = true; renderAdminGestoresList(); activeGestorId = 1; renderGestorNotifs(); activeGestorId = null; });
  await p.waitForTimeout(500);
  ok('nada se ejecuta', await p.evaluate(() => window.__h) === 0);
  const tel = await p.evaluate(() => { saveConfig({ ...getConfig(), catalogPhone: '53 5555-1234"><script>x</script>' }); const h = buildCatalogHTML() || ''; return /wa\.me\/5355551234\?/.test(h) || !/wa\.me/.test(h); });
  ok('el teléfono del catálogo queda en solo dígitos', tel);

  console.log('\n══ 3· SINCRONIZACIÓN ══');
  await colaVacia();
  META.config = { tasaMargen: 20, metaPuntos: 80, ghRepo: 'a/b' };
  SUBIDAS_CONFIG = [];
  await p.evaluate(async () => {
    // Este equipo tiene una copia vieja y solo cambia la tasa.
    localStorage.setItem('axon_config', JSON.stringify({ tasaMargen: 10, metaPuntos: 50 })); _configDirty = true;
    saveConfig({ ...getConfig(), tasaUSD: 415 });
  });
  await colaVacia();
  ok('la config sube solo lo que cambió (se junta con la de la nube)', SUBIDAS_CONFIG.length === 1 && SUBIDAS_CONFIG[0].tasaUSD === 415 && SUBIDAS_CONFIG[0].tasaMargen === 20, SUBIDAS_CONFIG);
  ok('y no pisa lo que puso otro equipo', META.config.tasaMargen === 20 && META.config.metaPuntos === 80 && META.config.ghRepo === 'a/b' && META.config.tasaUSD === 415, META.config);

  // Primer guardado de la sesión: solo el vale que cambió.
  await p.evaluate(() => {
    const t = new Date().toISOString();
    const muchos = []; for (let i = 0; i < 40; i++) muchos.push({ id: 1000 + i, gestorId: 1, status: 'pending', ts: t, total: '$1 USD', valeProductos: [] });
    localStorage.setItem('axon_vales', JSON.stringify(muchos)); _valesDirty = true; _valesPrevSlimJson.clear(); _resembrarSlim = true;
  });
  POSTS_VALES = 0;
  const q = await p.evaluate(() => { patchVale(1005, { adminNotes: 'hola' }); return _sbWriteQueue.filter(x => x.path === 'vales').map(x => Object.keys(x.value || {}).length); });
  ok('el primer guardado de la sesión sube 1 vale, no 40', JSON.stringify(q) === '[1]' || (q.length === 0 && POSTS_VALES <= 1), q);
  await colaVacia();

  // Un corte largo (503 seguidos) ya no tira el cambio.
  FALLAR_VALES = 6; POSTS_VALES = 0;
  await p.evaluate(() => patchVale(1006, { adminNotes: 'tras el corte' }));
  await p.waitForFunction(() => !_sbWriteQueue.length && !_sbProcessing, null, { timeout: 200000 }).catch(() => {});
  ok('tras 6 fallos seguidos el cambio llega igual', FALLAR_VALES === 0 && POSTS_VALES >= 7, { POSTS_VALES, FALLAR_VALES });

  // Avisos: se juntan con los de la nube.
  META.notifs = [{ id: 111, type: 'product_changed', productName: 'Del admin', ts: '2026-09-30T09:00:00Z' }];
  await p.evaluate(() => { localStorage.setItem('axon_notifs', '[]'); _notifsDirty = true; addNotif('new_product', 'Mío', 5, ''); });
  await colaVacia();
  const ids = (META.notifs || []).map(n => n.productName);
  ok('subir mis avisos no borra el del otro', ids.includes('Del admin') && ids.includes('Mío'), ids);

  console.log('\n══ 4· NÚMERO DE VALE ══');
  const num = await p.evaluate(() => {
    localStorage.setItem(_VALE_NUM_HW_KEY, '11');
    localStorage.setItem(_VALE_NUM_RESERVA_KEY, JSON.stringify({ n: 11, ts: Date.now() }));   // llegó tarde: ya se usó aquí
    return getNextValeNum();
  });
  ok('una reserva que ya se usó aquí no se repite', num === 12, num);

  console.log('\n══ ERRORES DE JAVASCRIPT ══');
  ok('ninguno', !errores.length, errores);
  console.log(fallos ? `\n❌ ${fallos} fallo(s)` : '\n✅ todo correcto');
  await nav.close(); srv.close(); process.exit(fallos ? 1 : 0);
})();
