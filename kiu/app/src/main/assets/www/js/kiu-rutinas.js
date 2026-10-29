/* kiu-rutinas.js — v2.18.0: RUTINAS. "Todos los días a las 8 dame el resumen",
 * "los domingos a las 20 avisame si llueve mañana".
 *
 * Qué es y qué NO es
 * ------------------
 * Una rutina es una hora (y días) + una condición opcional + una acción de LECTURA.
 *
 *  · Corre cuando la app está viva (abierta o en segundo plano reciente): un tick por
 *    minuto, al volver a primer plano y cuando suena una alarma.
 *  · Para despertar al usuario con la app cerrada se programa una alarma normal de Android
 *    ("Rutina: <nombre>") a la próxima hora. No hay servicio nuevo ni permiso nuevo: la
 *    alarma avisa, y al tocarla se abre Kiu y la rutina corre. Eso es una LIMITACIÓN
 *    honesta, no un truco: con la app muerta Kiu no ejecuta nada por su cuenta.
 *
 * Seguridad (la regla que no se negocia)
 * --------------------------------------
 * Una rutina corre SIN que nadie la mire, así que solo puede hacer lo que no cambia nada:
 * resumen del día, clima, agenda, tareas, o decir un texto. Mandar mensajes, llamar o
 * borrar NO son acciones de rutina. Además, al ejecutar, se vuelve a comprobar con el
 * riesgo real de la herramienta (`riskOf`): si no es 'read', no corre.
 *
 * node --check js/kiu-rutinas.js
 */
