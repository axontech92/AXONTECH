# KIU v2.11.17 — RAG híbrido local

## Cambios
- Se conserva BM25 y se combina con una similitud vectorial dispersa local basada en términos y grupos de sinónimos frecuentes.
- Se usa Reciprocal Rank Fusion (RRF) para combinar ambos rankings.
- La búsqueda continúa sin red, sin API y sin descargar un modelo de embeddings adicional.
- La ruta BM25 original sigue disponible como respaldo de compatibilidad.
- `versionName`: 2.11.17; `versionCode`: 67.

## Alcance y limitación
La vectorización es una aproximación semántica ligera, determinista y basada en reglas/sinónimos; **no** es un modelo neuronal de embeddings. Puede ayudar con sinónimos cubiertos por el diccionario, pero no comprende paráfrasis generales. Para embeddings neuronales reales habría que integrar y validar un modelo local pequeño, su licencia, tamaño y coste de RAM.

## Validación
- `node --check app/src/main/assets/www/js/rag-worker.js`
- `node --check app/src/main/assets/www/js/rag.js`
- `node --test tests/*.test.mjs`: 370 pruebas aprobadas.
- ZIP comprobado con `unzip -t`.

No se afirma compilación Android ni prueba en dispositivo en este entorno.
