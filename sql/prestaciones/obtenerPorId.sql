-- Prestaciones: una planilla con sus totales. Params: [idPlanilla].
SELECT
  p.ppl_correlativo        AS id,
  p.ppl_tipo_planilla      AS tipo_planilla,
  t.tpl_tipo_planilla      AS tipo_planilla_nombre,
  p.ppl_numero             AS numero,
  p.ppl_fecha_inicio       AS fecha_inicio,
  p.ppl_fecha_final        AS fecha_final,
  p.ppl_fecha_pago         AS fecha_pago,
  p.ppl_estado_proceso     AS estado_proceso,
  p.ppl_fecha_generacion   AS fecha_generacion,
  p.ppl_usuario_genera     AS usuario_genera,
  p.ppl_porcentaje_pago    AS porcentaje_pago,
  COALESCE(ing.total_empleados, 0) AS total_empleados,
  COALESCE(ing.total_pagado,   0)  AS total_pagado
FROM RPJ_CAT_PARAMETRO_PLANILLA p
LEFT JOIN RPJ_CAT_TIPO_PLANILLA t ON t.tpl_id = p.ppl_tipo_planilla
LEFT JOIN (
  SELECT nin_id_planilla,
         COUNT(DISTINCT nin_id_empleado) AS total_empleados,
         SUM(nin_valor)                  AS total_pagado
  FROM RPJ_PRC_NOMINA_INGRESO
  WHERE nin_id_tipo_planilla IN (5, 7, 9) AND nin_tipo_manejo = 1
  GROUP BY nin_id_planilla
) ing ON ing.nin_id_planilla = p.ppl_correlativo
WHERE p.ppl_correlativo = ?;
