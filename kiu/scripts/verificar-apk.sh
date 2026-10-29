#!/usr/bin/env bash
# KIU · verificar qué APK estás por instalar (v2.9.4)
# ------------------------------------------------------------------
# Por qué existe: el reporte fue «la versión que se instala con ese archivo es
# 2.7» con el repo ya en 2.9.3. No era un bug del código: el ZIP es solo código
# y no trae las .so del motor (están en .gitignore, 40 MB). El build local desde
# ese ZIP falla, y si se instala igual queda el APK viejo. Sin ninguna señal.
#
# Cada build escribe assets/build-stamp.json adentro del APK. Esto lo lee con
# `unzip -p`: NO hace falta Android SDK, ni aapt, ni apkanalyzer — que es
# justamente cuando uno no lo tiene.
#
#   ./scripts/verificar-apk.sh app/build/outputs/apk/debug/app-debug.apk
#   ./scripts/verificar-apk.sh lo que sea.apk --esperar 2.9.4
#   ./scripts/verificar-apk.sh nuevo.apk --firma el-que-tenes-instalado.apk
#
# Salida: 0 si el APK es el que esperabas, 1 si no.

set -uo pipefail

rojo()  { printf '\033[31m%s\033[0m\n' "$*"; }
verde() { printf '\033[32m%s\033[0m\n' "$*"; }
gris()  { printf '\033[2m%s\033[0m\n' "$*"; }

# while + shift, NO for: `for arg in "$@"` congela la lista al empezar, así que
# el shift del `--esperar` no surte efecto y el valor de --esperar se cuela como si
# fuera el APK. Se_notó probando el script contra un APK de mentira: pedía el
# archivo equivocado. El for parecía correcto y no lo era.
ESPERADA=""
APK=""
FIRMA_REF=""
while [ $# -gt 0 ]; do
  case "$1" in
    --esperar)
      if [ $# -lt 2 ]; then rojo "--esperar necesita un valor (ej: 2.9.4)"; exit 2; fi
      ESPERADA="$2"; shift 2 ;;
    --firma)
      if [ $# -lt 2 ]; then rojo "--firma necesita el APK con el que comparar"; exit 2; fi
      FIRMA_REF="$2"; shift 2 ;;
    -h|--help) sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    --*) rojo "Opción desconocida: $1"; exit 2 ;;
    *) [ -n "$APK" ] && { rojo "Sobraron argumentos: $1"; exit 2; }; APK="$1"; shift ;;
  esac
done

if [ -z "$APK" ]; then
  rojo "Falta el APK."
  gris "Uso: $0 <archivo.apk> [--esperar 2.9.4]"
  exit 2
fi
if [ ! -f "$APK" ]; then
  rojo "No existe: $APK"
  gris "(¿el build terminó? Sin .so nativas el build falla y no hay APK.)"
  exit 2
fi

# ¿es siquiera un APK/ZIP?
if ! unzip -l "$APK" >/dev/null 2>&1; then
  rojo "No es un ZIP válido: $APK"
  gris "Si lo bajaste de un link o lo copiaste de un chat, se pudo haber cortado."
  exit 2
fi

# el motor: sin .so, la app instala pero no puede generar nada
SO=$(unzip -l "$APK" 2>/dev/null | grep -c 'lib/arm64-v8a/.*\.so' || true)

# el sello
SELLADO=$(unzip -p "$APK" assets/build-stamp.json 2>/dev/null || true)

echo
SIN_SELLO=0
if [ -z "$SELLADO" ]; then
  SIN_SELLO=1
  rojo "Este APK NO tiene sello de build."
  gris "Es anterior a v2.9.4, o se reempaquetó. No se puede saber de un vistazo qué es."
else
  VERSION=$(printf '%s' "$SELLADO" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')
  CODE=$(printf    '%s' "$SELLADO" | sed -n 's/.*"versionCode":\([0-9]*\).*/\1/p')
  GIT=$(printf     '%s' "$SELLADO" | sed -n 's/.*"git":"\([^"]*\)".*/\1/p')
  WHEN=$(printf    '%s' "$SELLADO" | sed -n 's/.*"builtAt":"\([^"]*\)".*/\1/p')
  WHERE=$(printf  '%s' "$SELLADO" | sed -n 's/.*"builtHere":"\([^"]*\)".*/\1/p')
  [ -n "$WHERE" ] || WHERE="local"

  echo "  APK     $(basename "$APK")"
  echo "  versión $VERSION  (código $CODE)"
  echo "  commit  $GIT"
  echo "  build   $WHEN  ($WHERE)"
  echo
  gris "  $(du -h "$APK" | cut -f1)  ·  $SO librerías nativas"
  echo
fi

# ¿el modelo de voz? no va en el APK, pero se verifica instalado
[ "$SO" -eq 0 ] && rojo "  SIN librerías nativas: este APK no puede generar. No lo instales."

# v2.14.9 · LA FIRMA. Android NO deja instalar un APK encima de la app ya
# instalada si están firmados con claves distintas: el error del sistema es
# críptico ("no se pudo instalar") y parece que el archivo esté roto. Esto
# compara el certificado de los dos APK y lo dice claro.
if [ -n "$FIRMA_REF" ]; then
  if [ ! -f "$FIRMA_REF" ]; then rojo "  No existe el APK de referencia: $FIRMA_REF"; exit 1; fi
  cert_de() {
    if command -v apksigner >/dev/null 2>&1; then
      apksigner verify --print-certs "$1" 2>/dev/null | sed -n 's/^Signer #1 certificate SHA-256 digest: //p' | head -1
    else
      keytool -printcert -jarfile "$1" 2>/dev/null | sed -n 's/^SHA256: //p' | head -1
    fi
  }
  A=$(cert_de "$APK"); B=$(cert_de "$FIRMA_REF")
  echo
  if [ -z "$A" ] || [ -z "$B" ]; then
    gris "  No pude leer los certificados (falta apksigner). No los comparo."
  elif [ "$A" = "$B" ]; then
    verde "  MISMA firma: este APK se instala encima del que tenés, sin perder tus datos."
    gris "  certificado: $A"
  else
    rojo "  FIRMA DISTINTA: este APK NO se puede instalar encima del que tenés."
    gris "  Android rechaza la actualización entre apps con claves distintas."
    gris "  este:      $A"
    gris "  el otro:   $B"
    gris "  Se arregla firmando este build con la MISMA clave del anterior."
    exit 1
  fi
fi

if [ -n "$ESPERADA" ]; then
  # Sin sello no se puede confirmar nada, y "no pude confirmar" NO es lo mismo que
  # "está bien": con --esperar y sin sello esto tiene que fallar, o el script
  # approveba un APK del que no sabe nada.
  if [ "$SIN_SELLO" = "1" ]; then
    rojo "  ✗ No puedo confirmar que sea la $ESPERADA: este APK no tiene sello."
    gris "    Compilá de nuevo con el código actual, o bajá el APK del release."
    exit 1
  fi
  if [ "$VERSION" = "$ESPERADA" ]; then
    verde "  ✓ Es la $ESPERADA que esperabas."
    exit 0
  fi
  rojo "  ✗ Esperabas $ESPERADA y esto es ${VERSION:-una versión sin sello}."
  gris "    Casi seguro instalaste un APK viejo: la app instalada sigue"
  gris "    diciendo 2.7 aunque el código esté en 2.9.4."
  exit 1
fi

exit 0
