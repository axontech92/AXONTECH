/* recomendar.test.mjs — v2.11.0: el recomendador según el teléfono (KiuReco.plan). */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { WWW } from './helpers.mjs';

const win = {};
const ctx = vm.createContext({ window: win, S: { dl: { done: {} } }, console });
vm.runInContext(readFileSync(path.join(WWW, 'js/app/catalog.js'), 'utf8'), ctx);
const { plan } = win.KiuReco;
const G = 1073741824;
const VIS = [
  { g: 'Visión', n: 'Qwen2.5-VL 3B', s: '2,3 GB', r: 4.0, u: 'u3' },
  { g: 'Visión', n: 'Qwen2.5-VL 7B', s: '5,5 GB', r: 7.6, u: 'u7' },
];
const dev = (ram, extra) => Object.assign({ ramTotal: ram * G, diskFree: 50 * G, cores: 8, model: 'T' }, extra || {});

test('sin RAM informada no inventa nada', () => {
  assert.equal(plan({}, {}).unknown, true);
});

test('3 GB: solo modelos chicos, nada pasa del criterio RAM-1', () => {
  const p = plan(dev(3), { vis: VIS });
  assert.equal(p.tier, 'baja');
  assert.ok(p.text.length >= 1);
  for (const t of p.text) assert.ok(t.c.r <= 2, t.c.n);
  assert.equal(p.vision.phone, null);
  assert.ok(p.notes.some((n) => /servidor|nube/.test(n)));
});

test('6 GB: la mejor calidad es la más grande que entra', () => {
  const p = plan(dev(6), { vis: VIS });
  assert.equal(p.tier, 'media');
  const q = p.text.find((t) => t.k === 'quality');
  assert.ok(q && q.c.r <= 5);
  for (const t of p.text) assert.ok(t.c.r <= q.c.r);
  assert.equal(p.vision.phone.n, 'Qwen2.5-VL 3B');
});

test('12 GB: sube a modelos de 8B y la visión de 7B entra en el teléfono', () => {
  const p = plan(dev(12), { vis: VIS });
  assert.equal(p.tier, 'alta');
  assert.ok(p.text.find((t) => t.k === 'quality').c.r >= 8);
  assert.equal(p.vision.phone.n, 'Qwen2.5-VL 7B');
  assert.ok(!p.text.some((t) => t.c.moe), 'el MoE de 18 GB no se recomienda');
});

test('pocos núcleos: no pasa de modelos chicos aunque sobre RAM', () => {
  const p = plan(dev(12, { cores: 4 }), { vis: VIS });
  for (const t of p.text) assert.ok(t.c.r <= 3.5, t.c.n);
  assert.ok(p.notes.some((n) => /núcleos/.test(n)));
});

test('poco espacio libre: excluye lo que no entra en disco y lo avisa', () => {
  const p = plan(dev(12, { diskFree: 1.2 * G }), { vis: VIS });
  for (const t of p.text) assert.ok(t.c.gb * 1.15 <= 1.2, t.c.n);
  const p2 = plan(dev(12, { diskFree: 0.3 * G }), { vis: VIS });
  assert.equal(p2.text.length, 0);
  assert.ok(p2.notes.some((n) => /espacio/.test(n)));
});

test('marca lo que ya está descargado y no repite modelos', () => {
  const base = plan(dev(6), { vis: VIS });
  const f = base.text[0].c.f;
  const p = plan(dev(6), { vis: VIS, done: { [f]: { b: 1 } } });
  assert.equal(p.text[0].done, true);
  const files = p.text.map((t) => t.c.f);
  assert.equal(new Set(files).size, files.length);
});

test('el botón y el método existen en la UI', () => {
  const html = readFileSync(path.join(WWW, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(WWW, 'js/app/app-ui.js'), 'utf8');
  assert.match(html, /id="dev-reco"/);
  assert.match(ui, /recomendar: function \(\)/);
  assert.match(ui, /getElementById\('dev-reco'\)/);
});

/* ---- v2.11.0: velocidad medida, batería/temperatura, avisos de descarga ---- */
test('un modelo medido como lento saca de la lista a los de su tamaño y mayores', () => {
  const base = plan(dev(12), { vis: VIS });
  const grande = base.text.find((t) => t.k === 'quality').c;
  const p = plan(dev(12), { vis: VIS, bench: { [grande.f]: { tps: 2.1 } } });
  for (const t of p.text) assert.ok(t.c.r < grande.r, t.c.n);
  assert.ok(p.notes.some((n) => /poca velocidad/.test(n)));
  assert.equal(p.measured.length, 1);
});

test('un modelo medido como fluido no cambia la recomendación', () => {
  const base = plan(dev(6), { vis: VIS });
  const q = base.text.find((t) => t.k === 'quality').c;
  const p = plan(dev(6), { vis: VIS, bench: { [q.f]: { tps: 14 } } });
  assert.equal(p.text.find((t) => t.k === 'quality').c.f, q.f);
});

test('teléfono caliente o con batería baja: lo avisa', () => {
  const p = plan(dev(8, { temp: 44, bat: 9, charging: false }), { vis: VIS });
  assert.ok(p.notes.some((n) => /caliente/.test(n)));
  assert.ok(p.notes.some((n) => /Batería/.test(n)));
  const ok = plan(dev(8, { temp: 30, bat: 90, charging: false }), { vis: VIS });
  assert.ok(!ok.notes.some((n) => /caliente|Batería/.test(n)));
});

test('KiuBench promedia las mediciones y guarda', () => {
  const calls = [];
  const w2 = {};
  const c2 = vm.createContext({ window: w2, S: {}, saveS: () => calls.push(1), console });
  vm.runInContext(readFileSync(path.join(WWW, 'js/app/catalog.js'), 'utf8'), c2);
  w2.KiuBench.rec('m.gguf', 10);
  w2.KiuBench.rec('m.gguf', 6);
  assert.equal(c2.S.bench['m.gguf'].tps, 8);
  w2.KiuBench.rec('m.gguf', 0);
  w2.KiuBench.rec('', 5);
  assert.equal(calls.length, 2);
});

test('descarga: el aviso salta con datos móviles, batería baja o calor', () => {
  const src = readFileSync(path.join(WWW, 'js/app/models.js'), 'utf8');
  assert.match(src, /guard: function \(item\)/);
  assert.match(src, /cn\.type === 'cellular'/);
  assert.match(src, /start: function \(item, skipGuard\)/);
  assert.match(src, /self\.start\(item, true\)/);
});
