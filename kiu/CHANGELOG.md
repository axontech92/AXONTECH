## [2.15.0] - 2026-10-29

**EL ERROR QUE IMPEDÍA ACTUALIZAR, Y ERA MÍO.**

- **"no pude verificar el archivo (SHA-256 ilegible): se borro, descargalo de nuevo".** Ese mensaje era de v2.14.2, cuando la verificación del SHA-256 trate "no pude calcular el hash" como "el archivo está corrupto": **lo borraba y pedía descargarlo de nuevo**. Con eso el usuario entraba en un bucle sin salida — descargar, ver el error, borrar, descargar — y **la actualización quedaba imposible**. No era el archivo ni el teléfono: era la guarda.
  · **Verificar es un plus, no una puerta.** Android igual verifica la firma del APK al instalarlo, así que bloquear por nuestra cuenta no daba seguridad: solo impedía instalar. Ahora, si el hash **no coincide** (corrupción real) se borra y se reintenta; si **no se pudo calcular**, se sigue y la tarjeta lo dice ("sin verificar — Android la verifica al instalar").
  · **Diagnóstico con JDK:** compilé el descargador contra un servidor local con redirección y Range (como el de GitHub) y reproduje los tres caminos. Los tres se comportaban bien — y por eso el fallo tenía que estar en el camino que no se podía ver. El arnés nuevo (`KiuDlTaskHarness`) deja eso fixeado en el CI: el magic de GGUF, el hash, el digest correcto, el digest equivocado, y **la regresión: que no poder hashear NO bloquee la instalación**. Con su control negativo: si alguien vuelve a meter la guarda, el arnés falla.
- 574 tests: 574 en verde, 0 en rojo, 0 omitidas (con JDK 17: los arneses de Java se compilan y se ejecutan de verdad).

## [2.14.9] - 2026-10-28

**POR QUÉ LA APK NO SE INSTALABA.** Y por qué la app no la bajaba.

- **"Al instalar da error"**: Android **no deja instalar un APK encima de la app instalada si los dos están firmados con claves distintas**. El error del sistema es críptico ("no se pudo instalar") y parece que el archivo está roto; la reacción natural es desinstalar Kiu, y con eso se pierden la memoria, los documentos y las conversaciones.
  · **La app ahora compara el certificado** antes de abrir el instalador y, si no coinciden, lo dice con palabras: "este APK está firmado con otra clave y Android no lo deja instalar encima del que ya tenés. Instalalo con la misma clave de siempre, o desinstalá Kiu primero (perdés la memoria y los documentos)". Aparece como tarjeta de error, no como un toast.
  · **El CI ahora CORTA el build si la firma cambió**, antes de publicar: compara el certificado del APK nuevo con el del último release. Antes solo avisaba y publicaba igual — y la clave de respaldo (la debug) sale de una caché de GitHub: si esa caché se expulsa, la clave cambia y toda la app instalada queda sin poder actualizarse. Ahora el release no sale.
  · **El script de verificación puede comparar dos APK en local**: `./scripts/verificar-apk.sh nuevo.apk --firma el-que-tenes-instalado.apk`.
- **"Dentro de la app no descarga"**: no era la app: el CI publica una release **solo cuando hay un tag (`v*`)**. Si el push fue a `main` sin tag, no hay release de la que bajar y la app no tenía nada que decir. Ahora lo dice con el motivo exacto ("el CI solo publica una release cuando hay un tag") en vez de un error genérico.
- 574 tests: 569 en verde, 0 en rojo, 5 omitidas (los arneses de Java: sin JDK se saltan a la vista; en el CI corren).

## [2.14.8] - 2026-10-28

**LA PANTALLA, POR FIN.** Lo anterior fueron tokens y un caso de error: la pantalla seguía igual. Esto es el rediseño entrando en la app de verdad.

- **LA TARJETA DEL MOTOR** (Inicio): ahora es una columna — la fila de estado, el **modelo en monoespaciado** y la **RAM como barra**. El nombre del modelo deja de ser ruido al final de cada respuesta y pasa a donde sirve: la respuesta a «¿qué está corriendo?». Y la RAM deja de ser un número suelto.
- **LAS ACCIONES DEL AGENTE SON TARJETAS** (Chat): cada herramienta que usa Kiu deja una tarjeta con su ícono, su ✓ y su resultado — «Alarma ✓ · Listo: alarma a las 7». Antes era un párrafo más, mezclado con la respuesta, y no se distinguía «Kiu lo hizo» de «Kiu lo dice». Para eso el agente ahora avisa el RESULTADO de cada herramienta, no solo que empezó.
- La tarjeta de error (2.14.7) entra en el chat con su botón, y la acción del agente queda a la vista mientras trabaja.
- Preview con el CSS real de la app (no un maqueto) en `docs/` y en la entrega, para ver el cambio sin instalar.
- 567 tests: 562 en verde, 0 en rojo, 5 omitidas (los arneses de Java: sin JDK se saltan a la vista; en el CI corren).

## [2.14.7] - 2026-10-28

**EL REDISEÑO, POR PARTES, Y LA VISIÓN QUE NO FUNCIONABA.**

- **LA VISIÓN.** El motor del teléfono no tiene soporte multimodal: el JNI no carga `mmproj` ni usa `mtmd`. Un GGUF de visión en el teléfono NO se puede ver, se tenga el modelo que se tenga. Y el ruteo lo empeoraba: en modo Auto el motor local (que no ve) se probaba **antes** que el servidor (que sí ve), así que la foto nunca llegaba a quien podía verla. Peor aún: el "swap" de visión **descargaba el modelo que el usuario tenía cargado** para poner un modelo de TEXTO (que tampoco ve), dejando el teléfono sin modelo y sin respuesta.
  Ahora: **la foto va al servidor o a la API, y el modelo que tenías cargado se queda cargado** para la siguiente pregunta de texto. No hay swap de visión. Si no hay nadie que vea, Kiu contesta el texto y lo dice claro: "no puedo ver la foto".
- **LA TARJETA DE ERROR** (lo que le faltaba al rediseño): un fallo no es una respuesta del bot, es un problema de la app, y tiene que verse distinto: ícono, qué pasó y el botón que lo resuelve ("Liberar motor", "Conectar visión", "Reintentar"). Y no se lee por el TTS — un error leído en voz alta es un error más difícil de entender, y corta la conversación. El micro se rearma igual.
- **LOS TOKENS DEL REDISEÑO**: el gris secundario daba 3,6:1 sobre el panel (por debajo del 4,5:1 de WCAG AA) — o sea, el texto más chico era el menos legible. Ahora da 5,3:1 / 5,8:1 sin perder la jerarquía. Y hay un piso de 11 px para lo que hay que leer (9,5 px queda solo para metadatos). Un test CALCULA el contraste y lo exige, así que no vuelve a bajar.
- El aviso "no veo la foto" dejó de ir en el pie opcional: es una limitación funcional, no un dato de diagnóstico, y no puede esconderse con el interruptor.
- 561 tests: 556 en verde, 0 en rojo, 5 omitidas (los arneses de Java: sin JDK se saltan a la vista; en el CI corren).

## [2.14.6] - 2026-10-28

**Tres cosas que la gente pidió en voz alta.**

- **EL PIE DE DIAGNÓSTICO SE FUE.** Cada respuesta del motor interno terminaba con «(motor interno · qwen2.5-0.5b-instruct-q4_k_m · Auto: para conversar · 6,3 tok/s en tu teléfono)»: media pantalla de ruido que nadie pidió. Ahora está **apagado por defecto** y se enciende en Ajustes → Motor local → «Detalles del motor en el chat» (el detalle real sigue en el diagnóstico, que siempre está).
- **EL CIERRE FORZADO.** «Le pedí que creara una web y se cerró»: el motor vive DENTRO del proceso de la app, así que los pesos del modelo, el contexto y el WebView comparten la RAM del teléfono; cuando eso se desborda, Android mata la app entera y el usuario no ve por qué. Ahora hay una **guarda de memoria**: si no hay RAM, Kiu no arranca la generación y lo dice con el número de megas que faltan y qué hacer («Liberar motor» o un modelo más chico); y si la memoria se hunde durante una generación larga, se corta y se devuelve el parcial, en vez de morirse. El arreglo de fondo (correr el motor en un proceso aparte) queda anotado en KNOWN_ISSUES.
- **LA VOZ SUENA MÁS NATURAL.** Se prefería la voz local del sistema (la robótica) porque las de red necesitan internet y, si fallaban, Kiu se quedaba mudo. Pero el TTS ya reintenta con una voz local si la de red falla, así que el miedo era infundado: ahora, **con internet se usa la mejor voz (network/neural, que suenan a persona)** y sin internet se cae a la local. Además, lo que se habla va limpio: las URLs ya no se leen ("https punto punto ejemplo com") y los símbolos sueltos se traducen.
- 550 tests: 545 en verde, 0 en rojo, 5 omitidas (los arneses de Java: sin JDK se saltan a la vista; en el CI corren).

## [2.14.5] - 2026-10-28

**El agente, medido de verdad.** Con un llama.cpp compilado y un Qwen3-0.6B real, el arnés de evaluación pasó de **3 % a 93 % de acierto** (28 de 30 pedidos) con el no-op del 97 % al 7 %. Lo que había abajo no son suposiciones: son cuatro bugs comprobados contra el motor real.

- **LA GRAMÁTICA DEL AGENTE NUNCA PARSEÓ.** En GBNF un salto de línea termina la regla, así que el "|" de las alternativas, al principio de la línea siguiente, era un error de sintaxis ("failed to parse grammar", verificado contra el parser real de llama.cpp). Como además el JS solo la mandaba si `kiuGenGrammarOk()` devolvía true —y ese valor dice si la gramática ANTERIOR se aplicó, y en la primera decisión nunca hubo una anterior— el agente NUNCA tuvo gramática: el modelo tenía que acertar el JSON solo.
- **EL MODELO NO HACÍA NADA.** Con la instrucción "si no necesitás ninguna herramienta: {"listo":true}", el 97 % de los pedidos terminaban con {"listo":true}. Ahora, en el PRIMER paso la gramática no ofrece esa salida (el agente solo entra para órdenes: ahí "listo" nunca es la respuesta correcta) y el prompt lleva un ejemplo del uso correcto. En los pasos siguientes "listo" vuelve, porque ahí sí corresponde.
- **LAS PALABRAS CLAVE NO MATCHEABAN.** Eran regex demasiado angostas y, además, estaban escritas con acentos mientras el pedido se normaliza sin acentos: la mitad de la lista estaba muerta. "llévame al aeropuerto" no matcheaba nada, y cuando nada matchea se devolvían las 16 herramientas en orden de registro, con lo que el ejemplo del prompt era el de `set_alarm` y el modelo armaba una alarma donde le habían pedido un mapa. Ahora son listas de palabras que se cuentan, con un desempate explícito por prioridad y la regla de que una consulta ("qué alarmas tengo") va primero a las herramientas que LEEN.
- **EL CEREBRO NO ENTENDÍA LA FORMA DEL MODELO.** El modelo responde "7" y el parser solo entendía "a las 7" → "no entendí el horario". Ahora entiende "7", "09:30" y "9.45".
- **El mensaje de error del motor pasó de 362 a 162 caracteres**: era un muro de texto y, además, alimentaba el bucle auto-amplificante (el error grande hace que el historial dispare el resumen, que hace fallar la respuesta siguiente).
- Prueba de regresión nueva: para cada pedido REAL del arnés, la herramienta que va primera tiene que ser la correcta.
- Cómo reproducir la medición: `node tests/evals/run.mjs --url http://127.0.0.1:8080/v1/chat/completions --model qwen3-0.6b` con un `llama-server` arriba.
- 545 tests: 540 en verde, 0 en rojo, 5 omitidas (los arneses de Java: sin JDK se saltan a la vista; en el CI corren).

## [2.14.4] - 2026-10-28

**"El motor interno no pudo responder (el motor sigue ocupado con una solicitud anterior)".** El error que reportaba la gente en el teléfono. No era una causa: eran tres, y una era auto-amplificante.

- EL RESUMEN DE MEMORIA LE ROBABA EL MOTOR A LA RESPUESTA. `kiuReply()` pide la respuesta en dos pasos: `kiuMsgs()` arma el prompt (y ahí, si el historial es largo, dispara un RESUMEN en segundo plano) y después `Kiu.ask()` pide la respuesta. El resumen se quedaba con el motor y la respuesta del usuario se comía un "ocupado". Ahora el resumen se aparta: espera a que el motor esté libre y en calma, y el usuario le pasa adelante si escribe mientras corre.
- Y ERA AUTO-AMPLIFICANTE: el mensaje de error ocupa 700 caracteres, con él el historial pasa los 3200 que disparan el resumen, y así cada mensaje posterior repetía el error. Un error se convertía en una condición permanente.
- EL MOTOR TIENE COLA. El motor tiene una sola puerta: si algo la está usando, el pedido ESPERA en vez de rebotar con un error (con tope de 45 s, para no colgar el chat en silencio).
- EL CONTROLADOR DE ESTADOS ACUMULABA TEMPORIZADORES. El código prometía "el temporizador es UNO, del controlador" y no era verdad: cada evento armaba un timer nuevo y los viejos no se cancelaban, así que el número de timers crecía con cada mensaje. En un WebView en segundo plano, donde Android además estrangula los timers, eso es un desgaste real de CPU.
- Si el usuario cancela y la respuesta llega tarde (con la cola), ya no se muestra ni se habla. Y el agente descarta las respuestas que llegan después de que terminó su bucle.
- 544 tests: 544 en verde, 0 en rojo, 0 omitidas (con JDK 17: los arneses de Java se compilan y se ejecutan de verdad).

## [2.14.3] - 2026-10-28

- **CAPA PREMIUM EN EL CSS**: la app ya usa el mismo lenguaje visual del mockup: vidrio esmerilado para lo que flota y se lee (portada, motor, proveedores, tip, modal, barra de abajo, burbuja del bot) y tarjetas a relieve para lo que se toca (acciones rápidas, herramientas, interruptores, botones). Va como una capa que SOLO AGREGA al final de `app.css`: si algo se ve mal, se saca la capa y la app vuelve a la de siempre. El blur de verdad solo va en las superficies grandes, porque un `backdrop-filter` en cada tarjeta repetida baja los frames en un WebView de Android.
- Arreglado el test que rompía el CI: el control negativo del arnés del descargador mutaba una sola guarda y la otra seguía atrapando el caso, así que el arnés pasaba igual y el test fallaba. Ahora deshace las dos guardas, que es lo que reproduce el comportamiento anterior a 2.14.2. El fallo era del test, no de la app.
- 8 tests nuevos de la capa premium (vigilan que sea aditiva, que el blur no baje a las tarjetas repetidas y que el relieve tenga las dos sombras).
- 539 tests: 539 en verde, 0 en rojo, 0 omitidas (con JDK 17: los arneses de Java se compilan y se ejecutan de verdad).

## [2.14.2] - 2026-10-27

**Hacia un agente que sirve.** Diagnóstico completo en `docs/AGENTE_UTIL.md`.

- La memoria del usuario sale de `app-ui.js` (5.500 líneas) a su propio módulo `js/app/memoria.js`, con búsqueda real por palabras (`search`) y un resumen corto (`summary`) para el prompt. La UI se engancha con `hooks` (`onAdd`, `onChange`): el módulo de datos no conoce la pantalla.
- Herramientas nuevas del agente: `recall` (lee recuerdos, tareas, notas y preferencias), `manage_task` (listar, crear, completar), `manage_alarm` (ver, cancelar) y `create_calendar_event` (abrir el calendario con un evento). Antes `remember` escribía en la memoria y ninguna herramienta la leía: un modelo no escribe regex.
- El prompt de decisión lleva `PERFIL DEL USUARIO` (nombre, tareas pendientes, recuerdos). Antes esa información solo estaba en el prompt de chat: el bot sabía lo que el usuario le había dicho al charlear, pero no al elegir la herramienta.
- El riesgo de una herramienta se calcula con sus argumentos (`riskFor`): leer la batería o listar tareas ya no pide confirmación; escribir sí.
- `maps`, `web` y `youtube` en `device_action` ahora funcionan. Los tres fallaban siempre con "no pude cumplir": eran capacidades que el enum anunciaba y la herramienta no tenía.
- La búsqueda web quedó en una sola función, compartida por `web_search` y `device_action`.
- Las preferencias dejan de ser un bucket vacío: "prefiero el mate amargo" ahora llena la pestaña Preferencias (nada la escribía).
- El presupuesto de prompts se mide en los dos manifests: el compacto (86 tokens, el que se paga en el móvil) y el largo (492, peor caso). Techos actualizados y verificados por test.
- El manifiesto compacto lleva los valores de los enums (`manage_task(action: list|add|done)`). Antes el modelo solo veía la firma y no tenía forma de saber qué valores eran válidos: se los inventaba, la validación lo rechazaba y se perdía una generación entera. Sube de 86 a 119 tokens en el peor caso, pero el costo real es por turno: `seleccionar()` deja 2-4 herramientas (≤60 tokens).
- Las observaciones del bucle ahora son estructuradas (`[manage_task ok] …`): el modelo distingue "no encontré nada" de "el dispositivo falló" y no se equivoca de herramienta en el paso siguiente.
- Un turno con herramientas puede costar una sola generación: si el resultado es único y corto, el texto de la herramienta ES la respuesta y no se redacta otra vez con el modelo. La redacción sigue pasando cuando hay varios resultados, cuando el texto es largo o con forma de lista (`componer: 'siempre'` la fuerza).
- Arnés de evaluación del agente (`tests/evals/`): 28 pedidos reales con la herramienta esperada, los argumentos que tiene que producir y un modelo enchufable (guionizado o un endpoint OpenAI-compatible). Mide acierto de herramienta, pasos hasta el éxito, no-op y latencia, con umbrales que hacen fallar el arnés si no se cumplen. Corre sin red en el CI y contra un modelo real con `node tests/evals/run.mjs`.
- El arnés encontró dos bugs que los tests de código no veían: `device_action` con "espacio" (el cerebro no entendía la palabra suelta y la herramienta contestaba "no pude cumplir") y el cancelamiento de una alarma con el título parafraseado ("la alarma del desayuno" contra la alarma "desayunar": el substring no encontraba nada y el agente cancelaba la alarma equivocada o ninguna). Los dos arreglados.
- El agente avisa en qué está: la pastilla dice qué herramienta está usando ("Busco en tu memoria", "Miro tu agenda") en vez de "Enrutando" clavado. Un turno puede dar 3-4 pasos y cada paso es una generación en la CPU del teléfono.
- La memoria tiene ciclo de vida: dos herramientas nuevas, `forget` ("olvidá lo del dentista") y `update_memory` ("ya no es el martes, es el jueves"). Antes la memoria solo crecía y el agente contestaba con datos viejos con total confianza.
- Descargador de modelos: si el SHA-256 NO se puede calcular (error de I/O), la descarga ahora falla y borra el archivo. Antes la comparación se saltaba y el `.part` se renombraba al nombre final como si estuviera bien: un modelo posiblemente corrupto instalado, con el síntoma ("el motor no arranca") apareciendo mucho después.
- Arnés de ejecución real del descargador (`tests/java/com/kiu/agent/KiuDlTaskHarness.java`): magic de GGUF, SHA-256 real, borrado cuando el hash no coincide y rechazo de lo que no se puede verificar. Con su control negativo (el arnés tiene que fallar si se rompe la verificación).
- El CI declara el JDK del job de tests: los arneses de Java se compilan y se ejecutan de verdad, en vez de depender de que la imagen del runner lo traiga. Sin JDK se saltan a la vista, nunca en silencio.
- **Cuatro carreras del motor que dejaban al agente en "motor ocupado" para siempre** (2.14.2):
  - El watchdog de 10 minutos de `ask()` comprobaba `pending.op === 'gen'` en vez de SU pending: diez minutos después de CUALQUIER generación mataba la que estuviera corriendo, la cortaba y le ponía "tardó demasiado".
  - Un evento de carga que llegaba tarde liberaba el flag de occupied de una generación en vuelo: el JS creía que el motor estaba libre mientras el nativo generaba, y el pedido siguiente lo rechazaba el nativo.
  - Un push de generación que llegaba tarde cerraba la generación SIGUIENTE: le entregaba el texto viejo al callback nuevo y le borraba el pending, dejando el motor en "Generando" para siempre. Ahora el evento lleva el id de la generación y el JS descarta el que no es suyo.
  - El puente se capturaba UNA sola vez al cargar `env.js`: si `window.KiuBridge` no estaba en ese instante, moría en silencio para siempre (kiuGen devolvía null y el agente contestaba "ocupado" con el modelo cargado). Ahora se resuelve en cada llamada.
