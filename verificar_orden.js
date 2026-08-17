#!/usr/bin/env node
/**
 * AXONTECH · ¿Ordena de verdad el panel de gestores?
 *
 * Se lanza desde Actions. NO reimplementa nada: saca de app.js las funciones de
 * verdad —las mismas que corren en el teléfono— y las ejecuta contra los datos
 * reales de Supabase. Así la respuesta no depende de que yo haya entendido bien
 * el código.
 *
 * Nació el 17/08/2026 después de perder medio día suponiendo. Primero repliqué
 * el cálculo de comisiones en Python y me salieron cifras que NO coincidían con
 * las de la app ($100 donde la app enseña $185), así que la conclusión que saqué
 * de ellas no valía nada. La lección: si hay que comprobar qué hace un código,
 * se ejecuta ese código, no una versión mía de ese código.
 *
 * ⚠ El repositorio es público: aquí no se imprime ningún nombre. Cada gestor
 * sale como su inicial y su posición.
 */

const fs = require('fs');
const path = require('path');

const RAIZ = __dirname;
const JS = fs.readFileSync(path.join(RAIZ, 'app.js'), 'utf8');

function credenciales() {
  const url = /SUPABASE_URL\s*=\s*'([^']+)'/.exec(JS);
  const key = /SUPABASE_(?:KEY|ANON_KEY)\s*=\s*'([^']+)'/.exec(JS);
  if (!url || !key) { console.error('✗ no se encontraron las credenciales en app.js'); process.exit(1); }
  return { base: url[1] + '/rest/v1', key: key[1] };
}

async function traer(base, key, ruta) {
  const r = await fetch(base + ruta, { headers: { apikey: key, Authorization: 'Bearer ' + key } });
  if (!r.ok) throw new Error(`${ruta} → HTTP ${r.status}`);
  return r.json();
}

/** Saca el texto de una función de app.js, con llaves balanceadas. */
function extraer(nombre) {
  const i = JS.search(new RegExp(`function\\s+${nombre}\\s*\\(`));
  if (i === -1) throw new Error(`no se encontró la función ${nombre} en app.js`);
  let prof = 0, dentro = false;
  for (let j = i; j < JS.length; j++) {
    const c = JS[j];
    if (c === '{') { prof++; dentro = true; }
    else if (c === '}') { prof--; if (dentro && prof === 0) return JS.slice(i, j + 1); }
  }
  throw new Error(`no se pudo cerrar la función ${nombre}`);
}

function filasA(lista) {
  const out = [];
  for (const f of lista) {
    const d = f.data;
    if (d && typeof d === 'object' && !Array.isArray(d)) {
      if (d.id != null) out.push(d);
      else for (const v of Object.values(d)) if (v && typeof v === 'object' && v.id != null) out.push(v);
    }
  }
  return out;
}

(async () => {
  const { base, key } = credenciales();
  console.log('AXONTECH · ejecutando el código REAL de app.js contra los datos reales\n');

  const [fg, fv, fp] = await Promise.all([
    traer(base, key, '/gestores?select=data'),
    traer(base, key, '/vales?select=data'),
    traer(base, key, '/productos?select=data'),
  ]);
  const gestores = filasA(fg), vales = filasA(fv), productos = filasA(fp);
  console.log(`gestores: ${gestores.length} · vales: ${vales.length} · productos: ${productos.length}\n`);

  // Las funciones de las que dependen las de comisiones. Se toman de app.js
  // cuando existen como función declarada; si no, se pone el equivalente mínimo.
  // getProductos() normaliza cada producto al leerlo (rellena precio desde
  // precioActual, comisionMoneda, etc.) y el cálculo de comisiones depende de
  // esos campos. Sin normalizar, este banco de pruebas daba cifras más bajas que
  // la app y me llevó a una conclusión equivocada. Se normaliza igual que allí.
  let mapaProd = new Map();
  const contexto = {
    getVales: () => vales,
    getProductos: () => productos,
    productoOf: id => mapaProd.get(id),
    console,
  };

  const fuentes = ['_normalizeProducto', 'parsePrecioNum', 'getValeCommissionParts', 'sumCommissions',
                   'fmtComisionBadge', 'comisionPendienteDe', '_cmpComisionPendiente'];
  let codigo = '';
  for (const n of fuentes) {
    try { codigo += extraer(n) + '\n'; }
    catch (e) { console.log(`  ⚠ ${e.message}`); }
  }

  const nombres = Object.keys(contexto);
  const fn = new Function(...nombres, codigo + `
    return { _normalizeProducto, comisionPendienteDe, _cmpComisionPendiente, sumCommissions, fmtComisionBadge };
  `);
  const api = fn(...nombres.map(n => contexto[n]));
  productos.forEach(api._normalizeProducto);
  mapaProd = new Map(productos.map(p => [p.id, p]));

  // El mismo orden que aplica renderAdminGestoresList: alfabético y luego por
  // comisión pendiente (Array.sort es estable, así que el alfabético desempata).
  const colador = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
  const alfabetico = gestores.slice().sort((a, b) => colador.compare(a.name || '', b.name || ''));
  const ordenado = alfabetico.slice().sort(api._cmpComisionPendiente);

  console.log('Lo que calcula el código para cada gestor (en orden alfabético):');
  for (const g of alfabetico) {
    const c = api.comisionPendienteDe(g.id);
    const badge = api.fmtComisionBadge(c.usd, c.mn, c.computed);
    console.log(`  ${String(g.name || '?')[0]}… → usd=${c.usd} mn=${c.mn} computed=${c.computed} · chapa: ${badge || 'Sin comisiones'}`);
  }

  console.log('\nOrden que DEBERÍA salir en el panel (de arriba abajo):');
  ordenado.forEach((g, i) => {
    const c = api.comisionPendienteDe(g.id);
    console.log(`  ${i + 1}. ${String(g.name || '?')[0]}… → $${c.usd} USD + ${c.mn} MN`);
  });

  const cambia = ordenado.some((g, i) => g.id !== alfabetico[i].id);
  console.log('\n' + (cambia
    ? '✅ El orden por comisión SÍ cambia la lista respecto al alfabético.'
    : '❌ El orden por comisión NO cambia nada: el fallo está en el código, no en el teléfono.'));
})().catch(e => { console.error('✗', e.message); process.exit(1); });
