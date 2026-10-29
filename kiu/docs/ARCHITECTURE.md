# Arquitectura de la interfaz (tanda 4 · sección 3)

Este documento describe cómo quedó organizada la UI web después de dividir el
`app.js` monolítico y qué diseño tienen las piezas nuevas (RAG v3, i18n,
protección térmica, copia completa).

## Módulos de `js/app/`

El `app.js` original (5.457 líneas, una sola IIFE) se dividió siguiendo sus
secciones naturales. Cada módulo es un **script clásico** con su propia IIFE y
`'use strict'`; los símbolos compartidos se exponen en `window` para que los
demás módulos los lean pelados, igual que dentro del archivo original. No se
usan módulos ES a propósito: así el arranque no depende de que el WebView del
teléfono soporte `<script type="module">` (Chrome 61+).

Orden de carga en `index.html` (cada uno depende solo de los anteriores):

| # | Módulo | Contenido | Expone en `window` |
|---|--------|-----------|--------------------|
| 1 | `env.js` | Iconos SVG, helpers puros (`esc/store/timeAgo/fmtWhen/...`), puente crudo (`rawBridge/jparse/bcrumb`) y puente Android (`BR`, `bridge`) | `icon`, `esc`, `store`, `bridge`, `BR`, … |
| 2 | `state.js` | Ajustes (`S`), personalidades, conversaciones múltiples, bóveda `Sec`, proveedores (`PROV`), claves (`setProvKey/loadKeys`) | `S`, `saveS`, `PROV`, `Sec`, `ensureConv`, … |
| 3 | `catalog.js` | Catálogo de modelos GGUF verificados (URLs, tamaños, RAM, **SHA-256**) + clasificador texto/visión/mmproj | `MODCAT`, `modKind`, `prettyName`, … |
| 4 | `models.js` | Descargas persistentes (`Mod`, HTTP Range + SHA-256) e importar GGUF (`Imp`) | `Mod`, `Imp` |
| 5 | `motor.js` | Motor llama.cpp (`Kiu`), compresión de contexto (`Comp`), router por tarea (`Rtr`), orquestador (`Orch`), conocimiento progresivo (`KB`), **protección térmica** | `Kiu`, `Comp`, `Rtr`, `Orch`, `KB` |
| 6 | `app-ui.js` | Toda la UI (`App`), memoria (`KiuMem`), sistema en vivo (`Sys`), restauración de copias (`window.kiuDataRestore`), arranque en DOMContentLoaded | `App` (+ `window.App`), `KiuMem` |

Fuera de `js/app/`, `index.html` carga antes: `kiu-migrate.js` (ferry de datos),
`i18n.js`, `brain.js`, `tools.js`, `kiu-estados.js` + `kiu-avatar.js` + `kiu-avatar-boot.js`
(desde v2.7 `avatar.js` viejo eliminado; desde v2.8 `kiu-estados.js` es el dueño
único del estado del avatar: por capas y con prioridad, con eventos explícitos en vez
de adivinar mirando el puente),
`rag-worker.js` + `rag.js` (núcleo compartido + worker) y `kiu-secure.js`
(bóveda de claves + proxy de red + streaming).

### Reglas para editar
1. Un símbolo que otro módulo lee tiene que terminar en `window.X = X` al pie
   del módulo que lo declara.
2. Las asignaciones cruzadas están prohibidas (solo lectura o mutación); la
   única excepción histórica es `App = {...}` dentro de `app-ui.js`.
3. Después de tocar el cableado, correr `node --test tests/boot.test.mjs`:
   arrastra TODOS los scripts en el orden real de `index.html` dentro de una VM
   con DOM falso y falla si aparece un `ReferenceError` de un símbolo del split
   o si `App.init()` no completa.

## RAG v3.1 (`rag.js` + `rag-worker.js`, tanda 8)

- **Web Worker (nuevo en v2.7)**: `rag-worker.js` es un núcleo con dos modos —
  en el hilo principal expone `KiuRagCore` (tok/chunk/mkRows/score: la
  matemática existe UNA sola vez) y en modo worker atiende `{id, op}`:
  `prep` (fragmenta + tf), `sync` (espeja el índice sin textos), `drop` y
  `search` (BM25 top-k). Así indexar un documento grande o buscar no congela
  la UI ni las animaciones del avatar. Sin worker (VM de tests, WebView
  vetusto) rag.js usa las rutas síncronas de siempre: mismo resultado.
- **API nueva**: `RAG.hits(q,k)` → resultados estructurados
  (`{key, doc, name, ci, text, s}`; lo consume react.js),
  `RAG.searchAsync(q,k,cb)` → el MISMO string que `search` pero calculado en
  el worker con guardia de 2 s, y `RAG.ctxFor(q,k,cb)` → contexto listo para
  el prompt (lo consumen `kiuReply` y `apiStream` vía `preCtx`).
- **Persistencia**: IndexedDB `kiu-rag` con tres stores — `docs` (meta:
  id/nombre/ext/ts/n), `chunks` ({key: `docId#ci`, doc, ci, text, tf, len}) y
  `meta` (interruptor on/off). Si no hay IndexedDB (WebView muy viejo o test),
  se usa el formato viejo de localStorage (`nexo_rag`) con el mismo índice en
  memoria.
- **Índice**: al indexar se tokeniza UNA vez y se guarda el `tf` de cada
  fragmento (antes se re-tokenizaba todo el corpus en cada arranque). Para la
  búsqueda síncrona (`RAG.search(q,k)`), los fragmentos viven en RAM
  (`_rows`) junto con `df` y la longitud media.
- **Ranking BM25** (k1=1,4 · b=0,75) con IDF del corpus; reemplaza al TF-IDF
  aproximado de la v1. Formato de salida idéntico (`[nombre · parte N]\n…`)
  para no tocar el chat.
