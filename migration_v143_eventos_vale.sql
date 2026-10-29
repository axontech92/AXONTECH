-- ══════════════════════════════════════════════════════════════════════
--  AXONTECH · Migración v143 — El servidor decide el estado del vale y el stock
-- ══════════════════════════════════════════════════════════════════════
--
-- QUÉ QUEDABA MAL (la causa de raíz)
--   Confirmar una venta eran DOS escrituras independientes desde el teléfono:
--     1) "quita 2 unidades" al stock   (llegaba)
--     2) "el vale está confirmado"      (podía perderse)
--   Si la segunda se perdía, la nube quedaba con el vale "pendiente" y el stock
--   ya descontado; al aprobarlo otra vez se descontaba de nuevo. Además cada
--   teléfono subía el vale ENTERO, así que una copia vieja pisaba a la nueva.
--
-- LA SOLUCIÓN
--   El teléfono manda una INTENCIÓN con identificador ("confirma el vale 7,
--   operación X") y el servidor, en UNA transacción:
--     · bloquea el vale y comprueba su estado real,
--     · si ya estaba confirmado NO vuelve a tocar el stock (ya_aplicado),
--     · descuenta/devuelve el stock y cambia el estado a la vez,
--     · apunta la operación: repetirla (reintento, cola reabierta) no hace nada.
--   Estado y stock ya no pueden separarse, ni aplicarse dos veces.
--
-- CÓMO USAR
--   1. Supabase → SQL Editor → New query → pega TODO → Run.
--   2. Debe terminar mostrando una fila de verificación.
--   3. La app v143+ la detecta sola. Sin esto sigue funcionando como antes.
--   (Conviene haber ejecutado también migration_v142_rev_vales.sql.)
--
-- NOTAS
--   - Seguro de re-ejecutar (IF NOT EXISTS / OR REPLACE). No toca datos.
-- ══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS vale_eventos (
  op         text PRIMARY KEY,
  vale_id    bigint NOT NULL,
  creado     timestamptz NOT NULL DEFAULT now(),
  resultado  jsonb
);
CREATE INDEX IF NOT EXISTS vale_eventos_vale_idx ON vale_eventos(vale_id);
ALTER TABLE vale_eventos ENABLE ROW LEVEL SECURITY;   -- solo la función (definer) la toca

CREATE OR REPLACE FUNCTION _vale_rango(s text) RETURNS int
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE s WHEN 'pending' THEN 0 WHEN 'assigned' THEN 1 WHEN 'delivered' THEN 2
                WHEN 'pending_payment' THEN 3 WHEN 'confirmed' THEN 4 ELSE 0 END
$$;

CREATE OR REPLACE FUNCTION vale_aplicar_estado(
  p_op        text,
  p_vale      bigint,
  p_cambios   jsonb,
  p_descontar boolean DEFAULT false,
  p_rev       bigint  DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  cur         jsonb;
  nuevo       jsonb;
  prev_op     jsonb;
  cur_rank    int;
  new_rank    int;
  cur_rev     bigint;
  ya          boolean := false;
  hizo_baja   boolean := false;
  salido      jsonb;
  k           text;
  val         jsonb;
  el          jsonb;
  pid         bigint;
  qty         int;
  s           int;
  salen       int;
  dev         int;
  stock_map   jsonb := '{}'::jsonb;
  descontado  boolean;
BEGIN
  IF p_vale IS NULL OR p_vale = 0 THEN
    RETURN jsonb_build_object('applied', true, 'probe', true);
  END IF;
  IF p_op IS NULL OR length(p_op) = 0 THEN
    RAISE EXCEPTION 'vale_aplicar_estado: falta el identificador de operación';
  END IF;

  -- ¿Ya se aplicó esta operación? Es un reintento: se devuelve lo mismo.
  SELECT resultado INTO prev_op FROM vale_eventos WHERE op = p_op;
  IF FOUND THEN
    RETURN COALESCE(prev_op, '{}'::jsonb) || jsonb_build_object('ya_aplicado', true, 'reintento', true);
  END IF;

  SELECT data INTO cur FROM vales WHERE id = p_vale FOR UPDATE;
  IF cur IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'motivo', 'no_existe');
  END IF;

  cur_rank := _vale_rango(cur->>'status');
  new_rank := _vale_rango(COALESCE(p_cambios->>'status', cur->>'status'));
  cur_rev  := COALESCE((cur->>'rev')::bigint, 0);
  nuevo    := cur;

  -- ¿Quedó descontado el stock de este vale? (bandera; si falta, se deduce del estado)
  descontado := CASE
    WHEN cur->'unidoA' IS NOT NULL AND cur->>'unidoA' IS NOT NULL THEN false
    WHEN cur->>'stockDecremented' = 'true'  THEN true
    WHEN cur->>'stockDecremented' = 'false' THEN false
    ELSE cur_rank >= 3 END;

  IF new_rank >= 3 AND cur_rank >= 3 AND new_rank <= cur_rank THEN
    -- Ya estaba confirmado / en cobro: no se vuelve a hacer nada (ni stock).
    ya := true;
  ELSE
    -- 1) Aplicar los campos pedidos (null = quitar el campo).
    FOR k, val IN SELECT * FROM jsonb_each(COALESCE(p_cambios, '{}'::jsonb)) LOOP
      IF k IN ('id','gestorId','rev','revOp','stockSalido','stockDecremented') THEN CONTINUE; END IF;
      IF jsonb_typeof(val) = 'null' THEN nuevo := nuevo - k;
      ELSE nuevo := jsonb_set(nuevo, ARRAY[k], val, true); END IF;
    END LOOP;

    -- 2) Stock, en la misma transacción.
    IF new_rank >= 3 AND cur_rank < 3 THEN
      -- CONFIRMAR / ENTREGAR
      IF p_descontar AND NOT descontado AND NOT (cur ? 'unidoA' AND cur->>'unidoA' IS NOT NULL) THEN
        salido := '{}'::jsonb;
        FOR el IN SELECT value FROM jsonb_array_elements(COALESCE(cur->'valeProductos', '[]'::jsonb))
                  ORDER BY (value->>'id')::bigint LOOP
          pid := (el->>'id')::bigint;
          qty := GREATEST(0, COALESCE((el->>'qty')::int, 0));
          SELECT COALESCE((data->>'stock')::int, 0) INTO s FROM productos WHERE id = pid FOR UPDATE;
          IF NOT FOUND THEN CONTINUE; END IF;
          salen := LEAST(qty, GREATEST(s, 0));
          UPDATE productos SET data = jsonb_set(data, '{stock}', to_jsonb(s - salen)) WHERE id = pid;
          salido := jsonb_set(salido, ARRAY[pid::text],
                     to_jsonb(COALESCE((salido->>pid::text)::int, 0) + salen), true);
        END LOOP;
        nuevo := jsonb_set(nuevo, '{stockSalido}', salido, true);
        nuevo := jsonb_set(nuevo, '{stockDecremented}', 'true'::jsonb, true);
        hizo_baja := true;
      ELSE
        -- No se descuenta aquí (ya estaba descontado o el teléfono avisa de que ya salió).
        nuevo := jsonb_set(nuevo, '{stockDecremented}',
                           to_jsonb(COALESCE((p_cambios->>'stockDecremented')::boolean, descontado)), true);
      END IF;
    ELSIF new_rank < 3 AND cur_rank >= 3 THEN
      -- REVERTIR: se devuelve lo que SALIÓ, una sola vez.
      IF descontado THEN
        FOR el IN SELECT value FROM jsonb_array_elements(COALESCE(cur->'valeProductos', '[]'::jsonb))
                  ORDER BY (value->>'id')::bigint LOOP
          pid := (el->>'id')::bigint;
          dev := CASE WHEN jsonb_typeof(cur->'stockSalido') = 'object'
                      THEN GREATEST(0, COALESCE((cur->'stockSalido'->>pid::text)::int, 0))
                      ELSE GREATEST(0, COALESCE((el->>'qty')::int, 0)) END;
          IF dev = 0 THEN CONTINUE; END IF;
          SELECT COALESCE((data->>'stock')::int, 0) INTO s FROM productos WHERE id = pid FOR UPDATE;
          IF NOT FOUND THEN CONTINUE; END IF;
          UPDATE productos SET data = jsonb_set(data, '{stock}', to_jsonb(s + dev)) WHERE id = pid;
          -- si hay dos líneas del mismo producto, la primera ya devolvió todo lo salido
          IF jsonb_typeof(cur->'stockSalido') = 'object' THEN
            cur := jsonb_set(cur, ARRAY['stockSalido', pid::text], '0'::jsonb, true);
          END IF;
        END LOOP;
      END IF;
      nuevo := jsonb_set(nuevo, '{stockDecremented}', 'false'::jsonb, true);
      nuevo := nuevo - 'stockSalido';
    ELSE
      nuevo := jsonb_set(nuevo, '{stockDecremented}',
                         to_jsonb(COALESCE((p_cambios->>'stockDecremented')::boolean, descontado)), true);
    END IF;

    nuevo := jsonb_set(nuevo, '{rev}',   to_jsonb(GREATEST(cur_rev + 1, COALESCE(p_rev, 0))), true);
    nuevo := jsonb_set(nuevo, '{revOp}', to_jsonb(p_op), true);
    UPDATE vales SET data = nuevo WHERE id = p_vale;
  END IF;

  -- Stock actual de los productos del vale (el teléfono ajusta su pantalla con esto).
  FOR el IN SELECT value FROM jsonb_array_elements(COALESCE(nuevo->'valeProductos', '[]'::jsonb)) LOOP
    pid := (el->>'id')::bigint;
    SELECT COALESCE((data->>'stock')::int, 0) INTO s FROM productos WHERE id = pid;
    IF FOUND THEN stock_map := jsonb_set(stock_map, ARRAY[pid::text], to_jsonb(s), true); END IF;
  END LOOP;

  prev_op := jsonb_build_object('applied', true, 'ya_aplicado', ya, 'descontado_ahora', hizo_baja,
                                'data', nuevo, 'stock', stock_map);
  INSERT INTO vale_eventos (op, vale_id, resultado) VALUES (p_op, p_vale, prev_op)
  ON CONFLICT (op) DO NOTHING;
  RETURN prev_op;
END;
$$;

GRANT EXECUTE ON FUNCTION vale_aplicar_estado(text, bigint, jsonb, boolean, bigint) TO anon;

SELECT 'vale_aplicar_estado creada correctamente' AS resultado, proname AS funcion
FROM pg_proc WHERE proname = 'vale_aplicar_estado' AND pronamespace = 'public'::regnamespace;
