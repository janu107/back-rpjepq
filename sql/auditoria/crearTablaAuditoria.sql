CREATE TABLE IF NOT EXISTS RPJ_SEG_AUDITORIA (
  aud_id INT AUTO_INCREMENT PRIMARY KEY,
  aud_usuario_id INT NULL,
  aud_usuario VARCHAR(100) NULL,
  aud_rol VARCHAR(50) NULL,
  aud_modulo VARCHAR(100) NOT NULL,
  aud_accion VARCHAR(100) NOT NULL,
  aud_metodo VARCHAR(10) NOT NULL,
  aud_ruta VARCHAR(255) NOT NULL,
  aud_descripcion TEXT NULL,
  aud_ip VARCHAR(100) NULL,
  aud_user_agent TEXT NULL,
  aud_fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
