-- ============================================================================
-- MÓDULO: Jubilados, Beneficiarios y Control de Deuda
-- FASE 2 — Bitácoras + triggers (02_bitacoras_completas.sql)
-- Base de datos : apps_rpjepq
-- Motor         : MariaDB 10.4 / MySQL 8 (portable)
-- Idempotente   : CREATE TABLE IF NOT EXISTS + DROP TRIGGER IF EXISTS.
-- NO destructiva.
--
-- PATRÓN COPIADO DE LAS BITÁCORAS EXISTENTES DEL SISTEMA (p.ej. b_RPJ_MNT_JUBILADO):
--   * Tabla espejo  b_<TABLA>  con:
--       - bit_correlativo INT AUTO_INCREMENT PRIMARY KEY   (primera columna)
--       - TODAS las columnas de la tabla base (mismos nombres, todas NULL)
--       - usuario_transaccion VARCHAR(50)     -> se llena con USER()
--       - fecha_transaccion   TIMESTAMP NULL  -> se llena con NOW()
--       - tipo_movimiento     VARCHAR(10)     -> 'INSERT' | 'UPDATE' | 'DELETE'
--   * 3 triggers por tabla: tr_<TABLA>_INSERT / _UPDATE / _DELETE, AFTER.
--       - INSERT y UPDATE copian los valores NEW.*  (igual que el sistema actual)
--       - DELETE copia los valores OLD.*
--   NOTA: se respeta la convención existente (NEW en UPDATE, no OLD) para ser
--   consistente con el resto de bitácoras del sistema RPJ.
--
-- Alcance: solo las 4 tablas NUEVAS de mantenimiento (RPJ_MNT_*). Las tablas de
-- proceso RPJ_PRC_* (deuda/aplicación de pago) NO llevan bitácora, igual que en
-- el resto del sistema (no existen tablas b_RPJ_PRC_*).
-- ============================================================================

USE `apps_rpjepq`;

-- ============================================================================
-- BLOQUE 1 — TABLAS ESPEJO b_<TABLA>
-- ============================================================================
SELECT 'BLOQUE 1: tablas espejo de bitacora' AS etapa;

