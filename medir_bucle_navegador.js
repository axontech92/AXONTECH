// Carga la app DE VERDAD en un navegador, le corta la salida a Supabase y
// cuenta lo que pediría en 60 segundos de bucle. No simula el bucle: lo corre.
//
// Los tamaños de respuesta son los MEDIDOS contra la base de datos real
// (medir_egress.js en Actions): notifs 11.551 B, el gestor con más trabajo
// 46.185 B, la tabla de vales entera 149 KB.
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const RAIZ = '/home/user/AXONTECH';
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.png':'image/png' };

function servidor() {
  return new Promise(res => {
    const s = http.createServer((req, r) => {
      const p = path.join(RAIZ, decodeURIComponent(req.url.split('?')[0]));
      if (!p.startsWith(RAIZ) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); return r.end(); }
      r.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'text/plain' });
      r.end(fs.readFileSync(p));
    }).listen(0, '127.0.0.1', () => res(s));
  });
}

// Respuestas de mentira, del tamaño real medido.
function relleno(bytes) {
  const base = JSON.stringify([{ data: { id: 1, cliente: 'x' }, updated_at: '2026-08-01T00:00:00Z' }]);
  if (bytes <= base.length) return base;
  return '[{"data":{"id":1,"relleno":"' + 'x'.repeat(bytes - base.length - 30) + '"},"updated_at":"2026-08-01T00:00:00Z"}]';
}
const TAM = { notifs: 11551, valesGestor: 46185, valesTabla: 152576 };

async function medir({ pagina, gestor, segundos }) {
  const srv = await servidor();
  const puerto = srv.address().port;
  const navegador = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await navegador.newContext();
  const pag = await ctx.newPage();

  const porUrl = new Map();
  let cuentaPreguntas = 0;
  const errores = [];
  pag.on('pageerror', e => errores.push(String(e.message).slice(0, 120)));
  pag.on('console', m => { if (m.type() === 'error') errores.push('console: ' + m.text().slice(0, 120)); });
  // UNA sola ruta que decide: en Playwright la última registrada gana, así que
  // dos rutas solapadas hacían que el comodín se tragara las de Supabase y el
  // contador saliera en cero.
  await ctx.route('**/*', async route => {
    const cruda = route.request().url();
    if (cruda.includes('127.0.0.1')) return route.continue();
    if (!cruda.includes('supabase.co')) return route.fulfill({ status: 200, body: '' });
    const u = new URL(cruda);
    const q = u.search;
    let cuerpo = '[]';
    let etiqueta;
    const deGestor = q.includes('gestorId=eq');
    const incremental = q.includes('updated_at=gt');
    if (u.pathname.endsWith('/meta')) {
      const doc = (/name=eq\.([a-z_]+)/.exec(q) || [,'?'])[1];
      if (q.includes('select=name')) { etiqueta = 'pregunta · ¿' + doc + ' nuevo?'; cuerpo = '[]'; }
      else { etiqueta = 'BAJAR ' + doc + ' entero'; cuerpo = relleno(doc === 'notifs' ? TAM.notifs : 800); }
    } else if (u.pathname.endsWith('/vales')) {
      if (q.includes('select=id')) {
        etiqueta = deGestor ? 'pregunta · ¿vales MÍOS nuevos?' : 'pregunta · ¿vales nuevos?';
        // A partir de la 4ª pregunta se contesta que SÍ hay algo nuevo, para
        // que se ejecute de verdad el camino de la bajada parcial.
        cuentaPreguntas++;
        cuerpo = cuentaPreguntas > 3 ? '[{"id":1}]' : '[]';
      }
      else if (deGestor && incremental) { etiqueta = '→ bajar SOLO lo cambiado del gestor'; cuerpo = relleno(1800); }
      else if (deGestor)                { etiqueta = 'BAJAR todos los vales del gestor';   cuerpo = relleno(TAM.valesGestor); }
      else if (incremental)             { etiqueta = '→ bajar SOLO lo cambiado (admin)';   cuerpo = relleno(1800); }
      // La consulta vieja por id (formato antiguo de vales) devuelve vacío en
      // los 40 gestores: medido en Actions, 4 bytes. Etiquetarla como "tabla
      // entera" inflaba el resultado con 149 KB que no existen.
      else if (/[?&]id=eq\./.test(q)) { etiqueta = 'consulta vieja por id (vacía)'; cuerpo = '[]'; }
      else { etiqueta = 'BAJAR tabla de vales entera'; cuerpo = relleno(TAM.valesTabla); }
    } else {
      etiqueta = 'otros (' + u.pathname.split('/').pop() + ')';
      cuerpo = '[]';
    }
    const e = porUrl.get(etiqueta) || { veces: 0, bytes: 0 };
    e.veces++; e.bytes += Buffer.byteLength(cuerpo);
    porUrl.set(etiqueta, e);
    await route.fulfill({ status: 200, contentType: 'application/json', body: cuerpo });
  });

  await pag.addInitScript(g => {
    // Sesión ya iniciada, para que el bucle del gestor coja su rama.
    if (g) localStorage.setItem('axon_activeGestorId', String(g));
    localStorage.setItem('axon_gestores', JSON.stringify([{ id: g || 1, name: 'G', initials: 'G', color: '#000' }]));
    // El bucle se para si la pestaña está oculta; en headless conviene forzarlo.
    Object.defineProperty(document, 'hidden', { get: () => false });
    Object.defineProperty(document, 'visibilityState', { get: () => 'visible' });
  }, gestor);

  await pag.goto(`http://127.0.0.1:${puerto}/${pagina}`, { waitUntil: 'domcontentloaded' });
  // activeGestorId NO se guarda en el teléfono: lo pone doSelectGestor() al
  // entrar con la clave. Sin esto el bucle coge la rama del admin y la del
  // gestor —la que se quiere medir— no llega a correr nunca.
  if (gestor) {
    cuentaPreguntas = 0;
    await pag.waitForTimeout(2500);
    await pag.evaluate(id => {
      try { doSelectGestor(id); } catch (e) { try { activeGestorId = id; } catch (_e) {} }
    }, gestor);
  }
  // El arranque (bajada inicial completa) cuesta lo que cuesta y pasa UNA vez.
  // Lo que decide la factura del mes es lo que gasta el bucle EN RÉGIMEN, así
  // que se cuenta aparte: foto de los contadores a mitad y diferencia al final.
  await pag.waitForTimeout(Math.round(segundos * 1000 / 2));
  const corte = new Map([...porUrl.entries()].map(([k, v]) => [k, { ...v }]));
  await pag.waitForTimeout(Math.round(segundos * 1000 / 2));
  const regimen = new Map();
  for (const [k, v] of porUrl) {
    const a = corte.get(k) || { veces: 0, bytes: 0 };
    if (v.veces - a.veces > 0) regimen.set(k, { veces: v.veces - a.veces, bytes: v.bytes - a.bytes });
  }
  const rama = gestor ? await pag.evaluate(() => { try { return activeGestorId; } catch(e) { return 'no accesible'; } }) : null;
  if (gestor) console.log('  (gestor activo en la app: ' + rama + ')');
  const poll = await pag.evaluate(() => typeof _restPollTimer !== 'undefined' && _restPollTimer !== null).catch(()=>null);
  await navegador.close(); srv.close();
  return { porUrl, regimen, errores, poll };
}

