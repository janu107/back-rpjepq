-- Prestaciones jubilados: reporte por tipo de jubilación (sección 6.1 del documento).
-- Params: [idPlanilla].
SELECT
  COALESCE(tj.tju_descripcion, 'SIN CLASIFICAR') AS tipo_jubilacion,
  COUNT(*) AS total_lineas,
  SUM(ni.nin_valor) AS total_pagado
FROM RPJ_PRC_NOMINA_INGRESO ni
INNER JOIN RPJ_MNT_JUBILADO j ON j.jub_correlativo = ni.nin_id_jubilado
LEFT JOIN RPJ_CAT_TIPO_JUBILACION tj ON tj.tju_id = j.jub_tipo_jubilacion
WHERE ni.nin_id_planilla = ?
  AND ni.nin_id_tipo_planilla IN (6, 8)
GROUP BY tipo_jubilacion
ORDER BY tipo_jubilacion;
