# 🔍 INFORME DE INTEGRIDAD DE DATOS — AXONTECH

**Fecha:** 2026-03-04  
**Alcance:** Análisis de consistencia, integridad y sincronización de datos  
**Archivos revisados:** `app.js` (3146 líneas), `data.json`, `productos.json`, `categorias.json`

---

## 1. PROBLEMAS DE SINCRONIZACIÓN localStorage ↔ Firebase

### 1.1 — `saveVales()` NO escribe en Firebase (diseño asimétrico)

| Atributo | Detalle |
|---|---|
| **Severidad** | 🔴 CRÍTICO |
| **Probabilidad** | 100% — ocurre siempre |
| **Impacto** | Pérdida de vales si localStorage se corrompe antes de que los listeners de Firebase actualicen |

**Descripción:**  
Todas las funciones `saveGestores`, `saveMensajeros`, `saveProductos`, `saveCategorias`, `saveConfig`, `saveNotifs` escriben en localStorage **Y** en Firebase vía `setFB()`. Sin embargo, `saveVales()` (línea 102) **solo** escribe en localStorage:

```js
const saveVales = v => { localStorage.setItem('axon_vales', JSON.stringify(v)); };
```

El comentario dice: *"Remove auto-sync of ALL vales to prevent race conditions. Vales will be synced individually."* Sin embargo, las operaciones individuales (`fbAddVale`, `fbUpdateVale`, `fbRemoveVale`) están protegidas por `if(!isSyncingFromFirebase)`, lo que significa que si la bandera está activa por cualquier listener, la escritura en Firebase se **silencia** sin reintento.

**Escenario de pérdida:**  
1. Gestor envía un vale → `saveVales()` guarda en localStorage, `fbAddVale()` intenta escribir en Firebase.
2. En ese mismo instante, un listener de Firebase dispara y pone `isSyncingFromFirebase = true`.
3. `fbAddVale()` verifica la bandera y **no escribe** en Firebase.
4. La bandera se pone `false` pero el vale ya no se re-intenta.
5. Si el navegador pierde localStorage (presión de memoria, limpieza, crash), el vale desaparece completamente.

**Recomendación:**  
- Implementar una cola de escritura diferida para vales en Firebase.
- Agregar reintento automático cuando `isSyncingFromFirebase` estaba activo.
- Considerar usar `firebase.database().ref().push()` con ID generadas por Firebase en lugar de `Date.now()`.

---

### 1.2 — La bandera `isSyncingFromFirebase` es global y compartida entre TODOS los listeners

| Atributo | Detalle |
|---|---|
| **Severidad** | 🔴 CRÍTICO |
| **Probabilidad** | Alta (30-50% en uso concurrente) |
| **Impacto** | Pérdida silenciosa de escrituras en Firebase; datos divergen entre localStorage y Firebase |

**Descripción:**  
La variable `isSyncingFromFirebase` (línea 33) es una **única bandera booleana global** compartida entre:

1. **7 listeners base** (líneas 204-226): `gestores`, `mensajeros`, `productos`, `categorias`, `config`, `notifs`, `ranking_summary`
2. **1 listener admin de vales** (líneas 231-256): escucha TODOS los vales
3. **1 listener gestor de vales** (líneas 121-164): escucha SOLO SUS vales
4. **3 operaciones individuales**: `fbAddVale`, `fbUpdateVale`, `fbRemoveVale` (líneas 167-169)
5. **`setFB()` helper** (línea 94): usado por todas las funciones `save*`

**Escenario de conflicto:**

```
Tiempo  Listener A (gestores)         Listener B (vales gestor)        Operación del usuario
──────  ─────────────────────         ────────────────────────        ────────────────────
t1      isSyncing=true                                                                 
t2      localStorage.setItem(...)                                                     
t3                                      isSyncing=true ← ¡YA ERA true!                  
t4                                      localStorage.setItem(...)     fbAddVale() → SKIP
t5      isSyncing=false                                                                
t6                                      isSyncing=false               (vale NUNCA se escribió)
```

Cuando dos listeners disparan casi simultáneamente, el segundo ve `isSyncingFromFirebase = true` (puesto por el primero) y por lo tanto `fbAddVale()` / `fbUpdateVale()` / `fbRemoveVale()` se silencian. Luego, cuando el primer listener termina y pone la bandera en `false`, ya es tarde — la operación individual nunca se reintentó.

**Recomendación:**  
- Usar un **contador de profundidad** (`syncDepth++` / `syncDepth--`) en lugar de un booleano.
- O mejor aún, usar una bandera **por tipo de dato** (ej: `syncingNodes = new Set()`) para que un listener de productos no bloquee la escritura de vales.
- Agregar un mecanismo de **reintento en cola** para operaciones saltadas.

