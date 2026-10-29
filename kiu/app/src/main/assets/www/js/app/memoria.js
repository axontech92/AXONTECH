/* app/memoria.js — v2.14.2: la memoria del usuario como módulo aparte.
 *
 * Por qué existe este archivo
 * ---------------------------
 * Antes de v2.14.2 la memoria (recuerdos, tareas, notas y preferencias) vivía
 * DENTRO de app-ui.js, un archivo de 5.500 líneas. Eso no era un detalle de
 * estilo: era lo que impedía que el agente la usara.
 *
 *   · app-ui.js se carga AL FINAL (el último script de index.html), así que
 *     `window.KiuMem` no existía hasta ese momento.
 *   · el agente (kiu-agente.js) se carga ANTES, pero sus herramientas corren
 *     en tiempo de ejecución: cuando llegan a la memoria sí la encuentran.
 *   · el problema real era otro: la memoria NO TENÍA NINGUNA operación de
 *     búsqueda. `list()` devolvía todo y el que filtraba era brain.js, con
 *     regex. Un modelo no escribe regex: necesitaba una búsqueda que lo sirviera.
 *
 * Este módulo deja la memoria como lo que es —un almacén con consulta— y le
 * agrega lo que le faltaba:
 *
 *   · `search(q, kinds)` — buscar por palabras (sin acentos ni mayúsculas),
 *     como lo haría una persona: "la reunión" encuentra "Reunión con Ana".
 *   · `summary()` — un perfil corto del usuario, para el prompt del agente.
 *   · `hooks` — la UI (app-ui.js) se engancha acá para refrescar la pantalla y
 *     registrar actividad. El módulo de datos no conoce la UI.
 *
 * node --check js/app/memoria.js
 */
