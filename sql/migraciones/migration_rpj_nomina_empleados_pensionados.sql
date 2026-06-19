-- ============================================================================
-- MIGRACIÓN: NORMALIZACIÓN EMPLEADO / JUBILADO EN NÓMINA
-- Base de datos : apps_rpjepq
-- Motor destino : MySQL 8.0.x   (probada también en MariaDB 10.4)
-- Alcance       : Fases 3 y 4 — separar identificadores de empleado y
--                 jubilado en las tablas que hoy comparten una sola columna,
--                 y CORREGIR los foreign keys dobles (mismo campo apuntando a
--                 RPJ_MNT_EMPLEADO y RPJ_MNT_JUBILADO a la vez).
-- Idempotente    : puede ejecutarse más de una vez sin error.
-- NO destructiva : sin DROP TABLE, sin TRUNCATE, sin DELETE de datos.
--                  (Sí elimina constraints FK incorrectos: no borra datos.)
-- ============================================================================
--
-- >>> ANTES DE EJECUTAR EN PRODUCCIÓN: TOMAR RESPALDO <<<
--   mysqldump -h 143.198.182.147 -u <usuario> -p \
--     --single-transaction --routines --triggers --events \
--     apps_rpjepq > backup_apps_rpjepq_pre_migracion.sql
--
-- PROBLEMA QUE CORRIGE (verificado en la BD real):
--   RPJ_MNT_DATOS_PLANILLA.dat_id_empleado  -> FK a EMPLEADO  (ibfk_2)  [correcto]
--   RPJ_MNT_DATOS_PLANILLA.dat_id_empleado  -> FK a JUBILADO  (ibfk_3)  [INCORRECTO]
--   (igual en DESC_JUDICIALES y PRESTAMOS_REGIMEN)
--
-- SOLUCIÓN:
--   + columnas dat_id_jubilado / dju_id_jubilado / prr_id_jubilado
--   - se elimina el FK incorrecto del campo *_id_empleado hacia JUBILADO
--   + FK del nuevo campo *_id_jubilado hacia RPJ_MNT_JUBILADO
--   * los FK correctos (empleado, banco, tipo_manejo) se conservan intactos
--
-- DEPENDENCIA (importante): tras esta migración, el SP de pensionados, las
--   vistas v_*_pensionados y las consultas backend que leen jubilados desde
--   *_id_empleado DEBEN cambiar a *_id_jubilado. Se hace en la pasada siguiente.
-- ============================================================================


-- ============================================================================
-- BLOQUE 0 — HELPERS IDEMPOTENTES (information_schema + SQL dinámico)
--            MySQL 8 no soporta ADD COLUMN/INDEX IF NOT EXISTS.
-- ============================================================================
DELIMITER $$

DROP PROCEDURE IF EXISTS _rpj_add_column $$
CREATE PROCEDURE _rpj_add_column(IN p_table VARCHAR(64), IN p_column VARCHAR(64), IN p_ddl TEXT)
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=p_table AND COLUMN_NAME=p_column) THEN
    SET @ddl = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN ', p_ddl);
    PREPARE _st FROM @ddl; EXECUTE _st; DEALLOCATE PREPARE _st;
    SELECT CONCAT('[OK] columna agregada: ', p_table, '.', p_column) AS resultado;
  ELSE
    SELECT CONCAT('[SKIP] columna ya existe: ', p_table, '.', p_column) AS resultado;
  END IF;
END $$

DROP PROCEDURE IF EXISTS _rpj_add_index $$
CREATE PROCEDURE _rpj_add_index(IN p_table VARCHAR(64), IN p_index VARCHAR(64), IN p_cols TEXT)
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS
                 WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=p_table AND INDEX_NAME=p_index) THEN
    SET @ddl = CONCAT('CREATE INDEX `', p_index, '` ON `', p_table, '` (', p_cols, ')');
    PREPARE _st FROM @ddl; EXECUTE _st; DEALLOCATE PREPARE _st;
    SELECT CONCAT('[OK] índice creado: ', p_index, ' en ', p_table) AS resultado;
  ELSE
    SELECT CONCAT('[SKIP] índice ya existe: ', p_index) AS resultado;
  END IF;
END $$

