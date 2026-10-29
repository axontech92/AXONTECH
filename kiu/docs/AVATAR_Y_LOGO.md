# Avatar animado y logo de Kiu

## Qué incluye
| Ruta | Qué es |
|---|---|
| `app/src/main/assets/www/js/kiu-avatar.js` | Avatar de Kiu: 37 estados, SVG + CSS, sin dependencias, aislado con Shadow DOM |
| `app/src/main/res/mipmap-*/ic_launcher.png`, `ic_launcher_round.png` | Icono clásico (Android 7 y 7.1) |
| `app/src/main/res/mipmap-*/ic_launcher_foreground.png`, `_background.png`, `_monochrome.png` | Capas del icono adaptativo (Android 8+) — las 5 densidades, sin duplicados |
| `app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml`, `ic_launcher_round.xml` | Definición del icono adaptativo |
| `app/src/main/assets/www/img/logo.webp`, `logo_full.webp`, `logo_round.webp` | Logo de marca en WebP (activos, hoy sin referencia en el código) |
| `store/kiu-icon-512.png` | Icono 512×512 para Google Play |
| `docs/kiu-estados.html` | Visor de los 37 estados (ábrelo en el navegador) |

## Instalar
```bash
unzip kiu-avatar-pack.zip && cd kiu-avatar-pack
./apply.sh /ruta/a/KIU        # copia todo y guarda los iconos viejos en .icon-backup/
```

## Arranque automático (lo más fácil)
Una sola línea en `index.html`, **antes** de `app.js`:
```html
<script src="js/kiu-avatar-boot.js"></script>
```
`apply.sh` ya la añade. El script oculta el avatar viejo (sin borrarlo), pone el nuevo en su lugar y cambia el estado
según lo que la app hace con `KiuBridge` (escuchar, hablar, generar, descargar, cargar modelo, alarmas, acciones).
Si no encuentra el avatar viejo, mira la consola: `[kiu-avatar] ...`.

## Usar el avatar a mano
En `app/src/main/assets/www/index.html`:
```html
<div id="kiu-avatar"></div>
<script src="js/kiu-avatar.js"></script>   <!-- antes de app.js -->
```
En `app.js`:
```js
const avatar = KiuAvatar.mount('#kiu-avatar', { size: 160 });
avatar.set('thinking');          // alias corto
avatar.set('Descargando');       // o el nombre exacto del estado
```
Otros métodos: `avatar.get()`, `avatar.pause()`, `avatar.resume()`, `avatar.destroy()`.
Se pausa solo cuando la app pasa a segundo plano y respeta "reducir movimiento" del sistema.

## Dónde llamar a `set()` (según ARCHITECTURE.md)
| Momento en la app | Alias | Estado |
|---|---|---|
| Esperando | `idle` | Inactivo |
| El usuario escribe | `typing` | Entrada |
| Dictando (STT) | `dictating` | Dictando |
| Armando prompt / RAG | `building` | Armando prompt |
| `brain.js` evalúa reglas | `rules` | Reglas offline |
| Ejecuta alarma, llamada, abrir app… | `action` | Acción del dispositivo |
| Router elige proveedor | `routing` | Enrutando |
| Generando (`kiuGen`, Ollama o nube) | `thinking` | Generando |
| Un proveedor falla y se pausa | `paused` | Proveedor en pausa |
| Respuesta mostrada | `done` | Respuesta lista |
| `kiuGenStop()` | `stopped` | Detenido |
| Fallo general | `error` | Error |
| `kiuAvailable()` falso | `unsupported` | Motor no soportado |
| Usando nube/Ollama | `cloud` | Usar nube/Ollama |
| Sin GGUF | `nomodel` | Sin modelo |
| `dlStart` en curso | `download` | Descargando |
| `dlStatus` con error | `downloadError` | Error de descarga |
| Descarga completa | `downloaded` | Descargado |
| `importModel` en curso | `importing` | Importando |
| `kiuLoad` en curso | `loading` | Cargando |
| `kiuIsLoaded()` verdadero | `loaded` | Cargado |
| Generación atascada (`kiuResetBusy`) | `busy` | Ocupado |
| `kiuFree()` | `released` | Liberado |
| Voz en reposo | `muted` | Reposo de voz |
| Palabra de activación (`startWake`) | `wake` | Palabra de activación |
| `listen()` | `listening` | Escuchando |
| `speak()` | `speaking` | Hablando |
| `setHandsFree` activo | `handsfree` | Manos libres |
| `canExactAlarms()` falso | `noalarm` | Sin permiso de alarma exacta |
| `setReminder` guardado | `scheduled` | Programado |
| Recordatorio dispara | `ringing` | Disparado |
| `cancelReminder` | `canceled` | Cancelado |
| `BootReceiver` restaura | `rebooted` | Reprogramado al reiniciar |
| `startTimerNative` | `timer` | Temporizador nativo |
| RAG apagado / indexando / activo | `ragoff` / `indexing` / `rag` | RAG apagado / Indexando / RAG activo |

