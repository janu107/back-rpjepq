-- Nómina mensual de préstamos de empleados EPQ (mejora 18).
-- Toma el movimiento de cada préstamo cuya fecha de pago cae en el rango, con el
-- saldo del movimiento anterior para poder mostrar "saldo mes anterior".
-- Params: [fechaDesde, fechaHasta].
SELECT
  p.pre_correlativo                 AS id_prestamo,
  a.apo_id                          AS codigo,
  CONCAT(a.apo_nombre, ' ', a.apo_apellido) AS cliente,
  p.pre_no_contrato                 AS no_contrato,
  p.pre_monto_autorizado            AS monto_prestamo,
  p.pre_plazo_meses                 AS plazo_meses,
  p.pre_fecha_inicio                AS fecha_inicio,
  p.pre_fecha_fin                   AS fecha_fin,
  p.pre_tasa_interes                AS tasa_interes,
  d.dpr_fecha_pago                  AS fecha_pago,
  d.dpr_descuento_nomina_aportacion AS descuento_nomina,
  d.dpr_seguro                      AS seguro,
  d.dpr_cuota_nivelada              AS cuota_nivelada,
  d.dpr_amortizacion                AS amortizacion_capital,
  d.dpr_intereses                   AS intereses_del_mes,
  d.dpr_mora                        AS mora,
  d.dpr_saldo                       AS saldo_actual,
  (SELECT d2.dpr_saldo
     FROM RPJ_MNT_DETALLE_PRESTAMO d2
    WHERE d2.dpr_id_prestamo = d.dpr_id_prestamo
      AND (d2.dpr_fecha_pago < d.dpr_fecha_pago
           OR (d2.dpr_fecha_pago = d.dpr_fecha_pago AND d2.dpr_correlativo < d.dpr_correlativo))
    ORDER BY d2.dpr_fecha_pago DESC, d2.dpr_correlativo DESC
    LIMIT 1)                        AS saldo_mes_anterior
FROM RPJ_MNT_DETALLE_PRESTAMO d
INNER JOIN RPJ_MNT_PRESTAMO p      ON p.pre_correlativo = d.dpr_id_prestamo
INNER JOIN RPJ_MNT_APORTACION_EPQ a ON a.apo_correlativo = p.pre_id_aportacion
WHERE d.dpr_fecha_pago BETWEEN ? AND ?
ORDER BY a.apo_apellido, a.apo_nombre, d.dpr_fecha_pago;
