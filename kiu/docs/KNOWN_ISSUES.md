# Pendientes y mejoras sugeridas

## Resueltas
- [x] **El agente no podía leer la memoria del usuario** (2.14.2) → `remember` escribía y ninguna herramienta leía: lo único que consultaba lo guardado eran las regex de `brain.js`, y un modelo no escribe regex. Ahora `js/app/memoria.js` tiene `search()` real y el agente tiene la herramienta `recall`, más `manage_task`, `manage_alarm` y `create_calendar_event`. Diagnóstico completo en `docs/AGENTE_UTIL.md`. (2026-10)
- [x] **El modelo que elegía la herramienta no sabía quién era el usuario** (2.14.2) → el prompt de decisión (`kiu-agente.js`) no inyectaba nombre, tareas ni recuerdos: esa información solo estaba en el prompt de chat (`app-ui.js → kiuMsgs`). Ahora el prompt lleva `PERFIL DEL USUARIO`, acotado a ~240 caracteres porque se paga en cada decisión. (2026-10)
- [x] **El enum de `device_action` anunciaba capacidades inexistentes** (2.14.2) → `maps`, `web` y `youtube` caían en la cola de `brain.js` con un texto que no reconoce, así que la herramienta contestaba siempre "no pude cumplir" y el modelo perdía un paso. Los tres tienen camino propio; la búsqueda web quedó en una función compartida con `web_search`. (2026-10)
- [x] **El riesgo de las herramientas era único** (2.14.2) → leer la batería o listar tareas terminaba en un "¿Lo hago?" que no tiene sentido. El riesgo ahora se calcula con los argumentos (`riskFor`). (2026-10)
- [x] **La pestaña "Preferencias" estaba siempre vacía** (2.14.2) → el bucket `prefs` existía y `addPref` estaba definido, pero nada lo escribía. "Prefiero el mate amargo" ahora llena las preferencias. (2026-10)
- [x] **No usaba los motores locales** (2.13.0) → con el modelo fuera de memoria o el router apagado, el envío pedía reenviar el mensaje o contestaba «no tengo un modelo». `Kiu.whenReady` carga el modelo y continúa solo; `tryTargets` espera si el motor está ocupado. **Pendiente de confirmar en dispositivo.**
- [x] **Gramática GBNF del agente inválida** (2.13.0) → nombres con `_`, `}` suelta y JSON sin comillas; llama.cpp la descartaba. Reescrita.
- [x] **Versión sin subir** (2.13.0) → nueve tests fijaban `2.12.7`/`81` exactos; ahora solo exigen que no retroceda.
- [x] **El motor nativo compilaba contra `llama.cpp` de `master`** → el CI y
      `vendor_llama.sh` clonaban la punta de la rama: un commit de upstream podía romper
      el build sin cambiar nada del repo y no había forma de volver atrás (el clon local
      ya lo había pisado). Ahora hay pin (v0.7.0 + SHA) en `vendor_llama.sh`, se trae el
      tag y se verifica el commit, y el CI lo muestra en el resumen del run. **Pendiente
      de confirmar**: que el JNI actual compile contra v0.7.0. (2026-10)
- [x] **Kiu no podía leer la agenda** → `MainActivity.calendarList()` (mismo molde que
      `contacts()`), permiso `READ_CALENDAR` solo lectura, ventana temporal o por texto contra
      `CalendarContract.Instances`, e intents en `KiuBrain` para "¿qué tengo mañana?" y
      "¿tengo dentista?". El resumen matutino incluye los eventos del día. (2026-10)
- [x] **La palabra de activación y la conversación continua no funcionaban** → eran el mismo
      bug: al manifiesto le faltaba el `<queries>` de `android.speech.RecognitionService`, así
      que desde Android 11 `SpeechRecognizer.isRecognitionAvailable()` devolvía `false` siempre
      y ninguna de las dos rutas llegaba a escuchar. Agregado (junto con `TTS_SERVICE`).
      Además la wake word local Vosk detectaba «Kiu» y solo encendía un toast: ahora abre el
      micrófono del comando; y el bucle de la conversación moría al primer turno si lo había
      abierto la wake word en vez del botón del micro. Detalle en `CHANGELOG.md` 2.8.1. (2026-10)
