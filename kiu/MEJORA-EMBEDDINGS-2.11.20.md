# KIU 2.11.20 — embeddings locales experimentales

## Implementado
- Extracción nativa de vectores desde el modelo GGUF ya cargado usando `llama_get_embeddings_ith`.
- Pooling medio de hasta 96 tokens y normalización L2.
- Puente JNI → `KiuBridge.embedLocalText` → proveedor `KiuLocalEmbeddings`.
- Reranking acotado a los 24 candidatos lexicales BM25 para limitar el coste de CPU en el teléfono.
- Limpieza del contexto KV antes y después de la operación para evitar mezclar el estado de una búsqueda con una generación posterior.
- Respaldo al RAG híbrido existente cuando el motor no está disponible o devuelve error.

## Límites que no deben ocultarse
- Se usan estados ocultos de un modelo de chat; no se incluye un modelo entrenado específicamente para embeddings.
- La calidad semántica no se puede asegurar sin probar un corpus de documentos real.
- No se compiló el motor nativo en este entorno porque no está vendorizado el pin llama.cpp y falta la cadena completa de compilación Android.
- No se generó ni probó una APK en un dispositivo físico.

## Versión
- `versionName`: 2.11.20
- `versionCode`: 70

## Verificaciones
- `node --check app/src/main/assets/www/js/local-embeddings.js`: correcto.
- `node --test tests/*.test.mjs`: 380 pruebas aprobadas, 0 fallidas.
