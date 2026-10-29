/* tests/evals/escenarios.mjs — el juego de pedidos del arnés de evaluación.
 *
 * Son pedidos REALES: la forma en que una persona le habla a su teléfono, con
 * las vacilaciones, las mayúsculas y los apodos. No hay pedidos de prueba
 * ("probá la herramienta X"): si el juego está armado a medida del
 * herramienta, el agente pasa siempre y no dice nada.
 *
 * Cada escenario dice:
 *   id       — nombre corto, para leer el reporte
 *   pedido   — lo que dice la persona
 *   espera   — la herramienta que el agente DEBERÍA elegir primero
 *   args     — (opcional) qué argumentos tienen que estar (regex o valor exacto)
 *   acepta   — (opcional) otras herramientas válidas para el mismo pedido
 *   ejemplo  — los argumentos REALES que produce un modelo que acierta. Sirven
 *              para el modelo guionizado del arnés (el que tiene que saber
 *              cómo se responde de verdad) y para verificar que el escenario
 *              es ejecutable: los argumentos tienen que pasar la validación.
 *
 * `args` con regex: el modelo no puede producir la cadena exacta ("a las
 * 7 y media" vs "a las 7:30"), pero el SENTIDO tiene que estar. Un match
 * exacto de strings sería un test imposible de pasar.
 *
 * node --test tests/evals.test.mjs
 */
