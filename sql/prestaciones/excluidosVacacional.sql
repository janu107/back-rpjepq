-- Prestaciones: empleados que NO califican para el bono vacacional (sección 9.4).
-- Params: [fechaCorte, fechaCorte, fechaCorte, fechaCorte].
SELECT
  e.emp_correlativo                           AS id_empleado,
  e.emp_dpi                                   AS dpi,
  CONCAT(e.emp_nombres, ' ', e.emp_apellidos) AS nombre_completo,
  e.emp_profesion_oficio                      AS puesto,
  e.emp_fecha_ingreso                         AS fecha_ingreso,
  DATEDIFF(?, e.emp_fecha_ingreso)            AS dias_antiguedad,
  ROUND(DATEDIFF(?, e.emp_fecha_ingreso) / 365, 2) AS anios
FROM RPJ_MNT_EMPLEADO e
WHERE e.emp_tipo_manejo = 1
  AND UPPER(COALESCE(e.emp_estado, 'ACTIVO')) <> 'INACTIVO'
  AND DATEDIFF(?, COALESCE(e.emp_fecha_ingreso, ?)) < 365
ORDER BY e.emp_fecha_ingreso DESC;
