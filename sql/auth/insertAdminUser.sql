INSERT INTO RPJ_ADM_USUARIO (
  usu_usuario,
  usu_nombre,
  usu_correo,
  usu_estado,
  usu_fecha_inicio,
  usu_contrasena,
  usu_usuario_creacion
)
VALUES (?, ?, ?, 'ACTIVO', CURDATE(), ?, ?);
