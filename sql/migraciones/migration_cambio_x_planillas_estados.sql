-- ============================================================================
-- MIGRACIÓN CAMBIO X — Estados de planilla y normalización de empleados
-- Base de datos : apps_rpjepq
-- Motor         : MySQL 8 / MariaDB (sintaxis portable, sin ADD COLUMN IF NOT EXISTS)
-- Idempotente, NO destructiva (sin DROP TABLE / TRUNCATE / DELETE de datos).
--
-- Hace:
--   1. Garantiza las columnas de estado/auditoría en RPJ_CAT_PARAMETRO_PLANILLA:
--        ppl_estado_proceso, ppl_fecha_generacion, ppl_fecha_cierre,
--        ppl_usuario_genera, ppl_usuario_cierra.
--   2. Normaliza emp_estado: los empleados con estado NULL o vacío pasan a
--        'ACTIVO' (causa raíz de "NO HAY DATOS PARA GENERAR").
--   3. Reporta duplicados por (ppl_tipo_planilla, ppl_numero) y crea índice
--        único SÓLO si no hay duplicados.
--
-- NOTA: los helpers son SILENCIOSOS (sin SELECT interno) para compatibilidad
--       con phpMyAdmin (evita el error #2014 Commands out of sync).
-- ============================================================================

CREATE DATABASE IF NOT EXISTS `apps_rpjepq`
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `apps_rpjepq`;

SET @OLD_FK := @@FOREIGN_KEY_CHECKS;
SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================================
-- BLOQUE 0 — HELPERS idempotentes (silenciosos)
-- ============================================================================
DELIMITER $$

DROP PROCEDURE IF EXISTS _cx_add_column $$
CREATE PROCEDURE _cx_add_column(IN p_table VARCHAR(64), IN p_column VARCHAR(64), IN p_ddl TEXT)
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND COLUMN_NAME = p_column) THEN
    SET @s = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN ', p_ddl);
    PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
  END IF;
END $$

-- Crea índice único sólo si NO existe y NO hay duplicados (p_dup_count = 0).
DROP PROCEDURE IF EXISTS _cx_add_unique_if_clean $$
CREATE PROCEDURE _cx_add_unique_if_clean(
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
-- BLOQUE 1 — Columnas de estado/auditoría en RPJ_CAT_PARAMETRO_PLANILLA
-- ============================================================================
SELECT 'BLOQUE 1: columnas de estado de planilla' AS etapa;

CALL _cx_add_column('RPJ_CAT_PARAMETRO_PLANILLA', 'ppl_estado_proceso',
     "ppl_estado_proceso ENUM('ABIERTA','GENERADA','CERRADA','REVERSADA') NOT NULL DEFAULT 'ABIERTA'");
CALL _cx_add_column('RPJ_CAT_PARAMETRO_PLANILLA', 'ppl_fecha_generacion',
     'ppl_fecha_generacion DATETIME NULL');
CALL _cx_add_column('RPJ_CAT_PARAMETRO_PLANILLA', 'ppl_fecha_cierre',
     'ppl_fecha_cierre DATETIME NULL');
CALL _cx_add_column('RPJ_CAT_PARAMETRO_PLANILLA', 'ppl_usuario_genera',
     'ppl_usuario_genera VARCHAR(50) NULL');
CALL _cx_add_column('RPJ_CAT_PARAMETRO_PLANILLA', 'ppl_usuario_cierra',
     'ppl_usuario_cierra VARCHAR(50) NULL');

-- ============================================================================
-- BLOQUE 2 — Normalización de emp_estado (causa raíz "NO HAY DATOS PARA GENERAR")
-- ============================================================================
SELECT 'BLOQUE 2: normalizar emp_estado NULL/vacío -> ACTIVO' AS etapa;

SELECT COUNT(*) AS empleados_sin_estado
  FROM RPJ_MNT_EMPLEADO
 WHERE emp_estado IS NULL OR TRIM(emp_estado) = '';

UPDATE RPJ_MNT_EMPLEADO
   SET emp_estado = 'ACTIVO'
 WHERE emp_estado IS NULL OR TRIM(emp_estado) = '';

-- ============================================================================
-- BLOQUE 3 — Duplicados (ppl_tipo_planilla + ppl_numero) e índice único
-- ============================================================================
SELECT 'BLOQUE 3: duplicados de planilla tipo+numero (deberían ser 0 filas)' AS etapa;
SELECT ppl_tipo_planilla, ppl_numero, COUNT(*) AS total
  FROM RPJ_CAT_PARAMETRO_PLANILLA
 GROUP BY ppl_tipo_planilla, ppl_numero
HAVING COUNT(*) > 1;

SELECT COUNT(*) INTO @dup_ppl FROM (
  SELECT 1 FROM RPJ_CAT_PARAMETRO_PLANILLA
   GROUP BY ppl_tipo_planilla, ppl_numero
  HAVING COUNT(*) > 1
) z;

CALL _cx_add_unique_if_clean('RPJ_CAT_PARAMETRO_PLANILLA', 'uq_planilla_tipo_numero',
     'ppl_tipo_planilla, ppl_numero', @dup_ppl);

-- ============================================================================
-- BLOQUE 4 — VERIFICACIÓN
-- ============================================================================
SELECT 'BLOQUE 4: verificación' AS etapa;
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'RPJ_CAT_PARAMETRO_PLANILLA'
   AND COLUMN_NAME IN ('ppl_estado_proceso','ppl_fecha_generacion','ppl_fecha_cierre',
                       'ppl_usuario_genera','ppl_usuario_cierra')
 ORDER BY COLUMN_NAME;

SELECT emp_tipo_manejo, emp_estado, COUNT(*) AS total
  FROM RPJ_MNT_EMPLEADO
 GROUP BY emp_tipo_manejo, emp_estado;

-- ============================================================================
-- BLOQUE 5 — LIMPIEZA
-- ============================================================================
DROP PROCEDURE IF EXISTS _cx_add_column;
DROP PROCEDURE IF EXISTS _cx_add_unique_if_clean;

SET FOREIGN_KEY_CHECKS = @OLD_FK;

SELECT 'MIGRACIÓN CAMBIO X COMPLETADA. Revisar BLOQUES 3 y 4.' AS estado;
-- ============================================================================
-- FIN
-- ============================================================================