- El agente ESPERA al motor ocupado (hasta ~24 s) en vez de rendirse al instante, y tiene un reloj de 2 min por decisión: si el motor no responde, el bucle termina en vez de quedar colgado con la pastilla de "Generando".
- El motor distingue "no hay motor" de "el motor está ocupado": si el puente no tiene el método, el mensaje lo dice en vez de mentir con un "ocupado" que no es cierto.
- El comando de la palabra de activación no se pierde más en un arranque en frío: si la actividad existe pero la página todavía no está lista, el comando queda en cola y lo entrega `pageReady()` (antes se descartaba en silencio: la persona decía "Kiu, poné una alarma" y no pasaba nada).
- 26 tests nuevos. Suite completa: 539 pruebas, 539 en verde, 0 en rojo, 0 omitidas (con JDK: los arneses de Java se compilan y se ejecutan de verdad). Los omitidos son los arneses de Java: acá no hay JDK, así que se saltan a la vista (en el CI corren). La compilación de APK y C++ sigue pendiente: este paquete no incluye `vendor/llama.cpp` ni las `.so` del motor.

## [2.14.1] - 2026-10-24

- Diagnóstico de generación: `genStatus` expone `running` e ID incremental por solicitud; `done` también se marca al finalizar con cero tokens.
- JavaScript ignora el estado/texto de una generación anterior y reporta si JNI no publica el inicio en 12 segundos.
- El motor devuelve errores controlados si no puede reservar sampler, batch o memoria del token, en lugar de desreferenciar punteros nulos.
- Verificación estática y pruebas automatizadas ejecutadas. La compilación C++/APK sigue pendiente: este ZIP no incluye `vendor/llama.cpp` ni bibliotecas `.so`.

## [2.14.0] - 2026-10-24

- Cierre de Harness²: selección/rollback del perfil activo y validación antes de ejecutar herramientas.
- Hermes 2: perfiles de formato para modelos ya importados, prompt `<tool_call>` y gramática GBNF con pruebas de parseo/validación.
- Caché KV: reutilización conservadora del prefijo común; invalidación al limpiar memoria, cambiar contexto o calcular embeddings.
- Memoria procedural: recetas locales a partir de tareas con al menos tres herramientas exitosas; solo guarda keywords y nombres de herramientas, sin argumentos/resultados. Las recetas sugieren, no ejecutan.
- Periodic Nudge: intenta consolidar historial extenso con el compresor existente antes de descargar el modelo en inactividad; conserva el historial original.
- Voz: TTS en streaming por oración y salto de línea; panel de diagnóstico con RMS dBFS limitado a 2 muestras/segundo y estado de AEC/supresión de ruido.
- Rediseño visual fase 6 omitido deliberadamente, según la instrucción del usuario.
- Verificación local: 467 pruebas Node pasan y auditoría JS↔Java pasa. No se pudo compilar APK ni C++: falta `vendor/llama.cpp` y el entorno no puede descargar Gradle (`UnknownHostException`).

## [2.13.8] - 2026-10-24

- Memoria procedural local: guarda recetas tras tareas con al menos tres herramientas exitosas; no conserva argumentos ni resultados personales.
- Hermes 2: perfiles de formato para modelos ya importados, detección de familia y pruebas de `<tool_call>` + gramática. No se añaden enlaces ni hashes de descarga sin verificar.
- Las recetas coincidentes solo orientan el prompt; no ejecutan acciones automáticamente y respetan validación/confirmaciones.
- Límite de 30 recetas, palabras clave normalizadas y API para consultar o borrar recetas.
- Voz: el TTS por streaming también corta en saltos de línea completos; el diagnóstico expone RMS del micrófono y estados reales de AEC/supresión de ruido de la última sesión.
- Verificación: pruebas automatizadas y auditoría del puente; compilación nativa/APK pendiente por dependencias nativas no incluidas en el paquete de trabajo.

## [2.13.7] - 2026-10-24

- Añade reutilización conservadora del prefijo común de tokens en la caché KV nativa.
- Invalida el prefijo guardado cuando embeddings limpian la memoria, se libera el modelo o hay desplazamiento de contexto.
- Reevaluación obligatoria de al menos el último token del prompt para evitar reutilizar logits obsoletos.
- La compilación nativa y el rendimiento real deben verificarse en CI/dispositivo; esta entrega no declara esas comprobaciones como realizadas.

## [2.13.5] - 2026-10-24

Código Android: 87.

- **Harness² Compose inicial conectado al agente:** `harness2-compose.js` elige el perfil compacto local por defecto y solo usa el perfil cloud-rich si el llamador indica explícitamente `provider: "cloud"` o `remote: true`. No infiere proveedor remoto por el nombre del modelo.
- El perfil aporta límites de generación al bucle de herramientas y registra únicamente contadores agregados. No almacena prompts, argumentos ni texto de error.
- Dos fallos consecutivos devuelven el perfil al compacto; un resultado validado reinicia el contador.
- Tests específicos para selección, recuperación, privacidad del registro, compresión del manifiesto y formato Hermes. La suite completa queda en 448 pruebas. Esto no cierra aún toda la Fase 1: la auditoría de rollback en dispositivo y la validación del puente durante fallos reales siguen pendientes.
- **Hermes 2 en el agente:** si el nombre del modelo contiene `Hermes`, el prompt y la gramática GBNF usan `<tool_call>{"name":...,"arguments":...}</tool_call>`; el parser existente normaliza `name/arguments` antes de validar y ejecutar. El formato estándar de otras familias no cambia. Pendiente: prueba real con un GGUF Hermes y la versión nativa vendorizada.
- **Voz por oraciones durante la generación:** se agregó una cola de TTS que solo entrega oraciones completas, avanza al recibir el evento de fin de voz, cancela el resto al detener la generación y evita pronunciar respuestas que contienen bloques de código o etiquetas de herramientas. La latencia real menor de 400 ms y la telemetría AEC/RMS deben medirse/verificarse en dispositivo.

## [2.13.4] - 2026-10-24

Código Android: 86.

- **Auditoría del puente ampliada:** `scripts/bridge_audit.py` descubre recursivamente todos los módulos JavaScript propios bajo `assets/www/js`, excluyendo `vendor`, en vez de depender de una lista manual que podía omitir archivos nuevos.
- Reconoce además handlers JavaScript escritos con funciones flecha al revisar eventos Java→JS.
- Se mantienen las pruebas de proyecto como puerta de CI. Esta iteración no modifica el diseño visual.
- **Limitación de verificación:** la suite Node y la auditoría se ejecutan localmente; no se pudo compilar el APK en este entorno porque el wrapper Gradle necesita descargar Gradle y la conexión DNS externa no está disponible.

## [2.13.3] - 2026-10-23

Código Android: 85.

- **El formato de chat sale de la plantilla del propio GGUF.** El nativo guarda `llama_model_chat_template()` al cargar (nuevo `KiuNative.chatTemplate()` → `kiuChatTemplate`) y `Kiu.famFor()` reconoce ChatML, Llama 3, Gemma y Mistral por sus marcadores. Si no hay plantilla o no se reconoce (p. ej. Phi-3), sigue el catálogo / nombre del archivo como antes. Un modelo importado con nombre raro ya no cae en ChatML por defecto.
- Formato **Mistral** (`[INST] … [/INST]`) y detección de «mistral/mixtral» en nombres importados.
- La plantilla se sirve desde una copia (no toma `g_mtx`, que se retiene durante toda la generación) y se limpia al liberar el modelo.
- 4 tests nuevos. El fragmento C++ se comprobó con `g++ -fsyntax-only` contra el `llama.h` del commit fijado (b11669); el archivo completo y el APK siguen sin compilarse.

## [2.13.2] - 2026-10-23

Código Android: 84.

- Ajustes: nuevo interruptor **«Confirmar antes de actuar»** (`S.agentConfirm`) que cierra el pendiente de 2.13.1.
- El texto del agente en Ajustes y el aviso al activarlo ya no dicen que exige un modelo cargado (desde 2.13.0 se autocarga).
- 2 tests nuevos; se actualizó el test que fijaba el texto viejo.

## [2.13.1] - 2026-10-23

Código Android: 83.

- **Herramienta `web_search` en el agente** (asíncrona). Nuevo `App.webSnippets(q, cb)`: lee DuckDuckGo y Wikipedia sin pintar nada en el chat; el modelo ve los resultados y redacta. El bucle espera herramientas que devuelven una promesa (tope 10 s).
- **Selección de herramientas por turno** (`KiuAgente.seleccionar`): se mandan solo las que tienen palabra clave en el pedido; sin coincidencias, todas. Baja el prefill de cada decisión (la CPU del teléfono es el cuello de botella). El presupuesto del manifiesto completo pasa a 360/450 tokens como respaldo; el caso típico queda bajo 300.
- **Registro de acciones** (`getLog`/`clearLog`): herramienta, riesgo, resultado y hora; nunca los argumentos.
- **Confirmación de acciones con efecto**: `run({confirmar})` + `App.agentConfirm` (ajuste `S.agentConfirm`, apagado por defecto). Cancelar o 60 s sin respuesta no ejecuta y no cuelga el bucle. `App.confirm` acepta `onCancel`.
- 11 tests nuevos. Pendiente: compilar y probar en dispositivo; falta el interruptor de `agentConfirm` en Ajustes.

## [2.13.0] - 2026-10-23

Revisión de fondo del agente y del uso de los motores locales. Código Android: 82.

**Motores locales (lo que más fallaba)**
- Nuevo `Kiu.whenReady(cb)`: carga el último modelo (o el mejor que entre en la RAM), espera una carga ya en curso y recién entonces sigue. Antes, con el modelo descargado de memoria (proceso reiniciado, arranque en frío) Kiu pedía «mandame de nuevo tu mensaje».
- Con el **router apagado** y ningún modelo cargado, `tryTargets` nunca autocargaba el motor local y contestaba «no tengo un modelo disponible» aunque hubiera modelos descargados. Ahora lo carga y responde.
- Si el motor está **ocupado**, `tryTargets` espera (hasta ~30 s) en vez de saltar a la nube o al mensaje de «sin modelo».
- El agente ya no exige `S.kiu.ok`: si hay un modelo descargado, lo carga y sigue.

**Agente**
- **Gramática GBNF rota (crítico).** Emitía `set_alarm{when:…}` (sin comillas, sin `{"tool":…}`), tenía una `}` suelta y nombres de regla con guion bajo, que llama.cpp no admite. El sampler devolvía `null` y cada decisión salía sin restricción. Reescrita: emite `{"tool":…,"args":{…}}` válido; `grammar(solo)` respeta la lista.
- Nuevas herramientas: `send_message` (abre el SMS con el texto listo; el usuario toca enviar), `remember` (guarda una nota) y `now` (fecha y hora).
- El modelo **redacta la respuesta final** viendo lo que hicieron las herramientas (si falla, vale el texto crudo). `componer:false` lo apaga.
- Compuerta del agente: las preguntas sobre el teléfono («¿qué tengo mañana?», «¿cuánta batería me queda?») ahora son órdenes; el tope de palabras sube de 14 a 24.
- Qwen3: `/no_think` en las decisiones (antes gastaba los 120 tokens razonando en `<think>`).

**Plantillas**
- Llama y Gemma: se quitó el BOS escrito a mano; el tokenizador nativo ya lo agrega y quedaba duplicado.

**Tests**
- 17 tests nuevos (`agente-v213.test.mjs`) y 4 en `agente.test.mjs` (nombres de regla válidos, ramas con JSON legible, `done`, `grammar(solo)`).
- El test de versión de `embeddings-nativos` ya no fija una versión exacta (por eso la versión quedaba sin subir).
- Presupuesto de tokens del agente: manifiesto 280→320, prompt 360→410 por las tres herramientas nuevas.
- Pendiente: compilar y probar en un teléfono; nada de esto está validado en dispositivo.

## [2.12.7] - 2026-10-22

- Código Android: 81. Corrección de bloqueo del motor.

- `kiuGenStop()` y `kiuResetBusy()` ya no ponen `KiuGenJob.busy=false` de forma prematura.
- La señal de cancelación se envía al motor nativo; el worker libera el estado al salir realmente de la tarea.
- Añadida prueba de regresión para impedir que una segunda solicitud se acepte mientras la anterior sigue ejecutándose.
- Pendiente de validación en dispositivo Android: las pruebas de código no demuestran por sí solas que el modelo nativo se recupere en el teléfono.

## [2.12.6] - 2026-10-22
- Fix: tras agotar los reintentos de inicio de generación, intenta sincronizar el estado ocupado del motor nativo.
- Fix: en el timeout de seguridad, intenta detener la generación y restablecer el estado nativo antes de limpiar el estado JavaScript.
- Añadidas pruebas de regresión para el parche de recuperación del motor.
- Verificación de APK instalada en Android pendiente; esta entrega es código fuente.

## [2.12.5] - 2026-10-22

- Añade una comparación A/B reproducible del detector de peticiones web con fórmulas de cortesía frente a la expresión anterior.
- Comprueba cinco mejoras previstas y preservación de rutas generales/legadas; no modifica código automáticamente ni llama a servicios externos.
- Amplía validación de Harness²: la calidad semántica de respuestas del modelo aún requiere evaluación separada.
- Versión Android: `versionName 2.12.5`, `versionCode 79`.
- Suite Node.js y compilación APK/dispositivo pendientes de validación en esta iteración.

## [2.12.4] - 2026-10-22

- Harness² Probe: amplía la matriz reproducible de 20 a 24 casos con peticiones explícitas de búsqueda precedidas por fórmulas de cortesía.
- Enrutador: reconoce peticiones web explícitas con prefijos como «por favor», «puedes», «podrías» y «oye», sin cambiar el comportamiento de preguntas generales.
- Versión Android: `versionName 2.12.4`, `versionCode 78`.
- Validación en Node; compilación APK y prueba en dispositivo quedan pendientes.

## [2.12.3] - 2026-10-22

- Amplía Harness² Probe de 12 a 20 casos de enrutamiento, incluyendo casos negativos y frases ambiguas para vigilar falsos positivos.
- Mantiene la prueba de trazas privacy-safe: registra metadatos, no el texto de consulta.
- No introduce auto-modificación del código ni llamadas a APIs externas.
- Versión Android: `versionName 2.12.3`, `versionCode 77`.
- Suite Node.js, compilación APK y prueba en dispositivo: pendientes de verificación final de esta iteración.

## [2.12.2] - 2026-10-22

- Añade `tests/harness2-probe.test.mjs`, una matriz de 12 rutas esperadas para probar de forma reproducible el enrutador.
- Añade score de aprobación y diagnóstico por caso fallido; no modifica automáticamente el agente.
- Comprueba que la traza de enrutamiento incluye motivos y metadatos sin almacenar el texto de la consulta.
- Versión Android: `versionName 2.12.2`, `versionCode 76`.
- Pendiente: compilación APK y validación de generación en dispositivo.

## [2.12.1] - 2026-10-22

- Añade una traza en memoria de las decisiones del enrutador: tarea elegida, motivo, longitud del mensaje, entrada por voz/imagen y hora. No almacena el texto del usuario y conserva como máximo 40 decisiones.
- Expone `Rtr.lastDecision`, `Rtr.getTrace()` y `Rtr.clearTrace()` para diagnóstico local y pruebas.
- Mantiene la migración segura de `agentOn` y los cambios de respuesta local de 2.12.0.
- Actualiza la versión Android a `2.12.1` (`versionCode 75`).
- Suite Node.js: validación pendiente de ejecución tras estos cambios; compilación Android y prueba en dispositivo siguen pendientes.

## [2.12.0] - 2026-10-21

- Actualiza la versión Android a `2.12.0` (`versionCode 74`).
- Corrige la migración del interruptor del agente: conserva `agentOn: false` si el usuario lo había desactivado; las instalaciones nuevas mantienen el valor predeterminado activado.
- Añade una prueba de regresión para la preferencia del usuario.
- Verificación de JavaScript automatizada; compilación Android e instalación en dispositivo pendientes de validar.

## [2.11.22] - 2026-10-20

- Recupera estados de generación local huérfanos cuando la WebView vuelve de suspensión y no hubo progreso durante 180 segundos.
- Actualiza la actividad de la generación al recibir tokens por sondeo o streaming.
- Incrementa versionName a 2.11.22 y versionCode a 72.

## [2.11.21] — reparación del estado «motor ocupado»

- Corrige la visibilidad entre hilos de `KiuGenJob.busy`: ahora es `volatile`, para que la WebView no lea un valor obsoleto después de terminar una generación local.
- El puente JS ya no llama `stopGen()`/`resetBusy()` en cada reintento fallido de arranque, evitando interrumpir a ciegas una generación que todavía está activa.
- Amplía la ventana de reintento y devuelve un mensaje explícito si el puente sigue ocupado, en lugar de ocultar la causa tras el genérico «motor ocupado».
- Versión Android: `versionName 2.11.21`, `versionCode 71`.
- Pendiente: compilar el APK y probar la generación real en dispositivo; las pruebas estructurales no sustituyen esa comprobación.

## [2.11.20] — embeddings neuronales experimentales desde el modelo local

