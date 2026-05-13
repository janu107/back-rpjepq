UPDATE RPJ_MNT_OTRO_DESCUENTO
SET
  ode_tipo_manejo = ?,
  ode_tipo_descuento = ?,
  ode_valor = ?,
  ode_motivo = ?,
  ode_fecha = ?
WHERE ode_correlativo = ?;
