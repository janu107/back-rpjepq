SELECT
  ban_id,
  ban_nombre,
  ban_estado,
  ban_fecha_creacion,
  ban_usuario_creacion
FROM RPJ_CAT_BANCOS
WHERE ban_id = ?;
