-- =============================================================
-- MIGRACIÓN VERSION V — ACTUALIZACIÓN PARA ESQUEMA REAL DE BD
-- Las tablas RPJ_CAT_BANCOS, RPJ_MNT_DATOS_PLANILLA,
-- RPJ_MNT_DESC_JUDICIALES y RPJ_MNT_PRESTAMOS_REGIMEN
-- ya existen en la base de datos con su estructura correcta.
--
-- Esta migración solo ajusta las columnas de texto que necesitan
-- más espacio del que la BD tiene definido actualmente.
-- Ejecutar en la base de datos apps_rpjepq.
-- =============================================================

-- Expandir emp_sexo de VARCHAR(4) a VARCHAR(20) para almacenar
-- valores como MASCULINO y FEMENINO (la columna ya existe).
ALTER TABLE RPJ_MNT_EMPLEADO
  MODIFY COLUMN emp_sexo VARCHAR(20) NOT NULL DEFAULT '';

-- Expandir jub_sexo de VARCHAR(4) a VARCHAR(20) (la columna ya existe).
ALTER TABLE RPJ_MNT_JUBILADO
  MODIFY COLUMN jub_sexo VARCHAR(20) NULL;

-- dpr_seguro ya existe en RPJ_MNT_DETALLE_PRESTAMO — no se requiere nada.
-- RPJ_CAT_BANCOS ya existe con ban_descripcion — no se crea.
-- RPJ_MNT_DATOS_PLANILLA ya existe con dat_* prefijo — no se crea.
-- RPJ_MNT_DESC_JUDICIALES ya existe con dju_correlativo — no se crea.
-- RPJ_MNT_PRESTAMOS_REGIMEN ya existe con prr_correlativo — no se crea.