- Añade `KiuNative.embedText()` en JNI: obtiene los estados ocultos tokenizados del modelo GGUF ya cargado, aplica pooling medio y normalización L2, con límite de 96 tokens por entrada.
- Expone el vector a la capa WebView mediante `KiuBridge.embedLocalText()` y conecta el proveedor nativo al adaptador RAG, sin tráfico de red ni segundo modelo cargado en memoria.
- El reranking neuronal se limita a los 24 mejores candidatos BM25 para evitar ejecutar inferencia sobre todos los documentos en la primera búsqueda.
- El contexto KV compartido se limpia antes y después de extraer el vector para no contaminar la siguiente generación.
- **Límite importante:** estos son embeddings derivados de estados ocultos de un modelo de chat, no un modelo de embeddings entrenado específicamente para recuperación. La calidad semántica es experimental y requiere medirla con un corpus real; si el motor local no está cargado o falla, se usa el RAG híbrido anterior.
- Versión Android: `versionName 2.11.20`, `versionCode 70`.
- Pruebas estructurales y JavaScript: 380 aprobadas. La compilación Android y la ejecución nativa real siguen pendientes porque este entorno no dispone del vendor llama.cpp/SDK de Android completo.

## [2.11.19] — base de integración para embeddings locales

- Añade un adaptador de embeddings locales con validación de vectores, similitud coseno, caché temporal por fila y fusión RRF con BM25.
- El RAG utiliza el adaptador únicamente cuando hay un proveedor real registrado; ante ausencia o error, vuelve a la búsqueda híbrida existente.
- **Límite explícito:** esta versión no incluye todavía el modelo neuronal ni el runtime de inferencia. No se presenta como embeddings neuronales activos; deja lista la interfaz y las pruebas para integrarlos sin romper la búsqueda actual.
- Versión Android: `versionName 2.11.19`, `versionCode 69`.
- Pruebas automatizadas del proyecto: verificación pendiente de cierre antes de empaquetar; la compilación Android y prueba física requieren SDK/dependencias y dispositivo.

## [2.11.18] — caché vectorial RAG y consultas repetidas más ligeras

- Reutiliza en memoria los vectores semánticos de las filas ya indexadas mediante `WeakMap`.
- Evita recalcular los vectores de cada fragmento en cada consulta; no añade campos al índice persistido.
- Versión Android: `versionName 2.11.18`, `versionCode 68`.
- Limitación: aún no incorpora embeddings neuronales reales ni se ha validado en un dispositivo Android.

## [2.11.17] — recuperación RAG híbrida local

- Se combina BM25 con una similitud vectorial dispersa de bajo coste y grupos de sinónimos frecuentes; RRF fusiona ambos rankings.
- La búsqueda sigue funcionando sin red, sin API y sin descargar un modelo adicional. Esta técnica es una aproximación semántica ligera, no embeddings neuronales.
- Se conserva la búsqueda BM25 original como respaldo compatible.
- Se incrementan `versionName` a `2.11.17` y `versionCode` a `67`.

## [2.11.16] — recuperación RAG consciente de encabezados

**RAG local**
- La fragmentación reconoce encabezados Markdown y conserva el tema de la sección dentro de sus fragmentos, de modo que una búsqueda por el título pueda recuperar el texto asociado aunque el cuerpo no repita esas palabras.
- Los fragmentos largos intentan cortar en límites de frase antes de usar un corte fijo, conservando solapamiento para reducir pérdida de contexto.
- El índice sigue siendo local y mantiene el formato de almacenamiento existente; no se añaden APIs de embeddings ni tráfico externo.
- Se incrementan `versionName` a `2.11.16` y `versionCode` a `66`.

**Verificación y límites**
- Las pruebas automatizadas verifican fragmentación temática, ranking, versión y regresiones del RAG. No sustituyen la compilación Android ni una prueba en dispositivo.
- No se incluye una APK compilada en este paquete; es el código fuente actualizado.

# Changelog

## [2.11.15] — memoria de conversación más fiable

**Memoria y contexto**
- El resumen histórico usa una huella del contenido y el rol de cada mensaje, evitando reutilizar resúmenes por coincidencias de cantidad/fecha.
- Si todavía no existe un resumen, conserva el historial original mientras se genera; si la generación falla o el motor está ocupado, no descarta silenciosamente los mensajes antiguos.
- El prompt del motor local incluye el resumen junto con los cuatro mensajes recientes; antes el recorte podía dejar fuera el resumen.
- La memoria se limita a 40 resúmenes y cada resumen recoge hechos, preferencias, decisiones y pendientes, tratando el historial como contenido no confiable.
- Se incrementan `versionName` a `2.11.15` y `versionCode` a `65`.

**Verificación y límites**
- Las pruebas automatizadas verifican la lógica de resumen y la numeración de versión. No sustituyen la compilación Android ni la prueba en dispositivo.
- No se incluye una APK compilada en este paquete; es el código fuente actualizado.

## [2.11.14] — liberación automática de RAM del modelo local

**Motor local y memoria**
- Si el modelo nativo permanece sin uso durante 10 minutos, KIU libera el contexto y el modelo para devolver memoria al sistema.
- Si después se solicita otra generación, KIU vuelve a cargar el último modelo y conserva el contexto/hilos configurados.
- Las operaciones de carga, generación y descarga se serializan para evitar liberar el motor mientras genera. La descarga manual y el cierre de la actividad siguen disponibles.
- Se incrementan `versionName` a `2.11.14` y `versionCode` a `64`, para que Android identifique esta actualización como versión nueva.

**Verificación y límites**
- Las pruebas de código comprueban la versión y los caminos de descarga/recarga; no sustituyen compilación Android ni prueba en el Xiaomi 15.
- No se incluye una APK compilada en este paquete; es el código fuente actualizado.

Formato basado en Keep a Changelog. Fechas en 2026.

## [2.11.13] — «Kiu» y «chao» en serio + compilación 4× más liviana

**Voz**
- **«Kiu» no activaba:** con el modelo Vosk instalado, `startWakeNow` pasaba SOLO al motor local, que depende de que «kiu» exista en el vocabulario del modelo y que además ignora todo mientras Kiu habla. Ahora el motor por defecto es el servicio de Google (el que entiende «Kiu» y variantes y puede interrumpir); Vosk queda de respaldo si Google no está.
- **«Chao / cuelga» mientras habla no hacía nada:** la lista de palabras de parada no las tenía. Ahora «chau, chao, adiós, cuelga, colgar, cortar, termina, hasta luego, nos vemos, eso es todo» dichas solas callan a Kiu Y cuelgan la charla.
- **Suspendido para siempre:** si tras un comando nadie llamaba a `resumeSoon()` (respuesta sin voz, dictado sin conexión, error), `SUSPENDED` quedaba en true y «Kiu» dejaba de oírse hasta reiniciar. Red de seguridad: a los 20 s sin comando ni voz en curso, se reanuda solo.

**Compilación**
- Antes: `assembleDebug assembleRelease` con `arm64-v8a` y `x86_64` → llama.cpp (C++) se compilaba **4 veces**; además se repetían los tests de Node y se corría lint y JUnit vacío. Ahora: solo `assembleRelease` con `-PkiuAbis=arm64-v8a` (1 compilación), cachés de Gradle / llama.cpp / CMake, y UN solo APK por versión (`Kiu-vX.Y.Z-release.apk`) en el Release. Los debug y x86_64 se pueden volver a pedir sacando la propiedad.

## [2.11.12] — Las seis mejoras: firma estable, salto de modelo, dictado sin Google, «chau», Estado y huella SHA-256

1. **Firma estable del APK:** sin los secretos `KIU_KEYSTORE_*` cada build firmaba con una clave debug nueva y Android obligaba a desinstalar. El workflow ahora guarda y reutiliza `~/.android/debug.keystore` en la caché de Actions. (La solución definitiva sigue siendo cargar los secretos de firma.)
2. **Salto automático de modelo:** si el modelo de un proveedor falla (no existe, límite, error del servidor, respuesta vacía) y ya lo probaste con «Buscar y probar modelos», Kiu pasa solo al siguiente que funcionaba (hasta 2 saltos).
3. **Dictado sin Google:** si el reconocedor de Google falla (sin Internet, VPN, español sin bajar, servicio caído), Kiu escucha con el modelo Vosk instalado (`OfflineDictation`), 100 % en el teléfono. Si anduvo, las 10 min siguientes se usa directo. Requiere el modelo sin conexión instalado.
4. **Terminar la charla hablando:** «gracias», «chau», «hasta luego», «eso es todo», «colgar»… dichos solos cierran esta conversación con un chau hablado, sin tocar el ajuste de modo conversación.
5. **Estado y diagnóstico** (Ajustes): informe único de voz, permisos, claves (almacén seguro o respaldo), modelos por proveedor y actualización, con botón para copiarlo.
6. **Huella SHA-256 de la actualización:** el Release publica `SHA256SUMS.txt` y la app compara la huella que da GitHub con la del APK bajado; si no coincide, lo borra. La tarjeta muestra «huella verificada ✓».

## [2.11.11] — Modo conversación: no te saca de la pantalla y no se corta solo

- **Te mandaba al Chat:** `handleVoice`, `sendMsg` y el comando por «Kiu» hacían `go('chat')` siempre. Ahora, en plena conversación (pantalla de llamada abierta o hablaste en los últimos 2 min), la charla sigue en la misma pantalla; las respuestas igual quedan en el historial. La respuesta de Kiu también se ve escrita en la pantalla de llamada.
- **Se cortaba sola:** (1) la pantalla de llamada se cerraba a los 7 s sin actividad aunque Kiu siguiera pensando o hablando; (2) la ventana para empezar a contestar era de 14 s (ahora 30 s); (3) si Kiu contestaba con error o sin voz, nadie reabría el micrófono. Nuevo **guardián**: si seguís «en llamada» (hablaste o Kiu contestó en los últimos 45 s) y pasan 3 s sin escuchar, hablar ni pensar, vuelve a escuchar. Colgar o cortar el micrófono lo desactiva.

## [2.11.10] — Claves API: «ninguna clave funciona» (causa raíz)

- **Causa raíz:** `KiuCrypto.dec()` llamaba a `cipher.init(12, …)`. Los modos válidos de `Cipher` son 1–4 (descifrar = 2); con 12 Java lanza `InvalidParameterException: Invalid operation mode`, el `catch` devolvía `""` y **toda clave guardada se leía como vacía**. El proxy mandaba entonces `Authorization: Bearer ` sin clave y cada proveedor respondía 401, con claves perfectamente buenas. Ahora usa `Cipher.DECRYPT_MODE` (2). Las claves ya guardadas (cifradas bien) vuelven a leerse sin volver a pegarlas.
- **Nunca más en silencio:** `enc()` verifica que lo cifrado se pueda descifrar; si el Keystore falla (pasa en Xiaomi/HyperOS) cae a una clave AES local de la app (`S1:`) en vez de guardar vacío; `kiuKeysSet` devuelve false si no pudo guardar y la clave ya no se borra de la memoria; `kiuKeysHas` solo dice «hay clave» si se puede leer.
- **Errores con motivo:** si una clave no se puede leer, o la URL base no es la del proveedor, el proxy corta con un mensaje claro en vez de mandar «Bearer » vacío y fingir «clave inválida».

## [2.11.9] — Modelos en la nube: lista automática y probador (+ NVIDIA)

- **NVIDIA (NIM)** como proveedor: `https://integrate.api.nvidia.com/v1`, clave `nvapi-…` desde build.nvidia.com. Su host queda atado a su propia clave en el proxy.
- **Buscar y probar modelos:** cada proveedor de la nube pide ahora `/models` (todo lo que da tu clave), descarta lo que no es de chat (embeddings, audio, imagen, seguridad), prueba los demás con una mini-conversación (3 a la vez, máx. 150) y **deja solo los que responden**, con su latencia. Un 429 cuenta como «funciona, saturado» (⏳); 401 corta todo y avisa que la clave no sirve.
- Arranca **solo al guardar una clave**. Si el modelo que tenías no sirve, se cambia por el más rápido que sí. Toque en un modelo = usarlo. El botón pasa a «Detener» mientras prueba.

## [2.11.8] — «Kiu» abre la conversación, interrumpir a Kiu, aviso de actualización

- **Decir solo «Kiu»:** el servicio con Google sonaba el pitido pero no abría nada. Con la app abierta ahora abre el micrófono y la conversación (igual que el motor local).
- **Interrumpir a Kiu mientras habla:** el servicio sigue oyendo mientras habla Kiu y lo corta con «Kiu» suelto o con «basta / para / silencio / detente / alto» dichos SOLOS (el eco de su propia voz llega como frases, no como una palabra, y se ignora cualquier palabra que Kiu esté diciendo en ese momento). También se corta tocando la pantalla de llamada. Interruptor «Poder interrumpir a Kiu» en Ajustes.
- **Aviso de versión nueva:** el aviso automático nacía APAGADO, por eso nunca avisaba. Ahora nace prendido, consulta cada 6 h (antes 24 h y una consulta fallida gastaba el día) y manda una **notificación** del sistema.
- **«Pensando» sin fin:** si el motor se queda pensando más de 90 s, se corta solo y avisa.

## [2.11.7] — Voz: el micrófono se suelta de verdad al dar un comando

- **«No te entendí [código 7]» / Kiu no escuchaba:** `WakeWordEngine.pause()` solo levantaba una bandera y su `AudioRecord` seguía grabando mientras el reconocedor de Google intentaba oír el comando. Con dos clientes de micrófono Android silencia al segundo, así que el reconocedor recibía silencio. Ahora `pause()` detiene la grabación al instante, el bucle la mantiene suelta mientras haya un comando en curso y la reabre al terminar.

## [2.11.6] — Voz: los errores del micrófono ya no se esconden

- En manos libres (tras el saludo, con la palabra de activación o en conversación) los errores del reconocedor se descartaban en silencio. Ahora se muestra el motivo con su **código** (salvo 6 y 7, que son normales), como máximo un aviso cada 8 s. Los avisos con botón de micrófono también llevan el código.

## [2.11.5] — Voz: se pide primero el español que el teléfono sí tiene

- El teléfono de quien reportó el fallo solo tenía el paquete sin conexión **Español (EE.UU.)**. Kiu pedía es-AR, es-419, es-ES…, y sin Internet el reconocedor respondía error 12/13. Ahora el orden es `es-US`, `es-419`, `es-AR`, `es-MX`, `es-ES`, `es`, tanto en el comando de voz como en la palabra de activación, y el TTS también prueba `es-US`.

## [2.11.4] — Voz: Kiu hablaba con voces que necesitan Internet de Google

- **No hablaba:** `pickBestVoice` daba +10 puntos a las voces «network» de Google. Con VPN, sin datos o con Google bloqueado esas voces fallan y el fallo se descartaba en silencio. Ahora se prefiere una voz instalada en el teléfono (y se saltan las «notInstalled»); la de red solo se usa si no hay ninguna local.
- **Fallo al hablar con aviso:** si el TTS falla, se reintenta una vez con una voz local y, si tampoco, se muestra el motivo en vez de callar. Se quitó el extra `networkTts`, que no existe en Android.
- **No escuchaba:** el reconocimiento (comandos y palabra de activación) pide ahora `PREFER_OFFLINE`: usa el paquete de español sin conexión si está, y recién si no, el de Internet.

## [2.11.3] — Actualizar sin salir de la app + español de voz

- **Actualización dentro de la app:** «Bajar el APK» ya no abre el navegador. La descarga usa la misma tarjeta que los modelos GGUF (anillo con %, tamaño, velocidad, Cancelar) y reanuda si se corta. Al terminar aparece **Instalar**, que entrega el APK al instalador de Android. Nuevo: `KiuUpdate`, `KiuApkProvider` (solo lectura, solo la carpeta `updates`), permiso `REQUEST_INSTALL_PACKAGES`, y los métodos `updStart` / `updInstall` en el puente. Solo se baja desde los Releases de este repo.
- **Voz · «El servicio de voz no tiene el español instalado»:** Kiu elegía el reconocedor de «Servicios de voz de Google», que tiene sus propios paquetes de idioma, aunque el del sistema (el del dictado del teclado) sí tuviera el español. Si fallan los 4 idiomas, ahora prueba una vez con el reconocedor por defecto del sistema y lo recuerda. El aviso explica dónde bajar el español sin conexión.

## [2.11.2] — Voz: el servicio de micrófono ya no falla en silencio

- **Bug real tras actualizar/reiniciar:** en Android 14 un servicio de micrófono no puede pasar a primer plano si se arrancó desde segundo plano (`MY_PACKAGE_REPLACED`, `BOOT_COMPLETED`, alarma de `onTaskRemoved`). `startForeground()` fallaba dentro de un `catch` vacío: ajustes decía «escuchando», nadie escuchaba y a veces se cerraba la app. Ahora no se intenta desde segundo plano en Android 14+, se desmarca `wake` y se avisa con una notificación; si `startForeground` falla, el servicio se apaga limpio.
- **Idioma de respaldo:** el servicio usaba solo `es-AR`; ante los errores 12/13 del reconocedor ahora prueba `es-419`, `es-ES` y `es`.
- **Actualizaciones:** el Release se publica en cada push a `main` (antes solo con tags `v*`, y el buscador decía «todavía no hay versiones publicadas»).

## [2.11.1] — Voz: el modelo sí estaba y el diagnóstico mentía

- **Bug real:** el diagnóstico buscaba `final.mdl` solo en la raíz del modelo, pero el modelo oficial lo deja en `am/final.mdl` (el motor sí lo aceptaba). La app instalaba bien el modelo y mostraba «SIN MODELO». Ahora usa la misma comprobación que el motor, y con el modelo instalado muestra si está escuchando, en pausa o por qué se detuvo.
- **Reconocimiento de comandos:** Kiu elige explícitamente el servicio de voz de Google (si está) en vez del «por defecto» del teléfono, que podía ser el de otra app. Si el servicio rechaza el idioma, prueba es-AR, es-419, es-ES y es; si no se deja usar, vuelve al del sistema. Cada reintento se hace una sola vez.
- **Errores con nombre:** antes todo error del reconocedor se descartaba en silencio. Ahora el aviso dice el motivo (sin internet, no te escuché, falta el español, etc.). El diagnóstico muestra qué servicio usa Kiu.

## [2.11.0] — Pantalla de llamada con Kiu