(function () {
  'use strict';

  var TIPOS = ['recuerdos', 'tareas', 'notas', 'prefs'];
  var MAX_POR_TIPO = 200;
  var LS_KEY = 'nexo_mem';

  /* La UI se engancha por acá: el módulo de datos no sabe qué es un toast ni
     una pantalla de Memoria. */
  var hooks = {
    onAdd: null,     /* (tipo, texto) → la UI registra la actividad */
    onChange: null   /* () → la UI refresca la pantalla de Memoria */
  };

  function store(key, val) {
    try {
      if (typeof window !== 'undefined' && typeof window.store === 'function') return window.store(key, val);
    } catch (e) { }
    return null;
  }

  function hoy() {
    try {
      if (typeof window !== 'undefined' && typeof window.todayStr === 'function') return window.todayStr();
    } catch (e) { }
    var d = new Date();
    return d.getDate() + '/' + (d.getMonth() + 1);
  }

  /* Normalización para buscar: minúsculas, sin acentos y sin signos. */
  function plano(s) {
    var t = String(s == null ? '' : s).toLowerCase();
    if (t.normalize) t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return t.replace(/[^a-z0-9ñü\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /* Palabras con las que se busca. Las de menos de 3 letras se descartan
     ("el", "a", "un"): si no, cualquier nota matchea cualquier cosa. Los
     números se conservan siempre ("llamar al 911", "tarea 3"). */
  function palabras(s) {
    var out = [];
    var ps = plano(s).split(' ').filter(function (p) { return !!p; });
    for (var i = 0; i < ps.length; i++) {
      if (/^\d+$/.test(ps[i]) || ps[i].length >= 3) out.push(ps[i]);
    }
    return out;
  }

  function vacio() { return { recuerdos: [], tareas: [], notas: [], prefs: [] }; }

  function cargar() {
    var d = null;
    try { d = store(LS_KEY); } catch (e) { d = null; }
    if (!d || typeof d !== 'object' || Array.isArray(d)) d = vacio();
    for (var i = 0; i < TIPOS.length; i++) {
      if (!Array.isArray(d[TIPOS[i]])) d[TIPOS[i]] = [];
    }
    return d;
  }

  var KiuMem = {
    data: null,
    hooks: hooks,
    TIPOS: TIPOS,

    /* ---------- persistencia ---------- */
    load: function () {
      if (!this.data) this.data = cargar();
      return this.data;
    },
    save: function () {
      try { store(LS_KEY, this.data); } catch (e) { }
    },
    reset: function () {
      this.data = vacio();
      this.save();
      this.aviso('change');
    },

    /* ---------- escritura ---------- */
    add: function (type, text) {
      this.load();
      if (!this.data[type]) this.data[type] = [];
      var t = String(text == null ? '' : text).trim();
      if (!t) return null;
      var item = { text: t, ts: Date.now(), date: hoy(), done: false };
      this.data[type].unshift(item);
      if (this.data[type].length > MAX_POR_TIPO) this.data[type].pop();
      this.save();
      if (hooks.onAdd) { try { hooks.onAdd(type, t); } catch (e) { } }
      this.aviso('change');
      return item;
    },
    addRecuerdo: function (t) { return this.add('recuerdos', t); },
    addTarea: function (t) { return this.add('tareas', t); },
    addNota: function (t) { return this.add('notas', t); },
    addPref: function (t) { return this.add('prefs', t); },

    /* ---------- lectura ---------- */
    list: function (type) {
      this.load();
      return this.data[type] || [];
    },
    count: function (type) { return this.list(type).length; },
    pendingTasks: function () {
      return this.list('tareas').filter(function (t) { return !t.done; });
    },
    remove: function (type, ts) {
      this.load();
      this.data[type] = (this.data[type] || []).filter(function (x) { return x.ts !== ts; });
      this.save();
      this.aviso('change');
    },

    /* ---------- OLVIDAR Y CORREGIR (v2.14.2) ----------
     * Una memoria que solo crece es un archivo, no una memoria. El usuario
     * cambia de opinión: "ya no es el martes, es el jueves", "olvidá lo del
     * dentista". Sin esto el agente acumula recuerdos viejos y un día le
     * contesta algo que el usuario ya corrigió hace tres semanas. */
    removeByText: function (type, q) {
      this.load();
      q = String(q || '').trim().toLowerCase();
      if (!q) return 0;
      var antes = (this.data[type] || []).length;
      this.data[type] = (this.data[type] || []).filter(function (x) {
        return String(x.text || '').toLowerCase().indexOf(q) < 0;
      });
      var n = antes - this.data[type].length;
      if (n > 0) { this.save(); this.aviso(); }
      return n;
    },
    updateByText: function (type, q, nuevo) {
      this.load();
      q = String(q || '').trim().toLowerCase();
      nuevo = String(nuevo || '').trim();
      if (!q || !nuevo) return 0;
      var n = 0;
      (this.data[type] || []).forEach(function (x) {
        if (String(x.text || '').toLowerCase().indexOf(q) >= 0) {
          x.text = nuevo;
          x.ts = Date.now();
          n++;
        }
      });
      if (n > 0) { this.save(); this.aviso(); }
      return n;
    },
    /* Borra en varios tipos a la vez (el "olvidá X" del agente). */
    forget: function (q, kinds) {
      var tipos = (kinds && kinds.length) ? kinds : TIPOS;
      var n = 0;
      for (var i = 0; i < tipos.length; i++) n += this.removeByText(tipos[i], q);
      return n;
    },
    toggleTarea: function (ts) {
      this.load();
      this.data.tareas.forEach(function (x) { if (x.ts === ts) x.done = !x.done; });
      this.save();
      this.aviso('change');
    },

    /* Marca la primera tarea pendiente que matchee el texto (o la primera, si
       no se dijo cuál). Devuelve un texto para el usuario, como antes. */
    completeTarea: function (q) {
      this.load();
      q = String(q || '').trim().toLowerCase();
      var found = null;
      for (var i = 0; i < this.data.tareas.length; i++) {
        var t = this.data.tareas[i];
        if (!t.done && (!q || t.text.toLowerCase().indexOf(q) >= 0)) { found = t; break; }
      }
      if (!found) return 'No encontré esa tarea pendiente. Mirá la lista en Memoria.';
      found.done = true; this.save(); this.aviso('change');
      var left = this.pendingTasks().length;
      return 'Listo, marqué "' + found.text + '" como hecha. Te quedan ' + left + ' pendiente' + (left === 1 ? '' : 's') + '.';
    },

    /* ---------- BÚSQUEDA (lo que le faltaba) ----------
     * Devuelve [{kind, text, ts, done}] con lo que matchea. Sin `query` (o con
     * una query de una sola letra) devuelve todo, para que el agente pueda
     * decir "qué tenés guardado" sin inventar filtros. */
    search: function (query, kinds) {
      this.load();
      var qs = palabras(query);
      var tipos = (kinds && kinds.length) ? kinds : TIPOS;
      var out = [];
      for (var i = 0; i < tipos.length; i++) {
        var k = tipos[i];
        if (!this.data[k]) continue;
        var lista = this.data[k];
        for (var j = 0; j < lista.length; j++) {
          var it = lista[j];
          var txt = String(it.text || '');
          if (!qs.length) { out.push({ kind: k, text: txt, ts: it.ts, done: !!it.done }); continue; }
          var hay = plano(txt);
          var ok = true;
          for (var w = 0; w < qs.length; w++) {
            if (hay.indexOf(qs[w]) < 0) { ok = false; break; }
          }
          if (ok) out.push({ kind: k, text: txt, ts: it.ts, done: !!it.done });
        }
      }
      out.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
      return out;
    },

    /* ---------- perfil corto ----------
     * Para el prompt del agente: qué tiene el usuario a mano ahora. Corto a
     * propósito — esto se paga en CADA decisión, en la CPU del teléfono. */
    summary: function (maxChars) {
      var max = maxChars || 280;
      this.load();
      var out = [];
      var pend = this.pendingTasks();
      if (pend.length) {
        out.push('tareas pendientes: ' + pend.slice(0, 3).map(function (t) { return String(t.text || '').slice(0, 40); }).join('; '));
      }
      var rec = this.data.recuerdos || [];
      if (rec.length) {
        out.push('recuerdos: ' + rec.slice(0, 3).map(function (r) { return String(r.text || '').slice(0, 40); }).join('; '));
      }
      var pre = this.data.prefs || [];
      if (pre.length) {
        out.push('preferencias: ' + pre.slice(0, 2).map(function (p) { return String(p.text || '').slice(0, 40); }).join('; '));
      }
      var s = out.join(' | ');
      return s.length > max ? s.slice(0, max - 1) + '…' : s;
    },

    aviso: function () {
      if (hooks.onChange) { try { hooks.onChange(); } catch (e) { } }
    }
  };

  /* La carga inicial es perezosa pero síncrona: app-ui.js (y las pruebas)
     tocan `KiuMem.data` directo, así que tiene que estar listo ya. */
  KiuMem.data = cargar();

  window.KiuMem = KiuMem;
})();