- [x] **El avatar del chat se dibujaba encima del título** → `#chat-avatar` (y `hero-avatar`,
      `profile-avatar`) no tenían caja: las clases que los dimensionaban eran del robot viejo
      (`avatar.js`, borrado en 2.7.0) y el `--kav-s` que declaraban ya no lo leía nadie, así
      que el div quedaba en 0x0 y el bot se pintaba al tamaño de emergencia por encima. Ahora
      el hueco tiene caja y el CSS es la única fuente del tamaño. (2026-10)
- [x] **Iconos adaptativos duplicados** → en las 5 densidades convivían `ic_launcher_bg.png`/
      `ic_launcher_fg.png` (apktool) con `ic_launcher_background.png`/`ic_launcher_foreground.png`
      (los que usan los XML de `mipmap-anydpi-v26`). Borrado el par sin referencias (−432 KB) y el
      color huérfano `ic_launcher_bg` de `colors.xml`. (2026-10)
- [x] **Logos pesados del WebView** → `logo/logo_full/logo_round` (915 KB de PNG) convertidos a
      WebP q82: 56 KB en total (−94 %). Pautas en `docs/AVATAR_Y_LOGO.md`. (2026-10)
- [x] **Binarios .so dentro de Git** → `app/lib/arm64-v8a/` (6,9 MB) salió del repositorio: los
      `.so` viven en `app/src/main/jniLibs/<ABI>/` (estándar Gradle) ignorados por `.gitignore`;
      el build los regenera desde fuente o los reutiliza como precompiladas. (2026-10)
- [x] **Inyección nativa manual** → el CMake deja las `.so` compiladas en
      `app/src/main/jniLibs/${ANDROID_ABI}` y `vendor_llama.sh` migra las de `app/lib/` viejo;
      `abiFilters` automáticos según las ABIs presentes; Gradle corta con receta si no hay motor.
      (2026-10)
- [x] **Modelo GGUF retenido en RAM al salir** → `MainActivity.onDestroy()` (solo si
      `isFinishing()`: la rotación no recarga) y `KiuService.onDestroy()` (solo si ya no hay
      actividad viva) llaman a `KiuGenJob.freeAsync()` (stopGen + freeModel en hilo propio).
      El C++ ya era correcto: `free_locked()` idempotente bajo mutex y `generate()` libera
      batch/sampler/buffer en todos sus caminos. (2026-10)
- [x] **License ausente** → agregada `LICENSE` (MIT). (2026-10)
- [x] **CI sin releases** → el workflow ahora publica Release automática al pushear un tag `v*`,
      con los APK debug y release del build Gradle. (2026-10)
- [x] **Tests de la lógica JS** → `tests/brain.test.mjs` (13 tests, `node --test`) cubre
      normalización, matemática, fechas y fallback. Corren en CI. (2026-10)
- [x] **Cleartext abierto** → el build usa `network_security_config.xml` (HTTPS obligatorio,
      excepciones solo para localhost/emulador y las IPs LAN que agregues a mano). (2026-10)
- [x] **Reanudación de descargas de modelos** → reescrito `KiuDlTask.run()` con HTTP Range
      (retoma descargas cortadas) — parte de la migración Gradle. (2026-10)
- [x] **Palabra de activación liviana** → implementada con Vosk offline (`WakeWordEngine.java`),
      ver `docs/BRIDGE_API.md`. (2026-10)
- [x] **`setAllowUniversalAccessFromFileURLs` activo** → la UI ahora se sirve por
      `https://appassets.androidplatform.net` con `WebViewAssetLoader` (`androidx.webkit`) y el
      permiso universal está apagado; navegaciones `file://` bloqueadas. Migración de datos con
      ferry único (`js/kiu-migrate.js`, `kiuFerryPut/Get/Clear`). (2026-10, tanda 3)
- [x] **Claves API dentro del WebView** → bóveda Java con Keystore (`kiuKeys*`, prefs `kiu_keys`
      cifradas con `KiuCrypto`); `provHeaders()` manda `{{key:proveedor}}` y `KiuApiProxy.java`
      inyecta la clave al abrir el socket. Las llamadas de nube y `http://` local viajan por el
      proxy Java (`js/kiu-secure.js` intercepta `fetch`). (2026-10, tanda 3)
