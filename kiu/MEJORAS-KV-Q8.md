# KIU — Siguiente mejora: caché KV Q8_0

## Qué cambia
- El motor nativo intenta crear la caché KV con `GGML_TYPE_Q8_0` para K y V. En modelos/contextos compatibles, esto reduce aproximadamente a la mitad la memoria usada por esa caché frente a FP16.
- La estimación de memoria al escoger el contexto se ajusta para Q8_0 e incluye margen para el almacenamiento por bloques.
- Si la creación del contexto Q8_0 falla, KIU vuelve a intentar con FP16 para mantener una ruta de compatibilidad.
- Se conserva el pin existente de llama.cpp (`v0.7.0`, SHA `620d2225cc436ab0b001e3200e590e3b286ef9ab`); no se cambia la versión del motor.

## Verificación
Las pruebas automatizadas comprueban el pin del motor, la selección Q8_0, el fallback FP16 y el cálculo de memoria. Estas pruebas estructurales no sustituyen una compilación nativa ni una medición real en el Xiaomi 15.

## Importante
No se compiló ni instaló una APK en este entorno porque no están disponibles el SDK/NDK Android y la dependencia vendorizada de llama.cpp. Antes de distribuir, hay que compilar con `./scripts/vendor_llama.sh` y `./gradlew :app:assembleDebug`, instalar la APK y comparar memoria/velocidad con un mismo modelo y contexto. La cuantización Q8 puede cambiar ligeramente la calidad de salida; la magnitud depende del modelo y la tarea.
