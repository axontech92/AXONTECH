-- ══════════════════════════════════════════════════════════════════════
--  AXONTECH · Migración v141 — Que un teléfono viejo no pise la config
-- ══════════════════════════════════════════════════════════════════════
--
-- QUÉ PASABA
--   "Ayer puse +20 a la tasa y hoy amaneció en +10." Un equipo de admin con la
--   versión VIEJA de la app (sin recargar) actualiza la tasa del día solo, cada
--   pocas horas, y al hacerlo subía la configuración ENTERA tal y como la tenía
--   él: con el +10 de antes. Eso borraba el +20.
--
--   La versión nueva ya no hace eso: sube solo lo que cambia, por
--   meta_fusionar (migración v140). Pero un teléfono que no se ha recargado
--   sigue con el código viejo, y ese no se puede arreglar desde aquí.
--
-- LA SOLUCIÓN
--   La base de datos deja de aceptar que alguien REEMPLACE la config entera.
--   Si llega una config completa por la vía vieja, se añaden solo las claves
--   que no existían y se ignora lo demás: lo que ya está en la nube manda.
--   Los cambios de verdad llegan por meta_fusionar, que sí se aplican.
--
-- CÓMO USAR
--   1. Antes, la migración v140 tiene que estar instalada (ya lo está).
--   2. Supabase → "SQL Editor" → "New query", pega TODO este archivo → "Run".
--   3. Debe decir "Success. No rows returned".
--   4. Vuelve a poner tu +20 desde la app (ya no se perderá).
--
-- NOTAS
--   - Es SEGURO re-ejecutarlo.
--   - No borra ni cambia ningún dato.
-- ══════════════════════════════════════════════════════════════════════

-- 1. meta_fusionar se identifica: sus cambios SÍ se aplican.
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

  -- Marca para el disparador de abajo: esta escritura es de las buenas.
  PERFORM set_config('axon.fusion', '1', true);

  INSERT INTO meta (name, data) VALUES (p_name, v_poner)
  ON CONFLICT (name) DO UPDATE
    SET data = (CASE WHEN jsonb_typeof(meta.data) = 'object' THEN meta.data ELSE '{}'::jsonb END - v_quitar) || v_poner;

  PERFORM set_config('axon.fusion', '', true);
END;
$$;

GRANT EXECUTE ON FUNCTION meta_fusionar(text, jsonb) TO anon, authenticated;

-- 2. Una config entera que llega por la vía vieja no pisa lo que ya hay.
CREATE OR REPLACE FUNCTION axon_config_solo_fusion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.name = 'config'
     AND coalesce(current_setting('axon.fusion', true), '') <> '1'
     AND jsonb_typeof(OLD.data) = 'object'
     AND jsonb_typeof(NEW.data) = 'object' THEN
    -- Lo de la nube gana; de lo que llega solo se aprovechan claves nuevas.
    NEW.data := NEW.data || OLD.data;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS axon_config_solo_fusion ON meta;
CREATE TRIGGER axon_config_solo_fusion
  BEFORE UPDATE ON meta
  FOR EACH ROW EXECUTE FUNCTION axon_config_solo_fusion();

-- 3. La protección de v115 ("no vaciar la config") devolvía las claves que una
--    escritura no traía. Con meta_fusionar eso sobra —solo toca las claves que
--    nombra— y además impedía QUITAR una clave a propósito (volver al mes
--    natural en el ciclo no llegaba nunca a la nube). Las escrituras de
--    meta_fusionar se dejan pasar; las demás, igual que antes.
CREATE OR REPLACE FUNCTION axon_no_vaciar_config()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  faltantes text[];
BEGIN
  IF NEW.name IS DISTINCT FROM 'config' THEN
    RETURN NEW;
  END IF;
  IF coalesce(current_setting('axon.fusion', true), '') = '1' THEN
    RETURN NEW;                       -- v141: cambio de meta_fusionar, se aplica tal cual
  END IF;
  IF jsonb_typeof(OLD.data) <> 'object' OR jsonb_typeof(NEW.data) <> 'object' THEN
    RETURN NEW;
  END IF;
  SELECT array_agg(k) INTO faltantes
    FROM jsonb_object_keys(OLD.data) k
   WHERE NOT (NEW.data ? k)
     AND k <> 'ghToken';
  IF faltantes IS NULL THEN
    RETURN NEW;
  END IF;
  NEW.data := (SELECT jsonb_object_agg(k, OLD.data -> k) FROM unnest(faltantes) k)
              || NEW.data;
  RETURN NEW;
END;
$$;
