-- Resumen de generación de planilla de empleados régimen.
-- CAMBIO X: un empleado se considera ACTIVO cuando emp_estado NO es INACTIVO
-- (la app no setea emp_estado al crear, por lo que puede venir NULL = activo).
SELECT
  (SELECT COUNT(*) FROM RPJ_MNT_EMPLEADO
   WHERE emp_tipo_manejo = 1 AND UPPER(COALESCE(emp_estado,'ACTIVO')) <> 'INACTIVO')         AS total_activos,
  (SELECT COUNT(DISTINCT d.dat_id_empleado)
   FROM RPJ_MNT_DATOS_PLANILLA d
   INNER JOIN RPJ_MNT_EMPLEADO e ON e.emp_correlativo = d.dat_id_empleado
   WHERE d.dat_tipo_manejo = 1 AND d.dat_aplica_nomina = 1
     AND UPPER(COALESCE(e.emp_estado,'ACTIVO')) <> 'INACTIVO')                                AS con_datos_planilla,
  ppl_porcentaje_pago                                                                        AS porcentaje_pago,
  ppl_estado_proceso                                                                         AS estado_proceso
FROM RPJ_CAT_PARAMETRO_PLANILLA
WHERE ppl_correlativo = ?;
