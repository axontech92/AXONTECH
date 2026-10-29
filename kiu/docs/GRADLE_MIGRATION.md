# Migración a proyecto Gradle real

> Estado: **completada al 100 %** en la rama `mejoras/gradle-motor-wakeword`.
> Desde v2.6.0 ya NO queda nada del flujo apktool: se eliminaron `app/smali*/`,
> `app/res/`, `app/AndroidManifest.xml`, `app/apktool.yml`, `app/assets/`,
> `reference-java/`, `scripts/repack.py` y `scripts/get-tools.sh`.
> `scripts/build.sh` compila directo con Gradle (`gradlew`).

## Qué cambió

KIU era un proyecto apktool (smali + recompilado). Ahora el repo es un
**proyecto Gradle estándar** que Android Studio abre directamente:

```
repo-kiu/
├── settings.gradle.kts          # módulo único :app
├── build.gradle.kts             # AGP 8.5.2
├── gradle.properties
├── gradle/wrapper/…             # Gradle 8.9 (wrapper incluido)
├── gradlew / gradlew.bat
├── app/
│   ├── build.gradle.kts         # minSdk 24 · targetSdk 34 · firma release por entorno
│   ├── proguard-rules.pro       # protege el puente JS y Vosk
│   ├── lib/arm64-v8a/           # .so precompiladas del motor (modo prebuilt)
│   └── src/main/                # estructura estándar Android Studio
│       ├── AndroidManifest.xml  # único manifest (permisos + queries + servicios)
│       ├── assets/www/          # UI web — única fuente de verdad
│       ├── java/com/kiu/agent/  # Java real
│       ├── cpp/                 # wrapper JNI del motor + CMakeLists.txt
│       └── res/                 # values (themes/colors/strings) + iconos + xml
└── vendor/llama.cpp/            # motor vendored (./scripts/vendor_llama.sh)
```

## Cómo compilar

### Requisitos
- JDK 17 (Temurin recomendado)
- Android SDK 34 (Android Studio lo instala solo)

### CLI
```bash
./gradlew :app:assembleDebug          # APK debug (usa .so precompiladas)
./gradlew :app:assembleRelease        # requiere firma (ver CI)
```

### Android Studio
Abrir la carpeta raíz del repo → esperar el sync → Run. No hay pasos manuales.

## Fuentes Java recuperadas

Los 12 archivos de `reference-java/sources/com/kiu/agent/` se portaron a
`app/src/main/java/com/kiu/agent/` con estos arreglos sobre el código
descompilado (verificados con ECJ + `android.jar` de API 34):

| Archivo | Problema | Arreglo |
|---|---|---|
| `KiuDlTask.run()` | no descompiló (JADX) | reescrito: descarga HTTP con **reanudación por Range** sobre `.part` |
| `MainActivity.Bridge.contacts()` | no descompiló | reescrito idéntico al bytecode (Cursor + JSONArray, máx 12) |
| `KiuImport.copy()` | no descompiló | reescrito: copia SAF → models con progreso; desde v2.6.0 **paridad completa con el smali**: sanitización estricta del nombre (`[^A-Za-z0-9._-]`→`_`), rechazo de no-`.gguf`, chequeo de espacio libre (margen 50 MB), escritura a `.part` + renombrado final y borrado del `.part` en error |
| `KiuCrypto` | `String.valueOf(bytes,"UTF-8")` inválido | `new String(bytes,"UTF-8")` + `throws` reales en `key()` |
| `KiuDownload.ggufMagic()` / `KiuDlTask` | faltaba `return` tras catch | rutas de retorno arregladas |
| `KiuService` | `r3` registro suelto | `KiuService.this` |
| `MainActivity` | excepciones no capturadas en voces TTS y timer | try/catch + variable final |
| `MainActivity.web` | privado, usado por `KiuJsPost` | visible-de-paquete (comentario al pie) |

`R.java` no se porta: lo genera AGP. Los recursos que usa el Java son
`@mipmap/ic_launcher` (originales del APK) y `@drawable/ic_notif`.

## Motor nativo: dos modos (automático)

1. **Prebuilt** (por defecto): Gradle empaqueta las `.so` que haya en
   `app/src/main/jniLibs/<ABI>/` (ubicación estándar, **fuera de Git** desde la
   tanda 7). Los `abiFilters` se detectan solos según qué ABIs existan, así el
   APK no arrastra ABIs inútiles de los AAR (Vosk/JNA). Si la carpeta está
   vacía, el build corta temprano con la receta de recuperación.