---

### 1.3 — Listener admin de vales vs listener gestor de vales sobreescriben el mismo localStorage

| Atributo | Detalle |
|---|---|
| **Severidad** | 🟡 ALTO |
| **Probabilidad** | Alta en páginas con admin activo |
| **Impacto** | Datos de vales inconsistentes si se abre admin.html en múltiples pestañas |

**Descripción:**  
En la página admin, el listener global de vales (línea 231) escribe TODOS los vales aplanados en `localStorage.axon_vales`. Pero si un gestor también está conectado (lo cual es posible si se usa `admin.html` con un gestor activo), `listenToMyVales()` (línea 121) escribe SOLO SUS vales en el **mismo** key `axon_vales`, sobreescribiendo los vales de otros gestores.

**Recomendación:**  
- En la página admin, NO usar `listenToMyVales()`. Usar solo el listener global.
- O separar los keys: `axon_vales_admin` vs `axon_vales_gestor_{id}`.

---

### 1.4 — El listener admin recalcula y escribe `ranking_summary` en cada evento de vales

| Atributo | Detalle |
|---|---|
| **Severidad** | 🟡 MEDIO |
| **Probabilidad** | 100% en cada cambio de vales |
| **Impacto** | Escrituras innecesarias en Firebase; posible activación circular de listeners |

**Descripción:**  
En la línea 250, dentro del listener admin de vales, se ejecuta `db.ref('ranking_summary').set(summary)`. Esto escribe en Firebase, lo que activa el listener de `ranking_summary` (línea 204), que a su vez llama a `refreshUI()`. Si `refreshUI()` genera algún cambio de datos (no debería, pero es posible), se crearía un ciclo.

**Recomendación:**  
- Mover el cálculo de ranking fuera del listener, hacerlo bajo demanda o con debounce.

---

## 2. ESCENARIOS DE RACE CONDITIONS

### 2.1 — Dos gestores envían vales simultáneamente

| Atributo | Detalle |
|---|---|
| **Severidad** | 🔴 CRÍTICO |
| **Probabilidad** | Media-alta en horas pico |
| **Impacto** | Números de vale duplicados, vales perdidos |

**Descripción:**  
`getNextValeNum()` (líneas 296-301) lee y escribe en localStorage sin atomicidad:

```js
function getNextValeNum() {
  const cfg = getConfig();
  const n = (cfg.nextValeNum || 1);
  saveConfig({...cfg, nextValeNum: n + 1});  // ← también escribe en Firebase
  return n;
}
```

Si dos gestores envían un vale en el mismo milisegundo:
- Ambos leen `nextValeNum = 5`
- Ambos asignan `valeNum = 5` a su vale
- Ambos escriben `nextValeNum = 6`
- Resultado: **dos vales con el mismo número**

**Recomendación:**  
- Usar `firebase.database().ref('config/nextValeNum').transaction()` para incremento atómico.
- O usar un generador de IDs basado en timestamp + gestorId + random.

---

### 2.2 — Admin confirma un vale mientras el gestor lo está viendo

| Atributo | Detalle |
|---|---|
| **Severidad** | 🟡 MEDIO |
| **Probabilidad** | Alta |
| **Impacto** | UI del gestor muestra estado obsoleto; puede intentar cancelar un vale ya confirmado |

**Descripción:**  
Cuando el admin confirma un vale (línea 1194), se ejecuta `patchVale()` que actualiza localStorage y Firebase. El listener del gestor eventualmente recibe la actualización y llama a `refreshUI()`. Sin embargo, entre el momento en que el admin confirma y el gestor ve la actualización, el gestor podría:

1. Ver el vale como "pending" cuando ya está "confirmed"
2. Intentar cancelarlo (línea 1433) — la función verifica `v.status !== 'pending'` y lo rechaza, pero la experiencia es confusa
3. No ver la notificación push si el listener aún no ha procesado el cambio

**Recomendación:**  
- Implementar optimistic UI updates en el lado del gestor.
- Agregar verificación de estado actual en Firebase antes de cualquier operación de cancelación.

---

### 2.3 — Descuento de stock no es atómico

| Atributo | Detalle |
|---|---|
| **Severidad** | 🔴 CRÍTICO |
| **Probabilidad** | Media en operaciones concurrentes |
| **Impacto** | Stock negativo o inconsistente; productos vendidos que no existían |

**Descripción:**  
En `confirmSale()` (líneas 1194-1241), el descuento de stock se hace leyendo el array de productos, modificando en memoria, y escribiendo de vuelta:

