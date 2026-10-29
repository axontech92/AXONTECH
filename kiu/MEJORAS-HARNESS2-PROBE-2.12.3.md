# KIU 2.12.3 — Harness² Probe ampliado

## Objetivo
Introducir evaluación conductual reproducible antes de intentar que KIU optimice su propio harness. Esta etapa no modifica automáticamente prompts ni rutas.

## Qué se añadió
- `tests/harness2-probe.test.mjs`: 20 casos de referencia con ruta esperada, score explícito y detalle de fallos.
- Prueba de trazabilidad: cada decisión debe incluir motivo y metadatos, sin conservar el texto original.
- Matriz que cubre charla factual/emocional, expresiones temporales que no deben activar web por sí solas, búsqueda actual, petición explícita de web, programación, razonamiento, mensajes largos, imagen y voz.

## Cómo ejecutar
Desde la raíz del proyecto:
`node --test tests/harness2-probe.test.mjs`
Para toda la suite:
`node --test tests/*.test.mjs`

## Límites
- Es un probe determinista de enrutamiento, no una evaluación de la calidad semántica de las respuestas del LLM.
- No llama modelos remotos, no requiere API y no hace cambios automáticos.
- Las pruebas en Node no sustituyen la compilación Android ni la prueba en el teléfono.
- La traza en memoria conserva solo metadatos, hasta 40 decisiones; no registra el texto de la consulta.


## Segunda iteración (2.12.3)
- Amplía la matriz de 12 a 20 casos, incluidos falsos positivos potenciales: lenguaje temporal casual, uso conceptual de «precio», noticias personales, cocina, programación en Python y peticiones explícitas de investigación.
- Conserva la evaluación determinista y no cambia la lógica de producción del enrutador.
- Versión Android: `versionName 2.12.3`, `versionCode 77`.
- La puntuación mide aciertos de ruta en estos casos fijos; no demuestra que el modelo responda mejor ni que las respuestas sean verdaderas.
