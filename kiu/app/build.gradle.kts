import java.io.File
// v2.9.8: import explícito, y no por prolijidad. Dentro de un .gradle.kts, `java`
// resuelve a la EXTENSIÓN de Gradle (la que configura compileOptions), no al
// paquete java.*. Por eso `java.time.Instant` daba "Unresolved reference: time".
// El import explícito le gana a la extensión. Es el gotcha más caro de Kotlin DSL
// y rompió el build entero por una línea.
import java.time.Instant

// Módulo app de KIU — Java puro + WebView + motor llama.cpp
//
// Dos modos de build (automático, sin configurar nada):
//  1) MODO PREBUILT (por defecto): usa las .so ya compiladas en
//     app/src/main/jniLibs/<ABI> (libkiullama.so + ggml/llama, arm64-v8a).
//     Esos binarios NO viven en Git (.gitignore): se regeneran con el modo
//     fuente o copiándolos de un build previo.
//  2) MODO FUENTE: si existe vendor/llama.cpp, compila el motor y el wrapper
//     JNI (app/src/main/cpp) con NDK + CMake. Ejecutar antes:
//       ./scripts/vendor_llama.sh   (clona llama.cpp en vendor/)
//     Los .so compilados quedan inyectados en app/src/main/jniLibs/<ABI> y el
//     APK los empaqueta directo del pipeline CMake (sin duplicar librerías).
plugins {
    id("com.android.application")
}

/* v2.9.4 · LA VERSIÓN SE DECLARA UNA SOLA VEZ, ACÁ ARRIBA.
   Estaba escrita en defaultConfig y otra vez en el sello de build, y con dos
   lugares donde poner un número aparece el que se queda viejo. Si alguno de los
   dos se desactualiza, el sello miente sobre el APK que estás por instalar —
   que es peor que no tener sello. Las dos cosas leen de acá. */
val kiuVersionName = "2.15.0"
val kiuVersionCode = 101

val llamaDir = File(rootDir, "vendor/llama.cpp")
val buildNative = llamaDir.exists()

// ABIs con .so precompiladas disponibles (app/src/main/jniLibs/<ABI>/*.so, fuera de Git)
val jniLibsDir = File(projectDir, "src/main/jniLibs")
val prebuiltAbis = (jniLibsDir.listFiles { f -> f.isDirectory } ?: emptyArray())
    .filter { dir -> dir.listFiles { f -> f.name.endsWith(".so") }?.isNotEmpty() == true }
    .map { it.name }
    .sorted()