```js
const prods = getProductos();  // ← leer
// ... modificar cada producto ...
localStorage.setItem('axon_productos', JSON.stringify(prods));  // ← escribir
db.ref('productos').set(prods);  // ← escribir Firebase
```

Si dos ventas se confirman simultáneamente (ej: admin confirma dos vales rápido):
- Ambas leen `stock = 3`
- Ambas calculan `newStock = 2`
- Ambas escriben `stock = 2`
- Resultado: **se vendieron 2 unidades pero el stock bajó solo 1**

**Recomendación:**  
- Usar `firebase.database().ref('productos/{id}/stock').transaction()` para decremento atómico.
- Implementar verificación de stock disponible antes de confirmar, con lock optimista.

---

### 2.4 — `refreshUI()` se llama excesivamente y puede causar renderizado corrupto

| Atributo | Detalle |
|---|---|
| **Severidad** | 🟡 MEDIO |
| **Probabilidad** | Alta |
| **Impacto** | UI parpadeante, datos visualmente inconsistentes, posible pérdida de estado de formularios |

**Descripción:**  
Cada listener de Firebase llama a `refreshUI()` (línea 171) al recibir cualquier cambio. Con 8+ listeners activos, un solo cambio de dato puede disparar 8 llamadas a `refreshUI()`, cada una re-renderizando múltiples secciones del DOM. Esto puede:

1. Causar que una sección se renderice con datos parcialmente actualizados
2. Interferir con inputs activos (ej: el admin escribiendo una nota)
3. Generar parpadeo visual ( especialmente en la lista de vales)

**Recomendación:**  
- Implementar `debounce()` en `refreshUI()` (ej: esperar 100ms antes de renderizar).
- Usar un sistema de "dirty flags" más granular para solo re-renderizar secciones afectadas.

---

## 3. ESCENARIOS DE PÉRDIDA DE DATOS

### 3.1 — localStorage puede ser vaciado por el navegador

| Atributo | Detalle |
|---|---|
| **Severidad** | 🔴 CRÍTICO |
| **Probabilidad** | Baja-media (5-15% en dispositivos con poca memoria) |
| **Impacto** | Pérdida total de datos si Firebase no tiene copia completa |

**Descripción:**  
localStorage tiene un límite de ~5MB por origen. Los navegadores pueden vaciarlo bajo presión de memoria, especialmente en móviles. Dado que el sistema guarda **imágenes comprimidas en base64** dentro de productos (líneas 1959-1982, ~50-100KB cada una), el límite se alcanza rápidamente.

Si el localStorage se vacía y Firebase no tiene la información más reciente (por ejemplo, vales que se guardaron solo en localStorage vía `saveVales()`), esos datos se pierden permanentemente.

**Recomendación:**  
- No almacenar imágenes en localStorage. Usar Firebase Storage o URLs externas.
- Implementar un mecanismo de "write-ahead log" que escriba primero en Firebase y luego actualice localStorage.
- Monitorear el uso de localStorage con `navigator.storage.estimate()`.

---

### 3.2 — Sin soporte de transacciones — crash mid-write corrompe datos

| Atributo | Detalle |
|---|---|
| **Severidad** | 🟡 ALTO |
| **Probabilidad** | Baja pero catastrófica cuando ocurre |
| **Impacto** | JSON malformado en localStorage; app no carga |

**Descripción:**  
`localStorage.setItem()` no es transaccional. Si la app crashea o el navegador se cierra entre la lectura de un JSON y su escritura, el dato queda en un estado inconsistente. Peor aún, `JSON.stringify()` de datos muy grandes puede fallar parcialmente.

Ejemplo: si durante `saveVales()` el navegador crashea después de `localStorage.setItem()` pero el JSON estaba siendo construido, el key `axon_vales` podría quedar con un string truncado, y `JSON.parse()` lanzaría un error en el próximo `getVales()`, haciendo que **toda la app falle al cargar**.

**Recomendación:**  
- Implementar escritura en dos fases: escribir en `axon_vales_new`, luego renombrar a `axon_vales`.
- Agregar try-catch alrededor de todos los `JSON.parse()` con fallback a datos de Firebase.
- Agregar un mecanismo de recovery al inicio de la app.

---

### 3.3 — Múltiples pestañas causan conflictos

| Atributo | Detalle |
|---|---|
| **Severidad** | 🟡 ALTO |
| **Probabilidad** | Alta si el admin trabaja con múltiples pestañas |
| **Impacto** | Datos sobreescriben mutuamente; "last write wins" |

