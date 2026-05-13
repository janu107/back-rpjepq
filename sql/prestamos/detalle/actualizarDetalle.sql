UPDATE RPJ_MNT_DETALLE_PRESTAMO
SET
  dpr_fecha_pago = ?,
  dpr_descuento_nomina_aportacion = ?,
  dpr_cuota_nivelada = ?,
  dpr_amortizacion = ?,
  dpr_intereses = ?,
  dpr_saldo = ?,
  dpr_mora = ?
WHERE dpr_correlativo = ?;
