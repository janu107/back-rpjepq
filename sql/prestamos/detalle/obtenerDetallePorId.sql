SELECT
  dpr_correlativo,
  dpr_id_prestamo,
  dpr_fecha_pago,
  dpr_descuento_nomina_aportacion,
  dpr_cuota_nivelada,
  dpr_amortizacion,
  dpr_intereses,
  dpr_saldo,
  dpr_mora,
  dpr_fecha_creacion,
  dpr_usuario_creacion
FROM RPJ_MNT_DETALLE_PRESTAMO
WHERE dpr_correlativo = ?;
