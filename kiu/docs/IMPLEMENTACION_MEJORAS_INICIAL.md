# KIU — Revisión e implementación inicial de mejoras

Fecha: 2026-10-20

## Base revisada
- Proyecto: `KIU-main.zip`
- Plan de referencia: `Plan de Mejoras KIU.md`
- Suite original: 345 pruebas aprobadas.
- Suite después de cambios: 348 pruebas aprobadas, 0 fallidas.

## Cambios incluidos en esta entrega
1. Nueva clase `KiuAudioEffects.java` para conectar de forma opcional los efectos Android `AcousticEchoCanceler`, `NoiseSuppressor` y `AutomaticGainControl` a la sesión de `AudioRecord`.
2. El dictado offline y el motor de palabra de activación usan `MediaRecorder.AudioSource.VOICE_COMMUNICATION` e intentan activar esos efectos.
3. Los efectos se liberan al terminar la captura o al reconstruir el micrófono; si el fabricante no soporta un efecto, KIU continúa sin él.
4. Se agregaron tres pruebas automatizadas de estructura para verificar la asociación, el carácter opcional y la liberación de recursos.

## Verificación
- `node --test tests/*.test.mjs`: 348 aprobadas, 0 fallidas.
- No se pudo completar `:app:assembleDebug` en este entorno: el Gradle Wrapper necesita descargar Gradle 8.9 y el entorno no tiene acceso de red (`UnknownHostException: services.gradle.org`).
- Por lo tanto, esta entrega NO se presenta como APK compilada ni como prueba de funcionamiento físico en un teléfono. Los efectos de audio dependen del soporte del dispositivo/ROM y deben probarse en Android.

## Siguientes mejoras recomendadas del plan
1. Cuantización KV Q8_0 y telemetría visible del motor: revisar contra el `llama.cpp` fijado en `scripts/vendor_llama.sh` y compilar con NDK antes de habilitar.
2. Verificación SHA-256 estricta para todos los modelos y APK: los caminos de descarga deben fallar de forma cerrada si se solicita hash pero no coincide; los hashes deben venir de un manifiesto confiable.
3. Gramáticas GBNF para llamadas a herramientas: revisar el esquema real de `tools.js` y mantener la ruta de parseo/reintento como respaldo.
4. RAG híbrido BM25 + vectorial y fragmentación con cabecera documental.
5. GPU Vulkan, descarga de modelo en inactividad y TTS neuronal local: fases posteriores, requieren mediciones y pruebas específicas.

## Precaución técnica
El cambio a `VOICE_COMMUNICATION` puede variar entre fabricantes. Si el audio empeora en algún teléfono, conviene añadir una opción de diagnóstico para comparar con `MIC` y desactivar individualmente AEC/NS/AGC. No se debe prometer un aumento fijo de precisión sin mediciones en el dispositivo.
