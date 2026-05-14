SELECT
  p.pre_correlativo,
  p.pre_cuota_nivelada,
  p.pre_estado,
  a.apo_dpi,
  d.dpr_correlativo,
  d.dpr_fecha_pago,
  d.dpr_descuento_nomina_aportacion,
  d.dpr_cuota_nivelada
FROM RPJ_MNT_PRESTAMO p
INNER JOIN RPJ_MNT_APORTACION_EPQ a ON a.apo_correlativo = p.pre_id_aportacion
LEFT JOIN RPJ_MNT_DETALLE_PRESTAMO d
  ON d.dpr_id_prestamo = p.pre_correlativo
  AND DATE(d.dpr_fecha_pago) BETWEEN ? AND ?
WHERE UPPER(p.pre_estado) IN ('ACTIVO', 'MORA')
ORDER BY p.pre_correlativo;
