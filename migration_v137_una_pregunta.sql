-- ══════════════════════════════════════════════════════════════════════
--  AXONTECH · Migración v137 — Una sola pregunta por vuelta
-- ══════════════════════════════════════════════════════════════════════
--
-- QUÉ PASABA
--   Supabase avisó de que el proyecto se pasó del plan gratis en "Log
--   Ingestion" (1.52 de 1 GB). Cada petición que llega a Supabase deja una
--   línea de registro, y la app, en cada teléfono abierto, preguntaba cada 5
--   segundos TRES cosas por separado: "¿hay vales nuevos?", "¿hay avisos
--   nuevos?", "¿se borró algún vale?". Con varios teléfonos abiertos todo el
--   día eso son cientos de miles de peticiones al mes.
--
-- LA SOLUCIÓN
--   Esta función contesta todas esas preguntas de una vez: devuelve la hora
--   del último cambio de cada tabla y de cada documento. El teléfono la llama
--   UNA vez por vuelta y solo baja lo que cambió. Además, desde v137 la app
--   pregunta más despacio cuando nadie la está tocando.
--   Sin esta función la app sigue funcionando (hace las preguntas por
--   separado, como antes, pero ya al ritmo lento).
--
-- CÓMO USAR
--   1. https://supabase.com/dashboard → tu proyecto → "SQL Editor"
--   2. "New query", pega TODO este archivo y pulsa "Run"
--   3. Debe decir "Success. No rows returned".
--
-- NOTAS
--   - Es SEGURO re-ejecutarlo (OR REPLACE).
--   - Solo lee horas de cambio: no devuelve datos de ningún vale ni cliente.
--   - Es gratis.
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION ultimos_cambios(p_gestor bigint DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'vales',      (SELECT max(updated_at) FROM vales),
    'vales_gestor', CASE WHEN p_gestor IS NULL THEN NULL ELSE
                    (SELECT max(updated_at) FROM vales WHERE data->>'gestorId' = p_gestor::text) END,
    'gestores',   (SELECT max(updated_at) FROM gestores),
    'mensajeros', (SELECT max(updated_at) FROM mensajeros),
    'productos',  (SELECT max(updated_at) FROM productos),
    'categorias', (SELECT max(updated_at) FROM categorias),
    'meta',       (SELECT coalesce(jsonb_object_agg(name, updated_at), '{}'::jsonb) FROM meta)
  );
$$;

GRANT EXECUTE ON FUNCTION ultimos_cambios(bigint) TO anon, authenticated;
