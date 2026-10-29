#!/usr/bin/env bash
# Copia el avatar y el logo dentro del repo KIU (clonado en tu PC).
# Uso:  ./apply.sh /ruta/a/KIU
set -e
REPO="${1:-.}"; SRC="$(cd "$(dirname "$0")" && pwd)"
[ -d "$REPO/app" ] || { echo "No encuentro $REPO/app. Uso: ./apply.sh /ruta/a/KIU"; exit 1; }
# copia de seguridad de los iconos que se van a reemplazar
BK="$REPO/.icon-backup"; mkdir -p "$BK"
find "$REPO/app/res" -path '*mipmap*' \( -name 'ic_launcher*.png' -o -name 'ic_launcher*.xml' \) 2>/dev/null | while read -r f; do
  mkdir -p "$BK/$(dirname "${f#$REPO/}")"; cp "$f" "$BK/${f#$REPO/}"; done
cp -r "$SRC/app/." "$REPO/app/"
mkdir -p "$REPO/store" "$REPO/docs"
cp "$SRC/store/"* "$REPO/store/"; cp "$SRC/docs/"* "$REPO/docs/"
echo "✔ Avatar:  app/assets/www/js/kiu-avatar.js"
echo "✔ Logo:    app/res/mipmap-*/ic_launcher*.png + mipmap-anydpi-v26/*.xml"
echo "✔ Play:    store/kiu-icon-512.png   ·  copia de iconos viejos en .icon-backup/"
M="$REPO/app/AndroidManifest.xml"
if [ -f "$M" ]; then
  echo; echo "Manifest (debe apuntar a estos nombres):"; grep -o 'android:\(icon\|roundIcon\)="[^"]*"' "$M" || echo "  (sin android:icon: añade android:icon=\"@mipmap/ic_launcher\" android:roundIcon=\"@mipmap/ic_launcher_round\" en <application>)"
fi
IDX="$REPO/app/assets/www/index.html"
if [ -f "$IDX" ]; then
  if grep -q kiu-avatar-boot "$IDX"; then echo "index.html ya carga kiu-avatar-boot.js"; else
    cp "$IDX" "$IDX.bak"
    python3 - "$IDX" <<'PY'
import re,sys
p=sys.argv[1]; h=open(p,encoding='utf-8').read()
# v2.8.0: kiu-estados.js (controlador de estados) tiene que cargarse ANTES de kiu-avatar.js
tag='<script src="js/kiu-estados.js"></script>\n<script src="js/kiu-avatar-boot.js"></script>\n'
m=re.search(r'<script[^>]*src="[^"]*app\.js[^"]*"',h)
h=(h[:m.start()]+tag+h[m.start():]) if m else h.replace('</body>',tag+'</body>',1)
open(p,'w',encoding='utf-8').write(h); print("✔ index.html: añadidas las líneas kiu-estados.js + kiu-avatar-boot.js (copia en index.html.bak)")
PY
  fi
else echo "No encuentro index.html: añade <script src=\"js/kiu-estados.js\"></script> y <script src=\"js/kiu-avatar-boot.js\"></script> antes de js/app/app-ui.js"; fi
echo; echo "Listo. Guía: docs/AVATAR_Y_LOGO.md"
