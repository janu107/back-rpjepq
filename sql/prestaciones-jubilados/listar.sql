-- Prestaciones jubilados: listado de planillas de un tipo (6 Bono14 / 8 Aguinaldo)
-- con totales. Params: [tipoPlanilla, tipoPlanilla].
SELECT
  p.ppl_correlativo      AS id,
  p.ppl_tipo_planilla    AS tipo_planilla,
  p.ppl_numero           AS numero,
  p.ppl_fecha_inicio     AS fecha_inicio,
  p.ppl_fecha_final      AS fecha_final,
  p.ppl_fecha_pago       AS fecha_pago,
  p.ppl_estado_proceso   AS estado_proceso,
  p.ppl_fecha_generacion AS fecha_generacion,
  p.ppl_usuario_genera   AS usuario_genera,
  COALESCE(t.total_registros, 0) AS total_registros,
  COALESCE(t.total_pagado, 0)    AS total_pagado
FROM RPJ_CAT_PARAMETRO_PLANILLA p
LEFT JOIN (
  SELECT nin_id_planilla, COUNT(*) AS total_registros, SUM(nin_valor) AS total_pagado
    FROM RPJ_PRC_NOMINA_INGRESO
   WHERE nin_id_tipo_planilla = ? AND nin_tipo_manejo = 2
   GROUP BY nin_id_planilla
) t ON t.nin_id_planilla = p.ppl_correlativo
WHERE p.ppl_tipo_planilla = ?
ORDER BY p.ppl_correlativo DESC;
