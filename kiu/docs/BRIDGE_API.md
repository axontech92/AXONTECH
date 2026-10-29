# API del puente `KiuBridge` (JS → Java)

Se llama desde JS como `window.KiuBridge.metodo(...)`. Definido en `MainActivity$Bridge`.
Los valores complejos se devuelven como **JSON en texto**.

## Modelos locales
| Método | Descripción |
|---|---|
| `dlStart(url, archivo, extra)` → JSON | Inicia descarga; devuelve `{id, st, name, path}` |
| `dlStatus(id)` → JSON | `{id, st, got, total, err, path}` |
| `dlCancel(id)` / `dlDel(archivo)` / `dlFree()` / `dlList()` | Cancelar, borrar, espacio libre, listar archivos |
| `importCancel()` | (v2.7.4) Cancela la importación de `.gguf` en curso; `impStatus()` pasa a `{st:"cancelled"}` y se borra el `.part` |
| `importModel()` / `impStatus()` → JSON | Abre el selector de archivos e importa un `.gguf`; `{st:idle/run/done/err, got, total, name, err}` |
| `kiuAvailable()` | ¿El teléfono soporta el motor interno? |
| `kiuLoad(ruta, nCtx, hilos)` / `kiuLoadProgress()` / `kiuIsLoaded()` / `kiuFree()` | Cargar y liberar el modelo |
| `kiuGen(prompt, maxTokens, temp)` / `kiuGenStatus()` / `kiuGenStop()` / `kiuResetBusy()` | Generar texto (por sondeo) |
| `sysInfo()` → JSON | RAM, CPU, etc. |

## Voz
`speak`, `stopSpeak`, `setRate`, `setPitch`, `setVoiceName`, `listVoices`, `setHandsFree`,
`listen`, `cancelListen`, `startWake`, `stopWake`, `wakeState`.

### Wake word 100% local (Vosk, offline)
| Método | Descripción |
|---|---|
| `kiuWWStart()` → bool | Activa la escucha local y guarda la preferencia `wwLocal`; false si falta el modelo o el mic |
| `kiuWWStop()` | Detiene la escucha local y apaga la preferencia |
| `kiuWWState()` → JSON | `{st: idle/load/run/pause, present: bool, err, path}` |
| — (automático) | `startWake()` elige el engine local si el modelo está instalado, si no el servicio de Google. Al detectar dispara `nexoWakeHit()` **y abre el micrófono del comando** (`nexoOnVoice`) |

> El modelo (`vosk-model-small-es-0.42`, ~40 MB) va en
> `files/models/vosk-es-small/` (se baja con el gestor de descargas y se
> descomprime ahí; presencia detectada por `final.mdl`).
>
> **v2.8.1**: que el modelo esté en la carpeta ya alcanza (antes hacía falta la
> preferencia `wwLocal`, que solo ponía `kiuWWStart()` y la UI nunca llamaba: el
> motor local era código muerto). `wakeState()` ahora pregunta a los dos motores, y
> al detectar «Kiu» se abre el micrófono del comando en vez de mostrar un toast y
> quedarse ahí. Hay un solo micro: `MainActivity.COMMAND_BUSY` + `pause()/resume()`
> hacen que Vosk ceda el paso al reconocedor del comando.

### Eventos Java → JS de voz
| Evento | Cuándo |
|---|---|
| `nexoWakeHit()` | se detectó la palabra de activación (y se abre el micro del comando) |
| `nexoWakeCmd(texto)` | comando completo con la palabra y el pedido |
| `nexoWakeState(on)` | la palabra de activación se prendió o se apagó |
| `nexoWakeError(msg)` | (v2.8.1) no se pudo arrancar (sin modelo, micro tomado, sin servicio de voz) |
| `nexoOnVoice(texto)` | transcripción del micrófono de la conversación |
| `nexoListenStart()` / `nexoListenEnd()` | el micrófono se abre y se cierra |
| `nexoVoicePartial(texto)` / `nexoVoiceError(código)` | parcial y error de la transcripción |
| `nexoTtsStart()` / `nexoTtsDone()` | el TTS arranca y termina de verdad |

> **v2.8.1 —REQUIRED**: el manifiesto declara
> `<queries><intent><action android:name="android.speech.RecognitionService"/></intent></queries>`
> (fuera de `<application>`). Sin eso, desde Android 11
> `SpeechRecognizer.isRecognitionAvailable()` devuelve `false` siempre y no hay ni
> palabra de activación ni conversación continua. Lo fija `tests/voz.test.mjs`.

## Acciones del dispositivo
`dial`, `sms`, `waChat`, `email`, `maps`, `ytSearch`, `webSearch`, `camera`, `torch`, `share`,
`openUrl`, `openApp`, `openSettings`, `setAlarmDevice`, `setTimerDevice`, `vibrate`, `keepOn`,
`bright`, `toast`, `requestPerm`.