android {
    namespace = "com.kiu.agent"
    compileSdk = 34
    ndkVersion = "27.0.12077973"

    defaultConfig {
        applicationId = "com.kiu.agent"
        minSdk = 24
        targetSdk = 34
        versionCode = kiuVersionCode
        versionName = kiuVersionName

        if (buildNative) {
            ndk {
                // x86_64 permite probar el motor en emulador
                // v2.11.13: el CI pasa -PkiuAbis=arm64-v8a (los celulares son arm64: x86_64 solo sirve para
                // emulador y duplicaba la compilación de C++). Sin la propiedad, todo como antes.
                val abis = (project.findProperty("kiuAbis") as String?)?.split(",")?.map { it.trim() }?.filter { it.isNotEmpty() }
                abiFilters += (abis ?: listOf("arm64-v8a", "x86_64"))
            }
        } else if (prebuiltAbis.isNotEmpty()) {
            ndk {
                // modo prebuilt: solo las ABIs que de verdad hay en jniLibs,
                // así el APK no arrastra ABIs inútiles de los AAR (Vosk/JNA)
                abiFilters += prebuiltAbis
            }
        }
    }

    sourceSets {
        getByName("main") {
            /* v2.9.4 · SELLADO DE BUILD. Ver la nota de kiuBuildStamp más abajo:
               el problema que motivó esto fue instalar un APK viejo sin saberlo.
               El sellado va como asset para que se pueda leer con `unzip -p`,
               sin aapt ni apkanalyzer ni Android SDK. */
            assets.srcDir(layout.buildDirectory.dir("generated/kiuAssets"))
            // jniLibs estándar: app/src/main/jniLibs/<ABI> (ubicación por defecto,
            // no hace falta declararla). En modo fuente se desactiva como origen
            // para no empaquetar cada .so dos veces: el APK toma las del pipeline
            // CMake, que a la vez las inyecta en esa misma carpeta.
            if (buildNative) {
                jniLibs.setSrcDirs(emptyList<String>())
            }
        }
    }

    // Sin vendor y sin precompiladas no hay motor: fallar temprano con la receta.
    if (!buildNative && prebuiltAbis.isEmpty()) {
        throw GradleException(
            "KIU: no hay librerías nativas del motor (app/src/main/jniLibs).\n" +
            "  Recuperarlas: ./scripts/vendor_llama.sh && ./gradlew :app:assembleDebug\n" +
            "  (compila llama.cpp desde fuente y deja los .so en app/src/main/jniLibs/<ABI>)"
        )
    }

    if (buildNative) {
        externalNativeBuild {
            cmake {
                path = file("src/main/cpp/CMakeLists.txt")
                version = "3.22.1"
            }
        }
    }

    signingConfigs {
        // Firma release por entorno (reemplaza al uber-apk-signer del flujo apktool):
        //   KIU_PASS=clave  +  keystore/kiu-release.jks  (o KIU_KS=/ruta KIU_ALIAS=alias)
        // Sin KIU_PASS, assembleRelease firma con la clave debug (solo para probar).
        val ksPath = System.getenv("KIU_KS") ?: "keystore/kiu-release.jks"
        val ksPass = System.getenv("KIU_PASS")
        // Siempre relativo a la raíz del repo: antes el exists() miraba la raíz y
        // file() miraba app/, y por eso decía "Keystore file ... not found".
        val ksFile = rootProject.file(ksPath)
        if (ksPass != null && ksFile.exists()) {
            create("kiu") {
                storeFile = ksFile
                storePassword = ksPass
                keyAlias = System.getenv("KIU_ALIAS") ?: "kiu"
                keyPassword = ksPass
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = if (signingConfigs.findByName("kiu") != null) {
                signingConfigs.getByName("kiu")
            } else {
                signingConfigs.getByName("debug")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        // modelos GGUF y assets grandes: sin compresión agresiva
        jniLibs.useLegacyPackaging = true
    }

    lint {
        abortOnError = false
    }
}

/* v2.9.4 · SELLADO DE BUILD — "qué APK estoy instalando", respondido.

   El reporte fue «la versión que se instala con ese archivo es 2.7» con el repo ya
   en 2.9.3. La causa no era del código: el ZIP es SOLO CÓDIGO y no trae las .so
   del motor (están en .gitignore: 40 MB). Un build local desde ese ZIP falla con
   "no hay librerías nativas", y si el build falla y se instala igual, queda el
   APK viejo. Sin ninguna señal: el error va al scrollback y el APK viejo anda.

   El sellado existe para que esa situación sea imposible de pasar por alto:
   cada build escribe assets/build-stamp.json con versión, código, fecha y commit,
   y hay un script que lo lee del APK con `unzip -p`. No hace falta Android SDK
   para verificar un APK antes de instalarlo — que es justo cuando uno lo tiene. */
val kiuGitSha = runCatching {
    ProcessBuilder("git", "rev-parse", "--short", "HEAD")
        .directory(rootDir).start().let { p ->
            val out = p.inputStream.bufferedReader().readText().trim()
            p.waitFor(); if (out.matches(Regex("[0-9a-f]{7,40}"))) out else "sin-commit"
        }
}.getOrDefault("sin-git")

val kiuBuildStamp by tasks.registering {
    val outDir = layout.buildDirectory.dir("generated/kiuAssets")
    /* Map<String, String> explícito. Con `mapOf(...)` a secas y valores de tipos
       distintos (kiuVersionCode es Int, getenv() devuelve String?), Kotlin infiere
       el tipo común más arriba —Serializable— y el Pair deja de casar con lo que
       espera el joinToString de abajo. Declarar el tipo es la mitad del arreglo;
       la otra es que el build lo dijera, que es exactamente para lo que sirve un CI. */
    val stamp: Map<String, String> = mapOf(
        "version" to kiuVersionName,
        "versionCode" to kiuVersionCode.toString(),
        "git" to kiuGitSha,
        "builtAt" to Instant.now().toString(),
        "builtHere" to (System.getenv("GITHUB_RUN_ID") ?: "local")
    )
    doLast {
        val f = outDir.get().file("build-stamp.json").asFile
        f.parentFile.mkdirs()
        f.writeText(
            stamp.entries.joinToString(",", "{", "}") { "\"${it.key}\":\"${it.value}\"" }
        )
        logger.lifecycle("KIU sellado: v$kiuVersionName (código $kiuVersionCode) commit $kiuGitSha")
    }
}

tasks.matching { it.name.startsWith("merge") && it.name.endsWith("Assets") }.configureEach {
    dependsOn(kiuBuildStamp)
}

dependencies {
    // Wake word local (offline) — motor Vosk + JNA
    implementation("com.alphacephei:vosk-android:0.3.47")
    implementation("net.java.dev.jna:jna:5.13.0@aar")

    // v2.3.0 (sección 2 · seguridad): WebViewAssetLoader — la UI se sirve por
    // https://appassets.androidplatform.net en vez de file://, sin permisos
    // universales de lectura de archivos.
    implementation("androidx.webkit:webkit:1.11.0")
}
