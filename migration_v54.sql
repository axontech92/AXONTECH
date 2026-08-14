-- ══════════════════════════════════════════════════════════════════════
--  AXONTECH · Migración v54 — Fix de vales que se quedan en 'pending'
-- ══════════════════════════════════════════════════════════════════════
--
-- PROBLEMA:
--   Cuando un gestor guarda un vale (por cualquier motivo: editar, re-encolar,
--   _ensurePendingValesEnqueued, etc.), el UPSERT a Supabase REEMPLAZA toda
--   la columna `data` JSONB. Esto borra los campos que el admin había puesto
--   (status='confirmed', confirmedTs, seenByAdmin, mensajeroId, etc.).
--   Resultado: el admin confirma la venta, pero el siguiente saveVales() del
--   gestor reescribe status='pending' y la confirmación se pierde.
--
--   El "fix v53" trataba de incluir los campos del admin en el slim del gestor,
--   pero usaba la caché LOCAL del gestor (que está stale). Así que el gestor
--   escribía status='pending' (su valor viejo) por encima del status='confirmed'
--   del admin. Peor aún, esto hacía que el bug se reprodujera SIEMPRE que el
--   gestor guardara, no solo ocasionalmente.
--
-- SOLUCIÓN:
--   Crear una función RPC `upsert_vale_from_gestor(p_id, p_data)` que hace
--   el merge server-side:
--     - Si el vale NO existe en Supabase → INSERT (es un vale nuevo)
--     - Si el vale YA existe → merge: existing || p_data, PERO forzando
--       preservar los campos administrativos desde el existing.
--   Así el gestor puede escribir libremente sus campos (cliente, telefono,
--   articulo, etc.) sin tocar los campos del admin (status, mensajeroId,
--   confirmedTs, etc.).
--
-- CÓMO USAR:
--   1. Entra a tu proyecto Supabase: https://supabase.com/dashboard
--      Proyecto: gdzsqwyedzrfituewdtt
--   2. En el menú izquierdo, busca "SQL Editor" (ícono de terminal `</>`)
--   3. Crea un "New query", pega TODO este archivo y pulsa "Run" (Ctrl+Enter)
--   4. Debe decir "Success. No rows returned" al terminar.
--   5. Eso es todo. La app v54+ detecta automáticamente la función y la usa.
--      Si la función no existe, la app hace fallback al comportamiento viejo.
--
-- NOTAS:
--   - Es SEGURO re-ejecutar este script: usa OR REPLACE.
--   - No borra datos existentes.
--   - Si la app es más vieja que v54, no usa esta función (no rompe nada).
-- ══════════════════════════════════════════════════════════════════════

-- ── Función RPC: upsert_vale_from_gestor ──
-- Recibe el ID del vale y un JSONB con los datos del gestor.
-- Hace un merge server-side, preservando los campos administrativos.
CREATE OR REPLACE FUNCTION upsert_vale_from_gestor(p_id bigint, p_data jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  existing_data jsonb;
  merged_data jsonb;
  field text;
  admin_fields text[] := ARRAY[
    'status','mensajeroId','assignedTs','confirmedTs','adminNotes',
    'seenByAdmin','seenTs','commissionStatus','commissionPaid',
    'stockDecremented','hiddenFromHistory','hiddenTs','deliveredTs',
    'cancelledTs','revertedTs'
  ];
BEGIN
  SELECT data INTO existing_data FROM vales WHERE id = p_id;

  IF existing_data IS NULL THEN
    -- Vale nuevo (gestor recién lo creó). Insertar tal cual.
    -- Si no trae status, asignar 'pending' por defecto.
    IF NOT (p_data ? 'status') THEN
      p_data := p_data || jsonb_build_object('status', 'pending');
    END IF;
    INSERT INTO vales (id, data) VALUES (p_id, p_data)
    ON CONFLICT (id) DO NOTHING;
  ELSE
    -- Vale existente. Merge: existing || p_data, PERO forzar preservar
    -- campos del admin desde existing (el gestor no puede tocarlos).
    merged_data := existing_data || p_data;
    FOREACH field IN ARRAY admin_fields LOOP
      IF existing_data ? field THEN
        -- El campo ya existe en Supabase → preservar valor existente
        merged_data := jsonb_set(merged_data, ARRAY[field], existing_data->field);
      ELSE
        -- El campo no existe en Supabase → quitarlo del merge
        -- (el gestor no puede crear campos del admin)
        merged_data := merged_data - field;
      END IF;
    END LOOP;
    UPDATE vales SET data = merged_data WHERE id = p_id;
  END IF;
END;
$$;

-- Permisos: la app usa la anon key pública
GRANT EXECUTE ON FUNCTION upsert_vale_from_gestor(bigint, jsonb) TO anon;

-- ── Verificación final ──
SELECT 'upsert_vale_from_gestor creada correctamente' AS resultado,
       proname AS funcion
FROM pg_proc
WHERE proname = 'upsert_vale_from_gestor'
  AND pronamespace = 'public'::regnamespace;
