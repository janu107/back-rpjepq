-- Dietas maestro-detalle: listado de sesiones (actas) con número de asistentes.
SELECT
  s.ses_correlativo,
  s.ses_acta,
  s.ses_fecha_sesion,
  s.ses_descripcion,
  s.ses_estado,
  s.ses_fecha_creacion,
  s.ses_usuario_creacion,
  (SELECT COUNT(*) FROM RPJ_MNT_DIETA_DET det WHERE det.die_id_sesion = s.ses_correlativo) AS asistentes
FROM RPJ_MNT_SESION s
ORDER BY s.ses_fecha_sesion DESC, s.ses_correlativo DESC;
