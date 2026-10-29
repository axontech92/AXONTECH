# KIU v2.11.18 — Optimización de recuperación RAG

## Cambios
- Añadido caché en memoria de vectores semánticos por fila mediante `WeakMap`.
- Las consultas sucesivas reutilizan la representación vectorial ya calculada en lugar de reconstruirla para cada fragmento.
- El caché no agrega campos al índice persistido y permite liberar filas automáticamente al reemplazar documentos.
- Incremento Android: `versionName 2.11.18`, `versionCode 68`.

## Alcance y límites
Esta versión optimiza la vectorización ligera existente basada en términos y conceptos. **No incorpora todavía un modelo neuronal real de embeddings**; eso requiere seleccionar, empaquetar e integrar un modelo compatible y medir el consumo real en Android.

## Validación
Pruebas Node.js y comprobación sintáctica JavaScript. La APK debe compilarse e instalarse en un entorno Android para validar rendimiento real; este paquete es código fuente.
