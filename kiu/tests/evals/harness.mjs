/* tests/evals/harness.mjs — el arnés de evaluación del agente.
 *
 * Por qué existe
 * --------------
 * Los tests del repo comprueban que el CÓDIGO haga lo que el código hace.
 * Eso no dice NADA sobre si el agente elige la herramienta correcta: un
 * agente que siempre elige `now` pasa todos los tests y es inútil.
 *
 * Este arnés corre el bucle de verdad (kiu-agente.js) contra un MODELO
 * enchufable y mide lo único que importa:
 *
 *   · ACIERTO   — ¿la PRIMERA herramienta que eligió es la correcta?
 *   · PASOS     — ¿cuántos turnos tardó en llegar al resultado?
 *   · NO-OP     — ¿declaró que hizo algo sin haber hecho nada?
 *   · LATENCIA  — ¿cuánto tardó (ms)?
 *
 * Modelos disponibles
 * -------------------
 *   · `guion`   — un modelo GUIONIZADO: para cada pedido, devuelve las
 *                 decisiones escritas a mano. Sirve para probar el arnés
 *                 (un modelo perfecto, uno que se equivoca) y para correr
 *                 la suite sin red.
 *   · `http`    — un endpoint OpenAI-compatible (llama.cpp server, Ollama,
 *                 LM Studio) con la API_KEY del entorno. Es el que mide de
 *                 verdad. El arnés arma el prompt IGUAL que el agente (misma
 *                 función systemPrompt), así que lo que se mide es lo que
 *                 pasa en el teléfono.
 *
 * node --test tests/evals.test.mjs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { newSandbox, loadAll, runScript } from '../helpers.mjs';
import { ESCENARIOS, UMBRALES } from './escenarios.mjs';

const WWW = path.join(process.cwd(), 'app', 'src', 'main', 'assets', 'www');

/* ---------- un entorno donde las herramientas REALMENTE funcionan ----------
 * Si las herramientas fallan todas, el arnés mide un no-op y no dice nada
 * sobre la elección de herramienta. Por eso el entorno NO es de mentira:
 * se cargan la memoria real (js/app/memoria.js), la app real (app-ui.js) y el
 * cerebro real (brain.js). Lo único de mentira es el puente nativo (Java) y
 * la web, que se contestan con la misma forma que.EXPECT */