Si `app.js` ya usa `avatar.js`, no se pisa: el archivo nuevo tiene otro nombre. Puedes migrar poco a poco o reemplazar las llamadas viejas.

> **Actualización (tanda 8):** `avatar.js` fue **eliminado** del proyecto. El bot
> de `kiu-avatar.js` es el único avatar y expone una capa de compatibilidad
> (`KiuAvatar.set/flash/state/pick`) que entiende los nombres de estado viejos.

## Logo
- Fondo morado profundo con brillo coral y estrellas; personaje con antena luminosa y guiño.
- El manifest debe usar `android:icon="@mipmap/ic_launcher"` y `android:roundIcon="@mipmap/ic_launcher_round"`.
- Icono temático (Android 13+): descomenta la línea `<monochrome>` en los dos XML; aapt2 (Gradle)
  lo compila sin problema.
- Los iconos reemplazan archivos con el mismo nombre en `app/src/main/res/`; si agregás recursos
  nuevos no hace falta ningún paso extra (Gradle genera la clase R solo).
- Sin duplicados (v2.6.1): los pares `ic_launcher_bg.png`/`ic_launcher_fg.png` viejos de apktool
  (sin referencias: los XML usan `ic_launcher_background`/`ic_launcher_foreground`) se borraron en
  las 5 densidades, junto con el color huérfano `ic_launcher_bg` de `colors.xml`.

### Logo en WebP (pautas, v2.6.1)
Los tres logos del WebView (`img/logo.*`, `logo_full.*`, `logo_round.*`, 512×512 RGBA) viven en
**WebP con pérdida**: PNG 915 KB → WebP 56 KB (−94 %), y todo lo que está en `assets/www/`
viaja dentro del APK.

Pautas para mantenerlos o regenerarlos:
- Misma dimensión (512×512) y canal alfa intacto (RGBA).
- WebP con pérdida, `quality=82`, `method=6` (máxima búsqueda: mejor compresión a igual calidad).
- Si un logo pasa a usarse en la UI, se referencia `img/logo.webp` (los WebP de assets se
  decodifican nativos en Android/Chromium; no hace falta fallback PNG ni `image-set`).
- Regenerar desde un PNG nuevo:
  ```python
  from PIL import Image
  Image.open("logo.png").save("logo.webp", "WEBP", quality=82, method=6)
  ```
- Hoy no hay ninguna referencia en el código (la esquina y el Acerca de muestran el bot SVG);
  quedan como activos de marca listos para reutilizar (compartir, pantalla Acerca de, store).

## Pruebas pendientes en teléfono
Compilé y probé el avatar y el icono en Chromium de escritorio, no en un APK. Antes de publicar: instalar el APK, ver el icono en el launcher, revisar el avatar dentro del WebView y comprobar el rendimiento en un teléfono modesto.

---

## Avatar nuevo (37 estados) — integración activa

Desde esta tanda, el avatar oficial de la app es el bot SVG de `kiu-avatar.js`
(37 estados con paletas, ojos, bocas, brazos, antena y objetos animados). El
robot blanco de visor de `avatar.js` (13 estados) fue **eliminado** en la
tanda 8: la inicialización quedó unificada en `kiu-avatar-boot.js`.

### Cómo está cableado
- `index.html` carga, en este orden: `brain.js` → `tools.js` → **`kiu-estados.js`** →
  `kiu-avatar.js` → `kiu-avatar-boot.js` → `rag.js` → `app.js`.
- **`kiu-estados.js` (v2.8.0) es el dueño del estado.** Antes había dos dueños y se
  pisaban: el boot envolvía `window.KiuBridge` con un Proxy y adivinaba el estado
  mirando cada llamada al puente, mientras `app-ui`/`motor`/`models` llamaban
  `KiuAvatar.set()` por su cuenta. Ese Proxy se fue: ahora el estado se pone con
  eventos explícitos, por capas y con prioridad.