- [x] **Streaming por sondeo** → push real de tokens: `kiullama_jni.cpp` → `KiuStream.onToken` →
      `KiuJsPost` → `window.kiuPush`; el sondeo de `kiuGenStatus` queda como respaldo y se
      suspende mientras el push está vivo. (2026-10, tanda 3)
- [x] **`app.js` monolítico (~5.500 líneas)** → dividido en 6 módulos bajo `js/app/`
      (env/state/catalog/models/motor/app-ui) con carga en orden y símbolos por `window`;
      `tests/boot.test.mjs` arranca todo en una VM y caza `ReferenceError` cross-módulo.
      (2026-10, tanda 4)
- [x] **RAG limitado a 0,8 MB en localStorage** → `rag.js` v3 sobre IndexedDB (tope ~8 MB),
      tf precalculado, ranking BM25, migración única del formato viejo y fallback a
      localStorage. (2026-10, tanda 4)
- [x] **Verificación SHA-256 de modelos** → `KiuDlTask` hashea en streaming y verifica contra
      el hash oficial de Hugging Face incluido en el catálogo (13/13); `KiuImport` calcula el
      SHA del GGUF importado. (2026-10, tanda 4)
- [x] **Exportar/importar datos** → copia completa vía SAF (`kiuDataExport`/`kiuDataImport`,
      `window.kiuDataRestore`): ajustes sin claves, memoria, conversaciones, alarmas, KB, uso
      y RAG. Botones en Ajustes · Copias de seguridad. (2026-10, tanda 4)
- [x] **Skills instalables** → `js/skills.js` con manifest JSON declarativo (intents + respuestas
      con variables, sin código ejecutable), instalación por texto o archivo SAF (7104), ejemplos
      incorporados, activar/pausar/borrar en Ajustes → Skills. (2026-10, tanda 5)
- [x] **Bucle ReAct de pocos pasos** → `js/react.js` parte pedidos multi-parte y los resuelve
      con herramientas locales (cerebro + RAG), máx 4 pasos, `handled:false` honesto si nada se
      puede. (2026-10, tanda 5)
- [x] **Resumen matutino programado** → `MorningReceiver.java` con datos frescos (fecha,
      recordatorios de 36 h, batería, tip), notificación BigText + copia al chat, reagenda
      diaria y al reiniciar; UI en Ajustes. (2026-10, tanda 5)
- [x] **PendingIntents sin FLAG_IMMUTABLE** → `Alarms.pending()` y `ReminderReceiver` crasheaban
      en Android 12+ con target 34 (rompía TODAS las alarmas). Corregido. (2026-10, tanda 5)
- [x] **Estructura mezclada apktool + Gradle** → retirada la estructura vieja completa:
      `app/smali*/`, `app/res/` (fusionada a `app/src/main/res/` con themes/colors intactos),
      `app/AndroidManifest.xml`, `app/apktool.yml`, `app/assets/` (movida a
      `app/src/main/assets/`), `reference-java/`, `scripts/repack.py` y `scripts/get-tools.sh`.
      `scripts/build.sh` y el CI compilan directo con `gradlew`; release firmado con
      `signingConfig` de Gradle (ya no uber-apk-signer). (2026-10, v2.6.0)
- [x] **`KiuImport.java` sin las validaciones del original** → paridad completa con el smali:
      sanitización estricta del nombre (`[^A-Za-z0-9._-]`→`_`), rechazo de no-`.gguf`, chequeo
      de espacio libre (margen 50 MB), escritura a `.part` + renombrado final y borrado del
      `.part` si falla. Conserva SHA-256 y progreso. (2026-10, v2.6.0)
- [x] **`avatar.js` legacy + doble ruta de inicialización** → el robot viejo de 13 estados
      (12,9 KB que nadie cargaba) fue eliminado; `kiu-avatar-boot.js` quedó como inicialización
      única: monta solo los huecos `[data-avatar]`/`[data-avatar-mini]` del HTML, sin loader
      dinámico, sin reemplazo de avatares ajenos y sin `MutationObserver`. Compatibilidad de
      nombres de estados intacta vía `KiuAvatar`. (2026-10, v2.7.0)
- [x] **RAG congelaba la UI con documentos grandes** → la fragmentación de texto y el cálculo
      de similitud (BM25) corren en un Web Worker (`js/rag-worker.js`, núcleo compartido con el
      hilo principal vía `KiuRagCore`): `addText` envía el texto crudo al worker y el chat
      inyecta contexto con `RAG.ctxFor`/`searchAsync` (guardia de 2 s + fallback síncrono).
      (2026-10, v2.7.0)
