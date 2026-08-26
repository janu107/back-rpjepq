-- Prestaciones: total pagado por año y prestación (sección 9.2 del spec).
SELECT
  YEAR(pp.ppl_fecha_pago)              AS anio,
  ni.nin_id_tipo_planilla              AS tipo_planilla,
  tp.tpl_tipo_planilla                 AS prestacion,
  COUNT(DISTINCT ni.nin_id_empleado)   AS empleados,
  SUM(ni.nin_valor)                    AS total_pagado
FROM RPJ_PRC_NOMINA_INGRESO ni
INNER JOIN RPJ_CAT_PARAMETRO_PLANILLA pp ON pp.ppl_correlativo = ni.nin_id_planilla
INNER JOIN RPJ_CAT_TIPO_PLANILLA tp      ON tp.tpl_id = ni.nin_id_tipo_planilla
WHERE ni.nin_id_tipo_planilla IN (5, 7, 9)
  AND ni.nin_tipo_manejo = 1
GROUP BY YEAR(pp.ppl_fecha_pago), ni.nin_id_tipo_planilla, tp.tpl_tipo_planilla
ORDER BY anio DESC, prestacion;
