SELECT
  j.jub_correlativo                                                        AS id_jubilado,
  CONCAT(j.jub_nombres, ' ', j.jub_apellidos)                              AS nombre_completo,
  j.jub_dpi                                                                AS dpi,
  COUNT(d.deu_correlativo)                                                 AS meses_totales,
  SUM(CASE WHEN d.deu_estado = 'PAGADA' THEN 1 ELSE 0 END)                 AS meses_pagados,
  SUM(CASE WHEN d.deu_estado IN ('PENDIENTE','PARCIAL') THEN 1 ELSE 0 END) AS meses_pendientes,
  COALESCE(SUM(d.deu_monto_original), 0)                                   AS monto_original_total,
  COALESCE(SUM(d.deu_monto_pagado), 0)                                     AS monto_pagado_total,
  COALESCE(SUM(d.deu_monto_pendiente), 0)                                  AS deuda_pendiente_total,
  MIN(CASE WHEN d.deu_estado IN ('PENDIENTE','PARCIAL') THEN d.deu_periodo END) AS periodo_mas_antiguo_pendiente
FROM RPJ_MNT_JUBILADO j
LEFT JOIN RPJ_PRC_DEUDA_JUBILADO d ON d.deu_id_jubilado = j.jub_correlativo
WHERE j.jub_correlativo = ?
GROUP BY j.jub_correlativo, j.jub_nombres, j.jub_apellidos, j.jub_dpi;
