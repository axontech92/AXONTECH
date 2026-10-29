# =============================================================================
# KIU — reglas ProGuard/R8 (v2.7.0 · tanda 8)
#
# Estado del build: isMinifyEnabled = false en release (build.gradle.kts), así
# que hoy R8 no corre. Estas reglas quedan BLINDADAS por si se activa la
# ofuscación/shrinking más adelante: con ellas, habilitar minify no rompe el
# puente JS↔Java ni el motor nativo. Son las tres superficies que R8 rompería:
#
#   1) métodos @JavascriptInterface (los llama JS por NOMBRE desde la WebView),
#   2) métodos native (los llama el C++ de app/src/main/cpp por NOMBRE JNI),
#   3) clases/métodos que el C++ busca por reflexión JNI (FindClass +
#      GetStaticMethodID): KiuStream.onToken para el streaming por push.
#
# Regla de oro si se tocaran: nada que atraviese la frontera WebView→Java→C++
# puede cambiar de nombre.
# =============================================================================

# --- 1) Puente JS → Java: métodos anotados con @JavascriptInterface ----------
# Los llama JS como window.KiuBridge.metodo(...) por nombre exacto. Aplica a
# cualquier clase (hoy: MainActivity$Bridge) por si el puente se parte en más
# clases en el futuro.
-keepattributes *Annotation*
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
# La clase contenedora del puente y sus campos quedan intactos también.
-keep class com.kiu.agent.MainActivity$* { *; }
-keep class com.kiu.agent.KiuJsPost { *; }

# --- 2) Java → C++: métodos native de KiuNative ------------------------------
# kiullama_jni.cpp implementa Java_com_kiu_agent_KiuNative_<metodo>: el nombre
# del método ES el contrato del JNI; ofuscarlo = UnsatisfiedLinkError al cargar
# el modelo. (KiuCrypto/DexSafe no tienen native; si se agregaran, esta regla
# por paquete los cubre igual.)
-keepclasseswithmembernames class com.kiu.agent.** {
    native <methods>;
}
-keep class com.kiu.agent.KiuNative { *; }

# --- 3) C++ → Java (reflexión JNI inversa): streaming por push ---------------
# kiullama_jni.cpp hace FindClass("com/kiu/agent/KiuStream") +
# GetStaticMethodID(cls, "onToken", "(Ljava/lang/String;)V"): ni la clase ni
# el método estático pueden renombrarse ni eliminarse.
-keep class com.kiu.agent.KiuStream {
    public static void onToken(java.lang.String);
}

# --- Estado compartido del motor que KiuGenJob/MainActivity leen directamente --
-keep class com.kiu.agent.KiuGenJob { *; }

# --- 4) Wake word local (Vosk): carga clases por reflexión vía JNA -----------
-keep class org.vosk.** { *; }
-keep class com.sun.jna.** { *; }
-dontwarn com.sun.jna.**
-dontwarn org.vosk.**

# --- 5) Red de seguridad general del agente ----------------------------------
# El paquete completo del agente se mantiene con nombres originales: el APK es
# de un solo módulo, el ahorro de ofuscar ~20 clases es marginal y el costo de
# romper el puente en producción es alto. Si algún día se quiere afinar,
# empezá por reemplazar esta línea y quedate con las reglas 1-3.
-keep class com.kiu.agent.** { *; }

# R8: mantener líneas de origen para los stacktraces del logcat
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