- **Recomendador según tu teléfono:** botón «Recomendarme modelos para mi teléfono» en Modelos → Teléfono. Lee RAM, núcleos y espacio libre y propone qué bajar: texto (mejor calidad, equilibrado, más rápido, más extras de código y razonamiento) con botón Descargar, y modelos de visión para correr con Ollama en el teléfono o en tu PC. Usa el mismo criterio que «Entra ✓» (RAM del modelo ≤ RAM total − 1); con 4 núcleos o menos limita a modelos chicos. El motor interno todavía lee solo texto: la visión sigue yendo por servidor o nube.
- **Asistente de voz:** botón «Asistente de voz (paso a paso)» en Ajustes. Revisa micrófono, servicio de voz, modelo de despertar sin internet, voz del teléfono, batería sin restricciones y volumen, y deja arreglar cada cosa con un toque. Se abre solo la primera vez si falta algo.
- **Actualizaciones:** «Buscar versión nueva» consulta el último Release de GitHub y abre la descarga del APK. Opcional y apagado por defecto: avisar una vez al día.
- **Barras que siguen tu voz:** la pantalla de llamada usa el volumen real del micrófono (el brillo de Kiu también respira con él). Sin dato, vuelve a la animación de antes.
- **Velocidad medida:** Kiu anota los tokens por segundo de cada modelo en tu teléfono (al usarlo o con «Probar motor»). Si uno anduvo lento, el recomendador propone solo modelos más chicos.
- **Descargas con cuidado:** avisa antes de bajar un modelo pesado con datos móviles, con batería menor al 15% sin cargar, o con el teléfono a 42 °C o más.
- **Firma:** el build verifica el keystore y corta con el motivo exacto (vacío, contraseña, alias). Deja la huella SHA-256 en el resumen para comprobar que no cambió. Nuevo `docs/FIRMA.md`. Corregido que el keystore se buscaba en dos carpetas distintas (`not found` en `validateSigningRelease`).
- **Llamada:** la pantalla «Te escucho…» ahora muestra a Kiu en el centro, con tres modos que siguen al estado real: escucha (verde azulado), piensa (violeta) y habla (naranja). Tarjeta con lo que vas diciendo en vivo, lo que entendió y lo que responde. En modo conversación la pantalla sigue abierta mientras Kiu piensa y habla, y se cierra sola tras 7 s sin actividad. Botones redondos: Escribir (corta la escucha y abre el chat) y Colgar. No hay botón de silenciar: no existe esa función todavía.

## [2.10.1] — Voz, modelos y descargas

- **Saludo:** el TTS de Android tarda 1-3 s en arrancar y el saludo sale a los 1,6 s. `speak()` descartaba la frase si `ttsReady` era false y el JS lo daba por hablado. Ahora la frase queda en cola y se dice al estar listo el TTS (si es de hace más de 20 s se descarta).
- **Conversación continua:** (1) si el TTS no arrancaba nunca no había `onDone` y el micro no se reabría; ahora, si se rinde, se avisa fin igual. (2) El reconocedor del comando no tenía watchdog: si se colgaba, `COMMAND_BUSY` quedaba en true y `openConvMic()` volvía siempre por su primera línea. Ahora hay un watchdog de 20 s. (3) Sin permiso de micrófono el bucle reintentaba 14 s sin decir nada; ahora lo pide una vez.
- **Despertar por voz:** tras un comando suelto (sin voz y sin conversación) el servicio quedaba suspendido; ahora `botSay` lo reanuda. La palabra de activación acepta más variantes (kio, qiu, chiu, kiwi, «ki u»).
- **Comandos:** nueva capa `cleanVoice()` que quita cortesías («ok», «por favor», «¿podés…?») y unifica formas de pedir (ponme, despiértame, quiero una alarma). «Alarma para las 7» ya no cae en «¿A qué hora?». Nuevos: «pon la linterna», «cuál es la batería», «sube/baja el volumen/brillo» (abre el ajuste y lo dice con honestidad).
- **Mejoras:** respuestas lentas del modelo local ya no cierran la ventana de conversación (`listen()` refresca el latido); la voz viene activada en instalaciones nuevas; «pon música» abre YT Music.
- **Modelos reorganizado:** arriba «Cómo responde Kiu» (modo Híbrido/Local/API + orquestador); abajo tres pestañas por origen: Teléfono (RAM, instalados, descargas), Nube (proveedores) y Mi red (servidor). La pantalla «Proveedores» desaparece: `go('api')` abre la pestaña Nube. Creatividad y largo de respuesta pasan a Ajustes → Respuestas; «Revisar mi configuración» y «Diagnosticar voz» a Ajustes → Diagnóstico. Todos los IDs se conservan.
- **Descargas de modelos:** la barra aparecía y desaparecía porque Java informa «downloading»/«cancelled» y el JS solo conocía «run»/«cancel»: al empezar a bajar, el trabajo se borraba de la lista. Se normalizan los estados y el progreso se pinta en sitio (antes se rehacía la lista cada 0,9 s y los botones Pausar/Cancelar perdían el toque).
- **Modelo de voz (Vosk):** barra de progreso real (descarga) e indeterminada (instalación); los errores de Java («err», «none») ya no dejan el botón en «Bajando…» para siempre; `puedeInstalar` ya no arranca la descarga al consultarlo. Botón «Dar permiso de micrófono» en el diagnóstico.
- **Crash `W.verReal is not a function`** al terminar de instalar el modelo de voz. **Versión «v?» / «código 0»:** `verReal` usaba `bridge()` (devuelve booleano) en vez de `rawBridge()`; y «Kiu 2.7.0» estaba escrito a mano en `index.html`. Ahora sale del paquete instalado. Versión 2.10.1 (código 49).
- **Cargar el modelo de voz que ya bajaste:** botón «Cargar el modelo que ya bajé (.zip)» (selector de archivos → copia → instala, con barra). Además, si el zip ya estaba en el teléfono, «Bajar» ahora lo detecta (Java devuelve «done» sin id) y lo instala sin volver a descargar; antes caía en «no pude empezar la descarga». Un zip que no descomprime se borra para no quedar atascado.
- **Ajustes del sistema:** «volumen» y «brillo» abrían los ajustes generales (Java solo conocía «sonido» y «pantalla»). Nuevos botones en el diagnóstico: ajustes de la voz del teléfono (TTS) y de entrada de voz.
- **Encabezado:** el título y el subtítulo se mezclaban con el contenido que pasaba por debajo (Modelos, Ajustes).
- Tests: `tests/voz-comandos.test.mjs`. 263 pasan. **El Java no se pudo compilar acá (sin Android SDK): lo verifica el CI.**

## [2.10.0] — El error siguiente: un miembro que no existe

`r.resolveInfo.serviceInfo` no compila. **`ResolveInfo` ES el tipo**: su `serviceInfo`
va directo, no anidado bajo un `resolveInfo`. Doble anidamiento, y `cannot find
symbol`.

O sea, el arreglo de 2.9.9 funcionó — el build pasó de «el script no compila» a
`compileDebugJavaWithJavac`, ochenta líneas de log más adentro. Esto es el error
que decía que podía venir detrás.

### El aviso estaba en la línea 52, y yo estaba mirando la 1800

El mismo log traía un warning que era el comienzo de todo:

```
AndroidManifest.xml:63:9-41: Warning: android:extractNativeLibs should not be
specified in this source AndroidManifest.xml file
```

No lo miré, porque estaba buscando la línea 1800 del error. El warning decía que
`android:extractNativeLibs` tiene que estar en el archivo de build — y ya estaba
(`jniLibs.useLegacyPackaging = true`). Estaba en los dos lados, y el del manifiesto
no hacía nada.

**Lo saqué del manifiesto. Y casi rompo todo por hacerlo.** Puse el comentario
explicativo entre los atributos del `<application>`, y en XML **un comentario no
puede ir adentro de un start-tag**. El manifiesto dejó de parsear entero. Lo agarró
el test que escribí para verificar el cambio, tres segundos después — que es la
única razón de que no haya llegado al CI.

### Y ahora sí puedo verificar Java de verdad

Apareció una forma de bajar un `android.jar` (API 15, de Maven Central). Con eso
compilo el proyecto y filtro lo que la API vieja no tiene (`NotificationChannel`,
`Voice`, `checkSelfPermission`, `R`, `androidx.webkit`, Vosk…). **Los dos errores
que reportó el CI no aparecen, y no queda ninguno sin explicar por la versión
del SDK.**

Es un chequeo parcial — el SDK real es API 34 y esto es API 15 — pero convierte
«no puedo distinguir si falta la clase o si usé mal un miembro» en una respuesta.
Eso era exactamente lo que me frenaba.

**Suite: 252 → 255 tests.**

## [2.9.9] — El build se cayó en el CI por dos líneas

Sin cambios de comportamiento: el arreglo es que el build compile. El CI lo dijo
claro y así tiene que ser — un fallo de configuración no lo encuentra nadie hasta
que alguien sube el cambio.

### Error 1 · `java.time.Instant` no resolvía

```
app/build.gradle.kts:167:27: Unresolved reference: time
```

El gotcha más caro de Kotlin DSL. **Dentro de un `.gradle.kts`, el identificador
`java` no es el paquete `java.*`: es la extensión de Gradle** — la misma que
configura `compileOptions`. Así que `java.time.Instant` se leía como «buscá `time`
dentro de la extensión java», y `java.time` no existe.

No compila en ninguna versión de Kotlin y no lo va a compilar nunca acá: no es un
problema de versión, es de resolución de nombres. El arreglo es un `import
java.time.Instant` explícito al principio del archivo, que le gana a la extensión.

### Error 2 · el mapa del sello no casaba de tipos

```
app/build.gradle.kts:168:9: Type mismatch: inferred type is Serializable
but Pair<TypeVariable(K), TypeVariable(V)> was expected
```

`mapOf(...)` con valores de tipos distintos —`kiuVersionCode` es `Int`,
`getenv()` devuelve `String?`— hace que Kotlin infiera el tipo común **más arriba**:
`Serializable`. Y un `Pair<K, Serializable>` no es lo que el `joinToString` de abajo
espera.

El arreglo es declarar el tipo: `val stamp: Map<String, String>` y convertir el
código con `.toString()`. Declare el tipo y el problema desaparece, porque el
compositor deja de tener que adivinar.

### Los dos por lo mismo

Los dos son el mismo error de fondo: **escribir código que solo compila en un
contexto, sin saber cuál es.** El `java` de Kotlin DSL y el `mapOf` sin tipo son las
dos caras de no declarar las suposiciones.

### Qué hice para que no vuelva a pasar

- `tests/sellado.test.mjs` mira el archivo real y falla si vuelve el `java.time.` en
  línea o si el `mapOf` queda sin tipo declarado.
- `tests/kotlin/SelloBuildCheck.kt` compila y ejecuta con `kotlinc` el bloque del
  sello, y verifica el JSON que produce.

Y una aclaración que va al revés de lo que se esperaría: **el harness de Kotlin NO
reproduce esos dos errores, y dice que no lo hace.** En un `.kt` normal
`java.time.Instant` compila sin problema, y el `mapOf` sin tipo también — los dos
fallos solo existen dentro de un `.gradle.kts`. Lo verifiqué compilando las dos
versiones rotas a propósito, y no fallan. Un guard que parece cubrir un bug sin
cubrirlo es peor que no tenerlo: da confianza falsa sobre lo único que no se está
comprobando. Así que el guard de los dos gotchas es estructural, y el harness
cubre lo que sí puede: el comportamiento del sello.

## [2.9.8] — El modelo de voz se instala desde la app

Hasta ahora, tener la palabra de activación local era saber un comando de `adb`.
El modelo son 39 MB, no puede ir en el repo, y **no había ninguna pantalla para
bajarlo**: prendías el micrófono, no pasaba nada, y nada en la app decía por qué.
La fila del diagnóstico de voz decía «sin modelo» y se quedaba ahí.

### El flujo

Tres llamadas, no una, porque son tres estados que fallan distinto:

| | qué hace | puede fallar por |
|---|---|---|
| `wwInstall()` | arranca la descarga | red, espacio, SHA |
| `wwUnzip(path)` | descomprime | el zip bajó corrupto |
| `wwUnzipStatus(id)` | reporta progreso | — |

La descarga reusa `KiuDownload`, que ya tenía reanudación, SHA-256 y verificación.

### El detalle que casi se pierde

El zip oficial trae todo dentro de `vosk-model-small-es-0.42/`:

```
vosk-model-small-es-0.42/am/final.mdl      <-- el modelo
vosk-model-small-es-0.42/conf/mfcc.conf
vosk-model-small-es-0.42/graph/Gr.fst
```

Descomprimirlo tal cual debajo de `models/vosk-es-small/` deja el modelo en
`models/vosk-es-small/vosk-model-small-es-0.42/am/final.mdl`, y el motor busca
`models/vosk-es-small/am/final.mdl`. **Un nivel de diferencia.** Y el síntoma es el
peor de todos: el modelo pesa 60 MB en disco, la app dice «falta el modelo» para
siempre, y bajar el zip de nuevo no arregla nada porque el bug no es la descarga.

`ZipInstall` quita la carpeta raíz, y la aprende de la primera entrada del zip en
vez de hardcodearla: si upstream renombra la carpeta, la instalación sigue
funcionando. Antes de decir «listo» comprueba que `am/final.mdl` quedó donde
corresponde — **instalar y que no sirva es peor que no instalar.**

### Zip-slip

Cada ruta se canonicaliza contra el destino y tiene que empezar por él. Un nombre
con `../` escribiría fuera de la carpeta de la app, que en Android es el filesystem
entero. No es paranoia: un zip renombrado de ahí viene. Las entradas sospechosas se
cortan y se cuentan; no abortan, porque un modelo puede traer basura y servir igual.

### Y se prueba con el zip de verdad

`VoskZipHarness` **descomprime los 39 MB reales** y mira dónde quedaron. Es el test
que un test de forma no puede hacer: el código puede estar impecable y el resultado
ser inútil.

El SHA queda fijado en el código (`09b23988…`): son 39 MB que van directo al disco de
la app y de ahí a Vosk, y una descarga sin verificar es una puerta abierta.

**Suite: 244 → 250 tests** (250 con JDK y el zip; 247 + 3 saltados sin ninguno de
los dos).

## [2.9.7] — Tests de Java que se EJECUTAN, no que se leen

`Backoff` es Java puro: cero imports de Android. Eso estaba escrito en su
documentación, pero los tests no lo aprovechaban — lo verificaban **leyendo el
fuente con regex**:

```js
assert.match(boC, /Math\.min\(maxMs, esperaMs \* 2\)/, 'la espera dobla con techo');
```

Eso comprueba que el código **diga** esa expresión. No que **haga** lo correcto. Un
`Backoff` reescrito a mano con la misma expresión textual y un `if` mal puesto
pasaría el test igual: el texto está, la conducta no.

### Qué cambió

`tests/java/com/kiu/agent/BackoffHarness.java` + `tests/java.test.mjs` compilan la
clase con `javac` y la **ejecutan**. Once aserciones de comportamiento en vez de seis
de forma:

- la espera no decrece entre intentos, y no pasa del tope
- agotados los intentos devuelve **−1**, y es estable (un 0 acá produce un
  reintento instantáneo y trabado en el hilo de audio: el peor resultado posible)
- `reset()` devuelve exactamente el primer intento
- una base negativa o un tope 0 se normalizan a algo **mayor que 0**
- `Backoff` no guarda estado de error: eso es del subsistema que lo usa, y que el
  test lo verifique evita el error opuesto — dos capas peleando por él

### El arnés se prueba a sí mismo

`el arnés detecta sus propios fallos` compila un `Backoff` **deliberadamente roto** —
misma forma textual, peor comportamiento (la espera nunca decrece, se rinde antes de
tiempo) — y exige que el arnés **falle**. Sin ese test, un arnés que no ejecutara nada
pasaría en verde sobre una clase rota, que es el peor resultado posible.

Y en el camino apareció un fallo **mío**, que es la clase de error que este tipo de
test existe para cazar:

```java
check(b.siguiente() == primero, "... no " + b.siguiente());
```

Los argumentos de un `assert` se evalúan **siempre**, incluso cuando la aserción
pasa. Ese `siguiente()` del mensaje consumía un intento extra y el contador llegaba
a 2: el test fallaba por su propio texto de error. Con la forma escrita a mano
(`long trasReset = b.siguiente()`) se lee bien y no tiene el problema.

### Sin JDK no pasa: se salta, y a la vista

El runner de GitHub ya trae un JDK, así que **en el CI esto corre siempre**. Local,
si no hay JDK los dos tests se marcan `SKIP sin JDK (javac no encontrado)` — nunca
verde en silencio. Un test que no llegó a correr no puede reportarse como
correcto, y en este proyecto esa confusión ya costó una tanda entera.

Por eso tampoco usa JUnit: `app/src/test` con JUnit exige el SDK de Android para
correr, así que no correría en ningún lado donde no haya SDK. Con `javac` + `java`
sobre clases puras corre en cualquier máquina con JDK.

**Suite: 240 → 244 tests** (244 con JDK, 242 + 2 saltados sin él).

## [2.9.6] — Los tres fallos de voz, arreglados

Todos estaban en la capa Java, que hasta ahora no tenía **ni un test**: 4.900
líneas sin cobertura, y la suite de 227 tests en verde mirándola fijamente.

### 1 · Una llamada mataba la palabra de activación para siempre

`WakeWordEngine.run()`: cuando `AudioRecord.read()` devolvía un error
(`ERROR_DEAD_OBJECT` — el mic lo toma una llamada o otra app), el código ponía el
mensaje y hacía `continue` **sobre el mismo AudioRecord**. Un AudioRecord en
estado de error no se recupera: hay que `stop()`/`release()` y crear otro.
Seguir leyendo del mismo devuelve el error para siempre.

Atendías un teléfono, cortabas, y Kiu no escuchaba más hasta que lo apagabas y lo
volvías a prender a mano. Sin mensaje, sin log.

Ahora el read-loop **se corta** al primer error de micro y el loop de afuera
reconstruye el `AudioRecord` con backoff. Si no vuelve, se rinde **y lo dice**
(`running = false`) en vez de quedarse mudo fingiendo que escucha.

El read-loop pasó a ser `escucharUnaVez()`, que devuelve un estado: mic muerto,
o se paró. Con eso `run()` queda de un vistazo.

### 2 · El error quedaba pegajoso

`err` se limpiaba únicamente en `start()`. Un fallo transitorio del micro dejaba
*"micrófono ocupado"* puesto para el resto de la sesión, aunque después anduviera
perfecto. El mensaje mentía sobre el estado real.

Ahora se limpia cuando el micrófono **abre de verdad** — después de
`startRecording()`, no antes, porque limpiar antes sería mentir igual pero al revés.

### 3 · La voz podía no arrancar nunca, en silencio

`MainActivity.initTts()` se llamaba **una sola vez**, en `onCreate`. `ttsReady`
se ponía en true únicamente dentro de la rama `i == 0`. Si el motor de TTS no
estaba listo en ese instante —muy común en arranque en frío, y también cuando el
servicio de voz se instala después de la app— el init fallaba, `ttsReady` quedaba
`false` **para toda la vida de la app**, `speak()` hacía `return` en la primera
línea, y no había ni toast ni error ni reintento.

El síntoma era exactamente el reportado. Y lo peor: *"Kiu está pensando"* y
*"Kiu no tiene voz"* se ven **igual** desde afuera.

