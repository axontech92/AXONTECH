-- ══════════════════════════════════════════════════════════════════════
--  AXONTECH · Migración v96 — Que dos teléfonos no se pisen el stock
-- ══════════════════════════════════════════════════════════════════════
--
-- QUÉ QUEDABA MAL
--   Desde v95 cada cambio sube solo el producto tocado, así que un teléfono
--   desactualizado ya no puede reponer el catálogo entero (eso fue lo que costó
--   el inventario del 16/08). Pero lo que sube sigue siendo un número ABSOLUTO:
--
--     El teléfono A lee stock=10, vende 2 y escribe 8.
--     El teléfono B, que también leyó 10, vende 1 y escribe 9.
--
--   Han salido 3 unidades y en la nube quedan 9. Se perdió una venta. No hace
--   falta que nadie tenga la copia vieja de ayer: basta con que los dos hayan
--   leído el mismo número en los últimos 5 minutos, que es justo lo que pasa un
--   sábado por la tarde con dos personas despachando.
--
-- LA SOLUCIÓN
--   Que la resta la haga la base de datos, no el teléfono. El teléfono deja de
--   decir "el stock queda en 8" y pasa a decir "quita 2". Dos "quita 2" y
--   "quita 1" seguidos dan 7, que es la verdad, sin importar en qué orden
--   lleguen ni qué número tuviera cada uno en pantalla.
--
--   Es la misma idea que ya se usa para los vales (upsert_vale_from_gestor):
--   el que escribe manda su intención, y el servidor la aplica sobre el dato
--   bueno en vez de sobre una foto vieja.
--
-- CÓMO USAR
--   1. Entra a Supabase: https://supabase.com/dashboard
--   2. Menú izquierdo → "SQL Editor" (icono `</>`)
--   3. "New query", pega TODO este archivo y pulsa "Run" (Ctrl+Enter)
--   4. Debe decir "Success. No rows returned".
--   5. Ya está. La app v96+ la detecta sola. Si no la encuentra, sigue
--      funcionando como hasta ahora (número absoluto), así que no corre prisa
--      ni se rompe nada si tardas en ejecutarlo.
--
-- NOTAS
--   - Es SEGURO re-ejecutarlo: usa OR REPLACE.
--   - No borra ni modifica ningún dato al instalarse.
--   - El stock nunca baja de 0, igual que en la app.
-- ══════════════════════════════════════════════════════════════════════

-- ── Registro de operaciones ya aplicadas ──
-- Un "quita 2" no es como un "queda en 8": repetirlo NO da el mismo resultado.
-- Y repetirlo es fácil — el teléfono manda la orden, la conexión se cae antes
-- de que llegue la confirmación, y la app reintenta creyendo que no llegó. Sin
-- esta tabla, esa caída descontaría 4 en vez de 2.
-- Cada orden lleva su identificador; si ya está aquí, se devuelve el stock
-- actual sin volver a restar.
CREATE TABLE IF NOT EXISTS stock_ops (
  op_id       text PRIMARY KEY,
  producto_id bigint,
  delta       int,
  aplicado_en timestamptz DEFAULT now()
);

-- Las órdenes viejas no sirven de nada: se pueden borrar sin miedo pasado un
-- tiempo prudencial (un reintento nunca llega días después).
CREATE INDEX IF NOT EXISTS stock_ops_fecha ON stock_ops (aplicado_en);

-- ── Función RPC: aplicar_delta_stock ──
-- p_id    : id del producto
-- p_delta : cuánto sumar (negativo para descontar una venta)
-- p_op    : identificador de la orden, para que un reintento no reste dos veces
-- Devuelve el stock que queda, para que el teléfono pueda ponerse al día.
CREATE OR REPLACE FUNCTION aplicar_delta_stock(p_id bigint, p_delta int, p_op text DEFAULT NULL)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_actual int;
  v_nuevo  int;
BEGIN
  -- ¿Ya se aplicó esta orden? Entonces esto es un reintento: se devuelve lo que
  -- hay sin tocar nada.
  IF p_op IS NOT NULL AND EXISTS (SELECT 1 FROM stock_ops WHERE op_id = p_op) THEN
    SELECT COALESCE((data->>'stock')::int, 0) INTO v_actual
      FROM productos WHERE id = p_id;
    RETURN COALESCE(v_actual, -1);
  END IF;

  -- FOR UPDATE bloquea la fila mientras se calcula. Si dos teléfonos llegan a
  -- la vez, uno espera al otro en vez de leer los dos el mismo número viejo:
  -- ahí es donde se perdía la venta.
  SELECT COALESCE((data->>'stock')::int, 0) INTO v_actual
    FROM productos WHERE id = p_id FOR UPDATE;

  IF NOT FOUND THEN
    -- El producto no está en la nube (¿borrado desde otro teléfono?). No se
    -- inventa una fila: se avisa con -1 y el teléfono decide qué hacer.
    RETURN -1;
  END IF;

  v_nuevo := GREATEST(0, v_actual + p_delta);

  UPDATE productos
     SET data = jsonb_set(data, '{stock}', to_jsonb(v_nuevo))
   WHERE id = p_id;

  IF p_op IS NOT NULL THEN
    INSERT INTO stock_ops (op_id, producto_id, delta) VALUES (p_op, p_id, p_delta)
    ON CONFLICT (op_id) DO NOTHING;
  END IF;

  RETURN v_nuevo;
END;
$$;

-- Permisos: los mismos que ya usa la app para escribir productos.
GRANT EXECUTE ON FUNCTION aplicar_delta_stock(bigint, int, text) TO anon, authenticated;
GRANT SELECT, INSERT ON stock_ops TO anon, authenticated;

-- ── Limpieza opcional ──
-- Las órdenes de más de 30 días no las va a reintentar nadie. Si algún día la
-- tabla molesta, esto la deja a raya (se puede ejecutar a mano cuando se quiera):
--   DELETE FROM stock_ops WHERE aplicado_en < now() - interval '30 days';