- `kiu-avatar-boot.js` monta el bot en los tres huecos `[data-avatar]` del index
  (hero, cabecera del chat y tarjeta de perfil) y ajusta el tamaño de cada uno al
  hueco real (con re-ajuste en resize). Nada más.
- Capa de compatibilidad (dentro de `kiu-avatar.js`): la API vieja sigue
  funcionando y se traduce al mapa nuevo. **v2.8.0**: `state()` devuelve el nombre
  real del estado (`'Generando'`, `'Sin modelo'`…) y `oldState()` conserva la vista
  vieja de 13 nombres. Con `KiuAvatar.oldAlias` se ve el mapeo completo.

### El controlador: `KiuState`
```js
KiuState.set(capa, estado, ms?)  // estado pegado de esa capa
KiuState.flash(capa, estado, ms) // aviso momentáneo
KiuState.clear(capa)
KiuState.reset(base)             // vuelve al reposo
KiuState.get()                   // el estado que se ve
KiuState.snapshot()              // qué hay puesto en cada capa
KiuState.on(fn)                  // avisar cuando cambia
```
Prioridades: `err 90 > job 70 > pausa 65 > ruta 60 > voz 50 > tool 35 > flash 30 >
rag 25 > rest 10`. **Un flash solo se ve si no hay nada de mayor prioridad
activo.** `set(capa, estado, ms)` además pone caducidad: si el evento de fin nunca
llega (una promesa colgada), el estado se cae solo.

### Estados y quién los dispara
- **El motor** (`motor.js`): Cargando/Cargado/Error (`Kiu.load`), Generando/Respuesta
  lista/Detenido/Error (`Kiu.ask`, `cancelGen`), Liberado (`unload`, `forceReset`),
  Proveedor en pausa (corte por calor). `ensureLoaded()` **no** toca el avatar.
- **Las descargas** (`models.js`): Descargando/Descargado/Error de descarga/Cancelado
  (`Mod`), Importando (`Imp`). `Sin modelo` en reposo cuando no hay ningún GGUF.
- **La app** (`app-ui.js`): Enrutando (mandar un mensaje, buscar en la web, esperar
  un proveedor), Proveedor en pausa (un proveedor falla), Reglas offline (cerebro
  local o skills), Entrada (escribir **en el chat**), Hablando/Escuchando
  (`nexoTtsStart`/`nexoTtsDone`/`nexoListenStart`/`nexoListenEnd`), Palabra de
  activación, Sin permiso de alarma exacta (diálogo al agendar), Disparado
  (`nexoAlarmFired`), Reprogramado al reiniciar (`kiuTakeRescheduled`), Sin modelo /
  Usar nube/Ollama / Motor no soportado (`App.avatarRest()`).
- **El dispositivo** (`brain.js`): Acción del dispositivo, desde el único punto por
  el que el cerebro toca el puente (`B()`).
- **Los documentos** (`rag.js`): Indexando / RAG activo / RAG apagado (capa pegada).
- **Los temporizadores** (`tools.js`): Temporizador nativo / Disparado.
- **Manuales**: `KiuAvatarBoot.set('…')`, `.hold('…')`, `.flash('…', 3000)`, o
  `KiuState.set('rest', 'Usar nube/Ollama')` con los 37 nombres.

El mapa interactivo completo vive en `docs/kiu-estados.html` (ábirlo en un navegador):
muestra cada estado, su detalle técnico y las transiciones posibles.

## La esquina del inicio (v2.3)

El cuadradito de la esquina superior izquierda del home y el del bloque "Acerca de"
ya no muestran `img/logo.png` (el robot viejo): ahí vive el mismo bot nuevo, montado
con `data-avatar-mini` por `kiu-avatar-boot.js` (`mountMinis()`, 36 px en el topbar y
42 px en Acerca de; el piso de 54 px de `fitSize` no aplica porque el tamaño va fijo).

- Se pintan y reaccionan igual que los grandes: la capa compat (`KiuAvatar.set/flash/…`)
  repinta TODAS las instancias, minis incluidas.
- `.kav-mini` (en `app.css`) deja el cuadrado sin fondo ni sombra para que el bot respire.
- Cambiar el tamaño: `KiuAvatar.mounted()` expone cada host; para los minis el tamaño
  vive en `mountMinis()` (`kiu-avatar-boot.js`).

También se actualizaron todos los rótulos de versión que quedaban viejos:
perfil (`v2.3.0`), bloque Acerca de (`2.3.0`), toast de importación y metadatos
del export de datos.