export const ESCENARIOS = [
  /* ---------- alarmas y temporizadores ---------- */
  { id: 'alarma-7-media', pedido: 'poné una alarma a las 7 y media', espera: { tool: 'set_alarm' }, args: { when: /7/ }, ejemplo: { when: 'a las 7 y media' } },
  { id: 'alarma-en-20-min', pedido: 'despiertame en 20 minutos', espera: { tool: 'set_alarm' }, args: { when: /20/ }, ejemplo: { when: 'en 20 minutos' } },
  /* v2.14.4 · "un temporizador de 10 minutos" admite dos respuestas
     correctas: una alarma para dentro de 10 minutos (set_alarm) o el
     temporizador del dispositivo (device_action/timer). El arnés medía una
     sola como buena y daba un fallo falso por una respuesta correcta. */
  { id: 'temporizador-10', pedido: 'poné un temporizador de 10 minutos', espera: { tool: 'device_action', acepta: ['set_alarm'] }, args: { what: 'timer', target: /10/ }, ejemplo: { what: 'timer', target: '10' } },
  { id: 'ver-alarmas', pedido: 'qué alarmas tengo programadas', espera: { tool: 'manage_alarm' }, args: { action: 'list' }, ejemplo: { action: 'list' } },
  { id: 'borrar-alarma', pedido: 'cancelá la alarma del desayuno', espera: { tool: 'manage_alarm' }, args: { action: 'cancel', which: /desayuno/ }, ejemplo: { action: 'cancel', which: 'desayuno' } },

  /* ---------- la memoria del usuario ---------- */
  { id: 'guardar-recuerdo', pedido: 'acordate de que el dentista es el martes', espera: { tool: 'remember' }, ejemplo: { text: 'el dentista es el martes' } },
  { id: 'guardar-nota', pedido: 'anotá que tengo que llamar al banco', espera: { tool: 'remember' }, ejemplo: { text: 'tengo que llamar al banco' } },
  { id: 'preguntar-recuerdo', pedido: '¿cuándo era el dentista?', espera: { tool: 'recall' }, args: { query: /dentista/ }, ejemplo: { query: 'dentista' } },
  { id: 'ver-todo-guardado', pedido: 'qué tengo guardado', espera: { tool: 'recall' }, ejemplo: {} },
  { id: 'tarea-nueva', pedido: 'agregá una tarea: comprar pan', espera: { tool: 'manage_task' }, args: { action: 'add', text: /pan/ }, ejemplo: { action: 'add', text: 'comprar pan' } },
  { id: 'ver-tareas', pedido: 'qué tareas tengo pendientes', espera: { tool: 'manage_task' }, args: { action: 'list' }, ejemplo: { action: 'list' } },
  { id: 'completar-tarea', pedido: 'ya hice la tarea de comprar pan', espera: { tool: 'manage_task' }, args: { action: 'done' }, ejemplo: { action: 'done', text: 'comprar pan' } },
  { id: 'preferencia', pedido: 'prefiero el mate amargo', espera: { tool: 'remember' }, acepta: ['remember', 'manage_task'], ejemplo: { text: 'prefiero el mate amargo' } },
  { id: 'olvidar', pedido: 'olvidá lo del dentista', espera: { tool: 'forget' }, args: { text: /dentista/ }, ejemplo: { text: 'dentista' } },
  { id: 'corregir', pedido: 'ya no es el martes, es el jueves', espera: { tool: 'update_memory' }, args: { new_text: /jueves/ }, ejemplo: { text: 'el dentista es el martes', new_text: 'el dentista es el jueves' } },

  /* ---------- agenda y contactos ---------- */
  { id: 'agenda-manana', pedido: 'qué tengo mañana', espera: { tool: 'read_calendar' }, ejemplo: { day: 'mañana' } },
  { id: 'agenda-dentista', pedido: '¿tengo dentista esta semana?', espera: { tool: 'read_calendar' }, ejemplo: { what: 'dentista' } },
  { id: 'crear-evento', pedido: 'agendá un turno con el dentista mañana a las 15', espera: { tool: 'create_calendar_event' }, args: { title: /dentista/ }, ejemplo: { title: 'turno con el dentista', when: 'mañana a las 15' } },
  { id: 'buscar-contacto', pedido: '¿cuál es el número de Ana?', espera: { tool: 'find_contact' }, args: { name: /ana/i }, ejemplo: { name: 'Ana' } },
  { id: 'llamar', pedido: 'llamá a mamá', espera: { tool: 'call_contact' }, ejemplo: { who: 'mamá' } },
  { id: 'mandar-mensaje', pedido: 'mandale un whatsapp a Juan diciendo ya llegué', espera: { tool: 'send_message' }, args: { text: /llegu/ }, ejemplo: { to: 'Juan', text: 'ya llegué' } },

  /* ---------- el teléfono ---------- */
  { id: 'linterna', pedido: 'encendé la linterna', espera: { tool: 'device_action' }, args: { what: 'linterna' }, ejemplo: { what: 'linterna' } },
  { id: 'bateria', pedido: 'cuánta batería me queda', espera: { tool: 'device_action' }, args: { what: 'bateria' }, ejemplo: { what: 'bateria' } },
  { id: 'espacio', pedido: 'cuánto espacio me queda en el disco', espera: { tool: 'device_action' }, args: { what: 'espacio' }, ejemplo: { what: 'espacio' } },
  { id: 'abrir-spotify', pedido: 'abrí Spotify', espera: { tool: 'device_action' }, args: { what: 'abrir_app', target: /spotify/i }, ejemplo: { what: 'abrir_app', target: 'Spotify' } },
  { id: 'mapa', pedido: 'llévame al aeropuerto', espera: { tool: 'device_action' }, args: { what: 'maps' }, ejemplo: { what: 'maps', target: 'aeropuerto' } },
  { id: 'reloj', pedido: 'qué hora es', espera: { tool: 'now' }, ejemplo: {} },

  /* ---------- internet y documentos ---------- */
  { id: 'dolar', pedido: 'buscá el precio del dólar hoy', espera: { tool: 'web_search' }, ejemplo: { query: 'precio del dólar hoy' } },
  { id: 'clima', pedido: 'qué tiempo hace en Córdoba', espera: { tool: 'web_search' }, ejemplo: { query: 'clima en Córdoba' } },
  { id: 'documento', pedido: 'qué dice el contrato en mis documentos', espera: { tool: 'search_docs' }, ejemplo: { query: 'contrato' } },
];

/* Umbrales por defecto del arnés. Son metas, no adornos: si el juego no los
   cumple, el arnés falla y eso se ve en el CI.
   - acierto: la PRIMERA herramienta elegida es la correcta.
   - pasos:   cuántos turnos tardó en llegar al resultado.
   - noop:    pedidos que el agente declaró resueltos sin hacer nada. */
export const UMBRALES = { acierto: 0.8, pasosMax: 3, noopMax: 0.1 };
