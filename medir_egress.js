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

  const preguntaNotifs = await pesar(`/meta?select=name&name=eq.notifs&updated_at=gt.${encodeURIComponent(futuro)}&limit=1`);
  const notifs = await pesar('/meta?select=data&name=eq.notifs');
  console.log(`  "¿hay avisos nuevos?"       ${String(preguntaNotifs.bytes).padStart(7)} B   (con freno desde v114 ✓)`);
  console.log(`  bajar notifs ENTERO        ${String(notifs.bytes).padStart(7)} B   ← solo cuando la pregunta dice que sí`);
  // Lo que cuesta el bucle EN RÉGIMEN es la pregunta, no la bajada. La bajada
  // solo ocurre cuando de verdad hay un aviso nuevo.
  anotar('admin', '¿hay avisos nuevos?', preguntaNotifs.bytes, 5, true);

  // ══════════════════════════════════════════════════════
  //  2. EL BUCLE DE 5 SEGUNDOS — CAMINO DEL GESTOR
  // ══════════════════════════════════════════════════════
  console.log('\n── Cada 5 s · teléfono de CADA GESTOR ────────────────────────');
  let peorGestor = 0, totalGestores = 0;
  for (const g of gestores) {
    const gid = encodeURIComponent(String(g.id));
    const completa = await pesar(`/vales?select=data&data->>gestorId=eq.${gid}`);
    const pregunta = await pesar(`/vales?select=id&data->>gestorId=eq.${gid}&updated_at=gt.${encodeURIComponent(futuro)}&limit=1`);
    const filas = JSON.parse(completa.texto).length;
    if (!filas) continue;   // sin vales no hay nada que contar
    // Sin nombres: solo el número de gestor por orden de aparición.
    console.log(`  gestor #${String(gestores.indexOf(g) + 1).padEnd(2)} · ${String(filas).padStart(3)} vales   pregunta ${String(pregunta.bytes).padStart(5)} B  ·  bajada completa ${String(completa.bytes).padStart(7)} B`);
    peorGestor = Math.max(peorGestor, completa.bytes);
    totalGestores += completa.bytes;
    // v114: en régimen solo se paga la pregunta. La bajada completa quedó para
    // el arranque y para la red de seguridad de cada 5 minutos.
    anotar('gestor', `pregunta del gestor #${gestores.indexOf(g) + 1}`, pregunta.bytes, 5, true);
    anotar('gestor', `bajada de seguridad #${gestores.indexOf(g) + 1}`, completa.bytes, 300, true);
    anotar('gestor', '¿hay avisos nuevos?', preguntaNotifs.bytes, 5, true);
  }
  console.log(`  (antes de v114 la "bajada completa" iba cada 5 s, cambiara algo o no)`);

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
    if (totalMesSinFreno > 0) console.log(`    ${GB(totalMesSinFreno)} de eso vienen de llamadas SIN freno — ahí está el problema.`);
  } else {
    console.log(`  ✓ El bucle da ${GB(totalMes)} de los 5 GB del plan.`);
    console.log('    (con TODOS los gestores conectados a la vez la jornada entera:');
    console.log('     en la práctica será bastante menos)');
  }
  // Lo que costaría sin los frenos de v103/v112/v114, para ver el antes y el después.
  let sinFrenos = 0;
  const pasadasMes = (HORAS * 3600 / 5) * DIAS;
  sinFrenos += notifs.bytes * pasadasMes * (gestores.length + 1);
  sinFrenos += totalGestores * pasadasMes;
  console.log(`\n  Sin los frenos, lo mismo costaría ${GB(sinFrenos)} al mes.`);
})().catch(e => { console.error('FALLO:', e && e.message); process.exit(1); });
