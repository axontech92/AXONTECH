#!/usr/bin/env node
/**
 * AXONTECH · ¿Por dónde se están yendo los GB?
 *
 * El plan gratuito de Supabase da 5 GB de salida al mes y el panel marca 6.61 GB.
 * v103 y v112 pusieron un freno al bucle de 5 segundos… pero solo en el camino
 * del ADMIN. Esto mide lo que pesa DE VERDAD cada llamada que hace el bucle, en
 * los dos roles, y calcula lo que sale al mes con esos números.
 *
 * No adivina: pide exactamente las mismas URLs que pide app.js y pesa la
 * respuesta.
 *
 * ⚠️ PRIVACIDAD — este repositorio es PÚBLICO y los registros de Actions también.
 * Aquí NO se imprime ni un nombre, ni un teléfono, ni una dirección, ni el
 * contenido de un vale. Solo cuentas: bytes, filas y proyecciones.
 */
const fs = require('fs');
const JS  = fs.readFileSync(__dirname + '/app.js', 'utf8');
const url = /SUPABASE_URL\s*=\s*'([^']+)'/.exec(JS)[1] + '/rest/v1';
const key = /SUPABASE_(?:KEY|ANON_KEY)\s*=\s*'([^']+)'/.exec(JS)[1];
const hdrs = { apikey: key, Authorization: 'Bearer ' + key };

const KB = b => (b / 1024).toFixed(1) + ' KB';
const MB = b => (b / 1048576).toFixed(1) + ' MB';
const GB = b => (b / 1073741824).toFixed(2) + ' GB';

async function pesar(ruta) {
  const t0 = Date.now();
  const r = await fetch(url + ruta, { headers: hdrs });
  const texto = await r.text();
  return { status: r.status, bytes: Buffer.byteLength(texto), ms: Date.now() - t0, texto };
}

// Cada pasada del bucle, con lo que cuesta y cada cuánto se repite.
const llamadas = [];
function anotar(rol, etiqueta, bytes, cadaSegundos, gated) {
  llamadas.push({ rol, etiqueta, bytes, cadaSegundos, gated });
}

