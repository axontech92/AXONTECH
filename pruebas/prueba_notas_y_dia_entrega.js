// Pedido el 27/09: en el formulario del gestor, notas para el admin y el DÍA
// de entrega (no solo la hora), y que el admin vea las dos cosas.
// De paso cubre un fallo que había: el admin subía el vale sin la hora de
// entrega (y su upsert reemplaza la fila entera), así que en cuanto tocaba un
// vale la hora se borraba de la nube y luego de los teléfonos.
//
//   NODE_PATH=$(npm root -g) node pruebas/prueba_notas_y_dia_entrega.js
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

  const PRODS = [{id:970, name:'Tablet', stock:5, precio:'$150 USD', comision:'$5 USD', puntos:1}];
  const ymd = d => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  const dentroDe2 = new Date(Date.now() + 2*864e5);
  const FECHA = ymd(dentroDe2);

  console.log('══ 1 · EL ADMIN PREPARA EL CATÁLOGO ══');
  const A = await abrir('admin.html','admin');
  await A.fill('#passInput','axon2024');
  await A.click('button:has-text("Entrar")');
  await A.waitForTimeout(2300);
  await A.evaluate(P => {
    saveProductos(P); saveCategorias([]); saveVales([]); saveNotifs([]);
    saveGestores([{id:1,name:'Ana',initials:'A',color:'#2563EB'}]);
    saveMensajeros([{id:50,name:'Yoel'}]);
  }, PRODS);
  await A.waitForTimeout(3000);

  console.log('\n══ 2 · EL GESTOR MANDA UN VALE CON DÍA, HORA Y NOTA ══');
  const G = await abrir('index.html','gestor');
  await G.waitForTimeout(8000);
  const campos = await G.evaluate(() => ({
    fecha: !!document.getElementById('vf-fechaEntrega'),
    hora: !!document.getElementById('vf-horaEntrega'),
    notas: !!document.getElementById('vf-notasGestor'),
  }));
  ok('el formulario tiene el día', campos.fecha, campos);
  ok('la hora', campos.hora, campos);
  ok('y las notas para el admin', campos.notas, campos);
  const enviado = await G.evaluate(F => {
    doSelectGestor(1);
    currentValeProductos = [{id:970, name:'Tablet', qty:1}];
    const set = (i,v) => { const e=document.getElementById(i); if(e) e.value=v; };
    set('vf-cliente','Rosa Díaz'); set('vf-telefono','55552222');
    set('vf-direccion','Calle 5'); set('vf-articulo','×1 Tablet'); set('vf-total','$150 USD');
    set('vf-fechaEntrega', F); set('vf-horaEntrega','15:30');
    set('vf-notasGestor','Llamar antes de ir · paga la mamá');
    onFormInput();
    const texto = (typeof buildValeText === 'function') ? buildValeText() : '';
    sendVale();
    const v = getVales()[getVales().length-1];
    return { v, texto };
  }, FECHA);
  ok('el vale lleva el día', enviado.v.fechaEntrega === FECHA, enviado.v.fechaEntrega);
  ok('la hora', enviado.v.horaEntrega === '15:30', enviado.v.horaEntrega);
  ok('y la nota', enviado.v.notasGestor === 'Llamar antes de ir · paga la mamá', enviado.v.notasGestor);
  ok('el WhatsApp dice la fecha exacta, no "pasado mañana"',
     /Entrega: .*\d{2}\/\d{2} · 15:30/.test(enviado.texto) && !/mañana|hoy/.test((enviado.texto.match(/Entrega:.*/)||[''])[0]),
     (enviado.texto.match(/Entrega:.*/)||['(no sale)'])[0]);
  ok('y NO lleva la nota (es solo para el admin)', !/paga la mamá/.test(enviado.texto), '');
  const formLimpio = await G.evaluate(() => { resetForm(); return {
    f: document.getElementById('vf-fechaEntrega').value, n: document.getElementById('vf-notasGestor').value }; });
  ok('al limpiar el formulario se borran también', formLimpio.f === '' && formLimpio.n === '', formLimpio);

  const esperar = async (pg, cond, ms) => { const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await cond()) return true; await pg.waitForTimeout(1000); } return false; };
  const enNube = () => Object.values(NUBE.tablas.vales||{}).map(r => r.data).find(d => d && d.cliente === 'Rosa Díaz');
  await esperar(G, async () => !!enNube(), 30000);
  ok('sube a la nube con día, hora y nota',
     enNube() && enNube().fechaEntrega === FECHA && enNube().horaEntrega === '15:30' && /mamá/.test(enNube().notasGestor || ''),
     enNube());

  console.log('\n══ 3 · EL ADMIN LO VE ══');
  await esperar(A, async () => await A.evaluate(() => !!getVales().find(x => x.cliente === 'Rosa Díaz')), 30000);
  const vista = await A.evaluate(() => {
    const v = getVales().find(x => x.cliente === 'Rosa Díaz');
    adminTab('vales');
    try { renderAdminGestores(); } catch(e) {}
    try { toggleAdminGestor && toggleAdminGestor(1); } catch(e) {}
    selectVale(v.id);
    const det = document.getElementById('valeDetail') || document.body;
    try { renderProximasEntregas(); } catch(e) {}
    return { id: v.id,
      detalle: det.textContent.replace(/\s+/g,' '),
      notaBloque: !!document.getElementById('valeNotasGestor'),
      proximas: (document.getElementById('proximasEntregas')||{}).textContent || '',
      // v139: la nota va en el 📝 (se lee al pasar por encima), no en una línea aparte.
      notaProx: ((document.querySelector('#proximasEntregas span[title]')||{}).title) || '',
      chip: _chipHoraEntrega(v), texto: _textoEntrega(v) };
  });
  ok('en el detalle sale la nota del gestor', vista.notaBloque && /paga la mamá/.test(vista.detalle), vista.detalle.slice(0,300));
  ok('y la entrega con el día y la hora', /Entrega/.test(vista.detalle) && /15:30/.test(vista.detalle) && /\d{2}\/\d{2}/.test(vista.texto), vista.texto);
  ok('la chapa del vale lleva el día', /\d{2}\/\d{2}/.test(vista.chip) && /15:30/.test(vista.chip), vista.chip);
  ok('y sale en próximas entregas, con la nota (en el 📝)', /Rosa/.test(vista.proximas) && /en 2 d|en 1 d|en 3 d/.test(vista.proximas) && /📝/.test(vista.proximas) && /mamá/.test(vista.notaProx), vista);

  console.log('\n══ 4 · EL FALLO VIEJO: TOCAR EL VALE NO BORRA LA HORA DE LA NUBE ══');
  // Abrir el vale lo marca como visto → el admin lo sube. Se asigna además un
  // mensajero, que es otra escritura del admin.
  await A.evaluate(id => { patchVale(id, {status:'assigned', mensajeroId:50}); }, vista.id);
  await A.waitForTimeout(4000);
  ok('después de que el admin lo sube, la nube sigue teniendo la hora',
     enNube() && enNube().horaEntrega === '15:30', enNube() && enNube().horaEntrega);
  ok('el día', enNube() && enNube().fechaEntrega === FECHA, enNube() && enNube().fechaEntrega);
  ok('y la nota', enNube() && /mamá/.test(enNube().notasGestor || ''), enNube() && enNube().notasGestor);
  ok('y el cambio del admin llegó', enNube() && enNube().status === 'assigned', enNube() && enNube().status);

  console.log('\n══ 5 · EL ADMIN LO CORRIGE DESDE "EDITAR VALE" ══');
  const editado = await A.evaluate(id => {
    openEditValeModal(id);
    const cargado = { f: document.getElementById('ev-fechaEntrega').value, h: document.getElementById('ev-horaEntrega').value,
                      n: document.getElementById('ev-notasGestor').value };
    document.getElementById('ev-horaEntrega').value = '';
    document.getElementById('ev-notasGestor').value = 'Ya avisado';
    saveEditVale();
    const v = getVales().find(x=>x.id===id);
    return { cargado, v: { f:v.fechaEntrega, h:v.horaEntrega, n:v.notasGestor }, texto:_textoEntrega(v), sinHora:_entregaSinHora(v) };
  }, vista.id);
  ok('el modal carga día, hora y nota', editado.cargado.f === FECHA && editado.cargado.h === '15:30' && /mamá/.test(editado.cargado.n), editado.cargado);
  ok('guarda los cambios', editado.v.h === '' && editado.v.n === 'Ya avisado' && editado.v.f === FECHA, editado.v);
  ok('solo con día: "(sin hora)"', editado.sinHora && /sin hora/.test(editado.texto), editado.texto);

  console.log('\n══ 6 · LAS CUENTAS DEL DÍA SIN HORA ══');
  const dias = await A.evaluate(() => {
    const hoy = new Date(); const ymd = d => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    const ayer = new Date(Date.now()-864e5);
    const vHoy = {status:'pending', fechaEntrega: ymd(hoy), ts:new Date().toISOString()};
    const vAyer = {status:'pending', fechaEntrega: ymd(ayer), ts:new Date().toISOString()};
    const vSoloHora = {status:'pending', horaEntrega:'10:00', ts:new Date().toISOString()};
    const vNada = {status:'pending', ts:new Date().toISOString()};
    return { hoyTexto:_textoEntrega(vHoy), hoyTarde:_finEntrega(vHoy) < Date.now(),
             ayerTarde:_finEntrega(vAyer) < Date.now(), ayerChip:_chipHoraEntrega(vAyer),
             soloHora:_textoEntrega(vSoloHora), soloHoraAbs:_textoEntrega(vSoloHora, true), nada:_momentoEntrega(vNada) };
  });
  ok('solo con día de hoy: "hoy (sin hora)"', dias.hoyTexto === 'hoy (sin hora)', dias.hoyTexto);
  ok('y no está tarde hasta que acabe el día', !dias.hoyTarde, dias);
  ok('el de ayer sí sale tarde (rojo)', dias.ayerTarde && /dc2626/.test(dias.ayerChip), dias);
  ok('los vales de antes (solo hora) siguen igual', /^hoy · 10:00$|^mañana · 10:00$/.test(dias.soloHora) && dias.soloHoraAbs === '10:00', dias);
  ok('sin día ni hora no hay entrega', dias.nada === null, dias.nada);

  console.log('\n══ 7 · EL GESTOR SIGUE VIENDO SU VALE ENTERO ══');
  await G.waitForTimeout(62000);   // pasar la ventana de 60 s del teléfono del gestor
  await G.evaluate(() => { try { _doRestPoll(); } catch(e) {} });
  await G.waitForTimeout(6000);
  const enG = await G.evaluate(() => { const v = getVales().find(x => x.cliente === 'Rosa Díaz'); return v && {f:v.fechaEntrega, n:v.notasGestor, s:v.status}; });
  ok('le llega lo que corrigió el admin, sin perder el día', enG && enG.f === FECHA && enG.n === 'Ya avisado' && enG.s === 'assigned', enG);

  console.log('\n══ 8 · ESTÁ EN LA AYUDA ══');
  const ayuda = await A.evaluate(() => { adminTab('ayuda'); document.getElementById('ayudaBuscador').value = 'entrega'; renderAyuda();
    return (document.getElementById('ayudaContenido')||{}).textContent || ''; });
  ok('explica el día y la hora', /Día y hora de entrega/.test(ayuda), ayuda.slice(0,150));
  ok('y las notas del gestor', /Notas del gestor para el admin/.test(ayuda), '');

  console.log('\n══ ERRORES DE JAVASCRIPT ══');
  const graves = errores.filter(e => !/favicon|manifest|sw\.js|Failed to load resource|net::ERR/i.test(e));
  ok('ninguno', graves.length === 0, graves.slice(0,8));

  await nav.close(); srv.close();
  console.log('\n' + (fallos ? '❌ ' + fallos + ' fallo(s)' : '✅ todo correcto'));
  process.exit(fallos ? 1 : 0);
})();
