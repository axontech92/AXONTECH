-- ══════════════════════════════════════════════════════════════════════
--  AXONTECH · Migración v140 — Que la base de datos junte los cambios
-- ══════════════════════════════════════════════════════════════════════
--
-- QUÉ PASABA
--   Documentos como la configuración, las mermas o la lista de vales borrados
--   se actualizaban así: el teléfono leía el documento, le metía su cambio y
--   lo volvía a subir entero. Si dos equipos lo hacían a la vez (el admin en el
--   ordenador y en el teléfono), el segundo borraba el cambio del primero.
--
-- LA SOLUCIÓN
--   1. meta_fusionar(nombre, cambios): la propia base de datos mete los cambios
--      en el documento, de uno en uno, sin que nadie pueda pisar a nadie.
--   2. La hora de "último cambio" de cada fila pasa a ser la del momento real
--      (clock_timestamp) y no la del inicio de la operación (now()). Con now(),
--      un cambio que empezaba antes pero terminaba después podía quedar con una
--      hora más vieja que la que el teléfono ya había visto, y no se bajaba.
--
-- CÓMO USAR
--   1. https://supabase.com/dashboard → tu proyecto → "SQL Editor"
--   2. "New query", pega TODO este archivo y pulsa "Run"
--   3. Debe decir "Success. No rows returned".
--
-- NOTAS
--   - Es SEGURO re-ejecutarlo (OR REPLACE).
--   - No borra ni cambia ningún dato. Sin esta migración la app sigue
--     funcionando como antes.
--   - Es gratis.
-- ══════════════════════════════════════════════════════════════════════

-- 1. Juntar cambios en un documento de la tabla meta.
--    Las claves que llegan con valor null se QUITAN del documento.
CREATE OR REPLACE FUNCTION meta_fusionar(p_name text, p_patch jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_quitar text[];
  v_poner  jsonb;
BEGIN
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'meta_fusionar: el cambio tiene que ser un objeto';
  END IF;
  SELECT coalesce(array_agg(key), '{}') INTO v_quitar
    FROM jsonb_each(p_patch) WHERE value = 'null'::jsonb;
  SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb) INTO v_poner
    FROM jsonb_each(p_patch) WHERE value <> 'null'::jsonb;

  -- El número de vale de la config solo sube (igual que hace la app).
  IF p_name = 'config' AND v_poner ? 'nextValeNum' THEN
    v_poner := jsonb_set(v_poner, '{nextValeNum}', to_jsonb(GREATEST(
      coalesce((v_poner->>'nextValeNum')::numeric, 0),
      coalesce((SELECT CASE WHEN (data->>'nextValeNum') ~ '^[0-9]+$' THEN (data->>'nextValeNum')::numeric END
                  FROM meta WHERE name = 'config'), 0))));
  END IF;

  INSERT INTO meta (name, data) VALUES (p_name, v_poner)
  ON CONFLICT (name) DO UPDATE
    SET data = (CASE WHEN jsonb_typeof(meta.data) = 'object' THEN meta.data ELSE '{}'::jsonb END - v_quitar) || v_poner;
END;
$$;

GRANT EXECUTE ON FUNCTION meta_fusionar(text, jsonb) TO anon, authenticated;

-- 2. La hora del último cambio, la de verdad.
CREATE OR REPLACE FUNCTION _touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  new.updated_at = clock_timestamp();
  RETURN new;
END;
$$;
