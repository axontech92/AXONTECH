/* kiu-autoprueba.js — v2.19.0: "¿el modelo que tengo CARGADO en este teléfono sirve de agente?"
 *
 * El arnés de tests/evals necesita una PC con llama-server. Esto es lo mismo pero DENTRO de la
 * app: corre pedidos reales contra el modelo del teléfono, mismo prompt y misma gramática que el
 * agente de verdad, y cuenta aciertos y tiempo. No ejecuta ninguna herramienta (solo mira qué
 * elegiría), así que no suena ninguna alarma ni se manda ningún mensaje.
 *
 * Los casos son un subconjunto de tests/evals/escenarios.mjs; un test comprueba que no se
 * desincronicen (misma herramienta y mismos argumentos esperados).
 *
 * node --check js/kiu-autoprueba.js
 */
window.KiuAutoprueba = (function () {
  'use strict';

  var KEY = 'kiu_autoprueba';
  var MIGAS = 'kiu_autoprueba_migas';   /* rastro para saber DÓNDE murió la app si el sistema la mata */
  var UMBRAL_BIEN = 0.8;     /* mismo umbral que el arnés de la PC */
  var UMBRAL_REGULAR = 0.5;

  /* tool: herramienta esperada · acepta: otras válidas · args: valor exacto o {re:'regex'} */
  var CASOS = [
    { pedido: 'poné una alarma a las 7 y media', tool: 'set_alarm', args: { when: { re: '7' } }, rapido: 1 },
    { pedido: 'qué alarmas tengo programadas', tool: 'manage_alarm', args: { action: 'list' } },
    { pedido: 'acordate de que el dentista es el martes', tool: 'remember' },
    { pedido: '¿cuándo era el dentista?', tool: 'recall', args: { query: { re: 'dentista' } }, rapido: 1 },
    { pedido: 'agregá una tarea: comprar pan', tool: 'manage_task', args: { action: 'add', text: { re: 'pan' } }, rapido: 1 },
    { pedido: 'qué tareas tengo pendientes', tool: 'manage_task', args: { action: 'list' } },
    { pedido: 'qué tengo mañana', tool: 'read_calendar', rapido: 1 },
    { pedido: '¿cuál es el número de Ana?', tool: 'find_contact', args: { name: { re: 'ana', i: 1 } } },
    { pedido: 'llamá a mamá', tool: 'call_contact' },
    { pedido: 'mandale un whatsapp a Juan diciendo ya llegué', tool: 'send_message', args: { text: { re: 'llegu' } } },
    { pedido: 'encendé la linterna', tool: 'device_action', args: { what: 'linterna' }, rapido: 1 },
    { pedido: 'llévame al aeropuerto', tool: 'device_action', args: { what: 'maps' } },
    { pedido: 'qué hora es', tool: 'now' },
    { pedido: 'buscá el precio del dólar hoy', tool: 'web_search' },
    { pedido: 'qué tiempo hace en Córdoba', tool: 'get_weather', args: { place: { re: 'c[oó]rdoba', i: 1 } }, rapido: 1 },
    { pedido: 'resumí esta página https://example.com/nota', tool: 'summarize_url', args: { url: { re: 'example\\.com' } } },
    { pedido: 'gasté 12 en almuerzo', tool: 'log_expense', args: { action: 'add' }, rapido: 1 },
    { pedido: 'buen día, qué tengo hoy', tool: 'daily_briefing' },
    { pedido: 'qué notificaciones me llegaron', tool: 'read_notifications' },
    { pedido: 'pausá la música', tool: 'media_control', args: { action: 'pause' } },
    { pedido: 'todos los días a las 8 dame el resumen', tool: 'manage_routine', args: { action: 'add', at: { re: '8' } } }
  ];

  function coincide(valor, esperado) {
    if (esperado && typeof esperado === 'object' && esperado.re) {
      return new RegExp(esperado.re, esperado.i ? 'i' : '').test(String(valor == null ? '' : valor));
    }
    return String(valor) === String(esperado);
  }
  /* ¿esta decisión del modelo es la correcta para el caso? → {ok, motivo} */
  function evaluar(caso, dec) {
    if (!dec || !dec.ok) return { ok: false, motivo: 'el motor no respondió' + (dec && dec.err ? ' (' + dec.err + ')' : '') };
    if (!dec.tool) return { ok: false, motivo: dec.listo ? 'dijo "listo" sin hacer nada' : 'no devolvió una herramienta válida' };
    var buenas = [caso.tool].concat(caso.acepta || []);
    if (buenas.indexOf(dec.tool) < 0) return { ok: false, motivo: 'eligió ' + dec.tool };
    var esp = caso.args || {};
    for (var k in esp) {
      if (Object.prototype.hasOwnProperty.call(esp, k) && !coincide(dec.args ? dec.args[k] : undefined, esp[k])) {
        return { ok: false, motivo: 'eligió ' + dec.tool + ' pero con ' + k + ' = «' + String(dec.args && dec.args[k] != null ? dec.args[k] : '') + '»' };
      }
    }
    if (!dec.valida) return { ok: false, motivo: 'los argumentos no pasan la validación' };
    return { ok: true, motivo: '' };
  }

  function veredicto(acierto) {
    if (acierto >= UMBRAL_BIEN) return { nivel: 'bien', texto: 'Este modelo sirve como agente en tu teléfono.' };
    if (acierto >= UMBRAL_REGULAR) return { nivel: 'regular', texto: 'Anda a medias: se equivoca seguido. Probá un modelo más grande, o usalo solo para órdenes simples.' };
    return { nivel: 'mal', texto: 'Este modelo es demasiado chico para elegir herramientas. Probá uno más grande (1,5 B o más).' };
  }

  function guardar(res) {
    try {
      var m = JSON.parse(localStorage.getItem(KEY) || '{}');
      m[res.modelo] = { acierto: res.acierto, total: res.total, ms: res.msPromedio, tps: res.tps, nivel: res.nivel, at: Date.now() };
      localStorage.setItem(KEY, JSON.stringify(m));
    } catch (e) { }
  }
  function ultima(modelo) {
    try { return (JSON.parse(localStorage.getItem(KEY) || '{}'))[modelo] || null; } catch (e) { return null; }
  }

  /* Si Android mata la app en medio de la prueba, JS no puede avisar. Por eso antes de CADA
     pedido se deja una miga en localStorage y se borra al terminar; al próximo arranque,
     migasPendientes() dice en qué pedido, con qué modelo y con o sin gramática se cayó. */
  function miga(m) { try { if (m) localStorage.setItem(MIGAS, JSON.stringify(m)); else localStorage.removeItem(MIGAS); } catch (e) { } }
  function migasPendientes() {
    try { var m = JSON.parse(localStorage.getItem(MIGAS) || 'null'); return m && m.pedido ? m : null; } catch (e) { return null; }
  }
  function limpiarMigas() { miga(null); }
  function ramLibreMB() {
    try { var d = JSON.parse(window.rawBridge('sysInfo') || '{}'); return typeof d.ramAvail === 'number' ? Math.round(d.ramAvail / 1048576) : null; } catch (e) { return null; }
  }

  /* opts: {completa:bool, sinGramatica:bool, progreso:fn(i, n, caso), cancelar:fn()->bool}
     cb({ok, modelo, total, aciertos, acierto, msPromedio, tps, fallos:[{pedido, motivo}], nivel, texto}) */
  function correr(opts, cb) {
    var o = opts || {};
    var A = window.KiuAgente;
    var K = window.Kiu;
    var cargado = !!(window.S && window.S.kiu && window.S.kiu.ok);
    if (!A || typeof A.probarDecision !== 'function' || !K) { cb({ ok: false, err: 'el agente no está disponible' }); return; }
    if (!cargado) { cb({ ok: false, err: 'cargá un modelo primero (Ajustes → Modelos)' }); return; }
    var casos = CASOS.filter(function (c) { return o.completa || c.rapido; });
    var filas = [], i = 0, tpsSum = 0, tpsN = 0;
    (function sig() {
      if ((typeof o.cancelar === 'function' && o.cancelar()) || i >= casos.length) { fin(); return; }
      var caso = casos[i];
      try { if (typeof o.progreso === 'function') o.progreso(i, casos.length, caso); } catch (e) { }
      miga({ pedido: caso.pedido, n: i + 1, de: casos.length, modelo: String(window.S.kiu.name || ''), gram: !o.sinGramatica, ramMB: ramLibreMB(), at: Date.now() });
      A.probarDecision(caso.pedido, function (dec) {
        var ev = evaluar(caso, dec);
        if (dec && dec.tps) { tpsSum += dec.tps; tpsN++; }
        filas.push({ pedido: caso.pedido, ok: ev.ok, motivo: ev.motivo, ms: dec && dec.ms || 0 });
        i++;
        sig();
      }, { sinGramatica: !!o.sinGramatica });
    })();
    function fin() {
      miga(null);   /* terminó (bien o cancelada): no murió */
      var hechos = filas.length;
      var aciertos = filas.filter(function (f) { return f.ok; }).length;
      var acierto = hechos ? aciertos / hechos : 0;
      var v = veredicto(acierto);
      var res = {
        ok: hechos > 0, modelo: String(window.S.kiu.name || ''), total: hechos, aciertos: aciertos, acierto: acierto,
        msPromedio: hechos ? Math.round(filas.reduce(function (a, f) { return a + f.ms; }, 0) / hechos) : 0,
        tps: tpsN ? tpsSum / tpsN : 0,
        fallos: filas.filter(function (f) { return !f.ok; }).map(function (f) { return { pedido: f.pedido, motivo: f.motivo }; }),
        nivel: v.nivel, texto: v.texto, parcial: hechos < casos.length, sinGramatica: !!o.sinGramatica
      };
      if (res.ok && !res.parcial) guardar(res);
      cb(res);
    }
  }

  return { migasPendientes: migasPendientes, limpiarMigas: limpiarMigas, CASOS: CASOS, correr: correr, evaluar: evaluar, veredicto: veredicto, ultima: ultima, UMBRAL_BIEN: UMBRAL_BIEN };
})();
