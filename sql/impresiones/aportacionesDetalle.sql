-- Movimientos de aportación de un empleado EPQ. Params: [idAportacion].
SELECT
  d.dap_correlativo AS id,
  d.dap_fecha_pago  AS fecha_pago,
  d.dap_valor       AS monto
FROM RPJ_MNT_DETALLE_APORTACION_EPQ d
WHERE d.dap_id_aportacion = ?
ORDER BY d.dap_fecha_pago ASC, d.dap_correlativo ASC;
