SELECT
  d.dap_correlativo,
  d.dap_id_aportacion,
  d.dap_fecha_pago,
  d.dap_valor,
  d.dap_fecha_creacion,
  d.dap_usuario_creacion,
  a.apo_id,
  a.apo_nombre,
  a.apo_apellido
FROM RPJ_MNT_DETALLE_APORTACION_EPQ d
INNER JOIN RPJ_MNT_APORTACION_EPQ a ON a.apo_correlativo = d.dap_id_aportacion
WHERE d.dap_id_aportacion = ?
ORDER BY d.dap_correlativo ASC;
