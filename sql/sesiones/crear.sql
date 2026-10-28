-- Dietas maestro-detalle: crear sesión (acta única).
INSERT INTO RPJ_MNT_SESION (
  ses_acta,
  ses_fecha_sesion,
  ses_descripcion,
  ses_tipo_junta,
  ses_usuario_creacion
)
VALUES (?, ?, ?, ?, ?);