Ahora reintenta con backoff, cierra el motor anterior en cada intento (si no,
filtra uno por intento), y si de verdad no arranca lo dice por `nexoVoiceError` y
el motivo aparece en el diagnóstico de voz.

### Un bug que me metí yo

Escribiendo el arreglo del 1 colgué el `reset()` del backoff de un estado
(`LECHO_OK`) que nadie devolvía. El backoff nunca se reiniciaba, así que tras 8
micro-fallos repartidos en una sesión, Kiu se rendía para siempre — el mismo
síntoma que el bug que estaba arreglando.

Lo encontró un test. El estado sobrante no está, y hay un test que afirma que no
esté: `LECHO_OK` no puede volver a aparecer. El backoff se resetea en el único
sitio con sentido, **cuando el mic abre**: el presupuesto de reintentos es por
micrófono, no por sesión. Si una app te toma el micro un rato y lo suelta, ese
contratiempo no puede gastar los reintentos de los próximos treinta minutos.

### La brecha de cobertura, al menos medida

No puedo compilar Java acá (no hay JDK), así que estos tests son de **estructura
por análisis del fuente**: fallan si alguien revierte el arreglo, pero no
sustituyen a compilar y probar en el teléfono. Para lo segundo:

- `Backoff.java`: lógica pura, **cero imports de Android**. La política de
  reintentos de todo el audio vive ahí, y por eso se puede razonar y testear.
- `tests/java-estructura.test.mjs`: escáner de una pasada que balancea llaves y
  paréntesis de todo el Java. Es lo único de esa capa que se puede verificar sin
  compilador.
- El CI ya corre `:app:testDebugUnitTest` antes de publicar el APK. Hoy es un
  no-op que pasa, porque `app/src/test` sigue vacío; queda el cableado listo.

Un detalle del escáner que vale la pena: tiene que manejar comentarios, cadenas
y literales **en ese orden**, en una sola pasada. Un checker ingenuo que quita
comentarios después de las comillas se come el archivo entero cuando encuentra un
apóstrofe en un comentario (`don't`) — que es exactamente lo que pasó con
`MainActivity.java` durante esta tanda: reportó −1 en un archivo perfectamente
balanceado. Un checker que miente es peor que no tener ninguno, así que el test
comprueba que el escáner se rompa cuando debe.

### Suite: 227 → 240 tests**, todos en verde.

## [2.9.5] — Que no se pueda instalar un APK sin saberlo

Este es el que explica el reporte que se repitió: «la versión que se instala con
ese archivo es 2.7». Con los bugs de voz ya arreglados, la versión seguía
 appearing como 2.7, así que **no era el código: era qué APK se estaba
instalando.**

### Lo que pasaba

El ZIP que entrego es **solo código, no un APK**. Y no trae las librerías nativas
del motor: están en `.gitignore` porque son 40 MB (`app/src/main/jniLibs/` y
`vendor/llama.cpp`). El build local desde ese ZIP **falla** con «KIU: no hay
librerías nativas del motor».

Y acá está la trampa: si el build falla y se instala igual, queda el APK viejo. El
error se va al scrollback de Gradle, el APK viejo anda perfecto, y la app dice 2.7
mientras el código está en 2.9.4. **Nada avisa.** Es un bucle cómodo: builds que
fallan, instalaciones que "funcionan", y una versión que nunca cambia.

### El sello de build

Cada build ahora escribe `assets/build-stamp.json` adentro del APK: versión,
código, commit, fecha y dónde se compiló. Y hay un script que lo lee **antes de
instalar**:

```bash
./scripts/verificar-apk.sh app/build/outputs/apk/debug/app-debug.apk --esperar 2.9.4
```

Sale con 0 si es el APK que esperabas, con 1 si no. Sin Android SDK, sin `aapt`,
sin `apkanalyzer` — se lee con `unzip -p`, que es justamente cuando uno no tiene
las Android tools a mano.

La versión se declara **una sola vez** en `build.gradle.kts`. Estaba en dos lugares
(`defaultConfig` y el sello), y con dos lugares donde poner un número aparece el que
se queda viejo — y el que se queda viejo sería el sello, que es el que dice qué
estás por instalar. Mentiría con autoridad.

### Dos casos donde el script NO dice que todo bien

- **Sin sello y con `--esperar` → falla.** Un APK sin sello es anterior a esta
  tanda o fue reempaquetado; no se puede saber qué es. *No poder confirmar* no es
  *estar bien*, y si el script saliera con 0 estaría aprobando algo de lo que no
  sabe nada.
- **APK sin `.so` → lo dice y lo marca.** Se puede instalar, no puede generar, y
  eso es peor que no instalar.

También se arregló el parseo de argumentos, que usaba `for arg in "$@"`: esa forma
congela la lista de argumentos al empezar, así que el `shift` del `--esperar` no
surtaba efecto y el valor se tomaba como nombre de archivo. El script "funcionaba"
y pedía un archivo que no era. Con `while` + `shift`.

**Suite: 219 → 227 tests**, todos en verde.

### La salida, entonces

**Bajá el APK del release de GitHub** y verificalo antes de instalarlo. El CI ya
publica `Kiu-APK-release`; así no dependés de que tu build local funcione, que es
justo donde estaba fallando.

## [2.9.4] — La voz: dos bugs reales y un diagnóstico que las distingue

Reporte: «la versión que se instala es 2.7, el audio no funciona, no me reconoce
la voz ni activa por reconocimiento de voz». Salieron **dos bugs reales** y una
decisión de diseño que estaba produciendo exactamente ese silencio.

### 1 · BUG: el modelo local se buscaba en el lugar equivocado

Este es el grande. El modelo oficial `vosk-model-small-es-0.42` tiene esta
estructura:

```
vosk-model-small-es-0.42/
  am/final.mdl        <-- acá está
  conf/mfcc.conf
  conf/model.conf
  graph/Gr.fst
  graph/HCLr.fst
```

y el código chequeaba `<dir>/final.mdl`, **en la raíz**. Con el modelo puesto
exactamente donde dice la documentación, ese archivo no existe → el chequeo daba
`false` → el arranque se negaba → el error que llegaba decía *«falta el modelo»*.

Eso es una mentira: el modelo estaba, en su sitio, y la app no lo veía. Y el
síntoma es justo el reportado —la palabra de activación nunca dispara— con un
mensaje que apunta al lugar equivocado, así que la respuesta obvia («bajar el
modelo») no arregla nada porque el modelo ya estaba.

