# KIU 2.12.5 — Harness² comparación controlada

## Objetivo
Comparar la expresión anterior de detección de búsquedas web con el enrutador candidato usando prompts fijos, sin APIs ni conexión externa.

## Qué mide
- Cinco frases explícitas de búsqueda con cortesía que la expresión anterior no detectaba.
- Preservación de las peticiones explícitas anteriores.
- Casos negativos para evitar que preguntas generales o menciones casuales de «noticias» y «precio» se desvíen a web.

## Límites
La comparación mide selección de ruta, no la verdad ni la calidad de las respuestas generadas por un LLM. El baseline de la prueba reproduce el detector anterior de peticiones explícitas, no todo el comportamiento histórico de la aplicación. No hay auto-modificación del código.

## Verificación
`node --test tests/harness2-comparison-v2125.test.mjs`
`node --test tests/*.test.mjs`

La compilación Android y la prueba en dispositivo deben validarse aparte.
