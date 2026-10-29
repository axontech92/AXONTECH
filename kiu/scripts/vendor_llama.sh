#!/usr/bin/env bash
# Vendoriza llama.cpp en vendor/llama.cpp para compilar el motor nativo de KIU.
#
# Uso:
#   ./scripts/vendor_llama.sh          # deja vendor/llama.cpp en el commit fijado
#   ./scripts/vendor_llama.sh --show   # imprime pin, tag y estado local; no hace nada
#   ./scripts/vendor_llama.sh --pull   # actualiza al commit fijado (no a master)
#
# v2.9.2 — el pin deja de ser opcional.
#
# Antes esto clonaba `master` y el CI hacía lo mismo. Eso convertía el motor
# nativo en una dependencia flotante: un commit de upstream podía romper el
# build sin que cambiara nada del repo, y no había forma de volver atrás porque
# el repo local ya lo había pisado con `reset --hard`.
#
# No es un riesgo teórico: el propio kiullama_jni.cpp tiene un shim por
# `llama_sampler_init_penalties` porque esa firma YA les cambió una vez.
# Compilar contra master todos los días es esperar el próximo.
#
# POR QUÉ UN TAG Y ADEMÁS UN SHA (y no solo el sha):
#   · el SHA es lo que realmente se compila: es lo único reproducible.
#   · pero `git fetch origin <sha>` no funciona en todos los servidores (hace
#     falta allowAnySHA1InWant), mientras que un TAG es una ref de verdad y se
#     puede traer siempre.
#   · entonces: se trae el tag, y se VERIFICA que el commit sea el esperado.
#     Si alguien movió el tag upstream, el script lo dice con un ruido y para,
#     en vez de compilar código distinto del que creés.
#
# CÓMO SE CAMBIA EL PIN (cuando haga falta, no antes):
#   1) Editar LLAMA_TAG y LLAMA_SHA abajo.
#   2) ./scripts/vendor_llama.sh --pull
#   3) ./gradlew :app:assembleDebug   ← acá se ve si compila
#   4) Si no compila por un cambio de API, shimmealo en el .cpp como se hizo con
#      las penalidades: el shim va en el motor, no se baja el requisito.
set -euo pipefail
cd "$(dirname "$0")/.."

# ---- ÚNICA fuente de verdad del motor nativo. El CI la lee de acá. ----
# upstream release v0.7.0 (2026-10-15)
LLAMA_TAG="v0.7.0"
LLAMA_SHA="620d2225cc436ab0b001e3200e590e3b286ef9ab"

DIR="vendor/llama.cpp"
UPSTREAM="https://github.com/ggml-org/llama.cpp"

estado() {
  echo "pin:  $LLAMA_TAG  ($LLAMA_SHA)"
  if [ -d "$DIR/.git" ] && git -C "$DIR" rev-parse --git-dir >/dev/null 2>&1; then
    local got
    got="$(git -C "$DIR" rev-parse HEAD 2>/dev/null || echo "(sin commit)")"
    echo "local: $got"
    [ "$got" = "$LLAMA_SHA" ] || echo "AVISO: el vendor local NO está en el pin (--pull para arreglarlo)"
  else
    echo "local: (no vendorizado)"
  fi
}

if [ "${1:-}" = "--show" ]; then estado; exit 0; fi

if [ ! -d "$DIR/.git" ]; then
  echo ">> clonando llama.cpp en $LLAMA_TAG…"
  mkdir -p vendor
  git init -q "$DIR"
  git -C "$DIR" remote add origin "$UPSTREAM"
  git -C "$DIR" fetch --depth 1 origin "refs/tags/$LLAMA_TAG:refs/tags/$LLAMA_TAG"
  git -C "$DIR" checkout -q "refs/tags/$LLAMA_TAG"
else
  echo ">> dejando llama.cpp en $LLAMA_TAG…"
  git -C "$DIR" fetch --depth 1 origin "refs/tags/$LLAMA_TAG:refs/tags/$LLAMA_TAG" \
    || git -C "$DIR" fetch origin
  git -C "$DIR" checkout -q -B "pin-$LLAMA_TAG" "refs/tags/$LLAMA_TAG"
fi

GOT="$(git -C "$DIR" rev-parse HEAD)"
if [ "$GOT" != "$LLAMA_SHA" ]; then
  echo "" >&2
  echo "!! El tag $LLAMA_TAG upstream apunta a $GOT, no a $LLAMA_SHA" >&2
  echo "!! Alguien movió el tag. NO se compila nada: revisá upstream y actualizá" >&2
  echo "!! LLAMA_TAG y LLAMA_SHA en este archivo, o poné LLAMA_TAG/LLAMA_SHA por env." >&2
  exit 1
fi
echo ">> OK: llama.cpp en $GOT ($LLAMA_TAG)"

# ---- Inyección nativa ----
# Las .so del motor NO viven en Git (app/src/main/jniLibs está en .gitignore).
# 1) Si existen precompiladas viejas en app/lib (repositorios anteriores a la
#    tanda 7), se trasladan a la ubicación estándar.
# 2) Al compilar con Gradle, el CMake deja las .so frescas en
#    app/src/main/jniLibs/<ABI> y el APK las empaqueta desde ahí.
LIBS_DIR="app/src/main/jniLibs"
OLD_DIR="app/lib/arm64-v8a"
mkdir -p "$LIBS_DIR/arm64-v8a"
if [ -d "$OLD_DIR" ] && ls "$OLD_DIR"/*.so >/dev/null 2>&1; then
  echo ">> migrando .so precompiladas de app/lib a $LIBS_DIR/arm64-v8a (fuera de Git)"
  cp -n "$OLD_DIR"/*.so "$LIBS_DIR/arm64-v8a/" 2>/dev/null || true
fi

echo ">> El build Gradle compila el motor (arm64-v8a + x86_64) al correr: ./gradlew :app:assembleDebug"
echo ">> Los .so compilados quedan en $LIBS_DIR/<ABI>/ (precompiladas reutilizables, fuera de Git)"
