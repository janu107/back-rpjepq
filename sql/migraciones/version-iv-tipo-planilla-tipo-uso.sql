-- =====================================================================
-- VERSION IV - (OPCIONAL) tpl_id_tipo_uso como entero referenciando man_id
-- =====================================================================
-- NO es obligatorio. La aplicacion ya funciona con tpl_id_tipo_uso VARCHAR(20)
-- guardando el man_id seleccionado; el JOIN con RPJ_CAT_MANEJO_ADMINISTRACION
-- usa conversion implicita y muestra man_descripcion como "Tipo uso".
--
-- Esta migracion solo se sugiere si se desea integridad referencial estricta.
-- Ejecutar de forma controlada y con respaldo previo (cambio potencialmente
-- destructivo si existen valores no numericos en tpl_id_tipo_uso).
-- =====================================================================

-- PASO 1: verificar que todos los valores actuales sean numericos y existan en manejo.
SELECT t.tpl_id, t.tpl_id_tipo_uso
FROM RPJ_CAT_TIPO_PLANILLA t
LEFT JOIN RPJ_CAT_MANEJO_ADMINISTRACION m ON m.man_id = t.tpl_id_tipo_uso
WHERE m.man_id IS NULL AND t.tpl_id_tipo_uso IS NOT NULL AND t.tpl_id_tipo_uso <> '';

-- PASO 2: (solo si el PASO 1 devolvio 0 filas) convertir la columna y crear la FK.
-- ALTER TABLE RPJ_CAT_TIPO_PLANILLA
--   MODIFY COLUMN tpl_id_tipo_uso INT NULL;
-- ALTER TABLE RPJ_CAT_TIPO_PLANILLA
--   ADD CONSTRAINT fk_tpl_tipo_uso FOREIGN KEY (tpl_id_tipo_uso)
--   REFERENCES RPJ_CAT_MANEJO_ADMINISTRACION (man_id);