function entorno(op) {
  const sb = newSandbox();

  /* el puente nativo, de mentira: es lo que la app espera de Java */
  sb.KiuBridge = {
    setReminder: () => true,
    cancelReminder: () => true,
    addCalendarEvent: () => true,
    startTimerNative: () => true,
    sysInfo: () => JSON.stringify({
      cores: 8, ramTotal: 8000000000, ramAvail: 3000000000,
      diskTotal: 128000000000, diskFree: 40000000000,
      bat: 72, charging: false, temp: 31, model: 'Kiu Test', os: '14',
    }),
    contacts: () => JSON.stringify([
      { name: 'Ana', num: '+54 11 5555-1111' },
      { name: 'Juan', num: '+54 11 5555-2222' },
      { name: 'Mamá', num: '+54 11 5555-3333' },
    ]),
    calendarList: () => JSON.stringify([{ t: 'Turno dentista', b: Date.now() + 86400000, w: 'Clínica' }]),
    requestPerm: () => true,
    notifAccess: () => true,
    notifList: () => JSON.stringify([{ a: 'WhatsApp', t: 'Ana', x: '¿vamos a cenar?', w: Date.now() - 60000 }]),
    smsList: () => JSON.stringify([{ f: 'BANCO', x: 'Tu código es 123456', w: Date.now() - 120000 }]),
    locationGet: () => 'NONE',
    mediaKey: () => true,
    torch: () => true,
    dial: () => true,
    sms: () => true,
    share: () => true,
    openUrl: () => true,
    openApp: () => true,
    openSettings: () => true,
    maps: () => true,
    ytSearch: () => true,
  };

  /* la web: cada servicio con la forma de su respuesta real */
  sb.fetch = (url) => {
    const u = String(url);
    const json = (o) => Promise.resolve({ ok: true, json: () => Promise.resolve(o), text: () => Promise.resolve(JSON.stringify(o)) });
    if (u.includes('geocoding-api.open-meteo.com')) return json({ results: [{ name: 'Ciudad de prueba', country: 'AR', latitude: -31.4, longitude: -64.2 }] });
    if (u.includes('api.open-meteo.com')) return json({
      current: { temperature_2m: 21, weather_code: 1, wind_speed_10m: 9 },
      daily: { time: ['a', 'b', 'c'], weather_code: [1, 61, 3], temperature_2m_max: [24, 19, 22], temperature_2m_min: [12, 11, 13], precipitation_probability_max: [10, 80, 20] },
    });
    if (u.includes('r.jina.ai')) return Promise.resolve({ ok: true, text: () => Promise.resolve('Una nota de prueba con texto suficiente para que el resumen tenga de dónde sacar contenido real.') });
    return json({ AbstractText: 'Un resultado de prueba.', Heading: 'Fuente', AbstractURL: '' });
  };

  /* los módulos REALES, en el orden de index.html */
  loadAll(sb, [
    'js/kiu-migrate.js', 'js/i18n.js', 'js/brain.js', 'js/skills.js', 'js/react.js', 'js/tools.js',
    'js/kiu-estados.js', 'js/kiu-avatar.js', 'js/kiu-avatar-boot.js',
    'js/rag-worker.js', 'js/rag.js', 'js/kiu-secure.js',
    'js/app/env.js', 'js/app/memoria.js', 'js/app/state.js', 'js/app/catalog.js',
    'js/app/models.js', 'js/app/motor.js', 'js/app/app-ui.js',
  ]);

  /* el agente, encima */
  runScript(sb, 'js/kiu-agente.js', readFileSync(path.join(WWW, 'js', 'kiu-agente.js'), 'utf8'));
  runScript(sb, 'js/kiu-rutinas.js', readFileSync(path.join(WWW, 'js', 'kiu-rutinas.js'), 'utf8'));
  runScript(sb, 'js/kiu-autoprueba.js', readFileSync(path.join(WWW, 'js', 'kiu-autoprueba.js'), 'utf8'));

  /* una alarma real en la agenda, con el título que usa la persona */
  sb.localStorage.setItem('nexo_alarmas', JSON.stringify([
    { id: 'r1', title: 'desayunar', time: Date.now() + 3600000, date: 'Mañana 07:00' },
  ]));

  /* hay un documento indexado: search_docs tiene que poder encontrar algo.
     El RAG real usa IndexedDB (que el sandbox no tiene), así que se le da un
     `hits` con la misma forma. Lo que se evalúa es la ELECCIÓN de la
     herramienta, no el RAG. */
  sb.RAG.on = true;
  sb.RAG.hits = () => [{ name: 'contrato.pdf', txt: 'La cláusula 3 dice que el plazo es de 30 días.' }];

  /* el motor local "cargado": sin esto el bucle no arranca */
  if (op.S) sb.S = op.S;
  else {
    sb.S.kiu = { ok: true, name: op.modelName || 'Qwen3-1.7B-Q4_K_M.gguf' };
    sb.S.name = 'Sasha';
  }
  if (op.app) sb.KiuApp = op.app;
  if (op.brain) sb.KiuBrain = op.brain;
  if (op.rag) sb.RAG = op.rag;
  if (op.Kiu) sb.Kiu = op.Kiu;
  else sb.Kiu = { ask() { } };
  return { sb, puente: sb.KiuBridge };
}

/* ---------- cargar el agente en el entorno ---------- */
export function cargarAgente(over = {}) {
  const { sb, puente } = entorno(over);
  if (over.S) sb.S = over.S;
  if (over.app) sb.KiuApp = over.app;
  if (over.brain) sb.KiuBrain = over.brain;
  if (over.rag) sb.RAG = over.rag;
  if (over.Kiu) sb.Kiu = over.Kiu;
  else sb.Kiu = { ask() { } };
  return { A: sb.KiuAgente, ctx: sb, puente };
}

