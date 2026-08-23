-- ══════════════════════════════════════════════════════════════════════
--  AXONTECH · Migración v114 — Cerrar los avisos de seguridad de Supabase
-- ══════════════════════════════════════════════════════════════════════
--
-- CÓMO USAR
--   1. Entra a Supabase: https://supabase.com/dashboard
--   2. Menú izquierdo → "SQL Editor" (icono `</>`)
--   3. "New query", pega TODO este archivo y pulsa "Run" (Ctrl+Enter)
--   4. Al final imprime una tabla de comprobación: todo debe decir OK.
--
--   Es SEGURO re-ejecutarlo. No borra ni modifica ningún dato.
--
-- ══════════════════════════════════════════════════════════════════════
--  1. `stock_ops` estaba abierta al público  ← el aviso CRÍTICO
-- ══════════════════════════════════════════════════════════════════════
--
-- QUÉ ESTABA MAL
--   La migración v96 creó `stock_ops` —el cuaderno donde se apunta cada orden
--   de stock ya aplicada, para que un reintento no descuente dos veces— y le
--   dio permiso de lectura y ESCRITURA al público:
--
--       GRANT SELECT, INSERT ON stock_ops TO anon, authenticated;   ← sobraba
--
--   La clave `anon` viaja dentro de la app, que cualquiera puede descargar. Con
--   ella y ese permiso, alguien podía INSERTAR órdenes inventadas en el
--   cuaderno. Y eso no es un problema teórico: si mete el identificador de una
--   venta real antes de que se aplique, la base de datos la da por hecha y
--   NO descuenta el stock. Sería exactamente la pérdida de inventario que esta
--   tabla se escribió para evitar.
--
-- POR QUÉ EL PERMISO SOBRABA
--   La app nunca lee ni escribe `stock_ops`: solo llama a aplicar_delta_stock(),
--   que es SECURITY DEFINER y por tanto corre con los permisos de su dueño
--   (postgres), no con los de quien la llama. El cuaderno lo apunta ella. Con
--   la tabla cerrada a cal y canto la función sigue funcionando igual.

REVOKE ALL ON stock_ops FROM anon, authenticated;
ALTER TABLE stock_ops ENABLE ROW LEVEL SECURITY;

-- Sin políticas a propósito: nadie entra por la puerta pública. La función
-- entra por la suya, que es la de su dueño.
-- (Ojo: NO se pone FORCE ROW LEVEL SECURITY — eso se la aplicaría también al
--  dueño y dejaría a la función sin poder apuntar nada.)


-- ══════════════════════════════════════════════════════════════════════
--  2. Funciones con el "search_path" suelto  ← los avisos naranjas
-- ══════════════════════════════════════════════════════════════════════
--
-- QUÉ ES ESTO
--   Cuando una función dice `FROM productos`, Postgres busca esa tabla por el
--   search_path del que la llama. Si la función es SECURITY DEFINER —corre como
--   el dueño, que aquí es superusuario— y el search_path se puede manipular,
--   quien la llame podría hacer que `productos` apunte a OTRA tabla suya y que
--   el superusuario trabaje sobre ella sin enterarse.
--
--   Fijando el search_path, la función siempre mira donde tiene que mirar.
--
-- Se hace con ALTER FUNCTION, que NO reescribe el cuerpo: no hay riesgo de
-- cambiar el comportamiento de nada. Y se hace en bucle sobre todas las
-- funciones de `public` en vez de nombrarlas una a una, para que ninguna se
-- quede fuera hoy ni el día que se añada otra.

DO $$
DECLARE
  f record;
  n int := 0;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS firma
      FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.prokind = 'f'                                  -- funciones, no agregados
       -- Solo las NUESTRAS. En `public` viven también las de las extensiones
       -- instaladas (pgcrypto mete 36 él solo): tocarlas no lo pide el aviso y
       -- puede dar problemas al actualizar la extensión o al hacer copias.
       AND NOT EXISTS (
             SELECT 1 FROM pg_depend d
              WHERE d.objid = p.oid AND d.deptype = 'e')
       AND NOT EXISTS (                                      -- que no lo tengan ya
             SELECT 1 FROM unnest(COALESCE(p.proconfig, '{}')) c
              WHERE c LIKE 'search_path=%')
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', f.firma);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'search_path fijado en % función(es)', n;
END $$;


-- ══════════════════════════════════════════════════════════════════════
--  3. Comprobación — esto es lo que hay que mirar al terminar
-- ══════════════════════════════════════════════════════════════════════

SELECT
  'stock_ops cerrada al público' AS comprueba,
  CASE WHEN c.relrowsecurity
         AND NOT has_table_privilege('anon', 'stock_ops', 'SELECT')
         AND NOT has_table_privilege('anon', 'stock_ops', 'INSERT')
       THEN 'OK' ELSE '✗ REVISAR' END AS resultado
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relname = 'stock_ops'

UNION ALL

SELECT
  'funciones propias con search_path fijo',
  CASE WHEN count(*) FILTER (
         WHERE NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig,'{}')) c
                            WHERE c LIKE 'search_path=%')) = 0
       THEN 'OK (' || count(*) || ' funciones)'
       ELSE '✗ quedan ' || count(*) FILTER (
              WHERE NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig,'{}')) c
                                 WHERE c LIKE 'search_path=%')) || ' sin fijar' END
  FROM pg_proc p
  JOIN pg_namespace ns ON ns.oid = p.pronamespace
 WHERE ns.nspname = 'public' AND p.prokind = 'f'
   AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')

UNION ALL

-- La prueba de que no se rompió nada: la función tiene que seguir existiendo y
-- siendo ejecutable por la app.
SELECT
  'la app puede seguir descontando stock',
  CASE WHEN has_function_privilege('anon', 'aplicar_delta_stock(bigint,int,text)', 'EXECUTE')
       THEN 'OK' ELSE '✗ REVISAR' END;

-- ══════════════════════════════════════════════════════════════════════
--  LO QUE ESTO **NO** ARREGLA
-- ══════════════════════════════════════════════════════════════════════
--   Las tablas de datos (vales, productos, gestores, meta…) siguen abiertas a
--   cualquiera que tenga la clave pública, porque sus políticas son `using
--   (true)`. Así se diseñó la app: no hay cuentas de usuario en Supabase, el
--   control de acceso lo hace la propia app con las claves de los gestores.
--   Cerrarlo de verdad es otro trabajo —cuentas reales y políticas por rol— y
--   no se toca aquí porque dejaría la app sin poder leer nada.
--
--   Lo que sí se cierra hoy es lo que no tenía por qué estar abierto: un
--   cuaderno interno que la app nunca toca.
