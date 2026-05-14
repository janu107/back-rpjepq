INSERT INTO RPJ_SEG_AUDITORIA (
  aud_usuario_id,
  aud_usuario,
  aud_rol,
  aud_modulo,
  aud_accion,
  aud_metodo,
  aud_ruta,
  aud_descripcion,
  aud_ip,
  aud_user_agent
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