/* ---------- comparar los argumentos que pidió el modelo ---------- */
function coincide(valor, esperado) {
  if (esperado === undefined) return true;
  if (esperado instanceof RegExp) return esperado.test(String(valor == null ? '' : valor));
  return String(valor) === String(esperado);
}

function argsCoinciden(elegidos, esperados) {
  if (!esperados) return true;
  for (const k of Object.keys(esperados)) {
    if (!coincide(elegidos ? elegidos[k] : undefined, esperados[k])) return false;
  }
  return true;
}

/* ---------- el modelo GUIONIZADO ---------- */
export function modeloGuion(guiones) {
  /* La primera vez contesta la decisión; después dice "listo". Un modelo que
     repite la misma decisión para siempre es un bucle, no un agente. */
  const vistos = {};
  return async function (hist) {
    const pedido = (hist[hist.length - 1] || {}).content || '';
    const g = guiones[pedido];
    if (!g) return '{"listo":true}';
    if (typeof g === 'string') return g;
    const n = (vistos[pedido] = (vistos[pedido] || 0) + 1);
    return n <= g.length ? g[n - 1] : '{"listo":true}';
  };
}

/* ---------- el modelo HTTP (OpenAI-compatible) ---------- */
export function modeloHTTP(opts = {}) {
  const url = opts.url || process.env.KIU_EVAL_URL || 'http://127.0.0.1:8080/v1/chat/completions';
  const key = opts.key || process.env.KIU_EVAL_KEY || '';
  const modelo = opts.modelo || process.env.KIU_EVAL_MODEL || 'local-model';
  /* La gramática GBNF: en el teléfono el motor la aplica y por eso la
     decisión sale SIEMPRE con la forma correcta. Acá se puede medir con y
     sin ella: la diferencia es lo que aporta elizador nativo. */
  const gram = opts.grammar || null;
  /* la gramática se guarda EN LA FUNCIÓN DEVUELTA (no en la fábrica): si se
     guarda en la fábrica, el arnés (que la fija después) y la función (que la
     lee) no ven la misma variable y la gramática nunca viaja. */
  const f = async function (hist) {
    const cuerpo = { model: modelo, messages: hist, temperature: 0, max_tokens: 160 };
    const g2 = f.gramatica || gram;
    if (g2) cuerpo.grammar = typeof g2 === 'function' ? g2(hist) : g2;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(key ? { authorization: 'Bearer ' + key } : {}) },
      body: JSON.stringify(cuerpo),
    });
    if (!r.ok) throw new Error('el modelo respondió ' + r.status);
    const j = await r.json();
    return ((j.choices || [])[0] || {}).message?.content || '{"listo":true}';
  };
  f.__esHTTP = true;
  f.gramatica = null;
  return f;
}