- [x] **Descontrato react.js ↔ rag.js** → el paso "docs" del ReAct llamaba `RAG.search()`
      esperando un array de `{doc, txt}`, pero `search` devuelve un STRING para inyectar al
      prompt: citaba caracteres sueltos. Ahora usa `RAG.hits()` (estructurado) y hay un test
      que documenta el error. (2026-10, v2.7.0)
- [x] **Lista de hosts de nube en `kiu-secure.js`** → heurística general de API: HTTPS distinto
      del origen con ruta tipo API (`/v1`, `/v1beta`, `/api`, `/chat/completions`, `/messages`,
      `/embeddings`…) va por el proxy de Java sin editar la lista; los hosts conocidos siguen
      como atajo. Cubierto por tests. (2026-10, v2.7.0)
- [x] **`llama_backend_free()` nunca se llamaba** → `freeModel()` libera el backend global de
      llama.cpp; `loadModel()` lo re-inicializa solo (`g_backend_ready`), así que recargar un
      modelo después de liberar sigue funcionando. (2026-10, v2.7.0)
- [x] **CI con YAML roto y sin orden garantizado** → el filtro `branches:` estaba mal escrito
      desde la tanda 6; ahora `[main, 'mejoras/*']`, el build depende de los tests
      (`needs: tests`) y el flujo es tests → `get-tools.sh` → `vendor_llama.sh` → APK firmado.
      `scripts/get-tools.sh` provisiona JDK/SDK/NDK/cmake de forma idempotente (CI y local).
      (2026-10, v2.7.0)
- [x] **Módulos del split sin tests propios** → suite de 50 a 85: `app-core.test.mjs` (env,
      state, catalog, models, motor), `i18n.test.mjs`, `migrate.test.mjs`, `rag-worker.test.mjs`
      (núcleo + protocolo con FakeWorker). Arnés compartido en `tests/helpers.mjs`.
      (2026-10, v2.7.0)

- [x] **Inyección de tokens especiales** → `Kiu.defang()` parte `<|...|>`, `<start_of_turn>`, `[INST]`… dentro del
      contenido (usuario, RAG, web) antes de armar la plantilla. (v2.7.4)
- [x] **Sin penalización de repetición** → `llama_sampler_init_penalties(64, 1.1)`. (v2.7.4)
- [x] **OOM por KV cache** → el JNI reduce el contexto si no entra en MemAvailable; `loadProgress` informa `ctx`. (v2.7.4)
- [x] **Importación no cancelable**, **notas cortas descartadas por el RAG**, **calculadora con % = módulo**. (v2.7.4)

## Técnicos
- [ ] **El motor corre en el mismo proceso que la app** (2.14.6) → los pesos del modelo, el
      contexto KV y el WebView comparten la RAM del teléfono: cuando eso se desborda, Android mata
      la app entera y el usuario ve un cierre forzado sin explicación. En 2.14.6 se puso una guarda
      de memoria (no se genera por debajo de 300 MB libres y se corta la generación si la RAM se
      hunde), pero el arreglo de fondo es correr el motor en un proceso aparte
      (`android:process="kiu-engine"` para el servicio) para que el WebView pueda morir sin
      matar al motor. Es un cambio grande y no se puede probar sin un teléfono real.
- [x] **La voz sonaba robótica** (2.14.6) → se prefería la voz local del sistema porque las de red
      necesitan internet y, si fallaban, Kiu quedaba mudo. Como el TTS ya reintenta con una local
      si la de red falla, ahora se usa la que suena humana (network/neural) y se cae a la local sin
      internet. Lo que se habla también va limpio: sin URLs ni símbolos sueltos.
- [x] **Cuatro carreras del motor dejaban al agente en "motor ocupado"** (2.14.2) → el watchdog de
      10 minutos mataba la generación siguiente; un evento de carga tardío liberaba el flag de una
      generación en vuelo; un push tardío cerraba la generación siguiente con el texto viejo; y el
      puente se capturaba una sola vez al cargar el JS (si no estaba, moría en silencio para
      siempre). Las cuatro arregladas y con tests de regresión (`tests/motor-carrera-v2142.test.mjs`).
