// Pedido el 29/09: "que las contraseñas de los gestores en el admin no salgan
// encriptadas". El hash no se puede deshacer, así que se guarda además un sobre
// que solo abre el admin (RSA; la llave privada, cifrada con la contraseña del
// admin). Las claves ya encriptadas aparecen cuando cada gestor entra — sin
// cambiarle la clave a nadie.
//
//   NODE_PATH=$(npm root -g) node pruebas/prueba_claves_visibles.js
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


// Nube de mentira: solo la tabla meta (lo que usa el llavero); lo demás, vacío.
const META = {};
function responde(url, metodo, cuerpo) {
  if (url.includes('/rest/v1/meta')) {
    if (metodo === 'POST') {
      let b = []; try { b = JSON.parse(cuerpo || '[]'); } catch(e) {}
      (Array.isArray(b) ? b : [b]).forEach(r => { if (r && r.name) META[r.name] = r.data; });
      return { status: 201, body: '[]' };
    }
    const m = /name=eq\.([^&]+)/.exec(url);
    if (m) { const n = decodeURIComponent(m[1]); return { status: 200, body: JSON.stringify(n in META ? [{ name: n, data: META[n], updated_at: '2026-09-29T10:00:00+00:00' }] : []) }; }
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
    await pg.evaluate(() => { try { clearInterval(_restPollTimer); } catch(e) {} });
    if (admin) { await pg.fill('#passInput','axon2024'); await pg.click('button:has-text("Entrar")'); await pg.waitForTimeout(900); }
    await pg.evaluate(() => { try { clearInterval(_restPollTimer); } catch(e) {} });
    return pg;
  };

  const p = await abrir('admin.html', false);
  // Dos gestores de antes: Ana ya encriptada (sin sobre) y Luis aún en texto plano.
  await p.evaluate(async () => {
    const hashAna = await _hashGestorPass('ABC123');
    saveGestores([{ id: 1, name: 'Ana', initials: 'AN', color: '#123', password: hashAna },
                  { id: 2, name: 'Luis', initials: 'LU', color: '#456', password: 'xyz789' }]);
  });
  await p.fill('#passInput','axon2024'); await p.click('button:has-text("Entrar")');
  await p.waitForTimeout(4000);
  await p.evaluate(() => { try { clearInterval(_restPollTimer); } catch(e) {} });

  console.log('══ 1· AL ENTRAR EL ADMIN SE CREA LA LLAVE ══');
  const llave = await p.evaluate(() => ({ estado: _llaveEstado, pub: !!_clavePublicaTxt(), abierta: !!_llavePrivada }));
  ok('llave creada y abierta', llave.estado === 'abierta' && llave.pub && llave.abierta, llave);
  const doc = META.claves_admin || {};
  ok('en la nube la parte privada va cifrada (no es legible)', !!doc.priv && !!doc.sal && !/PRIVATE|axon2024/.test(JSON.stringify(doc)), Object.keys(doc));
  ok('la parte pública va en el config (para los gestores)', !!(META.config && META.config.clavesPub), Object.keys(META.config || {}));

  console.log('\n══ 2· LA CLAVE QUE SEGUÍA EN TEXTO PLANO: SE ENCRIPTA Y SE SIGUE VIENDO ══');
  const luis = await p.evaluate(async () => {
    await encriptarClavesViejas();
    const g = gestorOf(2);
    return { hash: g.password.startsWith('pbkdf2$'), clara: await _leerClaveGestor(g), entra: await _gestorPassMatches('XYZ789', g.password) };
  });
  ok('Luis queda encriptado, con la MISMA clave', luis.hash && luis.entra, luis);
  ok('y el admin la ve: XYZ789', luis.clara === 'XYZ789', luis);
  const vista = await p.evaluate(async () => {
    adminTab('gestores'); gestoresTabDirty = true; renderAdminGestoresList();
    const el = document.getElementById('gpw-2'); const antes = el && el.textContent;
    await toggleGestorPass(2);
    return { antes, despues: el && el.textContent, ana: (document.getElementById('gpw-1') || {}).textContent };
  });
  ok('en la lista sale tapada y al tocar se ve', /••/.test(vista.antes) && vista.despues === '🔑 XYZ789', vista);
  ok('Ana (encriptada de antes) dice que se verá al entrar', /Se verá al entrar/.test(vista.ana), vista);

  console.log('\n══ 3· GESTOR NUEVO: SU CLAVE SE VE AL MOMENTO ══');
  const nuevo = await p.evaluate(async () => {
    document.getElementById('newGestorInput').value = 'Marta';
    addGestor();
    await new Promise(r => setTimeout(r, 1500));
    try { closeConfirmAction(); } catch(e) {}
    const g = getGestores().find(x => x.name === 'Marta');
    const clara = await _leerClaveGestor(g);
    return { clara, entra: !!clara && await _gestorPassMatches(clara, g.password) };
  });
  ok('Marta: el admin ve una clave que de verdad sirve para entrar', nuevo.clara && nuevo.entra, nuevo);

  console.log('\n══ 4· LA DE ANA APARECE CUANDO ELLA ENTRA (sin cambiarla) ══');
  const listaAdmin = await p.evaluate(() => JSON.stringify({ gestores: getGestores(), config: getConfig() }));
  const g = await abrir('index.html', false);
  const ana = await g.evaluate(async (txt) => {
    const d = JSON.parse(txt);
    saveConfig(d.config); saveGestores(d.gestores);
    const antes = gestorOf(1).password;
    // Ana entra con su clave en su teléfono.
    selectGestor(1);
    await new Promise(r => setTimeout(r, 300));
    document.getElementById('gestorPassInput').value = 'abc123';
    submitGestorPass();
    await new Promise(r => setTimeout(r, 2500));
    const a = gestorOf(1);
    return { mismaClave: a.password === antes, tieneSobre: !!a.claveVisible, dentro: activeGestorId === 1, ana: JSON.stringify(a),
             privada: localStorage.getItem('axon_claves_admin') };
  }, listaAdmin);
  ok('Ana entra', ana.dentro, ana);
  ok('su clave no cambia', ana.mismaClave, ana);
  ok('y su teléfono deja el sobre para el admin', ana.tieneSobre, ana);
  ok('el teléfono del gestor no tiene la llave privada', ana.privada === null, ana.privada);
  const leida = await p.evaluate(async (anaTxt) => {
    const a = JSON.parse(anaTxt);
    const list = getGestores().map(x => x.id === 1 ? a : x); saveGestores(list);
    return await _leerClaveGestor(gestorOf(1));
  }, ana.ana);
  ok('el admin ya ve la de Ana: ABC123', leida === 'ABC123', leida);

  console.log('\n══ 5· CONTRASEÑA DEL ADMIN ══');
  const cambio = await p.evaluate(async () => {
    const ok1 = await _recerrarLlavero('Nueva-clave-99');
    _llavePrivada = null;
    const conVieja = await _abrirLlavero('axon2024');
    const estadoVieja = _llaveEstado;
    const conNueva = await _abrirLlavero('Nueva-clave-99');
    return { ok1, conVieja, estadoVieja, conNueva, ana: await _leerClaveGestor(gestorOf(1)) };
  });
  ok('al cambiarla, la llave se vuelve a cerrar con la nueva', cambio.ok1 && cambio.conNueva && cambio.ana === 'ABC123', cambio);
  ok('con la vieja ya no se abre (y se sabe por qué)', !cambio.conVieja && cambio.estadoVieja === 'otra_clave', cambio);

  console.log('\n══ 6· LO QUE NO DEBE SALIR ══');
  const fuera = await p.evaluate(() => ({
    backup: JSON.stringify(_gestoresParaPublicar(getGestores())),
    gestorNoBaja: !_SB_SINGLETON_ROWS.includes('claves_admin') && _SB_SINGLETON_ADMIN.includes('claves_admin') }));
  ok('el respaldo público no lleva ni clave ni sobre', !/password|claveVisible/.test(fuera.backup), fuera.backup.slice(0, 200));
  ok('los teléfonos de gestor no bajan la llave', fuera.gestorNoBaja, fuera);

  console.log('\n══ ERRORES DE JAVASCRIPT ══');
  ok('ninguno', !errores.length, errores);
  console.log(fallos ? `\n❌ ${fallos} fallo(s)` : '\n✅ todo correcto');
  await nav.close(); srv.close(); process.exit(fallos ? 1 : 0);
})();
