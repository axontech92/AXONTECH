/* helpers.mjs — arnés compartido para los tests de la UI de Kiu (tanda 8).
 * Antes vivía copiado dentro de boot.test.mjs; ahora todos los tests de
 * módulos importan esto, así un arreglo del DOM falso beneficia a todos.
 * Provee: DOM/localStorage falsos + sandbox VM con window===global +
 * carga de scripts en el orden real de index.html.
 * node --test tests/*.test.mjs
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const WWW = path.join(HERE, '..', 'app', 'src', 'main', 'assets', 'www');

/* ---------- DOM falso (suficiente para que arranque, no para renderizar) ---------- */
export function fakeClassList() {
  const s = new Set();
  return {
    add: (...c) => c.forEach((x) => s.add(x)),
    remove: (...c) => c.forEach((x) => s.delete(x)),
    toggle: (c, f) => { (f === undefined ? !s.has(c) : f) ? s.add(c) : s.delete(c); },
    contains: (c) => s.has(c),
  };
}
export function fakeStyle() {
  const s = {
    setProperty() { },
    removeProperty() { },
    getPropertyValue() { return ''; },
  };
  return new Proxy(s, {
    set(t, k, v) { t[k] = v; return true; },
    get(t, k) { return t[k]; },
  });
}
export function fakeEl(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    children: [],
    style: fakeStyle(),
    dataset: {},
    innerHTML: '',
    textContent: '',
    value: '',
    id: '',
    hidden: false,
    classList: fakeClassList(),
    attributes: {},
    width: 0,
    height: 0,
  };
  // padre perezoso: el boot del avatar hace parentNode.insertBefore(...); la UI
  // encadena parentElement.parentElement → el padre falso también tiene abuelo.
  let _pn = null;
  const makePn = () => {
    if (makePn._c) return makePn._c;
    const grand = {
      children: [],
      style: fakeStyle(),
      classList: fakeClassList(),
      insertBefore: (c) => c,
      appendChild: (c) => c,
      removeChild: () => null,
      parentElement: null,
      parentNode: null,
    };
    makePn._c = {
      children: [],
      insertBefore: (c) => c,
      appendChild: (c) => c,
      removeChild: () => el,
      style: fakeStyle(),
      classList: fakeClassList(),
      parentElement: grand,
      parentNode: grand,
    };
    return makePn._c;
  };
  Object.defineProperty(el, 'parentNode', {
    configurable: true,
    set(_v) { }, // appendChild ajeno puede intentar asignar el padre
    get() { if (!_pn) _pn = makePn(); return _pn; },
  });
  Object.defineProperty(el, 'parentElement', {
    configurable: true,
    set(_v) { },
    get() { if (!_pn) _pn = makePn(); return _pn; },
  });
  el.setAttribute = (k, v) => { el.attributes[k] = String(v); if (k === 'id') el.id = String(v); };
  el.getAttribute = (k) => (k in el.attributes ? el.attributes[k] : null);
  el.removeAttribute = (k) => { delete el.attributes[k]; };
  el.hasAttribute = (k) => k in el.attributes;
  el.addEventListener = () => { };
  el.removeEventListener = () => { };
  el.appendChild = (c) => { el.children.push(c); try { c.parentNode = el; } catch (e) { } return c; };
  el.removeChild = (c) => { el.children = el.children.filter((x) => x !== c); return c; };
  el.insertBefore = (c) => { el.children.push(c); try { c.parentNode = el; } catch (e) { } return c; };
  el.querySelector = () => fakeEl('div');
  el.querySelectorAll = () => [];
  el.closest = () => null;
  el.contains = () => false;
  el.focus = () => { };
  el.blur = () => { };
  el.click = () => { };
  el.remove = () => { };
  el.getBoundingClientRect = () => ({ left: 0, top: 0, right: 300, bottom: 120, width: 300, height: 120 });
  el.scrollIntoView = () => { };
  el.scrollTo = () => { };
  return el;
}
export function fakeDocument() {
  const byId = new Map();
  const doc = fakeEl('body');
  doc.getElementById = (id) => {
    if (!byId.has(id)) byId.set(id, fakeEl('div'));
    return byId.get(id);
  };
  doc.createElement = (t) => fakeEl(t);
  doc.querySelectorAll = () => [];
  doc.querySelector = () => fakeEl('div');
  doc.addEventListener = () => { };
  doc.removeEventListener = () => { };
  doc.head = fakeEl('head');
  doc.body = fakeEl('body');
  doc.documentElement = fakeEl('html');
  doc.hidden = false;
  doc.visibilityState = 'visible';
  doc.cookie = '';
  return doc;
}
export function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(String(k), String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
    key: (i) => Array.from(m.keys())[i] ?? null,
    get length() { return m.size; },
    _map: m,
  };
}

/* ---------- sandbox = window (como en un navegador real) ---------- */
export function newSandbox(opts) {
  const o = opts || {};
  const sb = {};
  sb.window = sb;           // window === global del contexto
  sb.self = sb;
  sb.globalThis = sb;
  sb.document = fakeDocument();
  sb.localStorage = fakeStorage();
  sb.sessionStorage = fakeStorage();
  sb.navigator = { userAgent: 'KiuBootTest/2.7', hardwareConcurrency: 8, language: 'es' };
  sb.location = { href: 'https://appassets.androidplatform.net/assets/index.html', protocol: 'https:', host: 'appassets.androidplatform.net', hostname: 'appassets.androidplatform.net', reload() { }, search: o.search || '' };
  sb.matchMedia = () => ({ matches: false, media: '', addListener() { }, removeListener() { }, addEventListener() { }, removeEventListener() { } });
  sb.requestAnimationFrame = () => 0;
  sb.cancelAnimationFrame = () => { };
  sb.getComputedStyle = () => ({ getPropertyValue: () => '' });
  sb.crypto = o.crypto || { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = (i * 7 + 3) & 255; return a; } };
  sb.speechSynthesis = { getVoices: () => [], speak() { }, cancel() { }, pending: false, speaking: false };
  sb.SpeechSynthesisUtterance = function (t) { this.text = t; };
  sb.FileReader = function () { };
  sb.Blob = function () { };
  sb.Image = function () { };
  sb.history = { pushState() { }, replaceState() { } };
  sb.addEventListener = () => { };
  sb.removeEventListener = () => { };
  sb.dispatchEvent = () => true;
  sb.postMessage = () => { };
  sb.console = console;
  sb.__kiuErrors = [];
  // timers que NO ejecutan: evitan colgar el test y sorpresas asíncronas
  sb.setTimeout = () => 0;
  sb.clearTimeout = () => { };
  sb.setInterval = () => 0;
  sb.clearInterval = () => { };
  vm.createContext(sb);
  return sb;
}

/* ---------- carga de scripts en el orden real de index.html ---------- */
export function runScript(sb, rel, src) {
  vm.runInContext(src || readFileSync(path.join(WWW, rel), 'utf-8'), sb, { filename: rel });
}
export function loadAll(sb, scripts) {
  for (const rel of scripts) runScript(sb, rel);
}
