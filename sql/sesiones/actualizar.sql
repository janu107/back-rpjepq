-- Dietas maestro-detalle: actualizar datos de la sesión.
UPDATE RPJ_MNT_SESION
SET
  ses_acta         = ?,
  ses_fecha_sesion = ?,
  ses_descripcion  = ?
WHERE ses_correlativo = ?;
