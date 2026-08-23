-- ══════════════════════════════════════════════════════════════════════
--  AXONTECH · Migración v115 — Que nadie pueda vaciar la configuración
-- ══════════════════════════════════════════════════════════════════════
--
-- CÓMO USAR
--   1. Entra a Supabase: https://supabase.com/dashboard
--   2. Menú izquierdo → "SQL Editor" (icono `</>`)
--   3. "New query", pega TODO este archivo y pulsa "Run" (Ctrl+Enter)
--   4. Al final imprime una tabla de comprobación: debe decir OK.
--
--   Es SEGURO re-ejecutarlo. No borra ni modifica ningún dato.
--
-- ══════════════════════════════════════════════════════════════════════
--  QUÉ PASÓ
-- ══════════════════════════════════════════════════════════════════════
--   El 23/08/2026 el documento de configuración de la nube tenía UNA sola
--   clave: nextValeNum. Habían desaparecido la meta de puntos, la tasa del día
--   y el margen del admin.
--
--   La causa es conocida: al crear un vale se sube el número siguiente, y
--   durante un tiempo eso se escribía REEMPLAZANDO el documento entero en vez
--   de retocar esa clave. El documento pasaba a tener solo `nextValeNum` y todo
--   lo demás se perdía. En la app se arregló (ver _sbRestMetaMerge), pero el
--   arreglo vive en el teléfono: uno que siga con la versión vieja lo repite
--   cada vez que alguien hace un vale.
--
--   Nadie lo relaciona con "hice un vale". Se nota días después, cuando los
--   gestores ven la tasa sin el margen o cuando los puntos dejan de reiniciar
--   porque ya no hay meta. Ha pasado al menos dos veces.
--
-- ══════════════════════════════════════════════════════════════════════
--  LA SOLUCIÓN
-- ══════════════════════════════════════════════════════════════════════
--   Que la nube no acepte quedarse con menos de lo que tenía. Si una escritura
--   del documento `config` no trae una clave que ya existía, se le devuelve con
--   su valor anterior antes de guardar.
--
--   Se ARREGLA la escritura en vez de rechazarla: un teléfono viejo que manda
--   {nextValeNum: N} consigue lo que quería —guardar el número— y el resto del
--   documento se queda como estaba. Si se rechazara, el vale se quedaría sin
--   número y sería peor el remedio.
--
--   Es la misma idea que _sbRestMetaMerge hace en la app, pero puesta donde no
--   depende de que cada teléfono esté actualizado.

CREATE OR REPLACE FUNCTION axon_no_vaciar_config()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  faltantes text[];
BEGIN
  -- ⚠️ SOLO el documento `config`. Aquí NO vale generalizar a toda la tabla
  -- `meta`, y no es por prudencia: hay documentos que MENGUAN con razón.
  --   · `reservas` {producto: unidades} — cuando se libera lo apartado de un
  --     producto, su clave desaparece. Devolvérsela dejaría el stock
  --     comprometido para siempre por una reserva fantasma.
  --   · `costos` — el admin borra el costo de un producto dejándolo en blanco.
  --   · `notifs` es un array, no un objeto.
  -- Un disparador para toda la tabla habría creado tres fallos por arreglar uno.
  IF NEW.name IS DISTINCT FROM 'config' THEN
    RETURN NEW;
  END IF;

  IF jsonb_typeof(OLD.data) <> 'object' OR jsonb_typeof(NEW.data) <> 'object' THEN
    RETURN NEW;
  END IF;

  SELECT array_agg(k) INTO faltantes
    FROM jsonb_object_keys(OLD.data) k
   WHERE NOT (NEW.data ? k)
     -- ghToken se quita A PROPÓSITO: es el token de GitHub del admin y no debe
     -- estar en la nube, donde cualquier gestor podría leerlo. Si alguna
     -- versión vieja lo subió, esta es la limpieza. Resucitarlo sería devolver
     -- a la nube justo lo que se está sacando de ella.
     AND k <> 'ghToken';

  IF faltantes IS NULL THEN
    RETURN NEW;                       -- no falta nada, se guarda tal cual
  END IF;

  -- Se devuelven las claves que faltaban con su valor anterior. Para todo lo
  -- demás manda el documento nuevo.
  NEW.data := (SELECT jsonb_object_agg(k, OLD.data -> k) FROM unnest(faltantes) k)
              || NEW.data;

  RAISE NOTICE 'AXONTECH: se conservaron % clave(s) de config que la escritura no traía (%)',
               array_length(faltantes, 1), array_to_string(faltantes, ', ');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_axon_config_no_vaciar ON meta;
CREATE TRIGGER trg_axon_config_no_vaciar
  BEFORE UPDATE ON meta
  FOR EACH ROW
  EXECUTE FUNCTION axon_no_vaciar_config();


-- ══════════════════════════════════════════════════════════════════════
--  Comprobación
-- ══════════════════════════════════════════════════════════════════════

SELECT
  'el disparador está puesto' AS comprueba,
  CASE WHEN EXISTS (
         SELECT 1 FROM pg_trigger t
           JOIN pg_class c ON c.oid = t.tgrelid
          WHERE c.relname = 'meta'
            AND t.tgname = 'trg_axon_config_no_vaciar'
            AND NOT t.tgisinternal)
       THEN 'OK' ELSE '✗ REVISAR' END AS resultado

UNION ALL

SELECT
  'la función tiene search_path fijo',
  CASE WHEN EXISTS (
         SELECT 1 FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = 'axon_no_vaciar_config'
            AND EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig,'{}')) c
                         WHERE c LIKE 'search_path=%'))
       THEN 'OK' ELSE '✗ REVISAR' END;

-- ══════════════════════════════════════════════════════════════════════
--  LO QUE ESTO NO HACE
-- ══════════════════════════════════════════════════════════════════════
--   No devuelve lo que YA se perdió. La meta, la tasa y el margen hay que
--   volver a ponerlos a mano en ⚙️ Config una vez. A partir de ahí, ningún
--   teléfono —por viejo que sea— puede volver a llevárselos.
