SELECT
  o.ode_correlativo,
  o.ode_tipo_manejo,
  o.ode_tipo_descuento,
  o.ode_valor,
  o.ode_motivo,
  o.ode_fecha,
  td.tde_tipo_descuento,
  td.tde_descripcion AS tipo_descuento_descripcion
FROM RPJ_MNT_OTRO_DESCUENTO o
LEFT JOIN RPJ_CAT_TIPO_DESCUENTO td ON td.tde_id = o.ode_tipo_descuento
WHERE o.ode_tipo_manejo = ?
  AND DATE(o.ode_fecha) BETWEEN ? AND ?
ORDER BY o.ode_correlativo;
