-- Nómina de Tiempo Extra: resumen por empleado (HE normal+doble, IGSS, líquido).
-- nin_dias_trabajados almacena la cantidad de horas extra de cada renglón.
-- Params: [idPlanilla, idPlanilla].
SELECT
  e.emp_correlativo                            AS id_empleado,
  e.emp_dpi                                    AS dpi,
  CONCAT(e.emp_nombres, ' ', e.emp_apellidos)  AS nombre_completo,
  e.emp_profesion_oficio                       AS puesto,
  COALESCE(ing.horas, 0)                       AS horas,
  COALESCE(ing.total_ingresos, 0)              AS total_ingresos,
  COALESCE(des.total_descuentos, 0)            AS total_descuentos,
  COALESCE(ing.total_ingresos, 0) - COALESCE(des.total_descuentos, 0) AS neto_a_pagar
FROM (
  SELECT nin_id_empleado,
         SUM(nin_valor)           AS total_ingresos,
         SUM(nin_dias_trabajados) AS horas
  FROM RPJ_PRC_NOMINA_INGRESO
  WHERE nin_id_planilla = ? AND nin_id_tipo_planilla = 3 AND nin_tipo_manejo = 1
  GROUP BY nin_id_empleado
) ing
INNER JOIN RPJ_MNT_EMPLEADO e ON e.emp_correlativo = ing.nin_id_empleado
LEFT JOIN (
  SELECT nde_id_empleado,
         SUM(nde_valor) AS total_descuentos
  FROM RPJ_PRC_NOMINA_DESCUENTO
  WHERE nde_id_planilla = ? AND nde_id_tipo_planilla = 3 AND nde_tipo_manejo = 1
  GROUP BY nde_id_empleado
) des ON des.nde_id_empleado = ing.nin_id_empleado
ORDER BY nombre_completo ASC;
