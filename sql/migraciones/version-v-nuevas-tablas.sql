-- =============================================================
-- MIGRACIÓN VERSION V — TABLAS NUEVAS Y COLUMNAS ADICIONALES
-- Ejecutar manualmente en orden.
-- Seguro: usa IF NOT EXISTS / IF NOT EXISTS en columnas.
-- =============================================================

-- 1. Catálogo de Bancos
CREATE TABLE IF NOT EXISTS RPJ_CAT_BANCOS (
  ban_id INT(11) NOT NULL AUTO_INCREMENT,
  ban_nombre VARCHAR(100) NOT NULL,
  ban_estado VARCHAR(20) NOT NULL DEFAULT 'ACTIVO',
  ban_fecha_creacion TIMESTAMP NULL DEFAULT current_timestamp(),
  ban_usuario_creacion VARCHAR(50) NOT NULL,
  PRIMARY KEY (ban_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Descuentos Judiciales
CREATE TABLE IF NOT EXISTS RPJ_MNT_DESC_JUDICIALES (
  dju_id INT(11) NOT NULL AUTO_INCREMENT,
  dju_tipo_manejo INT(11) NOT NULL,
  dju_tipo_persona VARCHAR(20) NOT NULL,
  dju_id_persona INT(11) NOT NULL,
  dju_expediente VARCHAR(100) DEFAULT NULL,
  dju_juzgado VARCHAR(200) DEFAULT NULL,
  dju_monto DECIMAL(10,2) NOT NULL,
  dju_descripcion VARCHAR(300) DEFAULT NULL,
  dju_estado VARCHAR(20) NOT NULL DEFAULT 'ACTIVO',
  dju_fecha_creacion TIMESTAMP NULL DEFAULT current_timestamp(),
  dju_usuario_creacion VARCHAR(50) NOT NULL,
  PRIMARY KEY (dju_id),
  KEY dju_tipo_manejo (dju_tipo_manejo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Préstamos Régimen
CREATE TABLE IF NOT EXISTS RPJ_MNT_PRESTAMOS_REGIMEN (
  prr_id INT(11) NOT NULL AUTO_INCREMENT,
  prr_tipo_manejo INT(11) NOT NULL,
  prr_tipo_persona VARCHAR(20) NOT NULL,
  prr_id_persona INT(11) NOT NULL,
  prr_id_banco INT(11) NOT NULL,
  prr_no_contrato VARCHAR(50) NOT NULL,
  prr_monto DECIMAL(10,2) NOT NULL,
  prr_cuota DECIMAL(10,2) NOT NULL,
  prr_plazo_meses INT(11) NOT NULL,
  prr_fecha_inicio DATE NOT NULL,
  prr_fecha_fin DATE NOT NULL,
  prr_tasa_interes DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  prr_estado VARCHAR(20) NOT NULL DEFAULT 'ACTIVO',
  prr_observaciones VARCHAR(500) DEFAULT NULL,
  prr_fecha_creacion TIMESTAMP NULL DEFAULT current_timestamp(),
  prr_usuario_creacion VARCHAR(50) NOT NULL,
  PRIMARY KEY (prr_id),
  KEY prr_tipo_manejo (prr_tipo_manejo),
  KEY prr_id_banco (prr_id_banco)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Datos Planilla
CREATE TABLE IF NOT EXISTS RPJ_MNT_DATOS_PLANILLA (
  dpl_id INT(11) NOT NULL AUTO_INCREMENT,
  dpl_tipo_manejo INT(11) NOT NULL,
  dpl_tipo_persona VARCHAR(20) NOT NULL,
  dpl_id_persona INT(11) NOT NULL,
  dpl_id_banco INT(11) NOT NULL,
  dpl_no_cuenta VARCHAR(100) DEFAULT NULL,
  dpl_forma_pago VARCHAR(20) NOT NULL,
  dpl_tipo_cuenta VARCHAR(20) DEFAULT NULL,
  dpl_estado VARCHAR(20) NOT NULL DEFAULT 'ACTIVO',
  dpl_fecha_creacion TIMESTAMP NULL DEFAULT current_timestamp(),
  dpl_usuario_creacion VARCHAR(50) NOT NULL,
  PRIMARY KEY (dpl_id),
  KEY dpl_tipo_manejo (dpl_tipo_manejo),
  KEY dpl_id_banco (dpl_id_banco)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Columna SEXO en empleados (NULL para no romper registros existentes)
ALTER TABLE RPJ_MNT_EMPLEADO
  ADD COLUMN IF NOT EXISTS emp_sexo VARCHAR(20) NULL AFTER emp_fecha_nacimiento;

-- 6. Columna SEXO en jubilados
ALTER TABLE RPJ_MNT_JUBILADO
  ADD COLUMN IF NOT EXISTS jub_sexo VARCHAR(20) NULL AFTER jub_fecha_nacimiento;

-- 7. Columna SEGURO en detalle préstamos
ALTER TABLE RPJ_MNT_DETALLE_PRESTAMO
  ADD COLUMN IF NOT EXISTS dpr_seguro DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER dpr_mora;
