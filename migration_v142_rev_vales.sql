-- ══════════════════════════════════════════════════════════════════════
--  AXONTECH · Migración v142 — Que dos admins no se pisen los vales
-- ══════════════════════════════════════════════════════════════════════
--
-- QUÉ QUEDABA MAL
--   El admin sube el vale con un upsert que REEMPLAZA la fila entera. Si un
--   segundo teléfono/pestaña admin tiene una copia vieja y toca el vale (o lo
--   reenvía), su versión vieja pisa la nueva: un vale confirmado vuelve a
--   "pendiente".
--
-- LA SOLUCIÓN
--   Cada vale lleva un número de versión `rev` dentro de data. Cada cambio del
--   admin sube el número en 1 y trae un identificador `revOp`. El servidor solo
--   acepta la escritura si su `rev` es MAYOR que el que ya hay. Si es igual o
--   menor, otro dispositivo cambió el vale antes: se rechaza y se devuelve la
--   versión de la nube para que el teléfono la adopte.
--   Un reintento del mismo cambio (mismo rev y mismo revOp) se acepta sin
--   efecto, así que una conexión que se corta no produce falsos conflictos.
--
-- CÓMO USAR
--   1. https://supabase.com/dashboard → SQL Editor → New query
--   2. Pega TODO este archivo y pulsa Run. Debe terminar con una fila de
--      verificación.
--   3. La app v142+ la detecta sola. Sin esta migración todo sigue como antes.
--
-- NOTAS
--   - Es seguro re-ejecutarlo (OR REPLACE). No modifica ningún dato.
--   - Vales antiguos sin `rev` cuentan como rev 0: el primer cambio los pasa a 1.
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION upsert_vale_admin(p_id bigint, p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  cur      jsonb;
  cur_rev  bigint;
  new_rev  bigint;
BEGIN
  -- Sonda de la app: no toca nada.
  IF p_id IS NULL OR p_id = 0 THEN
    RETURN jsonb_build_object('applied', true, 'probe', true);
  END IF;

  -- Bloquea la fila: dos escrituras simultáneas se ordenan, no se cruzan.
  SELECT data INTO cur FROM vales WHERE id = p_id FOR UPDATE;

  IF cur IS NULL THEN
    INSERT INTO vales (id, data) VALUES (p_id, p_data)
    ON CONFLICT (id) DO NOTHING;
    RETURN jsonb_build_object('applied', true);
  END IF;

  cur_rev := COALESCE((cur->>'rev')::bigint, 0);
  new_rev := COALESCE((p_data->>'rev')::bigint, 0);

  IF new_rev > cur_rev
     OR (new_rev = cur_rev AND new_rev > 0
         AND p_data->>'revOp' IS NOT DISTINCT FROM cur->>'revOp')   -- reintento propio
     OR (new_rev = 0 AND cur_rev = 0)                               -- datos antiguos
  THEN
    UPDATE vales SET data = p_data WHERE id = p_id;
    RETURN jsonb_build_object('applied', true);
  END IF;

  -- Conflicto: la nube ya tiene una versión igual o más nueva de otro dispositivo.
  RETURN jsonb_build_object('applied', false, 'data', cur);
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_vale_admin(bigint, jsonb) TO anon;

SELECT 'upsert_vale_admin creada correctamente' AS resultado, proname AS funcion
FROM pg_proc WHERE proname = 'upsert_vale_admin' AND pronamespace = 'public'::regnamespace;