**Descripción:**  
No hay ningún mecanismo de sincronización entre pestañas. Si el admin tiene dos pestañas de `admin.html` abiertas:

1. Pestaña A lee vales: `[V1, V2, V3]`
2. Pestaña B lee vales: `[V1, V2, V3]`
3. Pestaña A confirma V2 → escribe `[V1, V2(confirmed), V3]` a localStorage y Firebase
4. Pestaña B confirma V1 → escribe `[V1(confirmed), V2, V3]` (con V2 still pending) a localStorage y Firebase
5. Resultado: **V2 vuelve a "pending"** en Firebase

**Recomendación:**  
- Escuchar el evento `storage` de localStorage para detectar cambios de otras pestañas.
- Implementar merge strategies (merge por vale individual en lugar de reemplazo total).
- Usar Firebase como única fuente de verdad y localStorage solo como caché de lectura.

---

### 3.4 — Importación desde GitHub/archivo sobreescribe datos en edición

| Atributo | Detalle |
|---|---|
| **Severidad** | 🟡 ALTO |
| **Probabilidad** | Media |
| **Impacto** | Datos nuevos se pierden silenciosamente |

**Descripción:**  
`importData()` (línea 2652) y `loadFromGitHub()` (línea 2760) reemplazan **todos** los datos locales sin verificar si hay cambios más recientes. Si un gestor acaba de enviar un vale y el admin importa datos, ese vale se pierde.

`loadFromGitHub()` muestra un `confirm()` pero no advierte sobre vales pendientes específicos.

**Recomendación:**  
- Implementar merge en lugar de reemplazo.
- Alertar al usuario sobre la cantidad de datos locales que se perderían.
- Hacer backup automático antes de cualquier importación.

---

## 4. PROBLEMAS DE CONSISTENCIA DE DATOS

### 4.1 — Contraseñas de gestores en TEXTO PLANO

| Atributo | Detalle |
|---|---|
| **Severidad** | 🔴 CRÍTICO (SEGURIDAD) |
| **Probabilidad** | 100% — ocurre siempre |
| **Impacto** | Cualquier persona con acceso a Firebase o localStorage puede ver todas las contraseñas |

**Descripción:**  
En `data.json` y en Firebase, las contraseñas de gestores se almacenan en texto plano:

```json
{"name": "Rafael", "password": "613YUL"}
{"name": "Brianna", "password": "WTWUNH"}
```

Además, la contraseña del admin se almacena como Base64 (línea 595):
```js
btoa(input) === (localStorage.getItem('axon_admin_hash') || btoa('axon2024'))
```
Base64 **no es cifrado** — es trivialmente reversible. La contraseña por defecto "axon2024" es conocida.

Las contraseñas se muestran en la UI del admin (línea 839) y se envían a Firebase sin protección.

**Recomendación:**  
- Hashear contraseñas con bcrypt o Argon2 antes de almacenarlas.
- Nunca mostrar contraseñas en la UI — solo permitir reseteo.
- Implementar rate limiting para prevenir ataques de fuerza bruta.

---

### 4.2 — Incompatibilidad de esquema entre `productos.json` y `app.js`

| Atributo | Detalle |
|---|---|
| **Severidad** | 🟡 ALTO |
| **Probabilidad** | 100% al usar `syncFromTiendaMax()` |
| **Impacto** | Pérdida de datos durante conversión; comportamiento impredecible |

**Descripción:**  
`productos.json` usa un esquema diferente al que `app.js` espera internamente:

| Campo | `productos.json` (TiendaMax) | `app.js` (interno) |
|---|---|---|
| Nombre | `nombre` | `name` |
| Precio | `precioActual` (número) | `precio` (string "$270 USD") |
| Imagen | `imagen` (URL) | `photo` (URL o base64) |
| Comisión | `comision` (número: `10`) | `comision` (string: "$10 USD") |
| Descripción | `descripcion` | `description` |
| Categoría | `categoria` (string: "ENERGIA") | `catId` (número: `20`) |
| Subcategoría | `subcategoria` | No existe |
| Descuento | `descuento` | No existe |
| Más vendido | `masVendido` | No existe |
| Usado | `usado` | No existe |
| Precio original | `precioOriginal` | No existe |
| Nombre normalizado | `nombreNormalizadoAt` | No existe |

La función `syncFromTiendaMax()` (línea 2577) realiza la conversión, pero:

