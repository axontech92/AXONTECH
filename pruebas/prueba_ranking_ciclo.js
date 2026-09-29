// Reportado el 29/09, al cerrar el ciclo:
//   · "Marcó que Julio quedó 2.º, cosa que no es cierta" (el aviso decía
//     Rafael 446 · Julio 31 · Karla 5.5; el ranking era Rafael 381.5 ·
//     Sanjoni 171 · Kevin 101).
//   · "Al empezar, en vez de poner el orden de los que ganaron pone otro orden."
//   · "Debería haber un historial desplegable con los ganadores de cada mes."
//   · "En comisiones debería salir el monto, no la cantidad" (✉️ 37).
//
//   NODE_PATH=$(npm root -g) node pruebas/prueba_ranking_ciclo.js
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

// El escenario, escrito dentro de la página para que las fechas salgan de la
// propia app: el ciclo anterior al de hoy, sea cuando sea que se pase la prueba.
const ESCENARIO = () => {
  saveConfig({ ...getConfig(), metaModo: 'mensual', cicloInicio: '2025-01-15', ganadoresMensuales: [] });
  const ini = _inicioDelCiclo(), prev = _cicloAnterior(ini);
  const dia = prev.from + 'T15:00:00.000Z';
  const G = (id, name) => ({ id, name, initials: name.slice(0,2).toUpperCase(), color:'#123', password:'pbkdf2$x' });
  // En el orden en que se crearon: el mismo que se vio el día 29 con todos a 0.
  saveGestores([G(1,'Rafael'), G(4,'Brianna'), G(2,'Sanjoni'), G(3,'Kevin'), G(7,'Betty'), G(5,'Julio'), G(6,'Karla')]);
  // Kevin tiene 12 puntos puestos a mano con fecha dentro del ciclo.
  const gs = getGestores(); gs.find(g => g.id === 3).puntosAjuste = 12; gs.find(g => g.id === 3).puntosAjusteDia = prev.from;
  saveGestores(gs);
  saveProductos([{ id: 1, name: 'Router', stock: 50, precio: '$50 USD', puntos: 10, comision: '$5' },
                 { id: 2, name: 'Cable',  stock: 50, precio: '$5 USD',  puntos: 0 }]);
  const V = (id, gid, qty, extra) => ({ id, valeNum: id, gestorId: gid, status: 'confirmed', ts: dia, confirmedTs: dia,
    total: '$50 USD', valeProductos: [{ id: 1, qty }], articulo: 'Router', valeText: '', ...(extra || {}) });
  saveVales([
    V(10, 1, 3),                          // Rafael 30
    V(11, 1, 4), V(12, 5, 4, { unidoA: 11 }),   // unidos: 40 + 40 → 20 cada uno para Rafael y Julio
    V(20, 2, 4), V(21, 2, 0.5),                 // Sanjoni 45
    V(30, 3, 3),                          // Kevin 30 + 12 a mano = 42
    V(40, 4, 1),                          // Brianna 10
  ]);
  saveConfig({ ...getConfig(), metaModo: 'mensual', cicloInicio: '2025-01-15', cicloActual: prev.from, ganadoresMensuales: [] });
  saveNotifs([]);
  return { ini, prev };
};

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
      return r.fulfill({ status: 200, contentType: 'application/json', body: '[]', headers: {'Access-Control-Allow-Origin':'*'} });
    });
    const pg = await ctx.newPage();
    pg.on('pageerror', e => errores.push(String(e).slice(0,200)));
    await pg.goto(base + '/' + pagina, {waitUntil:'domcontentloaded'});
    await pg.waitForTimeout(2400);
    if (admin) { await pg.fill('#passInput','axon2024'); await pg.click('button:has-text("Entrar")'); await pg.waitForTimeout(900); }
    await pg.evaluate(() => { try { clearInterval(_restPollTimer); } catch(e) {} });
    return pg;
  };

  const p = await abrir('admin.html', true);
  await p.evaluate(ESCENARIO);

  console.log('══ 1· EL ADMIN NO CIERRA EL CICLO CON VALES SIN BAJAR ══');
  const antes = await p.evaluate(() => {
    _valesAlDiaTs = 0; _cierreIntentos = 999;   // sin reintentos en la prueba
    const c0 = getConfig().cicloActual;
    _cerrarMesSiToca();
    return { c0, c1: getConfig().cicloActual, hist: ganadoresMensuales().length };
  });
  ok('sin los vales de la nube todavía, espera', antes.c0 === antes.c1 && antes.hist === 0, antes);

  console.log('\n══ 2· EL PODIO SALE CON LA MISMA CUENTA QUE EL RANKING ══');
  const cierre = await p.evaluate(async () => {
    _valesAlDiaTs = Date.now();
    _cerrarMesSiToca();
    await new Promise(r => setTimeout(r, 300));
    try { closeEpicGlowPulse(); } catch(e) {}
    const h = ganadoresMensuales().slice(-1)[0];
    _cerrarMesSiToca();                 // otra vez: no se duplica nada
    const top = getNotifs().filter(n => n.type === 'ranking_top3');
    return { h, n: ganadoresMensuales().length, cicloActual: getConfig().cicloActual, ini: _inicioDelCiclo(),
             top: top.map(n => [n.gestorId, n.extra, n.evt]),
             ganado: getNotifs().filter(n => n.type === 'mes_ganado').map(n => [n.gestorId, n.extra]) };
  });
  const nombres = (cierre.h && cierre.h.ranking || []).map(r => r.name + ' ' + r.pts);
  ok('gana Rafael con 50 (los vales unidos se reparten, no 70)', cierre.h && cierre.h.nombre === 'Rafael' && cierre.h.pts === 50, cierre.h);
  ok('2.º Sanjoni 45 y 3.º Kevin 42 (con sus 12 a mano) — Julio no es 2.º',
     JSON.stringify(nombres.slice(0,5)) === JSON.stringify(['Rafael 50','Sanjoni 45','Kevin 42','Julio 20','Brianna 10']), nombres);
  ok('el ciclo pasa al de hoy', cierre.cicloActual === cierre.ini, cierre);
  ok('una sola entrada en el historial aunque se llame dos veces', cierre.n === 1, cierre.n);
  ok('aviso de puesto a los tres de verdad, con su marca',
     JSON.stringify(cierre.top.map(t => t[0]).sort()) === '[1,2,3]' && cierre.top.every(t => /^ranking_top3:/.test(t[2])), cierre.top);
  ok('Sanjoni recibe ¡2do Lugar! con 45', cierre.top.some(t => t[0] === 2 && /2do Lugar!\|45\|/.test(t[1])), cierre.top);
  ok('"ganaste" solo para Rafael, una vez', cierre.ganado.length === 1 && cierre.ganado[0][0] === 1 && cierre.ganado[0][1] === '50', cierre.ganado);

  console.log('\n══ 3· EL CICLO NUEVO EMPIEZA EN EL ORDEN DE LOS QUE GANARON ══');
  const orden = await p.evaluate(() => {
    const s = _armarRankingSummary(getGestores());
    const lista = getGestores().map(g => { const e = s.find(x => x.id === g.id); return { name: g.name, ..._ptsDelResumen(e) }; })
      .sort(_ordenRanking);
    // Un resumen que se quedó del ciclo pasado (el admin no abrió la app a medianoche)
    const viejo = { id: 1, pts: 50, c: _cicloAnterior(_inicioDelCiclo()).from };
    return { orden: lista.map(x => x.name + ':' + x.pts), todosCero: lista.every(x => x.pts === 0),
             viejo: _ptsDelResumen(viejo) };
  });
  ok('todos a 0 en el ciclo nuevo', orden.todosCero, orden.orden);
  ok('y ordenados como acabó el ciclo: Rafael, Sanjoni, Kevin, Julio, Brianna, luego por nombre',
     orden.orden.map(x => x.split(':')[0]).join(',') === 'Rafael,Sanjoni,Kevin,Julio,Brianna,Betty,Karla', orden.orden);
  ok('puntos de un resumen del ciclo pasado ya no cuentan como del nuevo', orden.viejo.pts === 0 && orden.viejo.prev === 50, orden.viejo);

  console.log('\n══ 4· HISTORIAL DE GANADORES (admin, Config) ══');
  const histAdmin = await p.evaluate(() => {
    renderHistorialGanadoresAdmin();
    const b = document.getElementById('historialGanadoresAdmin');
    const det = b && b.querySelector('details');
    return { hay: !!det, cerrado: det && !det.open, txt: b ? b.textContent.replace(/\s+/g, ' ') : '' };
  });
  ok('sale en Config, plegado', histAdmin.hay && histAdmin.cerrado, histAdmin);
  ok('con el podio y los puntos', /Historial de ganadores \(1\)/.test(histAdmin.txt) && /Rafael 50 pts/.test(histAdmin.txt)
     && /Sanjoni 45 pts/.test(histAdmin.txt) && /Kevin 42 pts/.test(histAdmin.txt), histAdmin.txt.slice(0, 300));
  ok('y el resto en un desplegable aparte', /Ver del 4\.º al 5\.º/.test(histAdmin.txt), histAdmin.txt.slice(0, 300));

  console.log('\n══ 5· UN CICLO YA CERRADO CON LA CUENTA VIEJA SE CORRIGE ══');
  const rep = await p.evaluate(() => {
    const h = ganadoresMensuales().slice(-1)[0];
    // Como quedó el 29/09: sin podio guardado y con los puntos sin repartir.
    saveConfig({ ...getConfig(), ganadoresMensuales: [{ mes: h.mes, hasta: h.hasta, gestorId: 1, nombre: 'Rafael', pts: 70, segundo: 'Julio', ts: new Date().toISOString() }] });
    saveNotifs([]);
    _cerrarMesSiToca();   // mismo ciclo → repara
    const r = ganadoresMensuales().slice(-1)[0];
    return { r, top: getNotifs().filter(n => n.type === 'ranking_top3').map(n => n.gestorId).sort() };
  });
  ok('el historial queda con Rafael 50, Sanjoni 2.º', rep.r.pts === 50 && rep.r.segundo === 'Sanjoni' && rep.r.ranking.length === 5, rep.r);
  ok('y se mandan los avisos de puesto buenos', JSON.stringify(rep.top) === '[1,2,3]', rep.top);
  const config = await p.evaluate(() => JSON.stringify(getConfig()));
  const summary = await p.evaluate(() => JSON.stringify(_armarRankingSummary(getGestores())));

  console.log('\n══ 6· EL TELÉFONO DEL GANADOR ENSEÑA EL PODIO GUARDADO ══');
  const g = await abrir('index.html', false);
  const tel = await g.evaluate(async ({ config, summary }) => {
    const cfg = JSON.parse(config);
    saveConfig(cfg);
    const G = (id, name) => ({ id, name, initials: name.slice(0,2).toUpperCase(), color:'#123', password:'pbkdf2$x' });
    saveGestores([G(1,'Rafael'), G(4,'Brianna'), G(2,'Sanjoni'), G(3,'Kevin'), G(7,'Betty'), G(5,'Julio'), G(6,'Karla')]);
    saveProductos([{ id: 1, name: 'Router', stock: 50, precio: '$50 USD', puntos: 10 }]);
    // Lo que tiene guardado el teléfono de Rafael: sus vales y el unido de Julio.
    const dia = cfg.ganadoresMensuales[0].mes + 'T15:00:00.000Z';
    saveVales([{ id: 10, gestorId: 1, status: 'confirmed', ts: dia, confirmedTs: dia, valeProductos: [{ id: 1, qty: 3 }] },
               { id: 11, gestorId: 1, status: 'confirmed', ts: dia, confirmedTs: dia, valeProductos: [{ id: 1, qty: 4 }] },
               { id: 12, gestorId: 5, status: 'confirmed', ts: dia, confirmedTs: dia, unidoA: 11, valeProductos: [{ id: 1, qty: 4 }] }]);
    localStorage.setItem('axon_ranking_summary', summary);
    saveNotifs([{ id: 5000, type: 'mes_ganado', productName: 'Rafael', extra: '70', gestorId: 1, ts: new Date().toISOString(),
                  evt: 'mes_ganado:' + cfg.ganadoresMensuales[0].mes },
                { id: 4000, type: 'ranking_top3', productName: 'Julio', extra: '¡2do Lugar!|31|Puesto #2', gestorId: 5, ts: new Date().toISOString() }]);
    activeGestorId = 1;
    localStorage.removeItem('axon_meta_celebrada_1');
    _celebrarMetaDelGestor();
    await new Promise(r => setTimeout(r, 2600));
    const podio = (document.getElementById('glowWinnersList') || {}).textContent || '';
    const nuevosTop = getNotifs().filter(n => n.type === 'ranking_top3' && n.id !== 4000).length;
    try { closeEpicGlowPulse(); } catch(e) {}
    rankingCache = null; renderGestorRanking();
    const lista = [...document.querySelectorAll('#rankingList .rank-name')].map(e => e.textContent);
    const det = document.querySelector('#rankingList #histGanadores');
    // Bandeja de Julio: el "¡2do Lugar!" viejo (sin marca) ya no sale.
    activeGestorId = 5; renderGestorNotifs();
    const bandejaJulio = (document.getElementById('gestorPersonalNotifsSection') || {}).textContent || '';
    activeGestorId = 1; renderGestorNotifs();
    const bandejaRafael = (document.getElementById('gestorPersonalNotifsSection') || {}).textContent || '';
    return { podio: podio.replace(/\s+/g, ' '), nuevosTop, lista, hist: !!det, bandejaJulio, bandejaRafael: bandejaRafael.replace(/\s+/g, ' ') };
  }, { config, summary });
  ok('el podio es Rafael 50 · Sanjoni 45 · Kevin 42', /Rafael.*50 pts.*Sanjoni.*45 pts.*Kevin.*42 pts/.test(tel.podio), tel.podio.slice(0, 300));
  ok('Julio no sale en el podio', !/Julio/.test(tel.podio), tel.podio.slice(0, 300));
  ok('el teléfono del gestor NO manda avisos de puesto a nadie', tel.nuevosTop === 0, tel.nuevosTop);
  ok('Top Gestores en el orden de los que ganaron', tel.lista.join(',') === 'Rafael,Sanjoni,Kevin,Julio,Brianna,Betty,Karla', tel.lista);
  ok('con el historial desplegable debajo', tel.hist, tel);
  ok('el "¡2do Lugar!" equivocado ya no sale en la bandeja de Julio', !/2do Lugar/.test(tel.bandejaJulio), tel.bandejaJulio.slice(0, 200));
  ok('el aviso del ganador dice los puntos corregidos (50, no 70)', /Terminaste primero con 50 puntos/.test(tel.bandejaRafael), tel.bandejaRafael.slice(0, 200));

  console.log('\n══ 7· COMISIONES: EL MONTO, NO CUÁNTAS ══');
  const com = await p.evaluate(() => {
    const t = new Date().toISOString();
    const base = { status: 'confirmed', ts: t, confirmedTs: t, total: '$50 USD', valeText: '', gestorId: 2, commissionStatus: 'en_sobre' };
    saveVales([{ ...base, id: 90, valeProductos: [{ id: 1, qty: 2 }] },           // $10
               { ...base, id: 91, valeProductos: [{ id: 2, qty: 1 }] },           // producto sin comisión: 0
               { ...base, id: 92, valeProductos: [{ id: 999, qty: 1 }] },         // producto borrado: no se sabe
               { ...base, id: 93, valeProductos: [{ id: 1, qty: 1 }], comFijadaUSD: 7 }]);   // $7 congelados
    const s = sumCommissions(getVales());
    gestoresTabDirty = true; renderAdminGestoresList();
    const card = document.querySelector('#adminGestoresPanel-list [data-gestor-id="2"]');
    return { s, badge: fmtComisionBadge(s.usd, s.mn, s.computed, s.sinCalcular), card: card ? card.textContent.replace(/\s+/g, ' ') : '' };
  });
  ok('se suma lo que se puede: $17', com.s.usd === 17, com.s);
  ok('y se dice cuántos no se pueden calcular', com.badge === '$17.00 USD (+1 sin calcular)', com.badge);
  ok('la tarjeta del gestor enseña el monto en el sobre', /✉️ \$17\.00 USD/.test(com.card) && !/✉️ 4\b/.test(com.card), com.card.slice(0, 300));

  console.log('\n══ ERRORES DE JAVASCRIPT ══');
  ok('ninguno', !errores.length, errores);
  console.log(fallos ? `\n❌ ${fallos} fallo(s)` : '\n✅ todo correcto');
  await nav.close(); srv.close(); process.exit(fallos ? 1 : 0);
})();