-- Agrega FK sólo si no existe (por nombre). No aborta si los datos están
-- sucios: captura el error y lo reporta para corrección manual.
DROP PROCEDURE IF EXISTS _rpj_add_fk $$
CREATE PROCEDURE _rpj_add_fk(IN p_table VARCHAR(64), IN p_fk VARCHAR(64), IN p_ddl TEXT)
BEGIN
  DECLARE v_msg TEXT;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION
  BEGIN
    GET DIAGNOSTICS CONDITION 1 v_msg = MESSAGE_TEXT;
    SELECT CONCAT('[FK OMITIDO] ', p_fk, ' -> revisar datos: ', v_msg) AS resultado;
  END;
  IF NOT EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
                 WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME=p_table
                   AND CONSTRAINT_NAME=p_fk AND CONSTRAINT_TYPE='FOREIGN KEY') THEN
    SET @ddl = CONCAT('ALTER TABLE `', p_table, '` ADD CONSTRAINT `', p_fk, '` ', p_ddl);
    PREPARE _st FROM @ddl; EXECUTE _st; DEALLOCATE PREPARE _st;
    SELECT CONCAT('[OK] FK creado: ', p_fk) AS resultado;
  ELSE
    SELECT CONCAT('[SKIP] FK ya existe: ', p_fk) AS resultado;
  END IF;
END $$

-- Elimina el FK de (tabla.columna) que apunta a p_ref_table, sin importar su
-- nombre auto-generado (ibfk_N varía entre entornos). Idempotente.
DROP PROCEDURE IF EXISTS _rpj_drop_fk_by_ref $$
CREATE PROCEDURE _rpj_drop_fk_by_ref(IN p_table VARCHAR(64), IN p_column VARCHAR(64), IN p_ref_table VARCHAR(64))
BEGIN
  DECLARE v_fk VARCHAR(64) DEFAULT NULL;
  SELECT CONSTRAINT_NAME INTO v_fk
    FROM information_schema.KEY_COLUMN_USAGE
   WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME=p_table AND COLUMN_NAME=p_column
     AND UPPER(REFERENCED_TABLE_NAME)=UPPER(p_ref_table)
   LIMIT 1;
  IF v_fk IS NOT NULL THEN
    SET @ddl = CONCAT('ALTER TABLE `', p_table, '` DROP FOREIGN KEY `', v_fk, '`');
    PREPARE _st FROM @ddl; EXECUTE _st; DEALLOCATE PREPARE _st;
    SELECT CONCAT('[OK] FK incorrecto eliminado: ', v_fk, ' (', p_table, '.', p_column, ' -> ', p_ref_table, ')') AS resultado;
  ELSE
    SELECT CONCAT('[SKIP] no hay FK ', p_table, '.', p_column, ' -> ', p_ref_table) AS resultado;
  END IF;
END $$

DELIMITER ;


-- ============================================================================
-- BLOQUE 1 — VALIDACIONES PREVIAS (solo lectura)
-- ============================================================================
SELECT 'BLOQUE 1: FKs dobles existentes (el problema a corregir)' AS etapa;
SELECT TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME
  FROM information_schema.KEY_COLUMN_USAGE
 WHERE CONSTRAINT_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL
   AND TABLE_NAME IN ('RPJ_MNT_DATOS_PLANILLA','RPJ_MNT_DESC_JUDICIALES','RPJ_MNT_PRESTAMOS_REGIMEN')
 ORDER BY TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME;


-- ============================================================================
-- BLOQUE 2 — NUEVAS COLUMNAS *_id_jubilado (+ flags si faltan)
-- ============================================================================
SELECT 'BLOQUE 2: nuevas columnas' AS etapa;
CALL _rpj_add_column('RPJ_MNT_DATOS_PLANILLA',    'dat_id_jubilado', 'dat_id_jubilado INT NULL AFTER dat_id_empleado');
CALL _rpj_add_column('RPJ_MNT_DESC_JUDICIALES',   'dju_id_jubilado', 'dju_id_jubilado INT NULL AFTER dju_id_empleado');
CALL _rpj_add_column('RPJ_MNT_PRESTAMOS_REGIMEN', 'prr_id_jubilado', 'prr_id_jubilado INT NULL AFTER prr_id_empleado');
-- (dat_aplica_intecap / dat_aplica_dasociacion ya existen en prod: se omiten solas)
CALL _rpj_add_column('RPJ_MNT_DATOS_PLANILLA',    'dat_aplica_intecap',     'dat_aplica_intecap TINYINT(1) NOT NULL DEFAULT 0');
CALL _rpj_add_column('RPJ_MNT_DATOS_PLANILLA',    'dat_aplica_dasociacion', 'dat_aplica_dasociacion TINYINT(1) NOT NULL DEFAULT 0');


-- ============================================================================
-- BLOQUE 3 — HACER *_id_empleado NULLABLE
--   En prod son NOT NULL; para jubilados deben quedar NULL.
-- ============================================================================
SELECT 'BLOQUE 3: *_id_empleado -> NULLABLE' AS etapa;
ALTER TABLE RPJ_MNT_DATOS_PLANILLA    MODIFY COLUMN dat_id_empleado INT NULL;
ALTER TABLE RPJ_MNT_DESC_JUDICIALES   MODIFY COLUMN dju_id_empleado INT NULL;
ALTER TABLE RPJ_MNT_PRESTAMOS_REGIMEN MODIFY COLUMN prr_id_empleado INT NULL;


