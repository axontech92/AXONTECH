-- ══════════════════════════════════════════════════════════════════════
--  AXONTECH · Migración v144 — Eliminar un vale devuelve el stock UNA vez
-- ══════════════════════════════════════════════════════════════════════
--
-- QUÉ QUEDABA MAL
--   Al eliminar un vale confirmado, el teléfono devolvía el stock según SU copia
--   del vale. El gestor puede eliminar cualquier vale suyo, y su copia puede ir
--   atrasada: si el admin lo había confirmado y el teléfono aún no lo sabía, el
--   stock no volvía; si dos teléfonos lo borraban, volvía dos veces.
--
-- LA SOLUCIÓN
--   vale_eliminar(op, vale): en una transacción bloquea el vale, mira en la NUBE
--   si su stock salió, lo devuelve (lo que salió, no lo pedido), borra la fila y
--   apunta la operación. Repetirla o borrar un vale ya borrado no devuelve nada.
--
-- REQUIERE migration_v143_eventos_vale.sql (usa su tabla vale_eventos).
-- Seguro de re-ejecutar. No toca datos al instalarse.
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION vale_eliminar(p_op text, p_vale bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  cur        jsonb;
  prev_op    jsonb;
  descontado boolean;
  el         jsonb;
  pid        bigint;
  dev        int;
  s          int;
  salido     jsonb;
  stock_map  jsonb := '{}'::jsonb;
  res        jsonb;
BEGIN
  IF p_vale IS NULL OR p_vale = 0 THEN
    RETURN jsonb_build_object('applied', true, 'probe', true);
  END IF;
  IF p_op IS NULL OR length(p_op) = 0 THEN
    RAISE EXCEPTION 'vale_eliminar: falta el identificador de operación';
  END IF;

  SELECT resultado INTO prev_op FROM vale_eventos WHERE op = p_op;
  IF FOUND THEN
    RETURN COALESCE(prev_op, '{}'::jsonb) || jsonb_build_object('reintento', true);
  END IF;

  SELECT data INTO cur FROM vales WHERE id = p_vale FOR UPDATE;
  IF cur IS NULL THEN
    -- Ya no está como fila propia: o ya se borró, o es del formato antiguo
    -- (vales anidados en la fila del gestor). El teléfono decide qué hacer.
    res := jsonb_build_object('applied', true, 'ya_borrado', true, 'stock', '{}'::jsonb);
    INSERT INTO vale_eventos (op, vale_id, resultado) VALUES (p_op, p_vale, res) ON CONFLICT (op) DO NOTHING;
    RETURN res;
  END IF;

  descontado := CASE
    WHEN cur->>'unidoA' IS NOT NULL THEN false
    WHEN cur->>'stockDecremented' = 'true'  THEN true
    WHEN cur->>'stockDecremented' = 'false' THEN false
    ELSE _vale_rango(cur->>'status') >= 3 END;

  IF descontado THEN
    salido := CASE WHEN jsonb_typeof(cur->'stockSalido') = 'object' THEN cur->'stockSalido' ELSE NULL END;
    FOR el IN SELECT value FROM jsonb_array_elements(COALESCE(cur->'valeProductos', '[]'::jsonb))
              ORDER BY (value->>'id')::bigint LOOP
      pid := (el->>'id')::bigint;
      dev := CASE WHEN salido IS NOT NULL THEN GREATEST(0, COALESCE((salido->>pid::text)::int, 0))
                  ELSE GREATEST(0, COALESCE((el->>'qty')::int, 0)) END;
      IF dev = 0 THEN CONTINUE; END IF;
      SELECT COALESCE((data->>'stock')::int, 0) INTO s FROM productos WHERE id = pid FOR UPDATE;
      IF NOT FOUND THEN CONTINUE; END IF;
      UPDATE productos SET data = jsonb_set(data, '{stock}', to_jsonb(s + dev)) WHERE id = pid;
      IF salido IS NOT NULL THEN salido := jsonb_set(salido, ARRAY[pid::text], '0'::jsonb, true); END IF;
    END LOOP;
  END IF;

  DELETE FROM vales WHERE id = p_vale;

  FOR el IN SELECT value FROM jsonb_array_elements(COALESCE(cur->'valeProductos', '[]'::jsonb)) LOOP
    pid := (el->>'id')::bigint;
    SELECT COALESCE((data->>'stock')::int, 0) INTO s FROM productos WHERE id = pid;
    IF FOUND THEN stock_map := jsonb_set(stock_map, ARRAY[pid::text], to_jsonb(s), true); END IF;
  END LOOP;

  res := jsonb_build_object('applied', true, 'ya_borrado', false, 'devuelto', descontado, 'stock', stock_map);
  INSERT INTO vale_eventos (op, vale_id, resultado) VALUES (p_op, p_vale, res) ON CONFLICT (op) DO NOTHING;
  RETURN res;
END;
$$;

GRANT EXECUTE ON FUNCTION vale_eliminar(text, bigint) TO anon;

SELECT 'vale_eliminar creada correctamente' AS resultado, proname AS funcion
FROM pg_proc WHERE proname = 'vale_eliminar' AND pronamespace = 'public'::regnamespace;
