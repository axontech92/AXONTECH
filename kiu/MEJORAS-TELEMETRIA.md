# KIU — Siguiente mejora: telemetría de memoria

## Cambios incluidos
- `MainActivity.sysInfo()` expone `appPssKb`, la memoria PSS del proceso KIU en KB, sin confundirla con la RAM libre del sistema.
- Expone `nativeLoaded` para indicar si el modelo nativo está cargado y `nativeTps` con la velocidad reportada por el motor.
- La pantalla que informa del servidor local añade el uso aproximado de KIU en MB y el estado del motor cuando esos datos están disponibles.
- Se añadieron tres pruebas automatizadas en `tests/telemetria-memoria.test.mjs`.

## Verificación realizada
- `node --test tests/*.test.mjs`: 351 pruebas aprobadas, 0 fallidas.
- `node --check app/src/main/assets/www/js/app/app-ui.js`: correcto.

## Pendiente antes de distribuir
No se ha compilado la APK en este entorno. Hay que ejecutar una compilación Android con SDK/NDK y comprobar en un teléfono que `sysInfo()` devuelve JSON válido y que las cifras PSS son razonables. `nativeTps` representa la velocidad de generación reportada por llama.cpp, no la velocidad de prefill.
