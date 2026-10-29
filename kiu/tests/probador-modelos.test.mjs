import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const rd = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const ui = rd('app/src/main/assets/www/js/app/app-ui.js');
const state = rd('app/src/main/assets/www/js/app/state.js');
const proxy = rd('app/src/main/java/com/kiu/agent/KiuApiProxy.java');

test('NVIDIA está como proveedor y su host pertenece solo a su clave', () => {
  assert.match(state, /id: 'nvidia'[^}]*integrate\.api\.nvidia\.com\/v1/);
  assert.match(proxy, /\{"nvidia", "integrate\.api\.nvidia\.com"\}/);
});

test('hay botón de probar modelos y arranca solo al cargar una clave', () => {
  assert.match(ui, /data-act="scan"/);
  assert.match(ui, /scanProvider\(id, true\)/);
  assert.match(ui, /if \(a === 'scan'\)/);
});

test('el probador lista, descarta lo que no es chat y deja solo lo que responde', () => {
  const a = ui.indexOf('    scanProvider: function');
  const b = ui.indexOf('    /* ---------- v1.7.2: modelos disponibles');
  const body = ui.slice(a, b).trim().replace(/,\s*$/, '');
  const nc = ui.match(/NOCHAT: (\/.*\/i),/)[1];
  const toasts = [];
  const st = { url: 'https://api.test/v1', model: 'viejo-que-no-existe', ok: false };
  const factory = new Function('toasts', 'pstate', 'provDef', 'hasKey', 'saveS', 'esc', 'fetch', 'performance', 'AbortController',
    'return {' + body + ', NOCHAT: ' + nc + ', scan: {}, provHeaders(){return {};}, apiErr(s){return "error "+s;}, renderProviders(){}, renderStatus(){}, paintScan(){}, toast(t){toasts.push(t);} }');
  const calls = [];
  const fakeFetch = async (url, init) => {
    if (url.endsWith('/models')) return { ok: true, status: 200, json: async () => ({ data: [{ id: 'meta/llama-3.3-70b' }, { id: 'nvidia/nv-embed-v1' }, { id: 'models/gemini-flash' }, { id: 'mistral/malo' }, { id: 'qwen/saturado' }, { id: 'openai/whisper-large' }] }) };
    const m = JSON.parse(init.body).model; calls.push(m);
    if (m.includes('malo')) return { ok: false, status: 404 };
    if (m.includes('saturado')) return { ok: false, status: 429 };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
  };
  const o = factory(toasts, () => st, () => ({ id: 'x', name: 'Test', local: false }), () => true, () => {}, (s) => s, fakeFetch, { now: () => Date.now() }, AbortController);
  return o.scanProvider('x', false) || new Promise((r) => setTimeout(r, 300)).then(() => {
    assert.ok(!calls.some((m) => /embed|whisper/.test(m)), 'no prueba embeddings ni audio');
    const buenos = st.good.map((g) => g.m).sort();
    assert.deepEqual(buenos, ['gemini-flash', 'meta/llama-3.3-70b', 'qwen/saturado']);
    assert.ok(!buenos.includes('mistral/malo'));
    assert.ok(buenos.includes(st.model), 'el modelo viejo que no existe se reemplaza por uno que sí funciona');
    assert.equal(st.ok, true);
  });
});
