UPDATE RPJ_ADM_USUARIO
SET
  usu_nombre = ?,
  usu_correo = ?,
  usu_estado = ?,
  usu_fecha_inicio = ?
WHERE usu_id = ?;
