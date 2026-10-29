/* ============ KIU BRAIN - Cerebro local offline ============ */
window.KiuBrain = (function () {
  'use strict';

  function norm(s) {
    return (s || '').toLowerCase()
      .replace(/[áàä]/g, 'a').replace(/[éèë]/g, 'e').replace(/[íìï]/g, 'i')
      .replace(/[óòö]/g, 'o').replace(/[úùü]/g, 'u').replace(/ñ/g, 'n')
      .replace(/[?!¡¿.,;:"']/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /* v2.10.1 · LO QUE DICTA EL RECONOCEDOR NO ES LO QUE SE TECLEA.
     Por voz la gente dice «ok kiu, ¿podés ponerme una alarma a las 7, por favor?»
     y casi todos los comandos de abajo estan anclados con ^ a la forma seca
     («pon alarma a las 7»). Cualquier cortesia delante o detras los hacia fallar,
     y la app contestaba con la respuesta generica. Esta capa limpia solo lo que
     rodea al pedido y unifica las formas de pedir mas comunes. */
  function cleanVoice(t) {
    var prev, n = 0;
    do {
      prev = t;
      t = t.replace(/^(?:ok|okay|dale|bueno|listo|a ver|entonces|por favor|porfa|kiu)\s+/, '');
      t = t.replace(/^(?:me\s+)?(?:puedes|podes|podrias|puede|podria|quieres|queres)\s+/, '');
      t = t.replace(/^(?:quiero|necesito|quisiera)\s+que\s+(?:me\s+)?/, '');
      n++;
    } while (t !== prev && n < 5);
    t = t.replace(/\s+(?:por favor|porfa|gracias)$/, '').trim();
    /* ponme / ponele / ponle -> pon */
    t = t.replace(/^pon(?:me|le|les|nos|e|er)\b/, 'pon');
    t = t.replace(/^(?:ponerme|ponernos)\b/, 'pon');
    /* alarma: «despiértame a las 7», «quiero una alarma…», «crea una alarma…» */
    t = t.replace(/^(?:despiertame|despertame|levantame)\s+(?:a\s+las?|para\s+las?|las?)\s+/, 'pon alarma a las ');
    t = t.replace(/^(?:crea|crear|activa|activar|agrega|agregar|haz|hace|haceme|hazme|programame|quiero|necesito)\s+(?:una\s+|un\s+)?(alarma|despertador)\b/, 'pon $1');
    /* «alarma para las 7» -> «alarma a las 7»: el handler se come el «para» y
       parseWhen no entiende «las 7» a secas. */
    t = t.replace(/^(pon (?:una |un )?(?:alarma|despertador))\s+(?:para\s+)?(las?\s)/, '$1 a $2');
    return t;
  }

  function safeMath(expr) {
    var e = expr.replace(/,/g, '.')
      .replace(/[x×*]/g, '*').replace(/[÷\/]/g, '/')
      .replace(/\s+/g, '');
    if (!/^[\d+\-*/().%]+$/.test(e)) return null;
    if (!/\d/.test(e)) return null;
    if (e.indexOf('**') >= 0) return null;
    try {
      var val = Function('"use strict"; return (' + e + ')')();
      if (typeof val !== 'number' || !isFinite(val)) return null;
      return Math.round(val * 1000000) / 1000000;
    } catch (err) { return null; }
  }

  var JOKES = [
    'Que le dijo un bit al otro? Nos vemos en el bus.',
    'Por que los programadores prefieren el modo oscuro? Porque la luz atrae a los bugs.',
    'Cuantos programadores hacen falta para cambiar un foco? Ninguno, es un problema de hardware.',
    'Mi memoria es como el alumbrado publico: funciona cuando quiere.',
    'Hay 10 tipos de personas: las que entienden binario y las que no.',
    'Que hace una abeja en el gimnasio? Zum-ba.'
  ];
  var MOTIV = [
    'Dale que se puede. Los dias grandes se construyen con pasos chicos.',
    'El progreso invisible tambien es progreso. Segui empujando.',
    'Hoy es un buen dia para sacar ese pendiente que vuelve de hace una semana.',
    'No hace falta ser perfecto, hace falta empezar. Arranca con 10 minutos.',
    'Si el problema parece grande, partilo en tres. Y despues en tres mas.'
  ];
  var TIPS = [
    'Tocá el micrófono una vez y quedamos conversando: respondo en voz alta y sigo escuchando.',
    'Decime "enciende la linterna" y prendo el flash real del teléfono, incluso con la app de fondo.',
    'Activá "Despertar por voz" en Ajustes y despertame diciendo "Kiu" sin tocar nada.',
    '"Llama a mamá" o "manda un whatsapp a Juan diciendo ya llego": uso tus contactos reales.',
    '"Temporizador de 10 minutos" suena aunque la app esté cerrada: lo llevo yo.',
    'En Ajustes podés elegir mi voz: las que dicen "de red" suenan casi humanas.',
    'Guardo recuerdos con "recuerda que...", tareas con "tarea: ..." y notas con "nota: ...".',
    'Conectá tu API en Ajustes para charlar de cualquier tema con IA completa.',
    '"Calcula 15% de 8900" y te hago la cuenta al toque.',
    '"Cómo llego al centro" te abre Mapas con la ruta directa.',
    'Preguntame "¿cuánta batería queda?" y te contesto con el dato real del teléfono.',
    'En Proveedores podés activar varios: si uno falla, pruebo con el siguiente solo.'
  ];

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function fmtNum(n) {
    if (n === null || n === undefined) return '';
    return String(n).replace('.', ',');
  }
  function pad(n) { return String(n).padStart(2, '0'); }

  var CONV = [
    { re: /([\d.,]+)\s*(?:km|kilometros)\s+a\s+(?:millas|mi)/, f: function (m) { return [parseFloat(m[1].replace(',', '.')) * 0.621371, ' millas']; } },
    { re: /([\d.,]+)\s*(?:millas|mi)\s+a\s+(?:km|kilometros)/, f: function (m) { return [parseFloat(m[1].replace(',', '.')) * 1.60934, ' km']; } },
    { re: /([\d.,]+)\s*(?:kg|kilos|kilogramos)\s+a\s+(?:lb|libras)/, f: function (m) { return [parseFloat(m[1].replace(',', '.')) * 2.20462, ' libras']; } },
    { re: /([\d.,]+)\s*(?:lb|libras)\s+a\s+(?:kg|kilos)/, f: function (m) { return [parseFloat(m[1].replace(',', '.')) / 2.20462, ' kg']; } },
    { re: /(-?[\d.,]+)\s*(?:grados\s+)?c(?:elsius)?\s+a\s+f/, f: function (m) { return [parseFloat(m[1].replace(',', '.')) * 9 / 5 + 32, ' grados F']; } },
    { re: /(-?[\d.,]+)\s*(?:grados\s+)?f(?:ahrenheit)?\s+a\s+c/, f: function (m) { return [(parseFloat(m[1].replace(',', '.')) - 32) * 5 / 9, ' grados C']; } },
    { re: /([\d.,]+)\s*(?:metros|m)\s+a\s+(?:pies|ft)/, f: function (m) { return [parseFloat(m[1].replace(',', '.')) * 3.28084, ' pies']; } },
    { re: /([\d.,]+)\s*(?:pies|ft)\s+a\s+(?:metros|m)\b/, f: function (m) { return [parseFloat(m[1].replace(',', '.')) / 3.28084, ' metros']; } },
    { re: /([\d.,]+)\s*(?:litros|l)\s+a\s+(?:galones|gal)/, f: function (m) { return [parseFloat(m[1].replace(',', '.')) * 0.264172, ' galones']; } },
    { re: /([\d.,]+)\s*(?:galones|gal)\s+a\s+(?:litros|l)\b/, f: function (m) { return [parseFloat(m[1].replace(',', '.')) / 0.264172, ' litros']; } }
  ];

  /* ================= DISPOSITIVO (por voz) ================= */
  var APPS = {
    whatsapp: 'WhatsApp', wsp: 'WhatsApp', instagram: 'Instagram', insta: 'Instagram',
    facebook: 'Facebook', youtube: 'YouTube', spotify: 'Spotify',
    gmail: 'Gmail', correo: 'Gmail', mapas: 'Mapas', 'google maps': 'Mapas',
    chrome: 'Chrome', telegram: 'Telegram', tiktok: 'TikTok', netflix: 'Netflix',
    twitter: 'X', x: 'X', 'play store': 'Play Store', tienda: 'Play Store',
    reloj: 'Reloj', calendario: 'Calendario', agenda: 'Calendario',
    calculadora: 'Calculadora', notas: 'Keep', musica: 'YT Music'
  };
  var SETTINGS = {
    wifi: 'Wi-Fi', 'wi fi': 'Wi-Fi', bluetooth: 'Bluetooth',
    volumen: 'Sonido', sonido: 'Sonido', brillo: 'Pantalla', pantalla: 'Pantalla',
    bateria: 'Batería', apps: 'Apps', ajustes: 'Ajustes',
    configuracion: 'Ajustes', seteo: 'Ajustes'
  };

  /* v2.8.0: B() es el único punto por el que el cerebro toca el dispositivo, así
     que es el lugar natural para avisar "estoy haciendo algo en el teléfono".
     Antes eso lo adivinaba un Proxy sobre el puente mirando los nombres de las
     llamadas; con eventos explícitos alcanza con este punto. */
  var DEVICE = /^(dial|sms|waChat|email|maps|ytSearch|webSearch|camera|torch|share|openUrl|openApp|openSettings|setAlarmDevice|setTimerDevice|addCalendarEvent)$/;
  function B(fn, args) {
    if (!window.KiuApp) return false;
    if (DEVICE.test(fn) && window.KiuState) window.KiuState.flash('tool', 'Acción del dispositivo', 2200);
    try { return KiuApp.bridgeCall(fn, args); } catch (e) { return false; }
  }

  function pickContact(q) {
    if (!window.KiuApp) return null;
    try { return KiuApp.contactSearch(q); } catch (e) { return null; }
  }

  /* ================= v2.9.0: LEER LA AGENDA =================
     Kiu ya sabía escribir eventos (addCalendarEvent abre el calendario del
     sistema) pero no leerlos, así que "¿qué tengo mañana?" no tenía respuesta.
     Estas funciones son el puente con KiuApp.calendarQuery().

     Devuelven {items, needPerm} para que quien las llama no tenga que Repeater
     el caso 'NEED_PERM' en cada sitio. */
  function calItems(q, fromMs, toMs) {
    if (!window.KiuApp || !window.KiuApp.calendarQuery) return { items: null, needPerm: false };
    var r;
    try { r = window.KiuApp.calendarQuery(q || '', fromMs, toMs); } catch (e) { return { items: null, needPerm: false }; }
    if (r === 'NEED_PERM') return { items: null, needPerm: true };
    if (!r || !r.length) return { items: [], needPerm: false };
    return { items: r, needPerm: false };
  }
  function askCalPerm() {
    if (window.KiuApp) window.KiuApp.askPerm('calendar');
  }

  /* ¿"hoy" / "mañana" / "el martes" / "esta semana"…? Devuelve la ventana
     [desde, hasta) en epoch ms, o null si la frase no habla de un día. */
  function calWindow(t) {
    var now = new Date();
    var d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    function day(n) {
      var d = new Date(d0.getTime());
      d.setDate(d.getDate() + n);
      return d;
    }
    var D = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
    var DACC = ['domingo', 'lunes', 'martes', 'mieresoles', 'jueves', 'viernes', 'sabado'];
    if (/\b(hoy|esta noche|ahorita|ahora|mas tarde|esta tarde)\b/.test(t)) {
      return { from: Math.min(d0.getTime(), now.getTime() - 3600000), to: day(1).getTime(), txt: 'hoy' };
    }
    if (/\b(manana|mañana|manana a la tarde|manana por la tarde)\b/.test(t)) {
      return { from: day(1).getTime(), to: day(2).getTime(), txt: 'mañana' };
    }
    if (/\b(pasado manana)\b/.test(t)) {
      return { from: day(2).getTime(), to: day(3).getTime(), txt: 'pasado mañana' };
    }
    if (/\b(esta semana|esta semana que viene|los proximos dias|proximos dias|lo que viene)\b/.test(t)) {
      return { from: now.getTime(), to: day(7).getTime(), txt: 'esta semana' };
    }
    for (var i = 0; i < D.length; i++) {
      var re = new RegExp('\\b(?:' + D[i] + '|' + DACC[i] + ')\\b');
      if (re.test(t)) {
        /* el "próximo" lunes puede ser hoy o dentro de 7 días: si hoy ya es ese día,
           hablamos de la semana que viene */
        var target = (d0.getDay() === i) ? 7 : ((d0.getDay() < i) ? (i - d0.getDay()) : (7 - d0.getDay() + i));
        return { from: day(target).getTime(), to: day(target + 1).getTime(), txt: DACC[i] };
      }
    }
    if (/\b(semana que viene|proxima semana|la semana que viene)\b/.test(t)) {
      return { from: day(7).getTime(), to: day(14).getTime(), txt: 'la semana que viene' };
    }
    return null;
  }

  function fmtHour(ms) {
    var d = new Date(ms);
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function fmtEvt(e) {
    var s = fmtHour(e.b) + ' ' + (e.t || '(sin título)');
    if (e.w) s += ' — ' + e.w;
    return s;
  }

  function doSearch(where, q) {
    if (where === 'youtube' || where === 'yt') {
      var okY = B('ytSearch', [q]);
      return { handled: true, text: okY ? 'Buscando "' + q + '" en YouTube.' : 'Te abro YouTube en el navegador.' };
    }
    /* v1.7.0: la búsqueda web la hace Kiu DENTRO del chat (navegador integrado);
       devolvemos handled:false para que el router la tome */
    return { handled: false };
  }

  function timeNow() {
    var d = new Date();
    return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
  }
  function dateToday() {
    var dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    var meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    var d = new Date();
    return dias[d.getDay()] + ' ' + d.getDate() + ' de ' + meses[d.getMonth()] + ' de ' + d.getFullYear();
  }

  /* ================= INTERPRETE DE FECHAS ================= */
  // Devuelve {when: Date, whenTxt: string} o null
  function parseWhen(t) {
    var now = new Date();

    /* v2.14.4 · EL MODELO HABLA OTRO IDIOMA.
       El agente le pasa el horario al parser y el modelo responde con la
       cifra pelada ("7") en vez de la frase ("a las 7"): el parser solo
       entendía frases y la herramienta contestaba "no entendí el horario".
       Medido con un modelo real (Qwen3-0.6B) sobre el arnés de evaluación:
       1 de cada 3 alarmas caía en este caso.
       Un número suelto es una hora: se acepta. */
    var crudoHora = String(t == null ? '' : t).trim();
    var conMin = crudoHora.match(/^(\d{1,2})[:.](\d{2})(?:\s*(h|hs|horas?))?$/i);
    var soloHora = conMin ? null : crudoHora.match(/^(\d{1,2})(?:\s*(h|hs|horas?))?$/i);
    if (conMin || soloHora) {
      var hSolo = parseInt(conMin ? conMin[1] : soloHora[1], 10);
      var mSolo = conMin ? parseInt(conMin[2], 10) : 0;
      if (hSolo >= 0 && hSolo <= 23 && mSolo >= 0 && mSolo <= 59) {
        var dSolo = new Date(now);
        dSolo.setHours(hSolo, mSolo, 0, 0);
        if (dSolo.getTime() <= now.getTime()) dSolo.setDate(dSolo.getDate() + 1);
        return {
          when: dSolo,
          whenTxt: 'a las ' + (hSolo < 10 ? '0' : '') + hSolo + ':' + (mSolo < 10 ? '0' : '') + mSolo
        };
      }
    }

    // "en media hora"
    if (/\ben\s+(?:una\s+)?media\s+hora\b/.test(t)) {
      return { when: new Date(Date.now() + 30 * 60000), whenTxt: 'en 30 minutos' };
    }
    // "en 20 minutos / 2 horas / una hora y media / 3 dias / 1 semana"
    var m = t.match(/en\s+(\d+|un|una)\s*(min|minuto|minutos|hora|horas|dia|dias|semana|semanas)\b(?:\s+y\s+(media|cuarto))?/);
    if (m) {
      var n = /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : 1;
      var u = m[2];
      var ms;
      if (u.indexOf('min') === 0) ms = n * 60000;
      else if (u.indexOf('hora') === 0) ms = n * 3600000 + (m[3] === 'media' ? 30 * 60000 : m[3] === 'cuarto' ? 15 * 60000 : 0);
      else if (u.indexOf('dia') === 0) ms = n * 86400000;
      else ms = n * 7 * 86400000;
      if (n <= 0 || ms > 31 * 86400000) return null;
      return {
        when: new Date(Date.now() + ms),
        whenTxt: 'en ' + n + ' ' + u + (u.indexOf('hora') === 0 && m[3] ? ' y ' + m[3] : '')
      };
    }

    // "9 menos cuarto" / "10 menos 10" -> 8:45 / 9:50
    t = t.replace(/\b(\d{1,2})\s+menos\s+(cuarto|veinte|diez|cinco|\d{1,2})\b/, function (_, hh, x) {
      var minus = x === 'cuarto' ? 15 : x === 'veinte' ? 20 : x === 'diez' ? 10 : x === 'cinco' ? 5 : parseInt(x, 10);
      var h0 = parseInt(hh, 10);
      if (!(minus > 0 && minus < 60) || h0 > 23) return _;
      return (h0 === 0 ? 23 : (h0 === 1 ? 12 : h0 - 1)) + ':' + pad(60 - minus);
    });

    // "a las 9", "a las 20:45", "a las 9 y media", "a las 9 de la noche"
    var re = /a las?\s+(\d{1,2})(?:[:.](\d{2}))?(?:\s*y\s*(media|cuarto))?(?:\s*(?:horas?|hs|h))?(?:\s*de la\s+(manana|tarde|noche))?(?:\s*(pm|am))?/;
    var hm = t.match(re);
    var tDia = t.replace(/(?:de|por|en)\s+la\s+manana/g, ' ').replace(/esta\s+manana/g, ' '); /* v2.7.1: "9 de la manana" NO es el dia siguiente */
    var dayOffset = /pasado\s+manana/.test(tDia) ? 2 : /manana/.test(tDia) ? 1 : 0;

    if (!hm && dayOffset > 0) {
      var d9 = new Date(now);
      d9.setDate(d9.getDate() + dayOffset);
      d9.setHours(9, 0, 0, 0);
      return { when: d9, whenTxt: dayOffset === 2 ? 'pasado mañana a las 9:00' : 'mañana a las 9:00' };
    }
    if (!hm) return null;

    var h = parseInt(hm[1], 10);
    var mi = hm[2] ? parseInt(hm[2], 10) : (hm[3] === 'media' ? 30 : hm[3] === 'cuarto' ? 15 : 0);
    var part = hm[4] || '';
    var ampm = hm[5] || '';
    if (!part && !ampm) {
      if (/esta\s+noche|por\s+la\s+noche/.test(t)) part = 'noche';
      else if (/esta\s+tarde|por\s+la\s+tarde/.test(t)) part = 'tarde';
      else if (/esta\s+manana|por\s+la\s+manana/.test(t)) part = 'manana';
    }
    if ((part === 'tarde' || part === 'noche') && h < 12) h += 12;
    if (part === 'noche' && h === 12) h = 0; /* 12 de la noche = medianoche */
    if (part === 'manana' && h === 12) h = 0;
    if (ampm === 'pm' && h < 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    if (h > 23 || mi > 59) return null;

    var d = new Date(now);
    d.setHours(h, mi, 0, 0);
    d.setDate(d.getDate() + dayOffset);
    if (dayOffset === 0 && d.getTime() <= now.getTime() + 60000) {
      d.setDate(d.getDate() + 1);
      dayOffset = 1;
    }
    var pref = dayOffset === 2 ? 'pasado mañana' : dayOffset === 1 ? 'mañana' : '';
    return { when: d, whenTxt: (pref ? pref + ' a las ' : 'a las ') + pad(h) + ':' + pad(mi) };
  }

  function capFirst(s) {
    s = (s || '').trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  /* ================= MOTOR PRINCIPAL ================= */
  function reply(raw) {
    var t = norm(raw);
    var orig = (raw || '').trim();

    // --- Nombre del usuario ---
    var m = orig.match(/(?:me llamo|mi nombre es|soy)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ]{2,20})\s*$/i);
    if (m && !/^(un|una|el|la|muy|tu)/i.test(m[1])) {
      var nombre = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
      if (window.KiuApp) KiuApp.setName(nombre);
      return { handled: true, text: 'Un gusto, ' + nombre + '. Ya te tengo registrado. De ahora en más te trato por tu nombre.' };
    }

    // --- Despertar: si empieza con "Kiu", lo saco (para el micro normal) ---
    t = t.replace(/^(?:oye|hey|che|dale|hola|buenas|eh)\s+kiu\s+/, '');
    t = t.replace(/^kiu\s+/, '').trim();
    t = cleanVoice(t);
    if (/^kiu$/.test(t) || t === '') {
      if (/^kiu$/.test(norm(raw))) {
        return { handled: true, text: 'Acá estoy. Decime lo que necesites: "enciende la linterna", "pon un temporizador de 5 minutos", "llama a mamá"... lo que sea.' };
      }
    }

    // ============ COMANDOS DE DISPOSITIVO (voz real) ============

    // Linterna con el flash real del teléfono
    if (/(enciende|prende|prender|encender|activa|activar|dame|con|pon|pone)\s+(?:la\s+|el\s+)?(linterna|flash|torch)/.test(t)
        || /^(linterna|flash)\s*(on|encendida|prendida)$/.test(t)) {
      var okT = B('torch', [true]);
      /* v2.8.0: sin flash propio, B() ya encendió la capa 'tool' con
         'Acción del dispositivo' (es una llamada real al puente). */
      return { handled: true, text: okT
        ? 'Listo, linterna encendida. Decime "apaga la linterna" cuando quieras.'
        : 'Este teléfono no me deja usar el flash. Usá la Linterna de Herramientas, que ilumina con la pantalla.' };
    }
    if (/(apaga|apagar|desactiva|desactivar|sacame|quita|quitale)\s+(?:la\s+|el\s+)?(linterna|flash|torch)/.test(t)
        || /^(linterna|flash)\s*(off|apagada)$/.test(t)) {
      B('torch', [false]);
      if (window.KiuTools) KiuTools.closeLinterna();
      return { handled: true, text: 'Listo, apagué la linterna.' };
    }

    // Volumen / brillo: Android no deja moverlos desde una app sin permisos
    // especiales, asi que se abre el ajuste correcto en vez de fingir que se hizo.
    m = t.match(/^(?:sube|subele|subile|subi|subir|baja|bajale|bajar|aumenta|aumentar|reduce|reducir|pon|pone|poner|maximo|minimo)\s+(?:mas\s+|menos\s+)?(?:el\s+|la\s+)?(volumen|brillo|sonido)\b/);
    if (m) {
      var vKey = m[1] === 'brillo' ? 'brillo' : 'volumen';
      var okV = B('openSettings', [vKey]);
      return { handled: true, text: okV
        ? 'No puedo mover el ' + vKey + ' yo sola desde acá, pero te abrí los ajustes de ' + SETTINGS[vKey] + ' para que lo regules.'
        : 'No pude abrir los ajustes de ' + SETTINGS[vKey] + '.' };
    }

    // «pon música» / «reproduce música»: abre el reproductor en vez de caer al router
    if (/^(?:pon|pone|poner|reproduce|reproducir|escuchar|quiero escuchar)\s+(?:algo de\s+|un poco de\s+)?musica$/.test(t)) {
      var okM = B('openApp', ['musica']);
      return { handled: true, text: okM ? 'Te abrí YT Music. Elegí qué querés escuchar.' : 'No encontré YT Music en este teléfono.' };
    }

    // Abrir apps y ajustes
    m = t.match(/^(abre|abri|abrime|abrir|anda a|inicia|arranca|llevame a)\s+(?:la\s+|el\s+|los\s+|las\s+|mi\s+)?(.+?)(?:\s+app)?$/);
    if (m) {
      var verb = m[1];
      var target = m[2].trim();
      var sKey = null;
      for (var sk in SETTINGS) {
        if (target === sk || target === sk.replace(/ /g, '')) { sKey = sk; break; }
      }
      if (sKey) {
        var okS = B('openSettings', [sKey]);
        return { handled: true, text: okS ? 'Te abrí los ajustes de ' + SETTINGS[sKey] + '. Ahí lo activás o lo apagás.' : 'No pude abrir los ajustes.' };
      }
      if (target === 'camara' || target === 'camara de fotos') {
        B('camera');
        return { handled: true, text: 'Te abrí la cámara. Sonreí.' };
      }
      var appLbl = APPS[target] || null;
      if (appLbl) {
        var okA = B('openApp', [target]);
        return { handled: true, text: okA ? 'Te abrí ' + appLbl + '.' : 'No encontré ' + appLbl + ' en este teléfono.' };
      }
      if (verb !== 'llevame a') {
        var okU = B('openApp', [target]);
        return { handled: true, text: okU
          ? 'Busqué "' + target + '" y te abrí lo mejor que encontré en la tienda.'
          : 'No encontré esa app. Probá con: "abre WhatsApp", "abre Spotify", "abre YouTube"...' };
      }
      // "llevame a ..." que no es app → sigue a mapas
    }

    // Sacar foto / abrir cámara
    if (/(saca|sacá|toma|tomar|abre|abri|abrime)\s+(?:una\s+|la\s+)?(foto|fotos|camara|cámara)/.test(t)) {
      B('camera');
      return { handled: true, text: 'Cámara lista. Sacá la foto.' };
    }

    // Llamar
    m = t.match(/^(?:llama|llamar|llamale|llamame|marca|marcá|marcar)\s+(?:al\s+|a\s+|el\s+|la\s+)?(.+)$/);
    if (m) {
      var tgt = m[1].trim();
      var digits = tgt.replace(/\D/g, '');
      if (digits.length >= 3 && digits.length >= tgt.replace(/\s/g, '').length - 1) {
        var okD = B('dial', [digits]);
        return { handled: true, text: okD ? 'Marcando ' + tgt + '. Tocá llamar cuando quieras.' : 'No pude abrir el marcador.' };
      }
      var c = pickContact(tgt);
      if (c === 'NEED_PERM') {
        if (window.KiuApp) KiuApp.askPerm('contacts');
        return { handled: true, text: 'Para llamarte a tus contactos necesito permiso de agenda. Tocá "Permitir" en el cartel y repetime.' };
      }
      if (c && c.length) {
        B('dial', [c[0].num]);
        return { handled: true, text: 'Llamando a ' + c[0].name + ' (' + c[0].num + '). Te abrí el marcador.' };
      }
      return { handled: true, text: 'No encontré a "' + tgt + '" en tus contactos. Probá con el número: "llamá al 2644 555 123".' };
    }

    // WhatsApp por voz
    m = t.match(/(?:manda|envia|enviale|escribile|mandale)\s+(?:un\s+|una\s+)?(?:whatsapp|wsp|whats)\s+(?:a\s+|para\s+|al\s+)?(.+?)(?:\s+(?:diciendo|que diga|que dice)\s+(.+))?$/);
    if (m) {
      var tgtW = m[1].trim();
      var msgW = m[2] ? m[2].trim() : '';
      var numW = '', nameW = tgtW;
      var digW = tgtW.replace(/\D/g, '');
      if (digW.length >= 6) {
        numW = digW;
      } else {
        var cw = pickContact(tgtW);
        if (cw === 'NEED_PERM') {
          if (window.KiuApp) KiuApp.askPerm('contacts');
          return { handled: true, text: 'Necesito permiso de agenda para buscar a "' + tgtW + '". Tocá "Permitir" y repetime.' };
        }
        if (cw && cw.length) { numW = cw[0].num.replace(/\D/g, ''); nameW = cw[0].name; }
      }
      if (!numW) {
        return { handled: true, text: 'No encontré a "' + tgtW + '" en tus contactos y no es un número. Probá: "manda un whatsapp al 5491122334455 diciendo hola".' };
      }
      var okW = B('waChat', [numW, msgW]);
      return { handled: true, text: okW
        ? 'Te abrí el chat de WhatsApp con ' + nameW + (msgW ? ' y ya va escrito: "' + msgW + '". Solo tocá enviar.' : '. Ahí escribís el mensaje.')
        : 'No pude abrir WhatsApp.' };
    }

    // SMS por voz
    m = t.match(/(?:manda|envia|enviale|escribile|mandale)\s+(?:un\s+|una\s+)?(?:sms|mensaje de texto|mensaje|texto)\s+(?:a\s+|para\s+|al\s+)?(.+?)(?:\s+(?:diciendo|que diga|que dice)\s+(.+))?$/);
    if (m) {
      var tgtS = m[1].trim();
      var msgS = m[2] ? m[2].trim() : '';
      var numS = '', nameS = tgtS;
      var digS = tgtS.replace(/\D/g, '');
      if (digS.length >= 6) {
        numS = digS;
      } else {
        var cs = pickContact(tgtS);
        if (cs === 'NEED_PERM') {
          if (window.KiuApp) KiuApp.askPerm('contacts');
          return { handled: true, text: 'Necesito permiso de agenda. Tocá "Permitir" y repetime.' };
        }
        if (cs && cs.length) { numS = cs[0].num.replace(/\D/g, ''); nameS = cs[0].name; }
      }
      if (!numS) return { handled: true, text: 'No encontré a "' + tgtS + '". Probá con el número directo.' };
      var okS2 = B('sms', [numS, msgS]);
      return { handled: true, text: okS2 ? 'Te abrí los mensajes para ' + nameS + (msgS ? ' con el texto listo: "' + msgS + '".' : '.') : 'No pude abrir mensajes.' };
    }

    // Mapas: rutas y lugares
    m = t.match(/(?:como llego|como voy|donde queda|donde esta|ruta hasta|llevame)\s+(?:a|al|hacia|hasta|para)\s+(.+)$/);
    if (m) {
      var place = m[1].trim();
      if (!APPS[place]) {
        var okM = B('maps', [place]);
        return { handled: true, text: okM ? 'Te abrí Mapas con la ruta a ' + place + '.' : 'No pude abrir Mapas.' };
      }
    }

    // Búsqueda: YouTube / Google
    m = t.match(/^(?:busca|buscame|buscar|googlea|google|investiga)\s+(.+?)\s+en\s+(youtube|yt|google|internet|la web)\s*$/);
    if (m) return doSearch(m[2], m[1].trim());
    m = t.match(/^(?:busca|buscame|buscar|googlea|google|investiga)\s+(?:en\s+)?(?:(youtube|yt|google)\s+)?(.+)$/);
    if (m && m[2] && m[2].trim()) return doSearch(m[1] || 'google', m[2].trim());

    // Alarma del reloj del sistema
    m = t.match(/^(?:pone|pon|póne|coloca|programa|configura)\s+(?:una\s+|un\s+|la\s+|el\s+)?(alarma|despertador)\s+(?:para\s+|de\s+|las\s+)?(.+)$/);
    if (m) {
      var wA = parseWhen(m[2]);
      if (!wA) return { handled: true, text: '¿A qué hora? Decime "pon alarma a las 7 y media".' };
      var okAl = B('setAlarmDevice', [wA.when.getHours(), wA.when.getMinutes()]);
      if (okAl) return { handled: true, text: 'Te puse la alarma del reloj ' + wA.whenTxt + '. Confirmala en la app del reloj.' };
      if (window.KiuApp) KiuApp.addReminder('Alarma', wA.when);
      return { handled: true, text: 'No pude abrir el reloj, así que te puse un recordatorio de Kiu ' + wA.whenTxt + '. Suena igual.' };
    }

    // ============ RECORDATORIOS / ALARMAS ============
    var rm = t.match(/^(?:recuerdame|recordame|avisa?me|avisame|reme|pone un recordatorio de|pone recordatorio de|recordatorio de|recordatorio)\s+(?:que\s+|de\s+)?(.+)$/);
    if (rm) {
      var resto = rm[1];
      var w = parseWhen(resto);
      if (!w) {
        return { handled: true, text: 'Decime cuándo te aviso. Por ejemplo:\n- "recuérdame llamar a Juan a las 9"\n- "recuérdame el turno en 2 horas"\n- "recuérdame pagar el alquiler mañana a las 10"' };
      }
      // quitar del titulo la parte de tiempo consumida
      var titulo = resto;
      titulo = titulo.replace(/\ba las?\s+\d{1,2}(?:[:.]\d{2})?(?:\s*y\s*(?:media|cuarto))?(?:\s*(?:horas?|hs|h))?(?:\s*de la\s+(?:manana|tarde|noche))?(?:\s*(?:pm|am))?/, '');
      titulo = titulo.replace(/\ben\s+\d+\s*(?:min|minuto|minutos|hora|horas|dia|dias|semana|semanas)\b/, '');
      titulo = titulo.replace(/\b(pasado\s+manana|manana)\b/, '');
      titulo = titulo.replace(/\s{2,}/g, ' ').replace(/^[\s-]+|[\s-]+$/g, '');
      if (!titulo) titulo = 'Recordatorio';
      titulo = capFirst(titulo);
      var diaTxt = w.when.getDate() === new Date().getDate() ? 'hoy' : (w.when.getDate() === new Date().getDate() + 1 ? 'mañana' : 'el ' + w.when.getDate() + '/' + (w.when.getMonth() + 1));
      var okR = window.KiuApp ? KiuApp.addReminder(titulo, w.when) : false;
      return {
        handled: true,
        text: 'Dale, te sueno la alarma ' + (okR ? '' : '(con la app en el teléfono) ') + w.whenTxt + ': "' + titulo + '". Te llega la notificación aunque tenga la app cerrada.'
      };
    }

    if (/(mis recordatorios|mis alarmas|que recordatorios tengo|que alarmas tengo|cuantos recordatorios)/.test(t)) {
      var rems = window.KiuApp ? KiuApp.reminders() : [];
      if (!rems.length) return { handled: true, text: 'No tenés alarmas puestas. Decime "recuérdame [algo] a las [hora]" y listo.' };
      var oRem = 'Tenés ' + rems.length + ' alarma' + (rems.length === 1 ? '' : 's') + ' activa' + (rems.length === 1 ? '' : 's') + ':\n';
      rems.slice(0, 8).forEach(function (r, ix) {
        oRem += (ix + 1) + '. ' + r.title + ' — ' + r.date + '\n';
      });
      return { handled: true, text: oRem.trim() };
    }

    m = t.match(/^(?:cancela|cancelar|elimina|eliminar|borra|borrar)\s+(?:el\s+|la\s+)?(?:recordatorio|alarma|recordatorios?)\s*(?:de\s+|del\s+)?(.*)$/);
    if (m) {
      var cRes = window.KiuApp ? KiuApp.cancelReminderByTitle(m[1]) : null;
      if (!cRes) return { handled: true, text: 'No encontré esa alarma. Preguntame "mis recordatorios" para ver la lista.' };
      return { handled: true, text: 'Listo, cancelé la alarma de "' + cRes.title + '".' };
    }

    // ============ EVENTOS DE CALENDARIO ============
    m = t.match(/^(?:agenda|agendame|agendar|crea un evento|crea evento|crear evento|evento|anota en el calendario|meteme en el calendario)\s+(?:que\s+|de\s+|un\s+|una\s+)?(.+)$/);
    if (m) {
      var wE = parseWhen(m[1]);
      if (!wE) {
        return { handled: true, text: 'Decime cuándo es el evento. Por ejemplo: "agenda turno dentista mañana a las 15".' };
      }
      var tE = m[1]
        .replace(/\ba las?\s+\d{1,2}(?:[:.]\d{2})?(?:\s*y\s*(?:media|cuarto))?(?:\s*(?:horas?|hs|h))?(?:\s*de la\s+(?:manana|tarde|noche))?(?:\s*(?:pm|am))?/, '')
        .replace(/\ben\s+\d+\s*(?:min|minuto|minutos|hora|horas|dia|dias|semana|semanas)\b/, '')
        .replace(/\b(pasado\s+manana|manana)\b/, '')
        .replace(/\s{2,}/g, ' ').replace(/^[\s-]+|[\s-]+$/g, '');
      if (!tE) tE = 'Evento';
      if (window.KiuApp) KiuApp.addCalendarEvent(capFirst(tE), wE.when.getTime());
      return { handled: true, text: 'Te abrí el calendario con el evento "' + capFirst(tE) + '" para ' + wE.whenTxt + '. Confirmalo ahí y queda guardado.' };
    }

    /* v2.12.0 · SOLO MENSAJES CORTOS. Estas reglas eran regex sueltas: «hola, explicame
       la fotosintesis» devolvia el saludo fijo, «ayudame a entender X» la lista de
       comandos y «gracias, y por que el cielo es azul» un «de nada». El modelo local
       nunca se enteraba. Ahora una charla de cortesia es un mensaje corto; si trae
       una pregunta de verdad (mas de 4 palabras) se la deja pasar al modelo. */
    var nPal = t ? t.split(' ').length : 0;
    var corto = nPal <= 4;

    // --- Saludos ---
    if (corto && /^(hola|holaa+|buenas|buen dia|buenos dias|buenas tardes|buenas noches|hey|che|epa|que tal|holi)\b/.test(t)) {
      var nom = window.KiuApp ? KiuApp.getName() : '';
      return { handled: true, text: (nom ? 'Hola, ' + nom + '. ' : 'Hola. ') + 'Acá estoy. ¿Necesitás una alarma, una nota, un cálculo o simplemente charlar?' };
    }
    if (corto && /^(chau|adios|hasta luego|nos vemos|me voy)\b/.test(t)) {
      return { handled: true, text: 'Dale, acá voy a estar. Cuando vuelvas seguimos donde lo dejamos.' };
    }
    if (corto && /(gracias|gracias kiu|te pasaste)/.test(t)) {
      return { handled: true, text: 'De nada, para eso estoy. Cualquier otra cosa avisame.' };
    }
    if (corto && /(como estas|como andas|todo bien|que haces)/.test(t)) {
      return { handled: true, text: 'Al cien: cerebro local respondiendo, memoria intacta y cero quejas. ¿Y vos, cómo andás?' };
    }

    // --- Identidad ---
    if (corto && /(quien eres|que eres|quien sos|vos que sos)/.test(t)) {
      return { handled: true, text: 'Soy Kiu, tu agente personal. Vivo en este teléfono con un cerebro local, sin mandar nada a ningún servidor. Puedo darte alarmas exactas, guardarte recuerdos, llevar tareas, hacer cálculos y más. Si conectás tu API en Ajustes, también charlo con IA completa.' };
    }
    if (corto && /(que puedes hacer|que sabes hacer|ayuda|ayudame|funciones|comandos|para que servis)/.test(t)) {
      return { handled: true, text: 'Esto manejo sin internet:\n- "Enciende la linterna" / "Apaga la linterna" (flash real)\n- "Pon alarma a las 7 y media" (reloj del sistema)\n- "Temporizador de 10 minutos" (suena aunque la app esté cerrada)\n- "Llama a mamá" o "llamá al 911"\n- "Manda un whatsapp a Juan diciendo ya llego"\n- "Busca recetas en YouTube" / "Busca clima en Google"\n- "Abre Spotify" / "Abre WhatsApp" / "Abre Wi-Fi"\n- "Cómo llego al aeropuerto" (rutas en Mapas)\n- "Recuérdame X a las 9" → alarma con notificación\n- "Agenda X mañana a las 15" → evento en calendario\n- "Recuerda que...", "tarea: ...", "nota: ..."\n- "¿Qué hora es?", "Calcula 15% de 2300", "10 kg a libras"\n- "Contraseña segura", chistes, ánimo\n\nY si activás "Despertar por voz" en Ajustes, me despiertás diciendo "Kiu".' };
    }

    // --- Hora y fecha ---
    if (nPal <= 6 && /(que hora|hora es|me decis la hora|la hora)/.test(t)) {
      return { handled: true, text: 'Son las ' + timeNow() + '.' };
    }
    if (nPal <= 6 && /(que dia|fecha de hoy|dia es hoy|fecha es hoy|en que fecha)/.test(t)) {
      return { handled: true, text: 'Hoy es ' + dateToday() + '.' };
    }

    // --- Porcentaje ---
    m = t.match(/([\d.,]+)\s*%\s*de\s*([\d.,]+)/);
    if (m) {
      var p = parseFloat(m[1].replace(',', '.')), base = parseFloat(m[2].replace(',', '.'));
      if (!isNaN(p) && !isNaN(base)) {
        var r = Math.round(base * p / 100 * 100) / 100;
        return { handled: true, text: fmtNum(p) + '% de ' + fmtNum(base) + ' es ' + fmtNum(r) + '.' };
      }
    }

    // --- Cálculo pedido ---
    m = orig.match(/(?:calcula|calcular|cuanto es|cuanto da|resolve|resuelve)\s+(.+)/i);
    if (m) {
      var val = safeMath(m[1]);
      if (val !== null) return { handled: true, text: 'Da ' + fmtNum(val) + '.' };
    }

    // --- Aritmética sola ---
    if (/^[\d.,\s]+\s*[+\-*/x×÷]\s*[\d.,\s]/.test(orig) && orig.length < 40) {
      var v2 = safeMath(orig);
      if (v2 !== null) return { handled: true, text: 'Da ' + fmtNum(v2) + '.' };
    }

    // --- Conversiones ---
    for (var i = 0; i < CONV.length; i++) {
      m = orig.match(CONV[i].re);
      if (m) {
        var cr = CONV[i].f(m);
        return { handled: true, text: 'Son ' + fmtNum(Math.round(cr[0] * 1000) / 1000) + cr[1] + '.' };
      }
    }

    // --- Memoria: recuerdos ---
    m = orig.match(/^(?:recuerda|recordar|no olvides|anotate|apuntate|guarda)\s+(?:que\s+|esto:?\s+|me\s+)?(.+)$/i);
    if (m) {
      if (window.KiuMem) {
        KiuMem.addRecuerdo(m[1].trim());
        return { handled: true, text: 'Listo, lo guardé en tu Memoria: "' + m[1].trim() + '". Lo ves en la pestaña Recuerdos.' };
      }
    }
    if (/(mis recuerdos|que recuerdas|que te anote|lista de recuerdos|que sabes de mi)/.test(t)) {
      if (window.KiuMem) {
        var recs = KiuMem.list('recuerdos');
        if (!recs.length) return { handled: true, text: 'Todavía no me anotaste nada. Decime "recuerda que..." con lo que quieras guardar.' };
        var out = 'Esto es lo que tengo (' + recs.length + '):\n';
        recs.slice(0, 8).forEach(function (r, ix) { out += (ix + 1) + '. ' + r.text + '\n'; });
        return { handled: true, text: out.trim() };
      }
    }

    // --- Tareas ---
    m = orig.match(/^(?:tarea:|nueva tarea|agregar tarea|agrega tarea|anotate tarea|tengo que|me falta)\s+(?:hacer\s+)?(.+)$/i);
    if (m && !/^\d/.test(m[1])) {
      if (window.KiuMem) {
        KiuMem.addTarea(m[1].trim());
        var tot = KiuMem.count('tareas');
        return { handled: true, text: 'Tarea agregada: "' + m[1].trim() + '". Tenés ' + tot + ' pendiente' + (tot === 1 ? '' : 's') + ' en total.' };
      }
    }
    if (/(mis tareas|que tareas|cuantas tareas|tareas pendientes|lista de tareas|como van las tareas)/.test(t)) {
      if (window.KiuMem) {
        var tars = KiuMem.list('tareas').filter(function (x) { return !x.done; });
        if (!tars.length) return { handled: true, text: 'Cero tareas pendientes. A pleno.' };
        var o2 = 'Tenés ' + tars.length + ' pendiente' + (tars.length === 1 ? '' : 's') + ':\n';
        tars.slice(0, 8).forEach(function (r, ix) { o2 += (ix + 1) + '. ' + r.text + '\n'; });
        return { handled: true, text: o2.trim() };
      }
    }
    if (/(termine la tarea|tarea lista|complete la tarea|marcar tarea|ya hice la tarea)\s*(.*)/.test(t)) {
      if (window.KiuMem) {
        var mm = t.match(/(?:termine la tarea|tarea lista|complete la tarea|marcar tarea|ya hice la tarea)\s*(.*)/);
        var okRes = KiuMem.completeTarea(mm[1] || '');
        return { handled: true, text: okRes };
      }
    }

    // --- Notas ---
    m = orig.match(/^(?:nota:|nota nueva|crea nota|crear nota|anota|apunta)\s*:?\s*(.+)$/i);
    if (m) {
      if (window.KiuMem) {
        KiuMem.addNota(m[1].trim());
        return { handled: true, text: 'Nota guardada: "' + m[1].trim() + '". Quedó en Memoria, sección Notas.' };
      }
    }
    if (/(mis notas|que notas tengo|lee mis notas|lista de notas)/.test(t)) {
      if (window.KiuMem) {
        var notas = KiuMem.list('notas');
        if (!notas.length) return { handled: true, text: 'No tenés notas todavía. Decime "nota: ..." y la guardo al instante.' };
        var o3 = 'Tus notas (' + notas.length + '):\n';
        notas.slice(0, 8).forEach(function (r, ix) { o3 += (ix + 1) + '. ' + r.text + '\n'; });
        return { handled: true, text: o3.trim() };
      }
    }

    // --- Temporizador (nativo: suena aunque la app esté cerrada) ---
    m = t.match(/(?:temporizador|timer|cuenta regresiva|cuenta atras|despertame en|despiertame en)\s*(?:de\s*)?(\d+)\s*(minuto|min|minutos|seg|segundo|segundos|hora|horas)?/);
    if (m) {
      var nT = parseInt(m[1], 10);
      var unit = m[2] || 'min';
      var secs = 0;
      if (unit.indexOf('seg') === 0) secs = nT;
      else if (unit.indexOf('hora') === 0) secs = nT * 3600;
      else secs = nT * 60;
      if (secs > 0 && secs <= 3600 * 12) {
        var lblT = /seg/.test(unit) ? nT + ' segundo' + (nT === 1 ? '' : 's')
          : /hora/.test(unit) ? nT + ' hora' + (nT === 1 ? '' : 's')
          : nT + ' minuto' + (nT === 1 ? '' : 's');
        var okN = B('startTimerNative', [secs, 'Temporizador de ' + lblT]);
        if (okN) return { handled: true, text: 'Temporizador de ' + lblT + ' arrancado. Te aviso con un sonido aunque tenga la app cerrada.' };
        if (window.KiuTools) KiuTools.startTimer(secs);
        return { handled: true, text: 'Temporizador de ' + lblT + ' arrancado. Te aviso cuando termine.' };
      }
    }

    // --- Contraseña ---
    if (/(contrasena|password|clave segura|generar clave|generame una clave)/.test(t)) {
      var pw = genPass(16);
      return { handled: true, text: 'Acá tenés una clave fuerte de 16 caracteres:\n' + pw + '\n\nCopiala rápido: no la muestro de nuevo. También está la herramienta Contraseñas.' };
    }

    // --- Decidir / moneda ---
    if (/(lanza una moneda|tirar una moneda|cara o ceca|decidi por mi|que elijo|decide por mi|que me conviene)/.test(t)) {
      var r3 = Math.random() < 0.5 ? 'Sí, dale' : 'Mejor no, esperá un poco';
      if (/moneda/.test(t)) r3 = Math.random() < 0.5 ? 'Cara' : 'Ceca';
      return { handled: true, text: r3 + '.' };
    }

    // --- Chiste / ánimo ---
    if (/(chiste|algo gracioso|haceme reir|cuentame algo)/.test(t)) {
      return { handled: true, text: pick(JOKES) };
    }
    if (/(animame|motivame|estoy mal|andar mal|me siento mal|un empujon|animo)/.test(t)) {
      return { handled: true, text: pick(MOTIV) };
    }

    // ============ v2.9.0: AGENDA (leer) ============
    // Va antes de "buscar en web" y de "compartir" a propósito: un "¿qué tengo
    // mañana?" mal ruteado caería en el navegador o en "manda esto".
    //
    // Ojo con norm(): se come el "¿", así que "¿tengo dentista mañana?" llega como
    // "tengo dentista manana?". Los patrones se aplican sobre `t` nunca ven el signo, así
    // que no se puede contar con él para distinguir una cosa de otra.
    //
    // Dos preguntas distintas, y una sola decide cuál es:
    //   · por VENTANA   "¿qué tengo mañana?"     → todo lo que hay ese día
    //   · por CONTENIDO "¿tengo dentista mañana?" → solo lo que matchea el texto
    // La diferencia está en la palabra que sigue al verbo: si es un día ("mañana")
    // o un sustantivo genérico ("algo", "reunión") es ventana; si es un nombre
    // propio ("dentista") es contenido. Antes no había esta regla y el "¿qué
    // tengo mañana?" se tomaba como búsqueda con q="manana", que no matchea nada.
    var calDia = /\b(hoy|manana|pasado manana|esta semana|proxima semana|semana que viene|proximos dias|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/;
    var calPalabra = /\b(agenda|calendario|eventos?|reuniones?|citas?|compromisos?)\b/.test(t);
    var calVerbo = /\b(tengo|pagaste|agendo|agendaste|hay)\b/.test(t);
    if (calPalabra || (calVerbo && calDia.test(t))) {
      var win = calWindow(t) || { from: Date.now(), to: Date.now() + 14 * 86400000, txt: 'próximos días' };
      /* La palabra que sigue al verbo decide ventana vs contenido. Las temporales
         y las genéricas NO son un nombre a buscar: son la pregunta misma. */
      var TEMPORAL = /^(algo|algun|alguno|una|unos|un|el|la|los|las|hoy|manana|mas|esta|este|ese|esa|proximo|proxima|pasado|ayer|ahora|tarde|noche|dias|dia|evento|eventos|reunion|reuniones|cita|citas|agenda|pendiente|pendientes|compromiso|compromisos)$/;
      var q = '';
      var mc = t.match(/\b(?:reunion con|cita con)\s+([a-z0-9]{3,30})/);
      if (mc) {
        q = mc[1];
      } else {
        var mv = t.match(/\b(?:tengo|pagaste|agendo|agendaste)\s+(?:algo de\s+|de\s+)?([a-z0-9]{3,30})/);
        if (mv && !TEMPORAL.test(mv[1])) q = mv[1];
      }
      var res = calItems(q, win.from, win.to);
      if (res.needPerm) {
        askCalPerm();
        return { handled: true, text: 'Para leerte la agenda necesito permiso de calendario. Tocá "Permitir" en el cartel y preguntame de nuevo.' };
      }
      if (res.items === null) {
        return { handled: true, text: 'No pude leer la agenda ahora. Probá en un rato.' };
      }
      if (!res.items.length) {
        return { handled: true, text: (q
          ? 'No tenés ningún evento con "' + q + '" ' + win.txt + '.'
          : 'No tenés nada agendado ' + win.txt + '.') };
      }
      var lines = res.items.slice(0, 8).map(fmtEvt);
      var extra = res.items.length > 8 ? '\n…y ' + (res.items.length - 8) + ' más.' : '';
      var head = (q ? 'Tus eventos con "' + q + '" ' + win.txt + ':'
                    : 'Tu agenda de ' + win.txt + ':');
      return { handled: true, text: head + '\n' + lines.join('\n') + extra
        + '\nTenés el primero a las ' + fmtHour(res.items[0].b) + '.' };
    }

    // --- Buscar en web --- v1.7.0: se resuelve dentro del chat con el navegador de Kiu
    m = orig.match(/^(?:busca|buscar|googlea|google|investiga)\s+(?:en\s+(?:google|internet|la web)\s+)?(.+)$/i);
    if (m) return { handled: false };

    // --- Compartir ---
    m = orig.match(/^(?:comparte|compartir|manda)\s+(?:esto\s+)?(.+)$/i);
    if (m) {
      if (window.KiuApp) KiuApp.shareText(m[1].trim());
      return { handled: true, text: 'Te abrí el menú para compartir.' };
    }

    // --- Borrar chat ---
    if (/(limpia el chat|limpiar chat|borra el chat|borrar chat|borra conversacion|nueva conversacion)/.test(t)) {
      if (window.KiuApp) KiuApp.clearChat();
      return { handled: true, text: 'Conversación limpia. Empezamos de cero.' };
    }

    // --- Estado del sistema ---
    if (/(estado del sistema|como anda el sistema|diagnostico|estado kiu)/.test(t)) {
      if (window.KiuMem && window.KiuApp) {
        var stTxt = 'Diagnóstico rápido:\n- Cerebro local: operativo\n- Recuerdos: ' + KiuMem.count('recuerdos') + '\n- Tareas pendientes: ' + KiuMem.list('tareas').filter(function (x) { return !x.done; }).length + '\n- Notas: ' + KiuMem.count('notas') + '\n- Alarmas activas: ' + KiuApp.reminders().length;
        var d0 = KiuApp.sysCache;
        if (d0 && d0.bat) stTxt += '\n- Batería: ' + d0.bat + '%' + (d0.charging ? ' (cargando)' : '');
        if (d0 && d0.ramTotal) stTxt += '\n- RAM libre: ' + Math.round(d0.ramAvail / 1073741824) + ' GB de ' + Math.round(d0.ramTotal / 1073741824) + ' GB';
        stTxt += '\n- Todo en este teléfono, sin nube.';
        return { handled: true, text: stTxt };
      }
    }

    // --- Batería (datos reales del teléfono) ---
    if (/(cuanta|cuanto)\s+bateria|bateria\s+(queda|hay|tiene|me)|nivel de bateria|como (anda|va|esta) la bateria|me queda de bateria|cual es (?:la )?bateria|(?:la )?bateria actual|^(?:la )?bateria$|cuanta carga/.test(t)) {
      var dB = window.KiuApp ? KiuApp.sysCache : null;
      if (dB && dB.bat) {
        var bTxt = 'Me queda ' + dB.bat + '% de batería';
        if (dB.charging) bTxt += ' y estoy cargando';
        if (dB.temp) bTxt += ' (el teléfono marca ' + String(dB.temp).replace('.', ',') + ' °C)';
        if (dB.bat <= 15 && !dB.charging) bTxt += '. Te recomiendo el cargador ya mismo.';
        return { handled: true, text: bTxt + '.' };
      }
      return { handled: true, text: 'No pude leer la batería ahora. En Inicio está el Estado del sistema con los datos en vivo.' };
    }

    // --- Espacio en disco ---
    if (/(cuanto|cuanta)\s+espacio|espacio\s+(libre|en disco|disponible)|memoria interna|almacenamiento|cuanto disco/.test(t)) {
      var dD = window.KiuApp ? KiuApp.sysCache : null;
      if (dD && dD.diskTotal) {
        var gbFree = Math.round(dD.diskFree / 1073741824 * 10) / 10;
        var gbTot = Math.round(dD.diskTotal / 1073741824);
        return { handled: true, text: 'Te quedan ' + String(gbFree).replace('.', ',') + ' GB libres de ' + gbTot + ' GB de almacenamiento interno.' };
      }
      return { handled: true, text: 'No pude leer el disco ahora. El Estado del sistema en Inicio lo muestra en vivo.' };
    }

    // --- RAM ---
    if (/memoria ram|cuanta ram|ram libre|cuanta memoria hay/.test(t)) {
      var dR = window.KiuApp ? KiuApp.sysCache : null;
      if (dR && dR.ramTotal) {
        var gbUsed = Math.round((dR.ramTotal - dR.ramAvail) / 1073741824 * 10) / 10;
        var gbTotR = Math.round(dR.ramTotal / 1073741824);
        return { handled: true, text: 'Estoy usando ' + String(gbUsed).replace('.', ',') + ' GB de RAM de ' + gbTotR + ' disponibles, con ' + (dR.cores || 'varios') + ' núcleos trabajando.' };
      }
      return { handled: true, text: 'No pude leer la RAM ahora. Mirá el Estado del sistema en Inicio.' };
    }

    // --- Aritmética suelta ---
    if (/^[\d.,()\s+\-*/x×÷%]+$/.test(t) && /\d/.test(t) && /[+\-*/x×÷]/.test(t)) {
      var v4 = safeMath(t);
      if (v4 !== null) return { handled: true, text: 'Da ' + fmtNum(v4) + '.' };
    }

    return { handled: false };
  }

  function genPass(len, noSymbols) {
    /* v2.7.3: noSymbols — antes tools.js reemplazaba los simbolos con Math.random() sobre un
       indice 0-26 de un alfabeto de 24 letras: devolvia '' y la clave salia mas corta. */
    var chars = noSymbols ? 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
                          : 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!#$%&*+-?';
    var arr = new Uint32Array(len);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(arr);
    } else {
      for (var i = 0; i < len; i++) arr[i] = Math.floor(Math.random() * 100000);
    }
    var out = '';
    for (var j = 0; j < len; j++) out += chars.charAt(arr[j] % chars.length);
    return out;
  }

  function fallback() {
    var apiOn = window.KiuApp && KiuApp.apiReady();
    if (apiOn) return null;
    /* v2.14.4 · MENSAJE CORTO Y HONESTO. Antes eran 362 caracteres (700 en el
       chat con el prefijo): un muro de texto para un problema puntual. Peor:
       ese texto entraba al historial y, con el historial largo, disparaba el
       resumen de memoria, que a su vez hacía fallar la respuesta siguiente
       (el bucle auto-amplificante que se corrigió en 2.14.4). Ahora: corto,
       con la tranquilidad de que no es culpa de la pregunta, y con el
       siguiente paso a mano. El detalle largo vive en el diagnóstico. */
    return 'No pude generar la respuesta con el motor local, y no es que tu pregunta sea difícil: puede que el modelo no esté cargado. Revisá Modelos, o tocá «Liberar motor».';
  }

  function tip() { return pick(TIPS); }
  function greeting(name) {
    var h = new Date().getHours();
    var sal = h < 6 ? 'Buenas noches' : h < 13 ? 'Buen día' : h < 20 ? 'Buenas tardes' : 'Buenas noches';
    return name ? sal + ', ' + name : sal;
  }

  return { reply: reply, fallback: fallback, tip: tip, greeting: greeting, genPass: genPass, norm: norm, parseWhen: parseWhen };
})();
