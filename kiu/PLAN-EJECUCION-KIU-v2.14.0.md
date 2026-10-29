# Ejecución verificable del plan KIU v2.14.0

## Alcance
- La Fase 6 (rediseño visual) está excluida expresamente y no se modifica.
- No se declara una fase terminada por tener archivos o pruebas estructurales: se requiere comportamiento conectado y evidencia.

## Estado al crear esta iteración

### Fase 1 — Google Harness² Compose
- [x] Crear y conectar `harness2-compose.js` al bucle de `kiu-agente.js` para seleccionar límites de generación y registrar resultados de validación.
- [x] Añadir rollback al perfil compacto tras dos fallos consecutivos y reinicio del contador tras una decisión validada.
- [ ] Completar guardrail de rangos/obligatorios para todas las herramientas con efecto y probar rollback en dispositivo.
- [x] La auditoría de contratos Java↔JS es ahora recursiva y descubre nuevos módulos JS propios.
- [ ] Validar el guardrail de herramientas en la ruta real de ejecución y probar rollback en dispositivo.

### Fase 2 — Hermes 2 + GBNF
- [x] KIU ya expone `setGrammar`, `grammarPending`, `grammarOk` y el motor consume la gramática en una generación.
- [x] Se agregó formato de decisión `<tool_call>` y gramática GBNF específica para modelos cuyo nombre incluye Hermes; `name/arguments` pasa por el mismo validador de herramientas.
- [x] El agente ya genera GBNF de llamadas de herramientas y existen pruebas de estructura.
- [ ] Verificar compilación contra el commit vendorizado y probar Hermes 2 real en Android. No se afirma compatibilidad de todos los modelos Hermes por nombre solamente.

### Fase 3 — Prefix Pinning / KV Q8
- [ ] No implementado en esta iteración. La ruta actual tokeniza cada prompt completo y reinicia las posiciones de evaluación (`n_pos = 0`); no existe todavía una caché de prefijo reutilizable entre turnos. Añadir `seq_rm` sin rehacer esa gestión no cumpliría el objetivo y podría corromper el contexto.

### Fase 4 — Memoria procedimental
- [ ] No implementada en esta iteración. La consolidación automática y la generación de recetas requieren políticas de privacidad, límites de retención, validación de resultados y pruebas de no duplicación.

### Fase 5 — Voz en streaming
- [x] Existe streaming parcial nativo hacia JavaScript (`KiuStream` / `kiuPush`) y el motor ya emite texto incremental.
- [x] Se conectó una cola de TTS por oraciones al streaming; solo encola oraciones completas y evita leer bloques de código/llamadas de herramientas.
- [ ] Medir latencia real en dispositivo y completar telemetría AEC/RMS en `diag-voz.js` / `KiuAudioEffects.java`.

## Validación ejecutada — iteración 2.13.5
- Suite Node ampliada con cinco pruebas de Harness² Compose/Hermes y tres pruebas de streaming TTS.
- `node --test tests/*.test.mjs`: 451 pruebas aprobadas, 0 fallidas (incluye cinco pruebas nuevas de Harness² Compose/Hermes y tres de streaming TTS).
- `python3 scripts/bridge_audit.py`: auditoría aprobada; escaneo recursivo de JS propio y comprobación de handlers flecha incluidos.
- Intento de `./gradlew --version --no-daemon`: bloqueado porque el entorno no resuelve `services.gradle.org` (DNS/red externa no disponible). Por ello no se pudo compilar ni verificar un APK.

## Honestidad de entrega
Esta versión es una iteración intermedia `2.13.5` (versionCode 87), no el cierre del plan `2.14.0`. No debe instalarse como APK final ni presentarse como si todas las fases estuvieran implementadas. La siguiente iteración debe abordar fases funcionales restantes y compilar en CI con acceso a Gradle, Android SDK/NDK y el commit fijado de llama.cpp.
