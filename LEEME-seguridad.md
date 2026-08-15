# AXONTECH · Seguridad de los datos

Resumen honesto de cómo está protegida la información y qué conviene hacer.
Ordenado por lo que más duele si sale mal.

---

## Cómo está hoy

La app **no usa Supabase Auth**. Todas las operaciones —leer, escribir y
borrar— viajan con la *anon key*, que está dentro de `catalogo.html` y por
tanto es pública: cualquiera que abra el código de la página la tiene.

Y las políticas RLS del esquema son permiso total:

```sql
create policy "vales_delete" on vales for delete using (true);
```

Hay 21 políticas así. El propio `supabase_schema.sql` ya lo advierte:

> *"Todos los writes van con la anon key pública. Las RLS políticas por lo
> tanto solo validan la FORMA de los datos."*

**Qué significa en la práctica:** la contraseña del admin protege la *pantalla*,
no los *datos*. Quien vaya directo a la base de datos se la salta entera y puede
leer, modificar o borrar todo — incluidos nombre, teléfono, dirección y carnet
de los clientes en la tabla `vales`.

Nada de esto ha pasado, y hace falta que alguien se moleste en mirar el código.
Pero conviene saberlo y no dejarlo indefinidamente así.

---

## 1. Backups — hazlo hoy

Es lo que convierte *"nos han borrado todo"* en *"perdimos una tarde"*. Ninguna
otra medida sustituye a esto.

En el panel de Supabase: **Database → Backups**. Activa los backups diarios y,
si tu plan lo permite, *Point-in-Time Recovery*.

Un backup no evita el desastre: lo hace reversible. Por eso va el primero.

---

## 2. Freno al borrado masivo — `migration_v65_seguridad.sql`

Está preparado en el repo, listo para ejecutar. Abre el **SQL Editor** de
Supabase, pega el archivo y ejecútalo.

Instala un trigger que aborta cualquier `DELETE` que afecte a más de 25 filas de
golpe en `vales`, `gestores` o `productos`. Los borrados normales de la app
(un vale con su botón 🗑️) siguen funcionando igual; el barrido completo, no.

Comprobado contra las rutas de borrado reales de `app.js`. La única función que
deja de funcionar es el **reset de fábrica**, a propósito — el archivo explica
cómo desactivar el trigger un momento si alguna vez lo necesitas de verdad.

---

## 3. El carnet de los clientes — decisión tuya

Es el dato más sensible que guarda la app y el que peor sienta si se filtra.
Merece una pregunta simple: **¿lo usas para algo?**

Si no lo usas, deja de pedirlo: lo que no se guarda no se puede filtrar. Si sí
lo usas, al menos que sea consciente.

---

## 4. Autenticación de verdad — la reforma de fondo

Lo correcto a medio plazo es Supabase Auth con RLS por rol: que el gestor solo
pueda leer y escribir *sus* vales, y que solo el admin toque el resto. Hoy
cualquier dispositivo puede escribir cualquier cosa, y la separación
admin/gestor vive solo en el código del navegador.

Es una reforma grande y no urge mientras el círculo de gente sea de confianza.
Pero si algún día entra alguien nuevo al negocio, o la app se abre más, este es
el punto que hay que resolver antes.

---

## Lo que NO hace falta cambiar

- **La contraseña del admin está bien hecha**: PBKDF2 con sal aleatoria y
  migración desde el formato antiguo. No la toques.
- **El token de GitHub** no se sincroniza a Supabase, vive solo en el
  dispositivo del admin. Correcto.