(async () => {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  ¿Por dónde se van los GB de Supabase?                       ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // ── Cuánto hay ──
  const idsVales = await pesar('/vales?select=id');
  const nVales = JSON.parse(idsVales.texto).length;
  const gestoresR = await pesar('/gestores?select=data');
  const gestores = JSON.parse(gestoresR.texto).map(r => r.data).filter(Boolean);
  console.log(`Vales en la nube: ${nVales} · gestores: ${gestores.length}\n`);

  // ══════════════════════════════════════════════════════
  //  1. EL BUCLE DE 5 SEGUNDOS — CAMINO DEL ADMIN
  // ══════════════════════════════════════════════════════
  console.log('── Cada 5 s · teléfono del ADMIN ─────────────────────────────');
  const futuro = new Date(Date.now() + 3600000).toISOString();
  const preguntaVales = await pesar(`/vales?select=id&updated_at=gt.${encodeURIComponent(futuro)}&limit=1`);
  console.log(`  "¿hay vales nuevos?"        ${String(preguntaVales.bytes).padStart(7)} B   (con freno ✓)`);
  anotar('admin', '¿hay vales nuevos?', preguntaVales.bytes, 5, true);

  const notifs = await pesar('/meta?select=data&name=eq.notifs');
  console.log(`  bajar notifs ENTERO        ${String(notifs.bytes).padStart(7)} B   ${notifs.bytes > 2000 ? '⚠️ SIN FRENO' : '(pequeño)'}`);
  anotar('admin', 'notifs entero', notifs.bytes, 5, false);

  // ══════════════════════════════════════════════════════
  //  2. EL BUCLE DE 5 SEGUNDOS — CAMINO DEL GESTOR
  // ══════════════════════════════════════════════════════
  console.log('\n── Cada 5 s · teléfono de CADA GESTOR ────────────────────────');
  let peorGestor = 0, totalGestores = 0;
  for (const g of gestores) {
    const gid = encodeURIComponent(String(g.id));
    const a = await pesar(`/vales?select=data&data->>gestorId=eq.${gid}`);
    const b = await pesar(`/vales?select=data&id=eq.${gid}`);
    const suma = a.bytes + b.bytes;
    const filas = JSON.parse(a.texto).length;
    // Sin nombres: solo el número de gestor por orden de aparición.
    console.log(`  gestor #${String(gestores.indexOf(g) + 1).padEnd(2)} · ${String(filas).padStart(3)} vales   ${String(suma).padStart(7)} B   ⚠️ SIN FRENO`);
    peorGestor = Math.max(peorGestor, suma);
    totalGestores += suma;
    anotar('gestor', `vales del gestor #${gestores.indexOf(g) + 1}`, suma, 5, false);
    anotar('gestor', 'notifs entero', notifs.bytes, 5, false);
  }
  console.log(`  (los dos "select=data" van SIEMPRE, cambie algo o no)`);

  // ══════════════════════════════════════════════════════
  //  3. LO QUE SE BAJARÍA CON EL FRENO PUESTO
  // ══════════════════════════════════════════════════════
  console.log('\n── Lo que costaría preguntar en vez de bajar ─────────────────');
  const gid0 = gestores.length ? encodeURIComponent(String(gestores[0].id)) : '1';
  const pregGestor = await pesar(`/vales?select=id&data->>gestorId=eq.${gid0}&updated_at=gt.${encodeURIComponent(futuro)}&limit=1`);
  console.log(`  "¿hay vales nuevos MÍOS?"   ${String(pregGestor.bytes).padStart(7)} B`);
  const pregNotifs = await pesar(`/meta?select=name&name=eq.notifs&updated_at=gt.${encodeURIComponent(futuro)}`);
  console.log(`  "¿hay notifs nuevas?"       ${String(pregNotifs.bytes).padStart(7)} B   HTTP ${pregNotifs.status}${pregNotifs.status !== 200 ? ' ← meta no tiene updated_at legible' : ''}`);

  // ══════════════════════════════════════════════════════
  //  4. PROYECCIÓN
  // ══════════════════════════════════════════════════════
  const HORAS = 10;   // una jornada con la app abierta
  const DIAS  = 30;
  console.log(`\n── Al mes (${HORAS} h al día, ${DIAS} días, ${gestores.length} gestor(es) + 1 admin) ──`);
  let totalMes = 0, totalMesSinFreno = 0;
  const porEtiqueta = new Map();
  for (const c of llamadas) {
    const veces = (HORAS * 3600 / c.cadaSegundos) * DIAS;
    const bytes = c.bytes * veces;
    totalMes += bytes;
    if (!c.gated) totalMesSinFreno += bytes;
    const k = c.rol + ' · ' + c.etiqueta;
    porEtiqueta.set(k, (porEtiqueta.get(k) || 0) + bytes);
  }
  [...porEtiqueta.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, b]) => {
    console.log(`  ${k.padEnd(34)} ${MB(b).padStart(10)}   ${(b / totalMes * 100).toFixed(0).padStart(3)}%`);
  });
  console.log(`  ${''.padEnd(34)} ${'─'.repeat(10)}`);
  console.log(`  ${'TOTAL del bucle de 5 s'.padEnd(34)} ${GB(totalMes).padStart(10)}   (el plan da 5 GB)`);
  console.log(`  ${'…de eso, SIN freno'.padEnd(34)} ${GB(totalMesSinFreno).padStart(10)}   ${(totalMesSinFreno / totalMes * 100).toFixed(0)}%`);

  console.log('\n── Veredicto ─────────────────────────────────────────────────');
  if (totalMes > 5 * 1073741824) {
    console.log('  ✗ Solo con el bucle ya se pasa de los 5 GB del plan.');
  } else {
    console.log(`  El bucle solo da ${GB(totalMes)}: si el panel marca más, hay otra fuente.`);
  }
  const ahorro = totalMesSinFreno - (preguntaVales.bytes * (HORAS * 3600 / 5) * DIAS * (gestores.length + 1));
  if (ahorro > 0) console.log(`  Poniéndoles el mismo freno que a los vales del admin se ahorrarían ~${GB(ahorro)} al mes.`);
})().catch(e => { console.error('FALLO:', e && e.message); process.exit(1); });
