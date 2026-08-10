# AXONTECH v31 · Migración a Supabase

## Por qué esta versión

Firestore (firestore.googleapis.com) está bloqueado desde Cuba sin VPN.
Supabase NO lo está. Esta versión cambia TODO el backend de Firestore a
Supabase. La app ya no carga los SDKs de Firebase (530KB menos).

---

## PASOS PARA DESPLEGAR (en orden)

### PASO 1 · Crear las tablas en Supabase (2 minutos)

1. Entra a https://supabase.com/dashboard → tu proyecto
   `gdzsqwyedzrfituewdtt`
2. Menú izquierdo → **SQL Editor** (ícono `</>`)
3. Crea un "New query"
4. Abre el archivo `supabase_schema.sql` que viene en esta carpeta,
   copia TODO su contenido y pégalo en el editor
5. Pulsa **Run** (o Ctrl+Enter)
6. Debe decir "Success. No rows returned"

### PASO 2 · Migrar los datos existentes de Firestore → Supabase

Si tienes datos en Firestore que quieres conservar (gestores, productos,
vales históricos, etc.):

1. Sube esta carpeta v31 a GitHub como siempre
2. Abre la app del admin **CON VPN PUESTA**
   (Firestore solo se puede leer con VPN desde Cuba)
3. Entra al panel de configuración → busca el botón
   **"Migrar a Firestore"** (el nombre es histórico, ahora migra
   Firestore → Supabase) y pulsa confirmar
4. Espera a que diga
   `Migración a Supabase completa y verificada`
5. A partir de aquí puedes quitar el VPN — la app ya no lo necesita

Si NO tienes datos importantes en Firestore (proyecto nuevo), puedes
saltarte este paso.

### PASO 3 · Subir a GitHub

1. Sube TODA esta carpeta a tu repo en GitHub como haces normalmente
2. Espera ~30s a que GitHub Pages publique
3. La app se actualiza sola (el badge cambia de v30 a v31)

### PASO 4 · Probar desde Cuba SIN VPN

1. **Gestor** (sin VPN): abre la app, selecciona gestor, manda un vale
   - El toast debe decir "Vale guardado · Enviando al administrador"
   - El indicador de sync debe pasar de "Sincronizando (1)" a "En línea"
2. **Admin** (sin VPN, en otro teléfono o pestaña): abre la app
   - El vale debe aparecer en la bandeja en menos de 5 segundos
3. Si algo falla, toca el indicador de sync (círculo abajo a la derecha)
   para ver un panel de diagnóstico con el último error

---

## Qué cambió respecto a v30

- ✅ **Backend migrado de Firestore a Supabase** — funciona desde Cuba sin VPN
- ✅ **SDKs de Firebase eliminados** (app.js, sw.js, index.html, admin.html)
  - -530KB de JS que el navegador tenía que bajar y parsear
  - Ya no depende del dominio gstatic.com (lento en Cuba)
- ✅ **Polling cada 5s** (antes 12s) — el admin ve vales nuevos más rápido
- ✅ **Misma lógica de cola, chunking, retry, merge** — sin cambios
- ✅ **Mismas reglas de seguridad** (RLS policies equivalentes a Firestore rules)
- ✅ **Migración de datos integrada** — botón "Migrar a Firestore" ahora
  migra de Firestore a Supabase (con VPN puesta, una sola vez)

## Modelo de datos en Supabase

Cada tabla tiene dos columnas: `id` (bigint primary key) y `data` (jsonb).
El objeto completo del vale/gestor/producto va dentro de `data`. Es lo
más parecido al modelo de documentos de Firestore pero sobre PostgreSQL.

Tablas creadas por `supabase_schema.sql`:
- `gestores`, `mensajeros`, `productos`, `categorias`
- `vales` (con índices en gestor_id, status y ts para consultas rápidas)
- `meta` (filas únicas: config, notifs, estafa, ranking_summary)
- `backups` (snapshots pre-nuke)

## Si algo sale mal

### El vale sale pero no llega al admin
1. Verifica que ejecutaste `supabase_schema.sql` (PASO 1)
2. Toca el indicador de sync en el admin → muestra el último error
3. Si dice "permission-denied" o "401" → las RLS policies no se crearon.
   Vuelve a ejecutar `supabase_schema.sql`.

### La barra de sync se queda "pegada" en "Sincronizando (1)"
- Esto ya no debería pasar — el polling cada 5s trae los datos aunque
  el write tarde en confirmarse. Si pasa, recarga la página y mandame
  el contenido del panel de diagnóstico (tocar el círculo de sync).

### Quiero volver a Firestore
No hace falta — Supabase funciona desde Cuba y es gratis hasta 500MB
de base de datos y 50k usuarios activos mensuales. Si de todas formas
quieres volver, la versión v30 sigue en GitHub.
