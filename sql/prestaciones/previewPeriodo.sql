-- Prestaciones: previsualización de Bono 14 / Aguinaldo antes de generar.
-- Aplica exactamente el mismo criterio que los SP (mismo salario base, mismos
-- días) para que la pantalla muestre el total real que se pagará.
-- Params: [fechaFin, fechaInicio, fechaInicio, fechaInicio, fechaFin].
SELECT
  COUNT(*)                                  AS total_empleados,
  COALESCE(SUM(ROUND(x.salario * x.dias / 365, 2)), 0) AS total_estimado
FROM (
  SELECT base.salario AS salario,
         LEAST(365, GREATEST(0,
           DATEDIFF(?, GREATEST(?, COALESCE(e.emp_fecha_ingreso, ?))) + 1)) AS dias
  FROM RPJ_MNT_EMPLEADO e
  INNER JOIN (
    SELECT s.sal_id_empleado, s.sal_salario AS salario
    FROM RPJ_MNT_SALARIO s
    WHERE s.sal_tipo_manejo = 1
      AND s.sal_correlativo = (
        SELECT MIN(s2.sal_correlativo) FROM RPJ_MNT_SALARIO s2
        WHERE s2.sal_id_empleado = s.sal_id_empleado AND s2.sal_tipo_manejo = 1)
  ) base ON base.sal_id_empleado = e.emp_correlativo
  WHERE e.emp_tipo_manejo = 1
    AND UPPER(COALESCE(e.emp_estado, 'ACTIVO')) <> 'INACTIVO'
    AND COALESCE(e.emp_fecha_ingreso, ?) <= ?
) x
WHERE x.dias > 0 AND x.salario > 0;
