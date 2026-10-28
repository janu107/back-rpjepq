-- ============================================================================
-- Sesiones de junta: estado APROBADA (congela la asistencia) y tipo de junta
-- (JUNTA ADMINISTRADORA / JUNTA VIGILANCIA). Idempotente.
-- ============================================================================

ALTER TABLE RPJ_MNT_SESION
  MODIFY ses_estado ENUM('ACTIVA','APROBADA','ANULADA') NOT NULL DEFAULT 'ACTIVA';

SET @existe := (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'RPJ_MNT_SESION' AND COLUMN_NAME = 'ses_tipo_junta');
SET @ddl := IF(@existe = 0,
  'ALTER TABLE RPJ_MNT_SESION ADD COLUMN ses_tipo_junta VARCHAR(50) NULL AFTER ses_descripcion',
  'SELECT 1');
PREPARE st FROM @ddl;
EXECUTE st;
DEALLOCATE PREPARE st;

SET @existe := (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'RPJ_MNT_SESION' AND COLUMN_NAME = 'ses_fecha_aprobacion');
SET @ddl := IF(@existe = 0,
  'ALTER TABLE RPJ_MNT_SESION ADD COLUMN ses_fecha_aprobacion DATETIME NULL AFTER ses_estado, ADD COLUMN ses_usuario_aprobacion VARCHAR(50) NULL AFTER ses_fecha_aprobacion',
  'SELECT 1');
PREPARE st FROM @ddl;
EXECUTE st;
DEALLOCATE PREPARE st;