1. **Pierde datos**: `descuento`, `masVendido`, `usado`, `precioOriginal`, `subcategoria`, `nombreNormalizadoAt` se descartan
2. **Convierte mal la moneda**: Todos los precios se convierten a USD, incluso si el original estaba en MN (pesos cubanos)
3. **Calcula puntos incorrectamente**: `puntos: Math.max(1, Math.round(com / 5))` — un producto con comisión de $3 USD obtiene 1 punto, pero uno con comisión de $50 obtiene 10 puntos. La relación no es proporcional al precio.
4. **No maneja productos con precio en MN**: Si `precioActual` es en MN, se muestra como "$270 USD" lo cual es incorrecto

**Recomendación:**  
- Preservar todos los campos del esquema original en un campo `raw` o `_tiendaMax`.
- Soportar precios en múltiples monedas (USD y MN).
- Revisar la fórmula de cálculo de puntos.
- Implementar un esquema unificado con migración automática.

---

### 4.3 — Incompatibilidad de esquema entre `categorias.json` y `app.js`

| Atributo | Detalle |
|---|---|
| **Severidad** | 🟡 MEDIO |
| **Probabilidad** | 100% al usar `syncFromTiendaMax()` |
| **Impacto** | IDs de categoría inestables; productos se desvinculan de categorías |

**Descripción:**  
`categorias.json` tiene una estructura plana:
```json
{"nombres": ["WIFI", "ENERGIA", ...], "iconos": {"LENCERIA": "👙", ...}}
```

Pero `app.js` espera categorías como objetos con `id` y `name`:
```js
{id: 10, name: "Wifi"}
```

`syncFromTiendaMax()` genera IDs como `(i + 1) * 10`, lo que significa:
- Si el orden en `categorias.json` cambia, **todos los IDs cambian**
- Si se elimina una categoría del medio, los IDs de las posteriores se desplazan
- Los productos que referencian `catId` quedan huérfanos

Además, los iconos definidos en `categorias.json` se **ignoran completamente** durante la conversión.

**Recomendación:**  
- Generar IDs de categoría determinísticos basados en hash del nombre.
- Preservar los iconos de categoría.
- Implementar verificación de integridad referencial (productos con catId inválido).

---

### 4.4 — `data.json` usa el esquema interno de app.js pero con datos mixtos

| Atributo | Detalle |
|---|---|
| **Severidad** | 🟡 MEDIO |
| **Probabilidad** | Alta durante `nukeAndRebuild()` |
| **Impacto** | Datos con esquema incorrecto se inyectan en Firebase |

**Descripción:**  
`data.json` contiene productos con el esquema interno de `app.js` (campos `precio`, `photo`, `comision` como strings). Cuando se ejecuta `nukeAndRebuild()` (línea 3029), estos datos se inyectan directamente en Firebase sin validación. Si alguien edita `data.json` manualmente y comete un error de esquema, la app queda inutilizable.

**Recomendación:**  
- Agregar validación de esquema antes de importar datos.
- Usar JSON Schema o una función `validateData()` explícita.

---

## 5. VALIDACIÓN DE DATOS AUSENTE

### 5.1 — Sin validación en importación (JSON malformado rompe la app)

| Atributo | Detalle |
|---|---|
| **Severidad** | 🔴 CRÍTICO |
| **Probabilidad** | Media |
| **Impacto** | App no carga; datos corruptos |

**Descripción:**  
`importData()` (línea 2652) hace un `JSON.parse()` básico pero no valida la estructura:

```js
const data = JSON.parse(e.target.result);
if(data.gestores) saveGestores(data.gestores);  // ← ¿y si gestores no es un array?
```

Si el JSON importado tiene `gestores: "no soy un array"`, `saveGestores()` guarda un string en localStorage. Luego `getGestores()` hace `JSON.parse()` y devuelve un string, y cualquier operación como `.find()` o `.map()` lanza un error que **crashea toda la app**.

**Recomendación:**  
- Implementar validación de tipos para cada campo importado.
- Agregar try-catch en todas las funciones `get*()` con fallback a datos por defecto.
- Implementar un modo de "safe boot" que cargue datos mínimos si los almacenados son corruptos.

---

### 5.2 — Sin validación de esquema en datos de Firebase

| Atributo | Detalle |
|---|---|
| **Severidad** | 🟡 ALTO |
| **Probabilidad** | Media |
| **Impacto** | Datos corruptos se propagan a todos los clientes |

**Descripción:**  
Los listeners de Firebase (líneas 204-226) aceptan cualquier dato que Firebase les envíe sin validación. Firebase Realtime Database no tiene esquema — cualquier estructura JSON es válida. Si alguien accede a la base de datos (las credenciales están en el código fuente, línea 22-30) y modifica datos, todos los clientes aceptan la corrupción sin cuestionarla.

