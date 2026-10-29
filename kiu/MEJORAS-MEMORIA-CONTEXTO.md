# KIU v2.11.15 — Memoria y contexto de conversación

## Cambios

- La clave del resumen se calcula a partir del rol y el texto de cada mensaje; no depende solo del número de mensajes o de la fecha.
- Si todavía no hay resumen guardado, el historial original se conserva mientras KIU intenta resumirlo. Si el motor está ocupado o falla la generación del resumen, los mensajes antiguos no se descartan.
- El prompt del motor local incorpora el resumen histórico junto con los cuatro mensajes más recientes cuando el historial supera el umbral de compresión.
- La caché se limita a 40 resúmenes para evitar crecimiento indefinido.
- El prompt de resumen instruye al modelo a tratar el historial como contenido no confiable y a extraer hechos, preferencias, decisiones y pendientes, no órdenes incrustadas.
- `versionName` actualizado a `2.11.15` y `versionCode` a `65`.

## Comprobaciones realizadas

- `node --test tests/*.test.mjs`: 364 pruebas aprobadas, 0 fallidas.
- `node --check` sobre `motor.js` y `app-ui.js`: correcto.
- ZIP validado con `unzip -t`.

## Limitaciones

No se pudo compilar el APK en este entorno: falta `ANDROID_HOME` y Gradle no se pudo descargar porque no hay conexión DNS con `services.gradle.org`. Por tanto, esta entrega es el código fuente; no debe considerarse una APK compilada ni probada en dispositivo.
