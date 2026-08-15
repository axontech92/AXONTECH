#!/usr/bin/env python3
# ══════════════════════════════════════════════════════════════════
#  AXONTECH · AUTO-VERSION BUILD SCRIPT
# ══════════════════════════════════════════════════════════════════
#  Uso:  python3 build.py
#
#  Qué hace:
#  1. Calcula un hash SHA-256 combinado de los archivos críticos:
#     app.js, app.css, index.html, admin.html, sw.js
#  2. Compara con el hash guardado en version.json.
#     - Si son IGUALES → no hay cambios, no hace nada. Mensaje "Sin cambios".
#     - Si son DIFERENTES → hay cambios, incrementa la versión automáticamente
#       y actualiza TODOS los archivos sincronizados.
#  3. Archivos que actualiza automáticamente cuando hay cambios:
#     - version.json          (nueva versión, nuevo hash, fecha, changelog)
#     - sw.js                  (APP_VERSION y CACHE)
#     - app.js                 (const APP_VERSION)
#     - index.html             (?v=NUEVA en app.css y app.js)
#     - admin.html             (?v=NUEVA en app.css y app.js)
#
#  El admin solo tiene que:
#     1. Hacer sus cambios en cualquier archivo del proyecto
#     2. Ejecutar:  python3 build.py
#     3. Subir TODA la carpeta AXONTECH-main al servidor
#
#  Los usuarios existentes verán el banner verde "Nueva versión disponible"
#  automáticamente en unos 5 minutos (gracias al polling de checkVersion()).
# ══════════════════════════════════════════════════════════════════

import hashlib
import json
import re
import sys
from datetime import datetime
from pathlib import Path

# Carpeta raíz del proyecto (donde está este script)
ROOT = Path(__file__).parent.resolve()

# Archivos críticos cuyo cambio dispara una nueva versión
# catalogo.html se añadió en v62: sw.js lo cachea igual que index.html y
# admin.html (está en su lista STATIC), pero no estaba aquí. Al no contar para
# el hash, tocarlo no subía la versión, la clave de caché no cambiaba y el
# service worker seguía sirviendo la copia vieja: cualquier arreglo del catálogo
# se quedaba sin llegar a los teléfonos. Si un archivo lo cachea el SW, tiene
# que estar en esta lista.
CRITICAL_FILES = ['app.js', 'app.css', 'index.html', 'admin.html', 'sw.js', 'catalogo.html']

# Archivo que guarda la versión y el hash
VERSION_FILE = ROOT / 'version.json'


def normalize_content(content, fname):
    """Normaliza el contenido antes de hashear para que los bumps de versión
    automáticos NO cuenten como cambios reales. Reemplaza todos los indicadores
    de versión por un placeholder constante."""
    if isinstance(content, bytes):
        text = content.decode('utf-8', errors='replace')
    else:
        text = content
    # Reemplazar APP_VERSION = N  (en app.js como entero, en sw.js como string)
    text = re.sub(r'APP_VERSION\s*=\s*[\d\'"]+', 'APP_VERSION = X', text)
    # Reemplazar CACHE = 'axontech-vN'
    text = re.sub(r"CACHE\s*=\s*'axontech-v\d+'", "CACHE = 'axontech-vX'", text)
    # Reemplazar ?v=N en referencias a CSS/JS
    text = re.sub(r'\./app\.(css|js)\?v=\d+', r'./app.\1?v=X', text)
    # Reemplazar el texto del badge >vN<
    text = re.sub(r'>v\d+<', '>vX<', text)
    # Reemplazar _LOCAL_BUILD_HASH = 'cualquier-cosa' (para que el hash inyectado
    # por build.py no cuente como cambio en la próxima ejecución).
    text = re.sub(r"_LOCAL_BUILD_HASH\s*=\s*'(?:[^'\\]|\\.)*'", "_LOCAL_BUILD_HASH = 'X'", text)
    text = re.sub(r'_LOCAL_BUILD_HASH\s*=\s*null', "_LOCAL_BUILD_HASH = 'X'", text)
    # Reemplazar la versión en version.json (por si se incluye)
    text = re.sub(r'"version"\s*:\s*\d+', '"version": X', text)
    text = re.sub(r'"versionStr"\s*:\s*"v\d+"', '"versionStr": "vX"', text)
    text = re.sub(r'"hash"\s*:\s*"(?:[^"\\]|\\.)*"', '"hash": "X"', text)
    text = re.sub(r'"hashFull"\s*:\s*"(?:[^"\\]|\\.)*"', '"hashFull": "X"', text)
    text = re.sub(r'"releasedAt"\s*:\s*"[^"]*"', '"releasedAt": "X"', text)
    return text.encode('utf-8')


def compute_hash():
    """Calcula un hash SHA-256 combinado de todos los archivos críticos,
    normalizando el contenido para ignorar bumps de versión automáticos."""
    h = hashlib.sha256()
    for fname in CRITICAL_FILES:
        p = ROOT / fname
        if not p.exists():
            print(f'  ⚠️  ADVERTENCIA: {fname} no existe, se omite del hash')
            continue
        raw = p.read_bytes()
        normalized = normalize_content(raw, fname)
        # Incluir el nombre del archivo en el hash para que renombrar también cuente
        h.update(fname.encode('utf-8'))
        h.update(b'\x00')
        h.update(normalized)
        h.update(b'\x00')
    return h.hexdigest()[:16]  # 16 chars = 64 bits, suficiente


def read_current_version():
    """Lee la versión actual de version.json. Devuelve (version, hash) o (None, None)."""
    if not VERSION_FILE.exists():
        return None, None
    try:
        data = json.loads(VERSION_FILE.read_text(encoding='utf-8'))
        return data.get('version'), data.get('hash')
    except Exception as e:
        print(f'  ⚠️  version.json corrupto: {e}')
        return None, None


