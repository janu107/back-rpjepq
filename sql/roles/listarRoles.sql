SELECT
  r.rol_id,
  r.rol_tipo_rol,
  r.rol_usuario,
  r.rol_fecha_creacion,
  r.rol_usuario_creacion,
  u.usu_usuario,
  u.usu_nombre,
  u.usu_correo,
  u.usu_estado
FROM RPJ_ADM_ROL r
INNER JOIN RPJ_ADM_USUARIO u ON u.usu_id = r.rol_usuario
ORDER BY r.rol_id DESC;
