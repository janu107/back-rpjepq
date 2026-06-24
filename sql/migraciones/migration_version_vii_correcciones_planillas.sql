-- ============================================================================
-- MIGRACIÓN VERSION VII — Correcciones de planillas, parámetros y catálogos
-- Base de datos : apps_rpjepq
-- Motor         : MySQL 8 / MariaDB (sintaxis portable, sin IF NOT EXISTS en DDL)
-- Idempotente, NO destructiva (sin DROP TABLE / TRUNCATE / DELETE).
--
-- Hace:
--   1. Agrega par_desc_asociacion a RPJ_CAT_PARAMETRO_GENERAL si no existe.
--   2. Reporta duplicados en RPJ_CAT_TIPO_PLANILLA (descripcion + tipo_uso).
--   3. Crea índice único en RPJ_CAT_TIPO_PLANILLA SOLO si no hay duplicados.
--   4. Reporta duplicados en RPJ_CAT_PARAMETRO_PLANILLA (tipo + numero).
--   5. Crea índice único en RPJ_CAT_PARAMETRO_PLANILLA SOLO si no hay duplicados.
--
-- IMPORTANTE: si hay duplicados, los índices únicos NO se crean (se reporta
-- la lista para que el usuario decida cuál conservar). Reejecutar después de
-- limpiar los duplicados.
-- ============================================================================

SET @OLD_FK := @@FOREIGN_KEY_CHECKS;
SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================================
-- BLOQUE 0 — HELPERS idempotentes
-- ============================================================================
DELIMITER $$

-- NOTA: helpers silenciosos (sin SELECT) para compatibilidad con phpMyAdmin.

DROP PROCEDURE IF EXISTS _v7_add_column $$
CREATE PROCEDURE _v7_add_column(IN p_table VARCHAR(64), IN p_column VARCHAR(64), IN p_ddl TEXT)
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND COLUMN_NAME = p_column) THEN
    SET @s = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN ', p_ddl);
    PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
  END IF;
END $$

-- Crea índice único sólo si NO existe y NO hay duplicados (p_dup_count = nº de
-- grupos duplicados). Si hay duplicados, no lo crea (se reporta en BLOQUE 2/3).
DROP PROCEDURE IF EXISTS _v7_add_unique_if_clean $$
CREATE PROCEDURE _v7_add_unique_if_clean(
  IN p_table VARCHAR(64), IN p_index VARCHAR(64), IN p_cols TEXT, IN p_dup_count INT)
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND INDEX_NAME = p_index)
     AND p_dup_count = 0 THEN
    SET @s = CONCAT('CREATE UNIQUE INDEX `', p_index, '` ON `', p_table, '` (', p_cols, ')');
    PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
  END IF;
END $$

DELIMITER ;

-- ============================================================================
-- BLOQUE 1 — par_desc_asociacion en RPJ_CAT_PARAMETRO_GENERAL
-- ============================================================================
SELECT 'BLOQUE 1: par_desc_asociacion' AS etapa;
CALL _v7_add_column('RPJ_CAT_PARAMETRO_GENERAL', 'par_desc_asociacion',
     'par_desc_asociacion DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER par_intecap');

-- ============================================================================
-- BLOQUE 2 — Duplicados en RPJ_CAT_TIPO_PLANILLA (descripcion + tipo_uso)
-- ============================================================================
SELECT 'BLOQUE 2: duplicados tipo_planilla (deberían ser 0 filas)' AS etapa;
SELECT UPPER(TRIM(tpl_descripcion)) AS descripcion, tpl_id_tipo_uso, COUNT(*) AS total
  FROM RPJ_CAT_TIPO_PLANILLA
 GROUP BY UPPER(TRIM(tpl_descripcion)), tpl_id_tipo_uso
HAVING COUNT(*) > 1;

SELECT COUNT(*) INTO @dup_tpl FROM (
  SELECT 1 FROM RPJ_CAT_TIPO_PLANILLA
   GROUP BY UPPER(TRIM(tpl_descripcion)), tpl_id_tipo_uso
  HAVING COUNT(*) > 1
) z;

CALL _v7_add_unique_if_clean('RPJ_CAT_TIPO_PLANILLA', 'uq_tipo_planilla_desc_uso',
     'tpl_descripcion, tpl_id_tipo_uso', @dup_tpl);

-- ============================================================================
-- BLOQUE 3 — Duplicados en RPJ_CAT_PARAMETRO_PLANILLA (tipo + numero)
-- ============================================================================
SELECT 'BLOQUE 3: duplicados planilla tipo+numero (deberían ser 0 filas)' AS etapa;
SELECT ppl_tipo_planilla, ppl_numero, COUNT(*) AS total
  FROM RPJ_CAT_PARAMETRO_PLANILLA
 GROUP BY ppl_tipo_planilla, ppl_numero
HAVING COUNT(*) > 1;

SELECT COUNT(*) INTO @dup_ppl FROM (
  SELECT 1 FROM RPJ_CAT_PARAMETRO_PLANILLA
   GROUP BY ppl_tipo_planilla, ppl_numero
  HAVING COUNT(*) > 1
) z;

CALL _v7_add_unique_if_clean('RPJ_CAT_PARAMETRO_PLANILLA', 'uq_planilla_tipo_numero',
     'ppl_tipo_planilla, ppl_numero', @dup_ppl);

-- ============================================================================
-- BLOQUE 4 — VERIFICACIÓN
-- ============================================================================
SELECT 'BLOQUE 4: verificación' AS etapa;
SELECT 'par_desc_asociacion existe' AS chequeo,
       COUNT(*) AS ok
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'RPJ_CAT_PARAMETRO_GENERAL'
   AND COLUMN_NAME = 'par_desc_asociacion';

SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE
  FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE()
   AND INDEX_NAME IN ('uq_tipo_planilla_desc_uso', 'uq_planilla_tipo_numero')
 GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE;

-- ============================================================================
-- BLOQUE 5 — LIMPIEZA
-- ============================================================================
DROP PROCEDURE IF EXISTS _v7_add_column;
DROP PROCEDURE IF EXISTS _v7_add_unique_if_clean;

SET FOREIGN_KEY_CHECKS = @OLD_FK;

SELECT 'MIGRACIÓN VERSION VII COMPLETADA. Revisar BLOQUES 2, 3 y 4.' AS estado;
-- ============================================================================
-- FIN
-- ============================================================================
