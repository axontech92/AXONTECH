/* boot.test.mjs — tanda 4 (sección 3-a): simulación de arranque completo.
 * Carga TODOS los scripts de la UI en el mismo orden que index.html dentro
 * de una VM con DOM/localStorage falsos, y verifica que:
 *   1) ningún módulo rompe por símbolos cross-módulo (ReferenceError),
 *   2) los objetos públicos (App, Kiu, Mod, S, RAG, Brain…) quedan expuestos,
 *   3) App.init() corre sin ReferenceErrors (los artefactos del DOM falso se
 *      toleran, pero un ReferenceError de un símbolo extraído es un fallo real).
 * tanda 8: el arnés (DOM falso + sandbox) vive en tests/helpers.mjs.
 * node --test tests/boot.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { newSandbox, loadAll } from './helpers.mjs';

const SCRIPTS = [
  'js/kiu-migrate.js',
  'js/i18n.js',
  'js/brain.js',
  'js/skills.js',
  'js/react.js',
  'js/tools.js',
  'js/kiu-agente.js',
  'js/kiu-rutinas.js',
  'js/kiu-autoprueba.js',
  'js/kiu-estados.js',
  'js/kiu-avatar.js',
  'js/kiu-avatar-boot.js',
  'js/rag-worker.js',
  'js/rag.js',
  'js/kiu-secure.js',
  'js/app/env.js',
  'js/app/memoria.js',
  'js/app/state.js',
  'js/app/catalog.js',
  'js/app/models.js',
  'js/app/motor.js',
  'js/app/diag-voz.js',
  'js/app/app-ui.js',
];

/* símbolos que DEBEN existir tras la carga (cross-módulo en window) */
const MUST_EXIST = {
  App: 'object', KiuApp: 'object', KiuMem: 'object',
  S: 'object', saveS: 'function', PERSONAS: 'object', PROV: 'object',
  provDef: 'function', hasKey: 'function', Sec: 'object',
  convList: 'function', ensureConv: 'function', saveHist: 'function',
  MODCAT: 'object', modKind: 'function', prettyName: 'function',
  Mod: 'object', Imp: 'object',
  Kiu: 'object', Comp: 'object', Rtr: 'object', Orch: 'object', KB: 'object',
  icon: 'function', esc: 'function', store: 'function', bridge: 'function',
  KiuBrain: 'object', KiuTools: 'object', RAG: 'object',
  KiuSkills: 'object', KiuReAct: 'object', KiuAgente: 'object',
  KiuRagCore: 'object', KiuI18n: 'object', KiuAvatarBoot: 'object',
  KiuState: 'object', KiuSettings: 'object',
};

test('todos los módulos cargan en orden sin ReferenceError', () => {
  const sb = newSandbox();
  loadAll(sb, SCRIPTS); // si un módulo tira ReferenceError, acá explota y el test falla
  for (const [sym, kind] of Object.entries(MUST_EXIST)) {
    assert.equal(typeof sb[sym], kind, `window.${sym} debería ser ${kind} tras la carga`);
  }
});

test('la app expone App y los alias viejos de compatibilidad', () => {
  const sb = newSandbox();
  loadAll(sb, SCRIPTS);
  assert.equal(sb.App, sb.KiuApp, 'window.App debe ser el mismo objeto que window.KiuApp');
  assert.equal(typeof sb.App.init, 'function');
  assert.equal(typeof sb.App.sendMsg, 'function');
  assert.equal(typeof sb.App.go, 'function');
});

test('App.init() corre con DOM falso sin ReferenceError de símbolos del split', () => {
  const sb = newSandbox();
  loadAll(sb, SCRIPTS);
  const refErrors = [];
  try {
    vm.runInContext('App.init(); window.__kiuBooted = true;', sb, { filename: 'boot-inline.js' });
  } catch (e) {
    const isRef = e instanceof ReferenceError;
    const st = (e && e.stack) ? String(e.stack).split('\n').slice(0, 4).join('\n') : '';
    refErrors.push((isRef ? '' : 'NO-REF: ') + String(e) + (st ? '\n' + st : ''));
  }
  const splitSyms = Object.keys(MUST_EXIST).join('|');
  const bad = refErrors.filter((m) => new RegExp(`\\b(${splitSyms})\\b`).test(m));
  assert.deepEqual(bad, [], `ReferenceErrors de símbolos del split: ${bad.join(' ; ')}`);
  assert.ok(sb.__kiuBooted, 'App.init debió completar con el DOM falso; errores: ' + refErrors.join(' | '));
});

test('los estados y módulos del motor quedan operables (smoke de API)', () => {
  const sb = newSandbox();
  loadAll(sb, SCRIPTS);
  // state
  assert.equal(typeof sb.S.mode, 'string', 'S.mode debe existir en los defaults');
  sb.S.fakeKey = 1; // mutación sobre el singleton compartido
  assert.equal(sb.window.S.fakeKey, 1);
  // catalog
  assert.ok(Array.isArray(sb.MODCAT) && sb.MODCAT.length >= 10, 'MODCAT con su catálogo');
  assert.equal(sb.modKind('algo-mmproj.gguf'), 'mmproj');
  // motor
  assert.equal(typeof sb.Kiu.isLoaded, 'function');
  assert.equal(sb.Rtr.classify('escribí una function de javascript'), 'code');
  // modelos
  assert.equal(typeof sb.Mod.sync, 'function');
  assert.equal(typeof sb.Mod.done, 'function');
  // brain sigue respondiendo (integración mínima)
  const r = sb.KiuBrain.reply('cuanto es 2 x 3');
  assert.ok(r && typeof r.text === 'string');
});
