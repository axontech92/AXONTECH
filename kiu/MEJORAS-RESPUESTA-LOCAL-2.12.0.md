# KIU — Que el modelo local responda de verdad (cambios sin subir versión)

## Problema
El modelo GGUF casi nunca llegaba a contestar: reglas del cerebro offline atrapaban frases
sueltas antes que él, el agente estaba apagado, el contexto era de 512 tokens (el nativo
recortaba del medio y podía perder la pregunta) y el prompt era una sola frase genérica.

## Cambios
- `brain.js`: las reglas de charla (saludo, gracias, chau, «cómo estás», «quién sos», ayuda) solo
  atrapan mensajes de hasta 4 palabras; hora/fecha hasta 6. «hola, explicame X» ya llega al modelo.
- `motor.js` · contexto: 4096 (<2,5 GB), 3072 (<5 GB) o 2048 tokens (antes 512); tope 2048 si el
  teléfono tiene <6 GB de RAM. El nativo sigue bajándolo solo si el KV Q8 no entra en la RAM libre.
- `motor.js` · router: «hoy / actualmente / esta semana…» solos ya no mandan a la web; hace falta
  además un dato que cambia (noticias, precio, clima, resultado…). Además se comparan sin tildes:
  antes «última hora» nunca coincidía.
- `app-ui.js` · `kiuMsgs`: instrucciones de «contestá lo preguntado / pedí un dato / no inventes»,
  personalidad, lo aprendido (`KB`), 4 recuerdos, hasta 3 fragmentos de documentos (1200 car.),
  6 turnos de historial de hasta 700 car. y sin el pie «(motor interno · tok/s)» que se le
  reinyectaba al modelo.
- `app-ui.js` · agente: encendido por defecto pero con compuerta `App.agentGate()` (solo órdenes
  cortas; preguntas, pedidos de texto y mensajes largos van directo al modelo). Migración única
  `_agentGateV2` para quien nunca tocó el interruptor.
- Cada respuesta del motor interno muestra ahora el nombre del modelo que contestó.
- Tope de tokens por respuesta del chat local: 320 → 480.

## Verificación
- `node --test tests/*.test.mjs`: 400 pruebas, 397 aprobadas, 0 fallidas, 3 omitidas.
- Nuevo `tests/respuesta-local-v212.test.mjs` (10 pruebas de comportamiento).
- Tres pruebas viejas fijaban el comportamiento anterior y se actualizaron a propósito.

## Límites que no deben ocultarse
- NO se compiló ni se probó en un teléfono. Todo lo de arriba está verificado con Node, no con el motor real.
- Más contexto y más tokens significan más RAM y respuestas algo más lentas en teléfonos justos.
- La compuerta del agente es una heurística: una orden redactada como pregunta («¿podés apagar la linterna?»)
  no pasa por el agente, aunque el cerebro de reglas probablemente la atrape antes.
- Pendiente: plantillas de chat armadas a mano (solo llama/gemma/qwen; el resto cae en ChatML) y
  la calidad real de los embeddings con estados ocultos de un modelo de chat.
- La versión (`versionName/versionCode`) no se tocó.
