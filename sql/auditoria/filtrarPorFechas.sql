SELECT
  MIN(DATE(aud_fecha)) AS fecha_inicio,
  MAX(DATE(aud_fecha)) AS fecha_fin
FROM RPJ_SEG_AUDITORIA;
