#!/usr/bin/env node
/**
 * AXONTECH · ¿Funciona de verdad el freno de tráfico de v103?
 *
 * v103 cambió _doRestPoll para preguntar "¿hay algo más nuevo?" con una
 * consulta mínima antes de bajar una tabla entera. Antes de darlo por bueno
 * —sobre todo después de haber metido la pata con el orden de comisiones esta
 * misma tarde— esto se comprueba contra Supabase de verdad:
 *   1. ¿updated_at existe y se puede leer con la clave pública?
 *   2. ¿el filtro `updated_at=gt.X` de PostgREST hace lo que se espera?
 *   3. ¿cuánto pesaba cada pasada ANTES, y cuánto pesa la pregunta AHORA?
 */
const fs = require('fs');
const JS = fs.readFileSync(__dirname + '/app.js', 'utf8');
const url = /SUPABASE_URL\s*=\s*'([^']+)'/.exec(JS)[1] + '/rest/v1';
const key = /SUPABASE_(?:KEY|ANON_KEY)\s*=\s*'([^']+)'/.exec(JS)[1];
const hdrs = { apikey: key, Authorization: 'Bearer ' + key };

async function medir(nombre, ruta) {
  const t0 = Date.now();
  const r = await fetch(url + ruta, { headers: hdrs });
  const texto = await r.text();
  const ms = Date.now() - t0;
  console.log(`  ${nombre.padEnd(38)} HTTP ${r.status} · ${(texto.length / 1024).toFixed(1)} KB · ${ms} ms`);
  return { status: r.status, bytes: texto.length, texto };
}

(async () => {
  console.log('=== 1) ¿updated_at se puede leer? ===');
  const r1 = await medir('vales?select=id,updated_at&limit=3', '/vales?select=id,updated_at&limit=3');
  const filas = JSON.parse(r1.texto);
  console.log('  muestra:', JSON.stringify(filas));
  if (!filas.length || filas[0].updated_at == null) {
    console.log('  ✗ updated_at no viene en la respuesta — el freno NO puede funcionar así.');
    process.exit(1);
  }
  console.log('  ✓ updated_at está y se puede leer.\n');

  console.log('=== 2) ¿el filtro gt. funciona como se espera? ===');
  // Tomamos el updated_at más antiguo de la muestra: TODO lo demás debería
  // contar como "más nuevo que eso".
  const tsAntiguo = filas.map(f => f.updated_at).sort()[0];
  const r2 = await medir(`vales?select=id&updated_at=gt.${encodeURIComponent(tsAntiguo)}&limit=1  (debe encontrar algo)`,
    `/vales?select=id&updated_at=gt.${encodeURIComponent(tsAntiguo)}&limit=1`);
  const encontro = JSON.parse(r2.texto).length > 0;
  console.log('  ¿encontró algo más nuevo que', tsAntiguo, '?', encontro ? 'sí ✓' : 'NO ✗ (raro, revisar)');

  const futuro = new Date(Date.now() + 3600000).toISOString(); // dentro de una hora
  const r3 = await medir(`vales?select=id&updated_at=gt.${encodeURIComponent(futuro)}&limit=1  (NO debe encontrar nada)`,
    `/vales?select=id&updated_at=gt.${encodeURIComponent(futuro)}&limit=1`);
  const vacio = JSON.parse(r3.texto).length === 0;
  console.log('  ¿vacío al preguntar por algo del futuro?', vacio ? 'sí ✓' : 'NO ✗ (el filtro no hace lo que debería)');

  console.log('\n=== 3) tamaño real: pregunta mínima vs. tabla entera ===');
  const completa = await medir('vales?select=data  (lo que se bajaba ANTES cada 5 s)', '/vales?select=data');
  const pregunta = await medir('vales?select=id&updated_at=gt.<algo futuro>&limit=1  (lo que se pregunta AHORA)',
    `/vales?select=id&updated_at=gt.${encodeURIComponent(futuro)}&limit=1`);
  const factor = (completa.bytes / Math.max(1, pregunta.bytes)).toFixed(0);
  console.log(`\n  Antes: ${(completa.bytes/1024).toFixed(1)} KB cada 5 s.`);
  console.log(`  Ahora, cuando no cambió nada: ${pregunta.bytes} B cada 5 s (${factor}× más pequeño).`);
  const porDia5s = completa.bytes * (86400 / 5) / 1024 / 1024;
  console.log(`  Un teléfono con esto abierto 24 h bajaba hasta ${porDia5s.toFixed(0)} MB/día solo de vales.`);

  console.log('\n=== 4) lo mismo para productos (los más pesados, con fotos) ===');
  const prodCompleto = await medir('productos?select=data  (lo que se bajaba cada 5 min)', '/productos?select=data');
  const prodPregunta = await medir('productos?select=id&updated_at=gt.<futuro>&limit=1',
    `/productos?select=id&updated_at=gt.${encodeURIComponent(futuro)}&limit=1`);
  console.log(`\n  Antes: ${(prodCompleto.bytes/1024).toFixed(1)} KB cada 5 min.`);
  console.log(`  Ahora, sin cambios: ${prodPregunta.bytes} B cada 5 min.`);

  const ok = filas.length && filas[0].updated_at != null && encontro && vacio;
  console.log('\n' + (ok
    ? '✅ El mecanismo funciona: updated_at existe, el filtro responde bien, y el ahorro es real.'
    : '❌ Algo no cuadra arriba — no dar esto por bueno sin revisarlo.'));
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('✗', e.message); process.exit(1); });
