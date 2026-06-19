UPDATE RPJ_MNT_PRESTAMOS_REGIMEN
SET
  prr_tipo_manejo = ?,
  prr_id_empleado = ?,
  prr_id_jubilado = ?,
  prr_id_banco = ?,
  prr_no_referencia = ?,
  prr_monto = ?,
  prr_valor_mes = ?,
  prr_saldo = ?,
  prr_no_cuotas = ?,
  prr_fecha_inicio = ?,
  prr_fecha_fin = ?,
  prr_uso = ?,
  prr_estado = ?
WHERE prr_correlativo = ?;
