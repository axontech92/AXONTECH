# KIU 2.14.1 — revisión enfocada en el motor interno

Fecha: 2026-10-24

## Alcance y límites

Se inspeccionó el ZIP `KIU-main (2).zip`. Es código fuente, no una APK instalada. No contiene `vendor/llama.cpp` ni `app/src/main/jniLibs/**/*.so`; por tanto, esta revisión no puede demostrar qué bibliotecas nativas lleva el APK del teléfono ni compilar el motor desde este paquete.

## Defectos concretos encontrados y cambios aplicados

1. **Fin de generación con cero tokens no se reflejaba en `done`.** Antes, `done` era `!g_running && g_toks > 0`, pero el watchdog JS tiene una vía rápida de 6 s para `done && tokens == 0`. Si el modelo finalizaba sin emitir token, esa vía nunca podía ejecutarse. Ahora `done` refleja el estado del worker y puede ser true con cero tokens.
2. **El sondeo podía leer el texto final de la generación anterior.** El estado nativo conservaba texto/tokens anteriores hasta entrar en la sección protegida por el mutex. Ahora se publica un ID incremental y se limpian estado/texto al comenzar; JS ignora el estado hasta que cambia el ID de la solicitud actual.
3. **La cancelación no interrumpía una evaluación larga dentro de `llama_process`.** `stopGen()` solo activa una bandera que se comprobaba entre llamadas de evaluación. Se conecta `g_stop` a `llama_context_params.abort_callback`. La cabecera oficial de llama.cpp v0.7.0 documenta que este callback aborta `llama_decode` y que en esta versión solo funciona con ejecución CPU; KIU configura `n_gpu_layers = 0`. Esto requiere compilación y prueba real para confirmar el comportamiento integrado: https://github.com/ggml-org/llama.cpp/blob/v0.7.0/include/llama.h
4. **Reservas críticas sin comprobación en la generación.** Se añadieron salidas controladas si `llama_sampler_chain_init`, `llama_batch_ext_init` o `malloc` no devuelven memoria, en vez de seguir usando esos punteros.
5. **La carga de `libkiullama` ocultaba la causa original.** `KiuNative` conserva ahora la clase y el mensaje de la excepción; el puente JS puede mostrar el motivo concreto cuando no se encuentra disponible el motor.

## Verificación ejecutada

- Suite Node: ejecutar `node --test tests/*.test.mjs` desde la raíz.
- Auditoría del puente: ejecutar `python3 scripts/bridge_audit.py`.
- El script `scripts/build.sh` se detiene correctamente porque faltan `vendor/llama.cpp` y bibliotecas nativas precompiladas.
- **No** se afirma compilación C++, APK compilada ni prueba de inferencia en Android. Esas verificaciones siguen pendientes.

## Qué falta para cerrar la reparación

1. Compilar contra el commit fijado por `scripts/vendor_llama.sh` (v0.7.0, SHA `620d2225cc436ab0b001e3200e590e3b286ef9ab`).
2. Instalar la APK compilada y probar una generación corta con modelo pequeño.
3. Capturar `logcat` si falla; el nuevo error de carga debe ayudar a diferenciar biblioteca ausente, ABI incompatible, error de carga del GGUF, fallo de evaluación o generación vacía.
4. Verificar que detener una evaluación larga devuelve el control y que una segunda pregunta funciona después.
