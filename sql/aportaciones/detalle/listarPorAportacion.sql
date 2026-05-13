SELECT
  dap_correlativo,
  dap_id_aportacion,
  dap_fecha_pago,
  dap_valor,
  dap_fecha_creacion,
  dap_usuario_creacion
FROM RPJ_MNT_DETALLE_APORTACION_EPQ
WHERE dap_id_aportacion = ?
ORDER BY dap_fecha_pago DESC, dap_correlativo DESC;