- [x] **El comando de la palabra de activación se perdía en un arranque en frío** (2.14.2) → si la
      actividad existía pero la página todavía no estaba lista, `evaluateJavascript` no ejecutaba
      nada y el comando se descartaba en silencio. Ahora queda en cola hasta `pageReady()`.
- [ ] **La palabra de activación puede ejecutar el comando DOS veces** → con la app abierta, el
      servicio entrega el comando y el micrófono de la app también lo escucha: los dos mandan el
      mensaje. El antirrebote (`wakeDup`) solo cubre la vía del servicio. Habría que coordinar
      que, cuando la app toma el micrófono, el servicio deje de entregar.
- [ ] **El manifiesto compacto todavía no dice QUÉ hace cada herramienta** (2.14.2) → ya lleva
      los valores de los enums (el vocabulario que el modelo tiene que usar), pero no el verbo
      ("poné una alarma", "creá una tarea"). Son ~40 tokens más por decisión y no hay medición
      que diga si compensan. Ver `docs/AGENTE_UTIL.md` §2.5.
- [x] **Un turno con herramientas podía costar dos generaciones** (2.14.2) → la redacción final
      con el modelo se saltea cuando el resultado es único y corto: el texto de la herramienta
      ES la respuesta. Con varios resultados, textos largos o listas, se sigue redactando
      (`componer: 'siempre'` la fuerza).
- [x] **Las observaciones del bucle no decían qué había pasado** (2.14.2) → el modelo recibía
      el texto pelado y no distinguía "no encontré nada" de "el dispositivo falló". Ahora son
      estructuradas: `[manage_task ok] …` / `[manage_task error] …`.
- [x] **No había evaluación del agente** (2.14.2) → ahora existe el arnés: `tests/evals/` con 28
      pedidos reales (la herramienta esperada, los argumentos que tiene que producir y un modelo
      enchufable), midiendo acierto de herramienta, pasos hasta el éxito, no-op y latencia, con
      umbrales que hacen fallar el arnés si no se cumplen. Corre sin red en el CI y contra un
      modelo real con `node tests/evals/run.mjs`.
- [ ] **El arnés todavía no corrió contra un GGUF real** → falta la medición de acierto de un
      modelo chico de verdad: necesita un teléfono o una máquina con `llama-server`. El arnés
      está listo; los números no están.
- [ ] **La memoria no tiene ciclo de vida** → no hay forma de corregir u olvidar un hecho
      aprendido desde el chat (solo desde la UI), ni de que el agente actualice un recuerdo
      viejo ("ya no es el martes, es el jueves").
- [ ] Solo existe la librería `arm64-v8a` precompilada: sin `armeabi-v7a` el motor interno no corre
      en teléfonos de 32 bits (el build desde fuente ya incluye `arm64-v8a` + `x86_64`).
- [ ] El historial de Git aún contiene los blobs de las `.so` viejas (quitarlas del HEAD no
      reescribe el pasado): si se publica el repo conviene `git filter-repo` o empezar de un
      clone limpio; el ZIP de entregas ya no las incluye.
- [ ] `kiullama_jni.cpp` ya libera el backend (`llama_backend_free` en `freeModel`, tanda 8);
      queda afinar la historia de blobs viejos en Git (ver arriba).
- [x] **El bot se movía raro: dos capas peleando por su estado** → `kiu-avatar-boot.js` envolvía
      `window.KiuBridge` con un `Proxy` que adivinaba el estado mirando cada llamada, mientras
      `app-ui`/`motor`/`models` llamaban `KiuAvatar.set()` por su cuenta. Nuevo
      `js/kiu-estados.js`: un solo controlador por capas con prioridad, eventos explícitos desde
      `Kiu.ask`/`Mod.start`/las alarmas, y fuera el Proxy. Se fueron «Respuesta lista» durante la
      generación, «Cargado» en cada mensaje, los alias mal mapeados, el listener global de
      `input` y los timers sueltos. (2026-10, v2.8.0)
- [x] **Wake word tras reinicio en Android 14** → desde `BOOT_COMPLETED` no se puede arrancar un
      servicio con micrófono; `BootReceiver` lo intenta y, si el sistema lo bloquea, manda una
      notificación que lleva a la app para reactivarlo. (2026-10, v2.8.0)
