-- Movimientos del estado de cuenta de un préstamo EPQ. Params: [idPrestamo].
SELECT
  d.dpr_correlativo                 AS id,
  d.dpr_fecha_pago                  AS fecha_pago,
  d.dpr_descuento_nomina_aportacion AS descuento_nomina,
  d.dpr_seguro                      AS seguro,
  d.dpr_cuota_nivelada              AS cuota_nivelada,
  d.dpr_amortizacion                AS amortizacion,
  d.dpr_intereses                   AS intereses,
  d.dpr_saldo                       AS saldo,
  d.dpr_mora                        AS mora
FROM RPJ_MNT_DETALLE_PRESTAMO d
WHERE d.dpr_id_prestamo = ?
ORDER BY d.dpr_fecha_pago, d.dpr_correlativo;
