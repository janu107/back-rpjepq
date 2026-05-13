UPDATE RPJ_MNT_JUBILADO
SET
  jub_tipo_manejo = ?,
  jub_id = ?,
  jub_nombres = ?,
  jub_apellidos = ?,
  jub_fecha_nacimiento = ?,
  jub_dpi = ?,
  jub_direccion = ?,
  jub_profesion_oficio = ?,
  jub_estado_civil = ?,
  jub_estado = ?,
  jub_fecha_jubilacion = ?,
  jub_tipo_jubilacion = ?
WHERE jub_correlativo = ?;
