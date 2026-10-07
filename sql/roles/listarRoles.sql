-- Un renglon por usuario con TODOS sus roles (un usuario puede tener varios).
-- Los usuarios sin rol tambien aparecen, para poder asignarles uno.
SELECT
  u.usu_id,
  u.usu_usuario,
  u.usu_nombre,
  u.usu_correo,
  u.usu_estado,
  GROUP_CONCAT(r.rol_tipo_rol ORDER BY r.rol_id SEPARATOR ',') AS roles,
  MAX(r.rol_fecha_creacion) AS rol_fecha_creacion
FROM RPJ_ADM_USUARIO u
LEFT JOIN RPJ_ADM_ROL r ON r.rol_usuario = u.usu_id
GROUP BY u.usu_id
ORDER BY u.usu_id DESC;
