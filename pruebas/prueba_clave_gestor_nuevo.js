// Reportado el 19/09: "cree un nuevo gestor y cuando le paso la contraseña
// para que entre le pone contraseña incorrecta".
//
// Reproduce el camino exacto: crear el gestor en admin.html, apuntar la clave
// que se muestra, y usarla para entrar en index.html — mismo origen, mismo
// localStorage, sin nube de por medio, para aislar si el fallo está en la
// lógica de hash/verificación o es cosa de sincronización entre teléfonos.
//
//   NODE_PATH=$(npm root -g) node pruebas/prueba_clave_gestor_nuevo.js
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

(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const nav = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const ctx = await nav.newContext({viewport:{width:430,height:1200}});
  await ctx.route('**/*', r => r.request().url().includes('127.0.0.1')
    ? r.continue() : r.fulfill({status:200, body:'[]'}));
  const p = await ctx.newPage();
  const errores = [];
  p.on('pageerror', e => errores.push(String(e).slice(0,200)));

  console.log('══ 1· EL ADMIN CREA UN GESTOR NUEVO ══');
  await p.goto(`http://127.0.0.1:${srv.address().port}/admin.html`, {waitUntil:'domcontentloaded'});
  await p.waitForTimeout(2400);
  await p.fill('#passInput','axon2024');
  await p.click('button:has-text("Entrar")');
  await p.waitForTimeout(900);
  await p.evaluate(() => { try { clearInterval(_restPollTimer); } catch(e) {} saveGestores([]); saveVales([]); adminTab('gestores'); });
  await p.waitForTimeout(300);

  await p.fill('#newGestorInput', 'Pedro Nuevo');
  await p.click('button[onclick="addGestor()"]');
  await p.waitForTimeout(600);

  const creado = await p.evaluate(() => {
    const g = getGestores().find(x => x.name === 'Pedro Nuevo');
    return {
      existe: !!g, id: g && g.id,
      passHasheada: !!(g && g.password && g.password.startsWith('pbkdf2$')),
      claveMostrada: _claveGestorTexto,
      modalAbierto: document.getElementById('claveGestorModal').classList.contains('show'),
      valorEnModal: (document.getElementById('claveGestorValor')||{}).textContent || '',
    };
  });
  ok('el gestor se crea', creado.existe, creado);
  ok('la clave guardada está hasheada (PBKDF2)', creado.passHasheada, creado);
  ok('se abre la ventana con la clave', creado.modalAbierto, creado);
  ok('la clave del modal es la misma que _claveGestorTexto',
     creado.valorEnModal === creado.claveMostrada && creado.claveMostrada.length > 0, creado);

  const clave = creado.claveMostrada;
  const gestorId = creado.id;
  console.log('  clave mostrada: ' + clave);

  console.log('\n══ 2· CON ESA CLAVE, EL GESTOR ENTRA EN index.html (mismo origen) ══');
  await p.goto(`http://127.0.0.1:${srv.address().port}/index.html`, {waitUntil:'domcontentloaded'});
  await p.waitForTimeout(2200);
  await p.evaluate(() => { try { clearInterval(_restPollTimer); } catch(e) {} });

  const antesDeEntrar = await p.evaluate(gid => {
    const g = getGestores().find(x => x.id === gid);
    return { loQueVeIndex: g ? { id: g.id, name: g.name, passHasheada: (g.password||'').startsWith('pbkdf2$') } : null };
  }, gestorId);
  ok('index.html ve al gestor recién creado (mismo localStorage)',
     !!antesDeEntrar.loQueVeIndex, antesDeEntrar);

  await p.evaluate(gid => selectGestor(gid), gestorId);
  await p.waitForTimeout(300);
  const modalPassAbierto = await p.evaluate(() =>
    document.getElementById('gestorPassModal').classList.contains('show'));
  ok('pide la contraseña (no entra sola)', modalPassAbierto, modalPassAbierto);

  await p.fill('#gestorPassInput', clave);
  await p.click('#gestorPassSubmit');
  await p.waitForTimeout(1200);

  const resultado = await p.evaluate(() => ({
    errorVisible: document.getElementById('gestorPassError').style.display === 'block',
    entroBien: activeGestorId != null,
    modalSigueAbierto: document.getElementById('gestorPassModal').classList.contains('show'),
  }));
  ok('NO dice "contraseña incorrecta"', !resultado.errorVisible, resultado);
  ok('entra de verdad (activeGestorId puesto)', resultado.entroBien, resultado);
  ok('y el modal se cierra', !resultado.modalSigueAbierto, resultado);

  console.log('\n══ 3· LA CLAVE QUE SE ESCRIBE CON MINÚSCULAS TAMBIÉN VALE ══');
  await p.evaluate(() => { changeGestor(); });
  await p.waitForTimeout(200);
  await p.evaluate(gid => selectGestor(gid), gestorId);
  await p.waitForTimeout(200);
  await p.fill('#gestorPassInput', clave.toLowerCase());
  await p.click('#gestorPassSubmit');
  await p.waitForTimeout(1200);
  const resultado2 = await p.evaluate(() => ({
    errorVisible: document.getElementById('gestorPassError').style.display === 'block',
    entroBien: activeGestorId != null,
  }));
  ok('en minúsculas también entra', !resultado2.errorVisible && resultado2.entroBien, resultado2);

  console.log('\n══ 4· UNA CLAVE DE VERDAD INCORRECTA SÍ FALLA (control) ══');
  await p.evaluate(() => { changeGestor(); });
  await p.waitForTimeout(200);
  await p.evaluate(gid => selectGestor(gid), gestorId);
  await p.waitForTimeout(200);
  await p.fill('#gestorPassInput', 'ESTOESTAMAL1');
  await p.click('#gestorPassSubmit');
  await p.waitForTimeout(1200);
  const resultado3 = await p.evaluate(() => ({
    errorVisible: document.getElementById('gestorPassError').style.display === 'block',
    entroBien: activeGestorId != null,
  }));
  ok('con una clave mala sí sale el error', resultado3.errorVisible && !resultado3.entroBien, resultado3);

  console.log('\n══ 5· HIPÓTESIS: DOBLE TOQUE EN "AGREGAR" CREA DOS GESTORES CON EL MISMO NOMBRE ══');
  // Un admin impaciente (o un doble toque sin querer en el móvil) puede disparar
  // addGestor() dos veces antes de que la primera termine de hashear la clave
  // (async). Si el chequeo de "ya existe ese gestor" no lo detecta a tiempo,
  // salen DOS gestores con el mismo nombre y CLAVES DISTINTAS, y el admin solo
  // llega a ver una de las dos en la ventana emergente.
  await p.goto(`http://127.0.0.1:${srv.address().port}/admin.html`, {waitUntil:'domcontentloaded'});
  await p.waitForTimeout(2400);
  await p.fill('#passInput','axon2024');
  await p.click('button:has-text("Entrar")');
  await p.waitForTimeout(900);
  await p.evaluate(() => { try { clearInterval(_restPollTimer); } catch(e) {} saveGestores([]); saveVales([]); adminTab('gestores'); });
  await p.waitForTimeout(300);

  const doble = await p.evaluate(async () => {
    document.getElementById('newGestorInput').value = 'Marisol';
    // Dos toques seguidos, como un doble-tap real, antes de que ninguno acabe.
    addGestor();
    addGestor();
    // Esperar a que las dos promesas de hash (PBKDF2, async) resuelvan.
    await new Promise(r => setTimeout(r, 800));
    const marisoles = getGestores().filter(g => g.name === 'Marisol');
    return {
      cuantos: marisoles.length,
      ids: marisoles.map(g => g.id),
      claveMostradaAlFinal: _claveGestorTexto,
    };
  });
  ok('debería crear UN solo gestor "Marisol", no dos',
     doble.cuantos === 1, doble);

  console.log('\n══ 6· LA CONDICIÓN DE CARRERA QUE SÍ ERA REAL (v129) ══');
  // El PBKDF2 de la clave nueva es async (~50-200ms según el teléfono). Si en
  // esa ventana llega un cambio de OTRO gestor —un sondeo de Supabase, u otra
  // pestaña editando—, la versión vieja del código escribía sobre una copia
  // de la lista capturada ANTES del hash, y ese cambio ajeno se perdía. Aquí
  // se fuerza esa ventana a mano: se hace lento el hash, y a mitad de camino
  // se cambia OTRO gestor por otra vía (como si fuera un sondeo).
  await p.evaluate(() => { saveGestores([{id:9001, name:'Carlos', initials:'C', color:'#111', password:'pbkdf2$x'}]); });
  const carrera = await p.evaluate(async () => {
    const original = _hashGestorPass;
    window._hashGestorPass = async (input) => {
      // A mitad del hash, "llega" un cambio de otro gestor por otra vía —
      // exactamente lo que haría un _doRestPoll que trae la ficha de Carlos
      // ya editada desde otro teléfono: reemplaza _gestoresCache por un
      // array NUEVO (igual que hace el poll de verdad, línea "_gestoresCache
      // = arr" en el nodo lento) — mutar el mismo array en el sitio, como
      // haría una prueba más floja, no reproduce la condición de carrera real.
      setTimeout(() => {
        const fresco = JSON.parse(JSON.stringify(getGestores()));
        const i = fresco.findIndex(g => g.id === 9001);
        if (i !== -1) fresco[i].phone = '55550000';
        saveGestores(fresco);
      }, 30);
      await new Promise(r => setTimeout(r, 80));
      return original(input);
    };
    document.getElementById('newGestorInput').value = 'Osmani';
    addGestor();
    await new Promise(r => setTimeout(r, 500));
    window._hashGestorPass = original;
    const carlos = getGestores().find(g => g.id === 9001);
    const osmani = getGestores().find(g => g.name === 'Osmani');
    return { telefonoCarlos: carlos && carlos.phone, existeOsmani: !!osmani };
  });
  ok('el cambio ajeno a Carlos (llegado durante el hash) NO se pierde',
     carrera.telefonoCarlos === '55550000', carrera);
  ok('y el gestor nuevo se crea de todas formas', carrera.existeOsmani, carrera);

  console.log('\n══ ERRORES DE JAVASCRIPT ══');
  const graves = errores.filter(e => !/favicon|manifest|sw\.js|Failed to load resource|net::ERR/i.test(e));
  ok('ninguno', graves.length === 0, graves.slice(0,5));

  await nav.close(); srv.close();
  console.log('\n' + (fallos ? '❌ ' + fallos + ' fallo(s)' : '✅ todo correcto'));
  process.exit(fallos ? 1 : 0);
})();