Las credenciales de Firebase están **hardcodeadas en el cliente**:
```js
apiKey: "AIzaSyBIyvayDYLYDFy4qrbTkYnrTmxfvxvLnlU",
authDomain: "axontech.firebaseapp.com",
databaseURL: "https://axontech-default-rtdb.firebaseio.com",
```

Cualquier usuario puede abrir DevTools y leer/escribir directamente en la base de datos.

**Recomendación:**  
- Implementar Firebase Security Rules que validen el esquema de escritura.
- Mover las operaciones de escritura a un backend (Cloud Functions).
- No exponer credenciales de Firebase en el cliente.

---

### 5.3 — Sin verificación de límites en cantidades de stock

| Atributo | Detalle |
|---|---|
| **Severidad** | 🟡 MEDIO |
| **Probabilidad** | Baja |
| **Impacto** | Stock negativo; ventas de productos agotados |

**Descripción:**  
`adjustStock()` (línea 2052) solo verifica `num < 0`:
```js
if(isNaN(num)||num<0){showToast('Número inválido');return;}
```

Pero no verifica límites superiores. Un admin podría accidentalmente ingresar `1000000` cuando quería `10`. Tampoco hay advertencia cuando se reduce stock a 0.

En `venderDirecto()` (línea 2017), se verifica `qty > (p.stock||0)` pero esta verificación se hace contra localStorage, que puede estar desactualizado respecto a Firebase.

**Recomendación:**  
- Agregar verificación de stock contra Firebase antes de confirmar ventas.
- Implementar confirmación para cambios de stock grandes.
- Agregar límites máximos razonables.

---

### 5.4 — Campos de precio aceptan cualquier texto

| Atributo | Detalle |
|---|---|
| **Severidad** | 🟡 MEDIO |
| **Probabilidad** | Alta |
| **Impacto** | Cálculos de comisión incorrectos; estadísticas erróneas |

**Descripción:**  
El campo `precio` es un string libre (ej: "$270 USD", "3000 MN", "precio a convenir"). La función `parsePrecioNum()` (línea 1757) intenta extraer un número:

```js
const m = str.replace(/,/g,'').match(/\d+(\.\d+)?/);
return m ? parseFloat(m[0]) : 0;
```

Esto falla silenciosamente para:
- "precio a convenir" → 0 (perdiendo la info)
- "$1,500 USD" → 1500 (correcto)
- "1500-2000 USD" → 1500 (toma solo el primer número)
- "$10.5 USD" → 10.5 (correcto)
- "10USD5MN" → 10 (ignora los 5 MN)

Los cálculos de comisión, valor de inventario y estadísticas usan esta función y pueden ser incorrectos.

**Recomendación:**  
- Separar precio en campos numéricos: `precioUSD` (number), `precioMN` (number).
- Validar que al menos un precio numérico esté presente.
- Eliminar la heurística de "si > 500 es MN, si no es USD".

---

### 5.5 — Números de teléfono sin validación

| Atributo | Detalle |
|---|---|
| **Severidad** | 🟢 BAJO |
| **Probabilidad** | Alta |
| **Impacto** | No se pueden enviar notificaciones WhatsApp; comunicación fallida |

