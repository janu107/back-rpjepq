-- Dietas maestro-detalle: número de sesiones vigentes (ACTIVA o APROBADA) de un
-- mes (YYYY-MM) para un tipo de junta, excluyendo la sesión que se está editando.
-- Máx. 5 por mes y por junta. Params: [periodo, idExcluir, tipoJunta, tipoJunta].
SELECT COUNT(*) AS total
FROM RPJ_MNT_SESION
WHERE DATE_FORMAT(ses_fecha_sesion, '%Y-%m') = ?
  AND ses_estado IN ('ACTIVA', 'APROBADA')
  AND ses_correlativo <> ?
  AND (? IS NULL OR ses_tipo_junta = ?);
