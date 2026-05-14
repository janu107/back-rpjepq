SELECT
  bak_id,
  bak_nombre_archivo,
  bak_tipo,
  bak_tamano,
  bak_usuario_id,
  bak_usuario,
  bak_accion,
  bak_fecha,
  bak_observacion
FROM RPJ_SEG_BACKUP
ORDER BY bak_fecha DESC
LIMIT 200;