- [x] **Atar cada clave `{{key:x}}` a los hosts de su proveedor** → `KiuApiProxy` solo inyecta el
      placeholder si el host de destino pertenece a ese proveedor; un host de un proveedor
      conocido nunca recibe la clave de otro. (2026-10, v2.8.0)
- [x] **Alarmas exactas en Android 14** → `canExactAlarms()` se sigue verificando al agendar
      (con fallback no exacto) y ahora además sale un diálogo que explica el retraso y lleva a
      Ajustes del sistema; se muestra el estado «Sin permiso de alarma exacta». (2026-10, v2.8.0)
- [ ] La pastilla de estado del chat se arma con una tabla JS literal en `app-ui.js`: con el
      i18n terminado conviene moverla a `i18n.js` junto con el resto de las cadenas.
- [ ] El i18n cubre el chrome (navegación, inicio, ajustes, botones); el texto dinámico de
      `app-ui.js` y las respuestas de `brain.js` siguen en español: falta extraer esas cadenas.
- [x] **El modelo de la palabra de activación era manual** (39 MB por `adb`, sin
      pantalla y sin aviso) → `KiuVoskInstall` + `ZipInstall`: se baja desde el
      diagnóstico, con SHA fijado, zip-slip cortado y comprobación de que el modelo
      quedó donde el motor lo busca. (2026-10, v2.9.8)
- [ ] **La capa Java casi no tiene tests.** 7.050 líneas y `app/src/test` no existe. Los tres
      bugs de audio de la tanda 16 estaban todos ahí, y ninguno lo vio un test: no
      porque no se probara, sino porque no había cómo. Medidas: `Backoff.java` es
      lógica pura sin Android (testeable), `tests/java-estructura.test.mjs` balancea
      llaves y paréntesis de todo el Java. (2026-10, v2.9.6)
- [x] **El descargador de modelos no tenía ni un test** (2.14.2) → `KiuDlTask` es Java puro
      y ahora tiene un arnés de ejecución real (`KiuDlTaskHarness`): magic de GGUF, SHA-256
      real, borrado cuando el hash no coincide y rechazo de lo que no se puede verificar,
      con control negativo. El arnés encontró un bug: si el hash no se podía calcular, la
      descarga instalaba el archivo como si estuviera bien. (2026-10)
- [ ] **Faltan arneses para el resto de la capa Java.** Hoy hay 7 clases sin imports de
      Android (1.033 líneas) y 2 con arnés (`Backoff`, `KiuDlTask`). Sin arnés siguen
      `KiuVoskInstall` (258), `KiuGenJob` (172), `ZipInstall` (174) y `KiuDlTask` (236, ya
      cubierto a medias). Y las 6.000 líneas con Android (`MainActivity` con 3.127) siguen
      sin poder probarse sin emulador. El camino que funciona es: extraer la lógica pura
      a clases sin Android y arnésearlas. (2026-10)
- [ ] Los tests de arranque (`tests/boot.test.mjs` + `helpers.mjs`) usan un DOM falso: cubren
      el cableado cross-módulo, no el render real (para eso hay que probar en el
      teléfono/emulador).
- [ ] El flujo de búsqueda web (`app-ui` → `msgsOverride`) arma su propio contexto y no pasa
      por el worker de RAG: aceptable (la inyección web ya es async), pero si se suma RAG a esa
      respuesta conviene reusar `ctxFor`.
- [ ] Los skills v1 son declarativos (intents + respuestas): soportan `accion:` delegada al
      cerebro, pero un sandbox JS con API acotada (toast/http/memoria) es el paso siguiente.
- [ ] El ReAct v1 usa reglas + cerebro/RAG: enchufarlo al modelo local (o a un proveedor) para
      planificar pasos que las reglas no detectan.
- [ ] El resumen matutino usa notificación; con pantalla desbloqueada podría además hablar
      (TTS) si la voz está activada.

## Funciones sugeridas
- Marketplace remoto de skills (un JSON indexado en GitHub Pages + verificación SHA) sobre el
  sistema de skills v1 ya instalable.
- Respuestas por voz manos libres (la wake word ya detecta "Kiu"; falta el flujo de conversación
  continuo después del saludo).
- Modo visión con `mmproj` (el wrapper JNI ya está preparado para crecer, falta la parte multimodal
  de llama.cpp).