### Calendario (v2.9.0)
| Método | Descripción |
|---|---|
| `calendarList(query, desdeMs, hastaMs)` → JSON | Eventos en la ventana, o por texto en título/lugar. `[{t: título, b: begin, e: end, w: lugar}]`. Devuelve `"NEED_PERM"` si falta `READ_CALENDAR`, `"[]"` ante cualquier fallo. Tope 40 eventos / 60 días |
| `addCalendarEvent(titulo, ms)` | Abre el calendario del sistema con el evento listo (no escribe directo: no se pide `WRITE_CALENDAR`) |
| `requestPerm('calendar')` | Pide `READ_CALENDAR`; responde `nexoPerm('calendar', ok)` |

Solo lectura. `CalendarContract.Instances` (no `Events`) a propósito: `Instances` ya expande
la recurrencia, así que "todos los lunes" aparece todos los lunes.

### Contactos y calendario
| Método | Descripción |
|---|---|
| `contacts(query)` → JSON \| `"NEED_PERM"` | Busca hasta 12 contactos por nombre o número
  (`[{name, num}]`). Si falta el permiso `READ_CONTACTS` devuelve `NEED_PERM`; se pide con
  `requestPerm('contacts')`. |
| `addCalendarEvent(título, beginTimeMs)` → bool | Abre la app de Calendario con un evento
  de 1 hora pre-cargado (`ACTION_INSERT`). `false` si no hay app de calendario. |

## Recordatorios y temporizadores
`setReminder(id, texto, momentoMs)`, `cancelReminder(id)`, `pendingReminders()`,
`canExactAlarms()`, `openExactAlarmSettings()`, `startTimerNative(seg, etiqueta)`,
`cancelTimerNative()`.

| Método | Descripción |
|---|---|
| `kiuTakeRescheduled()` → int | **v2.8.0.** Cuántas alarmas rearmó `BootReceiver` al reiniciar o actualizar la app (Android borra todas), y consume el contador: al leerlo vuelve a 0. La UI lo usa una sola vez para el estado «Reprogramado al reiniciar». Sin esto el valor se acumularía y el aviso se repetiría en cada apertura. |

## Seguridad v2.3 (sección 2)
* **Bóveda de claves** (Keystore, prefs `kiu_keys`): `kiuKeysSet(nombre, valor)`,
  `kiuKeysGet(nombre)`, `kiuKeysHas(nombre)`, `kiuKeysDel(nombre)`, `kiuKeysList()`.
  La clave en claro JAMÁS vuelve al JS: `kiuKeysList` da solo nombres + últimos 4.
* **Proxy HTTP(S)**: `kiuApiStart(id, método, url, headersJson, cuerpo)` →
  `kiuApiPoll(id)` (devuelve `{st:"run"}` / `{st:"done",code,ct,body}` / `{st:"err",msg}`)
  → `kiuApiStop(id)`. HTTPS siempre; `http://` solo a localhost/LAN privada; tope 8 MB.
  Los valores de headers admiten `{{key:nombre}}`: el proxy los reemplaza por la clave
  real de la bóveda antes de abrir el socket. Lo usa `js/kiu-secure.js` (shim de `fetch`).
  **v2.8.0**: el placeholder solo se sustituye si el host de destino pertenece a ese
  proveedor (`PROVIDER_HOSTS` en `KiuApiProxy`): un host de un proveedor conocido nunca
  recibe la clave de otro. El proveedor personalizado del usuario (`otro`) no tiene lista
  propia, así que se inyecta igual —la URL y la clave son suyas—, salvo que apunte a un
  host de un proveedor conocido.
* **Ferry de datos**: `kiuFerryPut(json)` (guarda y recarga en el origen seguro),
  `kiuFerryGet()`, `kiuFerryClear()`. Interno de `js/kiu-migrate.js`; no llamarlo a mano.
* **Streaming por push**: el nativo llama `KiuStream.onToken(parcial)` (internamente) y la
  WebView recibe `window.kiuPush('gen', {so: textoParcial})`. No es un método del puente:
  es un evento que la app inyecta (KiuJsPost).
* **Eventos Java → JS (v2.7, todos con guard `if(window.…)`)**: `window.kiuPush(ev, o)`
  (streaming), `window.kiuNativeDone(o)` (load/gen/free terminado),
  `window.kiuDataRestore(data)` (copia completa), `window.kiuSkillInstall(texto)` (skill por
  SAF), `window.kiuMorningSummary(texto)` (resumen matutino con la app abierta) y los
  `window.nexo*` de voz/wake (listen/TTS/permisos/temporizadores).
* **Eventos Java → JS de alarmas (v2.8.0)**: `ReminderReceiver` manda un broadcast interno
  (`com.kiu.agent.REMINDER_FIRED`) cuando una alarma suena; si la WebView está viva,
  `MainActivity` lo traduce a `window.nexoAlarmFired(titulo, id)` (estado «Disparado»).
  El reschedule de `BootReceiver` no es un evento: se consulta al abrir la app con
  `kiuTakeRescheduled()` (ver arriba), porque muchas veces el arranque ocurre sin WebView.

## Utilidades
`encSec(texto)` / `decSec(texto)` (cifrado Keystore), `version()`, `pageReady()`, `gc()`.

