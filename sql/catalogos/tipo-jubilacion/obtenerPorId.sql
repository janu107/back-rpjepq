SELECT
  tju_id,
  tju_descripcion,
  tju_fecha_creacion,
  tju_usuario_creacion
FROM RPJ_CAT_TIPO_JUBILACION
WHERE tju_id = ?;