-- ============================================================================
-- BLOQUE 4 — AMPLIAR RPJ_LOG_REVERSOS (soportar reversos de empleado)
-- ============================================================================
SELECT 'BLOQUE 4: RPJ_LOG_REVERSOS' AS etapa;
CALL _rpj_add_column('RPJ_LOG_REVERSOS', 'lre_id_empleado',  'lre_id_empleado INT NULL AFTER lre_id_planilla');
CALL _rpj_add_column('RPJ_LOG_REVERSOS', 'lre_tipo_manejo',  'lre_tipo_manejo INT NULL AFTER lre_id_jubilado');
CALL _rpj_add_column('RPJ_LOG_REVERSOS', 'lre_tipo_reverso', "lre_tipo_reverso ENUM('INDIVIDUAL','TOTAL') NULL AFTER lre_tipo_manejo");


-- ============================================================================
-- BLOQUE 5 — MIGRACIÓN DE DATOS (mover IDs de jubilado a su columna propia)
--   Idempotente. Hoy las tablas están vacías -> no-op, pero queda lista para
--   cualquier dato futuro o entornos con datos.
-- ============================================================================
SELECT 'BLOQUE 5: migración de datos' AS etapa;

UPDATE RPJ_MNT_DATOS_PLANILLA  SET dat_id_jubilado = dat_id_empleado
 WHERE dat_tipo_manejo=2 AND dat_id_jubilado IS NULL AND dat_id_empleado IS NOT NULL;
UPDATE RPJ_MNT_DATOS_PLANILLA  SET dat_id_empleado = NULL
 WHERE dat_tipo_manejo=2 AND dat_id_jubilado IS NOT NULL AND dat_id_empleado IS NOT NULL;

UPDATE RPJ_MNT_DESC_JUDICIALES SET dju_id_jubilado = dju_id_empleado
 WHERE dju_tipo_manejo=2 AND dju_id_jubilado IS NULL AND dju_id_empleado IS NOT NULL;
UPDATE RPJ_MNT_DESC_JUDICIALES SET dju_id_empleado = NULL
 WHERE dju_tipo_manejo=2 AND dju_id_jubilado IS NOT NULL AND dju_id_empleado IS NOT NULL;

UPDATE RPJ_MNT_PRESTAMOS_REGIMEN SET prr_id_jubilado = prr_id_empleado
 WHERE prr_tipo_manejo=2 AND prr_id_jubilado IS NULL AND prr_id_empleado IS NOT NULL;
UPDATE RPJ_MNT_PRESTAMOS_REGIMEN SET prr_id_empleado = NULL
 WHERE prr_tipo_manejo=2 AND prr_id_jubilado IS NOT NULL AND prr_id_empleado IS NOT NULL;

-- LOG_REVERSOS: backfill de metadatos
UPDATE RPJ_LOG_REVERSOS SET lre_tipo_manejo=2          WHERE lre_tipo_manejo IS NULL  AND lre_id_jubilado IS NOT NULL;
UPDATE RPJ_LOG_REVERSOS SET lre_tipo_reverso='INDIVIDUAL' WHERE lre_tipo_reverso IS NULL AND lre_id_jubilado IS NOT NULL;
UPDATE RPJ_LOG_REVERSOS SET lre_tipo_reverso='TOTAL'      WHERE lre_tipo_reverso IS NULL AND lre_id_jubilado IS NULL;


-- ============================================================================
-- BLOQUE 6 — ELIMINAR LOS FK INCORRECTOS (campo empleado -> jubilado)
-- ============================================================================
SELECT 'BLOQUE 6: eliminar FK dobles incorrectos' AS etapa;
CALL _rpj_drop_fk_by_ref('RPJ_MNT_DATOS_PLANILLA',    'dat_id_empleado', 'RPJ_MNT_JUBILADO');
CALL _rpj_drop_fk_by_ref('RPJ_MNT_DESC_JUDICIALES',   'dju_id_empleado', 'RPJ_MNT_JUBILADO');
CALL _rpj_drop_fk_by_ref('RPJ_MNT_PRESTAMOS_REGIMEN', 'prr_id_empleado', 'RPJ_MNT_JUBILADO');


-- ============================================================================
-- BLOQUE 7 — ÍNDICES NUEVOS (los de *_id_empleado/banco/tipo_manejo ya existen)
-- ============================================================================
SELECT 'BLOQUE 7: índices nuevos' AS etapa;
CALL _rpj_add_index('RPJ_MNT_DATOS_PLANILLA',    'idx_dat_jubilado', 'dat_id_jubilado');
CALL _rpj_add_index('RPJ_MNT_DESC_JUDICIALES',   'idx_dju_jubilado', 'dju_id_jubilado');
CALL _rpj_add_index('RPJ_MNT_DESC_JUDICIALES',   'idx_dju_estado',   'dju_estado');
CALL _rpj_add_index('RPJ_MNT_PRESTAMOS_REGIMEN', 'idx_prr_jubilado', 'prr_id_jubilado');
CALL _rpj_add_index('RPJ_MNT_PRESTAMOS_REGIMEN', 'idx_prr_estado',   'prr_estado');
CALL _rpj_add_index('RPJ_LOG_REVERSOS',          'idx_lre_empleado', 'lre_id_empleado');
CALL _rpj_add_index('RPJ_LOG_REVERSOS',          'idx_lre_jubilado', 'lre_id_jubilado');


