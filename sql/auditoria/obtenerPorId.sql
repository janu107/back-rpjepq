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
WHERE aud_id = ?;