-- 1.1 b_RPJ_MNT_BENEFICIARIO -------------------------------------------------
CREATE TABLE IF NOT EXISTS b_RPJ_MNT_BENEFICIARIO (
    bit_correlativo         INT AUTO_INCREMENT PRIMARY KEY,
    ben_correlativo         INT NULL,
    ben_id_jubilado         INT NULL,
    ben_tipo_parentesco     VARCHAR(20)  NULL,
    ben_nombres             VARCHAR(100) NULL,
    ben_apellidos           VARCHAR(100) NULL,
    ben_dpi                 VARCHAR(13)  NULL,
    ben_fecha_nacimiento    DATE NULL,
    ben_porcentaje          DECIMAL(5,2) NULL,
    ben_telefono            VARCHAR(20)  NULL,
    ben_correo              VARCHAR(100) NULL,
    ben_estado              VARCHAR(15)  NULL,
    ben_empleador_estatal   VARCHAR(150) NULL,
    ben_fecha_inicio_empleo DATE NULL,
    ben_usuario_creacion    VARCHAR(50)  NULL,
    ben_fecha_creacion      TIMESTAMP NULL DEFAULT NULL,
    usuario_transaccion     VARCHAR(50)  NULL,
    fecha_transaccion       TIMESTAMP NULL DEFAULT NULL,
    tipo_movimiento         VARCHAR(10)  NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 1.2 b_RPJ_MNT_TUTOR --------------------------------------------------------
CREATE TABLE IF NOT EXISTS b_RPJ_MNT_TUTOR (
    bit_correlativo      INT AUTO_INCREMENT PRIMARY KEY,
    tut_correlativo      INT NULL,
    tut_id_beneficiario  INT NULL,
    tut_nombres          VARCHAR(100) NULL,
    tut_apellidos        VARCHAR(100) NULL,
    tut_dpi              VARCHAR(13)  NULL,
    tut_parentesco       VARCHAR(50)  NULL,
    tut_telefono         VARCHAR(20)  NULL,
    tut_usuario_creacion VARCHAR(50)  NULL,
    tut_fecha_creacion   TIMESTAMP NULL DEFAULT NULL,
    usuario_transaccion  VARCHAR(50)  NULL,
    fecha_transaccion    TIMESTAMP NULL DEFAULT NULL,
    tipo_movimiento      VARCHAR(10)  NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 1.3 b_RPJ_MNT_JUICIO -------------------------------------------------------
CREATE TABLE IF NOT EXISTS b_RPJ_MNT_JUICIO (
    bit_correlativo      INT AUTO_INCREMENT PRIMARY KEY,
    jui_correlativo      INT NULL,
    jui_id_jubilado      INT NULL,
    jui_no_expediente    VARCHAR(50)  NULL,
    jui_juzgado          VARCHAR(150) NULL,
    jui_fecha_sentencia  DATE NULL,
    jui_fecha_efectiva   DATE NULL,
    jui_abogado          VARCHAR(150) NULL,
    jui_observaciones    TEXT NULL,
    jui_estado           VARCHAR(10)  NULL,
    jui_usuario_creacion VARCHAR(50)  NULL,
    jui_fecha_creacion   TIMESTAMP NULL DEFAULT NULL,
    usuario_transaccion  VARCHAR(50)  NULL,
    fecha_transaccion    TIMESTAMP NULL DEFAULT NULL,
    tipo_movimiento      VARCHAR(10)  NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 1.4 b_RPJ_MNT_CONVENIO_PAGO ------------------------------------------------
CREATE TABLE IF NOT EXISTS b_RPJ_MNT_CONVENIO_PAGO (
    bit_correlativo      INT AUTO_INCREMENT PRIMARY KEY,
    con_correlativo      INT NULL,
    con_id_jubilado      INT NULL,
    con_id_beneficiario  INT NULL,
    con_tipo             VARCHAR(20)  NULL,
    con_deuda_total      DECIMAL(12,2) NULL,
    con_cantidad_cuotas  INT NULL,
    con_monto_cuota      DECIMAL(12,2) NULL,
    con_fecha_inicio     DATE NULL,
    con_fecha_fin        DATE NULL,
    con_autorizado_por   VARCHAR(20)  NULL,
    con_no_documento     VARCHAR(50)  NULL,
    con_estado           VARCHAR(12)  NULL,
    con_usuario_creacion VARCHAR(50)  NULL,
    con_fecha_creacion   TIMESTAMP NULL DEFAULT NULL,
    usuario_transaccion  VARCHAR(50)  NULL,
    fecha_transaccion    TIMESTAMP NULL DEFAULT NULL,
    tipo_movimiento      VARCHAR(10)  NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- BLOQUE 2 — TRIGGERS (3 por tabla: INSERT / UPDATE / DELETE)
-- ============================================================================
SELECT 'BLOQUE 2: triggers de bitacora' AS etapa;

DELIMITER $$

-- ---------- RPJ_MNT_BENEFICIARIO -------------------------------------------
DROP TRIGGER IF EXISTS tr_RPJ_MNT_BENEFICIARIO_INSERT $$
CREATE TRIGGER tr_RPJ_MNT_BENEFICIARIO_INSERT AFTER INSERT ON RPJ_MNT_BENEFICIARIO
FOR EACH ROW
BEGIN
  INSERT INTO b_RPJ_MNT_BENEFICIARIO (
    ben_correlativo, ben_id_jubilado, ben_tipo_parentesco, ben_nombres, ben_apellidos,
    ben_dpi, ben_fecha_nacimiento, ben_porcentaje, ben_telefono, ben_correo,
    ben_estado, ben_empleador_estatal, ben_fecha_inicio_empleo, ben_usuario_creacion, ben_fecha_creacion,
    usuario_transaccion, fecha_transaccion, tipo_movimiento
  ) VALUES (
    NEW.ben_correlativo, NEW.ben_id_jubilado, NEW.ben_tipo_parentesco, NEW.ben_nombres, NEW.ben_apellidos,
    NEW.ben_dpi, NEW.ben_fecha_nacimiento, NEW.ben_porcentaje, NEW.ben_telefono, NEW.ben_correo,
    NEW.ben_estado, NEW.ben_empleador_estatal, NEW.ben_fecha_inicio_empleo, NEW.ben_usuario_creacion, NEW.ben_fecha_creacion,
    USER(), NOW(), 'INSERT'
  );
END $$

DROP TRIGGER IF EXISTS tr_RPJ_MNT_BENEFICIARIO_UPDATE $$
CREATE TRIGGER tr_RPJ_MNT_BENEFICIARIO_UPDATE AFTER UPDATE ON RPJ_MNT_BENEFICIARIO
FOR EACH ROW
BEGIN
  INSERT INTO b_RPJ_MNT_BENEFICIARIO (
    ben_correlativo, ben_id_jubilado, ben_tipo_parentesco, ben_nombres, ben_apellidos,
    ben_dpi, ben_fecha_nacimiento, ben_porcentaje, ben_telefono, ben_correo,
    ben_estado, ben_empleador_estatal, ben_fecha_inicio_empleo, ben_usuario_creacion, ben_fecha_creacion,
    usuario_transaccion, fecha_transaccion, tipo_movimiento
  ) VALUES (
    NEW.ben_correlativo, NEW.ben_id_jubilado, NEW.ben_tipo_parentesco, NEW.ben_nombres, NEW.ben_apellidos,
    NEW.ben_dpi, NEW.ben_fecha_nacimiento, NEW.ben_porcentaje, NEW.ben_telefono, NEW.ben_correo,
    NEW.ben_estado, NEW.ben_empleador_estatal, NEW.ben_fecha_inicio_empleo, NEW.ben_usuario_creacion, NEW.ben_fecha_creacion,
    USER(), NOW(), 'UPDATE'
  );
END $$

DROP TRIGGER IF EXISTS tr_RPJ_MNT_BENEFICIARIO_DELETE $$
CREATE TRIGGER tr_RPJ_MNT_BENEFICIARIO_DELETE AFTER DELETE ON RPJ_MNT_BENEFICIARIO
FOR EACH ROW
BEGIN
  INSERT INTO b_RPJ_MNT_BENEFICIARIO (
    ben_correlativo, ben_id_jubilado, ben_tipo_parentesco, ben_nombres, ben_apellidos,
    ben_dpi, ben_fecha_nacimiento, ben_porcentaje, ben_telefono, ben_correo,
    ben_estado, ben_empleador_estatal, ben_fecha_inicio_empleo, ben_usuario_creacion, ben_fecha_creacion,
    usuario_transaccion, fecha_transaccion, tipo_movimiento
  ) VALUES (
    OLD.ben_correlativo, OLD.ben_id_jubilado, OLD.ben_tipo_parentesco, OLD.ben_nombres, OLD.ben_apellidos,
    OLD.ben_dpi, OLD.ben_fecha_nacimiento, OLD.ben_porcentaje, OLD.ben_telefono, OLD.ben_correo,
    OLD.ben_estado, OLD.ben_empleador_estatal, OLD.ben_fecha_inicio_empleo, OLD.ben_usuario_creacion, OLD.ben_fecha_creacion,
    USER(), NOW(), 'DELETE'
  );
END $$

-- ---------- RPJ_MNT_TUTOR ---------------------------------------------------
DROP TRIGGER IF EXISTS tr_RPJ_MNT_TUTOR_INSERT $$
CREATE TRIGGER tr_RPJ_MNT_TUTOR_INSERT AFTER INSERT ON RPJ_MNT_TUTOR
FOR EACH ROW
BEGIN
  INSERT INTO b_RPJ_MNT_TUTOR (
    tut_correlativo, tut_id_beneficiario, tut_nombres, tut_apellidos, tut_dpi,
    tut_parentesco, tut_telefono, tut_usuario_creacion, tut_fecha_creacion,
    usuario_transaccion, fecha_transaccion, tipo_movimiento
  ) VALUES (
    NEW.tut_correlativo, NEW.tut_id_beneficiario, NEW.tut_nombres, NEW.tut_apellidos, NEW.tut_dpi,
    NEW.tut_parentesco, NEW.tut_telefono, NEW.tut_usuario_creacion, NEW.tut_fecha_creacion,
    USER(), NOW(), 'INSERT'
  );
END $$

DROP TRIGGER IF EXISTS tr_RPJ_MNT_TUTOR_UPDATE $$
CREATE TRIGGER tr_RPJ_MNT_TUTOR_UPDATE AFTER UPDATE ON RPJ_MNT_TUTOR
FOR EACH ROW
BEGIN
  INSERT INTO b_RPJ_MNT_TUTOR (
    tut_correlativo, tut_id_beneficiario, tut_nombres, tut_apellidos, tut_dpi,
    tut_parentesco, tut_telefono, tut_usuario_creacion, tut_fecha_creacion,
    usuario_transaccion, fecha_transaccion, tipo_movimiento
  ) VALUES (
    NEW.tut_correlativo, NEW.tut_id_beneficiario, NEW.tut_nombres, NEW.tut_apellidos, NEW.tut_dpi,
    NEW.tut_parentesco, NEW.tut_telefono, NEW.tut_usuario_creacion, NEW.tut_fecha_creacion,
    USER(), NOW(), 'UPDATE'
  );
END $$

DROP TRIGGER IF EXISTS tr_RPJ_MNT_TUTOR_DELETE $$
CREATE TRIGGER tr_RPJ_MNT_TUTOR_DELETE AFTER DELETE ON RPJ_MNT_TUTOR
FOR EACH ROW
BEGIN
  INSERT INTO b_RPJ_MNT_TUTOR (
    tut_correlativo, tut_id_beneficiario, tut_nombres, tut_apellidos, tut_dpi,
    tut_parentesco, tut_telefono, tut_usuario_creacion, tut_fecha_creacion,
    usuario_transaccion, fecha_transaccion, tipo_movimiento
  ) VALUES (
    OLD.tut_correlativo, OLD.tut_id_beneficiario, OLD.tut_nombres, OLD.tut_apellidos, OLD.tut_dpi,
    OLD.tut_parentesco, OLD.tut_telefono, OLD.tut_usuario_creacion, OLD.tut_fecha_creacion,
    USER(), NOW(), 'DELETE'
  );
END $$

-- ---------- RPJ_MNT_JUICIO --------------------------------------------------
DROP TRIGGER IF EXISTS tr_RPJ_MNT_JUICIO_INSERT $$
CREATE TRIGGER tr_RPJ_MNT_JUICIO_INSERT AFTER INSERT ON RPJ_MNT_JUICIO
FOR EACH ROW
BEGIN
  INSERT INTO b_RPJ_MNT_JUICIO (
    jui_correlativo, jui_id_jubilado, jui_no_expediente, jui_juzgado, jui_fecha_sentencia,
    jui_fecha_efectiva, jui_abogado, jui_observaciones, jui_estado, jui_usuario_creacion, jui_fecha_creacion,
    usuario_transaccion, fecha_transaccion, tipo_movimiento
  ) VALUES (
    NEW.jui_correlativo, NEW.jui_id_jubilado, NEW.jui_no_expediente, NEW.jui_juzgado, NEW.jui_fecha_sentencia,
    NEW.jui_fecha_efectiva, NEW.jui_abogado, NEW.jui_observaciones, NEW.jui_estado, NEW.jui_usuario_creacion, NEW.jui_fecha_creacion,
    USER(), NOW(), 'INSERT'
  );
END $$

DROP TRIGGER IF EXISTS tr_RPJ_MNT_JUICIO_UPDATE $$
CREATE TRIGGER tr_RPJ_MNT_JUICIO_UPDATE AFTER UPDATE ON RPJ_MNT_JUICIO
FOR EACH ROW
BEGIN
  INSERT INTO b_RPJ_MNT_JUICIO (
    jui_correlativo, jui_id_jubilado, jui_no_expediente, jui_juzgado, jui_fecha_sentencia,
    jui_fecha_efectiva, jui_abogado, jui_observaciones, jui_estado, jui_usuario_creacion, jui_fecha_creacion,
    usuario_transaccion, fecha_transaccion, tipo_movimiento
  ) VALUES (
    NEW.jui_correlativo, NEW.jui_id_jubilado, NEW.jui_no_expediente, NEW.jui_juzgado, NEW.jui_fecha_sentencia,
    NEW.jui_fecha_efectiva, NEW.jui_abogado, NEW.jui_observaciones, NEW.jui_estado, NEW.jui_usuario_creacion, NEW.jui_fecha_creacion,
    USER(), NOW(), 'UPDATE'
  );
END $$

DROP TRIGGER IF EXISTS tr_RPJ_MNT_JUICIO_DELETE $$
CREATE TRIGGER tr_RPJ_MNT_JUICIO_DELETE AFTER DELETE ON RPJ_MNT_JUICIO
FOR EACH ROW
BEGIN
  INSERT INTO b_RPJ_MNT_JUICIO (
    jui_correlativo, jui_id_jubilado, jui_no_expediente, jui_juzgado, jui_fecha_sentencia,
    jui_fecha_efectiva, jui_abogado, jui_observaciones, jui_estado, jui_usuario_creacion, jui_fecha_creacion,
    usuario_transaccion, fecha_transaccion, tipo_movimiento
  ) VALUES (
    OLD.jui_correlativo, OLD.jui_id_jubilado, OLD.jui_no_expediente, OLD.jui_juzgado, OLD.jui_fecha_sentencia,
    OLD.jui_fecha_efectiva, OLD.jui_abogado, OLD.jui_observaciones, OLD.jui_estado, OLD.jui_usuario_creacion, OLD.jui_fecha_creacion,
    USER(), NOW(), 'DELETE'
  );
END $$

-- ---------- RPJ_MNT_CONVENIO_PAGO ------------------------------------------
DROP TRIGGER IF EXISTS tr_RPJ_MNT_CONVENIO_PAGO_INSERT $$
CREATE TRIGGER tr_RPJ_MNT_CONVENIO_PAGO_INSERT AFTER INSERT ON RPJ_MNT_CONVENIO_PAGO
FOR EACH ROW
BEGIN
  INSERT INTO b_RPJ_MNT_CONVENIO_PAGO (
    con_correlativo, con_id_jubilado, con_id_beneficiario, con_tipo, con_deuda_total,
    con_cantidad_cuotas, con_monto_cuota, con_fecha_inicio, con_fecha_fin, con_autorizado_por,
    con_no_documento, con_estado, con_usuario_creacion, con_fecha_creacion,
    usuario_transaccion, fecha_transaccion, tipo_movimiento
  ) VALUES (
    NEW.con_correlativo, NEW.con_id_jubilado, NEW.con_id_beneficiario, NEW.con_tipo, NEW.con_deuda_total,
    NEW.con_cantidad_cuotas, NEW.con_monto_cuota, NEW.con_fecha_inicio, NEW.con_fecha_fin, NEW.con_autorizado_por,
    NEW.con_no_documento, NEW.con_estado, NEW.con_usuario_creacion, NEW.con_fecha_creacion,
    USER(), NOW(), 'INSERT'
  );
END $$

DROP TRIGGER IF EXISTS tr_RPJ_MNT_CONVENIO_PAGO_UPDATE $$
CREATE TRIGGER tr_RPJ_MNT_CONVENIO_PAGO_UPDATE AFTER UPDATE ON RPJ_MNT_CONVENIO_PAGO
FOR EACH ROW
BEGIN
  INSERT INTO b_RPJ_MNT_CONVENIO_PAGO (
    con_correlativo, con_id_jubilado, con_id_beneficiario, con_tipo, con_deuda_total,
    con_cantidad_cuotas, con_monto_cuota, con_fecha_inicio, con_fecha_fin, con_autorizado_por,
    con_no_documento, con_estado, con_usuario_creacion, con_fecha_creacion,
    usuario_transaccion, fecha_transaccion, tipo_movimiento
  ) VALUES (
    NEW.con_correlativo, NEW.con_id_jubilado, NEW.con_id_beneficiario, NEW.con_tipo, NEW.con_deuda_total,
    NEW.con_cantidad_cuotas, NEW.con_monto_cuota, NEW.con_fecha_inicio, NEW.con_fecha_fin, NEW.con_autorizado_por,
    NEW.con_no_documento, NEW.con_estado, NEW.con_usuario_creacion, NEW.con_fecha_creacion,
    USER(), NOW(), 'UPDATE'
  );
END $$

DROP TRIGGER IF EXISTS tr_RPJ_MNT_CONVENIO_PAGO_DELETE $$
CREATE TRIGGER tr_RPJ_MNT_CONVENIO_PAGO_DELETE AFTER DELETE ON RPJ_MNT_CONVENIO_PAGO
FOR EACH ROW
BEGIN
  INSERT INTO b_RPJ_MNT_CONVENIO_PAGO (
    con_correlativo, con_id_jubilado, con_id_beneficiario, con_tipo, con_deuda_total,
    con_cantidad_cuotas, con_monto_cuota, con_fecha_inicio, con_fecha_fin, con_autorizado_por,
    con_no_documento, con_estado, con_usuario_creacion, con_fecha_creacion,
    usuario_transaccion, fecha_transaccion, tipo_movimiento
  ) VALUES (
    OLD.con_correlativo, OLD.con_id_jubilado, OLD.con_id_beneficiario, OLD.con_tipo, OLD.con_deuda_total,
    OLD.con_cantidad_cuotas, OLD.con_monto_cuota, OLD.con_fecha_inicio, OLD.con_fecha_fin, OLD.con_autorizado_por,
    OLD.con_no_documento, OLD.con_estado, OLD.con_usuario_creacion, OLD.con_fecha_creacion,
    USER(), NOW(), 'DELETE'
  );
END $$

DELIMITER ;

-- ============================================================================
-- BLOQUE 3 — VERIFICACIÓN
-- ============================================================================
SELECT 'BLOQUE 3: verificación' AS etapa;

-- 3.1 Tablas espejo (deben ser 4)
SELECT TABLE_NAME
  FROM information_schema.TABLES
 WHERE TABLE_SCHEMA = DATABASE()
   AND TABLE_NAME IN ('b_RPJ_MNT_BENEFICIARIO','b_RPJ_MNT_TUTOR','b_RPJ_MNT_JUICIO','b_RPJ_MNT_CONVENIO_PAGO')
 ORDER BY TABLE_NAME;

-- 3.2 Triggers creados (deben ser 12)
SELECT EVENT_OBJECT_TABLE AS tabla, TRIGGER_NAME, ACTION_TIMING, EVENT_MANIPULATION
  FROM information_schema.TRIGGERS
 WHERE TRIGGER_SCHEMA = DATABASE()
   AND EVENT_OBJECT_TABLE IN ('RPJ_MNT_BENEFICIARIO','RPJ_MNT_TUTOR','RPJ_MNT_JUICIO','RPJ_MNT_CONVENIO_PAGO')
 ORDER BY EVENT_OBJECT_TABLE, EVENT_MANIPULATION;

SELECT 'FASE 2 COMPLETADA. Deben aparecer 4 tablas b_ y 12 triggers.' AS estado;
-- ============================================================================
-- FIN FASE 2
-- ============================================================================