- **Tope**: ~8 MB de texto (antes 0,8 MB) y 800 fragmentos por documento.
- **Migración única**: si hay IDB y no hay datos pero sí existe el `nexo_rag`
  viejo, se convierte (recalculando tf), se guarda en IDB y se borra la clave
  vieja.
- **Copia de seguridad**: `RAG.exportAll(cb)` / `RAG.importAll(data, cb)` con
  formato `{v:3, on, docs, chunks:[{doc,ci,text}]}`.

## Protección térmica (sección 3-c)

La temperatura de batería ya venía en `sysInfo().temp` (décimas de °C desde
`ACTION_BATTERY_CHANGED`). `Kiu._thermArm()` arma un timer de 10 s cada vez que
arranca una generación; si `temp ≥ 46 °C` y `S.thermal !== false`:

1. corta el polling y el motor (`kiuGenStop` + `kiuResetBusy`),
2. recupera el parcial (limpia `<think>`), lo entrega como respuesta
   `recovered` con `thermal: grados`,
3. avatar en "Detenido" + toast explicativo.

El timer se autolimpia si no hay generación pendiente. El interruptor está en
Ajustes → "Protección térmica".

## i18n (sección 3-c)

- `js/i18n.js` carga antes que todo lo demás. El español es el idioma fuente:
  con `lang === 'es'` no se toca nada del HTML.
- Los textos estáticos marcados con `data-i18n="clave"` se traducen con el
  diccionario `en` de `KiuI18n`; sin clave o sin traducción quedan en español
  (fallback). `data-i18n-ph` hace lo propio con placeholders.
- Selector Español/English en Ajustes → Apariencia; guarda en
  `nexo_settings.lang` y dispara `kiu-lang` para la UI dinámica.
- Alcance actual: chrome (navegación, inicio, etiquetas de ajustes, botones
  comunes). El texto dinámico de `app-ui.js` y las respuestas de `brain.js`
  siguen en español: queda documentado en `KNOWN_ISSUES.md`.

## Copia completa vía SAF (pendiente de la sección 1)

- **Exportar**: `App.exportDataFile()` junta ajustes (sin `prov`), memoria,
  conversaciones, alarmas, KB, uso y `RAG.exportAll()`; pasa el JSON por
  `bridge('kiuDataExport', [json])` → `ACTION_CREATE_DOCUMENT` → se escribe con
  `ContentResolver`.
- **Importar**: `bridge('kiuDataImport')` → `ACTION_OPEN_DOCUMENT` → Java lee
  (tope 30 MB) y entrega el JSON a `window.kiuDataRestore(data)` vía KiuJsPost;
  la UI restaura ajustes (sin claves), memoria, conversaciones, re-arma alarmas
  futuras y restaura el RAG con `RAG.importAll`.
- Las claves API nunca viajan en la copia: viven cifradas en el Keystore del
  teléfono y se re-ingresan (o se re-bóvedan con `setProvKey`) en el destino.

## Verificación sin Android

- `node --test tests/boot.test.mjs` — arranque completo en VM (DOM falso).
- `node --test tests/rag.test.mjs` — RAG v3 con shim de IndexedDB en memoria.
- `node --test tests/brain.test.mjs tests/secure.test.mjs` — cerebro y seguridad.
- `python3 scripts/javacheck.py` — balance estructural de los Java (no reemplaza
  a javac).

## Funciones nuevas v2.5 (sección 4 · tanda 5)

### Skills instalables (`js/skills.js`)
- Módulo independiente cargado después de `brain.js` (los skills pueden delegar en
  `KiuBrain` vía `reply: "accion:…"`, y para eso el cerebro ya debe existir).
- Persistencia en `localStorage` (`kiu_skills`, tope 20 × 8 KB); export/import en la
  copia completa (`skills` en el payload; los ejemplos no viajan).
- En `sendMsg` (app-ui.js) corren **antes** del cerebro: el usuario los creó para
  personalizar a Kiu, así que su intención gana. Instalación: texto pegado en el modal
  o archivo SAF (Java → `window.kiuSkillInstall`).

### Bucle ReAct (`js/react.js`)
- Cargado después de `brain.js` y `rag.js` (usa ambos como herramientas).
- `sendMsg` lo invoca después del cerebro y de la clasificación del router, pero
  **antes** del orquestador y sin tocar el caso `search` (el navegador del chat manda
  en búsquedas web). Si ninguna parte se resuelve, `handled:false` deja seguir el
  flujo normal hacia API/motor local/fallback.
- Traza del último bucle: `KiuReAct.lastTrace` (`{step, q, thought, action, obs}`).

### Resumen matutino (nativo + UI)
- `MorningReceiver.java`: BroadcastReceiver agendado por `AlarmManager` desde el
  puente (`kiuMorningSet/Get`, prefs `kiu_morning`). Arma el texto con datos frescos
  al disparar (no hay texto guardado que envejezca): fecha en español, recordatorios
  de las próximas 36 h desde `Alarms.all()`, batería del sticky de `BATTERY_CHANGED`
  y un tip rotativo (7, por día del año). Canal propio `kiu_morning` (importancia
  default). Reagenda el día siguiente y `BootReceiver` lo rearma tras reiniciar.
- UI en Ajustes → Resumen matutino (toggle + hora, `S.morning`), subtítulo vivo en la
  fila. Si la app está abierta al dispararse, `window.kiuMorningSummary` deja el
  resumen también en el chat.
- **Bug aprovechado**: al tocar esta infraestructura se corrigió `Alarms.pending()` y
  `ReminderReceiver`, que creaban PendingIntents sin `FLAG_IMMUTABLE` (excepción
  garantizada en Android 12+ con target 34).
