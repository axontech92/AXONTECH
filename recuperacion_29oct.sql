-- ══════════════════════════════════════════════════════════════════════
--  AXONTECH · Recuperación del incidente del 29/10/2026 (v16.0)
-- ══════════════════════════════════════════════════════════════════════
--  v16.0 reenvió al abrir la app envíos rechazados de meses atrás. Pudo:
--    · volver a subir vales que ya se habían borrado (resucitados)
--    · pisar vales actuales con versiones viejas
--    · tocar catálogo, configuración u otros documentos
--  v16.0 se publicó el 29/10 a las 06:34 UTC (02:34 en Cuba). Todo lo que se
--  escribió desde entonces es sospechoso.
--
--  CÓMO USARLO: Supabase → SQL Editor. Ejecuta los bloques UNO A UNO, en orden.
--  Los pasos 1–4 solo LEEN. El paso 5 BORRA: no lo ejecutes sin revisar antes
--  la lista del paso 3.
-- ══════════════════════════════════════════════════════════════════════

-- ── PASO 0 · ¿Hay copia de seguridad del servidor? ────────────────────────
--  Antes que nada: Supabase → Database → Backups. En el plan Pro hay copias
--  diarias (y Point in Time si está activado). Si hay una de ANTES del 29/10
--  06:34 UTC, es la forma más segura de recuperar los vales actuales que se
--  perdieron. No restaures encima sin hablarlo: restaurar pisa lo vendido hoy.

-- ── PASO 1 · Resumen: qué se escribió desde el incidente ──────────────────
SELECT 'vales'     AS tabla, count(*) AS filas_tocadas FROM vales     WHERE updated_at >= '2026-10-29 06:30+00'
UNION ALL
SELECT 'productos', count(*) FROM productos WHERE updated_at >= '2026-10-29 06:30+00'
UNION ALL
SELECT 'meta',      count(*) FROM meta      WHERE updated_at >= '2026-10-29 06:30+00';

-- ── PASO 2 · Documentos de configuración tocados (config, costos, notifs…) ─
SELECT name, updated_at FROM meta WHERE updated_at >= '2026-10-29 06:30+00' ORDER BY updated_at;

-- ── PASO 3 · Vales sospechosos de estar RESUCITADOS ───────────────────────
--  Escritos después del incidente pero con fecha de venta de hace más de 3 días.
--  Revisa la lista: si reconoces vales que ya habías borrado, son estos.
SELECT id,
       data->>'valeNum'  AS num,
       data->>'ts'       AS fecha_vale,
       data->>'status'   AS estado,
       data->>'gestorId' AS gestor,
       data->>'cliente'  AS cliente,
       updated_at
FROM vales
WHERE updated_at >= '2026-10-29 06:30+00'
  AND (data->>'ts')::timestamptz < now() - interval '3 days'
ORDER BY (data->>'ts')::timestamptz;

-- ── PASO 4 · Vales que tienen lápida (alguien los borró) y siguen en la tabla ─
SELECT v.id, v.data->>'valeNum' AS num, v.data->>'ts' AS fecha_vale, l.value AS borrado_el
FROM vales v
JOIN meta m ON m.name = 'vales_borrados'
JOIN LATERAL jsonb_each_text(m.data) l ON l.key = v.id::text AND l.value IS NOT NULL
ORDER BY v.id;

-- ── PASO 5 · BORRAR los resucitados (solo después de revisar 3 y 4) ───────
--  a) Los que tienen lápida: seguro, alguien los borró a propósito.
-- DELETE FROM vales v USING meta m
--  WHERE m.name = 'vales_borrados' AND (m.data->>(v.id::text)) IS NOT NULL;
--
--  b) Los del paso 3 que reconozcas como borrados: pon sus id aquí.
-- DELETE FROM vales WHERE id IN (/* id1, id2, ... */);
--
--  OJO: borrar aquí NO devuelve stock. Si alguno estaba confirmado y su stock
--  se había devuelto al borrarlo la primera vez, así está bien.
