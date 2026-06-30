-- Dietas maestro-detalle: una sesión por id (los asistentes se cargan aparte).
SELECT
  s.ses_correlativo,
  s.ses_acta,
  s.ses_fecha_sesion,
  s.ses_descripcion,
  s.ses_estado,
  s.ses_fecha_creacion,
  s.ses_usuario_creacion
FROM RPJ_MNT_SESION s
WHERE s.ses_correlativo = ?;
