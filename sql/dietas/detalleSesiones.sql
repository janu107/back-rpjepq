-- Dietas maestro-detalle: sesiones asistidas de un encabezado (para el voucher).
SELECT
  det.die_correlativo,
  det.die_valor,
  s.ses_correlativo,
  s.ses_acta,
  s.ses_fecha_sesion,
  s.ses_descripcion,
  s.ses_estado
FROM RPJ_MNT_DIETA_DET det
INNER JOIN RPJ_MNT_SESION s ON s.ses_correlativo = det.die_id_sesion
WHERE det.die_id_dieta = ?
ORDER BY s.ses_fecha_sesion ASC;
