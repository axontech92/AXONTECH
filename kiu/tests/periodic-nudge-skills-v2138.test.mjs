import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WWW = path.join(HERE, '..', 'app', 'src', 'main', 'assets', 'www');
function load() {
  const store = new Map();
  const ctx = { window: {}, localStorage: { getItem:k=>store.has(k)?store.get(k):null, setItem:(k,v)=>store.set(k,String(v)), removeItem:k=>store.delete(k) },
    Math, Date, JSON, RegExp, String, Number, Array, Object, parseInt, parseFloat, isNaN };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(path.join(WWW,'js','skills.js'),'utf8'),ctx);
  return { K:ctx.window.KiuSkills, store };
}
test('receta procedural guarda solo palabras clave y secuencia de herramientas',()=>{
  const {K,store}=load();
  const r=K.recordRecipe('consulta calendario y busca documentos relacionados', ['read_calendar','search_docs','now']);
  assert.equal(r.ok,true);
  const recipe=K.recipeAll()[0];
  assert.deepEqual(Array.from(recipe.tool_sequence),['read_calendar','search_docs','now']);
  assert.ok(recipe.trigger_keywords.length >= 2);
  assert.equal(JSON.stringify(recipe).includes('documentos relacionados'),false,'no guarda el texto original de la tarea');
  assert.ok(store.has('kiu_procedural_recipes_v2138'));
});
test('receta exige tres pasos y rechaza nombres de herramienta inválidos',()=>{
  const {K}=load();
  assert.equal(K.recordRecipe('consulta calendario y busca documentos', ['read_calendar','search_docs']).ok,false);
  assert.equal(K.recordRecipe('consulta calendario y busca documentos', ['read_calendar','bad tool','now']).ok,false);
});
test('receta coincidente solo devuelve guía y puede borrarse',()=>{
  const {K}=load();
  K.recordRecipe('consulta calendario busca documentos relacionados', ['read_calendar','search_docs','now']);
  const hit=K.matchRecipe('busca documentos relacionados del calendario');
  assert.ok(hit);
  assert.deepEqual(Array.from(hit.tool_sequence),['read_calendar','search_docs','now']);
  assert.equal(K.clearRecipes(),true);
  assert.equal(K.recipeAll().length,0);
});
test('KIU registra recetas solo tras una ejecución completa con tres pasos exitosos',()=>{
  const src=readFileSync(path.join(WWW,'js','kiu-agente.js'),'utf8');
  assert.match(src,/successfulTools\.length >= 3/);
  assert.match(src,/!failedTools && successfulTools\.length >= 3/);
  assert.match(src,/RECETA PROCEDURAL APRENDIDA/);
  assert.match(src,/Regenera los argumentos con la petición actual/);
});
test('Periodic Nudge se dispara antes de descargar el modelo y reutiliza Comp sin borrar el historial',()=>{
  const job=readFileSync(path.join(HERE,'..','app','src','main','java','com','kiu','agent','KiuGenJob.java'),'utf8');
  const ui=readFileSync(path.join(WWW,'js','app','app-ui.js'),'utf8');
  assert.match(job,/IDLE_UNLOAD_MS - IDLE_NUDGE_LEAD_MS/);
  assert.match(job,/KiuMemoryNudge\.run\(\)/);
  assert.match(job,/IDLE_NUDGE_LEAD_MS, java\.util\.concurrent\.TimeUnit\.MILLISECONDS/);
  assert.match(ui,/window\.KiuMemoryNudge =/);
  assert.match(ui,/Comp\.apply\(hist\)/);
  assert.match(ui,/hist\.length <= 8/);
});