Verificado contra la [estructura oficial](https://alphacephei.com/vosk/models):
V2 es `am/final.mdl`; vosk-api además acepta V1, el layout plano en la raíz. Se
aceptan **los dos**, porque alguien puede haber copiado el contenido de `am/` a
mano, y el que decide si arranca y el que informa si está tiene que mirar lo
mismo — si uno busca `am/` y el otro la raíz, uno de los dos miente igual.

### 2 · BUG: si el recognizer se colgaba, Kiu quedaba mudo para siempre

`KiuService.cycle()` rearma el bucle **solo** desde `onResults()` y `onError()`.
`cycle()` pone `listening = true` y vuelve sin reprogramar, confiando en que el
motor de voz llame a alguno de los dos.

Ese supuesto no se cumple siempre: si `startListening()` arranca y el recognizer
se queda colgado (sin red, motor que no responde, pensando en silencio), no llega
`onResults` ni `onError`. `listening` queda en `true` para siempre, `cycle()`
sigue volviendo por el `if (listening) return`, y Kiu deja de escuchar **en
silencio**: sin error, sin log, sin aviso.

Es el peor modo de falla posible para algo que se reporta como «no me reconoce la
voz», porque no hay nada que reportar. El watchdog no arregla el motor, pero
convierte un colgado infinito en un reintento con backoff que por lo menos se ve.

### 3 · La versión instalada se puede ver (y era mentira)

El rótulo del perfil decía `Kiu v2.9.3` con una **constante escrita a mano en el
JS**. Con un APK viejo no tenía por qué delatar nada — y la app instalada decía
2.7 mientras el repo ya iba por 2.9.3, sin que ninguna señal lo delatara.

Ahora la versión sale de `PackageManager`: la del **paquete realmente instalado**.

Y un matiz que costó pensar: **la app no puede auto-detectar que su APK es viejo.**
El JS y el nativo salen del mismo árbol de compilación, así que siempre coinciden
y cualquier chequeo «instalada < esperada» pasaría siempre. Un número esperado
hardcodeado en el JS sería la misma mentira de antes.

Lo que **sí** es detectable, y es el caso real, es una instalación **mezclada**:
assets viejos con nativo nuevo. Eso se reconoce por **capacidad**, no por número —
este código declara qué métodos del puente necesita, los prueba, y si falta uno
lo dice por nombre: *«falta kiuGenSetGrammar»*. Accionable, a diferencia de un
número de versión que hay que ir a buscar.

### 4 · El diagnóstico de voz

Las cuatro causas que se ven **igual** desde afuera —APK viejo, sin servicio de
reconocimiento, sin modelo local, sin permiso de micrófono— se distinguían por
adivinanza. Ahora hay un botón **Diagnosticar voz** que lee el estado real de las
cuatro y, cuando algo está mal, dice **la grilla concreta** en vez de un «algo
anda mal».

Un detalle de diseño: `verReal()` y `diagVoz()` se movieron de `app-ui.js`
(4000 líneas) a `app/diag-voz.js`, un módulo con una sola dependencia. Estaban
adentro del archivo grande y **no se podían testear**: cargar `app-ui.js` en un
arnés arrastra store, DOM y timers, y los tests pasaban sin ejercitar nada.

**Suite: 206 → 219 tests**, todos en verde.

### Lo que sigue pendiente

La palabra de activación local **sigue necesitando el modelo**, que son 39 MB y no
van en el repo. Con el bug 1 arreglado, ahora sí se lo detecta y se lo ve — pero
instalarlo sigue siendo manual por `adb`. La app no tiene todavía una pantalla para
bajarlo. Es el próximo paso natural, y es la diferencia entre «funciona» y
«funciona si sabés el comando de adb».

## [2.9.3] — La gramática llega al motor (y se forgets sola, a propósito)

En 2.9.2 el generador GBNF existía y estaba testeado, pero no tenía a quién
mandarle la gramática: el `KiuNative.generate()` no aceptaba una y no había forma de
pasársela. Esta tanda cierra el circuito.

### 1 · `setGrammar` en vez de cambiar la firma de `generate`

El camino obvio era `generate(prompt, maxT, temp, gbnf)`. Es el que **no** se hizo:
cambiar la firma de un método nativo rompe el puente JS entero (`kiuGen` lo invoca
`motor.js`) y obliga a tocar los dos lados de un puente que hoy anda.

En vez de eso hay un setter aparte. El JS pone la gramática justo antes de pedir la
decisión y el resto de la app sigue llamando `generate(prompt, maxT, temp)` sin
enterarse de que existe. Tres métodos nuevos:

| | |
|---|---|
| `setGrammar(gbnf)` | la aplica la **próxima** generación; `""` desactiva |
| `grammarPending()` | cuál espera (diagnóstico y tests) |
| `grammarOk()` | si la última se pudo aplicar |

El tercero es el que más importa, y es para una trampa concreta: **si el motor no la
aplica, la generación sale igual y sin restringir.** Un bucle que cree que la gramática
está activa y en realidad no lo está se apoya en un parse que nunca va a venir bien, y
el síntoma —"sale JSON roto"— apunta a la validación, que es la innocent. Con
`grammarOk()` el JS lo sabe y el parse + reintento deja de ser un plan B theoretical.

### 2 · La gramática se CONSUME, y eso es un test

La generate() hace `gbnf.swap(g_grammar_pending)`: la toma y la borra. Y `stopGen()` la
limpia también.

Sin esto la gramática queda pegada: el `{"tool":...}` de la última decisión del agente
sigue esperando, y la respuesta de chat que viene después de al lado sale forzada a
emitir un JSON de herramienta. No se ve como un bug de gramática — se ve como un bug de
chat, en otra pantalla, más tarde, en la conversación que no tenía nada que ver. Es
forgetting con forma de fantasma, así que está testeado en las dos vías.

### 3 · Va al final de la cadena, y con temp 0

`llama_sampler_chain_add(smpl, gs)` va **último**, después de greedy/dist. Es lo que
decide si un token se puede emitir: lo que no encaja con la gramática no existe. Si
fuera antes, los samplers de arriba verían tokens que después se rechazan.

Y con `temp > 0` hay un `dist` aleatorio justo antes. El de abajo igual manda, así que
el resultado quedaría restringido igual — pero `motor.js` manda **temp 0** cuando manda
gramática, para no depender de cuál de los dos gana el conflicto.

### 4 · El shim, otra vez

`kiu_grammar()` tiene la misma estructura de dos overloads que `kiu_penalties()`: si el
vendor no expone la firma, cae a un overload que devuelve `nullptr`, el sampler se omite
y la generación sigue **sin gramática**. Romper el APK porque upstream renombró algo no
puede ser el precio de una mejora opcional.

### Un test que pasaba por el motivo equivocado

Al testear el camino nuevo apareció un `typeof g === 'object'`. No era un bug del
producto: el arnés no definía `rawBridge` (que vive en `app/env.js` y lee
`window.KiuBridge`), el `ReferenceError` lo comía el `try/catch` del agente, y `gbnf`
quedaba `null` — y `typeof null` es `'object'`. El test pasaba antes, cuando la
asertación era la débil; con la asertación fuerte, se comió el problema.

Vale la pena dejarlo anotado porque es el patrón que más me gusta de esta tanda: **el
try/catch correcto escondió un test que no estaba probando lo que decía probar.** El
fix no fue relajar la asertación sino definir `rawBridge` en el arnés, para que la ruta
real se ejercite.

**Suite: 199 → 206 tests**, todos en verde.

**Lo que sigue sin verificar**: que el C++ compile. `kiu_grammar_impl(0, a...)` con
`a...` vacía — el overload que se elige es el `int` y `llama_sampler_init_grammar(gv,
gbnf.c_str(), "root")` es una llamada directa de 3 argumentos, que es la firma conocida.
El SFINAE hace su trabajo, pero eso solo lo confirma un compilador.

## [2.9.2] — El motor deja de flotar, y el agente deja de ser lento de arrancar

Tres cosas, en orden de importance para lo que vas a sentir en el teléfono.

### 1 · El motor nativo estaba anclado a `master`

`vendor_llama.sh` clonaba `llama.cpp` de `master` y el CI hacía lo mismo. Eso es una
dependencia flotante: un commit de upstream puede romper el build **sin que cambie nada
del repo**, y no había forma de volver atrás porque el clon local ya lo había pisado con
`reset --hard`.

No es teórico. El propio `kiullama_jni.cpp` tiene un shim por `llama_sampler_init_penalties`
porque **esa firma ya les cambió una vez**. Compilar contra `master` todos los días es
esperar el próximo.

Ahora:
- `LLAMA_TAG` + `LLAMA_SHA` (**v0.7.0**) en `vendor_llama.sh`, que es la única fuente de
  verdad; el CI la lee de ahí.
- Se trae el **tag** (una ref de verdad, se puede traer siempre) y se **verifica** que el
  commit sea el SHA esperado. Si alguien movió el tag upstream, el script para con un
  ruido en vez de compilar código distinto del que creés.
- `--show` imprime el pin y el estado local.
- El CI lo muestra en el `$GITHUB_STEP_SUMMARY`: un fallo de compilación dice contra qué
  commit fue y se puede reproducir.
- El header documenta cómo se cambia el pin — y que un cambio de API se **shimmea**, no se
  esquiva bajando el requisito.

### 2 · El prefill del agente era el 80 % del costo de una decisión

Cada decisión del agente paga el prompt entero en el prefill de la CPU del teléfono, y el
proyecto ya sabe que ahí está el cuello de botella (el comentario de PROMPT LIVIANO en
`app-ui.js` dice que el prompt grande "tardaba minutos").

| | antes | ahora |
|---|---|---|
| manifiesto | 1.565 car ≈ **435 tok** | 934 car ≈ **259 tok** |
| prompt de una decisión | 1.957 car ≈ **544 tok** | 1.263 car ≈ **351 tok** |
| salida que se pide | 120 tok | 120 tok |

**−35 % de prefill**, y además se encontró que el mensaje del usuario iba **dos veces** en
el prompt (una en `TAREA:` del system, otra como mensaje del user). Con historial, la
`TAREA:` ya no se manda: el último mensaje del usuario *es* la tarea.

Las descripciones pasaron de párrafos a disparadores ("Programar una alarma o recordatorio."
en vez de explicar cuándo usarla), y el manifiesto es una línea por herramienta. **Y hay un
techo en los tests** (`budget()`, 280 tokens de manifiesto): si alguien vuelve a escribir un
párrafo ahí, el test se pone rojo.

### 3 · Gramática GBNF derivada del mismo esquema

`KiuAgente.grammar()` genera la gramática de muestreo desde el **mismo** `args` que valida y
que documenta el prompt. No hay tres lugares que mantener: si mañana agregás un argumento,
los tres lo toman solos, y hay un test que lo verifica agregando una herramienta de mentira.

Lo que aporta, con sus límites:
- Los **ENUM** quedan enumerados: `device_action.what` no es texto libre, es una de las 8
  acciones. Y `validate()` los revisa **también**, porque la gramática no siempre está
  activa (sin JNI, o cuando la decisión va por un proveedor).
- Los opcionales generan las alternativas que existen: `set_alarm` produce la rama con
  `when` y la rama con `when`+`label`.
- **No arregla el problema de fondo.** La gramática garantiza que el JSON sea válido, no
  que la herramienta sea la correcta: un modelo puede llamar `set_alarm` cuando debía leer
  la agenda, y la gramática lo deja pasar. Para eso están la validación y la observación
  que vuelve al bucle. **Gramática = menos reintentos. Validación = menos errores.**

El generador es JS puro y está testeado entero, con un validador de GBNF chiquito (paréntesis
y comillas balanceados, raíz que menciona todas las reglas) porque llama.cpp tira excepción
si la gramática está mal formada y eso no se ve hasta el build.

**Lo que falta para usarla**: el pegamento JNI (`kiuGenGrammar` +
`llama_sampler_init_grammar(vocab, texto, "root")`). Son ~40 líneas que no se pueden compilar
ni probar acá, y por eso esta tanda **no** las incluye.

**Suite: 180 → 199 tests**, todos en verde.

## [2.9.1] — Que el MODELO elija la herramienta

Hasta acá Kiu no era un agente: `brain.js` tenía ~200 regex que decidían qué era cada
pedido y el modelo solo redactaba la respuesta final. `js/kiu-agente.js` agrega el registro
de herramientas y el bucle que le pregunta al modelo qué hacer.

### El registro
```js
{ name, desc, args: { <k>: {type, required, desc} }, run(args) -> {ok, text}, risk }
```
Seis herramientas: `set_alarm`, `read_calendar`, `find_contact`, `call_contact`,
`search_docs` y `device_action`. Cada una **envuelve algo que ya existía** (brain, RAG, el
puente) en vez de reimplementarlo: `call_contact` delega la resolución del contacto a
`brain.js`, y `device_action` tiene su `what` acotado a una lista de 8 valores en vez de
ser 8 herramientas distintas — menos superficie que inventar.

### El modelo elige, este archivo decide qué se ejecuta
Un modelo chico inventa nombres, deja argumentos sueltos y mete JSON en un ```json. El
bucle no confía, y **el motivo del rechazo vuelve al modelo** (que es lo que hace que el
segundo intento acierte):

| El modelo mandó | Qué pasa |
|---|---|
| herramienta inexistente | se rechaza, con la lista de las que sí existen |
| argumento que no está en el esquema | se rechaza, con los nombres reales de los argumentos |
| obligatorio que falta | se rechaza nombrando el argumento |
| tipo que no cierra | se rechaza |
| argumento enorme (>200) | se rechaza: eso es prompt injection, no un dato |
| JSON inválido | se rechaza y se reintenta |

### Una sola fuente de verdad
`args` genera **dos** cosas: el texto del prompt y la validación. No pueden desalinearse
porque salen del mismo objeto. Cuando el nativo soporte
`llama_sampler_init_grammar`, la gramática GBNF se deriva de ahí —y hasta entonces el
parse + reintento hace falta igual, porque un modelo chico va a fallar el JSON de vez en
cuando.

### BUG que encontraron los tests
`isDone()` devolvía `true` siempre que el JSON **no** trajera la palabra `listo`. O sea que
`{"tool":"set_alarm","args":{...}}` —que es exactamente lo que contesta un modelo que no
entendió "si no necesitás ninguna: {listo:true}"— se leía como "terminado" y **el bucle
cortaba antes de ejecutar nada**. Kiu se quedaba mudo. Ahora: si el objeto trae una
herramienta, no está terminado, diga lo que diga el resto.

### Enrutado
El agente va **después** de skills, cerebro y ReAct (lo conocido se resuelve al instante y
sin gastar un token; ninguna de las tres conoce una herramienta que todavía no existe) y
**antes** de la generación final (si ejecutó algo, esa ES la respuesta). Si no ejecutó nada,
`tryAfterAgent()` sigue el flujo de siempre: el mensaje no se pierde, y el fallback final
sigue estando.

**Apagado por defecto** (`S.agentOn`), con su toggle en Ajustes. Consume una generación
extra por mensaje, así que no puede activarse por sorpresa; y si lo prendés sin modelo
cargado, te lo dice en vez de fingir que quedó activo.

### Lo que NO se hizo (y por qué)
- **GBNF en el nativo**: `vendor_llama.sh` clona `llama.cpp` de `master` **sin pin**. Tocar
  el JNI con eso flotando es Gamble; hay que fijar el commit primero.
- **Confirmación antes de actuar**: `call_contact` abre el marcador (no llama solo) y
  `device_action` tiene su lista acotada, pero no hay diálogo de confirmación. Es la
  costura obvia para una versión con efectos detrás.
- **Visión on-device**: `mtmd` + `.mmproj` son ~300 líneas de C++ en un loop de decode a
  mano, y sin NDK ni llama.cpp vendorizado no hay forma de probarlas. Lo que ya funciona
  (foto → `image_url`, y el modelo de visión local por Ollama) queda como está.

**Suite: 151 → 180 tests**, todos en verde (29 nuevos en `tests/agente.test.mjs`).

## [2.9.0] — Leer la agenda

Kiu sabía **escribir** eventos (`addCalendarEvent` abre el calendario del sistema) pero no
**leerlos**: no había forma de responder "¿qué tengo mañana?" ni de que el resumen matutino
supiera qué día es hoy de verdad.

### Nuevo: `calendarList(query, desde, hasta)` en el puente
Igual que `contacts()`: devuelve JSON o `"NEED_PERM"` para que la UI pida el permiso y avise.
Consulta `CalendarContract.Instances` (que ya resuelve recurrencias) con ventana temporal o
por texto, y:

- excluye lo borrado (`deleted = 0`) y lo que no tiene hora, que no se puede ubicar en el día;
- **tope de 40 eventos y de 60 días de ventana**: una agenda con 5000 eventos no es
  información, es ruido;
- `READ_CALENDAR` es solo lectura. No se pide `WRITE_CALENDAR`: para escribir se sigue usando
  el `Intent` `INSERT`, que deja elegir la app de calendario y es lo que el usuario espera.

### `KiuBrain` entiende las dos preguntas distintas

La diferencia entre "¿qué tengo mañana?" y "¿tengo dentista mañana?" no es una palabra suelta:
es **qué palabra sigue al verbo**. Si es un día ("mañana") o un sustantivo genérico
("algo", "reunión") es una consulta por ventana; si es un nombre ("dentista") es por
contenido. `calWindow()` resuelve hoy / mañana / pasado mañana / esta semana / cada día de la
semana, con el reloj congelado en los tests.

> Ojo con `norm()`: se come el `¿`, así que "¿tengo dentista mañana?" llega como
> `"tengo dentista manana?"`. Los patrones nunca ven el signo de apertura.

**Lo que NO hace, y es lo importante:** sin permiso la respuesta dice que necesita permiso.
Devolver una agenda vacía haría creer al usuario que no tiene eventos, que es peor que un
error — es mentirle con formato de verdad.

### Resumen matutino con la agenda
`MorningReceiver` mete los eventos del día (tope 5) entre los recordatorios y la batería. Todo
el bloque está dentro del `if` del permiso: a las 8am la app no le pide nada a nadie, y sin
permiso el resumen sigue siendo igual de útil.

### Arreglo de paso
`brain.js` mezclaba `window.KiuApp` (en las guardas) con `KiuApp` pelado (en las llamadas). En
el WebView son lo mismo y nunca se rompió, pero **el arnés de tests de `brain.test.mjs` usa
`{window: {}}`** —un objeto aparte del global— así que ahí cualquier referencia pelada es
`ReferenceError`. Por eso esa suite, que tiene 13 tests, nunca ejercitó ni una sola de las
ramas que usan `KiuApp` (contactos, acciones del dispositivo, y ahora la agenda). El arnés de
`tests/calendario.test.mjs` modela `window === global` como el navegador de verdad, y al
escribirlo saltó el bug al instante.

**Suite: 135 → 151 tests**, todos en verde (16 nuevos en `tests/calendario.test.mjs`).

## [2.8.1] — La voz volvió (y el avatar del chat se ve)

Estaban rotas tres cosas y la primera explains a las otras dos: **la activación por
voz y la conversación continua eran el mismo bug**.

### 1 · Causa raíz de la voz: faltaba el `<queries>` del servicio de reconocimiento

`AndroidManifest.xml` no declaraba el servicio de voz del sistema. Desde Android 11
(API 30) la visibilidad de paquetes hace que **la app no lo vea**:

```
SpeechRecognizer.isRecognitionAvailable() → false, SIEMPRE
```

Y ese `false` caía en dos ramas distintas:

| Dónde | Qué pasaba | Qué veía el usuario |
|---|---|---|
| `KiuService.cycle()` | `if (!isRecognitionAvailable) { schedule(6000); return; }` | la palabra de activación nunca escuchaba |
| `MainActivity.startSpeech()` | `convArmed = false` + `nexoVoiceError('unavailable')` | el modo conversación no abría el micrófono |

Es el requisito literal de la documentación de `SpeechRecognizer` para `targetSdk >= 30`:

```xml
<queries>
    <intent><action android:name="android.speech.RecognitionService"/></intent>
    <intent><action android:name="android.intent.action.TTS_SERVICE"/></intent>
</queries>
```

Fuera de `<application>`: adentro el parser del manifest lo rechaza. También se
agregó `TTS_SERVICE`, por el mismo motivo con el motor de voz.

### 2 · La wake word escuchaba la palabra y no el pedido

`WakeWordEngine` (Vosk, offline) al detectar «Kiu`» llamaba a `wakePing()`, que solo
encendía un toast. No había forma de decir qué querés. Ahora `wakeHitAndListen()`:
avisa que te escucha **y abre el micrófono del comando**; como el comando llega por
`nexoOnVoice`, la conversación sigue sola.

- **El motor local era código muerto**: solo arrancaba con la preferencia `wwLocal`
  puesta, y solo la ponía `kiuWWStart()`, que la UI nunca llamaba. Ahora que el modelo
  esté en `models/vosk-es-small/` alcanza, y se recuerda la elección.
- **Un solo micrófono**: hay un `AudioRecord` (Vosk) y un `SpeechRecognizer` (el
  comando). `MainActivity.COMMAND_BUSY` + `pause()/resume()` para que no se peleen, y
  `reset()` del decodificador al volver, para que la palabra a medio decir de antes no
  se junte con la frase siguiente y se auto-dispare.
- **Busy-spin al 100 % de CPU**: con el micro tomado, `a.read()` devuelve `<= 0` y el
  bucle hacía `continue` a secas, para siempre. Ahora cede el hilo y distingue
  «ocupado» de «roto».
- `wakeState()` miraba solo `KiuService.ACTIVE`, así que con el motor local vivo la UI
  creía que la palabra de activación estaba apagada y la volvía a prender en cada
  arranque. Ahora pregunta a los dos.
- Si no hay motor de voz, se avisa (`nexoWakeError`) en vez de fingir que Kiu está
  despierto: antes la app figuraba encendida sin estar escuchando nada.

### 3 · La conversación continua moría al primer turno

El rearme del micrófono pedía `S.conv && this._voiceDriven`, pero `_voiceDriven` solo
se encendía al **apretar el botón del micro**. Si la sesión la abría la palabra de
activación o el fin del TTS —que es justamente el modo manos libres— el bucle se
caía después del primer turno: hablás, Kiu contesta… y silencio.

Con voz apagada el rearme depende de la App, así que ahora alcanza con `S.conv`.
Con voz encendida lo maneja Java al terminar el TTS: los dos caminos no se pisan.

- `nexoListenStart` no marcaba `App.voiceBusy`, así que el JS creía que el micrófono
  estaba libre cuando lo tenía abierto el bucle de Java.
- `openConvMic()` ahora no reabre si el reconocedor del comando ya está vivo: dos
  reconocedores compitiendo se pisan y el primero se destruye a mitad de frase.
- `startSpeech()` soltaba el reconocedor viejo **después** de tomar el nuevo, así que
  el comando se cancelaba solo.

### 4 · El avatar del chat se dibujaba encima del título

`#chat-avatar`, `#hero-avatar` y `#profile-avatar` no tenían caja. Las clases que los
dimensionaban (`.kav-hero`, `.kav-big`, `.kav-profile` con `--kav-s`) eran del robot
viejo de pantalla LED —`avatar.js`, borrado en la 2.7.0— y el bot nuevo vive en su
Shadow DOM, así que **`--kav-s` ya no lo leía nadie**. Resultado: los `<div>` quedaban
en `0x0` dentro de su flex, `fitSize()` caía al id (`chat-avatar` → 64 px) y el bot se
pintaba encima del texto de al lado.

- El hueco ahora tiene caja propia y el tamaño en px; el CSS es la **única** fuente de
  la medida (`KiuAvatar.declaredSize()` la lee, incluso con la pantalla oculta) en vez
  de una lista de números en el JS que además se contradecía con el CSS.
- El tamaño cuelga del **id**, no de la clase: `#chat-avatar` es `kav-mini kav-big` y,
  si mandara la clase, ganaba la última del archivo y se quedaba en 40 px en vez de 44.
- `refit()` ya no se salta los hosts sin layout: usaban el tamaño de emergencia para
  siempre. El piso de tamaño bajó de 54 a 30 px, porque los huecos chicos son de 40 y
  44 y un piso mayor los desbordaba igual.
- `logo-mini` se fue del HTML: era el cuadrito con degradado y letra del logo viejo y,
  por especificidad, le ganaba al ancho del hueco.
- El bot del chat ya sigue el estado de la tarea como corresponde («Indexando» con la
  lupa al leer documentos, «Acción del dispositivo» con el engranaje al tocar el
  teléfono, «Enrutando» al buscar, «RAG activo» con el libro…): el problema era de
  tamaño, no de estado.

### Otros arreglos

- **`bridge_audit.py` miraba la mitad de los eventos**: solo detectaba `window.nexoX(`
  (KiuJsPost) y `window.X(', `, así que los que `MainActivity` manda con
  `js("nexoX(...)")` —la mayoría— nunca se auditaron. Ahora los ve todos y además
  avisa si Java manda un evento que el JS no escucha. Contrato verificado: 86 métodos,
  15 eventos Java→JS, cero llamadas fantasma.
- Suite: 115 → **135 tests**, todos en verde. Los 20 nuevos viven en
  `tests/voz.test.mjs` y fijan los tres contratos (manifiesto, ciclo del micrófono,
  rearme del bucle y caja de cada hueco del bot).

## [2.8.0] — Un solo controlador de estados para el avatar

El bot se movía raro porque **dos capas distintas peleaban por su estado**: `kiu-avatar-boot.js`
envolvía `window.KiuBridge` con un `Proxy` y *adivinaba* el estado mirando cada llamada al
puente, mientras `app-ui.js`, `motor.js` y `models.js` llamaban `KiuAvatar.set()` por su cuenta.
Los dos caminos se pisaban. Ahora hay un solo dueño del estado.

### Nuevo: `js/kiu-estados.js` (controlador por capas y prioridad)
- `KiuState.set(capa, estado[, ms])` · `.flash(capa, estado, ms)` · `.clear(capa)` · `.reset()` · `.get()` · `.snapshot()` · `.on(fn)`.
- Capas y prioridad: `err 90 > job 70 > pausa 65 > ruta 60 > voz 50 > tool 35 > flash 30 > rag 25 > rest 10`.
  Lo persistente manda y **un flash solo se ve si no hay nada de mayor prioridad activo**.
- `pause` existe porque 'Proveedor en pausa' con prioridad de flash nunca se habría visto:
  'Enrutando' estaba activo justo mientras se prueba el siguiente modelo.
- `rag` va por debajo de `flash` a propósito: 'RAG apagado' es un estado de reposo y si viviera
  más arriba taparía para siempre los avisos.
- La caducidad la decide el reloj de cada capa, no el temporizador: con la WebView en segundo
  plano los `setTimeout` no corren y el bot se quedaba con el estado viejo.
- `set('ruta', …)` lleva red de seguridad de 2 min: una promesa colgada no deja al bot clavado
  en «Enrutando». Es un temporizador del controlador, no un timer suelto más.
- `window.KiuState` ya lo usaba `app-ui.js` para los **ajustes** (`window.KiuState = S`): ese
  alias sin uso pasó a llamarse `window.KiuSettings` para liberar el nombre. `S` sigue igual.

### Bugs que se fueron
- **«Respuesta lista» mientras seguía generando**: el `Proxy` daba la generación por terminada a
  los 2,5 s sin sondeo, y con el streaming por push ya no hay sondeo. Ahora la enciende y la
  apaga `Kiu.ask`.
- **«Cargado» en cada mensaje**: `ensureLoaded()` llama `kiuIsLoaded` antes de cada envío y el
  `Proxy` lo leía como «recién cargó». `ensureLoaded` ya no toca el avatar.
- **Alias viejos apuntando al estado equivocado**: `think` iba a «Armando prompt» (no a
  «Generando»), `work` al engranaje de «Acción del dispositivo» (se veía al cargar o descargar
  un modelo), `search` a «Indexando» (lupa sobre un documento, en una búsqueda web) y `create` a
  «RAG activo» (al pedir un poema aparecía el libro). Ahora `think`/`create` → «Generando»,
  `search` → «Enrutando», `work` → «Cargando»; la acción en el teléfono se sigue pidiendo con
  `alert`/`action`.
- **Reposo desactualizado**: `set()` no actualizaba el estado base y los flashes volvían a un
  valor viejo (podía quedar en «Generando» con la respuesta ya escrita). El estado base lo
  calcula ahora `App.avatarRest()` con la verdad a la vista.
- **«Entrada» con cualquier campo de texto**: el listener global de `input` reaccionaba a
  Ajustes, claves de API y el buscador del navegador. Va atado al input del chat.
- **Timers sueltos**: el de `kiuLoad` forzaba «Inactivo» a los 90 s aunque hubiera otro estado;
  «Escuchando» duraba 9 s fijos y «Hablando» se calculaba por el largo del texto. Ahora mandan
  `nexoTtsStart`/`nexoTtsDone` y `nexoListenStart`/`nexoListenEnd`.
- **El `Proxy` sobre `KiuBridge` se eliminó** y con él el listener global de `input`.
  `kiu-avatar-boot.js` queda con lo suyo: montar y re-ajustar tamaño.

### Estados que nunca se veían (ya tienen dueño)
- `Enrutando` — al mandar un mensaje, abrir el navegador embebido o esperar un proveedor.
- `Proveedor en pausa` — cuando un proveedor falla y `Rtr.fail()` lo aparta.
- `Sin modelo` / `Usar nube/Ollama` / `Motor no soportado` — en `App.avatarRest()`, según lo que
  haya en `S.dl.done` y si el motor interno está disponible en ese teléfono.
- `Disparado` — `ReminderReceiver` manda un broadcast interno y `MainActivity` lo traduce a
  `nexoAlarmFired` si la WebView está viva.
- `Reprogramado al reiniciar` — `BootReceiver` cuenta cuántas alarmas rearma, lo guarda en
  `kiu_native.resched` y la UI lo consume con `kiuTakeRescheduled()` (take-once).
- `RAG apagado` — estado pegado de la capa `rag`, no un aviso de 2,5 s.

### Otros arreglos
- **El avatar no reinicia las animaciones en cada cambio**: `set()` reescribía el SVG entero
  (ojos, boca, brazos, antena, objeto y `className`). Ahora guarda qué pintó y solo toca lo que
  cambió; el `className` del cuerpo se reasigna únicamente si es distinto.
- **`KiuAvatar.state()` devuelve el nombre real** del estado del mapa, no el alias viejo de 13
  nombres; `KiuAvatar.oldState()` conserva la vista vieja. El pill del chat se arma con los 37
  estados: antes todo lo que no fuera de esos 13 caía en «Listo para empezar» mientras el bot
  descargaba un modelo.
- **Permiso de alarma exacta con diálogo propio**: al agendar un recordatorio en Android 12+
  se avisa (estado «Sin permiso de alarma exacta») y se lleva a Ajustes del sistema. Antes solo
  había un botón suelto en Preferencias y ningún aviso al agendar. `App.confirm` acepta
  `cancelLabel`.
- **`{{key:x}}` atado a los hosts de su proveedor** (`KiuApiProxy`): el placeholder solo se
  sustituye si la petición va a un host de ese proveedor. Un host de un proveedor conocido nunca
  recibe la clave de otro; el proveedor personalizado del usuario sigue funcionando.
- **Wake word tras reiniciar en Android 14**: desde `BOOT_COMPLETED` ya no se puede arrancar un
  servicio con micrófono. Antes fallaba en silencio y Kiu figuraba como despierto sin estarlo;
  ahora manda una notificación pidiendo abrir la app una vez.
- **Test inestable arreglado**: `parseWhen('a las 9 de la manana')` fallaba pasadas las 9:00
  porque asumía la hora actual. El código estaba bien (a las 10, las 9 de la mañana ya pasaron y
  la próxima ocurrencia es mañana); el test ahora congela el reloj y hay un caso para cada
  rama. Verificado en 5 zonas horarias.
- **`tests/estados.test.mjs` (nuevo, 16 tests)** fija el contrato del controlador: prioridades,
  un flash que no pisa a lo persistente, la caducidad por reloj, los alias y las regresiones
  del Proxy. Suite completa: 115 tests, 115 pasan.

## [2.7.5] — Arreglos de arranque y CI

- **Error «Sys is not defined» al abrir** (`motor.js:596`): `Sys` vivía solo dentro de `app-ui.js`; ahora se exporta a `window`.
- **El bot grande del inicio no se dibujaba**: `attachShadow` no se permite en `<button>`; `kiu-avatar.js` usa un hijo como host cuando falla.
- **El bot de la esquina se movía de un lado a otro y tapaba el «Kiu»**: los movimientos del cuerpo estaban en px fijos (pensados para el bot de 190 px) y en el mini de 36 px eran enormes. Ahora escalan con su tamaño (`--u` = tamaño/190).
- **Bot pequeño (esquina, chat, perfil) quieto en su sitio**: por debajo de 60 px el cuerpo ya no se desplaza ni se sacude de lado en ningún estado, solo flota suave. El estado se sigue leyendo por cara, brazos, antena y objeto, como en el mapa de estados. El bot grande del inicio mantiene todas sus animaciones.
- **CI**: `android.useAndroidX=true`, reintento de la descarga de Gradle, `llama_sampler_init_penalties` tolerante a cambios de firma y un resumen con el error real de compilación.

## [2.7.0] — Tanda 8: refactorización del frontend, RAG en Web Worker y CI blindado

### Consolidación del avatar
- **`avatar.js` eliminado**: el robot viejo de 13 estados ya no se cargaba desde index.html
  (solo quedaba como "referencia" con 12,9 KB muertos). El bot de `kiu-avatar.js` (37 estados)
  es el único avatar y mantiene la capa de compatibilidad (`KiuAvatar.set/flash/state/pick`
  entienden los nombres de estado viejos).
- **Inicialización unificada en `kiu-avatar-boot.js`**: una sola vía de montaje — los huecos
  `[data-avatar]` y `[data-avatar-mini]` que declara el HTML. Fuera el loader dinámico de
  emergencia, el reemplazo de "avatares ajenos" (búsqueda por selectores/texto de saludo) y el
  `MutationObserver` de 20 s: el arranque es directo, con un reintento a 800 ms y `refit`
  para pantallas que se abren después.

### RAG en Web Worker (UI que no se congela)
- **`js/rag-worker.js` (nuevo)**: núcleo puro del RAG en UN solo archivo con dos modos, al
  estilo pdf.js + pdf.worker.min.js. En el hilo principal expone `window.KiuRagCore`
  (tokenización, fragmentación, tf, BM25) para que la matemática no esté duplicada; en modo
  worker atiende `{id, op}`: `prep` (fragmenta + precalcula tf), `sync` (espeja el índice sin
  textos), `drop`, `search` (BM25 → top-k) y responde siempre con el mismo `id`.
- **`rag.js` v3.1**: delega toda la matemática en `KiuRagCore` (cero duplicación) y corre la
  fragmentación de documentos grandes y el cálculo de similitud en el worker. `addText` manda
  el texto crudo al worker (un doc de 30 MB ya no bloquea el hilo de la UI); nuevo
  `RAG.searchAsync(q,k,cb)` con guardia de 2 s (si el worker se cuelga, contesta con el índice
  local), `RAG.hits(q,k)` estructurado y `RAG.ctxFor(q,k,cb)` para los flujos de chat. Sin
  worker (WebView vetusto / VM de tests) todo cae a las rutas síncronas de siempre.
- **app-ui**: `kiuReply` y `apiStream` resuelven ahora el contexto de documentos con
  `RAG.ctxFor` (worker) antes de armar el prompt; `kiuMsgs`/`apiMsgs` aceptan `preCtx`
  precalculado. La búsqueda web (`msgsOverride`) no toca RAG, como antes.
- **Contrato react.js ↔ rag.js corregido (bug real)**: `searchDocs` llamaba a
  `RAG.search()` esperando un array de `{doc, txt}` pero `search` devuelve un STRING para
  inyectar al prompt: el paso "docs" del ReAct citaba caracteres sueltos. Ahora usa
  `RAG.hits()` (estructurado) y un test nuevo documenta el descontrato.

### Puente JS↔Java y seguridad
- **Auditoría automática del puente**: `scripts/bridge_audit.py` cruza los 84 métodos
  `@JavascriptInterface` de `MainActivity.java` contra todos los nombres que invoca el JS
  (`BR.x`, `bridge('x')`, `rawBridge('x')`, `B.x`, `KiuBridge.x`) y los 5 eventos Java→JS
  (`kiuPush`, `kiuNativeDone`, `kiuDataRestore`, `kiuSkillInstall`, `kiuMorningSummary`).
  Resultado: contrato OK, cero llamadas fantasma. Documentados en `BRIDGE_API.md` los dos
  métodos que faltaban (`contacts`, `addCalendarEvent`) y la lista completa de eventos push.
- **Heurística general de API en `kiu-secure.js`** (pendiente de KNOWN_ISSUES): un proveedor
  nuevo ya no exige editar la lista de hosts de nube. HTTPS distinto del origen de la app con
  ruta con pinta de API (`/v1`, `/v1beta`, `/api`, `/chat/completions`, `/messages`,
  `/embeddings`…) viaja por el proxy de Java, que igual exige HTTPS, limita a 8 MB y mantiene
  la clave fuera del WebView.
- **`llama_backend_free()` en `freeModel()`** (pendiente de KNOWN_ISSUES): el backend global
  de llama.cpp se libera al liberar el motor; `loadModel()` lo re-inicializa solo
  (`g_backend_ready` → recarga de modelo después de un free sigue funcionando).

### Tests, ProGuard y CI/CD
- **Suite ampliada de 50 → 85 tests**: nuevos `tests/app-core.test.mjs` (16: env, state,
  catalog, models, motor — plantillas de chat, KB, streaming por push, bóveda),
  `tests/i18n.test.mjs` (4), `tests/migrate.test.mjs` (4: idempotencia del ferry, payload
  corrupto, exportación completa) y `tests/rag-worker.test.mjs` (9: núcleo + protocolo del
  worker con FakeWorker + integración). El arnés de DOM falso se extrajo a
  `tests/helpers.mjs` compartido.
- **ProGuard/R8 blindado** (`app/proguard-rules.pro`): reglas explícitas para que habilitar
  minify algún día no rompa nada — métodos `@JavascriptInterface` de cualquier clase,
  métodos `native` de `com.kiu.agent.**` (contrato JNI por nombre), `KiuStream.onToken`
  (el C++ lo busca con `FindClass` + `GetStaticMethodID`), Vosk/JNA y el paquete completo
  del agente como red de seguridad documentada.
- **CI en orden y con herramientas propias**: `.github/workflows/build.yml` corregido (el
  filtro `branches:` tenía un YAML roto desde la tanda 6) y ahora garantiza el orden
  **tests → get-tools.sh → vendor_llama.sh → APK firmado** (`needs: tests`); el job de tests
  corre `node --test tests/*.test.mjs` (los tests nuevos entran solos). **`scripts/get-tools.sh`
  (nuevo)**: provisiona JDK 17, cmdline-tools, platform 34, build-tools, NDK 27.0.12077973 y
  cmake 3.22.1 de forma idempotente — el mismo flujo en CI y en local.

## [2.6.1] — Tanda 7: limpieza de recursos gráficos + gestión de nativos JNI

### Limpieza de recursos gráficos (APK más liviano)
- **Iconos adaptativos sin duplicados**: en las 5 densidades (`mipmap-mdpi` … `mipmap-xxxhdpi`)
  convivían dos pares idénticos en nombres distintos: `ic_launcher_bg.png`/`ic_launcher_fg.png`
  (nombres de apktool) y `ic_launcher_background.png`/`ic_launcher_foreground.png` (los que
  referencian `mipmap-anydpi-v26/ic_launcher.xml` e `ic_launcher_round.xml`). Borrado el par
  **no usado** (`bg`/`fg`) en las 5 densidades: 10 PNG, −432 KB. También salió el color huérfano
  `ic_launcher_bg` (`colors.xml` completa: solo contenía eso y no había ninguna `@color/` local
  en uso).
- **Logos del WebView en WebP**: `logo.png`, `logo_full.png` y `logo_round.png` (512×512 RGBA,
  915 KB en total) convertidos a WebP con pérdida (`quality=82`, `method=6`): **56 KB** en total
  (−94 %), misma dimensión y alfa. Los PNG no tenían ninguna referencia en el código (la esquina
  y el "Acerca de" muestran el bot SVG desde v2.3.0); quedan como activos de marca. Pautas
  documentadas en `docs/AVATAR_Y_LOGO.md` (sección "Logo en WebP").

### Librerías nativas C++/JNI (llama.cpp)
- **`.so` fuera de Git**: `app/lib/arm64-v8a/` (libllama, libggml*, libkiullama, libc++_shared —
  6,9 MB) salió del repositorio vía `.gitignore`. Los binarios viven ahora en la ubicación
  estándar `app/src/main/jniLibs/<ABI>/`, también ignorada: el build los regenera desde fuente
  o se reutilizan de un build previo. `keystore/` también queda ignorado (la clave de firma
  nunca debe subirse). El ZIP de entrega ya no incluye binarios.
- **Inyección nativa automatizada en Gradle**:
  - `app/src/main/cpp/CMakeLists.txt` fija `CMAKE_LIBRARY_OUTPUT_DIRECTORY` a
    `app/src/main/jniLibs/${ANDROID_ABI}` (antes de `add_subdirectory`, para que ggml/llama
    hereden): los `.so` compilados quedan inyectados en esa carpeta.
  - `app/build.gradle.kts`: el hack `jniLibs.srcDir(app/lib)` desapareció (ubicación estándar);
    en modo fuente se desactiva `jniLibs` como origen para no empaquetar cada librería dos veces;
    `abiFilters` automáticos según las ABIs presentes (prebuilt = solo arm64-v8a, así el APK no
    arrastra las ABIs inútiles de Vosk/JNA); si no hay vendor ni `.so`, el build corta temprano
    con la receta de recuperación en vez de producir un APK mudo.
  - `scripts/vendor_llama.sh` migra las `.so` viejas de `app/lib/` a `jniLibs` y anuncia el
    flujo; `scripts/build.sh` rechaza compilar sin motor; el CI vendoriza llama.cpp antes del
    `assembleDebug/Release` (los runner ya traen NDK y AGP instala el 27 si falta).
- **Auditoría del ciclo de vida de memoria**:
  - C++ (`kiullama_jni.cpp`) verificado sin fugas: `free_locked()` suelta contexto y modelo
    (idempotente, bajo `g_mtx`), los caminos de error de `loadModel` liberan lo cargado y
    `generate()` libera batch, sampler y buffer de un token en todos sus caminos (los `return`
    tempranos son anteriores a las asignaciones). `stream_push` limpia sus refs locales.
  - Java: nuevo `KiuGenJob.freeAsync()` (stopGen + freeModel en hilo propio, no bloquea al
    hilo que destruye el componente). `MainActivity.onDestroy()` lo llama si `isFinishing()`
    (el cierre real libera el GGUF de la RAM; la rotación mantiene el modelo cargado) y
    `KiuService.onDestroy()` lo llama solo si `MainActivity.inst == null` (sistema mató el
    servicio sin UI; con `stopWake` desde Ajustes el modelo sigue en uso por el chat).

### Misc
- Versión `2.6.1` (versionCode 35) en Gradle y UI (perfil, Acerca de, export).
- CI: el job `build` ahora ejecuta `./scripts/vendor_llama.sh` antes de Gradle.

## [2.6.0] — Tanda 6: migración apktool → Gradle completada

### Retirada total de la estructura de reempaquetado
- **Java migrado y verificado**: las clases viven en `app/src/main/java/com/kiu/agent/` y
  `reference-java/` se eliminó (la `R.java` vieja no se portó: Gradle genera su propia R).
- **Sin smali**: verificada la paridad de `KiuImport.smali` contra `KiuImport.java` (ver abajo)
  y eliminados `app/smali/` y `app/smali_classes2/` (~500 KB de bytecode descompilado).
- **Recursos unificados**: las definiciones de `app/res/values/` se integraron en
  `app/src/main/res/values/` (AppTheme completa con `colorPrimary/colorPrimaryDark/colorAccent/
  windowLightStatusBar` + `colors.xml` con `ic_launcher_bg`); `public.xml` (mapa de IDs de
  apktool) no tiene sentido en Gradle y se borró junto con toda `app/res/` (los mipmaps ya eran
  idénticos a los de `src/main/res`).
- **Manifest y assets consolidados**: `app/AndroidManifest.xml` viejo eliminado (el de
  `src/main` ya tenía TODOS los permisos, las 22 queries y los 5 componentes, y además la red
  segura con `networkSecurityConfig`); `app/assets/www/` ahora vive en
  `app/src/main/assets/www/` (ubicación estándar, sin `sourceSets` extra).
- **Scripts de reempaquetado fuera**: eliminados `app/apktool.yml`, `scripts/repack.py` y
  `scripts/get-tools.sh` (apktool + uber-apk-signer ya no hacen falta).
- **`scripts/build.sh` reescrito**: compila directo con `./gradlew` (debug por defecto;
  `KIU_PASS=… ./scripts/build.sh` = release firmado, crea `keystore/kiu-release.jks` si no
  existe). La firma v2/v3 la hace Gradle con el nuevo `signingConfig` (variables `KIU_KS`,
  `KIU_ALIAS`, `KIU_PASS`) — reemplaza al uber-apk-signer.
- **CI simplificado**: un solo flujo de build (Gradle): `tests` + `build`
  (`assembleDebug` + `assembleRelease` + lint) + `release` por tags `v*`. Con los secretos
  `KIU_KEYSTORE_BASE64`/`KIU_KEYSTORE_PASSWORD` el release sale firmado con la clave real.

### KiuImport: paridad completa con el bytecode original
- `KiuImport.java` conservaba todas sus mejoras (progreso, SHA-256) pero le faltaban tres
  validaciones del smali original: ahora rechaza archivos que no terminan en `.gguf`,
  sanitiza el nombre con la regex estricta `[^A-Za-z0-9._-]` → `_` (tope 90 caracteres) y
  verifica espacio libre (`getUsableSpace() < total + 50 MB` → "no hay espacio suficiente
  en el telefono").
- Además recupera el comportamiento del original de escribir a `<nombre>.part` y renombrar
  al final (nada de GGUF corruptos con nombre definitivo si la copia se corta), y borra el
  `.part` si algo falla. El fallback de nombre vuelve a ser `modelo.gguf` y los errores usan
  el formato del original (`ClaseSimple: mensaje`).

### Docs y versiones
- README, `docs/GRADLE_MIGRATION.md` (estado "completada al 100 %" + nueva sección de firma),
  `docs/KNOWN_ISSUES.md` (2 resueltas nuevas), `docs/BRIDGE_API.md` y `docs/AVATAR_Y_LOGO.md`
  sin referencias al flujo viejo; `.gitignore` actualizado.
- App **v2.6.0** (versionCode 34). Suite de 50 tests sin cambios (no toca código JS de lógica).

## [2.5.0] — Tanda 5: sección 4 (funciones nuevas)

### Sección 4-a — Skills instalables
- **js/skills.js** (`window.KiuSkills`): un skill es un **manifest JSON declarativo**
  (id, name, version, desc, 1–8 intents, reply con variables, tts opcional).
  **Sin código ejecutable por diseño**: no hay `eval` ni JS de terceros en el WebView,
  así los skills no pueden hacer nada fuera de contestar.
- Intents por frase (match normalizado: tildes/ñ/mayúsculas) o `regex:` explícito.
  Variables en las respuestas: `{nombre} {hora} {fecha} {bateria} {carga}`.
  También admite `reply: "accion:enciende la linterna"` para delegar en el cerebro
  local; si el cerebro no puede, el skill se calla (no contesta basura).
- Instalación: pegando el JSON en Ajustes → Skills, o **desde archivo vía SAF**
  (`kiuSkillImport` → código 7104 → `window.kiuSkillInstall`). Tope 20 skills × 8 KB.
  Re-instalar la misma id actualiza. Ejemplos incorporados: Saludo ninja, Ánimo flash
  y Estado express (botón «Ejemplos»).
- En el chat los skills **tienen prioridad sobre el cerebro** (el usuario los creó
  para personalizarlo). En Ajustes → Skills: activar/pausar/borrar uno por uno.
- Viajan en la copia completa (`skills` en el payload; los ejemplos no viajan).

### Sección 4-b — Resumen matutino
- **MorningReceiver.java**: alarma diaria (AlarmManager exacto si hay permiso, con
  reagenda automática al día siguiente y al reiniciar vía BootReceiver) que arma un
  resumen con datos **frescos al disparar**: saludo por hora, fecha en español,
  recordatorios de las próximas 36 h (de `Alarms`), batería y un tip rotativo.
  Notificación con BigText en canal propio `kiu_morning` (importancia default, sin
  estruendo de alarma). Si la app está abierta, además queda en el chat vía
  `window.kiuMorningSummary`.
- Puente: `kiuMorningSet(hora, minuto, on)` y `kiuMorningGet()`. UI: Ajustes →
  **Resumen matutino** (toggle + hora, default 08:00) con subtítulo vivo en la fila.

### Sección 4-c — Bucle ReAct de pocos pasos
- **js/react.js** (`window.KiuReAct`): si el pedido tiene varias partes («poné alarma
  a las 7 y buscá en mis notas la receta»), se parte en pasos y corre un mini-bucle
  **Razonar → Actuar → Observar** por paso con las herramientas LOCALES: el cerebro
  (alarmas, linterna, cálculo, hora, batería…) y el RAG (documentos indexados).
  Sin nube y sin modelo cargado: corre siempre. Máx 4 pasos.
- **Honestidad ante todo**: si ninguna parte se puede resolver, devuelve
  `handled:false` y el flujo normal (orquestador/API/local) sigue como si nada; si
  sobran partes sin resolver, lo dice al pie. Traza del último bucle en
  `KiuReAct.lastTrace`.
- Integrado en `sendMsg` después del cerebro y antes del orquestador (no secuestra
  búsquedas web).

### De paso (bug real)
- **PendingIntents sin `FLAG_IMMUTABLE`** en `Alarms.pending()` y
  `ReminderReceiver.notify()`: en Android 12+ con target 34 lanzaban excepción y
  **rompían TODAS las alarmas** en teléfonos modernos. Corregido (también aplica al
  resumen matutino, que usa la misma infraestructura).

### Tests y release
- `tests/skills.test.mjs` (9) y `tests/react.test.mjs` (8): validación estricta del
  manifest, match normalizado, variables, toggle, ejemplos, export/import, partición
  de pasos, clasificación, bucle completo, tope y honestidad. **Suite: 50 tests**
  (13 brain + 8 secure + 8 rag + 4 boot + 9 skills + 8 react), todos en CI.
- App **v2.5.0** (versionCode 33).

## [Sin liberar] — Tanda 4: sección 3 (arquitectura) + pendientes de la 1

### Sección 3-a — app.js dividido en módulos
- **5.457 líneas → 6 módulos** bajo `js/app/`: `env.js` (helpers, iconos, puente),
  `state.js` (ajustes, conversaciones, bóveda Sec, proveedores), `catalog.js`
  (catálogo de modelos), `models.js` (descargas + importar GGUF), `motor.js`
  (motor llama.cpp, compresión, router, orquestador, KB) y `app-ui.js` (toda la UI).
  Scripts clásicos con símbolos compartidos por `window` (mismo contrato que dentro
  del `app.js` original) para no exigir WebView con módulos ES. `index.html` carga
  los 6 en orden; el `app.js` monolítico se eliminó (queda en git).
- **Bug de antigua data corregido de paso**: `window.App` nunca se asignaba y `rag.js`
  usaba `App.toast` pelado; ahora `app-ui.js` expone `window.App`.
- **Arnés de regresión permanente**: `tests/boot.test.mjs` carga TODOS los scripts en
  el orden real de `index.html` dentro de una VM con DOM falso y verifica que no haya
  `ReferenceError` cross-módulo y que `App.init()` complete.

### Sección 3-b — RAG sobre IndexedDB + BM25
- **rag.js v3**: persistencia en IndexedDB (`kiu-rag`: docs/chunks/meta) con fallback
  automático a localStorage si no hay IDB. El tope sube de 0,8 MB a **~8 MB** de texto.
- **tf precalculado al indexar** (antes se re-tokenizaba todo el corpus en cada
  arranque) y ranking **BM25** (k1=1,4 · b=0,75) con IDF del corpus propio.
- **Migración única**: el `nexo_rag` viejo de localStorage se importa a IDB en el
  primer arranque y se borra la clave vieja. API pública intacta
  (`RAG.on/docs/search/addFile/del/toggle/stats/render/init`) + `exportAll/importAll`
  para la copia de seguridad.
- Tests: `tests/rag.test.mjs` (8, con shim de IndexedDB en memoria): migración,
  persistencia entre boots, ranking, tope, export/import, borrado en IDB, on/off
  persistente y modo localStorage.

### Sección 3-c — i18n y protección térmica
- **Fundación i18n** (`js/i18n.js`): diccionario es/en para el chrome (navegación,
  inicio, etiquetas de ajustes, botones) vía `data-i18n`; selector Español/English en
  Apariencia; guarda en `nexo_settings.lang` y dispara `kiu-lang`. Las respuestas del
  cerebro siguen en español (el texto dinámico sin clave hace fallback a español).
- **Protección térmica**: la temperatura de batería ya venía en `sysInfo().temp`;
  `Kiu._thermArm()` mide cada 10 s durante la generación y a **46 °C** corta el motor,
  entrega el parcial como respuesta recuperada y avisa (avatar "Detenido" + toast).
  Interruptor "Protección térmica" en Ajustes (`S.thermal`, por defecto activa).

### Pendientes de la sección 1 — SHA-256 y copia completa SAF
- **SHA-256 de modelos**: `KiuDlTask` hashea en streaming (incluye el `.part` previo
  al reanudar) y verifica contra el hash oficial de Hugging Face que ahora trae el
  catálogo (13/13 obtenidos de la API de HF). Si el hash no coincide, el archivo se
  borra y queda el error de siempre. El toast de fin de descarga dice
  "SHA-256 verificado ✓" y `S.dl.done[name].sha/.v` guardan el resultado. `KiuImport`
  también calcula el SHA del GGUF importado (visibles en `impStatus.sha256`).
- **Copia completa vía SAF**: nuevos métodos del puente `kiuDataExport(json)`
  (ACTION_CREATE_DOCUMENT, `kiu-copia-YYYYMMDD-HHmm.json`) y `kiuDataImport()`
  (ACTION_OPEN_DOCUMENT → `window.kiuDataRestore`). La copia incluye ajustes (sin
  claves API: nunca viajan), memoria, conversaciones, alarmas, KB, uso y RAG completo
  (documentos + fragmentos). Botones "Guardar copia completa" / "Restaurar archivo"
  en Copias de seguridad.
- `versionName 2.4.0` (versionCode 32).

### CI / tests
- Suite: 33 tests (13 brain + 8 secure + 8 rag + 4 boot). CI corriendo los 4 archivos.

## [2.3.0] — Tanda 3: sección 2 (seguridad) + avatar en la esquina

### Esquina del home
- **Fuera el bot viejo de la esquina superior izquierda**: el topbar del inicio y el bloque
  "Acerca de" ya no muestran `img/logo.png`; ahora ahí vive el mismo bot nuevo de 37 estados
  (`data-avatar-mini`, montado por `kiu-avatar-boot.js` a 36/42 px, reacciona a los estados
  como el resto). Versiones viejas actualizadas: perfil `v1.7.4` → `v2.3.0`, Acerca de
  `2.1.2` → `2.3.0`, export de datos `1.7.4` → `2.3.0`.

### Sección 2 — Seguridad
- **2-a WebViewAssetLoader**: la UI se sirve por `https://appassets.androidplatform.net`
  (origen seguro de `androidx.webkit`) en vez de `file:///android_asset`. Se apagó
  `setAllowUniversalAccessFromFileURLs` (ya no hace falta) y las navegaciones `file://` se
  bloquean. **Ferry único de datos**: el primer arranque de la app nueva carga una vez el
  origen viejo con `?ferry=1`, `js/kiu-migrate.js` exporta todo el `localStorage`, Java lo
  guarda (`kiuFerryPut`) y recarga en el origen seguro, donde el mismo script reimporta
  (`kiuFerryGet` / `kiuFerryClear`) y marca `kiu_ferried`. Sin puente (desktop) es no-op.
  Mixed-content en modo compatibilidad para los endpoints locales.
- **2-b Claves fuera del WebView**: nueva bóveda en Java (`kiuKeysSet/Get/Has/Del/List`)
  que guarda las claves API **cifradas con Keystore** (`KiuCrypto`, prefs `kiu_keys`); el JS
  nunca recibe la clave en claro (solo últimos 4). `app.js` ahora guarda por la bóveda
  (`setProvKey`/`loadKeys` migran lo viejo) y `provHeaders()` manda el placeholder
  `{{key:proveedor}}`. Nuevo `KiuApiProxy.java`: proxy HTTP(S) en Java (`kiuApiStart/Poll/Stop`)
  con HTTPS obligatorio para la nube, `http://` solo para localhost/LAN privada, tope de 8 MB,
  timeouts y cancelación. `js/kiu-secure.js` intercepta `fetch`: nube + `http://` local van por
  el proxy (sin mixed-content y sin CORS con Ollama/LM Studio), el resto pasa nativo.
- **2-c Streaming real por push**: el wrapper JNI (`kiullama_jni.cpp`) avisa cada ~300 ms / 16
  tokens vía `KiuStream.onToken` → `KiuJsPost` → `window.kiuPush('gen',{so:…})`; `app.js` pinta
  el parcial al instante y **suspende el sondeo** de `kiuGenStatus` mientras el push está vivo
  (si el push se corta, vuelve el sondeo y el watchdog de siempre). Con las `.so` precompiladas
  no hay push y todo sigue como antes: cero rupturas.

### CI / tests
- `tests/secure.test.mjs` (8 tests nuevos): bóveda por puente, routing del fetch (local/nube/
  fuera de lista/transparente sin puente) y ferry completo. CI: `node --test tests/*.test.mjs`.
- `versionName 2.3.0` (versionCode 31), dependencia nueva `androidx.webkit:webkit:1.11.0`.

## [Sin liberar] — Tanda 1: migración Gradle + motor desde fuente + wake word

### Sección 5 — Apuestas grandes (de la lista de mejoras)
- **5-a Proyecto Gradle real**: `settings.gradle.kts`, `build.gradle.kts` raíz, `app/build.gradle.kts`
  (AGP 8.5.2, minSdk 24 / target 34, namespace `com.kiu.agent`), wrapper 8.9, manifest limpio y
  recursos mínimos. Los 12 fuentes Java de `reference-java` quedaron porteado a
  `app/src/main/java/com/kiu/agent/` (verificado compilando con ECJ + android.jar platform-34).
  Tres métodos que el decompilador no recuperó se reescribieron a mano:
  - `KiuDlTask.run()` — **con reanudación HTTP Range** (las descargas de modelos retoman donde
    quedaron).
  - `Bridge.contacts()` — idéntico al bytecode original.
  - `KiuImport.copy()` — copia SAF con progreso.
- **5-b Motor nativo desde fuente**: `vendor/llama.cpp` (commit `b476d9a`, shallow) +
  `app/src/main/cpp/kiullama_jni.cpp`, un wrapper JNI que implementa el contrato exacto de
  `KiuNative` (loadModel/generate/genStatus/stopGen/freeModel…) con la API actual de llama.cpp
  (batches, context shift, sampler chain, prefill por lotes de 512). El `app/build.gradle.kts`
  detecta solo el modo: con `vendor/llama.cpp` compila con NDK, sin él usa las `.so` precompiladas.
  Para vendorizar: `./scripts/vendor_llama.sh`.
- **5-c Wake word local offline**: `WakeWordEngine.java` basada en Vosk (modelo pequeño en español),
  loop propio de `AudioRecord` a 16 kHz, gramática `["kiu","hey kiu","iu","ki"]`, cooldown 4 s y
  silencio automático mientras el TTS habla. Integrada a `MainActivity` y al bridge JS
  (`kiuWWStart` / `kiuWWStop` / `kiuWWState`).

### Sección 1 — Rápidas
- **LICENSE**: agregada licencia MIT.
- **Tests**: `tests/brain.test.mjs` con 13 tests (Node puro, `node --test`) cubriendo `norm`,
  `parseWhen`, `reply` matemática, `genPass`, `fallback` y anti-falsos-positivos. Corren en CI.
- **Release por tags**: el workflow de GitHub Actions ahora, al pushear `v*`, publica una Release
  con los APK de ambos flujos (apktool y Gradle).
- **network_security_config.xml**: en el build Gradle el tráfico en claro está bloqueado por
  defecto (HTTPS obligatorio); solo localhost, 127.0.0.1 y 10.0.2.2 tienen excepción, y hay un
  bloque comentado para agregar IPs LAN (Ollama / LM Studio). ⚠️ Si usás el motor de otra máquina
  por HTTP, agregá su IP a `app/src/main/res/xml/network_security_config.xml`.

### CI
- Job nuevo `tests` (Node 20) + job `release` (publica en GitHub Releases).
- Se conservan los dos jobs de build: `build` (apktool, respaldo) y `gradle` (real).

### Documentación
- `docs/GRADLE_MIGRATION.md` (nueva), `docs/KNOWN_ISSUES.md` (sección "Resueltas"),
  `docs/BRIDGE_API.md` (wake word), `README.md` (dos caminos de build), `CHANGELOG.md` (este archivo).

## [Sin liberar] — Tanda 2: avatar nuevo de 37 estados en toda la app

### Avatar
- **Activado el bot nuevo** (`kiu-avatar.js`, 37 estados con paletas, ojos, bocas,
  brazos, antena y objetos FX): `index.html` ya no carga el robot viejo
  (`avatar.js` queda como referencia).
- **En los tres huecos**: hero, cabecera del chat y tarjeta de perfil, cada uno con
  el tamaño del hueco real y re-ajuste automático en resize.
- **Estados automáticos**: el boot envuelve `KiuBridge` y refleja escuchar, hablar,
  wake word ("Palabra de activación"), generar/listo, detener, cargar/liberar modelo,
  descargar (con error/éxito), importar, recordatorios, temporizadores, manos libres
  y acciones de dispositivo.
- **Capa de compatibilidad**: `app.js`/`tools.js`/`brain.js` siguen llamando la API
  vieja (`set('work')`, `flash('error')`, `state()==='speak'`, `pick(texto)`,
  `mount()`) y se traduce al mapa nuevo — cero cambios invasivos en app.js.
- **RAG conectado**: indexar un documento muestra "Indexando" y luego "RAG activo";
  apagar RAG muestra "RAG apagado".
- Mapa interactivo: `docs/kiu-estados.html`.

## v2.7.1 — revisión de errores (post tanda 8)
- **Seguridad** `MainActivity.jsStr`: el escape manual dejaba `\\"` (cerraba el string JS). Con `MainActivity`
  exported, el extra `cmd` de un Intent permitía inyectar JS con acceso a `KiuBridge`. Ahora usa `JSONObject.quote`.
- **Seguridad** `KiuApiProxy.allowed()`: `http://10.evil.com` / `192.168.evil.com` pasaban como LAN. Ahora IPv4 literal real.
- **Seguridad** `KiuApiProxy`: las redirecciones reenviaban `Authorization` a otro host. Ahora se siguen a mano (máx 3),
  se revalida cada destino y la clave `{{key:}}` no se envía si cambia el host.
- **Compilación** `KiuApiProxy`: `JSONObject.opt(name, "")` no existe en Android → `optString`.
- **Recordatorios** `brain.parseWhen`: "9 de la mañana" daba *mañana*; "12 de la noche" = mediodía; "esta noche a las 10" = 10:00;
  "1 hora y media" = 1 hora; "9 menos cuarto" = 9:00; "en media hora" no se entendía.
- **UI** `timeUntil` mostraba "en 0 min"/"en 29 min" (floor → ceil). Test inestable corregido.
- **UI** botón Copiar de bloques de código copiaba entidades HTML (`&amp;&amp;`).
- Tests: 85 → 88.

## v2.7.2 — mejoras de la revisión
- **WebView**: `onPermissionRequest` ya no concede todo; solo audio y solo desde el origen propio.
- **Recordatorios**: tras reiniciar o tener la app cerrada, los vencidos hace <48 h avisan "(Perdido) …" en vez de borrarse en silencio.
- **Descargas** (`KiuDlTask`): un `.part` completo devolvía HTTP 416 y se atascaba para siempre → ahora se verifica y finaliza;
  si el servidor ignora el Range se trunca el `.part`; `path` solo se fija si el SHA-256 pasa; campos de estado `volatile`.
- **kiu-secure.js**: `fetch(new Request(...))` por el proxy conserva método, headers y body; la respuesta ahora tiene `arrayBuffer()`/`blob()`.
- **Markdown**: el código en línea se aparta antes de procesar negrita, cursiva y enlaces.
- `Alarms.cancel` sin sobreescritura inútil; User-Agent del proxy actualizado.
- Tests: 88 → 89.

## v2.7.3 — JNI, importación, wake word, notificaciones
- **JNI** `kiullama_jni.cpp`:
  - `genStatus.done` era `toks > 0` (true desde el 1.er token): con el push cortado >1,3 s (modelos ≤0,8 tok/s) el JS abortaba la
    generación a medias. Ahora `done` usa un flag real `g_running` (RAII en `generate`).
  - `NewStringUTF` con UTF-8 parcial/emojis de 4 bytes (modified-UTF-8 inválido → abort con CheckJNI / texto corrupto): helper
    `mk_jstring` recorta la cola incompleta y construye el String por bytes.
  - Con `n_predict` ≥ ~ctx el prompt se recortaba a 16 tokens: la reserva para la respuesta se limita a ctx/4.
  - El context shift conservaba solo 16 tokens (perdía el system prompt): ahora conserva hasta 256 (¼ de la posición).
  - Piezas de token >192 bytes se perdían (`n<0`): se reintenta con buffer mayor.
- **KiuImport**: valida magic GGUF, cierra+sync antes de renombrar, borra el `.part` si falla, `begin()` atómico (doble toque).
- **KiuService (wake word)**: el comando se entregaba con el resultado *parcial* (truncado) y otra vez con el final → doble ejecución.
  Ahora solo actúa con el final; `wakeDeliver` tiene antirrebote de 4 s. Reinicio tras swipe con `getForegroundService` (Android 8+).
- **MorningReceiver** usaba el ID 2001 de la notificación fija del servicio de voz y la pisaba → ahora 2002.
- **BootReceiver** también atiende `MY_PACKAGE_REPLACED` (actualizar la app borra las alarmas) y `TIME_SET`/`TIMEZONE_CHANGED`.
- **Contraseñas**: `genPass(len, noSymbols)`; sin símbolos la clave salía más corta (índice 0–26 sobre 24 letras) y con `Math.random()`.
- Tests: 89 → 90.

## v2.7.4 — ideas pendientes
- **Seguridad del prompt**: `Kiu.defang()` neutraliza tokens de control (`<|im_start|>`, `<start_of_turn>`, `[INST]`, `<s>`…) en el
  contenido de usuario/RAG/web; las plantillas de `fmt()` quedan intactas. El tokenizador usa `parse_special=true`, así que antes
  un documento o una web podía abrir turnos "system" falsos.
- **Sampler**: penalización de repetición (últimos 64 tokens, ×1.1). *Verificar la firma de 4 argumentos contra tu `vendor/llama.cpp`.*
- **RAM**: `loadModel` estima el KV cache y baja el contexto (mitades, mínimo 512) si no entra en `MemAvailable`; `loadProgress` incluye `ctx`.
- **Importación cancelable**: `importCancel()` (puente) + toque en el estado "Importando…" con confirmación; borra el `.part`.
- **RAG**: notas de ≥12 caracteres (antes 40) y ids de documento únicos (dos archivos en el mismo ms chocaban).
- **Calculadora**: `%` es porcentaje (`200+10%`=220, `50%`=0,5) en lugar de módulo. `KiuTools.calcEval` expuesto para tests.
- Tests: 90 → 93 (nuevo `tools.test.mjs`).

## [2.13.3] — mantenimiento de CI (2026-10-24)

- La auditoría `scripts/bridge_audit.py` ahora devuelve código de error si detecta llamadas JS→Java inexistentes, eventos Java→JS sin handler o métodos públicos usados sin `@JavascriptInterface`.
- El workflow de GitHub Actions ejecuta esa auditoría junto con la suite de pruebas antes de compilar el APK.
- No se cambia el número de versión de la aplicación: esta entrega no completa el plan v2.14.0.
