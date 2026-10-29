/* i18n.test.mjs — tanda 8: fundación i18n (js/i18n.js).
 * Verifica: español como identidad (t → null), diccionario inglés,
 * setLang persiste en nexo_settings y en S, apply() traduce [data-i18n]
 * y [data-i18n-ph], claves faltantes hacen fallback al español, y el
 * evento 'kiu-lang' se dispara para refrescar la UI dinámica.
 * node --test tests/i18n.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(path.join(here, '..', 'app', 'src', 'main', 'assets', 'www', 'js', 'i18n.js'), 'utf8');

/* DOM mínimo con elementos que conservan textContent/placeholder */
function makeEl(attrs) {
  return {
    attrs: Object.assign({}, attrs),
    textContent: '',
    placeholder: '',
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return (k in this.attrs) ? this.attrs[k] : null; },
  };
}

function boot(lsData) {
  const ls = new Map(Object.entries(lsData || {}));
  const i18nEls = [
    makeEl({ 'data-i18n': 'nav.home' }),
    makeEl({ 'data-i18n': 'nav.settings' }),
    makeEl({ 'data-i18n': 'clave.inexistente' }),
    makeEl({ 'data-i18n-ph': 'btn.save' }),
  ];
  const events = [];
  const sb = {};
  sb.window = sb; sb.self = sb; sb.globalThis = sb;
  sb.console = console;
  sb.localStorage = {
    getItem: (k) => (ls.has(k) ? ls.get(k) : null),
    setItem: (k, v) => ls.set(String(k), String(v)),
    removeItem: (k) => ls.delete(k),
  };
  sb.document = {
    readyState: 'complete',
    querySelectorAll: (sel) => (sel === '[data-i18n]' ? i18nEls.filter((e) => e.getAttribute('data-i18n') !== null)
      : sel === '[data-i18n-ph]' ? i18nEls.filter((e) => e.getAttribute('data-i18n-ph') !== null)
      : []),
    addEventListener() { },
  };
  sb.Event = function (t) { this.type = t; };
  sb.dispatchEvent = (ev) => { events.push(ev && ev.type); return true; };
  vm.createContext(sb);
  vm.runInContext(SRC, sb, { filename: 'js/i18n.js' });
  return { sb, ls, i18nEls, events };
}

test('español es la identidad: t() devuelve null y no toca el DOM', () => {
  const { sb, i18nEls } = boot();
  assert.equal(sb.KiuI18n.current(), 'es');
  assert.equal(sb.KiuI18n.t('nav.home'), null, 'en es el texto fuente ya está en el HTML');
  assert.equal(i18nEls[0].textContent, '', 'apply en es no cambia nada');
  assert.equal(sb.KiuI18n.LANGS.map((l) => l.id).join('|'), 'es|en', 'idiomas ofrecidos');
});

test('setLang(en): persiste en nexo_settings + S, aplica diccionario y dispara kiu-lang', () => {
  const { sb, ls, i18nEls, events } = boot({ nexo_settings: '{"modo":"local"}' });
  sb.KiuI18n.setLang('en');
  const saved = JSON.parse(ls.get('nexo_settings'));
  assert.equal(saved.lang, 'en', 'idioma persistido en ajustes');
  assert.equal(sb.KiuI18n.current(), 'en');
  assert.equal(sb.KiuI18n.t('nav.home'), 'Home');
  assert.equal(sb.KiuI18n.t('set.thermal'), 'Thermal protection');
  assert.equal(i18nEls[0].textContent, 'Home', 'elemento traducido');
  assert.equal(i18nEls[1].textContent, 'Settings');
  assert.equal(i18nEls[2].textContent, '', 'clave sin traducción: fallback al español (intacto)');
  assert.equal(i18nEls[3].getAttribute('placeholder'), 'Save', 'placeholder traducido (setAttribute)');
  assert.ok(events.indexOf('kiu-lang') >= 0, 'evento kiu-lang emitido');
});

test('claves faltantes → null (el texto queda en español, fallback honesto)', () => {
  const { sb } = boot({ nexo_settings: '{"lang":"en"}' });
  assert.equal(sb.KiuI18n.t('no.existe'), null, 'clave inexistente en en');
  assert.equal(sb.KiuI18n.t(''), null);
});

test('idioma desconocido: t() cae al español; setLang normaliza al guardar', () => {
  const { sb, ls } = boot({ nexo_settings: '{"lang":"fr"}' });
  // current() conserva el valor guardado (honesto), pero al no haber diccionario
  // para 'fr' t() devuelve null → todo el texto queda en español (fallback).
  assert.equal(sb.KiuI18n.current(), 'fr');
  assert.equal(sb.KiuI18n.t('nav.home'), null, 'sin diccionario fr → texto fuente');
  sb.KiuI18n.setLang('en');
  sb.KiuI18n.setLang('en'); // segunda vez: no rompe
  assert.equal(JSON.parse(ls.get('nexo_settings')).lang, 'en');
  sb.KiuI18n.setLang('de');
  assert.equal(sb.KiuI18n.current(), 'es', 'setLang normaliza a es/en al guardar');
  assert.equal(JSON.parse(ls.get('nexo_settings')).lang, 'es');
});
