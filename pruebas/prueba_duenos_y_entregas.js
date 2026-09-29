// Reportado el 29/09:
//   · "se le pone el dueño a un producto y lo pierde a cada rato"
//   · "Próximas entregas se ve regado con todas esas notas y tira los vales abajo"
//   · "el historial del ranking debes ponerlo arriba en el encabezado"
// Y dos fallos encontrados de paso (una variable `const` que se reescribía):
//   · la config de la nube no se aplicaba en ningún teléfono desde v133
//   · el catálogo público no se generaba si había categorías
//
//   NODE_PATH=$(npm root -g) node pruebas/prueba_duenos_y_entregas.js
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
let TS = 1;
function responde(url, metodo, cuerpo) {
  if (url.includes('/rest/v1/meta')) {
    if (metodo === 'POST') {
      let b = []; try { b = JSON.parse(cuerpo || '[]'); } catch(e) {}
      (Array.isArray(b) ? b : [b]).forEach(r => { if (r && r.name) META[r.name] = { data: r.data, ts: '2026-09-29T10:00:' + String(TS++).padStart(2, '0') + '+00:00' }; });
      return { status: 201, body: '[]' };
    }
    const m = /name=eq\.([^&]+)/.exec(url);
    if (m) { const n = decodeURIComponent(m[1]);
      if (/updated_at=gt/.test(url)) return { status: 200, body: '[]' };
      return { status: 200, body: JSON.stringify(n in META ? [{ name: n, data: META[n].data, updated_at: META[n].ts }] : []) }; }
  }
  if (url.includes('/rpc/')) return { status: 404, body: '{}' };
  return { status: 200, body: '[]' };
}
(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const nav = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const errores = [];
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
    if (admin) { await pg.fill('#passInput','axon2024'); await pg.click('button:has-text("Entrar")'); await pg.waitForTimeout(1200); }
    await pg.evaluate(() => { try { clearInterval(_restPollTimer); } catch(e) {} });
    return pg;
  };
  const colaVacia = pg => pg.waitForFunction(() => !_sbProcessing && !_sbWriteQueue.length, null, { timeout: 15000 }).catch(() => {});

  const p = await abrir('admin.html', true);

  console.log('══ 1· EDITAR UN PRODUCTO YA NO LE QUITA EL DUEÑO ══');
  const ed = await p.evaluate(async () => {
    saveProductos([{ id: 501, name: 'Antena', stock: 5, precio: '$50 USD', puntos: 1 }]);
    localStorage.setItem('axon_duenos', JSON.stringify({ lista: [{ id: 1, nombre: 'Pedro' }], asig: { '501': 1 } }));
    localStorage.removeItem('axon_duenos_cambios');
    _duenosDirty = true;
    // Primera vez que se abre el modal en esta sesión: el desplegable está vacío.
    document.getElementById('pm-dueno').innerHTML = '';
    openEditProductModal(501);
    const enModal = document.getElementById('pm-dueno').value;
    document.getElementById('pm-precio').value = '$55 USD';
    await saveProduct();
    return { enModal, dueno: duenoIdDe(501), precio: productoOf(501).precio };
  });
  ok('el desplegable muestra a Pedro', ed.enModal === '1', ed);
  ok('cambiar el precio no le quita el dueño', ed.dueno === 1 && ed.precio === '$55 USD', ed);

  console.log('\n══ 2· DOS EQUIPOS PONIENDO DUEÑOS: NO SE PISAN ══');
  await colaVacia(p);
  // En la nube, otro equipo ya le puso dueño al 502; este equipo no lo sabe todavía.
  META.duenos = { data: { lista: [{ id: 1, nombre: 'Pedro' }, { id: 2, nombre: 'Rosa' }], asig: { '501': 1, '502': 2 } }, ts: '2026-09-29T09:00:00+00:00' };
  await p.evaluate(() => {
    saveProductos([{ id: 501, name: 'Antena', stock: 5 }, { id: 502, name: 'Router', stock: 5 }, { id: 503, name: 'Cable', stock: 5 }]);
    localStorage.setItem('axon_duenos', JSON.stringify({ lista: [{ id: 1, nombre: 'Pedro' }], asig: { '501': 1 } }));
    localStorage.removeItem('axon_duenos_cambios'); _duenosDirty = true;
    setDuenoProducto(503, 1);   // este equipo asigna el 503 a Pedro
  });
  await colaVacia(p);
  const nube = META.duenos.data;
  ok('en la nube quedan los dos cambios: 502→Rosa (del otro) y 503→Pedro (de este)',
     String(nube.asig['502']) === '2' && String(nube.asig['503']) === '1' && String(nube.asig['501']) === '1', nube);
  const local = await p.evaluate(() => ({ d502: duenoIdDe(502), rosa: !!duenoPorId(2), pend: localStorage.getItem('axon_duenos_cambios') }));
  ok('y este equipo se pone al día (ve a Rosa y el 502)', local.d502 === 2 && local.rosa, local);
  ok('sin cambios pendientes', !/"503"/.test(local.pend || ''), local.pend);

  console.log('\n══ 3· LA CONFIG DE LA NUBE SE APLICA (rota desde v133) ══');
  META.config = { data: { ...(await p.evaluate(() => getConfig())), nextValeNum: 5, pruebaNube: 'llegó' }, ts: '2026-09-29T11:00:00+00:00' };
  const cfg = await p.evaluate(async () => {
    _ultimaTsVisto['meta:config'] = undefined; _ultimoPollLento = 0;
    window.__axonValesError = null;
    await _doRestPoll();
    return getConfig().pruebaNube;
  });
  ok('llega el cambio de config', cfg === 'llegó', cfg);

  console.log('\n══ 4· PRÓXIMAS ENTREGAS, COMPACTA ══');
  const ent = await p.evaluate(() => {
    const hoy = localDay(new Date()), manana = localDay(new Date(Date.now() + 86400000)), ayer = localDay(new Date(Date.now() - 86400000));
    const t = new Date().toISOString();
    const V = (id, fecha, hora, nota) => ({ id, valeNum: id, gestorId: 1, status: 'assigned', ts: t, cliente: 'Cliente ' + id, articulo: 'Cosa ' + id,
      fechaEntrega: fecha, horaEntrega: hora || '', notasGestor: nota || '' });
    saveGestores([{ id: 1, name: 'Ana', initials: 'AN', color: '#123' }]);
    saveVales([V(1, ayer, '', 'Llamar antes'), V(2, hoy, '23:58', 'Recogida en la tienda, rebaja 5 de mi comisión, total a pagar 1490'),
               V(3, manana, '10:00'), V(4, manana, '11:00'), V(5, manana, '12:00'), V(6, manana, '13:00')]);
    localStorage.removeItem('axon_proximas_plegada'); _proximasTodas = false;
    renderProximasEntregas();
    const cont = document.getElementById('proximasEntregas');
    const filas = () => cont.querySelectorAll('div[onclick^="selectVale"]').length;
    const r = { filas: filas(), cab: document.getElementById('proximasEntregasCab').textContent,
                notaEnTexto: /Recogida en la tienda/.test(cont.textContent), notaIcono: !!cont.querySelector('span[title*="Recogida en la tienda"]'),
                alto: Math.max(...[...cont.querySelectorAll('div[onclick^="selectVale"]')].map(d => d.getBoundingClientRect().height)),
                verMas: /Ver 2 más/.test(cont.textContent) };
    _proximasTodas = true; renderProximasEntregas(); r.todas = filas();
    toggleProximasEntregas(); r.plegada = filas(); r.cabPlegada = document.getElementById('proximasEntregasCab').textContent;
    toggleProximasEntregas(); _proximasTodas = false; renderProximasEntregas();
    return r;
  });
  ok('se ven la atrasada + las 3 más cercanas', ent.filas === 4, ent);
  ok('y un "Ver 2 más"', ent.verMas && ent.todas === 6, ent);
  ok('la cabecera resume: 6 · 1 tarde · 1 hoy', /· 6/.test(ent.cab) && /1 tarde/.test(ent.cab) && /1 hoy/.test(ent.cab), ent.cab);
  ok('la nota no ocupa una línea: va en 📝 (se lee al pasar por encima)', !ent.notaEnTexto && ent.notaIcono, ent);
  ok('cada entrega ocupa una sola línea', ent.alto < 32, ent.alto);
  ok('plegada no enseña ninguna', ent.plegada === 0 && /▸/.test(ent.cabPlegada), ent);

  console.log('\n══ 5· EL HISTORIAL DE GANADORES VA ARRIBA ══');
  const g = await abrir('index.html', false);
  const top = await g.evaluate(() => {
    saveGestores([{ id: 1, name: 'Rafael', initials: 'RA', color: '#123' }, { id: 2, name: 'Sanjoni', initials: 'SA', color: '#456' }]);
    saveConfig({ ...getConfig(), metaModo: 'mensual', cicloInicio: '2025-01-15',
      ganadoresMensuales: [{ mes: '2026-08-29', hasta: '2026-09-28', gestorId: 1, nombre: 'Rafael', pts: 458, ranking: [{ id: 1, name: 'Rafael', pts: 458 }, { id: 2, name: 'Sanjoni', pts: 171 }] }] });
    rankingCache = null; renderGestorRanking();
    const c = document.getElementById('rankingList');
    const h = c.querySelector('#histGanadores'), fila = c.querySelector('.rank-row');
    return { hay: !!h, arriba: !!(h && fila && (h.compareDocumentPosition(fila) & Node.DOCUMENT_POSITION_FOLLOWING)),
             resumen: h ? h.querySelector('summary').textContent : '' };
  });
  ok('está antes de la lista de gestores', top.hay && top.arriba, top);
  ok('y dice quién ganó el último', /último: Rafael 458 pts/.test(top.resumen), top.resumen);

  console.log('\n══ 6· EL CATÁLOGO PÚBLICO SE GENERA CON CATEGORÍAS ══');
  const cat = await p.evaluate(() => {
    saveCategorias([{ id: 1, name: 'Redes' }]);
    saveProductos([{ id: 501, name: 'Antena', stock: 5, precio: '$50 USD', categoria: 'Redes' }]);
    try { const h = buildCatalogHTML(); return { ok: !!h && /Antena/.test(h) }; } catch(e) { return { error: String(e) }; }
  });
  ok('sin error y con el producto', cat.ok, cat);

  console.log('\n══ ERRORES DE JAVASCRIPT ══');
  ok('ninguno', !errores.length, errores);
  console.log(fallos ? `\n❌ ${fallos} fallo(s)` : '\n✅ todo correcto');
  await nav.close(); srv.close(); process.exit(fallos ? 1 : 0);
})();
