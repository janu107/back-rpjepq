UPDATE RPJ_MNT_DETALLE_APORTACION_EPQ
SET
  dap_fecha_pago = ?,
  dap_valor = ?
WHERE dap_correlativo = ?;