> Para agregar un método: en `app/src/main/java/com/kiu/agent/MainActivity.java`, inner class
> `Bridge`, con la anotación `@JavascriptInterface` y capturando `Throwable` para que un fallo
> nativo no cierre la app. (Hasta v2.5.x se editaba el smali de `MainActivity$Bridge`; el
> smali se eliminó con la migración completa a Gradle.)
>
> **Verificación automática (tanda 8):** `scripts/bridge_audit.py` cruza los métodos
> `@JavascriptInterface` de `MainActivity.java` contra todos los nombres que invoca el JS
> (`BR.x`, `bridge('x')`, `rawBridge('x')`, `B.x`, `KiuBridge.x`) y los eventos Java→JS
> (`window.kiuPush`, `window.kiuNativeDone`, `window.kiuDataRestore`,
> `window.kiuSkillInstall`, `window.kiuMorningSummary`). Salida vacía = contrato OK.

## Copia completa y verificación v2.4 (sección 3 / pendientes de la 1)

### Descargas con SHA-256
- `kiuStatus()` → JSON con el estado de voz, permisos, almacenamiento de claves y modelo sin conexión, para «Estado y diagnóstico» (v2.11.12). No incluye claves ni datos personales.
- `updStart(url, nombre, tamaño, sha256)` → ahora también recibe la huella SHA-256 publicada por GitHub; si no coincide, el APK se borra y se avisa.
- `notifyUpdate(titulo, texto)` → notificación «versión nueva disponible» (v2.11.8).
- `setBargeIn(bool)` → permite interrumpir a Kiu con la voz mientras habla (v2.11.8).
- `updStart(url, nombre, tamaño)` → baja el APK de una actualización (v2.11.3). Solo acepta URLs de
  `https://github.com/Criptobox/KIU/releases/download/`. Devuelve `{id, st, name, path}`; el progreso se
  consulta con `dlStatus(id)` y se cancela con `dlCancel(id)`. Si ya está bajado completo, devuelve `st:"done"`.
- `updInstall(ruta)` → abre el instalador de Android con el APK bajado. Devuelve `"ok"`, `"perm"` (falta
  permitir instalar desde Kiu; abre ese ajuste) o `"err:motivo"`.
- `dlStart2(url, nombre, auth, shaEsperado)` → igual que `dlStart`, pero Java verifica el
  SHA-256 del archivo completo al terminar (incluye el `.part` previo al reanudar). Si no
  coincide con el hash oficial del catálogo (Hugging Face), borra el archivo y devuelve
  `st:"err"` con mensaje de hash. `dlStatus(id)` ahora incluye `"sha256"` y `"verified"`.
- `impStatus()` ahora incluye `"sha256"`: el SHA del GGUF importado, para comparar contra
  el hash del repositorio de origen.

### Copia de seguridad completa vía SAF
- `kiuDataExport(json)` → abre `ACTION_CREATE_DOCUMENT` (`kiu-copia-YYYYMMDD-HHmm.json`)
  y escribe el JSON. Tope 30 MB. Devuelve `true` si se abrió el selector.
- `kiuDataImport()` → abre `ACTION_OPEN_DOCUMENT` de JSON y entrega el contenido a la UI
  vía `window.kiuDataRestore(data)` (KiuJsPost).
- Formato de la copia: `{app:'Kiu', v:3, settings, memoria, conversaciones, alarmas, kb,
  uso, rag:{v:3,on,docs,chunks}}`. Las claves API **no viajan** (quedan en el Keystore);
  `window.kiuDataRestore` re-arma las alarmas y restaura el RAG con `RAG.importAll`.

## Funciones nuevas v2.5 (sección 4)

### Skills instalables
- `kiuSkillImport()` → abre `ACTION_OPEN_DOCUMENT` (mime `*/*`) y entrega el JSON leído a
  la UI vía `window.kiuSkillInstall(texto)` (KiuJsPost). Código de pedido: **7104**.
- La validación y el tope (20 skills × 8 KB) viven JS-side (`KiuSkills.validate`);
  Java solo lee el archivo. Los skills viajan en la copia completa (`skills` en el payload).

### Resumen matutino
- `kiuMorningSet(hora, minuto, on)` → guarda prefs `kiu_morning` y agenda/cancela la
  alarma diaria (`MorningReceiver`, PendingIntent inmutable, exacto si hay permiso).
  Devuelve `true` si los parámetros son válidos.
- `kiuMorningGet()` → `{"on":bool,"hour":n,"minute":n}`.
- Al dispararse, el receptor notifica con canal propio `kiu_morning` y, si la app está
  abierta, también empuja `window.kiuMorningSummary(texto)` para dejarlo en el chat.
  Se reagenda solo al día siguiente y `BootReceiver` lo rearma tras reiniciar.


## v2.13.3
- `kiuChatTemplate()` → `String`: plantilla de chat (Jinja) del GGUF cargado; `""` si no hay modelo o no trae plantilla. Solo lectura; se usa para elegir el formato del prompt.
