import test from 'node:test';
import assert from 'node:assert/strict';
import { newSandbox, loadAll } from './helpers.mjs';

function boot() {
  const sb = newSandbox();
  loadAll(sb, ['js/app/harness2-compose.js']);
  return sb;
}

test('Harness² elige perfil local por defecto y perfil cloud solo con señal explícita', () => {
  const sb = boot();
  const local = sb.KiuHarness2.choose({ modelName: 'Hermes 2 Pro' });
  assert.equal(local.id, 'Harness-Local-Compact');
  assert.equal(local.maxTokens, 120);
  assert.equal(local.modelFamily, 'hermes');
  const cloud = sb.KiuHarness2.choose({ provider: 'cloud' });
  assert.equal(cloud.id, 'Harness-Cloud-Rich');
  assert.equal(cloud.maxTokens, 180);
});

test('Harness² restablece el contador tras éxito y vuelve al perfil seguro tras dos fallos', () => {
  const sb = boot();
  sb.KiuHarness2.choose({ provider: 'cloud' });
  sb.KiuHarness2.record(false, 'JSON parse');
  assert.equal(sb.KiuHarness2.status().consecutiveFailures, 1);
  sb.KiuHarness2.record(true, 'validated');
  assert.equal(sb.KiuHarness2.status().consecutiveFailures, 0);
  sb.KiuHarness2.choose({ provider: 'cloud' });
  sb.KiuHarness2.record(false, 'generation');
  const rolled = sb.KiuHarness2.record(false, 'grammar');
  assert.equal(rolled.id, 'Harness-Local-Compact');
  assert.equal(rolled.maxTokens, 120);
  assert.equal(rolled.consecutiveFailures, 0);
  assert.equal(rolled.lastReason, 'grammar');
});

test('Harness² no guarda el contenido de errores ni datos de la petición', () => {
  const sb = boot();
  sb.KiuHarness2.record(false, 'JSON parse: usuario@example.com prompt secreto');
  const saved = sb.localStorage.getItem(sb.KiuHarness2.key);
  assert.ok(saved);
  assert.equal(saved.includes('usuario@example.com'), false);
  assert.equal(saved.includes('prompt secreto'), false);
});

test('Harness² compacto reduce manifiesto sin quitar nombres ni argumentos', () => {
  const sb = newSandbox();
  loadAll(sb, ['js/kiu-migrate.js', 'js/i18n.js', 'js/brain.js', 'js/skills.js', 'js/react.js', 'js/tools.js', 'js/app/harness2-compose.js', 'js/kiu-agente.js']);
  const A = sb.KiuAgente;
  const names = A.toolNames().slice(0, 4);
  const full = A.manifest(names, false);
  const compact = A.manifest(names, true);
  assert.ok(compact.length < full.length, `compact=${compact.length}, full=${full.length}`);
  for (const name of names) assert.ok(compact.includes(name));
  assert.ok(compact.includes('('));
});

test('Hermes 2: la gramática restringe tool_call y el parser recupera name/arguments', () => {
  const sb = newSandbox();
  loadAll(sb, ['js/kiu-migrate.js', 'js/i18n.js', 'js/brain.js', 'js/skills.js', 'js/react.js', 'js/tools.js', 'js/app/harness2-compose.js', 'js/kiu-agente.js']);
  const A = sb.KiuAgente;
  const names = A.toolNames();
  const chosen = names.find(n => A.get(n) && Object.keys(A.get(n).args || {}).length > 0);
  assert.ok(chosen);
  const grammar = A.grammar([chosen], true);
  assert.ok(grammar.includes('<tool_call>{\\"name\\":\\"' + chosen));
  assert.ok(grammar.includes('}}</tool_call>'));
  const d = A.parseDecision('<tool_call>{"name":"' + chosen + '","arguments":{}}</tool_call>');
  const rd = A.readDecision(d);
  assert.equal(rd.name, chosen);
  assert.deepEqual(JSON.parse(JSON.stringify(rd.raw)), {});
});
