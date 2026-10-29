#!/usr/bin/env bash
# get-tools.sh — deja la máquina lista para compilar KIU (tanda 8 · v2.7.0).
#
# Instala, en este orden y solo lo que falte (idempotente):
#   1) JDK 17 (Temurin vía apt si no hay java 17)
#   2) Android SDK cmdline-tools + sdkmanager
#   3) platform 34, build-tools, NDK 27.0.12077973 y cmake 3.22.1
#
# Variables de entorno respetadas:
#   ANDROID_HOME / ANDROID_SDK_ROOT  → dónde vive (o vivirá) el SDK
#   KIU_SKIP_JDK=1                   → no tocar el JDK (CI ya lo instaló)
#
# El flujo completo de compilación queda así (CI y local):
#   ./scripts/get-tools.sh       ← este script (herramientas)
#   ./scripts/vendor_llama.sh    ← dependencia nativa (llama.cpp)
#   ./gradlew :app:assembleDebug :app:assembleRelease   ← APK firmado
set -euo pipefail
cd "$(dirname "$0")/.."

SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/android-sdk}}"
NDK_VER="27.0.12077973"
CMAKE_VER="3.22.1"
PLATFORM="android-34"
BUILD_TOOLS="34.0.0"

log() { echo ">> $*"; }

# ---------- 1) JDK 17 ----------
if [ "${KIU_SKIP_JDK:-0}" != "1" ]; then
  if java -version 2>&1 | grep -q '"17\.'; then
    log "JDK 17 ya está instalado: $(java -version 2>&1 | head -1)"
  elif command -v apt-get >/dev/null 2>&1; then
    log "instalando JDK 17 (openjdk-17-headless)…"
    if [ "$(id -u)" = "0" ]; then apt-get update -qq && apt-get install -y -qq openjdk-17-jdk-headless; else sudo apt-get update -qq && sudo apt-get install -y -qq openjdk-17-jdk-headless; fi
  else
    log "SIN JDK 17 y sin apt-get: instalá Temurin 17 y volvé a correr." >&2
    exit 1
  fi
else
  log "KIU_SKIP_JDK=1: no toco el JDK"
fi

# ---------- 2) cmdline-tools + sdkmanager ----------
mkdir -p "$SDK/cmdline-tools"
if [ ! -x "$SDK/cmdline-tools/latest/bin/sdkmanager" ]; then
  log "descargando cmdline-tools…"
  ZIP="$SDK/cmdline-tools.zip"
  URL="https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"
  if command -v curl >/dev/null 2>&1; then curl -fsSL -o "$ZIP" "$URL"; else wget -qO "$ZIP" "$URL"; fi
  UNZIP_DIR="$SDK/.ct-tmp"
  rm -rf "$UNZIP_DIR"; mkdir -p "$UNZIP_DIR"
  if command -v unzip >/dev/null 2>&1; then unzip -q "$ZIP" -d "$UNZIP_DIR"; else python3 -c "import zipfile,sys; zipfile.ZipFile('$ZIP').extractall('$UNZIP_DIR')"; fi
  rm -rf "$SDK/cmdline-tools/latest"
  mv "$UNZIP_DIR/cmdline-tools" "$SDK/cmdline-tools/latest"
  rm -rf "$UNZIP_DIR" "$ZIP"
fi
SDKM="$SDK/cmdline-tools/latest/bin/sdkmanager"

# ---------- 3) paquetes del SDK que el build necesita ----------
accept_licenses() {
  yes | "$SDKM" --licenses >/dev/null 2>&1 || true
}
need=0
for pkg in "platforms;$PLATFORM" "build-tools;$BUILD_TOOLS" "ndk;$NDK_VER" "cmake;$CMAKE_VER" "platform-tools"; do
  case "$pkg" in
    platforms/*) [ -d "$SDK/platforms/${pkg#platforms;}" ] || need=1 ;;
    build-tools/*) [ -d "$SDK/build-tools/${pkg#build-tools;}" ] || need=1 ;;
    ndk/*) [ -d "$SDK/ndk/${pkg#ndk;}" ] || need=1 ;;
    cmake/*) [ -d "$SDK/cmake/${pkg#cmake;}" ] || need=1 ;;
    platform-tools) [ -d "$SDK/platform-tools" ] || need=1 ;;
  esac
done
if [ "$need" = "1" ]; then
  log "instalando platform $PLATFORM, build-tools $BUILD_TOOLS, NDK $NDK_VER, cmake $CMAKE_VER…"
  accept_licenses
  yes | "$SDKM" "platforms;$PLATFORM" "build-tools;$BUILD_TOOLS" "ndk;$NDK_VER" "cmake;$CMAKE_VER" "platform-tools" >/dev/null
else
  log "paquetes del SDK ya instalados"
fi

# ---------- resumen ----------
export ANDROID_HOME="$SDK"
log "SDK:    $SDK"
[ -d "$SDK/ndk/$NDK_VER" ] && log "NDK:    $SDK/ndk/$NDK_VER"
[ -d "$SDK/cmake/$CMAKE_VER" ] && log "CMake:  $SDK/cmake/$CMAKE_VER"
log "listo. Siguiente paso: ./scripts/vendor_llama.sh && ./gradlew :app:assembleDebug"