def write_version_json(new_version, new_hash, changelog=None):
    """Escribe version.json con la nueva versión y hash."""
    if changelog is None:
        changelog = [f'Actualización automática · build {new_hash[:8]}']
    data = {
        'version': new_version,
        'versionStr': f'v{new_version}',
        'hash': new_hash,
        'hashFull': new_hash,
        'releasedAt': datetime.now().strftime('%Y-%m-%d %H:%M'),
        'files': CRITICAL_FILES,
        'changelog': changelog
    }
    VERSION_FILE.write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + '\n',
        encoding='utf-8'
    )
    print(f'  ✓ version.json actualizado → v{new_version} (hash {new_hash[:8]})')


def update_sw_js(new_version):
    """Actualiza APP_VERSION y CACHE en sw.js."""
    p = ROOT / 'sw.js'
    content = p.read_text(encoding='utf-8')
    content = re.sub(
        r"const APP_VERSION\s*=\s*'\d+';",
        f"const APP_VERSION  = '{new_version}';",
        content
    )
    content = re.sub(
        r"const CACHE\s*=\s*'axontech-v\d+';",
        f"const CACHE = 'axontech-v{new_version}';",
        content
    )
    p.write_text(content, encoding='utf-8')
    print(f'  ✓ sw.js actualizado → APP_VERSION={new_version}, CACHE=axontech-v{new_version}')


def update_app_js(new_version, new_hash):
    """Actualiza const APP_VERSION y _LOCAL_BUILD_HASH en app.js."""
    p = ROOT / 'app.js'
    content = p.read_text(encoding='utf-8')
    content = re.sub(
        r"const APP_VERSION\s*=\s*\d+;",
        f"const APP_VERSION = {new_version};",
        content
    )
    # Inyectar el hash local para que checkVersion() pueda comparar hashes
    # además de números de versión.
    content = re.sub(
        r"let _LOCAL_BUILD_HASH\s*=\s*(null|'[^']*'|\"[^\"]*\");",
        f"let _LOCAL_BUILD_HASH = '{new_hash}';",
        content
    )
    p.write_text(content, encoding='utf-8')
    print(f'  ✓ app.js actualizado → APP_VERSION={new_version}, _LOCAL_BUILD_HASH={new_hash[:8]}')


def update_html_query_version(html_file, new_version):
    """Actualiza ?v=N en las referencias a app.css y app.js dentro de un HTML."""
    p = ROOT / html_file
    content = p.read_text(encoding='utf-8')
    # Reemplazar ./app.css?v=N y ./app.js?v=N (con cualquier número)
    content = re.sub(
        r'\./app\.css\?v=\d+',
        f'./app.css?v={new_version}',
        content
    )
    content = re.sub(
        r'\./app\.js\?v=\d+',
        f'./app.js?v={new_version}',
        content
    )
    # También actualizar el texto del badge versionBadge si existe
    content = re.sub(
        r'(<span[^>]*id="versionBadge"[^>]*>)v\d+(</span>)',
        rf'\g<1>v{new_version}\g<2>',
        content
    )
    p.write_text(content, encoding='utf-8')
    print(f'  ✓ {html_file} actualizado → ?v={new_version} en app.css y app.js')


def main():
    print('═══════════════════════════════════════════════════════')
    print('  AXONTECH · AUTO-VERSION BUILD')
    print('═══════════════════════════════════════════════════════')
    print()

    # 1. Calcular hash actual de los archivos críticos
    print('1. Calculando hash de archivos críticos...')
    for f in CRITICAL_FILES:
        p = ROOT / f
        size = p.stat().st_size if p.exists() else 0
        print(f'   · {f:20s} {size:>8,} bytes')
    current_hash = compute_hash()
    print(f'   Hash combinado: {current_hash}')
    print()

    # 2. Leer versión y hash guardados
    print('2. Leyendo versión actual...')
    current_version, saved_hash = read_current_version()
    if current_version is None:
        current_version = 0
        print('   No hay version.json previo. Empezando desde v1.')
    else:
        print(f'   Versión guardada: v{current_version} (hash {saved_hash[:8] if saved_hash else "???"})')
    print()

    # 3. Comparar hashes
    print('3. Comparando hashes...')
    if saved_hash == current_hash and current_version > 0:
        print('   ✅ Sin cambios. Los archivos críticos son idénticos a la última build.')
        print(f'   Versión actual: v{current_version}')
        print()
        print('   Si quieres forzar una nueva versión, borra version.json y vuelve a ejecutar.')
        return 0
    print('   ⚠️  Detectados cambios en los archivos críticos.')
    print()

    # 4. Incrementar versión
    new_version = int(current_version) + 1
    print(f'4. Nueva versión: v{new_version}')
    print()

    # 5. Actualizar todos los archivos sincronizados
    print('5. Actualizando archivos...')
    write_version_json(new_version, current_hash)
    update_sw_js(new_version)
    update_app_js(new_version, current_hash)
    update_html_query_version('index.html', new_version)
    update_html_query_version('admin.html', new_version)
    print()

    print('═══════════════════════════════════════════════════════')
    print(f'  ✅ BUILD COMPLETADA · v{new_version}')
    print('═══════════════════════════════════════════════════════')
    print()
    print('  Próximos pasos:')
    print('   1. Sube TODA la carpeta AXONTECH-main/ al servidor')
    print('   2. Los usuarios verán el banner "Nueva versión disponible"')
    print('      automáticamente en ~5 minutos (o al tocar el badge v' + str(new_version) + ')')
    print()
    return 0


if __name__ == '__main__':
    sys.exit(main())
