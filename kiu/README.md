# Kiu — agente personal para Android

Kiu 2.19.0 · paquete `com.kiu.agent` · minSdk 24 · targetSdk 34 · arm64-v8a (+ x86_64 compilando el motor)

App Android híbrida: interfaz web (HTML/CSS/JS) dentro de un WebView, una capa nativa en Java
y un motor **llama.cpp** que corre modelos GGUF en el propio teléfono, sin Internet.

> **Migración Gradle completada al 100 %** (v2.6.0): el repo es un proyecto Android estándar
> (`./gradlew :app:assembleDebug` o abrirlo en Android Studio) y ya no queda nada del flujo
> apktool (smali, res vieja, reference-java, repack). Detalles en `docs/GRADLE_MIGRATION.md`.
> El código Java real vive en `app/src/main/java/`.
> Motor nativo compilable desde fuente: `./scripts/vendor_llama.sh` + `vendor/llama.cpp`.
> Wake word 100 % local (Vosk) incluida — ver `docs/BRIDGE_API.md`.

## Estructura

| Carpeta | Qué es | ¿Se edita? |
|---|---|---|
| `app/src/main/java/` | **Código Java real** (MainActivity, puente, motor, wake word) | **Sí**, con Gradle |
| `app/src/main/cpp/` | Wrapper JNI del motor (C++) + CMakeLists | Sí |
| `app/src/main/assets/www/` | La interfaz web (HTML/CSS/JS) | **Sí**, es el 90 % del trabajo |
| `app/src/main/assets/www/js/app/` | **app.js dividido en 6 módulos** (env, state, catalog, models, motor, app-ui) | **Sí**, se cargan en orden |
| `app/src/main/assets/www/js/app/memoria.js` | **La memoria del usuario** (recuerdos, tareas, notas, preferencias): búsqueda y resumen | **Sí** |
| `app/src/main/assets/www/js/rag-worker.js` | Núcleo RAG compartido (hilo principal + Web Worker: BM25 fuera de la UI) | **Sí** |
| `app/src/main/res/` | Tema, iconos (sin duplicados) y `network_security_config.xml` | Solo si tocás el look nativo |
| `app/src/main/jniLibs/` | `.so` del motor — **fuera de Git** (`.gitignore`): las regenera el build con `vendor_llama.sh` o las copiás de un build previo | No (binarios) |
| `vendor/llama.cpp/` | Motor vendored (opcional, `./scripts/vendor_llama.sh`) | Sí, al actualizar el motor |
| `scripts/` | `build.sh` (Gradle), `get-tools.sh` (JDK/SDK/NDK), `vendor_llama.sh` (motor nativo), `bridge_audit.py` (contrato del puente) | Sí |
| `docs/` | Arquitectura, puente JS↔Java, migración Gradle | Sí |
| `.github/workflows/build.yml` | CI: tests + build Gradle (debug y release) | Sí |

## Cómo compilar

Requisitos: JDK 17 y Android SDK 34 (Android Studio lo instala solo; a mano:
`./scripts/get-tools.sh`).

```bash
./gradlew :app:assembleDebug                   # APK debug directo
KIU_PASS=tu-contraseña ./scripts/build.sh     # APK release firmado (crea keystore si no existe)
./scripts/vendor_llama.sh && ./gradlew :app:assembleDebug   # compila el motor nativo también
```

**Guardá `keystore/kiu-release.jks`** (está en `.gitignore`, no la subas): sin esa clave Android
no deja actualizar la app instalada y habría que desinstalarla (se pierden los datos locales).

En GitHub: subí tu clave como secretos `KIU_KEYSTORE_BASE64` (`base64 -w0 kiu-release.jks`) y
`KIU_KEYSTORE_PASSWORD`; cada push a `main` genera los APK en *Actions → Artifacts* (debug y
release), y al pushear un tag `v*` (por ejemplo `git tag v2.6.0 && git push --tags`) se publica
una **Release** con ambos APK. La suite de 255 tests (brain, secure, rag, rag-worker, boot,
app-core, skills, react, i18n, migrate) corre en cada push (job `tests`); el build espera a
que estén en verde y provisiona sus herramientas con `scripts/get-tools.sh`.

## Cómo editar (lo más importante)

