SELECT
  rol_id,
  rol_tipo_rol,
  rol_usuario
FROM RPJ_ADM_ROL
WHERE rol_usuario = ?
LIMIT 1;
