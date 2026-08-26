-- Prestaciones: empleados activos de régimen que NO están todavía en la planilla,
-- para el diálogo "Agregar empleado". Params: [idPlanilla].
SELECT
  e.emp_correlativo                           AS id_empleado,
  e.emp_dpi                                   AS dpi,
  CONCAT(e.emp_nombres, ' ', e.emp_apellidos) AS nombre_completo,
  e.emp_profesion_oficio                      AS puesto,
  e.emp_fecha_ingreso                         AS fecha_ingreso,
  COALESCE(base.salario, 0)                   AS salario
FROM RPJ_MNT_EMPLEADO e
LEFT JOIN (
  SELECT s.sal_id_empleado, s.sal_salario AS salario
  FROM RPJ_MNT_SALARIO s
  WHERE s.sal_tipo_manejo = 1
    AND s.sal_correlativo = (
      SELECT MIN(s2.sal_correlativo) FROM RPJ_MNT_SALARIO s2
      WHERE s2.sal_id_empleado = s.sal_id_empleado AND s2.sal_tipo_manejo = 1)
) base ON base.sal_id_empleado = e.emp_correlativo
WHERE e.emp_tipo_manejo = 1
  AND UPPER(COALESCE(e.emp_estado, 'ACTIVO')) <> 'INACTIVO'
  AND NOT EXISTS (
    SELECT 1 FROM RPJ_PRC_NOMINA_INGRESO ni
    WHERE ni.nin_id_planilla = ?
      AND ni.nin_id_empleado = e.emp_correlativo
      AND ni.nin_id_tipo_planilla IN (5, 7, 9)
  )
ORDER BY e.emp_apellidos, e.emp_nombres;
