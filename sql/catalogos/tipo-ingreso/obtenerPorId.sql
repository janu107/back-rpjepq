SELECT
  tin_id,
  tin_tipo_ingreso,
  tin_descripcion,
  tin_fecha_creacion,
  tin_usuario_creacion
FROM RPJ_CAT_TIPO_INGRESO
WHERE tin_id = ?;
