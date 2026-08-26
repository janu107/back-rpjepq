-- Prestaciones: previsualización del Bono Vacacional antes de generar.
-- Cuenta quiénes califican (>= 365 días de antigüedad) y quiénes se excluyen.
-- Params (en orden textual de los ?): [porcentaje, fechaCorte, fechaCorte].
SELECT
  SUM(CASE WHEN x.dias >= 365 THEN 1 ELSE 0 END) AS total_empleados,
  SUM(CASE WHEN x.dias <  365 THEN 1 ELSE 0 END) AS total_excluidos,
  COALESCE(SUM(CASE WHEN x.dias >= 365
                    THEN ROUND(x.salario * ? / 100, 2) ELSE 0 END), 0) AS total_estimado
FROM (
  SELECT base.salario AS salario,
         DATEDIFF(?, COALESCE(e.emp_fecha_ingreso, ?)) AS dias
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
    AND base.salario > 0
) x;
