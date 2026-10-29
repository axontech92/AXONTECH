# KIU v2.11.19 — base para embeddings locales

## Cambios
- Se añadió `js/local-embeddings.js`, un adaptador que admite registrar un proveedor local real con `embed(text) -> Promise<number[]>`.
- El adaptador valida los vectores, calcula similitud coseno, mantiene una caché temporal `WeakMap` por fila y fusiona el ranking vectorial con BM25 mediante RRF.
- `rag.js` intenta el reranking solo si un proveedor indica que está listo. Si no hay modelo instalado o el proveedor falla, usa la búsqueda existente.
- Se actualizó `versionName` a `2.11.19` y `versionCode` a `69`.

## Lo que NO se debe confundir
Esta entrega **no contiene un modelo neuronal ni el runtime que lo ejecuta**. Por tanto, no activa embeddings neuronales por sí sola. Es la integración modular y testeada para poder incorporar el modelo real como siguiente subpaso sin romper el RAG actual. No se incluye una APK compilada ni se afirma que se haya probado en el teléfono.

## Contrato del proveedor
El proveedor que se integre debe exponer `embed(text)` y devolver un vector numérico estable de la misma dimensión para consultas y documentos. Debe ejecutar de forma local y declarar `ready` como `false` hasta que el modelo esté disponible. La API pública está en `window.KiuLocalEmbeddings`.
