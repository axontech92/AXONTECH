# Kiu como agente útil — diagnóstico y hoja de ruta

*Documento de trabajo de la tanda 2.14.2. La primera mitad es un diagnóstico
con evidencia en el código; la segunda, lo que se cambió y lo que queda.*

---

## 1. Dónde está Kiu hoy

Kiu no es un chat con un modelo: es **un enrutador con un modelo al final**.
Eso no es un insulto, es una descripción de la arquitectura, y tiene dos
mitades buenas y una mala.

Lo que funciona:

* **El camino rápido es instantáneo y funciona sin internet.** 145
  regularizaciones en `brain.js` resuelven alarmas, linterna, agenda, batería,
  cálculo, memoria, temporizadores. Sin prefill, sin tokens, sin latencia.
* **El camino lento es de verdad un agente.** `kiu-agente.js` tiene un registro
  de herramientas, validación estricta de argumentos, gramática GBNF derivada
  del esquema, y un bucle Razonar → Actuar → Observar con topes. Es la parte
  más seria del proyecto.
* **Todo es local y auditable.** Los tests (498) fijan el comportamiento.

El problema es **cómo se conectan las dos mitades**:

```
mensaje → skills → brain.js (regex) → react.js (split) → kiu-agente.js (modelo) → modelo de chat
             ↑ gana el primero que dice "handled"
```

Como `brain.js` es amplio, **el agente casi nunca llega**. El modelo entra
solo para lo que las regex no saben, y el "cerebro" real del producto siguen
siendo 145 regex. Eso funciona hasta la intención 201.

---

## 2. Los seis huecos que lo separan de ser un agente de verdad

### 2.1 El agente no podía LEER la memoria del usuario

`remember` escribía en la memoria. **Ninguna herramienta la leía.** Lo único
que consultaba lo que el usuario había guardado eran las regex de `brain.js`:
un modelo no escribe regex, así que para el agente la memoria era un
callejón sin salida.

> "Acordate de que el dentista es el martes" → dos turnos después: "¿cuándo
> era el dentista?" → el modelo no lo sabe.

**Estado: resuelto en 2.14.2** (herramienta `recall` + `search()` real en
`js/app/memoria.js`).

### 2.2 El modelo que elige la herramienta no sabía QUIÉN era el usuario

El prompt de chat (`app-ui.js → kiuMsgs`) inyectaba nombre, hechos aprendidos
y recuerdos. El prompt de **decisión** (`kiu-agente.js → systemPrompt`) no
inyectaba nada: el bot "sabía" lo que el usuario le había dicho al charlear,
pero no al decidir qué hacer.

**Estado: resuelto en 2.14.2** (bloque `PERFIL DEL USUARIO`, acotado a ~240
caracteres porque se paga en cada decisión).

### 2.3 El agente anunciaba capacidades que no tenía