/* ---------- leer una decisión cruda del modelo ---------- */
function leerDecision(txt) {
  try {
    const t = String(txt).replace(/```(?:json)?/gi, '').trim();
    const i = t.indexOf('{');
    if (i < 0) return null;
    return JSON.parse(t.slice(i));
  } catch (e) { return null; }
}

/* ---------- correr un escenario ---------- */
async function correrUno(A, ctx, esc, modelo) {
  const t0 = Date.now();
  const decisiones = [];

  /* el agente lee `window.Kiu` al empezar el turno: se le da el motor falso
     que consulta al modelo */
  ctx.Kiu = {
    ask(hist, maxT, cb) {
      Promise.resolve(modelo(hist)).then((txt) => {
        decisiones.push(String(txt));
        cb({ ok: true, text: txt });
      }, (e) => cb({ ok: false, err: String((e && e.message) || e) }));
    },
  };

  const res = await new Promise((r) => {
    A.run({ habla: [esc.pedido], componer: false }, r);
  });
  const ms = Date.now() - t0;

  /* ¿qué herramienta eligió primero? */
  let primera = null;
  let argsDeLaPrimera = null;
  for (const d of decisiones) {
    const o = leerDecision(d);
    if (!o) continue;
    const n = o.tool || o.herramienta || o.function || o.name;
    if (n && typeof n === 'string') {
      primera = n;
      argsDeLaPrimera = o.args || o.arguments || o.argumentos || {};
      break;
    }
  }
  const aceptadas = [esc.espera.tool].concat(esc.espera.acepta || []);
  const herramientaOk = !!primera && aceptadas.includes(primera);
  const argsOk = argsCoinciden(argsDeLaPrimera, esc.espera.args);

  return {
    id: esc.id,
    pedido: esc.pedido,
    primera: primera,
    acierto: herramientaOk && (!esc.espera.args || argsOk),
    herramientaOk,
    argsOk,
    pasos: res && res.steps ? res.steps : 0,
    noop: !(res && res.ok),
    ms,
    texto: res ? res.text : '',
  };
}

/* ---------- correr el juego entero ---------- */
export async function correrEscenarios(opts = {}) {
  const escenarios = opts.escenarios || ESCENARIOS;
  const { A, ctx } = cargarAgente(opts.over || {});
  /* si el modelo es HTTP y no se pasó una gramática, se usa la MISMA que arma
     el agente en el teléfono: la que sale del mismo esquema. */
  const modelo = opts.modelo || modeloGuion({});
  if (modelo && modelo.__esHTTP && opts.grammar !== false) {
    modelo.gramatica = (hist) => {
      const pedido = (hist[hist.length - 1] || {}).content || '';
      const sel = A.seleccionar(pedido);
      try { return A.grammar(sel, false); } catch (e) { return null; }
    };
  }
  const filas = [];
  for (const esc of escenarios) {
    filas.push(await correrUno(A, ctx, esc, modelo));
  }
  const total = filas.length;
  const aciertos = filas.filter((f) => f.acierto).length;
  const noops = filas.filter((f) => f.noop).length;
  const pasos = filas.reduce((a, f) => a + f.pasos, 0);
  return {
    filas,
    metricas: {
      total,
      aciertos,
      acierto: total ? aciertos / total : 0,
      noops,
      noop: total ? noops / total : 0,
      pasosPromedio: total ? pasos / total : 0,
      msPromedio: total ? Math.round(filas.reduce((a, f) => a + f.ms, 0) / total) : 0,
    },
  };
}

/* ---------- el reporte ---------- */
export function reporte(corrida, umbrales = UMBRALES) {
  const m = corrida.metricas;
  const lineas = [];
  lineas.push('id'.padEnd(22) + 'primera'.padEnd(24) + 'acierto  pasos  ms');
  for (const f of corrida.filas) {
    lineas.push(
      String(f.id).padEnd(22) +
      String(f.primera || '(ninguna)').padEnd(24) +
      (f.acierto ? '  sí  ' : '  NO  ') +
      String(f.pasos).padStart(4) + '  ' +
      String(f.ms).padStart(5)
    );
  }
  lineas.push('');
  lineas.push(`acierto: ${(m.acierto * 100).toFixed(0)}% (techo ${umbrales.acierto * 100}%) · ` +
    `pasos promedio: ${m.pasosPromedio.toFixed(2)} (tope ${umbrales.pasosMax}) · ` +
    `no-op: ${(m.noop * 100).toFixed(0)}% (tope ${umbrales.noopMax * 100}%) · ` +
    `latencia: ${m.msPromedio} ms`);
  const pasa = m.acierto >= umbrales.acierto && m.pasosPromedio <= umbrales.pasosMax && m.noop <= umbrales.noopMax;
  lineas.push(pasa ? 'ARNÉS: OK' : 'ARNÉS: FALLA (no cumple los umbrales)');
  return { texto: lineas.join('\n'), pasa };
}
