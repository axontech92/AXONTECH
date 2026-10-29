#!/usr/bin/env bash
# Compila el APK de KIU con Gradle (estructura estándar Android Studio).
#
# Uso:
#   ./scripts/build.sh                      -> APK debug (rápido, para probar)
#   KIU_PASS=clave ./scripts/build.sh       -> APK release firmado
#
# La primera vez que firmás un release crea keystore/kiu-release.jks.
# GUARDÁ ESA CLAVE: sin ella no vas a poder actualizar la app ya instalada.
#
# Opcionales:
#   KIU_KS=/ruta/keystore.jks  KIU_ALIAS=mi-alias  -> keystore/alias propios
#   ./scripts/vendor_llama.sh (antes) -> compila el motor nativo desde fuente
set -euo pipefail
cd "$(dirname "$0")/.."

chmod +x gradlew

# Motor nativo: con vendor/llama.cpp se compila desde fuente (NDK) y el CMake
# deja las .so en app/src/main/jniLibs/<ABI>; sin vendor, Gradle empaqueta las
# .so precompiladas que haya en esa misma carpeta (fuera de Git).
if [ -d vendor/llama.cpp ]; then
  echo "==> Motor nativo: compilando desde fuente (vendor/llama.cpp)"
elif ls app/src/main/jniLibs/*/*.so >/dev/null 2>&1; then
  echo "==> Motor nativo: .so precompiladas de app/src/main/jniLibs (fuera de Git)."
  echo "    Para recompilarlas desde fuente: ./scripts/vendor_llama.sh"
else
  echo "==> ¡Falta el motor nativo! Corré primero: ./scripts/vendor_llama.sh"
  echo "    (clona llama.cpp y compila los .so con ./gradlew :app:assembleDebug)"
  exit 1
fi

VER=$(sed -n 's/^        versionName = "\(.*\)"/\1/p' app/build.gradle.kts | head -1)
mkdir -p dist

if [ -n "${KIU_PASS:-}" ]; then
  # ---------- release firmado ----------
  KS=${KIU_KS:-keystore/kiu-release.jks}
  if [ ! -f "$KS" ]; then
    mkdir -p "$(dirname "$KS")"
    keytool -genkeypair -keystore "$KS" -storepass "$KIU_PASS" -keypass "$KIU_PASS" \
      -alias "${KIU_ALIAS:-kiu}" -keyalg RSA -keysize 2048 -validity 10000 \
      -dname "CN=Kiu, O=Kiu, C=AR"
    echo "Se creó $KS  -> GUARDALA: sin ella no podrás actualizar la app instalada."
  fi
  export KIU_KS="$KS"
  export KIU_ALIAS="${KIU_ALIAS:-kiu}"
  ./gradlew :app:assembleRelease --no-daemon
  OUT=$(ls app/build/outputs/apk/release/*.apk 2>/dev/null | head -1)
  cp "$OUT" "dist/Kiu-$VER-release.apk"
  echo "==> Listo: dist/Kiu-$VER-release.apk"
else
  # ---------- debug ----------
  ./gradlew :app:assembleDebug --no-daemon
  OUT=$(ls app/build/outputs/apk/debug/*.apk 2>/dev/null | head -1)
  cp "$OUT" "dist/Kiu-$VER-debug.apk"
  echo "==> Listo: dist/Kiu-$VER-debug.apk"
  echo "    (para el release firmado: KIU_PASS=tu-clave ./scripts/build.sh)"
fi
