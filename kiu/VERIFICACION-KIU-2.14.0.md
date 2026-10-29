# KIU 2.14.0 — verificación de entrega

- Versión declarada en `app/build.gradle.kts`: `2.14.0` (versionCode `91`).
- Pruebas JavaScript: `node --test tests/*.test.mjs` → 467 pasaron, 0 fallaron.
- Auditoría del puente: `python3 scripts/bridge_audit.py` → OK, sin llamadas JS sin método Java ni eventos Java sin handler JS.
- Sintaxis JavaScript comprobada con `node --check` para los módulos modificados.
- Se añadieron pruebas para perfiles Hermes 2, recetas procedurales, Periodic Nudge, streaming TTS por salto de línea y telemetría RMS/AEC.

## Límite de compilación

No se generó APK en este entorno. `bash scripts/build.sh` se detiene porque falta `vendor/llama.cpp` y no hay bibliotecas `.so` precompiladas en `app/src/main/jniLibs`. La compilación Java con Gradle tampoco pudo arrancar: el wrapper necesitaba descargar Gradle 8.9 y el entorno devolvió `UnknownHostException: services.gradle.org`. Por tanto, las modificaciones C++/Java no están verificadas mediante compilación Android ni ejecución en dispositivo; las pruebas de C++ son estáticas.

## Alcance

Se omitió la fase 6 de rediseño visual, conforme a la instrucción de no tocar la interfaz visual.
