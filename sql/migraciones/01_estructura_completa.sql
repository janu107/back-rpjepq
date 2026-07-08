-- ============================================================================
-- MÓDULO: Jubilados, Beneficiarios y Control de Deuda
-- FASE 1 — Estructura de datos (01_estructura_completa.sql)
-- Base de datos : apps_rpjepq
-- Motor         : MySQL 8 / MariaDB (portable, SIN "ADD COLUMN IF NOT EXISTS")
-- Idempotente   : puede ejecutarse más de una vez sin error.
-- NO destructiva: no hay DROP TABLE / TRUNCATE / DELETE de datos.
--
-- DECISIÓN DE DISEÑO (acordada): "REUTILIZAR Y EXTENDER".
--   El sistema YA tiene el libro mayor de deuda de jubilados en la tabla
--   RPJ_PRC_DEUDA_JUBILADO (módulo de pensionados). En lugar de crear una
--   segunda tabla RPJ_MNT_DEUDA en paralelo, se EXTIENDE la existente con las
--   columnas que le faltan para soportar beneficiarios, amparistas e historia:
--        deu_es_deuda      -> 0 = historia (pagado 100%), 1 = deuda real
--        deu_tipo_pago     -> NORMAL / AMPARISTA / BENEFICIARIO
--        deu_id_beneficiario -> deuda que pertenece a un beneficiario (NULL = del jubilado)
--   Mapeo de conceptos del spec sobre las columnas ya existentes:
--        deu_pension_completa  == deu_monto_original   (pensión mensual completa)
--        deu_saldo             == deu_monto_pendiente   (saldo por pagar)
--        deu_monto_pagado      == deu_monto_pagado
--   El ENUM de estado se mantiene como ('PENDIENTE','PARCIAL','PAGADA') para NO
--   romper los SP de pensionados que ya usan 'PAGADA'.
--
-- CONVENCIÓN DE ESTILO: las columnas de auditoría de las tablas nuevas usan el
--   prefijo de la tabla (xxx_usuario_creacion / xxx_fecha_creacion), igual que
--   TODAS las tablas del sistema, en vez de usuario_transaccion/fecha_transaccion.
--
-- ORDEN: se crean primero las tablas nuevas (para que existan antes de que otras
--   tablas las referencien por FK) y luego se aplican los ALTER.
-- ============================================================================

CREATE DATABASE IF NOT EXISTS `apps_rpjepq`
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `apps_rpjepq`;

SET @OLD_FK := @@FOREIGN_KEY_CHECKS;
SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================================
-- BLOQUE 0 — HELPERS idempotentes (silenciosos)
--   _jbc_add_column: agrega una columna solo si la tabla existe y la columna no.
--   _jbc_add_fk    : agrega una constraint (FK) solo si la tabla existe y la
--                    constraint no; tolerante a errores (p.ej. tabla ausente).
-- ============================================================================
DELIMITER $$

DROP PROCEDURE IF EXISTS _jbc_add_column $$
CREATE PROCEDURE _jbc_add_column(IN p_table VARCHAR(64), IN p_column VARCHAR(64), IN p_ddl TEXT)
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.TABLES
               WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table)
     AND NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
               WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND COLUMN_NAME = p_column) THEN
    SET @s = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN ', p_ddl);
    PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
  END IF;
END $$

DROP PROCEDURE IF EXISTS _jbc_add_fk $$
CREATE PROCEDURE _jbc_add_fk(IN p_table VARCHAR(64), IN p_constraint VARCHAR(64), IN p_ddl TEXT)
BEGIN
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION BEGIN END; -- tolerante: no aborta el script
  IF EXISTS (SELECT 1 FROM information_schema.TABLES
               WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table)
     AND NOT EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
               WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND CONSTRAINT_NAME = p_constraint) THEN
    SET @s = CONCAT('ALTER TABLE `', p_table, '` ADD CONSTRAINT `', p_constraint, '` ', p_ddl);
    PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
  END IF;
END $$

DELIMITER ;

-- ============================================================================
-- BLOQUE 1 — TABLAS NUEVAS
-- ============================================================================
SELECT 'BLOQUE 1: creando tablas nuevas' AS etapa;

