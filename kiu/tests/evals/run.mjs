/* tests/evals/run.mjs — correr el arnés de evaluación contra un modelo REAL.
 *
 * Uso:
 *   node tests/evals/run.mjs                       # modelo HTTP (ver abajo)
 *   node tests/evals/run.mjs --guion               # modelo guionizado (sin red)
 *   node tests/evals/run.mjs --url http://host:8080/v1/chat/completions
 *
 * Variables de entorno:
 *   KIU_EVAL_URL    endpoint OpenAI-compatible. Por defecto
 *                   http://127.0.0.1:8080/v1/chat/completions (llama.cpp server)
 *   KIU_EVAL_MODEL  nombre del modelo. Por defecto "local-model"
 *   KIU_EVAL_KEY    API key, si el endpoint la pide
 *
 * El endpoint tiene que ser un servidor OpenAI-compatible con el MISMO
 * formato de chat que usa Kiu. Para probar con un GGUF local:
 *
 *   llama-server -m modelo.gguf --port 8080
 *   node tests/evals/run.mjs --url http://127.0.0.1:8080/v1/chat/completions
 *
 * Sale con código 1 si el arnés no cumple los umbrales: así puede ir en el CI.
 */
import { correrEscenarios, reporte, modeloGuion, modeloHTTP } from './harness.mjs';
import { ESCENARIOS } from './escenarios.mjs';

const args = process.argv.slice(2);
const arg = (n) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
};

let modelo;
let conGram = !args.includes('--sin-gramatica');
if (args.includes('--guion')) {
  /* el modelo perfecto: sirve para ver que el arnés y el entorno funcionan */
  const g = {};
  for (const s of ESCENARIOS) g[s.pedido] = [JSON.stringify({ tool: s.espera.tool, args: s.ejemplo || {} }), '{"listo":true}'];
  modelo = modeloGuion(g);
  console.log('modo guionizado (el modelo "perfecto"): mide el arnés, no al modelo.\n');
} else {
  modelo = modeloHTTP({
    url: arg('--url') || undefined,
    key: arg('--key') || undefined,
    modelo: arg('--model') || undefined,
    grammar: conGram ? true : null,
  });
  console.log('modo HTTP: ' + (arg('--url') || process.env.KIU_EVAL_URL || 'http://127.0.0.1:8080/v1/chat/completions'));
  console.log('gramática GBNF: ' + (conGram ? 'SÍ (como en el teléfono)' : 'no (el modelo solo)'));
  console.log('modelo: ' + (arg('--model') || process.env.KIU_EVAL_MODEL || 'local-model') + '\n');
}

try {
  const corrida = await correrEscenarios({ modelo, grammar: conGram });
  const r = reporte(corrida);
  console.log(r.texto);
  process.exit(r.pasa ? 0 : 1);
} catch (e) {
  console.error('el arnés no pudo correr: ' + (e && e.message ? e.message : e));
  console.error('¿Hay un servidor OpenAI-compatible en la dirección de KIU_EVAL_URL?');
  process.exit(2);
}
