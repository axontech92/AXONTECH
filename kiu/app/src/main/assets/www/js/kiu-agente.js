/*!
 * kiu-agente.js — v2.9.1: herramientas que el MODELO elige, no los regex.
 *
 * El problema que resuelve
 * -----------------------
 * Hoy Kiu no es un agente: es un enrutador de patrones. `brain.js` tiene ~200
 * regex que deciden "esto es una alarma" o "esto es un contacto", `react.js` parte
 * el pedido con un regex de conectores y rutea a KiuBrain o al RAG. El modelo solo
 * aparece para redactar la respuesta final. Eso funciona con 200 intenciones
 * escritas a mano y se rompe en la 201.
 *
 * Lo que hay acá
 * --------------
 * Un REGISTRO de herramientas con la forma que un LLM puede entender:
 *
 *   { name, desc, args: { <nombre>: {type, required, desc, enum} }, run(args) }
 *
 * y un bucle chico que le pide al modelo UNA decisión, la valida con rigor, la
 * ejecuta y le devuelve la observación. El modelo elige; este archivo decide qué
 * se puede ejecutar.
 *
 * Por qué "el modelo elige" NO alcanza solo
 * -----------------------------------------
 * Un modelo chico (1B–3B) inventa nombres de herramienta, deja argumentos sueltos
 * y mete JSON dentro de un ```json. Por eso el bucle NO confía:
 *   · nombre desconocido → se rechaza y se le dice al modelo qué nombres SÍ existen
 *   · argumento obligatorio que falta → se rechaza con el motivo
 *   · tipo que no cierra → se rechaza
 *   · argumento que no está en el esquema → se rechaza (señal de que se está
 *     inventando el mundo; antes era un bug silencioso)
 *   · tope de pasos → si no converge, se corta y se contesta lo que se pudo hacer
 *
 * UNA sola fuente de verdad
 * -------------------------
 * `args` (el esquema en JS) genera DOS cosas: el texto del prompt y la gramática
 * GBNF de `grammar()`. No pueden quedar desalineadas porque salen del mismo
 * objeto. La gramática es lo que se le pasa al sampler del motor para forzar JSON
 * válido (llama_sampler_init_grammar); hasta que el nativo la soporte, el bucle
 * funciona igual con parse + reintento, que es de todas formas la ruta que hace
 * falta tener porque un modelo chico va a fallar el JSON de vez en cuando.
 *
 * Degradación
 * -----------
 * Si no hay modelo cargado, el bucle no se usa: el flujo normal (KiuBrain →
 * ReAct → proveedor → local) sigue igual. Esto no reemplaza a brain.js, lo
 *COMPLEMENTA: brain.js resuelve lo conocido al instante y sin gastar tokens, y el
 * modelo entra cuando hay algo que no está en los regex.
 *
 * node --check js/kiu-agente.js
 */
