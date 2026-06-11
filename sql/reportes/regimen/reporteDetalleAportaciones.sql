SELECT
  d.dap_correlativo,
  a.apo_id,
  a.apo_nombre,
  a.apo_apellido,
  a.apo_dpi,
  a.apo_gerencia,
  a.apo_estado,
  m.man_descripcion AS manejo_descripcion,
  d.dap_fecha_pago,
  d.dap_valor
FROM RPJ_MNT_DETALLE_APORTACION_EPQ d
JOIN RPJ_MNT_APORTACION_EPQ a ON a.apo_correlativo = d.dap_id_aportacion
LEFT JOIN RPJ_CAT_MANEJO_ADMINISTRACION m ON m.man_id = a.apo_tipo_manejo
ORDER BY a.apo_nombre ASC, a.apo_apellido ASC, d.dap_fecha_pago ASC;
