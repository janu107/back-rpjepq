SELECT
  u.usu_id,
  u.usu_usuario,
  u.usu_estado,
  u.usu_contrasena,
  GROUP_CONCAT(r.rol_tipo_rol ORDER BY r.rol_id SEPARATOR ',') AS rol_tipo_rol
FROM RPJ_ADM_USUARIO u
LEFT JOIN RPJ_ADM_ROL r ON r.rol_usuario = u.usu_id
WHERE u.usu_id = ?
GROUP BY u.usu_id;