window.KiuAgente = (function () {
  'use strict';

  var MAX_STEPS = 3;      /* decisiones por turno: más y se vuelve un bucle */
  var MAX_ARG_LEN = 200;  /* un argumento de 200 chars es prompt injection, no un dato */

  /* ================= helpers ================= */
  function s(v, max) {
    if (v === null || v === undefined) return '';
    var t = String(v);
    return max ? t.slice(0, max) : t;
  }
  function num(v) {
    var n = parseFloat(String(v).replace(',', '.'));
    return isFinite(n) ? n : null;
  }
  function log() { try { console.log.apply(console, ['[kiu-agente]'].concat([].slice.call(arguments))); } catch (e) { } }

  /* ================= REGISTRO =================
     Cada herramienta envuelve algo que YA existe (brain, RAG, el puente) en vez
     de reimplementarlo. Si una herramienta necesita lógica nueva, esa lógica va
     en su run(), no en un segundo lugar. */
  var TOOLS = {};

  function def(name, desc, args, run, opts) {
    TOOLS[name] = {
      name: name,
      desc: desc,
      args: args || {},
      run: run,
      risk: (opts && opts.risk) || 'read',
      /* v2.14.2 · riesgo POR ARGUMENTO. Una herramienta que puede leer o
         escribir (listar tareas, ver alarmas) no puede tener un riesgo único:
         "list" no pide confirmación y "add" sí. Con `riskFor` el riesgo se
         decide con los argumentos ya validados. Si el cálculo falla, se asume
         'write' (preguntar de más es un problema menor; actuar de más no). */
      riskFor: (opts && opts.riskFor) || null,
      enabled: !opts || opts.enabled !== false
    };
    return TOOLS[name];
  }

  function riskOf(t, args) {
    if (!t) return 'write';
    if (t.riskFor) {
      try { return t.riskFor(args) || 'read'; } catch (e) { return 'write'; }
    }
    return t.risk || 'read';
  }

  /* --- 1. alarma ------------------------------------------------------- */
  def('set_alarm',
    'Programar una alarma o recordatorio.',
    {
      when: { type: 'string', required: true, desc: '"a las 7", "en 20 minutos", "mañana 9:30". Si no se entiende, usá "en 10 minutos".' },
      label: { type: 'string', required: false, desc: 'Qué recordar. Corto.' }
    },
    function (a) {
      var app = window.KiuApp, brain = window.KiuBrain;
      if (!app || !app.addReminder) return { ok: false, err: 'no puedo programar alarmas ahora' };
      var w = null;
      if (brain && brain.parseWhen) { try { w = brain.parseWhen(a.when); } catch (e) { w = null; } }
      if (!w || !w.when) return { ok: false, err: 'no entendí el horario "' + s(a.when, 40) + '"' };
      var titulo = s(a.label, 60) || 'Recordatorio';
      var ok = app.addReminder(titulo, w.when);
      return { ok: !!ok, text: ok ? ('Listo: ' + titulo + ' ' + w.whenTxt + '.') : 'No pude programar la alarma.' };
    });

  /* --- 2. agenda ------------------------------------------------------ */
  def('read_calendar',
    'Leer la agenda: "¿qué tengo mañana?", "¿tengo algo el viernes?", "¿tengo dentista?".',
    {
      day: { type: 'string', required: false, desc: '"hoy" | "mañana" | "pasado mañana" | un día de la semana. Vacío = próximos días.' },
      what: { type: 'string', required: false, desc: 'Texto a buscar en el evento. Vacío = todos.' }
    },
    function (a) {
      var app = window.KiuApp;
      if (!app || !app.calendarQuery) return { ok: false, err: 'no puedo leer la agenda ahora' };
      var txt = (a.day || 'proximos dias').toLowerCase();
      var from = Date.now(), to = from + 14 * 86400000, etiqueta = 'los próximos días';
      if (/hoy/.test(txt)) { to = new Date(new Date().setHours(24, 0, 0, 0)).getTime(); etiqueta = 'hoy'; }
      else if (/pasado/.test(txt)) { var d2 = new Date(); d2.setDate(d2.getDate() + 2); d2.setHours(0, 0, 0, 0); from = d2.getTime(); d2.setDate(d2.getDate() + 1); to = d2.getTime(); etiqueta = 'pasado mañana'; }
      else if (/manana/.test(txt)) { var d1 = new Date(); d1.setDate(d1.getDate() + 1); d1.setHours(0, 0, 0, 0); from = d1.getTime(); d1.setDate(d1.getDate() + 1); to = d1.getTime(); etiqueta = 'mañana'; }
      else {
        var dias = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
        for (var i = 0; i < dias.length; i++) {
          if (txt.indexOf(dias[i]) > -1) {
            var d0 = new Date(); var hoy = d0.getDay();
            var salto = (hoy === i) ? 7 : ((hoy < i) ? (i - hoy) : (7 - hoy + i));
            var dd = new Date(); dd.setDate(dd.getDate() + salto); dd.setHours(0, 0, 0, 0);
            from = dd.getTime(); dd.setDate(dd.getDate() + 1); to = dd.getTime();
            etiqueta = 'el ' + dias[i];
            break;
          }
        }
      }
      var r = app.calendarQuery(s(a.what, 40), from, to);
      if (r === 'NEED_PERM') return { ok: false, err: 'necesito permiso de calendario para leer la agenda' };
      if (r === null) return { ok: false, err: 'no pude leer la agenda' };
      if (!r.length) return { ok: true, text: 'El usuario no tiene nada agendado ' + etiqueta + '.' };
      var lineas = r.slice(0, 6).map(function (e) {
        var d = new Date(e.b);
        var hh = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
        return hh + ' ' + (e.t || '(sin título)') + (e.w ? ' en ' + e.w : '');
      });
      return { ok: true, text: 'Eventos ' + etiqueta + ':\n' + lineas.join('\n') };
    });

  /* --- 3. contactos --------------------------------------------------- */
  def('find_contact',
    'Buscar un contacto por nombre y ver su número.',
    { name: { type: 'string', required: true, desc: 'Nombre del contacto.' } },
    function (a) {
      var app = window.KiuApp;
      if (!app || !app.contactSearch) return { ok: false, err: 'no puedo buscar contactos' };
      var r = app.contactSearch(s(a.name, 40));
      if (r === 'NEED_PERM') return { ok: false, err: 'necesito permiso de contactos' };
      if (!r || !r.length) return { ok: true, text: 'No encontré a "' + s(a.name, 40) + '" entre los contactos.' };
      return { ok: true, text: 'Coincidencias: ' + r.slice(0, 3).map(function (c) { return c.name + ' (' + c.num + ')'; }).join(', ') };
    });

  /* --- 4. llamar (efecto real) ---------------------------------------- */
  def('call_contact',
    'Marcar a alguien. Abre el marcador; NO llama solo.',
    { who: { type: 'string', required: true, desc: 'Nombre o número.' } },
    function (a) {
      var app = window.KiuApp, brain = window.KiuBrain;
      var quien = s(a.who, 40);
      if (!quien) return { ok: false, err: 'no sé a quién llamar' };
      if (/^\+?[\d\s\-()]{6,}$/.test(quien)) {
        var n = quien.replace(/\D/g, '');
        var okD = app && app.bridgeCall ? app.bridgeCall('dial', [n]) : false;
        return { ok: !!okD, text: 'Te abrí el marcador con ' + quien + '. Tocá llamar para confirmar.' };
      }
      /* que lo resuelva brain.js: ya sabe de contactos a número, con sus mensajes */
      var r = brain && brain.reply ? brain.reply('llama a ' + quien) : null;
      if (r && r.handled) return { ok: true, text: r.text };
      return { ok: false, err: 'no encontré a "' + quien + '" para llamar' };
    }, { risk: 'write' });

  /* --- 5. documentos (RAG) -------------------------------------------- */
  def('search_docs',
    'Buscar en los documentos que el usuario tiene indexados.',
    { query: { type: 'string', required: true, desc: 'Palabras clave.' } },
    function (a) {
      var R = window.RAG;
      if (!R || !R.on) return { ok: false, err: 'no hay documentos indexados' };
      var hits = (typeof R.hits === 'function' ? R.hits(s(a.query, MAX_ARG_LEN), 3) : null) || [];
      if (!hits.length) return { ok: true, text: 'No encontré nada en los documentos con esa consulta.' };
      var out = hits.map(function (h) {
        var t = String(h.txt || h.text || '').replace(/\s+/g, ' ').trim();
        if (t.length > 160) t = t.slice(0, 160) + '…';
        return '«' + (h.name || h.doc || 'documento') + '»: ' + t;
      });
      return { ok: true, text: 'Encontré esto:\n' + out.join('\n') };
    });

  /* --- 6. acción del dispositivo -------------------------------------- */
  /* Una sola herramienta con `what` acotado a una lista, en vez de 14
     herramientas distintas: el modelo elige entre valores que ya son válidos, y la
     gramática GBNF puede enumerarlos. Menos superficie que inventar. */
  var DEVICE_WHAT = ['linterna', 'bateria', 'espacio', 'abrir_app', 'maps', 'web', 'youtube', 'timer'];
  def('device_action',
    'Acciones del teléfono. Para llamar: call_contact. Para mensajes: send_message.',
    {
      what: { type: 'string', required: true, enum: DEVICE_WHAT, desc: 'Uno de: ' + DEVICE_WHAT.join(' | ') },
      target: { type: 'string', required: false, desc: 'App, minutos o texto. Vacío si no hace falta.' }
    },
    function (a) {
      var app = window.KiuApp, brain = window.KiuBrain;
      var what = s(a.what, 30).toLowerCase().trim();
      var target = s(a.target, 60);
      if (DEVICE_WHAT.indexOf(what) === -1) return { ok: false, err: '"' + what + '" no es una acción que sepa hacer' };
      if (what === 'linterna') {
        var r0 = brain && brain.reply ? brain.reply(target ? target : 'enciende la linterna') : null;
        if (r0 && r0.handled) return { ok: true, text: r0.text };
        return { ok: false, err: 'no pude tocar la linterna' };
      }
      if (what === 'abrir_app') {
        if (!target) return { ok: false, err: 'decime qué app querés abrir' };
        var r1 = brain && brain.reply ? brain.reply('abre ' + target) : null;
        if (r1 && r1.handled) return { ok: true, text: r1.text };
        return { ok: false, err: 'no encontré la app "' + target + '"' };
      }
      if (what === 'timer') {
        var mins = num(target);
        if (mins === null) {
          var mt = String(target).match(/(\d+)/);
          mins = mt ? parseInt(mt[1], 10) : null;
        }
        if (mins === null) return { ok: false, err: 'no entendí cuántos minutos' };
        var okT = app && app.startTimerNative ? app.startTimerNative(mins, 'Temporizador de ' + mins + " minutos") : false;
        return { ok: !!okT, text: okT ? ('Temporizador de ' + mins + ' minutos arrancado.') : 'No pude arrancar el temporizador.' };
      }
      /* v2.14.2 · los tres valores del enum que NO FUNCIONABAN. "maps", "web" y
         "youtube" llegaban acá y caían en la cola de brain.js con un texto que
         brain no reconoce ("maps centro"), así que la herramienta contestaba
         siempre "no pude cumplir". El modelo los elegía, reintentaba y perdía un
         paso. Ahora cada uno tiene su camino. */
      if (what === 'maps') {
        if (!target) return { ok: false, err: 'decime a dónde querés ir' };
        var rM = brain && brain.reply ? brain.reply('como llego a ' + target) : null;
        if (rM && rM.handled) return { ok: true, text: rM.text };
        return { ok: false, err: 'no pude abrir Mapas con «' + target.slice(0, 40) + '»' };
      }
      if (what === 'web') {
        if (!target) return { ok: false, err: 'decime qué buscar' };
        return buscarWeb(target);
      }
      if (what === 'youtube') {
        if (!target) return { ok: false, err: 'decime qué buscar en YouTube' };
        var rY = brain && brain.reply ? brain.reply('busca ' + target + ' en youtube') : null;
        if (rY && rY.handled) return { ok: true, text: rY.text };
        return { ok: false, err: 'no pude buscar en YouTube' };
      }
      /* el resto son lecturas: que las conteste brain.js, que ya las sabe */
      /* v2.14.2 · "espacio" y "bateria" solos NO los entiende brain.js: sus
         reglas piden la frase entera ("cuánto espacio libre hay"). Con la
         palabra suelta la herramienta contestaba "no pude cumplir" y el
         modelo perdía un paso. Se le pasa la frase que el cerebro entiende. */
      var DEVICE_PHRASE = { espacio: 'cuanto espacio libre hay', bateria: 'cuanta bateria queda' };
      var r2 = brain && brain.reply ? brain.reply(DEVICE_PHRASE[what] || (target ? what + ' ' + target : what)) : null;
      if (r2 && r2.handled) return { ok: true, text: r2.text };
      return { ok: false, err: 'no pude cumplir "' + what + '"' };
    }, {
      risk: 'write',
      /* v2.14.2 · leer la batería o el disco no es una acción con efecto: no
         puede pedir confirmación. Antes toda device_action era 'write' y un
         "dame la batería" pedido al agente terminaba en un "¿Lo hago?" que no
         tiene sentido. */
      riskFor: function (a) {
        var w = String(a && a.what || '').toLowerCase();
        return (w === 'bateria' || w === 'espacio' || w === 'web') ? 'read' : 'write';
      }
    });

  /* --- 7. mensaje (efecto real, pero lo confirma el usuario) -------------- */
  def('send_message',
    'SMS listo para que el usuario toque enviar.',
    {
      to: { type: 'string', required: true, desc: 'Contacto o número.' },
      text: { type: 'string', required: true, desc: 'El mensaje.' }
    },
    function (a) {
      var app = window.KiuApp;
      var quien = s(a.to, 40), cuerpo = s(a.text, MAX_ARG_LEN);
      if (!quien || !cuerpo) return { ok: false, err: 'falta a quién o qué decir' };
      var num = null;
      if (/^\+?[\d\s\-()]{6,}$/.test(quien)) num = quien.replace(/[^\d+]/g, '');
      else if (app && app.contactSearch) {
        var r = app.contactSearch(quien);
        if (r === 'NEED_PERM') return { ok: false, err: 'necesito permiso de contactos' };
        if (r && r.length) num = String(r[0].num || '').replace(/[^\d+]/g, '');
      }
      if (!num) return { ok: false, err: 'no encontré el número de "' + quien + '"' };
      var ok = app && app.bridgeCall ? app.bridgeCall('sms', [num, cuerpo]) : false;
      return { ok: !!ok, text: ok ? ('Te dejé el mensaje para ' + quien + ' listo en tus SMS. Tocá enviar para confirmar.') : 'No pude abrir los mensajes.' };
    }, { risk: 'write' });

  /* --- 8. memoria ------------------------------------------------------ */
  def('remember',
    'Guardar una nota («anotá…»).',
    { text: { type: 'string', required: true, desc: 'Qué guardar.' } },
    function (a) {
      var m = window.KiuMem;
      var t = s(a.text, MAX_ARG_LEN).trim();
      if (!t) return { ok: false, err: 'no sé qué guardar' };
      if (!m || !m.addRecuerdo) return { ok: false, err: 'no puedo guardar notas ahora' };
      m.addRecuerdo(t);
      return { ok: true, text: 'Anotado: ' + t };
    }, { risk: 'write' });

  /* --- 8-bis. LEER LA MEMORIA (v2.14.2) -----------------------------------
     Hasta acá la memoria era un callejón sin salida: `remember` la escribía
     y NADIE la leía desde el agente. El usuario le decía "acordate de que el
     dentista es el jueves" y dos turnos después el modelo no lo sabía: lo
     único que podía recuperar era brain.js, con regex, y un modelo no
     escribe regex.

     `recall` es esa puerta: buscar por palabras, como lo haría la persona.
     Sin query devuelve todo lo guardado, para que el agente pueda decir
     "qué tenés anotado" sin inventar filtros. */
  def('recall',
    'Buscar en lo que el usuario me hizo guardar.',
    {
      query: { type: 'string', required: false, desc: 'Palabra o frase. Vacío = todo.' },
      kind: { type: 'string', required: false, enum: ['recuerdos', 'tareas', 'notas', 'prefs'], desc: 'Qué tipo. Vacío = todos.' }
    },
    function (a) {
      var M = window.KiuMem;
      if (!M || typeof M.search !== 'function') return { ok: false, err: 'no tengo acceso a la memoria' };
      var q = s(a.query, MAX_ARG_LEN).trim();
      var kinds = (a.kind && String(a.kind).trim()) ? [String(a.kind).trim()] : null;
      var hits;
      try { hits = M.search(q, kinds) || []; } catch (e) { return { ok: false, err: 'la memoria no respondió' }; }
      if (!hits.length) {
        return { ok: true, text: q ? ('No encontré nada guardado con «' + q.slice(0, 40) + '».')
          : 'Todavía no hay nada guardado: ni recuerdos, ni tareas, ni notas.' };
      }
      var ETI = { recuerdos: 'recuerdo', tareas: 'tarea', notas: 'nota', prefs: 'preferencia' };
      var lines = hits.slice(0, 6).map(function (h) {
        return '- [' + (ETI[h.kind] || h.kind) + '] ' + String(h.text || '').slice(0, 120) + (h.done ? ' (hecha)' : '');
      });
      var cola = hits.length > 6 ? (' (te muestro 6 de ' + hits.length + ')') : '';
      return { ok: true, text: 'Guardado' + cola + ':\n' + lines.join('\n') };
    });

  /* --- 8-ter. LAS TAREAS (v2.14.2) ----------------------------------------
     La lista de tareas era de brain.js: "tarea: X" la creaba, "mis tareas" la
     listaba, "terminé la tarea" la completaba. Todo por regex y con tres
     frases distintas. Acá es UNA herramienta con tres acciones, que es el
     estilo que el propio proyecto ya eligió para el resto (device_action). */
  def('manage_task',
    'Ver, crear o completar tareas pendientes.',
    {
      action: { type: 'string', required: true, enum: ['list', 'add', 'done'], desc: 'list=ver, add=crear, done=hecha.' },
      text: { type: 'string', required: false, desc: 'La tarea. Para done: cuál (vacío=la primera).' }
    },
    function (a) {
      var M = window.KiuMem;
      if (!M) return { ok: false, err: 'no tengo acceso a la memoria' };
      var action = String(a.action || '').toLowerCase();
      if (action === 'add') {
        var t = s(a.text, MAX_ARG_LEN).trim();
        if (!t) return { ok: false, err: 'decime qué tarea agregar' };
        M.addTarea(t);
        var pend = M.pendingTasks ? M.pendingTasks().length : M.count('tareas');
        return { ok: true, text: 'Tarea agregada: "' + t + '". Te quedan ' + pend + ' pendiente' + (pend === 1 ? '' : 's') + '.' };
      }
      if (action === 'done') {
        var q = s(a.text, 80).trim();
        return { ok: true, text: M.completeTarea(q) };
      }
      /* list */
      var pend2 = M.pendingTasks ? M.pendingTasks() : M.list('tareas').filter(function (x) { return !x.done; });
      if (!pend2.length) return { ok: true, text: 'No tenés tareas pendientes.' };
      var lineas = pend2.slice(0, 8).map(function (x, i) { return (i + 1) + '. ' + String(x.text || '').slice(0, 100); });
      return { ok: true, text: 'Tenés ' + pend2.length + ' pendiente' + (pend2.length === 1 ? '' : 's') + ':\n' + lineas.join('\n') };
    },
    { risk: 'write', riskFor: function (a) { return String(a && a.action || '').toLowerCase() === 'list' ? 'read' : 'write'; } });

  /* --- 8-cuater. LAS ALARMAS (v2.14.2) ------------------------------------
     Ver y cancelar recordatorios. `set_alarm` ya los creaba; no había forma
     de verlos ni de bajarlos, salvo por la pantalla de Ajustes. */
  def('manage_alarm',
    'Ver o cancelar alarmas y recordatorios.',
    {
      action: { type: 'string', required: true, enum: ['list', 'cancel'], desc: 'list=ver, cancel=borrar.' },
      which: { type: 'string', required: false, desc: 'Título a cancelar. Para list, no hace falta.' }
    },
    function (a) {
      var app = window.KiuApp;
      if (!app || typeof app.reminders !== 'function') return { ok: false, err: 'no tengo acceso a las alarmas' };
      var action = String(a.action || '').toLowerCase();
      var lista = app.reminders() || [];
      if (action === 'cancel') {
        var q = s(a.which, 60).trim();
        if (!q) return { ok: false, err: 'decime qué alarma cancelar' };
        var found = app.cancelReminderByTitle ? app.cancelReminderByTitle(q) : null;
        if (!found) return { ok: false, err: 'no encontré ninguna alarma con «' + q.slice(0, 40) + '»' };
        return { ok: true, text: 'Cancelé la alarma "' + String(found.title || '').slice(0, 60) + '".' };
      }
      if (!lista.length) return { ok: true, text: 'No tenés alarmas programadas.' };
      var ls = lista.slice(0, 8).map(function (r) {
        return '- ' + String(r.title || '(sin título)') + ' — ' + String(r.date || '');
      });
      return { ok: true, text: 'Tenés ' + lista.length + ' alarma' + (lista.length === 1 ? '' : 's') + ':\n' + ls.join('\n') };
    },
    { risk: 'write', riskFor: function (a) { return String(a && a.action || '').toLowerCase() === 'list' ? 'read' : 'write'; } });

  /* --- 8-quater. CREAR UN EVENTO (v2.14.2) --------------------------------
     El cerebro sabía crear eventos ("agenda X mañana a las 15") por regex,
     pero el agente no tenía ninguna herramienta para hacerlo: era la única
     acción del calendario que faltaba y la más pedida. */
  def('create_calendar_event',
    'Crear un evento en el calendario.',
    {
      title: { type: 'string', required: true, desc: 'Qué es el evento.' },
      when: { type: 'string', required: true, desc: '"mañana a las 15", "en 2 horas".' }
    },
    function (a) {
      var app = window.KiuApp, brain = window.KiuBrain;
      var titulo = s(a.title, 80).trim();
      if (!titulo) return { ok: false, err: 'falta el título del evento' };
      var w = null;
      if (brain && brain.parseWhen) { try { w = brain.parseWhen(String(a.when || '')); } catch (e) { w = null; } }
      if (!w || !w.when) return { ok: false, err: 'no entendí el horario "' + s(a.when, 40) + '"' };
      if (!app || typeof app.addCalendarEvent !== 'function') return { ok: false, err: 'no puedo abrir el calendario' };
      app.addCalendarEvent(titulo, w.when.getTime());
      return { ok: true, text: 'Te abrí el calendario con el evento "' + titulo + '" para ' + w.whenTxt + '. Confirmalo ahí y queda guardado.' };
    },
    { risk: 'write' });

  /* --- 8-seis. OLVIDAR (v2.14.2) -----------------------------------------
     La memoria tenía `remember` (escribir) y `recall` (leer), pero no
     tenía forma de BORRAR. Una memoria que solo crece es un archivo: el
     usuario cambia de opinión ("ya no es el martes") y el agente le sigue
     contestando lo viejo, con total confianza, hasta que el usuario lo
     corrige a mano en la pantalla. */
  def('forget',
    'Borrar de la memoria algo que el usuario ya no quiere que guarde.',
    {
      text: { type: 'string', required: true, desc: 'Lo que hay que olvidar. Una parte del texto alcanza.' }
    },
    function (a) {
      var M = window.KiuMem;
      if (!M || typeof M.forget !== 'function') return { ok: false, err: 'no tengo acceso a la memoria' };
      var q = s(a.text, MAX_ARG_LEN).trim();
      if (!q) return { ok: false, err: 'no sé qué hay que olvidar' };
      var n = M.forget(q, null);
      if (!n) return { ok: true, text: 'No encontré nada guardado con «' + q.slice(0, 40) + '» para olvidar.' };
      return { ok: true, text: 'Olvidé ' + n + ' cosa' + (n === 1 ? '' : 's') + ' con «' + q.slice(0, 40) + '».' };
    },
    { risk: 'write' });

  /* --- 8-siete. CORREGIR (v2.14.2) ---------------------------------------
     "Ya no es el martes, es el jueves": el agente tiene que poder corregir
     lo que guardó, no agregar un recuerdo nuevo al lado del viejo. */
  def('update_memory',
    'Corregir algo que ya está guardado (por ejemplo: el dentista ya no es el martes, es el jueves).',
    {
      text: { type: 'string', required: true, desc: 'El texto viejo, o una parte de él.' },
      new_text: { type: 'string', required: true, desc: 'El texto correcto, completo.' }
    },
    function (a) {
      var M = window.KiuMem;
      if (!M || typeof M.updateByText !== 'function') return { ok: false, err: 'no tengo acceso a la memoria' };
      var viejo = s(a.text, MAX_ARG_LEN).trim();
      var nuevo = s(a.new_text, MAX_ARG_LEN).trim();
      if (!viejo || !nuevo) return { ok: false, err: 'falta el texto viejo o el nuevo' };
      var n = 0;
      var lista = ['recuerdos', 'tareas', 'notas', 'prefs'];
      for (var i = 0; i < lista.length; i++) n += M.updateByText(lista[i], viejo, nuevo);
      if (!n) return { ok: true, text: 'No encontré nada guardado con «' + viejo.slice(0, 40) + '» para corregir.' };
      return { ok: true, text: 'Corregí ' + n + ' cosa' + (n === 1 ? '' : 's') + ': ahora dice «' + nuevo.slice(0, 60) + '».' };
    },
    { risk: 'write' });

  /* --- 9. fecha y hora (el modelo no tiene reloj) ----------------------- */
  def('now',
    'Fecha y hora de hoy.',
    {},
    function () {
      var d = new Date();
      var dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
      var meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
      var hh = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
      return { ok: true, text: 'Hoy es ' + dias[d.getDay()] + ' ' + d.getDate() + ' de ' + meses[d.getMonth()] + ' de ' + d.getFullYear() + ', son las ' + hh + '.' };
    });

  /* --- 10. web (asíncrona: devuelve una promesa; el bucle la espera) ------ */
  /* v2.14.2 · la búsqueda web vive en UNA función. Antes el enum de
     device_action ofrecía "web" y "youtube" pero la herramienta no tenía
     camino para ninguno de los dos: el modelo los elegía y la llamada
     terminaba siempre en "no pude cumplir". Un valor del enum que no
     funciona es peor que no ofrecerlo: le enseña al modelo una capacidad
     que no existe. */
  function buscarWeb(q) {
    var app = window.KiuApp;
    if (!app || typeof app.webSnippets !== 'function') {
      return Promise.resolve({ ok: false, err: 'no puedo buscar en la web ahora' });
    }
    return new Promise(function (resolve) {
      try {
        app.webSnippets(q, function (lista) {
          if (!lista || !lista.length) { resolve({ ok: false, err: 'no encontré nada en la web (¿sin conexión?)' }); return; }
          resolve({
            ok: true,
            text: 'Resultados de la web sobre «' + String(q).slice(0, 40) + '»:\n' +
              lista.map(function (x, i) { return (i + 1) + ') ' + x.t + ': ' + x.s; }).join('\n')
          });
        });
      } catch (e) { resolve({ ok: false, err: 'la búsqueda falló' }); }
    });
  }

  def('web_search',
    'Buscar datos actuales en internet (noticias, precios, clima, «quién es…»).',
    { query: { type: 'string', required: true, desc: 'Palabras clave.' } },
    function (a) {
      var q = s(a.query, MAX_ARG_LEN).trim();
      if (!q) return { ok: false, err: 'no sé qué buscar' };
      return buscarWeb(q);
    });

  /* --- 11. CLIMA (v2.16.0) -----------------------------------------------
     Antes el clima iba por web_search, que devuelve el resumen de DuckDuckGo:
     sirve para "quién es X", no para "¿llueve mañana?". Open-Meteo da el dato
     real y sin clave. La ciudad se aprende: la última que el usuario nombró
     queda como predeterminada para "¿llueve?" a secas y para el resumen. */
  var CIUDAD_KEY = 'kiu_ciudad';
  function ciudadPorDefecto() {
    try { if (window.S && window.S.city) return s(window.S.city, 60); } catch (e) { }
    try { return s(localStorage.getItem(CIUDAD_KEY), 60); } catch (e) { return ''; }
  }
  function guardarCiudad(c) { try { localStorage.setItem(CIUDAD_KEY, s(c, 60)); } catch (e) { } }
  function climaTexto(code) {
    var c = Number(code);
    if (c === 0) return 'despejado';
    if (c <= 2) return 'algo nublado';
    if (c === 3) return 'nublado';
    if (c === 45 || c === 48) return 'con niebla';
    if (c >= 51 && c <= 57) return 'con llovizna';
    if (c >= 61 && c <= 67) return 'con lluvia';
    if (c >= 71 && c <= 77) return 'con nieve';
    if (c >= 80 && c <= 82) return 'con chubascos';
    if (c >= 95) return 'con tormenta';
    return 'variable';
  }
  function climaFrase(w, dia) {
    var i = dia === 'pasado' ? 2 : dia === 'manana' ? 1 : 0;
    var d = w.days && w.days[i];
    if (!d) return 'sin pronóstico para ese día';
    var cuando = i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : 'Pasado mañana';
    var t = cuando + ' en ' + w.place + ': ' + climaTexto(d.code) + ', entre ' + Math.round(d.min) + '° y ' + Math.round(d.max) + '°';
    if (d.rain !== null && d.rain !== undefined) t += ', ' + Math.round(d.rain) + '% de probabilidad de lluvia';
    if (i === 0 && w.cur) t += ' (ahora ' + Math.round(w.cur.temp) + '°, viento ' + Math.round(w.cur.wind) + ' km/h)';
    return t + '.';
  }
  function diaClave(txt) {
    var x = sinAcentos(txt || '');
    return /pasado/.test(x) ? 'pasado' : /manana/.test(x) ? 'manana' : 'hoy';
  }
  function pedirClima(lugar) {
    var app = window.KiuApp;
    if (!app || typeof app.weatherQuery !== 'function') return Promise.resolve(null);
    return new Promise(function (resolve) {
      try { app.weatherQuery(lugar, function (w) { resolve(w || null); }); } catch (e) { resolve(null); }
    });
  }
  def('get_weather',
    'Clima y pronóstico: "¿llueve mañana?", "qué temperatura hace".',
    {
      place: { type: 'string', required: false, desc: 'Ciudad. Vacío = la última usada o donde está el usuario.' },
      day: { type: 'string', required: false, enum: ['hoy', 'mañana', 'pasado'], desc: 'Qué día. Por defecto hoy.' }
    },
    function (a) {
      var dado = s(a.place, 60).trim();
      var aqui = !dado || /^(aqu[ií]|ac[aá]|donde estoy|mi ubicaci[oó]n)$/i.test(dado);
      var lugar = aqui ? ciudadPorDefecto() : dado;
      /* v2.17.0 · sin ciudad conocida, la ubicación aproximada del teléfono (si dio permiso) */
      if (!lugar) {
        var pos = window.KiuApp && typeof window.KiuApp.locationNow === 'function' ? window.KiuApp.locationNow() : null;
        if (pos === 'NEED_PERM') return { ok: false, err: 'necesito el permiso de ubicación (te lo pedí en pantalla) o decime la ciudad' };
        if (pos) lugar = { lat: pos.lat, lon: pos.lon };
      }
      if (!lugar) return { ok: false, err: 'decime de qué ciudad querés el clima' };
      return pedirClima(lugar).then(function (w) {
        if (!w) return { ok: false, err: 'no pude consultar el clima (¿sin conexión o ciudad inexistente?)' };
        if (dado && !aqui) guardarCiudad(dado);
        return { ok: true, text: climaFrase(w, diaClave(a.day)) };
      });
    });

  /* --- 12. LEER UNA PÁGINA (v2.16.0) ---------------------------------------
     web_search da fragmentos; esto trae la página. El texto va acotado: el
     modelo del teléfono lo resume, pero un prefill largo cuesta segundos. */
  def('summarize_url',
    'Leer una página web y resumirla.',
    { url: { type: 'string', required: true, desc: 'Dirección https://… de la página.' } },
    function (a) {
      var u = s(a.url, 300).trim();
      if (!/^https:\/\//i.test(u)) return { ok: false, err: 'necesito una dirección que empiece con https://' };
      var app = window.KiuApp;
      if (!app || typeof app.pageText !== 'function') return { ok: false, err: 'no puedo leer páginas ahora' };
      return new Promise(function (resolve) {
        try {
          app.pageText(u, function (txt) {
            var limpio = s(txt, 6000).replace(/\s+/g, ' ').trim();
            if (limpio.length < 40) { resolve({ ok: false, err: 'no pude leer esa página (¿sin conexión o bloqueada?)' }); return; }
            resolve({ ok: true, text: 'Contenido de ' + u + ':\n' + limpio.slice(0, 1800) });
          });
        } catch (e) { resolve({ ok: false, err: 'la lectura de la página falló' }); }
      });
    });

  /* --- 13. GASTOS (v2.16.0) -------------------------------------------------
     Registro por voz: "gasté 12 en almuerzo". Local, sin red. */
  var GASTOS_KEY = 'kiu_gastos';
  function leerGastos() {
    try { var l = JSON.parse(localStorage.getItem(GASTOS_KEY) || '[]'); return Array.isArray(l) ? l : []; } catch (e) { return []; }
  }
  function guardarGastos(l) {
    try { localStorage.setItem(GASTOS_KEY, JSON.stringify(l.slice(-500))); return true; } catch (e) { return false; }
  }
  function mesActual(ts) { var d = new Date(ts), h = new Date(); return d.getFullYear() === h.getFullYear() && d.getMonth() === h.getMonth(); }
  function dinero(n) { return (Math.round(n * 100) / 100).toLocaleString('es', { maximumFractionDigits: 2 }); }
  def('log_expense',
    'Anotar o consultar gastos: "gasté 12 en almuerzo", "cuánto gasté este mes".',
    {
      action: { type: 'string', required: true, enum: ['add', 'list', 'total'], desc: 'add=anotar, list=últimos, total=suma del mes.' },
      amount: { type: 'number', required: false, desc: 'Monto. Solo para add.' },
      what: { type: 'string', required: false, desc: 'En qué se gastó. Corto.' }
    },
    function (a) {
      var action = String(a.action || '').toLowerCase();
      var l = leerGastos();
      if (action === 'add') {
        var m = num(a.amount);
        if (m === null || m <= 0 || m > 1e9) return { ok: false, err: 'decime cuánto fue (un número mayor que cero)' };
        var que = s(a.what, 60).trim() || 'sin detalle';
        l.push({ m: m, w: que, t: Date.now() });
        if (!guardarGastos(l)) return { ok: false, err: 'no pude guardar el gasto' };
        var mes = l.filter(function (x) { return mesActual(x.t); }).reduce(function (n, x) { return n + x.m; }, 0);
        return { ok: true, text: 'Anotado: ' + dinero(m) + ' en ' + que + '. Este mes llevás ' + dinero(mes) + '.' };
      }
      var delMes = l.filter(function (x) { return mesActual(x.t); });
      if (action === 'total') {
        if (!delMes.length) return { ok: true, text: 'Este mes no anotaste gastos.' };
        return { ok: true, text: 'Este mes gastaste ' + dinero(delMes.reduce(function (n, x) { return n + x.m; }, 0)) + ' en ' + delMes.length + ' gasto' + (delMes.length === 1 ? '' : 's') + '.' };
      }
      if (!l.length) return { ok: true, text: 'Todavía no anotaste gastos.' };
      return { ok: true, text: 'Últimos gastos:\n' + l.slice(-5).reverse().map(function (x) { return '· ' + dinero(x.m) + ' — ' + x.w; }).join('\n') };
    },
    { risk: 'write', riskFor: function (a) { return String(a && a.action || '').toLowerCase() === 'add' ? 'write' : 'read'; } });

  /* --- 14. RESUMEN DEL DÍA (v2.16.0) -----------------------------------------
     Una sola decisión del modelo en vez de cuatro: fecha, agenda de hoy,
     tareas pendientes, alarmas y (si hay ciudad conocida) el clima. Cada
     pieza falla por separado y el resumen sigue con las demás. */
  def('daily_briefing',
    'Resumen del día: agenda, tareas, alarmas y clima. "Buen día", "qué tengo hoy".',
    {},
    function () {
      var partes = [], app = window.KiuApp, M = window.KiuMem;
      var f = TOOLS.now.run({});
      if (f && f.text) partes.push(f.text);
      try {
        if (app && typeof app.calendarQuery === 'function') {
          var ini = Date.now(), fin = new Date(new Date().setHours(24, 0, 0, 0)).getTime();
          var ev = app.calendarQuery('', ini, fin);
          if (Array.isArray(ev)) {
            partes.push(ev.length ? 'Agenda de hoy: ' + ev.slice(0, 5).map(function (e) { return s(e.title || e.t, 50); }).join('; ') + '.' : 'No tenés eventos en la agenda hoy.');
          }
        }
      } catch (e) { }
      try {
        if (M && typeof M.pendingTasks === 'function') {
          var pend = M.pendingTasks();
          partes.push(pend.length ? 'Tareas pendientes (' + pend.length + '): ' + pend.slice(0, 3).map(function (x) { return s(x.text, 60); }).join('; ') + '.' : 'No tenés tareas pendientes.');
        }
      } catch (e) { }
      try {
        if (app && typeof app.reminders === 'function') {
          var hoy = new Date(new Date().setHours(24, 0, 0, 0)).getTime();
          var al = (app.reminders() || []).filter(function (r) { return r.when > Date.now() && r.when < hoy; });
          if (al.length) partes.push('Alarmas hoy: ' + al.length + '.');
        }
      } catch (e) { }
      var ciudad = ciudadPorDefecto();
      var cierre = function (w) {
        if (w) partes.push(climaFrase(w, 'hoy'));
        return { ok: true, text: partes.join('\n') };
      };
      if (!ciudad) return cierre(null);
      return pedirClima(ciudad).then(cierre);
    });

  /* --- 15. NOTIFICACIONES (v2.17.0) -----------------------------------------
     "¿Qué me llegó?", "¿escribió Ana?". Solo lo que quedó en la RAM desde que el
     usuario activó el acceso. Lo que se lee lo ve el modelo LOCAL del teléfono: el
     bucle del agente no corre con proveedores en la nube. */
  function cuando(ms) {
    var d = new Date(ms), hoy = new Date();
    var hh = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    return d.toDateString() === hoy.toDateString() ? hh : (d.getDate() + '/' + (d.getMonth() + 1) + ' ' + hh);
  }
  def('read_notifications',
    'Leer las últimas notificaciones: "¿qué me llegó?", "¿escribió Ana?".',
    {
      from: { type: 'string', required: false, desc: 'App o persona a buscar (WhatsApp, Gmail, Ana). Vacío = todas.' }
    },
    function (a) {
      var app = window.KiuApp;
      if (!app || typeof app.notifQuery !== 'function') return { ok: false, err: 'no puedo leer notificaciones ahora' };
      var r = app.notifQuery(s(a.from, 40), 6);
      if (r === 'NEED_PERM') return { ok: false, err: 'primero activá "Acceso a notificaciones" para Kiu (te abrí la pantalla) y volvé a preguntarme' };
      if (r === null) return { ok: false, err: 'no pude leer las notificaciones' };
      if (!r.length) return { ok: true, text: s(a.from, 40) ? 'No encontré notificaciones de "' + s(a.from, 40) + '".' : 'No hay notificaciones nuevas desde que activaste el acceso.' };
      return { ok: true, text: 'Notificaciones recientes:\n' + r.map(function (n) {
        return '· ' + cuando(n.w) + ' ' + n.a + (n.t ? ' — ' + n.t : '') + (n.x ? ': ' + n.x : '');
      }).join('\n') };
    });

  /* --- 16. SMS (v2.17.0) -------------------------------------------------------- */
  def('read_sms',
    'Leer los últimos SMS recibidos: "¿me escribió el banco?", "leeme mis mensajes".',
    {
      from: { type: 'string', required: false, desc: 'Número o texto a buscar. Vacío = los últimos.' }
    },
    function (a) {
      var app = window.KiuApp;
      if (!app || typeof app.smsQuery !== 'function') return { ok: false, err: 'no puedo leer SMS ahora' };
      var r = app.smsQuery(s(a.from, 40), 4);
      if (r === 'NEED_PERM') return { ok: false, err: 'necesito el permiso de SMS (te lo pedí en pantalla); aceptalo y volvé a preguntarme' };
      if (r === null) return { ok: false, err: 'no pude leer los SMS' };
      if (!r.length) return { ok: true, text: 'No encontré SMS' + (s(a.from, 40) ? ' de "' + s(a.from, 40) + '"' : '') + '.' };
      return { ok: true, text: 'SMS recientes:\n' + r.map(function (m) { return '· ' + cuando(m.w) + ' ' + m.f + ': ' + m.x; }).join('\n') };
    });

  /* --- 17. MÚSICA (v2.17.0) ----------------------------------------------------- */
  def('media_control',
    'Controlar la música o el video que suena: pausar, seguir, siguiente, anterior.',
    { action: { type: 'string', required: true, enum: ['play', 'pause', 'next', 'previous'], desc: 'play/pause=alternar, next=siguiente, previous=anterior.' } },
    function (a) {
      var app = window.KiuApp;
      var act = String(a.action || '').toLowerCase();
      if (!app || typeof app.mediaKey !== 'function') return { ok: false, err: 'no puedo controlar la música ahora' };
      if (['play', 'pause', 'next', 'previous'].indexOf(act) < 0) return { ok: false, err: 'acción de música desconocida' };
      var ok = app.mediaKey(act);
      var dicho = { play: 'Listo, play/pausa.', pause: 'Listo, play/pausa.', next: 'Pasé a la siguiente.', previous: 'Volví a la anterior.' };
      return { ok: !!ok, text: ok ? dicho[act] : 'No pude controlar el reproductor.' };
    },
    { risk: 'write' });

  /* --- 18. RUTINAS (v2.18.0) --------------------------------------------------
     "Todos los días a las 8 dame el resumen", "los domingos a las 20 avisame si llueve
     mañana". La lógica vive en kiu-rutinas.js; esto solo traduce los argumentos. Crear o
     borrar pide confirmación; ver la lista no. Una rutina solo puede LEER (ver ese archivo). */
  def('manage_routine',
    'Ver, crear o borrar rutinas automáticas a cierta hora: "todos los días a las 8 el resumen".',
    {
      action: { type: 'string', required: true, enum: ['list', 'add', 'remove'], desc: 'list=ver, add=crear, remove=borrar.' },
      name: { type: 'string', required: false, desc: 'Nombre corto. Para remove: cuál.' },
      at: { type: 'string', required: false, desc: 'Hora: "8", "20:30".' },
      days: { type: 'string', required: false, desc: '"lunes y jueves", "fines de semana". Vacío = todos los días.' },
      what: { type: 'string', required: false, enum: ['resumen', 'clima', 'agenda', 'tareas', 'decir'], desc: 'Qué hacer. Por defecto resumen.' },
      if_rain: { type: 'string', required: false, enum: ['no', 'hoy', 'mañana'], desc: 'Solo avisar si llueve ese día.' },
      text: { type: 'string', required: false, desc: 'Solo para what=decir.' }
    },
    function (a) {
      var R = window.KiuRutinas;
      if (!R) return { ok: false, err: 'las rutinas no están disponibles' };
      var action = String(a.action || '').toLowerCase();
      if (action === 'add') {
        var r = R.add({ name: a.name, at: a.at, days: a.days, what: a.what, ifRain: a.if_rain, text: a.text });
        if (!r.ok) return { ok: false, err: r.err };
        var nf = R.nextFire(r.routine);
        R.programarDespertadores();
        return { ok: true, text: 'Rutina creada — ' + R.dicho(r.routine) + (nf ? '. La próxima es ' + nf.toLocaleString('es', { weekday: 'long', hour: '2-digit', minute: '2-digit' }) + '.' : '.') +
          ' Corre cuando Kiu está abierto; con la app cerrada te suena una alarma y al tocarla se ejecuta.' };
      }
      if (action === 'remove') {
        var q = s(a.name, 40).trim();
        if (!q) return { ok: false, err: 'decime cuál rutina borrar' };
        var del = R.remove(q);
        return del ? { ok: true, text: 'Borré la rutina "' + del.name + '".' } : { ok: false, err: 'no encontré una rutina "' + q + '"' };
      }
      var l = R.all();
      if (!l.length) return { ok: true, text: 'No tenés rutinas. Pedime una: "todos los días a las 8 dame el resumen".' };
      return { ok: true, text: 'Tus rutinas:\n' + l.map(function (x) { return '· ' + R.dicho(x); }).join('\n') };
    },
    { risk: 'write', riskFor: function (a) { return String(a && a.action || '').toLowerCase() === 'list' ? 'read' : 'write'; } });

  /* --- AUTOPRUEBA (v2.19.0) ------------------------------------------------
     UNA decisión del modelo cargado en el teléfono, SIN ejecutar la herramienta: mismo
     prompt, misma selección y misma gramática que el bucle real, para medir si el modelo
     elige bien. Lo usa kiu-autoprueba.js. Nunca toca el dispositivo. */
  function probarDecision(pedido, cb) {
    var K = window.Kiu;
    if (!K || typeof K.ask !== 'function') { cb({ ok: false, err: 'sin motor' }); return; }
    var nombre = String(window.S && window.S.kiu && window.S.kiu.name || '');
    var hermes = /hermes/i.test(nombre);
    var herr = seleccionar(pedido), harness = null;
    try { harness = window.KiuHarness2 && window.KiuHarness2.choose({ modelName: nombre }); } catch (e) { harness = null; }
    var hist = [
      { role: 'system', content: systemPrompt(s(pedido, 300), herr, [], 1, harness && harness.id === 'Harness-Local-Compact', hermes, herramientasConPalabras(herr, pedido)) },
      { role: 'user', content: s(pedido, 300) }
    ];
    var gb = null;
    try { gb = grammar(herr, hermes, false); } catch (e2) { gb = null; }
    var t0 = Date.now(), espera = 0;
    (function pedir() {
      K.ask(hist, (harness && harness.maxTokens) || 120, function (res) {
        if (res && !res.ok && /ocupado/i.test(String(res.err || '')) && espera++ < 20) { setTimeout(pedir, 1200); return; }
        var ms = Date.now() - t0;
        if (!res || !res.ok || !res.text) { cb({ ok: false, err: (res && res.err) || 'sin respuesta', ms: ms }); return; }
        var d = parseDecision(res.text), rd = d ? readDecision(d) : null;
        var v = rd && !rd.bad ? validate(rd.name, rd.raw) : null;
        cb({
          ok: true, ms: ms, tps: res.tps || 0, raw: s(res.text, 160),
          tool: rd && !rd.bad ? rd.name : null,
          args: v && v.ok ? v.args : (rd && rd.raw) || null,
          valida: !!(v && v.ok), listo: !!(d && isDone(d))
        });
      }, null, gb);
    })();
  }

  /* v2.13.1 · REGISTRO de lo que hizo el agente: solo metadatos (herramienta, riesgo,
     resultado, hora), nunca los argumentos ni el texto del usuario. Máx. 30. */
  var LOG = [];
  function registrar(name, risk, ok, nota) {
    LOG.push({ tool: name, risk: risk || 'read', ok: !!ok, note: s(nota, 80), at: Date.now() });
    if (LOG.length > 30) LOG.shift();
  }

  /* v2.13.1 · SELECCIÓN de herramientas por turno. Con 10 herramientas el manifiesto
     completo cuesta ~340 tokens de prefill en cada decisión. La mayoría de los pedidos
     tocan 1 o 2: se mandan solo las que tienen una palabra clave en el pedido. Si ninguna
     coincide (o el pedido es raro) se mandan TODAS: nunca se le quita al modelo la
     herramienta correcta por un regex corto. */
  /* v2.14.4 · LAS PALABRAS CLAVE SON PALABRAS, NO REGEX.
     Eran regex: un solo patrón por herramienta, así que "prefiero el mate
     amargo" no matcheaba NADA (nadie decía "prefiero") y "llévame al
     aeropuerto" tampoco (nadie decía "maps"). Cuando no matcheaba nada se
     devolvían las 16 herramientas en el orden del registro, y el ejemplo
     del prompt era el de la primera: set_alarm. El modelo copiaba el
     ejemplo y armaba una alarma donde le habían pedido un mapa.
     Ahora cada herramienta tiene su lista, se cuentan las palabras que
     matchean (cuántas más, más específica) y el pedido gana la más
     específica. Es la misma idea que el KW elige, pero afinable palabra por
     palabra — y el arnés de evaluación dice si está bien o no. */
  var KW = {
    set_alarm: ['alarma', 'alarmas', 'recordatorio', 'recordatorios', 'despiertame', 'despiertá', 'despertar', 'avisame', 'avisá', 'recordá', 'recordame', 'poneme una alarma', 'poné una alarma'],
    read_calendar: ['agenda', 'calendario', 'reunion', 'reunión', 'evento', 'eventos', 'cita', 'citas', 'agendá', 'dia', 'día', 'mañana', 'manana', 'ayer', 'semana', 'tengo'],
    find_contact: ['contacto', 'contactos', 'numero', 'número', 'telefono', 'teléfono', 'celular', 'quien es', 'dónde está', 'donde esta', 'numero de'],
    call_contact: ['llamar', 'llamá', 'llame', 'llama', 'marcá', 'marcar', 'telefonear'],
    search_docs: ['documento', 'documentos', 'archivo', 'archivos', 'pdf', 'apunte', 'apuntes', 'contrato', 'segun mis', 'según mis', 'en mis'],
    device_action: ['linterna', 'bateria', 'batería', 'espacio', 'disco', 'abrí', 'abrir', 'abre', 'maps', 'mapa', 'temporizador', 'timer', 'navegá', 'ruta', 'llevame', 'llévame', 'como llego', 'cómo llego', 'aeropuerto', 'youtube', 'memoria ram'],
    send_message: ['mensaje', 'sms', 'escribí', 'escribi', 'mandá', 'manda', 'enviá', 'envia', 'whatsapp', 'decile', 'decí', 'avisale', 'avisá'],
    remember: ['recordá', 'recorda', 'anotá', 'anota', 'guardá', 'guarda', 'acordate', 'prefiero', 'prefiero', 'me gusta', 'no me gusta', 'apuntá', 'apuntate'],
    recall: ['recordá', 'recuerdos', 'recuerdo', 'anoté', 'anote', 'anotado', 'guardé', 'guarde', 'guardado', 'guardados', 'mi memoria', 'que se', 'qué sé', 'buscá en tu memoria', 'preguntáte', 'que tengo guardado', 'qué tengo guardado', 'que era', 'qué era', 'cuando era', 'cuándo era'],
    manage_task: ['tarea', 'tareas', 'pendiente', 'pendientes', 'to do', 'todo', 'agendame una tarea', 'tengo una tarea', 'tengo tareas'],
    manage_alarm: ['alarma', 'alarmas', 'recordatorio', 'recordatorios', 'cancelá', 'cancela', 'borra la alarma', 'borrala', 'quitala', 'eliminá', 'elimina'],
    create_calendar_event: ['evento', 'eventos', 'agendá', 'agendar', 'agenda un', 'agendá un', 'calendario', 'reunión', 'cita', 'invitación', 'turno', 'meeting', 'agendame un'],
    forget: ['olvidá', 'olvida', 'olvidate', 'no quiero guardar', 'sacá', 'saca', 'borra mi', 'elimina mi'],
    update_memory: ['corregí', 'corregir', 'corrige', 'cambiá', 'cambia', 'reemplazá', 'en realidad', 'ahora es', 'ya no es', 'no era', 'equivocad', 'es el'],
    now: ['hora', 'fecha', 'que dia', 'qué día', 'hoy es', 'que fecha', 'qué fecha', 'que horas'],
    read_notifications: ['notificacion', 'notificaciones', 'notificación', 'llego', 'llegó', 'me llego', 'me llegó', 'escribio', 'escribió', 'novedades', 'avisos'],
    read_sms: ['sms', 'mensajes de texto', 'mensaje de texto', 'banco', 'codigo', 'código', 'leeme mis mensajes', 'leeme los mensajes'],
    media_control: ['musica', 'música', 'cancion', 'canción', 'pausa', 'pausar', 'pausá', 'reproducir', 'siguiente', 'anterior', 'saltá', 'saltar', 'tema', 'volumen', 'play'],
    manage_routine: ['rutina', 'rutinas', 'cada', 'todos los', 'todas las', 'automatico', 'automaticamente', 'los lunes', 'los martes', 'los miercoles', 'los jueves', 'los viernes', 'los sabados', 'los domingos', 'fines de semana', 'avisame si', 'siempre que'],
    get_weather: ['clima', 'tiempo', 'llueve', 'lluvia', 'llover', 'llovera', 'lloviendo', 'va llover', 'hace calor', 'hace frio', 'temperatura', 'pronostico', 'pronóstico', 'paraguas', 'calor', 'frio', 'frío', 'nublado', 'hace sol'],
    summarize_url: ['resumi', 'resumí', 'resume', 'resumen de', 'pagina', 'página', 'articulo', 'artículo', 'link', 'enlace', 'url', 'https', 'leé', 'lee esta'],
    log_expense: ['gaste', 'gasté', 'gasto', 'gastos', 'gastar', 'pague', 'pagué', 'compre', 'compré', 'costo', 'presupuesto'],
    daily_briefing: ['buen dia', 'buen día', 'buenos dias', 'resumen del dia', 'resumen del día', 'briefing', 'que tengo hoy', 'qué tengo hoy', 'mi dia', 'mi día', 'como viene el dia', 'cómo viene el día'],
    web_search: ['buscá', 'busca', 'buscar', 'investiga', 'noticias', 'precio', 'precios', 'clima', 'tiempo', 'cotizacion', 'cotización', 'quien es', 'que es', 'internet', 'web', 'google', 'dolar', 'dólar', 'cuanto sale']
  };
  /* las que CONSULTAN (no modifican nada) */
  var LECTURA = {
    read_calendar: 1, find_contact: 1, search_docs: 1, recall: 1,
    manage_task: 1, manage_alarm: 1, now: 1, web_search: 1,
    get_weather: 1, summarize_url: 1, daily_briefing: 1, read_notifications: 1, read_sms: 1, manage_routine: 1
  };
  function esLectura(n) { return !!LECTURA[n]; }
  /* v2.14.4 · DESEMPATE EXPRESO. Cuando dos herramientas matchean la misma
     cantidad de palabras ("qué tareas tengo" → manage_task y read_calendar),
     el orden del registro decidía y a veces decidía mal. Con esta tabla el
     desempate es explícito y revisable: "qué tarea tengo pendiente" es una
     tarea; "qué tengo mañana" es la agenda. */
  var PRIORIDAD = {
    manage_task: 3, recall: 3, manage_alarm: 3, create_calendar_event: 3,
    read_calendar: 2, device_action: 2, web_search: 2, get_weather: 3, manage_routine: 4, read_notifications: 3, read_sms: 3, media_control: 3, summarize_url: 3, log_expense: 3, daily_briefing: 3, find_contact: 2, search_docs: 2,
    set_alarm: 1, send_message: 1, remember: 1, now: 1, forget: 1, update_memory: 1
  };
  /* ¿alguno de estos tools matcheó palabras del pedido? */
  function herramientasConPalabras(lista, pedido) {
    var pal = palabrasPedido(pedido);
    for (var i = 0; i < lista.length; i++) {
      if (cuentaPalabras(pal, KW[lista[i]]) > 0) return true;
    }
    return false;
  }
  /* palabras del pedido, normalizadas como las del cerebro */
  function palabrasPedido(t) {
    var out = [];
    var ps = String(t || '').toLowerCase()
      .replace(/[áàä]/g, 'a').replace(/[éèë]/g, 'e').replace(/[íìï]/g, 'i')
      .replace(/[óòö]/g, 'o').replace(/[úùü]/g, 'u').replace(/ñ/g, 'n')
      .replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ');
    for (var i = 0; i < ps.length; i++) {
      if (ps[i] && ps[i].length > 1) out.push(ps[i]);
    }
    return out;
  }
  /* v2.14.4 · LAS PALABRAS CLAVE SE NORMALIZAN IGUAL QUE EL PEDIDO.
     El pedido se normaliza sin acentos ("abrí" -> "abri"), pero las palabras
     clave estaban escritas con acentos: "abrí" nunca matcheaba "abri". La
     mitad de la lista estaba muerta sin que nadie lo notara. */
  function sinAcentos(t) {
    return String(t == null ? '' : t).toLowerCase()
      .replace(/[áàä]/g, 'a').replace(/[éèë]/g, 'e').replace(/[íìï]/g, 'i')
      .replace(/[óòö]/g, 'o').replace(/[úùü]/g, 'u').replace(/ñ/g, 'n');
  }
  function cuentaPalabras(pal, lista) {
    if (!lista) return 0;
    var n = 0;
    for (var i = 0; i < lista.length; i++) {
      var k = sinAcentos(lista[i]);
      if (k.indexOf(' ') >= 0) {
        /* frase: matchea si aparece en el pedido ("agenda un turno") */
        if (pal.join(' ').indexOf(k) >= 0) n++;
        continue;
      }
      for (var j = 0; j < pal.length; j++) {
        if (pal[j] === k) { n++; break; }
      }
    }
    return n;
  }

  function seleccionar(pedido) {
    var pal = palabrasPedido(pedido), names = toolNames(), puntos = [], sinFiltro = [];
    for (var i = 0; i < names.length; i++) {
      var n = names[i];
      /* v2.14.4 · una herramienta SIN lista de palabras (la recién agregada,
         que nadie conoce todavía) va SIEMPRE, pero al final: si no, el
         listado de herramientas la escondería y el modelo no la elegiría
         nunca. */
      if (!KW[n]) { sinFiltro.push(n); continue; }
      var p = cuentaPalabras(pal, KW[n]);
      if (p > 0) puntos.push({ n: n, p: p, i: i });
    }
    if (!puntos.length) return names.concat(sinFiltro);   /* nadie matcheó: sin ejemplo, el modelo decide */
    puntos.sort(function (a, b) { return (b.p - a.p) || ((PRIORIDAD[b.n] || 0) - (PRIORIDAD[a.n] || 0)) || (a.i - b.i); });
    /* v2.14.4 · SI EL PEDIDO ES DE LECTURA, PRIMERO LAS DE LECTURA.
       "qué alarmas tengo" encaja con set_alarm (crear una alarma) y con
       manage_alarm (ver las alarmas), y el modelo se iba con la que
       escribía. Cuando el pedido es una consulta, la herramienta que LEE va
       primera: el ejemplo del prompt es el que el modelo copia. */
    var esConsulta = /^(que|cuant|cuantas|listar|listame|ver|mostrar|muestrame|buscar|buscame|tengo|tiene|mostrame)/.test(pal.join(' '));
    if (esConsulta) {
      puntos.sort(function (a, b) { return ((esLectura(b.n) ? 1 : 0) - (esLectura(a.n) ? 1 : 0)) || (b.p - a.p) || ((PRIORIDAD[b.n] || 0) - (PRIORIDAD[a.n] || 0)) || (a.i - b.i); });
    }
    var out = puntos.map(function (x) { return x.n; });
    for (var s = 0; s < sinFiltro.length; s++) out.push(sinFiltro[s]);
    return out;
  }

  /* ================= esquema → prompt ================= */
  function toolNames() { return Object.keys(TOOLS); }
  function getTool(n) { return Object.prototype.hasOwnProperty.call(TOOLS, n) ? TOOLS[n] : null; }

  /* v2.14.2 · PERFIL DEL USUARIO. El modelo que ELIGE la herramienta tiene que
     saber quién es el usuario y qué tiene a mano. Hasta ahora el prompt de
     decisión no tenía ni el nombre ni las tareas pendientes: esa información
     solo se inyectaba en el prompt de CHAT (kiuMsgs), o sea que el bot "sabía"
     lo que el usuario le había dicho al charlear, pero no al decidir qué
     hacer. Es la diferencia entre un chatbot con memoria y un agente.

     Va corto a propósito: esto se paga en CADA decisión, en la CPU del
     teléfono, y un prefill largo en un móvil es de segundos. */
  function perfil() {
    var out = [];
    try {
      if (window.S && window.S.name) out.push('se llama ' + String(window.S.name).slice(0, 24));
    } catch (e) { }
    try {
      if (window.KiuMem && typeof window.KiuMem.summary === 'function') {
        var s2 = window.KiuMem.summary(240);
        if (s2) out.push(s2);
      }
    } catch (e) { }
    return out.join(' · ');
  }

  /* El texto que ve el modelo.
   *
   * v2.9.2 — esto se mide, no se estima. Cada decisión de herramienta paga un
   * PREFILL de este texto en la CPU del teléfono, y el proyecto ya sabe que
   * ahí está el cuello de botella (ver el comentario de PROMPT LIVIANO en
   * app-ui.js: el prompt grande "tardaba minutos en el prefill"). Con las
   * descripciones largas que había, el manifiesto eran 435 tokens: el 80 % de
   * los 544 que costaba una decisión, para producir 120 de salida.
   *
   * Por eso el formato es una línea por herramienta, en forma de llamada, y las
   * descripciones son disparadores cortos ("poné una alarma") en vez de prosa.
   * Un modelo chico no gana nada con que le expliques cuándo usar la herramienta;
   * gana con que sepa distinguirla de las otras seis de un vistazo.
   *
   * El presupuesto lo vigila `budget()` y lo fija un test (ver agente.test.mjs):
   * si alguien vuelve a escribir un párrafo, el test se pone rojo. */
  function manifest(solo, compact) {
    var out = [];
    var names = (solo && solo.length) ? solo : toolNames();
    for (var i = 0; i < names.length; i++) {
      var t = TOOLS[names[i]];
      var as = [];
      for (var k in t.args) {
        if (!Object.prototype.hasOwnProperty.call(t.args, k)) continue;
        var a = t.args[k];
        if (compact) {
          /* v2.14.2 · EN EL COMPACTO VAN LOS VALORES DEL ENUM.
             El manifiesto compacto es lo que ve el modelo en el móvil, y era
             solo la firma: `manage_task(action, text?)`. El modelo no tenía
             forma de saber que action ∈ {list, add, done}: se lo inventaba,
             la validación lo rechazaba y se perdía una generación entera.
             Los valores del enum SON el vocabulario que hay que usar, y
             sacarlos de la gramática (que solo está activa si el nativo la
             soporta) es lo mismo que sacarlos de la validación (que solo
             actúa después). En la línea va a costear ~4 tokens por
             herramienta con enum, y se pagan SOLO por las herramientas que
             el turno realmente lleva (ver seleccionar()). */
          var sig = k + (a.required ? '' : '?');
          if (a.enum && a.enum.length) sig += ': ' + a.enum.join('|');
          as.push(sig);
        } else {
          as.push(k + (a.required ? '' : '?') + ': ' + a.desc);
        }
      }
      out.push(compact ? (t.name + '(' + as.join(', ') + ')') : (t.name + '(' + as.join(', ') + ') — ' + t.desc));
    }
    return out.join('\n');
  }

  /* Tokens estimados del prompt completo. Es una estimación (≈3,6 car/token para
     español con estos modelos), no un tokenizador real: alcanza para detectar que
     algo se duplicó o se llenó de prosa, que es lo que este número tiene que
     vigilar. Medirlo de verdad es un test de integración con el tokenizador. */
  function budget() {
    var p = systemPrompt('x', null, [], false);
    var m = manifest();
    /* v2.14.2 · el caso REAL del móvil es el manifiesto COMPACTO (perfil
       Harness-Local-Compact, que es el que corre por defecto): una línea por
       herramienta, sin descripciones. El manifiesto largo es el peor caso
       (cuando el llamador pide el perfil rico o no hay harness). Los dos se
       miden: el compacto es el que se paga en cada decisión. */
    var mc = manifest(null, true);
    return {
      manifiestoChars: m.length,
      manifiestoTok: Math.round(m.length / 3.6),
      manifiestoCompactoTok: Math.round(mc.length / 3.6),
      promptChars: p.length,
      promptTok: Math.round(p.length / 3.6)
    };
  }

  /* ================= gramática GBNF =================
   *
   * Deriva la gramática de muestreo del MISMO `args` que valida y que arma el
   * manifiesto. No es una copia: si mañana agregás un argumento, la validación lo
   * ve, el prompt lo documenta y la gramática lo acepta, sin que haya que
   * acordarse de tres lugares.
   *
   * Para qué sirve: con la gramática, el motor NO PUEDE emitir un JSON roto —
   * el sampler descarta los tokens que no encajan. Sin ella, un modelo chico
   * falla el JSON de vez en cuando y el bucle lo reintenta gastando una
   * generación entera. En un teléfono eso son segundos.
   *
   * OJO — esto NO arregla el problema de fondo. La gramática garantiza que el
   * JSON sea sintácticamente válido, no que la herramienta sea la correcta: un
   * modelo puede llamar `set_alarm` cuando debía leer la agenda, y la gramática
   * lo va a dejar pasar igual. Para eso está la validación y la observación que
   * vuelve al bucle. Gramática = menos reintentos. Validación = menos errores.
   * Hacen falta las dos.
   *
   * Se le pasa a `llama_sampler_init_grammar(vocab, texto, "root")` en el nativo
   * (ver el TODO en kiullama_jni.cpp). Acá solo se genera el texto.
   */

  /* Escapa un literal de GBNF: las comillas y las barras invertidas se
     anteceden con una barra, porque la gramática es un DSL y no JSON. */
  function lit(s0) {
    return '"' + String(s0).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }
  /* v2.12.8 · FIX CRÍTICO. La gramática anterior emitía `set_alarm{when:...}`: sin
     comillas en las claves, sin `{"tool":…}` y con una `}` suelta fuera de literal
     (error de sintaxis en GBNF). llama_sampler_init_grammar devolvía null, el nativo
     lo anotaba en grammarOk=false y la decisión salía SIN restringir: el agente
     nunca tuvo la garantía de JSON válido que el diseño daba por hecha. Ahora cada
     rama es un literal JSON completo, tal cual lo lee parseDecision(). */
  var STR_RULE = 'str ::= "\\"" ( [^"\\\\\\n] | "\\\\" ["\\\\nrt/] )+ "\\""';

  function grammarTools(solo, hermes) {
    var g = [];
    var names = (solo && solo.length) ? solo : toolNames();
    for (var i = 0; i < names.length; i++) {
      if (!TOOLS[names[i]]) continue;
      g.push(toolRule(TOOLS[names[i]], !!hermes));
    }
    return g;
  }

  /* Regla de UNA herramienta. Los opcionales abren alternativas (hasta 2
     opcionales: todos los subconjuntos; más de 2: solo requeridos y todos). */
  /* GBNF solo admite [a-zA-Z0-9-] en nombres de regla: el guion bajo es un error de sintaxis. */
  function ruleName(n) { return String(n).replace(/_/g, '-'); }

  function toolRule(t, hermes) {
    var req = [], opt = [];
    for (var k in t.args) {
      if (!Object.prototype.hasOwnProperty.call(t.args, k)) continue;
      (t.args[k].required ? req : opt).push(k);
    }
    var subsets = [req];
    if (opt.length === 1) subsets.push(req.concat([opt[0]]));
    else if (opt.length === 2) {
      subsets.push(req.concat([opt[0]]));
      subsets.push(req.concat([opt[1]]));
      subsets.push(req.concat(opt));
    } else if (opt.length > 2) subsets.push(req.concat(opt));
    var ramas = subsets.map(function (keys) { return branch(t, keys, hermes); });
    /* v2.14.4 · LAS ALTERNATIVAS VAN EN LA MISMA LÍNEA.
       En GBNF un salto de línea TERMINA la regla: poner el "|" al principio de
       la línea siguiente hace que el parser falle con "expecting name at |".
       O sea que la gramática NO parseaba y el agente venía funcionando SIN
       gramática: el modelo tenía que acertar el JSON solo, que es justo lo
       que un modelo chico no hace. Verificado contra el parser real de
       llama.cpp ("failed to parse grammar"). */
    return ruleName(t.name) + ' ::= ' + ramas.join(' | ');
  }

  /* Una rama: {"tool":"x","args":{"k":v,"k2":v2}} como secuencia de literales. */
  function branch(t, keys, hermes) {
    var out = hermes
      ? lit('<tool_call>{"name":"' + t.name + '","arguments":{')
      : lit('{"tool":"' + t.name + '","args":{');
    for (var i = 0; i < keys.length; i++) {
      out += ' ' + lit((i ? ',' : '') + '"' + keys[i] + '":') + ' ' + valueRule(t.args[keys[i]]);
    }
    return out + ' ' + lit(hermes ? '}}</tool_call>' : '}}');
  }

  /* El valor de un campo: por tipo, y acotado si el esquema lo acota. */
  function valueRule(spec) {
    if (spec.enum && spec.enum.length) {
      return '( ' + spec.enum.map(function (e) { return lit('"' + e + '"'); }).join(' | ') + ' )';
    }
    if (spec.type === 'number' || spec.type === 'integer') {
      return '( [0-9]+ ( "." [0-9]+ )? )';
    }
    if (spec.type === 'boolean') return '( "true" | "false" )';
    return 'str';
  }

  /* La gramática entera: raíz que acepta una herramienta o {"listo":true}. */
  function grammar(solo, hermes, conListo) {
    var g = grammarTools(solo, !!hermes);
    var nombres = g.map(function (r) { return r.split(' ::=')[0]; });  /* ya con guiones */
    /* v2.14.4 · "LISTO" SOLO DESPUÉS DE TRABAJAR. El agente entra únicamente
       para órdenes (el gate del chat ya filtró las preguntas), así que en el
       PRIMER paso "no necesito ninguna herramienta" nunca es la respuesta
       correcta: es la salida fácil que toma un modelo chico. Medido con
       Qwen3-0.6B: sin esto, el 97 % de los pedidos terminaban con
       {"listo":true} y no se ejecutaba NADA. En el primer paso la gramática
       no ofrece esa salida; a partir del segundo vuelve, porque ahí sí es
       la respuesta correcta ("ya hice lo que me pediste"). */
    if (conListo !== false) g.push('done ::= ' + lit('{"listo":true}'));
    g.push(STR_RULE);
    g.push('root ::= ' + nombres.concat(conListo === false ? [] : ['done']).join(' | '));
    return g.join('\n') + '\n';
  }

  /* ================= validación estricta ================= */
  /* Devuelve {ok:true, args} o {ok:false, err}. El error va al modelo tal cual:
     que sepa QUÉ estuvo mal es lo que hace que el segundo intento acierte. */
  function validate(name, raw) {
    var t = getTool(name);
    if (!t) {
      return {
        ok: false,
        err: 'la herramienta "' + s(name, 40) + '" no existe. Solo podés usar: ' + toolNames().join(', ') + '.'
      };
    }
    var args = {};
    var k;
    for (k in raw) {
      if (!Object.prototype.hasOwnProperty.call(raw, k)) continue;
      if (!Object.prototype.hasOwnProperty.call(t.args, k)) {
        return {
          ok: false,
          err: 'el argumento "' + s(k, 30) + '" no existe en ' + t.name + '. Sus argumentos son: ' +
            Object.keys(t.args).join(', ') + '.'
        };
      }
    }
    for (k in t.args) {
      if (!Object.prototype.hasOwnProperty.call(t.args, k)) continue;
      var spec = t.args[k], v = raw[k];
      if (v === undefined || v === null || v === '') {
        if (spec.required) return { ok: false, err: 'falta el argumento obligatorio "' + k + '" de ' + t.name + '.' };
        continue;
      }
      if (spec.type === 'string') {
        var str = String(v);
        if (str.length > MAX_ARG_LEN) return { ok: false, err: 'el argumento "' + k + '" es demasiado largo.' };
        /* v2.9.2: el enum se valida acá además de estar en la gramática. La
           gramática no siempre está activa (sin JNI, o cuando la decisión va
           por un proveedor), y esta lista cerrada es la que evita que el modelo
           invente acciones. */
        if (spec.enum && spec.enum.length && spec.enum.indexOf(str) === -1) {
          return {
            ok: false,
            err: '"' + str + '" no es un valor válido de "' + k + '". Solo: ' + spec.enum.join(', ') + '.'
          };
        }
        args[k] = str;
      } else if (spec.type === 'number' || spec.type === 'integer') {
        var n = num(v);
        if (n === null) return { ok: false, err: 'el argumento "' + k + '" tiene que ser un número.' };
        args[k] = spec.type === 'integer' ? Math.round(n) : n;
      } else if (spec.type === 'boolean') {
        args[k] = (v === true || v === 'true' || v === 1 || v === '1');
      } else {
        args[k] = String(v);
      }
    }
    return { ok: true, args: args };
  }

  /* ================= parse de la decisión =================
     Un modelo chico devuelve: ```json\n{...}\n```, o "{\"tool\":...}" con comillas
     raras, o JSON con trailing commas. Todo eso es recuperable. */
  function parseDecision(text) {
    if (!text) return null;
    var t = String(text);
    t = t.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/i, '');
    t = t.replace(/<\/?think>/gi, '').trim();
    var fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) t = fence[1].trim();
    /* si hay texto alrededor, nos quedamos con el primer {...} balanceado */
    var i = t.indexOf('{');
    if (i > -1) {
      var depth = 0, end = -1, inStr = false, esc2 = false;
      for (var j = i; j < t.length; j++) {
        var ch = t[j];
        if (inStr) {
          if (esc2) esc2 = false;
          else if (ch === '\\') esc2 = true;
          else if (ch === '"') inStr = false;
          continue;
        }
        if (ch === '"') inStr = true;
        else if (ch === '{') depth++;
        else if (ch === '}') { depth--; if (depth === 0) { end = j; break; } }
      }
      if (end > -1) t = t.slice(i, end + 1);
    }
    t = t.replace(/,\s*([}\]])/g, '$1');           /* trailing commas */
    t = t.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
    try {
      var o = JSON.parse(t);
      return (o && typeof o === 'object' && !Array.isArray(o)) ? o : null;
    } catch (e) { return null; }
  }

  /* acepta "tool"/"herramienta", "args"/"arguments"/"argumentos"/"params" */
  function readDecision(o) {
    var name = o.tool || o.herramienta || o.function || o.name;
    var raw = o.args || o.arguments || o.argumentos || o.params || o.parameters || o.input;
    if (name && typeof name === 'object') {
      /* formato OpenAI: {"function":{"name":...,"arguments":"{...}"}} */
      var f = name;
      if (!raw && f.arguments) raw = f.arguments;
      name = f.name;
    }
    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw); } catch (e) { return { name: name, raw: {}, bad: 'los argumentos no son JSON válido' }; }
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) raw = {};
    return { name: name, raw: raw, bad: null };
  }

  /* "¿No falta nada más?" → sí, cuando NO pidió ninguna herramienta.
     La clave: si el objeto trae una herramienta, NO está terminado, aunque no
     diga "listo". La versión anterior devolvía true siempre que no viniera la
     palabra, así que un {"tool":"set_alarm",...} sin más se leía como "terminado"
     y el bucle cortaba ANTES de ejecutar nada. Un modelo chico que no entiende la
     instrucción "si no necesitás ninguna: {listo:true}" y devuelve solo la
     herramienta se quedaba mudo. */
  function isDone(o) {
    if (!o || typeof o !== 'object') return true;
    var name = o.tool || o.herramienta || o.function || o.name;
    if (name && typeof name === 'object') name = name.name;
    if (name) return false;
    var v = o.listo !== undefined ? o.listo : (o.done !== undefined ? o.done : true);
    if (v === true) return true;
    var sv = String(v).trim().toLowerCase();
    return sv === '1' || sv === 'true' || sv === 'si' || sv === 'sí' || sv === 'listo' || sv === 'ya' || sv === 'nada';
  }

  /* ================= el bucle =================
     Un paso = una consulta al modelo + una decisión validada + su ejecución.
     Se corta en cuanto el modelo dice "listo" o no queda nada por hacer. */

  /* v2.14.2 · ¿El texto de la herramienta ya ES la respuesta?
     Un resultado corto, de una sola herramienta, sin forma de lista, se puede
     mostrar tal cual. Uno largo o con varios resultados necesita que el modelo
     lo redacte (si no, el usuario lee una tabla de crudos). */
  function directo(crudo, nHerramientas) {
    if (nHerramientas > 1) return false;
    if (!crudo) return false;
    if (crudo.length > 320) return false;
    if (crudo.split('\n').length > 3) return false;
    return true;
  }
  function run(opts, cb) {
    var o = opts || {};
    var K = window.Kiu;
    var herramientas = o.tools && o.tools.length ? o.tools : seleccionar((o.habla && o.habla.length) ? o.habla[o.habla.length - 1] : o.pedido);
    var harness = null;
    try { harness = window.KiuHarness2 && window.KiuHarness2.choose({ modelName: window.S && window.S.kiu && window.S.kiu.name, provider: o.provider, remote: o.remote }); } catch (eHarness) { harness = null; }
    var max = o.maxSteps || (harness && harness.maxSteps) || MAX_STEPS;
    var obs = [];
    var hecho = [];
    var terminado = false;   /* v2.14.3: el bucle ya no acepta respuestas tardías */
    var successfulTools = [];
    var failedTools = false;
    var taskText = s(o.pedido || (o.habla && o.habla.length ? o.habla[o.habla.length - 1] : ''), 300);
    var n = 0;

    if (!K || typeof K.ask !== 'function') { cb({ ok: false, err: 'sin motor' }); return; }
    /* v2.13.0: si el modelo no está en memoria (proceso reiniciado, descarga por
       inactividad) se carga ahora y el agente sigue, en vez de rendirse. */
    var cargado = !!(window.S && window.S.kiu && window.S.kiu.ok);
    var staleLoad = cargado && typeof K.isLoaded === 'function' && K.isLoaded() === false;
    if ((!cargado || staleLoad) && typeof K.whenReady === 'function') {
      K.whenReady(function (okR) {
        if (!okR) { cb({ ok: false, err: 'sin modelo cargado' }); return; }
        paso();
      });
      return;
    }
    if (!cargado) { cb({ ok: false, err: 'sin modelo cargado' }); return; }

    /* v2.14.4 · ¿La selección es confiable? Solo si la herramienta de arriba
       matcheó alguna palabra clave del pedido. Si no matcheó ninguna, el
       ejemplo sería del conjunto equivocado. */
    var herramientasSeguras = herramientasConPalabras(herramientas, (o.habla && o.habla.length) ? o.habla[o.habla.length - 1] : o.pedido);

    function seguir(t, out, args) {
      var ok = !!(out && out.ok);
      var txt = (out && (out.text || out.err)) || '';
      /* v2.14.2 · OBSERVACIÓN ESTRUCTURADA. Antes volvía al modelo el texto
         pelado de la herramienta, sin saber de qué herramienta venía ni si
         salió bien. Un modelo chico no puede distinguir "no encontré nada" de
         "el dispositivo falló" si las dos llegan igual: se equivoca de
         herramienta en el paso siguiente. Con el nombre y el estado, puede.
         Cuesta 4 tokens por observación y ahorra un paso entero cuando se
         equivoca. */
      obs.push('[' + t.name + (ok ? ' ok' : ' error') + '] ' + txt);
      if (ok) successfulTools.push(t.name); else failedTools = true;
      if (ok && out.text) hecho.push(out.text);
      anotar(t, args, ok, ok ? '' : txt);
      /* v2.14.8 · el llamador se entera del RESULTADO de la herramienta, no
         solo de que empezó. Con eso el chat puede mostrar lo que Kiu hizo como
         una tarjeta ("Linterna ✓ · Acción ejecutada") en vez de un párrafo. */
      try { if (typeof o.resultado === 'function') o.resultado(t.name, ok, txt); } catch (eRes) { }
      paso();
    }
    function anotar(t, args, ok, nota) { registrar(t.name, riskOf(t, args), ok, nota); }

    function paso() {
      if (n >= max) { finish(); return; }
      n++;
      var hist = [{ role: 'system', content: systemPrompt(taskText, herramientas, obs, o.habla && o.habla.length, harness && harness.id === 'Harness-Local-Compact', /hermes/i.test(String(window.S && window.S.kiu && window.S.kiu.name || '')), herramientasSeguras) }];
      if (o.habla && o.habla.length) {
        for (var i = 0; i < o.habla.length; i++) hist.push({ role: 'user', content: o.habla[i] });
      }
      /* v2.14.2 · AVANZAR: que el llamador sepa en qué está el agente.
         Un turno de agente puede dar hasta 4 pasos y cada paso es una
         generación en la CPU del teléfono: segundos. Sin esto, el usuario ve
         "Enrutando" clavado y no sabe si está pensando, trabado o
         haciendo algo. Con esto, la pastilla dice QUÉ está haciendo. */
      function avisar(que, tool) {
        if (typeof o.avanzar !== 'function') return;
        try { o.avanzar(que, tool || null); } catch (eAv) { }
      }
      /* v2.9.2: se pasa la gramatica SOLO si el motor la acepta. Se consulta
         antes de generar porque si el nativo no la soporta, la decision sale sin
         restringir y el parse + reintento tiene que estar listo igual (que
         igual hace falta: un modelo chico va a fallar el JSON de vez en cuando).
         La gramatica se deriva del esquema, asi que no puede quedar vieja. */
      var gbnf = null;
      var hermesMode = /hermes/i.test(String(window.S && window.S.kiu && window.S.kiu.name || ''));
      if (o.usarGramatica !== false) {
        /* v2.14.4 · LA GRAMÁTICA SE PONE SIEMPRE.
           Antes se ponía solo si `kiuGenGrammarOk()` devolvía true, y ese
           valor dice si la gramática ANTERIOR se pudo aplicar. Como la
           primera decisión no tenía ninguna anterior, la primera tampoco la
           ponía: y como la anterior nunca se aplicó, la segunda tampoco.
           El agente.enteró JA MÁS con gramática. Ahora se pone siempre (si el
           nativo la soporta) y el resultado se verifica después. */
        try { gbnf = grammar(herramientas, hermesMode, obs.length > 0); } catch (eGr) { gbnf = null; }
      }
      /* v2.14.2 · ESPERAR AL MOTOR Y NO QUEDARSE COLGADO.
         Dos cosas que el agente no tenía y el chat normal sí:
         a) ESPERAR: si el motor está ocupado con otra generación, el camino
            normal reintenta hasta 30 s (app-ui · tryTargets). El agente se
            rendía al instante y contestaba "el motor está ocupado", que es
            justo lo que el usuario reportaba.
         b) UN RELOJ: si el nativo nunca entrega el resultado (un evento
            perdido, el motor trabado), el bucle del agente se quedaba
            esperando para siempre, con la pastilla de "Generando" clavada.
            Ahora hay un tope por decisión. */
      var esperaN = 0;
      var ESPERA_MAX = 20;          /* ~24 s esperando que se libere */
      var RELOJ_MAX = 120000;       /* 2 min por decisión */
      var reloj = 0;
      var asking = false;
      var MAXTOK = o.maxTokens || (harness && harness.maxTokens) || 120;
      function preguntar() {
        if (asking) return;
        asking = true;
        if (reloj) { try { clearTimeout(reloj); } catch (eCl) { } reloj = 0; }
          K.ask(hist, MAXTOK, function (res) {
          asking = false;
          /* v2.14.4 · ¿la gramática se aplicó de verdad? El nativo lo dice
             (grammarOk). Si dice que no, el agente está sin red: el modelo
             puede devolver cualquier cosa. Queda registrado para el
             diagnóstico, porque un agente sin gramática parece un agente
             que "no funciona" y la causa es invisible. */
          try {
            if (rawBridge('kiuGenGrammarOk') === false) {
              if (window.KiuHarness2) window.KiuHarness2.record(false, 'grammar');
            }
          } catch (eGr2) { }
          if (reloj) { try { clearTimeout(reloj); } catch (eCl2) { } reloj = 0; }
          if (res && !res.ok && /ocupado/i.test(String(res.err || '')) && esperaN < ESPERA_MAX) {
            esperaN++;
            avisar('esperando');
            setTimeout(preguntar, 1200);
            return;
          }
          onRes(res);
        }, null, gbnf);
        /* el reloj corre mientras se espera la respuesta */
        reloj = setTimeout(function () {
          reloj = 0;
          if (!asking) return;
          asking = false;
          try { if (window.KiuHarness2) window.KiuHarness2.record(false, 'timeout'); } catch (eTo) { }
          finish();
        }, RELOJ_MAX);
      }
      function onRes(res) {
        /* v2.14.3 · si el bucle ya terminó, la respuesta que llega tarde se
           descarta. Con la cola del motor un pedido puede completarse
           DESPUÉS de que el agente se rindiera: sin esta guarda, el bucle
           seguiría andando solo. */
        if (terminado) return;
        if (!res || !res.ok || !res.text) { try { if (window.KiuHarness2) window.KiuHarness2.record(false, 'generation'); } catch (eH1) { } finish(); return; }
        var d = parseDecision(res.text);
        if (!d) { try { if (window.KiuHarness2) window.KiuHarness2.record(false, 'json parse'); } catch (eH2) { } avisar('pensando'); obs.push('Tu respuesta anterior no era un JSON válido. Respondé solo con el JSON.'); paso(); return; }
        if (isDone(d)) { finish(); return; }
        var rd = readDecision(d);
        if (rd.bad) { avisar('pensando'); obs.push(rd.bad + '. Respondé de nuevo.'); paso(); return; }
        var v = validate(rd.name, rd.raw);
        if (!v.ok) { try { if (window.KiuHarness2) window.KiuHarness2.record(false, 'validation'); } catch (eH3) { } avisar('corrigiendo'); obs.push(v.err + ' Corregí y volvé a intentar.'); paso(); return; }
        try { if (window.KiuHarness2) window.KiuHarness2.record(true, 'validated'); } catch (eH4) { }
        var t = getTool(rd.name);
        /* v2.14.2: se avisa QUÉ herramienta se va a usar, antes de ejecutarla */
        avisar('usando', t.name);
        /* v2.13.1: acciones con efecto pasan por o.confirmar(tool, args, cb) si el llamador
           lo pide; si el usuario dice que no, se informa al modelo y se sigue. */
        function ejecutar() {
          var out;
          try { out = t.run(v.args); } catch (e) { out = { ok: false, err: 'la herramienta falló: ' + e.message }; }
          if (out && typeof out.then === 'function') {
            /* herramienta asíncrona (web_search): se espera, con tope de 10 s */
            var hecho2 = false;
            var timer = setTimeout(function () { if (!hecho2) { hecho2 = true; seguir(t, { ok: false, err: 'la herramienta tardó demasiado' }, v.args); } }, 10000);
            out.then(function (r) { if (hecho2) return; hecho2 = true; clearTimeout(timer); seguir(t, r, v.args); },
              function () { if (hecho2) return; hecho2 = true; clearTimeout(timer); seguir(t, { ok: false, err: 'la herramienta falló' }, v.args); });
            return;
          }
          seguir(t, out, v.args);
        }
        /* v2.14.2: el riesgo se calcula con los argumentos (riskFor), no con
           el riesgo único de la herramienta: listar tareas no pide confirmación,
           crearlas sí. */
        var riesgo = riskOf(t, v.args);
        if (riesgo === 'write' && typeof o.confirmar === 'function') {
          var resp = false;
          try {
            o.confirmar(t.name, v.args, function (si) {
              if (resp) return; resp = true;
              if (si) ejecutar();
              else { anotar(t, v.args, false, 'cancelada por el usuario'); obs.push('El usuario canceló ' + t.name + '.'); paso(); }
            });
          } catch (eCf) { if (!resp) { resp = true; ejecutar(); } }
          return;
        }
        ejecutar();
      }
      preguntar();
    }
    function finish() {
      terminado = true;
      /* Aprende solo de ejecuciones completas con al menos tres herramientas exitosas.
         Guarda nombres/keywords, nunca argumentos, contactos ni resultados. */
      if (!failedTools && successfulTools.length >= 3 && window.KiuSkills && typeof window.KiuSkills.recordRecipe === 'function') {
        try { window.KiuSkills.recordRecipe(taskText, successfulTools, 'Reutilizar solo como guía; generar argumentos nuevos, validar esquemas y respetar confirmación para acciones de escritura.'); } catch (eRecipe) { }
      }
      var crudo = hecho.join('\n');
      var res = { ok: hecho.length > 0, text: crudo, obs: obs, steps: n };
      /* v2.13.0 · el modelo VE lo que pasó y contesta como Kiu, en vez de volcar el
         texto de la herramienta. Solo si hubo resultados y el llamador no lo apagó;
         si la redacción falla o sale vacía, vale el texto crudo (siempre correcto). */
      if (!hecho.length || o.componer === false || !o.habla || !o.habla.length) { cb(res); return; }
      /* v2.14.2 · UN TURNO = UNA GENERACIÓN.
         Redactar la respuesta final con el modelo es una segunda generación
         completa: en un teléfono, con un modelo chico, son segundos. Pero
         muchas herramientas ya devuelven una frase pensada para el usuario
         ("Listo: alarma a las 7"), y volver a pasar eso por el modelo no
         agrega nada: gasta un prefill entero para decir lo mismo.

         La redacción se hace SOLO cuando de verdad aporta: más de una
         herramienta, o un resultado largo o con forma de lista (la web, los
         documentos). En el caso simple, el texto de la herramienta ES la
         respuesta. Si el llamador quiere siempre la redacción, puede pedirlo
         con `componer: 'siempre'`. */
      if (o.componer !== 'siempre' && o.componer !== true && directo(crudo, hecho.length)) { cb(res); return; }
      var msgs = [
        { role: 'system', content: 'Sos Kiu, el asistente del teléfono. Ya ejecutaste las acciones. Contestale al usuario en español, en 1 o 2 frases cortas, usando SOLO estos resultados; no inventes nada.\nRESULTADOS:\n' + crudo.slice(0, 600) + (typeof window.S === 'object' && window.S.kiu && /qwen3/i.test(String(window.S.kiu.name || '')) ? '\n/no_think' : '') },
        { role: 'user', content: o.habla[o.habla.length - 1] }
      ];
      try {
        K.ask(msgs, 110, function (r2) {
          var t = r2 && r2.ok && r2.text ? String(r2.text).replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<\/?think>/gi, '').trim() : '';
          if (t && t.length > 3) { res.crudo = crudo; res.text = t; }
          cb(res);
        });
      } catch (eC) { cb(res); }
    }
    paso();
  }

  /* v2.14.4 · EJEMPLOS PARA EL MODELO.
     Medido con un modelo real (Qwen3-0.6B) sobre el arnés de evaluación: sin
     ejemplos, el 97 % de los pedidos terminaban con {"listo": true} — el modelo
     no llamaba a ninguna herramienta. La instrucción "si no necesitás ninguna"
     le da al modelo chico una salida MUY fácil, y la toma siempre. Un ejemplo
     concreto le enseña dos cosas: la forma exacta del JSON y que la respuesta
     normal es llamar a una herramienta. */
  var EJEMPLO = {
    set_alarm: { when: 'a las 7', label: 'despertar' },
    read_calendar: { day: 'mañana' },
    find_contact: { name: 'Ana' },
    call_contact: { who: 'Mamá' },
    search_docs: { query: 'contrato' },
    device_action: { what: 'linterna' },
    send_message: { to: 'Juan', text: 'ya llegué' },
    remember: { text: 'el dentista es el martes' },
    recall: { query: 'dentista' },
    manage_task: { action: 'list' },
    manage_alarm: { action: 'list' },
    create_calendar_event: { title: 'turno dentista', when: 'mañana a las 15' },
    forget: { text: 'dentista' },
    update_memory: { text: 'martes', new_text: 'jueves' },
    now: {},
    web_search: { query: 'precio del dólar' }
  };
  function ejemplos(lista, seguro) {
    /* v2.14.4 · UN SOLO EJEMPLO, el de la herramienta más probable, y SOLO
       si la selección es CONFIABLE. Con tres ejemplos, el modelo chico copiaba
       el primero (medido: 4 pedidos de 30 se equivocaban por eso). Con uno
       solo, el modelo copia el correcto... pero si el ejemplo es del
       conjunto equivocado, el modelo copia el error. Cuando ninguna palabra
       clave matchea, NO se muestra ejemplo: es mejor que el modelo piense
       que enseñarle una respuesta equivocada. */
    if (seguro === false) return [];
    var nombres = (lista && lista.length) ? lista : toolNames();
    for (var i = 0; i < nombres.length; i++) {
      var n = nombres[i];
      if (!EJEMPLO[n]) continue;
      return ['"' + n + '" → {"tool":"' + n + '","args":' + JSON.stringify(EJEMPLO[n]) + '}'];
    }
    return [];
  }

  function systemPrompt(pedido, herramientas, obs, hayHabla, compact, hermes, seguras) {
    /* Si el llamador pasa una lista, el prompt muestra SOLO esas herramientas.
       Importa para un modelo chico: cada línea del manifiesto es contexto que no
       está usando, y cada herramienta de más es una chance más de que elija mal. */
    var lista = manifest(herramientas, !!compact);
    var per = perfil();
    var p = 'Sos Kiu, un asistente que usa herramientas para responder.\n\n' +
      'HERRAMIENTAS:\n' + lista + '\n\n' +
      (per ? 'PERFIL DEL USUARIO: ' + per + '\n\n' : '') +
      /* v2.9.2: la TAREA solo va si NO hay historial. Con historial, el último
         mensaje del usuario YA es la tarea y repetirla acá es tokens de prefill
         tirados a la basura — y en un teléfono, cada token cuenta. */
      (hayHabla ? '' : 'TAREA: ' + s(pedido, 300) + '\n\n') +
      /* v2.14.4 · los ejemplos van con la lista de herramientas del turno: así
         el modelo ve el vocabulario Y la forma, sin pagar por las 16. */
      (function () {
        var ex = ejemplos(herramientas, seguras);
        if (!ex.length) return '';
        return 'EJEMPLOS:\n' + ex.join('\n') +
          '\n"charla normal" → {"listo":true}\n\n';
      })() +
      (hermes ? 'Respondé SOLO con una llamada Hermes: <tool_call>{\"name\":\"nombre\",\"arguments\":{\"k\":\"v\"}}</tool_call>. No agregues texto.\n' : 'Respondé SOLO con un objeto JSON, sin texto alrededor, sin markdown.\n' + 'Si necesitás una herramienta: {"tool": "nombre", "args": {"k": "v"}}\n') +
      /* v2.14.4 · en el primer paso NO se ofrece "listo" (ver grammar()). */
      ((obs && obs.length) ? 'Si no necesitás ninguna más: {"listo": true}\n\n' : 'Elegí SIEMPRE una herramienta de la lista. Todavía no hiciste nada.\n\n') +
      'Usá una herramienta por vez. Elegí la más específica que sirva.';
    /* Receta procedural: solo pista de herramientas, nunca argumentos guardados ni ejecución automática. */
    try {
      var recipe = window.KiuSkills && window.KiuSkills.matchRecipe && window.KiuSkills.matchRecipe(pedido);
      if (recipe && recipe.tool_sequence && recipe.tool_sequence.length >= 3) {
        p += '\n\nRECETA PROCEDURAL APRENDIDA (pista no vinculante): ' + recipe.tool_sequence.join(' → ') +
          '. Regenera los argumentos con la petición actual; valida cada herramienta y no omitas confirmaciones. Regla: ' + s(recipe.validation_rule, 180);
      }
    } catch (eRecipeHint) { }
    /* v2.12.8: Qwen3 arranca en modo «thinking» y se come los 120 tokens de la
       decisión razonando en <think> antes de emitir el JSON. /no_think es su
       interruptor oficial; con otras familias no se agrega. */
    try { if (window.S && S.kiu && /qwen3/i.test(String(S.kiu.name || ''))) p += '\n/no_think'; } catch (eNt) { }
    if (obs && obs.length) {
      p += '\n\nYA INTENTASTE:\n' + obs.map(function (o, i2) { return (i2 + 1) + ') ' + o; }).join('\n') +
        '\nCon eso decidí si falta algo o si ya está listo.';
    }
    return p;
  }

  return {
    TOOLS: TOOLS,
    getLog: function () { return LOG.slice(); },
    clearLog: function () { LOG.length = 0; },
    toolNames: toolNames,
    seleccionar: seleccionar,
    get: getTool,
    manifest: manifest,
    grammar: grammar,
    lit: lit,
    budget: budget,
    validate: validate,
    parseDecision: parseDecision,
    readDecision: readDecision,
    isDone: isDone,
    run: run,
    probarDecision: probarDecision,
    systemPrompt: systemPrompt,
    perfil: perfil,
    riskOf: riskOf,
    MAX_STEPS: MAX_STEPS,
    DEVICE_WHAT: DEVICE_WHAT,
    /* para los tests y para el diagnóstico */
    _internals: { MAX_ARG_LEN: MAX_ARG_LEN }
  };
})();
