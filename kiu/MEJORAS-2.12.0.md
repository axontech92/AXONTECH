# KIU 2.12.0 — corrección de migración y versión

## Cambios
- `versionName`: `2.12.0`.
- `versionCode`: `74`.
- La migración `_agentGateV2` ya no fuerza `S.agentOn = true`; así respeta la preferencia explícita guardada por el usuario.
- En una instalación nueva, el valor inicial sigue siendo `true`.
- Se agrega prueba automatizada para verificar que una preferencia `false` persiste después de cargar el estado.

## Validación
La suite Node.js debe ejecutarse con `node --test tests/*.test.mjs`. Esto no sustituye la compilación Gradle ni una prueba real en Android.
