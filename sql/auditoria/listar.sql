SELECT
  aud_id,
  aud_usuario_id,
  aud_usuario,
  aud_rol,
  aud_modulo,
  aud_accion,
  aud_metodo,
  aud_ruta,
  aud_descripcion,
  aud_ip,
  aud_user_agent,
  aud_fecha
FROM RPJ_SEG_AUDITORIA
WHERE (? IS NULL OR aud_usuario LIKE CONCAT('%', ?, '%'))
  AND (? IS NULL OR aud_modulo = ?)
  AND (? IS NULL OR aud_accion = ?)
  AND (? IS NULL OR DATE(aud_fecha) >= ?)
  AND (? IS NULL OR DATE(aud_fecha) <= ?)
ORDER BY aud_fecha DESC
LIMIT ? OFFSET ?;