window.KiuRutinas = (function () {
  'use strict';

  var KEY = 'kiu_rutinas';
  var MAX = 12;
  var VENTANA_MS = 6 * 3600000;   /* si la hora pasó hace más de 6 h, hoy ya no tiene sentido */
  var PREFIJO = 'Rutina: ';

  /* acciones permitidas → herramienta del agente (todas de lectura) */
  var ACCIONES = {
    resumen: { tool: 'daily_briefing', args: {} },
    clima: { tool: 'get_weather', args: {} },
    agenda: { tool: 'read_calendar', args: { day: 'hoy' } },
    tareas: { tool: 'manage_task', args: { action: 'list' } },
    decir: null   /* solo muestra el texto de la rutina */
  };
  var DIAS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

  function sinAcentos(t) {
    return String(t == null ? '' : t).toLowerCase()
      .replace(/[áàä]/g, 'a').replace(/[éèë]/g, 'e').replace(/[íìï]/g, 'i')
      .replace(/[óòö]/g, 'o').replace(/[úùü]/g, 'u').replace(/ñ/g, 'n');
  }
  function pad(n) { return ('0' + n).slice(-2); }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function log() { try { console.log.apply(console, ['[kiu-rutinas]'].concat([].slice.call(arguments))); } catch (e) { } }

  /* ================= parseo ================= */
  /* "8", "8:30", "08.15", "20 hs", "a las 7" → "HH:MM" o null */
  function parseHora(t) {
    var m = String(t == null ? '' : t).match(/(\d{1,2})(?:[:.h](\d{2}))?/);
    if (!m) return null;
    var h = parseInt(m[1], 10), mi = m[2] ? parseInt(m[2], 10) : 0;
    if (h > 23 || mi > 59) return null;
    return pad(h) + ':' + pad(mi);
  }
  /* "lunes y jueves", "lunes a viernes", "fines de semana", "todos los dias", "" → [0..6] */
  function parseDias(t) {
    var x = sinAcentos(t);
    if (!x.trim() || /todos|diari|cada dia|siempre/.test(x)) return [];
    if (/fin(es)? de semana/.test(x)) return [0, 6];
    if (/entre semana|laborable|dias de semana/.test(x)) return [1, 2, 3, 4, 5];
    var out = [], i;
    var rango = x.match(/(domingo|lunes|martes|miercoles|jueves|viernes|sabado)s?\s+a\s+(domingo|lunes|martes|miercoles|jueves|viernes|sabado)s?/);
    if (rango) {
      var a = DIAS.indexOf(rango[1]), b = DIAS.indexOf(rango[2]);
      for (i = a; ; i = (i + 1) % 7) { out.push(i); if (i === b || out.length > 7) break; }
      return out.sort();
    }
    for (i = 0; i < 7; i++) if (x.indexOf(DIAS[i]) >= 0) out.push(i);
    return out;
  }

  /* ================= almacenamiento ================= */
  function all() {
    try { var l = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(l) ? l : []; } catch (e) { return []; }
  }
  function save(l) {
    try { localStorage.setItem(KEY, JSON.stringify(l.slice(0, MAX))); return true; } catch (e) { return false; }
  }
  function nombreLimpio(n) { return String(n == null ? '' : n).replace(/[^\wáéíóúüñÁÉÍÓÚÜÑ ,.¿?¡!-]/g, '').trim().slice(0, 40); }

  /* ================= alta / baja ================= */
  /* spec: {name, at, days, what, ifRain, text, place} → {ok, id, routine} | {ok:false, err} */
  function add(spec, now) {
    spec = spec || {};
    now = now || new Date();
    var at = parseHora(spec.at);
    if (!at) return { ok: false, err: 'no entendí la hora (decime algo como "8:30")' };
    var what = sinAcentos(spec.what || '');
    if (!Object.prototype.hasOwnProperty.call(ACCIONES, what)) what = spec.ifRain && spec.ifRain !== 'no' ? 'clima' : 'resumen';
    var rain = sinAcentos(spec.ifRain || '');
    rain = /hoy/.test(rain) ? 'hoy' : /manana|mañana/.test(rain) ? 'manana' : '';
    var text = String(spec.text == null ? '' : spec.text).replace(/\s+/g, ' ').trim().slice(0, 120);
    if (what === 'decir' && !text) return { ok: false, err: 'decime qué querés que diga la rutina' };
    var l = all();
    if (l.length >= MAX) return { ok: false, err: 'ya tenés ' + MAX + ' rutinas; borrá alguna' };
    var name = nombreLimpio(spec.name) || ('Rutina ' + at);
    var dup = l.filter(function (r) { return sinAcentos(r.name) === sinAcentos(name); })[0];
    if (dup) return { ok: false, err: 'ya existe una rutina "' + name + '"' };
    var hoy = ymd(now);
    var r = {
      id: 'ru' + now.getTime().toString(36) + Math.floor(Math.random() * 1296).toString(36),
      name: name, at: at, days: parseDias(spec.days), what: what, rain: rain, text: text,
      place: String(spec.place || '').slice(0, 60), on: true, last: '', made: now.getTime()
    };
    /* si la hora de hoy ya pasó, hoy no corre: la primera vez es la próxima */
    var hm = at.split(':');
    var hoyAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), +hm[0], +hm[1], 0, 0);
    if (hoyAt.getTime() <= now.getTime()) r.last = hoy;
    l.push(r);
    if (!save(l)) return { ok: false, err: 'no pude guardar la rutina' };
    return { ok: true, id: r.id, routine: r };
  }
  function find(q) {
    var x = sinAcentos(q).trim(), l = all();
    for (var i = 0; i < l.length; i++) if (l[i].id === q) return l[i];
    for (i = 0; i < l.length; i++) if (sinAcentos(l[i].name) === x) return l[i];
    for (i = 0; i < l.length; i++) if (x && sinAcentos(l[i].name).indexOf(x) >= 0) return l[i];
    return null;
  }
  function remove(q) {
    var r = find(q);
    if (!r) return null;
    save(all().filter(function (z) { return z.id !== r.id; }));
    quitarDespertador(r);
    return r;
  }
  function setEnabled(q, on) {
    var r = find(q);
    if (!r) return null;
    var l = all();
    for (var i = 0; i < l.length; i++) if (l[i].id === r.id) l[i].on = !!on;
    save(l);
    if (!on) quitarDespertador(r);
    return r;
  }

  /* ================= calendario ================= */
  function permitido(r, d) { return !r.days || !r.days.length || r.days.indexOf(d.getDay()) >= 0; }
  function horaDe(r, d) {
    var hm = r.at.split(':');
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), +hm[0], +hm[1], 0, 0);
  }
  /* próxima vez que le toca, estrictamente después de `now` */
  function nextFire(r, now) {
    now = now || new Date();
    for (var k = 0; k < 8; k++) {
      var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + k);
      var t = horaDe(r, d);
      if (permitido(r, d) && t.getTime() > now.getTime()) return t;
    }
    return null;
  }
  /* las que ya les toca y todavía no corrieron hoy */
  function due(now) {
    now = now || new Date();
    return all().filter(function (r) {
      if (!r.on || r.last === ymd(now) || !permitido(r, now)) return false;
      var dt = now.getTime() - horaDe(r, now).getTime();
      return dt >= 0 && dt <= VENTANA_MS;
    });
  }
  function marcar(r, now) {
    var l = all();
    for (var i = 0; i < l.length; i++) if (l[i].id === r.id) l[i].last = ymd(now);
    save(l);
  }

  /* ================= ejecución ================= */
  function lluvia(r, cb) {
    var app = window.KiuApp;
    if (!app || typeof app.weatherQuery !== 'function') { cb(null); return; }
    var lugar = r.place;
    try { if (!lugar) lugar = (window.S && window.S.city) || localStorage.getItem('kiu_ciudad') || ''; } catch (e) { }
    if (!lugar) {
      var pos = typeof app.locationNow === 'function' ? app.locationNow() : null;
      if (pos && pos !== 'NEED_PERM') lugar = { lat: pos.lat, lon: pos.lon };
    }
    if (!lugar) { cb(null); return; }
    try { app.weatherQuery(lugar, function (w) { cb(w || null); }); } catch (e) { cb(null); }
  }
  function ejecutarAccion(r) {
    var A = window.KiuAgente;
    var acc = ACCIONES[r.what];
    if (!acc) return Promise.resolve({ ok: true, text: r.text });
    var t = A && A.get ? A.get(acc.tool) : null;
    if (!t) return Promise.resolve({ ok: false, err: 'herramienta no disponible' });
    var args = {};
    for (var k in acc.args) if (Object.prototype.hasOwnProperty.call(acc.args, k)) args[k] = acc.args[k];
    if (r.what === 'clima' && r.place) args.place = r.place;
    if (r.what === 'clima' && r.rain === 'manana') args.day = 'mañana';
    /* la regla de oro: sin supervisión, solo lectura */
    if (A.riskOf(t, args) !== 'read') return Promise.resolve({ ok: false, err: 'una rutina solo puede leer' });
    try { return Promise.resolve(t.run(args)); } catch (e) { return Promise.resolve({ ok: false, err: 'falló' }); }
  }
  /* corre UNA rutina → promesa de {ran:bool, text} (ran=false: la condición no se cumplió o falló) */
  function correr(r, now) {
    return new Promise(function (resolve) {
      function accion(prefijo) {
        ejecutarAccion(r).then(function (o) {
          marcar(r, now);
          if (!o || !o.ok || !o.text) { resolve({ ran: false, err: (o && o.err) || 'sin resultado' }); return; }
          resolve({ ran: true, text: (prefijo || '') + o.text });
        });
      }
      if (!r.rain) { accion(''); return; }
      lluvia(r, function (w) {
        if (!w) { resolve({ ran: false, err: 'sin datos del clima' }); return; }   /* no se marca: se reintenta en el próximo tick */
        var d = w.days && w.days[r.rain === 'manana' ? 1 : 0];
        if (!d || d.rain === null || d.rain === undefined || d.rain < 50) { marcar(r, now); resolve({ ran: false, err: 'no llueve' }); return; }
        accion('☔ Va a llover ' + (r.rain === 'manana' ? 'mañana' : 'hoy') + ' (' + Math.round(d.rain) + '%). ');
      });
    });
  }
  var corriendo = false;
  /* corre todas las que tocan. deliver(texto, rutina) entrega el resultado al usuario. */
  function tick(deliver, now) {
    if (corriendo) return Promise.resolve(0);
    now = now || new Date();
    var cola = due(now);
    if (!cola.length) { programarDespertadores(now); return Promise.resolve(0); }
    corriendo = true;
    var n = 0;
    var seguir = function (i) {
      if (i >= cola.length) return Promise.resolve();
      return correr(cola[i], now).then(function (res) {
        if (res.ran) { n++; try { deliver && deliver(res.text, cola[i]); } catch (e) { log('deliver', e); } }
        return seguir(i + 1);
      });
    };
    return seguir(0).then(function () { corriendo = false; programarDespertadores(now); return n; },
      function () { corriendo = false; return n; });
  }

  /* ================= despertador de Android ================= */
  function titulo(r) { return PREFIJO + r.name; }
  function programarDespertadores(now) {
    var app = window.KiuApp;
    if (!app || typeof app.addReminder !== 'function' || typeof app.reminders !== 'function') return 0;
    var n = 0, pend = [];
    try { pend = app.reminders() || []; } catch (e) { return 0; }
    all().forEach(function (r) {
      if (!r.on) return;
      var nf = nextFire(r, now || new Date());
      if (!nf) return;
      var ya = pend.some(function (p) { return p.title === titulo(r) && p.time === nf.getTime(); });
      if (ya) return;
      try { if (app.addReminder(titulo(r), nf)) n++; } catch (e) { }
    });
    return n;
  }
  function quitarDespertador(r) {
    var app = window.KiuApp;
    if (!app || typeof app.reminders !== 'function' || typeof app.removeReminder !== 'function') return;
    try {
      (app.reminders() || []).forEach(function (p) { if (p.title === titulo(r)) app.removeReminder(p.id); });
    } catch (e) { }
  }

  /* ================= texto ================= */
  function dicho(r) {
    var dias = !r.days.length ? 'todos los días' : r.days.map(function (d) { return DIAS[d]; }).join(', ');
    var que = { resumen: 'resumen del día', clima: 'clima', agenda: 'agenda de hoy', tareas: 'tareas pendientes', decir: '«' + r.text + '»' }[r.what] || r.what;
    return r.name + ': ' + dias + ' a las ' + r.at + ' → ' + que + (r.rain ? ' (solo si llueve ' + (r.rain === 'manana' ? 'mañana' : 'hoy') + ')' : '') + (r.on ? '' : ' [pausada]');
  }

  return {
    add: add, all: all, find: find, remove: remove, setEnabled: setEnabled,
    nextFire: nextFire, due: due, correr: correr, tick: tick, dicho: dicho,
    programarDespertadores: programarDespertadores,
    parseHora: parseHora, parseDias: parseDias,
    ACCIONES: Object.keys(ACCIONES), MAX: MAX, KEY: KEY
  };
})();