El enum de `device_action` ofrecía `maps`, `web` y `youtube`. Las tres caían
en la cola de `brain.js` con un texto que `brain.js` no reconoce ("maps
centro"), así que la herramienta contestaba **siempre** "no pude cumplir".
El modelo elegía, fallaba y perdía un paso. Un valor de enum que no funciona
es peor que no ofrecerlo: le enseña al modelo una capacidad inexistente.

**Estado: resuelto en 2.14.2** (los tres tienen camino propio; la búsqueda
web quedó en una sola función, compartida con `web_search`).

### 2.4 El riesgo era único por herramienta

`device_action` era "write" para todo: leer la batería o listar tareas
terminaba en un "¿Lo hago?" que no tiene sentido. Al revés, escribir una nota
y leer la agenda pesaban igual.

**Estado: resuelto en 2.14.2** (`riskFor`: el riesgo se calcula con los
argumentos ya validados).

### 2.5 El manifiesto que ve el modelo no decía qué valores podía usar

El perfil por defecto del agente es **Harness-Local-Compact**
(`harness2-compose.js`), y en modo compacto el manifiesto era solo la firma:

```
set_alarm(when, label?)
manage_task(action, text?)
```

El modelo no tenía forma de saber que `action` valía `list|add|done`: se lo
inventaba, la validación lo rechazaba y se perdía una generación entera en la
CPU del teléfono. Con 14 herramientas y un modelo de 1-3B, adivinar es caro.

Medido: el manifiesto compacto costaba **86 tokens** y el largo **492**.

**Resuelto a medias en 2.14.2**: el compacto ahora lleva los valores del enum
(`manage_task(action: list|add|done)`), que son justamente el vocabulario que
el modelo tiene que usar. Sube a 119 tokens en el peor caso — pero el costo
real es **por turno**: `seleccionar()` deja 2-4 herramientas (≤60 tokens).

Lo que **queda abierto** es el verbo de cada herramienta ("poné una alarma",
"creá una tarea"): son ~40 tokens más y sin medición no se sabe si compensan.
Por eso el P0.1 (evaluación) tiene que ir antes.

### 2.6 No había evaluación: había tests de código, no de agente

Los tests fijan que el código haga lo que el código hace. **No había una sola
prueba de que el agente elija bien.**

Hacía falta el arnés que hace la diferencia entre "un agente" y "un demo":

* un juego de pedidos reales ("poné una alarma a las 7 y avisame si llueve"),
* con la respuesta esperada (qué herramienta, con qué argumentos),
* corridos contra un modelo chico de verdad,
* midiendo **acierto de herramienta**, **pasos hasta el éxito**, **tasa de
  no-op** (el agente pide permiso y no hace nada) y **latencia**.

**Resuelto en 2.14.2** (`tests/evals/`): 28 pedidos reales, con la herramienta
esperada y los argumentos que tiene que producir, un modelo enchufable
(guionizado para el CI, o un endpoint OpenAI-compatible para medir de verdad) y
umbrales que hacen FALLAR el arnés si no se cumplen.

Lo que falta: correrlo contra un GGUF real. Eso necesita un teléfono o una
máquina con `llama-server`; el arnés está listo (`node tests/evals/run.mjs`)
pero los números de acierto de un modelo chico de verdad todavía no están.

Y ya pagó: el arnés encontró dos bugs que los tests de código no veían
(`device_action` con "espacio" y el cancelamiento de una alarma por título
parafraseado). Los dos están arreglados.

---

## 3. Qué cambió en 2.14.2

| Cambio | Por qué |
|---|---|
| `js/app/memoria.js` (módulo nuevo) | La memoria sale de `app-ui.js` (5.500 líneas) y gana `search()` y `summary()`. La UI se engancha con `hooks`. |
| Herramienta `recall` | El agente puede leer lo que el usuario guardó. |
| Herramientas `manage_task` y `manage_alarm` | Ver, crear, completar y cancelar: lo que el usuario hace todos los días. |
| Herramienta `create_calendar_event` | Era la única acción del calendario que el agente no tenía. |
| `PERFIL DEL USUARIO` en el prompt de decisión | El modelo sabe nombre, tareas pendientes y recuerdos antes de elegir. |
| `riskFor` | El riesgo se calcula por argumento: leer no pide permiso, escribir sí. |
| `maps` / `web` / `youtube` arreglados | Três valores del enum que no funcionaban. |
| `prefs` deja de ser un bucket muerto | "Prefiero el mate amargo" ahora llena la pestaña de Preferencias (nada la escribía). |
| 25 tests nuevos (`agente-util-v2142.test.mjs`) | 498 en total, todos en verde. |

**Costo en tokens.** El manifiesto compacto pasó de 6 a 14 herramientas: 119
tokens (antes 86; con los valores del enum, antes de 2.14.2 eran ~55). El
prompt de decisión con perfil quedó en ~290 tokens en el camino real
(compacto) y en 583 en el peor caso (manifiesto largo). Los techos de
presupuesto se actualizaron y ahora se vigilan **los dos**: el compacto (el
que se paga) tiene un techo de 140 tokens, y **por turno** el manifiesto real
está en ≤60, porque `seleccionar()` deja 2-4 herramientas.

---

## 4. Hoja de ruta, por impacto

### P0 — lo que define si Kiu es un agente

1. **Evaluar de verdad** (§2.6). *El arnés ya existe (2.14.2); falta correrlo
   contra un GGUF real y publicar los números.* Con eso, el resto deja de ser
   a ciegas: se puede decidir si el verbo de las herramientas (§2.5) vale sus
   tokens.
2. **Describir las herramientas en el manifiesto compacto** (§2.5). ~40 tokens
   por decisión a cambio de menos pasos fallidos.
3. **Observaciones estructuradas.** Hoy el bucle le devuelve al modelo un
   texto plano con el resultado. Pasar a `{"ok":true,"datos":…}` permite que
   el modelo distinguisha "no encontré nada" de "el dispositivo falló", y
   permite reintentar con una herramienta distinta en vez de repetir.

### P1 — lo que lo vuelve útil en el día a día

4. ~~**Un turno = una generación.**~~ **Hecho en 2.14.2**: si el resultado es
   único y corto, el texto de la herramienta ES la respuesta y no se redacta
   otra vez con el modelo. La redacción sigue pasando con varios resultados,
   con textos largos o con forma de lista (`componer: 'siempre'` la fuerza).
5. **Que el agente escriba en el chat Y en la app.** Hoy `remember` escribe
   en la memoria y el chat no registra que lo hizo.
6. ~~**Ciclo de vida de la memoria.**~~ **Hecho en 2.14.2**: `forget` y
   `update_memory` (el agente olvida y corrige lo que el usuario le dijo).
   Lo que falta es el otro lado: que el agente *reconozca* solo que hay que
   corregir ("ya no es el martes") y no haga falta pedirlo explícitamente.
7. **Agrupar pedidos.** "Mañana a las 7 poné una alarma y avisame si llueve"
   son dos decisiones del modelo. Podría ser una decisión con dos salidas.
8. **Que el agente escriba en el chat lo que hizo.** Hoy la acción queda en la
   memoria, pero no en la conversación: si el usuario pide "¿qué hiciste?", no
   hay registro.

### P2 — lo que después

9. **Menos regex, más agente.** `brain.js` tiene 145 patrones. Sirven para lo
   instantáneo, pero cada uno nuevo es una intención más que el agente no
   alcanza a ver. Con la evaluación del punto 1 se puede medir qué patrones
   siguen ganando — la regla: regex para lo que tiene que ser
   instantáneo y offline; agente para todo lo demás.
10. **Web de verdad.** `web_search` usa el resumen instantáneo de DuckDuckGo y
   Wikipedia: sirve para "quién es X", no para "compará estos tres precios".
   Falta traer y leer la página.
11. **Voz de ida y vuelta.** La wake word existe; falta que el agente entienda
    "Kiu" en medio de una conversación y que la respuesta hable.

---

## 5. Cómo se mide el progreso

* **Acierto de herramienta**: en el arnés, ¿la primera herramienta elegida es
  la correcta? (objetivo: >80 % en el juego de pedidos)
* **Pasos hasta el éxito**: hoy el tope es 3-4; la media ponderada no puede
  pasar de 1,5.
* **Tasa de no-op**: pedidos que el agente declara "no hice nada" y
  vuelven al chat normal.
* **Latencia por turno**: prefill + decode, medido en dispositivo, no
  estimado.
* **Fracaso honesto**: cuando no puede, que lo diga y no invente. Esto ya se
  mide en los tests y hay que mantenerlo: es la diferencia entre un asistente
  y un fabricador de datos.
