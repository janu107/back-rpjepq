SELECT
  d.dap_correlativo,
  d.dap_fecha_pago,
  d.dap_valor,
  d.dap_fecha_creacion,
  d.dap_usuario_creacion
FROM RPJ_MNT_DETALLE_APORTACION_EPQ d
WHERE d.dap_id_aportacion = ?
ORDER BY d.dap_fecha_pago ASC;
