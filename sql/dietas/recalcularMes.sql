-- Dietas maestro-detalle: recalcula TODOS los encabezados PENDIENTE de un periodo.
-- Cuenta únicamente asistencia de sesiones ACTIVAS. Param: [periodo].
UPDATE RPJ_MNT_DIETA d
LEFT JOIN (
  SELECT det.die_id_dieta,
         COUNT(*)            AS n,
         SUM(det.die_valor)  AS total
  FROM RPJ_MNT_DIETA_DET det
  INNER JOIN RPJ_MNT_SESION s
          ON s.ses_correlativo = det.die_id_sesion AND s.ses_estado = 'ACTIVA'
  GROUP BY det.die_id_dieta
) agg ON agg.die_id_dieta = d.vdi_correlativo
CROSS JOIN (SELECT par_isr FROM RPJ_CAT_PARAMETRO_GENERAL ORDER BY par_id DESC LIMIT 1) p
SET d.vdi_total_sesiones = COALESCE(agg.n, 0),
    d.vdi_valor          = COALESCE(agg.total, 0),
    d.vdi_isr            = ROUND(COALESCE(agg.total, 0) * p.par_isr / 100, 2),
    d.vdi_valor_pago     = ROUND(COALESCE(agg.total, 0) - COALESCE(agg.total, 0) * p.par_isr / 100, 2)
WHERE d.vdi_periodo = ?
  AND d.vdi_estado = 'PENDIENTE';
