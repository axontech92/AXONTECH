-- ══════════════════════════════════════════════════════════════════════
--  AXONTECH · v65 · Freno al borrado masivo
-- ══════════════════════════════════════════════════════════════════════
--
--  QUÉ PROBLEMA RESUELVE
--  ─────────────────────
--  La app no usa Supabase Auth: todas las operaciones van con la anon key,
--  que viaja dentro de catalogo.html y por tanto es pública — cualquiera que
--  abra el código de la página la tiene. Las políticas RLS actuales son
--  `using (true)`, es decir, permiso total. Con eso, una sola petición puede
--  vaciar la tabla de vales entera:
--
--      DELETE /rest/v1/vales?id=gt.0
--
--  Cambiar el modelo de autenticación es una reforma grande. Esto NO la
--  sustituye: es un airbag que corta lo irreversible mientras tanto.
--
--  QUÉ HACE
--  ────────
--  Un trigger por SENTENCIA que cuenta cuántas filas ha borrado cada DELETE y
--  aborta la transacción si pasa del umbral. Los borrados normales de la app
--  (un vale, un producto) siguen funcionando igual; el "bórralo todo" no.
--
--  QUÉ NO ROMPE
--  ────────────
--  Se ha revisado contra las rutas de borrado reales de app.js:
--    · _sbRestDelete()      → borra 1 fila por id          → pasa
--    · _sbRestDeleteVale()  → borra 1 vale                 → pasa
--    · _sbRestDeleteBatch() → lotes, en la práctica pocos  → pasa salvo lotes enormes
--    · _sbRestDeleteAll()   → reset de fábrica, borra todo → SE BLOQUEA (a propósito)
--  Si algún día necesitas el reset de fábrica de verdad, desactiva el trigger,
--  hazlo, y vuelve a activarlo (instrucciones al final).
--
--  ANTES DE EJECUTAR: activa los backups (ver LEEME-seguridad.md). Un trigger
--  evita el borrado; un backup te devuelve lo ya perdido. No son lo mismo.
-- ══════════════════════════════════════════════════════════════════════

-- Umbral de filas por sentencia. 25 deja holgura de sobra para el uso normal
-- (los borrados de la app son de una fila) y corta cualquier barrido.
create or replace function axon_bloquear_borrado_masivo()
returns trigger
language plpgsql
as $$
declare
  n integer;
  limite constant integer := 25;
begin
  select count(*) into n from borradas;
  if n > limite then
    raise exception
      'AXONTECH: borrado masivo bloqueado (% filas en una sola sentencia, máximo %). '
      'Si es intencionado, desactiva el trigger, hazlo y vuelve a activarlo.', n, limite;
  end if;
  return null;
end;
$$;

-- Se aplica a las tablas cuyo contenido no se puede recuperar solo: los vales
-- son el histórico de ventas y comisiones, y gestores/productos son los datos
-- maestros del negocio.
drop trigger if exists trg_axon_no_borrado_masivo on vales;
create trigger trg_axon_no_borrado_masivo
  after delete on vales
  referencing old table as borradas
  for each statement
  execute function axon_bloquear_borrado_masivo();

drop trigger if exists trg_axon_no_borrado_masivo on gestores;
create trigger trg_axon_no_borrado_masivo
  after delete on gestores
  referencing old table as borradas
  for each statement
  execute function axon_bloquear_borrado_masivo();

drop trigger if exists trg_axon_no_borrado_masivo on productos;
create trigger trg_axon_no_borrado_masivo
  after delete on productos
  referencing old table as borradas
  for each statement
  execute function axon_bloquear_borrado_masivo();

-- ══════════════════════════════════════════════════════════════════════
--  CÓMO COMPROBAR QUE FUNCIONA
-- ══════════════════════════════════════════════════════════════════════
--  Esto debe FALLAR con el mensaje del trigger (no borra nada, la transacción
--  se deshace entera):
--
--      delete from vales where id > 0;
--
--  Y esto debe seguir funcionando con normalidad desde la app: eliminar un
--  vale con su botón 🗑️.
--
-- ══════════════════════════════════════════════════════════════════════
--  CÓMO DESACTIVARLO TEMPORALMENTE (p. ej. para un reset de fábrica)
-- ══════════════════════════════════════════════════════════════════════
--      alter table vales disable trigger trg_axon_no_borrado_masivo;
--      -- ...haz el borrado...
--      alter table vales enable  trigger trg_axon_no_borrado_masivo;
--
--  Y para quitarlo del todo:
--      drop trigger if exists trg_axon_no_borrado_masivo on vales;
--      drop trigger if exists trg_axon_no_borrado_masivo on gestores;
--      drop trigger if exists trg_axon_no_borrado_masivo on productos;
--      drop function if exists axon_bloquear_borrado_masivo();