2. **Fuente**: si existe `vendor/llama.cpp`, `app/build.gradle.kts` activa
   `externalNativeBuild` (CMake) y compila `app/src/main/cpp/kiullama_jni.cpp`
   contra llama.cpp → `libkiullama.so` nueva para **arm64-v8a y x86_64**
   (x86_64 permite probar el motor en emulador, algo que el prebuilt no da).

```bash
./scripts/vendor_llama.sh   # clona llama.cpp shallow en vendor/
./gradlew :app:assembleDebug
```

**Inyección nativa (tanda 7):** el `CMakeLists.txt` fija
`CMAKE_LIBRARY_OUTPUT_DIRECTORY` a `app/src/main/jniLibs/${ANDROID_ABI}`, así
los `.so` compilados (libkiullama + libllama + libggml*) quedan inyectados en
esa carpeta (reutilizables como precompiladas sin NDK). En modo fuente Gradle
desactiva `jniLibs` como origen de empaquetado para no incluir cada librería
dos veces: el APK toma las `.so` directo del pipeline CMake.
`vendor_llama.sh`, además de clonar, traslada a `jniLibs` las precompiladas
viejas de `app/lib/` (repositorios anteriores a la tanda 7).

El wrapper JNI reproduce **exactamente** el contrato del motor original
(`KiuNative.java`): `loadModel`, `loadProgress`, `generate`, `genStatus`,
`stopGen`, `freeModel`, `isLoaded`, `lastError`, `tokensPerSec`. Además:
- prefill por lotes (512) en vez de token por token → **prompt inicial mucho más rápido**
- context shift automático (`llama_memory_seq_*`) → conversaciones largas no se cortan
- recorte inteligente de prompts que no entran en contexto
- sampling con `llama_sampler` chain (greedy si temp ≤ 0; min_p + temp + dist si no)

Nota: la primera compilación nativa baja el NDK 27 + CMake 3.22.1 desde
Android Studio/SDK Manager.

## Wake word 100% local (Vosk)

Nuevo: `WakeWordEngine.java` — detección de "Kiu" **offline** con
gramática cerrada, sin SpeechRecognizer de Google ni red.

- Modelo: `vosk-model-small-es-0.42` (~40 MB) en
  `Android/data/com.kiu.agent/files/models/vosk-es-small/`
  (descargable con el gestor de la app; se detecta por `final.mdl`).
- Se activa con los nuevos métodos del puente (ver `BRIDGE_API.md`):
  `kiuWWStart()` / `kiuWWStop()` / `kiuWWState()`.
- Si está activado, `startWake()` del puente usa el engine local en vez del
  servicio con Google; al detectar dispara el mismo hook `nexoWakeHit()`.
- No se escucha mientras el TTS está hablando (anti-feedback) y hay cooldown
  de 4 s entre detecciones.

## CI

`.github/workflows/build.yml` tiene dos jobs (desde v2.6.0 ya no existe el flujo apktool):
- `tests`: la suite JS completa en Node 20.
- `build`: `./gradlew :app:assembleDebug :app:assembleRelease` + `lintDebug`. Con los secretos
  `KIU_KEYSTORE_BASE64` / `KIU_KEYSTORE_PASSWORD` el APK release sale firmado con la clave del
  proyecto; sin ellos firma con la clave debug (solo para probar).

## Firma release (reemplaza al uber-apk-signer)

`app/build.gradle.kts` arma el `signingConfig` de release con variables de entorno:

```bash
KIU_PASS=tu-clave ./scripts/build.sh           # crea keystore/kiu-release.jks si no existe
KIU_KS=/ruta/otra.jks KIU_ALIAS=otro KIU_PASS=x ./scripts/build.sh
```

Sin `KIU_PASS`, `assembleRelease` firma con la clave debug (para probar en emulador).

## Red segura (network_security_config)

El manifest de Gradle usa `android:networkSecurityConfig="@xml/network_security_config"` en vez de
`usesCleartextTraffic="true"`. Efecto: **HTTP bloqueado salvo excepciones explícitas**
(localhost, 127.0.0.1, 10.0.2.2 para el emulador). Si accedés a Ollama/LM Studio en otra máquina de
tu LAN, agregá su IP en `app/src/main/res/xml/network_security_config.xml` dentro del
`<domain-config>` (Android no soporta rangos /24, va IP por IP). Las APIs en la nube son HTTPS y no
se afectan.

## Tests y release

- Tests: `node --test tests/*.test.mjs` — Node puro, sin npm install. Cargan los módulos reales en
  una VM con stub de `window`, igual que el WebView. En CI corre en el job `tests` de cada push.
- Release: `git tag v2.6.0 && git push --tags` → el job `release` arma la GitHub Release con el
  APK debug y el APK release del build Gradle.
