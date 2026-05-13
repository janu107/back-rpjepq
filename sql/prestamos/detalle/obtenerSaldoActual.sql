SELECT COALESCE(dpr_saldo, 0) AS saldo_actual
FROM RPJ_MNT_DETALLE_PRESTAMO
WHERE dpr_id_prestamo = ?
ORDER BY dpr_fecha_pago DESC, dpr_correlativo DESC
LIMIT 1;
