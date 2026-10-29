import test from 'node:test';
import assert from 'node:assert/strict';
import { newSandbox, loadAll } from './helpers.mjs';
test('perfil Hermes 2 detecta nombres conocidos y no inventa URL de descarga',()=>{
  const sb=newSandbox();
  loadAll(sb,['js/kiu-migrate.js','js/i18n.js','js/brain.js','js/skills.js','js/react.js','js/tools.js','js/kiu-agente.js','js/kiu-estados.js','js/kiu-avatar.js','js/kiu-avatar-boot.js','js/local-embeddings.js','js/rag-worker.js','js/rag.js','js/kiu-secure.js','js/app/env.js','js/app/state.js','js/app/catalog.js']);
  assert.equal(sb.guessFam('Nous-Hermes-2-Pro-Llama-3-8B-Q4_K_M.gguf'),'hermes');
  assert.equal(sb.hermesProfile('Nous-Hermes-2-Pro-Llama-3-8B-Q4_K_M.gguf').format,'hermes2-tool-call');
  assert.equal(sb.hermesProfile('Hermes-2-Theta-Llama-3-8B-Q4_K_M.gguf').id,'hermes-2-theta');
  assert.equal(sb.hermesProfile('un modelo cualquiera.gguf'),null);
  assert.ok(sb.HERMES_PROFILES.every(p=>!Object.hasOwn(p,'url')&&!Object.hasOwn(p,'sha')));
});
test('decisión Hermes <tool_call> se parsea, valida y respeta gramática generada por herramientas',()=>{
  const sb=newSandbox();
  loadAll(sb,['js/kiu-migrate.js','js/i18n.js','js/brain.js','js/skills.js','js/react.js','js/tools.js','js/kiu-agente.js']);
  const A=sb.KiuAgente;
  const t=A.get('now');
  assert.ok(t);
  const d=A.parseDecision('<tool_call>{"name":"now","arguments":{}}</tool_call>');
  assert.equal(d.name,'now');
  const rd=A.readDecision(d);
  assert.equal(rd.name,'now');
  assert.equal(A.validate(rd.name,rd.raw).ok,true);
  const grammar=A.grammar(A.seleccionar('qué hora es'),true);
  assert.match(grammar,/tool_call/);
  assert.match(grammar,/now/);
});
test('prompt de Hermes exige wrapper de llamada en lugar de JSON genérico',()=>{
  const sb=newSandbox();
  loadAll(sb,['js/kiu-migrate.js','js/i18n.js','js/brain.js','js/skills.js','js/react.js','js/tools.js','js/kiu-agente.js']);
  const p=sb.KiuAgente.systemPrompt('qué hora es',sb.KiuAgente.seleccionar('qué hora es'),[],false,false,true);
  assert.match(p,/<tool_call>/);
  assert.match(p,/Respondé SOLO con una llamada Hermes/);
});