-- 1.1 BENEFICIARIO ----------------------------------------------------------
--   Beneficiarios de un jubilado (cobran cuando el jubilado fallece, según %).
--   DPI único POR jubilado. % entre 0.01 y 100 (CHECK).
CREATE TABLE IF NOT EXISTS RPJ_MNT_BENEFICIARIO (
    ben_correlativo         INT AUTO_INCREMENT PRIMARY KEY,
    ben_id_jubilado         INT NOT NULL,
    ben_tipo_parentesco     ENUM('ESPOSA','HIJO','HIJO_INVALIDEZ') NOT NULL,
    ben_nombres             VARCHAR(100) NULL,
    ben_apellidos           VARCHAR(100) NOT NULL,
    ben_dpi                 VARCHAR(13)  NOT NULL,
    ben_fecha_nacimiento    DATE NOT NULL,
    ben_porcentaje          DECIMAL(5,2) NOT NULL,
    ben_telefono            VARCHAR(20)  NULL,
    ben_correo              VARCHAR(100) NULL,
    ben_estado              ENUM('REGISTRADO','ACTIVO','SUSPENDIDO','INACTIVO') NOT NULL DEFAULT 'REGISTRADO',
    ben_empleador_estatal   VARCHAR(150) NULL,
    ben_fecha_inicio_empleo DATE NULL,
    ben_usuario_creacion    VARCHAR(50) NOT NULL,
    ben_fecha_creacion      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_ben_jubilado   FOREIGN KEY (ben_id_jubilado) REFERENCES RPJ_MNT_JUBILADO(jub_correlativo),
    CONSTRAINT uq_ben_jub_dpi    UNIQUE (ben_id_jubilado, ben_dpi),
    CONSTRAINT chk_ben_porcentaje CHECK (ben_porcentaje > 0 AND ben_porcentaje <= 100),
    KEY idx_ben_estado (ben_estado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 1.2 TUTOR -----------------------------------------------------------------
--   Tutora/tutor de un beneficiario menor de edad. Se borra en cascada si se
--   elimina el beneficiario (es un dato subordinado).
CREATE TABLE IF NOT EXISTS RPJ_MNT_TUTOR (
    tut_correlativo      INT AUTO_INCREMENT PRIMARY KEY,
    tut_id_beneficiario  INT NOT NULL,
    tut_nombres          VARCHAR(100) NULL,
    tut_apellidos        VARCHAR(100) NOT NULL,
    tut_dpi              VARCHAR(13)  NOT NULL,
    tut_parentesco       VARCHAR(50)  NULL,
    tut_telefono         VARCHAR(20)  NULL,
    tut_usuario_creacion VARCHAR(50) NOT NULL,
    tut_fecha_creacion   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_tut_beneficiario FOREIGN KEY (tut_id_beneficiario)
        REFERENCES RPJ_MNT_BENEFICIARIO(ben_correlativo) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 1.3 JUICIO ----------------------------------------------------------------
--   Amparo/juicio ganado por un jubilado (pasa a AMPARISTA, cobra 100%).
CREATE TABLE IF NOT EXISTS RPJ_MNT_JUICIO (
    jui_correlativo      INT AUTO_INCREMENT PRIMARY KEY,
    jui_id_jubilado      INT NOT NULL,
    jui_no_expediente    VARCHAR(50)  NOT NULL,
    jui_juzgado          VARCHAR(150) NOT NULL,
    jui_fecha_sentencia  DATE NOT NULL,
    jui_fecha_efectiva   DATE NOT NULL,
    jui_abogado          VARCHAR(150) NULL,
    jui_observaciones    TEXT NULL,
    jui_estado           ENUM('VIGENTE','REVOCADO') NOT NULL DEFAULT 'VIGENTE',
    jui_usuario_creacion VARCHAR(50) NOT NULL,
    jui_fecha_creacion   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_jui_jubilado   FOREIGN KEY (jui_id_jubilado) REFERENCES RPJ_MNT_JUBILADO(jub_correlativo),
    CONSTRAINT uq_jui_expediente UNIQUE (jui_no_expediente),
    KEY idx_jui_estado (jui_estado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 1.4 CONVENIO_PAGO ---------------------------------------------------------
--   Convenio de pago de deuda. Debe pertenecer a un jubilado O a un
--   beneficiario (al menos uno, CHECK).
CREATE TABLE IF NOT EXISTS RPJ_MNT_CONVENIO_PAGO (
    con_correlativo      INT AUTO_INCREMENT PRIMARY KEY,
    con_id_jubilado      INT NULL,
    con_id_beneficiario  INT NULL,
    con_tipo             ENUM('MENSUAL','QUINCENAL','UNICO','CUOTAS_GRANDES') NOT NULL,
    con_deuda_total      DECIMAL(12,2) NULL,
    con_cantidad_cuotas  INT NULL,
    con_monto_cuota      DECIMAL(12,2) NULL,
    con_fecha_inicio     DATE NULL,
    con_fecha_fin        DATE NULL,
    con_autorizado_por   ENUM('JUEZ','JUNTA_DIRECTIVA','ACUERDO_INTERNO') NULL,
    con_no_documento     VARCHAR(50) NOT NULL,
    con_estado           ENUM('VIGENTE','FINALIZADO','CANCELADO') NOT NULL DEFAULT 'VIGENTE',
    con_usuario_creacion VARCHAR(50) NOT NULL,
    con_fecha_creacion   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_con_jubilado     FOREIGN KEY (con_id_jubilado)     REFERENCES RPJ_MNT_JUBILADO(jub_correlativo),
    CONSTRAINT fk_con_beneficiario FOREIGN KEY (con_id_beneficiario) REFERENCES RPJ_MNT_BENEFICIARIO(ben_correlativo),
    CONSTRAINT chk_con_titular     CHECK (con_id_jubilado IS NOT NULL OR con_id_beneficiario IS NOT NULL),
    KEY idx_con_estado (con_estado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- BLOQUE 2 — ALTERs a tablas existentes (vía helper idempotente)
-- ============================================================================
SELECT 'BLOQUE 2: columnas nuevas en tablas existentes' AS etapa;

-- 2.1 RPJ_MNT_JUBILADO ------------------------------------------------------
CALL _jbc_add_column('RPJ_MNT_JUBILADO', 'jub_tipo_pago',
     "jub_tipo_pago ENUM('NORMAL','AMPARISTA') NOT NULL DEFAULT 'NORMAL' AFTER jub_tipo_jubilacion");
CALL _jbc_add_column('RPJ_MNT_JUBILADO', 'jub_estado_pago',
     "jub_estado_pago ENUM('ACTIVO','FALLECIDO','SUSPENDIDO') NOT NULL DEFAULT 'ACTIVO' AFTER jub_tipo_pago");
CALL _jbc_add_column('RPJ_MNT_JUBILADO', 'jub_fecha_fallecimiento',
     "jub_fecha_fallecimiento DATE NULL AFTER jub_estado_pago");
CALL _jbc_add_column('RPJ_MNT_JUBILADO', 'jub_no_defuncion',
     "jub_no_defuncion VARCHAR(50) NULL AFTER jub_fecha_fallecimiento");

-- 2.2 RPJ_MNT_DATOS_PLANILLA ------------------------------------------------
CALL _jbc_add_column('RPJ_MNT_DATOS_PLANILLA', 'dat_id_beneficiario',
     "dat_id_beneficiario INT NULL AFTER dat_id_jubilado");
CALL _jbc_add_fk('RPJ_MNT_DATOS_PLANILLA', 'fk_dat_beneficiario',
     "FOREIGN KEY (dat_id_beneficiario) REFERENCES RPJ_MNT_BENEFICIARIO(ben_correlativo)");

-- 2.3 RPJ_PRC_DEUDA_JUBILADO (libro mayor existente — se EXTIENDE) ----------
CALL _jbc_add_column('RPJ_PRC_DEUDA_JUBILADO', 'deu_es_deuda',
     "deu_es_deuda TINYINT(1) NOT NULL DEFAULT 1 AFTER deu_estado"); -- 0=historia, 1=deuda
CALL _jbc_add_column('RPJ_PRC_DEUDA_JUBILADO', 'deu_tipo_pago',
     "deu_tipo_pago ENUM('NORMAL','AMPARISTA','BENEFICIARIO') NOT NULL DEFAULT 'NORMAL' AFTER deu_es_deuda");
CALL _jbc_add_column('RPJ_PRC_DEUDA_JUBILADO', 'deu_id_beneficiario',
     "deu_id_beneficiario INT NULL AFTER deu_id_jubilado");
CALL _jbc_add_fk('RPJ_PRC_DEUDA_JUBILADO', 'fk_deu_beneficiario',
     "FOREIGN KEY (deu_id_beneficiario) REFERENCES RPJ_MNT_BENEFICIARIO(ben_correlativo)");

-- 2.4 RPJ_PRC_NOMINA_INGRESO / RPJ_PRC_NOMINA_DESCUENTO ---------------------
--   Para poder registrar (y reversar) el pago de un beneficiario en la nómina.
CALL _jbc_add_column('RPJ_PRC_NOMINA_INGRESO', 'nin_id_beneficiario',
     "nin_id_beneficiario INT NULL AFTER nin_id_jubilado");
CALL _jbc_add_fk('RPJ_PRC_NOMINA_INGRESO', 'fk_nin_beneficiario',
     "FOREIGN KEY (nin_id_beneficiario) REFERENCES RPJ_MNT_BENEFICIARIO(ben_correlativo)");
CALL _jbc_add_column('RPJ_PRC_NOMINA_DESCUENTO', 'nde_id_beneficiario',
     "nde_id_beneficiario INT NULL AFTER nde_id_jubilado");
CALL _jbc_add_fk('RPJ_PRC_NOMINA_DESCUENTO', 'fk_nde_beneficiario',
     "FOREIGN KEY (nde_id_beneficiario) REFERENCES RPJ_MNT_BENEFICIARIO(ben_correlativo)");

-- ============================================================================
-- BLOQUE 3 — VERIFICACIÓN
-- ============================================================================
SELECT 'BLOQUE 3: verificación' AS etapa;

-- 3.1 Tablas nuevas creadas
SELECT TABLE_NAME
  FROM information_schema.TABLES
 WHERE TABLE_SCHEMA = DATABASE()
   AND TABLE_NAME IN ('RPJ_MNT_BENEFICIARIO','RPJ_MNT_TUTOR','RPJ_MNT_JUICIO','RPJ_MNT_CONVENIO_PAGO')
 ORDER BY TABLE_NAME;

-- 3.2 Columnas nuevas en tablas existentes
SELECT TABLE_NAME, COLUMN_NAME
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE()
   AND ((TABLE_NAME='RPJ_MNT_JUBILADO'       AND COLUMN_NAME IN ('jub_tipo_pago','jub_estado_pago','jub_fecha_fallecimiento','jub_no_defuncion'))
     OR (TABLE_NAME='RPJ_MNT_DATOS_PLANILLA' AND COLUMN_NAME = 'dat_id_beneficiario')
     OR (TABLE_NAME='RPJ_PRC_DEUDA_JUBILADO'   AND COLUMN_NAME IN ('deu_es_deuda','deu_tipo_pago','deu_id_beneficiario'))
     OR (TABLE_NAME='RPJ_PRC_NOMINA_INGRESO'   AND COLUMN_NAME = 'nin_id_beneficiario')
     OR (TABLE_NAME='RPJ_PRC_NOMINA_DESCUENTO' AND COLUMN_NAME = 'nde_id_beneficiario'))
 ORDER BY TABLE_NAME, COLUMN_NAME;

-- 3.3 Constraints (FK) agregadas
SELECT TABLE_NAME, CONSTRAINT_NAME
  FROM information_schema.TABLE_CONSTRAINTS
 WHERE TABLE_SCHEMA = DATABASE()
   AND CONSTRAINT_NAME IN ('fk_dat_beneficiario','fk_deu_beneficiario','fk_nin_beneficiario','fk_nde_beneficiario')
 ORDER BY TABLE_NAME, CONSTRAINT_NAME;

-- ============================================================================
-- BLOQUE 4 — LIMPIEZA
-- ============================================================================
DROP PROCEDURE IF EXISTS _jbc_add_column;
DROP PROCEDURE IF EXISTS _jbc_add_fk;

SET FOREIGN_KEY_CHECKS = @OLD_FK;

SELECT 'FASE 1 COMPLETADA. Revisar BLOQUE 3: deben aparecer 4 tablas nuevas, 10 columnas nuevas y 4 FKs.' AS estado;
-- ============================================================================
-- FIN FASE 1
-- ============================================================================
