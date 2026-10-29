# KIU 2.12.1 — trazabilidad segura del enrutador

## Cambios
- Versión Android: `2.12.1`, código `75`.
- `Rtr` registra en memoria hasta 40 decisiones de enrutamiento.
- Cada registro incluye ruta elegida, motivo, longitud del texto, indicadores de voz/imagen y marca de tiempo. No incluye el contenido del mensaje.
- API de diagnóstico local: `Rtr.lastDecision`, `Rtr.getTrace()` y `Rtr.clearTrace()`.
- Se conserva la migración de `agentOn` que respeta la preferencia del usuario y las mejoras de respuesta local de 2.12.0.

## Validación
Ejecutar `node --test tests/*.test.mjs`. La suite automatizada no sustituye la compilación Gradle, la prueba del modelo local ni la instalación en Android.

## Siguiente fase: Harness²
Con la traza como base, la siguiente iteración puede comparar la ruta prevista con la ruta ejecutada, identificar fallos sin guardar prompts y construir pruebas de regresión para el ciclo Propose–Probe–Compose.
