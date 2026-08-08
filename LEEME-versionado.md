# AXONTECH · Auto-versionado

## Cómo publicar cambios

Cuando modifiques **cualquier archivo** del proyecto (app.js, app.css, index.html, admin.html, sw.js), solo tienes que hacer 2 cosas:

```bash
# 1. Generar la nueva versión (calcula el hash y sube la versión automáticamente)
python3 build.py

# 2. Subir TODA la carpeta AXONTECH-main/ al servidor
```

Eso es todo. No necesitas editar números de versión manualmente en ningún lado.

## ¿Cómo funciona?

1. `build.py` calcula un hash SHA-256 combinado de los archivos críticos.
2. Compara con el hash guardado en `version.json`.
3. **Si son iguales** → no hay cambios reales, no hace nada.
4. **Si son diferentes** → incrementa la versión automáticamente y actualiza:
   - `version.json` (nueva versión, nuevo hash, fecha)
   - `sw.js` (`APP_VERSION` y `CACHE`)
   - `app.js` (`APP_VERSION` y `_LOCAL_BUILD_HASH`)
   - `index.html` (`?v=N` en CSS y JS)
   - `admin.html` (`?v=N` en CSS y JS)

## ¿Cómo se enteran los usuarios?

- La app consulta `version.json` cada 5 minutos automáticamente.
- Si la versión remota es mayor que la local, aparece un banner verde: **"🔄 Nueva versión disponible"** con dos botones:
  - **Recargar ahora** → descarga la nueva versión sin caché
  - **Más tarde** → pospone el aviso
- El usuario también puede tocar el badge `v3` (arriba a la izquierda) para verificar manualmente.

## Archivos críticos (su cambio dispara nueva versión)

- `app.js`
- `app.css`
- `index.html`
- `admin.html`
- `sw.js`

## Forzar una nueva versión (sin cambios reales)

Si por algún motivo necesitas forzar que todos los usuarios recarguen (por ejemplo, para limpiar la caché del navegador):

```bash
rm version.json
python3 build.py
```

Esto empezará una nueva versión desde 1.