-- ============================================================================
-- BLOQUE 8 — FK NUEVOS sobre *_id_jubilado (no fatales)
-- ============================================================================
SELECT 'BLOQUE 8: FK nuevos hacia JUBILADO' AS etapa;
CALL _rpj_add_fk('RPJ_MNT_DATOS_PLANILLA',    'fk_dat_jubilado', 'FOREIGN KEY (dat_id_jubilado) REFERENCES RPJ_MNT_JUBILADO (jub_correlativo)');
CALL _rpj_add_fk('RPJ_MNT_DESC_JUDICIALES',   'fk_dju_jubilado', 'FOREIGN KEY (dju_id_jubilado) REFERENCES RPJ_MNT_JUBILADO (jub_correlativo)');
CALL _rpj_add_fk('RPJ_MNT_PRESTAMOS_REGIMEN', 'fk_prr_jubilado', 'FOREIGN KEY (prr_id_jubilado) REFERENCES RPJ_MNT_JUBILADO (jub_correlativo)');
CALL _rpj_add_fk('RPJ_LOG_REVERSOS',          'fk_lre_empleado', 'FOREIGN KEY (lre_id_empleado) REFERENCES RPJ_MNT_EMPLEADO (emp_correlativo)');
CALL _rpj_add_fk('RPJ_LOG_REVERSOS',          'fk_lre_jubilado', 'FOREIGN KEY (lre_id_jubilado) REFERENCES RPJ_MNT_JUBILADO (jub_correlativo)');


-- ============================================================================
-- BLOQUE 9 — VERIFICACIONES FINALES
-- ============================================================================
SELECT 'BLOQUE 9: verificación' AS etapa;

-- 9.1 Estado final de FKs (cada campo debe apuntar a UNA sola tabla)
SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, CONSTRAINT_NAME
  FROM information_schema.KEY_COLUMN_USAGE
 WHERE CONSTRAINT_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL
   AND TABLE_NAME IN ('RPJ_MNT_DATOS_PLANILLA','RPJ_MNT_DESC_JUDICIALES','RPJ_MNT_PRESTAMOS_REGIMEN','RPJ_LOG_REVERSOS')
 ORDER BY TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME;

-- 9.2 No deben quedar filas con ambos IDs poblados
SELECT 'datos_planilla mezclados (=0)' AS chequeo, COUNT(*) AS filas
  FROM RPJ_MNT_DATOS_PLANILLA WHERE dat_id_empleado IS NOT NULL AND dat_id_jubilado IS NOT NULL
UNION ALL SELECT 'judiciales mezclados (=0)', COUNT(*)
  FROM RPJ_MNT_DESC_JUDICIALES WHERE dju_id_empleado IS NOT NULL AND dju_id_jubilado IS NOT NULL
UNION ALL SELECT 'prestamos mezclados (=0)', COUNT(*)
  FROM RPJ_MNT_PRESTAMOS_REGIMEN WHERE prr_id_empleado IS NOT NULL AND prr_id_jubilado IS NOT NULL;

-- 9.3 Nuevas columnas presentes
SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA=DATABASE()
   AND COLUMN_NAME IN ('dat_id_jubilado','dju_id_jubilado','prr_id_jubilado',
                       'lre_id_empleado','lre_tipo_manejo','lre_tipo_reverso')
 ORDER BY TABLE_NAME, COLUMN_NAME;


-- ============================================================================
-- BLOQUE 10 — LIMPIEZA DE HELPERS
-- ============================================================================
DROP PROCEDURE IF EXISTS _rpj_add_column;
DROP PROCEDURE IF EXISTS _rpj_add_index;
DROP PROCEDURE IF EXISTS _rpj_add_fk;
DROP PROCEDURE IF EXISTS _rpj_drop_fk_by_ref;

SELECT 'MIGRACIÓN COMPLETADA. Revisar BLOQUE 9 (verificación).' AS estado;

-- ============================================================================
-- FIN — No se elimina ninguna columna ni dato. Los campos *_id_empleado se
-- conservan (FK correcto a EMPLEADO para tipo_manejo=1). El DROP de columnas
-- viejas NO aplica: el modelo final usa *_id_empleado y *_id_jubilado en paralelo.
-- ============================================================================
