SELECT
  COALESCE(SUM(dap_valor), 0) AS total_aportado
FROM RPJ_MNT_DETALLE_APORTACION_EPQ
WHERE dap_id_aportacion = ?;