function informe(titulo, res, segundos) {
  const mapa = res.porUrl;
  if (res.poll === false) console.log('  ⚠️ el bucle NO llegó a arrancar');
  if (res.errores.length) console.log('  errores:', [...new Set(res.errores)].slice(0,3).join(' | '));
  console.log('\n── ' + titulo + ' ' + '─'.repeat(Math.max(0, 52 - titulo.length)));
  let total = 0;
  [...mapa.entries()].sort((a, b) => b[1].bytes - a[1].bytes).forEach(([k, v]) => {
    total += v.bytes;
    console.log(`  ${k.padEnd(30)} ${String(v.veces).padStart(3)}×  ${(v.bytes/1024).toFixed(1).padStart(8)} KB`);
  });
  console.log(`  ${'TOTAL (arranque incluido)'.padEnd(30)}      ${(total/1024).toFixed(1).padStart(8)} KB`);
  const mitad = segundos / 2;
  let reg = 0;
  console.log(`  ── en régimen (últimos ${mitad}s, ya arrancada) ──`);
  [...res.regimen.entries()].sort((a,b)=>b[1].bytes-a[1].bytes).forEach(([k,v]) => {
    reg += v.bytes;
    console.log(`     ${k.padEnd(33)} ${String(v.veces).padStart(3)}×  ${(v.bytes/1024).toFixed(1).padStart(8)} KB`);
  });
  const porHora = reg / mitad * 3600;
  console.log(`     ${'TOTAL'.padEnd(33)}      ${(reg/1024).toFixed(1).padStart(8)} KB`);
  console.log(`     ${'→ por hora'.padEnd(33)}      ${(porHora/1048576).toFixed(2).padStart(8)} MB`);
  console.log(`     ${'→ 10 h/día, 30 días'.padEnd(33)}      ${(porHora*10*30/1073741824).toFixed(2).padStart(8)} GB`);
  return porHora * 10 * 30;
}

(async () => {
  const SEG = 32;   // 6 pasadas del bucle de 5 s, mas el arranque
  console.log('Corriendo la app real durante ' + SEG + ' s por cada rol…');
  const admin  = await medir({ pagina: 'admin.html', gestor: null, segundos: SEG });
  const gestorM = await medir({ pagina: 'index.html', gestor: 21, segundos: SEG });
  const a = informe('ADMIN (admin.html)', admin, SEG);
  const g = informe('GESTOR (index.html)', gestorM, SEG);
  console.log('\n── Al mes ────────────────────────────────────────────');
  console.log(`  1 admin + 1 gestor:            ${((a+g)/1073741824).toFixed(2)} GB`);
  console.log(`  1 admin + 5 gestores:          ${((a+g*5)/1073741824).toFixed(2)} GB   (el plan da 5 GB)`);
})().catch(e => { console.error(e); process.exit(1); });
