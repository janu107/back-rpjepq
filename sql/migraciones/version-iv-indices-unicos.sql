-- =====================================================================
-- VERSION IV - Indices UNICOS para IDs visibles
-- =====================================================================
-- IMPORTANTE: ejecutar de forma controlada (NO es automatico).
--
-- Estos indices garantizan a nivel de base de datos la unicidad de los IDs
-- visibles (apo_id, emp_id, jub_id, jun_id). La aplicacion YA valida estos
-- duplicados en frontend y backend (respuesta HTTP 409), por lo que estos
-- indices son una segunda capa de proteccion.
--
-- ANTES de crear cada indice, verifique que NO existan duplicados con las
-- consultas del PASO 1. Si una consulta devuelve filas, depure esos datos
-- primero; de lo contrario el ALTER TABLE fallara.
-- =====================================================================

-- ---------------------------------------------------------------------
-- PASO 1: detectar duplicados (cada consulta debe devolver 0 filas)
-- ---------------------------------------------------------------------
SELECT apo_id, COUNT(*) AS repetidos FROM RPJ_MNT_APORTACION_EPQ GROUP BY apo_id HAVING COUNT(*) > 1;
SELECT emp_id, COUNT(*) AS repetidos FROM RPJ_MNT_EMPLEADO        GROUP BY emp_id HAVING COUNT(*) > 1;
SELECT jub_id, COUNT(*) AS repetidos FROM RPJ_MNT_JUBILADO        GROUP BY jub_id HAVING COUNT(*) > 1;
SELECT jun_id, COUNT(*) AS repetidos FROM RPJ_MNT_JUNTA_DIRECTIVA GROUP BY jun_id HAVING COUNT(*) > 1;

-- ---------------------------------------------------------------------
-- PASO 2: crear los indices UNICOS (solo si el PASO 1 no devolvio filas)
-- ---------------------------------------------------------------------
ALTER TABLE RPJ_MNT_APORTACION_EPQ ADD UNIQUE INDEX uq_apo_id (apo_id);
ALTER TABLE RPJ_MNT_EMPLEADO        ADD UNIQUE INDEX uq_emp_id (emp_id);
ALTER TABLE RPJ_MNT_JUBILADO        ADD UNIQUE INDEX uq_jub_id (jub_id);
ALTER TABLE RPJ_MNT_JUNTA_DIRECTIVA ADD UNIQUE INDEX uq_jun_id (jun_id);

-- Para revertir (si fuese necesario):
-- ALTER TABLE RPJ_MNT_APORTACION_EPQ DROP INDEX uq_apo_id;
-- ALTER TABLE RPJ_MNT_EMPLEADO        DROP INDEX uq_emp_id;
-- ALTER TABLE RPJ_MNT_JUBILADO        DROP INDEX uq_jub_id;
-- ALTER TABLE RPJ_MNT_JUNTA_DIRECTIVA DROP INDEX uq_jun_id;
