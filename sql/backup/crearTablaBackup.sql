CREATE TABLE IF NOT EXISTS RPJ_SEG_BACKUP (
  bak_id INT AUTO_INCREMENT PRIMARY KEY,
  bak_nombre_archivo VARCHAR(255) NOT NULL,
  bak_tipo VARCHAR(50) NOT NULL,
  bak_tamano VARCHAR(50) NULL,
  bak_usuario_id INT NULL,
  bak_usuario VARCHAR(100) NULL,
  bak_accion VARCHAR(50) NOT NULL,
  bak_fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  bak_observacion TEXT NULL
);
