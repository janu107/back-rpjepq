UPDATE RPJ_MNT_PRESTAMO
SET
  pre_id_aportacion = ?,
  pre_no_contrato = ?,
  pre_monto_autorizado = ?,
  pre_cuota_nivelada = ?,
  pre_plazo_meses = ?,
  pre_fecha_inicio = ?,
  pre_fecha_fin = ?,
  pre_total_pagar = ?,
  pre_tasa_interes = ?,
  pre_estado = ?
WHERE pre_correlativo = ?;