* **Interfaz, lógica, textos, modelos del catálogo** → `app/src/main/assets/www/`.
  La memoria del usuario (recuerdos, tareas, notas) está en `js/app/memoria.js`:
  `search()` busca por palabras y `summary()` arma el perfil que el agente lee. El núcleo vive
  dividido en `js/app/` (env → state → catalog → models → motor → app-ui, cargados en ese orden por
  `index.html`; los símbolos compartidos van por `window`), más `brain.js`, `tools.js`, `rag.js`
  (RAG en IndexedDB + BM25), `i18n.js` (chrome es/en) y `kiu-*.js`. Es JavaScript normal: se edita
  y se recompila. La suite completa corre sin dependencias: `node --test tests/*.test.mjs`
  (Node 18+); `boot.test.mjs` arranca TODA la UI en una VM con DOM falso y caza errores entre
  módulos; `rag-worker.test.mjs` prueba el Web Worker del RAG con un FakeWorker; `app-core`
  cubre los 5 módulos del núcleo.
* **Permisos, receptores, servicios** → `app/src/main/AndroidManifest.xml` (único manifest).
* **Código Java real** → `app/src/main/java/com/kiu/agent/` (compila con Gradle).
* **Motor llama.cpp** → con `./scripts/vendor_llama.sh` el fuente vive en `vendor/llama.cpp/` y el
  wrapper JNI en `app/src/main/cpp/kiullama_jni.cpp`; se compila solo con NDK al hacer el build y
  el CMake deja las `.so` en `app/src/main/jniLibs/<ABI>/` (fuera de Git).
  Sin vendor, se empaquetan las `.so` precompiladas que haya en esa misma carpeta; si no hay
  ninguna, Gradle corta con la receta (`vendor_llama.sh` + `assembleDebug`).

### Que el APK "instale" bien
1. Gradle + AGP se encargan de `resources.arsc` y de empaquetar las `.so` sin comprimir
   (`useLegacyPackaging`), y de firmar v2/v3 con el `signingConfig` del build.
2. Para el release usá SIEMPRE la misma keystore (`keystore/kiu-release.jks`): cambiarla obliga a
   desinstalar la app y se pierden los datos locales.

## Documentación
* [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — cómo está armada la app y el flujo de datos.
* [`docs/AGENTE_UTIL.md`](docs/AGENTE_UTIL.md) — **diagnóstico de por qué Kiu todavía no es un agente de verdad** y hoja de ruta para que lo sea.

## Cómo medir si el agente es bueno

Los tests del repo comprueban que el código haga lo que el código hace; no
dicen si el agente elige la herramienta correcta. Para eso está el arnés:

```bash
node --test tests/evals.test.mjs        # en el CI: el arnés y el juego, sin red
node tests/evals/run.mjs --guion         # el modelo "perfecto": mide el arnés
node tests/evals/run.mjs --url http://127.0.0.1:8080/v1/chat/completions
```

Son 28 pedidos reales con la herramienta que el agente debería elegir y los
argumentos que tiene que producir. El arnés mide **acierto de herramienta**,
**pasos hasta el éxito**, **no-op** (pedidos que el agente declara resueltos
sin hacer nada) y **latencia**, y falla si no cumple los umbrales. El segundo
comando necesita un servidor OpenAI-compatible (`llama-server -m modelo.gguf
--port 8080`): es la única forma de saber si el modelo elige bien.
* [`docs/BRIDGE_API.md`](docs/BRIDGE_API.md) — todos los métodos que JS puede llamar (`KiuBridge.*`).
* [`docs/GRADLE_MIGRATION.md`](docs/GRADLE_MIGRATION.md) — decisiones de la migración y el motor nativo.
* [`docs/AVATAR_Y_LOGO.md`](docs/AVATAR_Y_LOGO.md) — el bot de 37 estados y la esquina del inicio.
* [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — módulos de la UI, RAG v3, i18n, térmica y copia completa.
* [`docs/KNOWN_ISSUES.md`](docs/KNOWN_ISSUES.md) — pendientes, mejoras sugeridas y lo ya resuelto.
* [`CHANGELOG.md`](CHANGELOG.md) — qué cambió en cada tanda de mejoras.

## Seguridad (desde 2.3.0)
* La UI se sirve por `https://appassets.androidplatform.net` (`WebViewAssetLoader`): sin
  `file://`, sin permisos universales de lectura de archivos. Los datos del usuario migran
  solos en el primer arranque (ferry único).
* Las claves API se guardan **cifradas con el Keystore del teléfono** y no bajan al WebView:
  el JS manda `{{key:proveedor}}` y `KiuApiProxy` (Java) inyecta la clave al abrir el socket.
* Las llamadas a la nube y a servidores `http://` locales (Ollama / LM Studio / motor interno)
  salen por el proxy Java: sin mixed-content ni CORS, y `http://` solo permitido a
  localhost / LAN privada.

## Licencia
MIT — ver [`LICENSE`](LICENSE). Si reutilizás ideas o código de proyectos de terceros
(por ejemplo OpenJarvis, Apache-2.0, o el propio llama.cpp, MIT), conservá sus avisos de licencia.
