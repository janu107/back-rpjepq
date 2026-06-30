-- Dietas maestro-detalle: número de sesiones ACTIVAS de un mes (YYYY-MM),
-- excluyendo opcionalmente la sesión que se está editando. Máx. 5 por mes.
SELECT COUNT(*) AS total
FROM RPJ_MNT_SESION
WHERE DATE_FORMAT(ses_fecha_sesion, '%Y-%m') = ?
  AND ses_estado = 'ACTIVA'
  AND ses_correlativo <> ?;