**Descripción:**  
Los campos de teléfono (`telefono` del cliente, `phone` del gestor, `adminPhone`) no tienen validación. Se usan directamente en URLs de WhatsApp:
```js
window.open(`https://wa.me/${gg.phone}?text=...`)
```

Si el teléfono tiene formato incorrecto (espacios, guiones, sin código de país), WhatsApp no lo reconocerá.

**Recomendación:**  
- Implementar validación de formato E.164 (+53555123456).
- Normalizar teléfonos antes de almacenarlos.

---

### 5.6 — Sin detección de vales duplicados

| Atributo | Detalle |
|---|---|
| **Severidad** | 🟡 MEDIO |
| **Probabilidad** | Baja-media |
| **Impacto** | Stock descontado dos veces; estadísticas infladas |

**Descripción:**  
No hay ninguna verificación de duplicados al enviar un vale. Si un gestor hace doble-clic en "Enviar" rápidamente, se crean dos vales idénticos (con IDs diferentes porque `Date.now()` es diferente en cada clic). El botón se deshabilita en `onFormInput()` pero hay una ventana de tiempo entre el clic y la ejecución de `sendVale()`.

**Recomendación:**  
- Deshabilitar el botón inmediatamente al hacer clic (síncrono, antes de cualquier await).
- Implementar deduplicación por hash (cliente + artículos + timestamp con ventana de 5 segundos).

---

## 6. PROBLEMAS DE BACKUP Y RECUPERACIÓN

### 6.1 — GitHub sync almacena todo en un archivo — sin backups incrementales

| Atributo | Detalle |
|---|---|
| **Severidad** | 🟡 ALTO |
| **Probabilidad** | 100% |
| **Impacto** | No se puede recuperar un dato individual; solo restauración total |

**Descripción:**  
`syncToGitHub()` (línea 2725) sube un único archivo JSON con todos los datos. Cada sync sobreescribe el archivo anterior. GitHub mantiene historial de commits, pero:

1. No hay forma de restaurar un dato individual desde la UI
2. El archivo puede ser muy grande (productos con fotos base64) y fallar el upload
3. No hay compactación ni limpieza de datos antiguos

**Recomendación:**  
- Implementar backups incrementales (solo cambios desde el último sync).
- Agregar capacidad de restaurar datos desde un punto específico en el tiempo.
- Excluir imágenes base64 del backup (usar URLs).

---

### 6.2 — Sin programación automática de backups

| Atributo | Detalle |
|---|---|
| **Severidad** | 🟡 MEDIO |
| **Probabilidad** | 100% |
| **Impacto** | Si el admin olvida sincronizar manualmente, los datos no están respaldados |

**Descripción:**  
`ghAutoSync` (línea 2800) ejecuta `syncToGitHub()` automáticamente después de ciertas operaciones, pero solo si:
1. La configuración de GitHub está completa
2. La operación llama explícitamente a `maybeAutoSync()`

No hay un backup programado periódico. Si el admin no configura GitHub, **no hay ningún backup externo**.

**Recomendación:**  
- Implementar backup automático cada N minutos usando `setInterval()`.
- Alertar al admin si no hay backup configurado.
- Considerar Firebase backups automáticos.

---

### 6.3 — Sin versionado de datos

| Atributo | Detalle |
|---|---|
| **Severidad** | 🟡 MEDIO |
| **Probabilidad** | 100% |
| **Impacto** | No se puede saber cuándo se modificó un dato ni por qué |

**Descripción:**  
No hay ningún campo de `updatedAt`, `version`, o `checksum` en los datos. Es imposible saber:
- Si los datos locales están actualizados respecto a Firebase
- Si los datos de Firebase están actualizados respecto a GitHub
- Si dos clientes tienen la misma versión de datos

**Recomendación:**  
- Agregar campos `updatedAt` y `version` a cada colección.
- Implementar "last write wins" con timestamps verificables.
- Agregar hash de integridad para detectar corrupción.

---

### 6.4 — `nukeAndRebuild()` es peligroso e irreversible

| Atributo | Detalle |
|---|---|
| **Severidad** | 🔴 CRÍTICO |
| **Probabilidad** | Baja (requiere acción deliberada) |
| **Impacto** | Pérdida total e irreversible de todos los datos operativos |

**Descripción:**  
`nukeAndRebuild()` (línea 3029):
1. Borra **toda** la base de Firebase: `await db.ref('/').remove()`
2. Borra **todo** localStorage: `localStorage.clear()`
3. Inyecta datos de `data.json` (estático, sin vales, sin notificaciones)

Esto destruye:
- Todos los vales (incluyendo confirmados con comisiones pendientes)
- Todas las notificaciones
- El ranking
- La configuración del admin (contraseña, teléfono, GitHub config)
- El estado de comisiones pagadas

Solo hay un `confirm()` como protección. No hay:
- Backup previo automático
- Verificación de que data.json existe y es válido
- Undo posible
- Advertencia sobre datos que se perderán

**Recomendación:**  
- Crear backup automático antes de ejecutar nuke.
- Requerir doble confirmación con texto escrito (tipo "ESCRIBA BORRAR TODO").
- Implementar un período de gracia donde los datos se pueden recuperar.

---

### 6.5 — Sin forma de recuperar datos eliminados accidentalmente

| Atributo | Detalle |
|---|---|
| **Severidad** | 🟡 ALTO |
| **Probabilidad** | Media |
| **Impacto** | Vales y productos eliminados no se pueden recuperar |

**Descripción:**  
Cuando se elimina un vale (`adminDeleteVale`, línea 1446) o un producto (`removeProducto`, línea 2010), se usa un simple `confirm()` y luego se borra permanentemente de localStorage y Firebase. No hay:
- Papelera de reciclaje
- Soft delete (marcar como eliminado en lugar de borrar)
- Historial de eliminaciones
- Recovery desde backup

**Recomendación:**  
- Implementar soft delete con campo `deleted: true` y `deletedAt`.
- Agregar una papelera de reciclaje con restauración.
- Guardar snapshot antes de cada eliminación.

---

## RESUMEN DE SEVERIDAD

| # | Issue | Severidad | Probabilidad | Categoría |
|---|---|---|---|---|
| 1.1 | `saveVales()` no escribe en Firebase | 🔴 CRÍTICO | 100% | Sync |
| 1.2 | Bandera `isSyncingFromFirebase` global | 🔴 CRÍTICO | 30-50% | Race condition |
| 1.3 | Listeners sobreescriben mismo localStorage | 🟡 ALTO | Alta | Sync |
| 1.4 | Escritura circular de ranking_summary | 🟡 MEDIO | 100% | Sync |
| 2.1 | Numeración de vales no atómica | 🔴 CRÍTICO | Media-alta | Race condition |
| 2.2 | Admin confirma vale que gestor ve | 🟡 MEDIO | Alta | Race condition |
| 2.3 | Descuento de stock no atómico | 🔴 CRÍTICO | Media | Race condition |
| 2.4 | `refreshUI()` excesivo | 🟡 MEDIO | Alta | Race condition |
| 3.1 | localStorage vaciado por navegador | 🔴 CRÍTICO | 5-15% | Pérdida |
| 3.2 | Sin transacciones, crash corrompe datos | 🟡 ALTO | Baja | Pérdida |
| 3.3 | Múltiples pestañas en conflicto | 🟡 ALTO | Alta | Pérdida |
| 3.4 | Importación sobreescribe datos | 🟡 ALTO | Media | Pérdida |
| 4.1 | Contraseñas en texto plano | 🔴 CRÍTICO | 100% | Seguridad |
| 4.2 | Incompatibilidad esquema productos | 🟡 ALTO | 100% | Consistencia |
| 4.3 | Incompatibilidad esquema categorías | 🟡 MEDIO | 100% | Consistencia |
| 4.4 | data.json sin validación | 🟡 MEDIO | Alta | Consistencia |
| 5.1 | Sin validación en importación | 🔴 CRÍTICO | Media | Validación |
| 5.2 | Sin validación esquema Firebase | 🟡 ALTO | Media | Validación |
| 5.3 | Sin límites en stock | 🟡 MEDIO | Baja | Validación |
| 5.4 | Precios como texto libre | 🟡 MEDIO | Alta | Validación |
| 5.5 | Teléfonos sin validación | 🟢 BAJO | Alta | Validación |
| 5.6 | Sin detección de vales duplicados | 🟡 MEDIO | Baja-media | Validación |
| 6.1 | GitHub sync sin incremental | 🟡 ALTO | 100% | Backup |
| 6.2 | Sin backup automático periódico | 🟡 MEDIO | 100% | Backup |
| 6.3 | Sin versionado de datos | 🟡 MEDIO | 100% | Backup |
| 6.4 | `nukeAndRebuild()` irreversible | 🔴 CRÍTICO | Baja | Backup |
| 6.5 | Sin recuperación de eliminados | 🟡 ALTO | Media | Backup |

---

## PRIORIDADES DE ACCIÓN SUGERIDAS

### Inmediato (P0 — seguridad y pérdida de datos activa):
1. **Hashear contraseñas** — las credenciales están expuestas en texto plano
2. **Configurar Firebase Security Rules** — la base de datos es completamente abierta
3. **Corregir `isSyncingFromFirebase`** — reemplazar por contador por nodo o usar Firebase `transaction()`
4. **Hacer atómico el descuento de stock** — usar `firebase.database().ref().transaction()`
5. **Agregar validación en importación** — verificar tipos antes de guardar

### Corto plazo (P1 — estabilidad):
6. Implementar cola de reintentos para escrituras de vales en Firebase
7. Hacer atómica la numeración de vales con `transaction()`
8. Agregar debounce en `refreshUI()`
9. Implementar detección de duplicados en envío de vales
10. Crear backup automático antes de `nukeAndRebuild()`

### Medio plazo (P2 — robustez):
11. Implementar soft delete y papelera de reciclaje
12. Mover imágenes a Firebase Storage
13. Unificar esquemas de datos (productos.json ↔ app.js)
14. Implementar merge strategy para importación
15. Agregar validación de formato de teléfono

### Largo plazo (P3 — arquitectura):
16. Mover lógica de negocio a backend (Cloud Functions)
17. Implementar versionado de datos con migraciones
18. Crear sistema de backups incrementales
19. Implementar modo offline-first con sincronización al reconectar
20. Agregar monitoreo de integridad de datos

---

*Informe generado por análisis estático de código. Se recomienda realizar pruebas de penetración y pruebas de carga para validar los escenarios de race condition identificados.*
