SELECT
  tde_id,
  tde_tipo_descuento,
  tde_descripcion,
  tde_fecha_creacion,
  tde_usuario_creacion
FROM RPJ_CAT_TIPO_DESCUENTO
WHERE tde_id = ?;
