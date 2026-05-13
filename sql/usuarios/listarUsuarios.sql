SELECT
  u.usu_id,
  u.usu_usuario,
  u.usu_nombre,
  u.usu_correo,
  u.usu_estado,
  u.usu_fecha_inicio,
  u.usu_fecha_creacion,
  r.rol_id,
  r.rol_tipo_rol
FROM RPJ_ADM_USUARIO u
LEFT JOIN RPJ_ADM_ROL r ON r.rol_usuario = u.usu_id
ORDER BY u.usu_id DESC;
