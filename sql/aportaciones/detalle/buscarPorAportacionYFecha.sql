SELECT dap_correlativo
FROM RPJ_MNT_DETALLE_APORTACION_EPQ
WHERE dap_id_aportacion = ?
  AND dap_fecha_pago = ?;
