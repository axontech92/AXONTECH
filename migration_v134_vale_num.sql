-- ══════════════════════════════════════════════════════════════════════
--  AXONTECH · Migración v134 — Números de vale que no se repiten
-- ══════════════════════════════════════════════════════════════════════
--
-- QUÉ QUEDABA MAL
--   El número de vale (V-001, V-002…) lo reservaba cada teléfono con su
--   propia copia del contador. En los datos reales había 192 números
--   repetidos. v133 arregló la causa principal (el contador retrocedía), pero
--   queda un caso que el teléfono no puede resolver solo: dos gestores que
--   mandan un vale en el mismo minuto, antes de que ninguno haya visto el
--   número del otro, se llevan el mismo.
--
-- LA SOLUCIÓN
--   Que el número lo dé la base de datos, que atiende de uno en uno. El
--   teléfono le pide "dame el siguiente" y nadie más puede recibir ese mismo.
--   La app lo pide por adelantado (en cuanto tiene conexión) y lo guarda, así
--   que al mandar el vale no tiene que esperar a internet. Sin conexión, o si
--   esta función no está instalada, sigue como en v133.
--
-- CÓMO USAR
--   1. Entra a Supabase: https://supabase.com/dashboard
--   2. Menú izquierdo → "SQL Editor" (icono `</>`)
--   3. "New query", pega TODO este archivo y pulsa "Run" (Ctrl+Enter)
--   4. Debe decir "Success. No rows returned".
--   5. Ya está. La app v134+ la detecta sola.
--
-- NOTAS
--   - Es SEGURO re-ejecutarlo: usa IF NOT EXISTS y OR REPLACE.
--   - No borra ni cambia ningún vale. Los números viejos repetidos se quedan
--     como están; esto evita que salgan más.
--   - El contador arranca por encima del número más alto que ya exista.
--   - Es gratis: no usa nada del plan de pago.
-- ══════════════════════════════════════════════════════════════════════

-- Una sola fila con el siguiente número libre.
CREATE TABLE IF NOT EXISTS vale_contador (
  id        int PRIMARY KEY DEFAULT 1,
  siguiente bigint NOT NULL,
  CHECK (id = 1)
);
-- Cerrada al público: solo se toca a través de la función de abajo.
ALTER TABLE vale_contador ENABLE ROW LEVEL SECURITY;

-- Arranca por encima del número más alto que ya haya en los vales.
INSERT INTO vale_contador (id, siguiente)
SELECT 1, COALESCE(MAX((data->>'valeNum')::bigint), 0) + 1
  FROM vales
 WHERE data ? 'valeNum' AND (data->>'valeNum') ~ '^[0-9]+$'
ON CONFLICT (id) DO NOTHING;

-- ── Función RPC: reservar_vale_num ──
-- p_minimo : el número más alto que ESTE teléfono ya ha visto + 1. Si la
--            base de datos va por detrás (por ejemplo, vales hechos antes de
--            instalar esto), se pone al día y nunca da un número ya usado.
-- Devuelve el número reservado. Nadie más lo recibirá.
CREATE OR REPLACE FUNCTION reservar_vale_num(p_minimo bigint DEFAULT 0)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_n bigint;
BEGIN
  INSERT INTO vale_contador (id, siguiente) VALUES (1, GREATEST(p_minimo, 1))
  ON CONFLICT (id) DO NOTHING;
  -- UPDATE … RETURNING es atómico: dos llamadas a la vez reciben números distintos.
  UPDATE vale_contador
     SET siguiente = GREATEST(siguiente, COALESCE(p_minimo, 0)) + 1
   WHERE id = 1
  RETURNING siguiente - 1 INTO v_n;
  RETURN v_n;
END;
$$;

GRANT EXECUTE ON FUNCTION reservar_vale_num(bigint) TO anon, authenticated;
