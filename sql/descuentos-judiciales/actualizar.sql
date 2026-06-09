UPDATE RPJ_MNT_DESC_JUDICIALES
SET
  dju_tipo_manejo = ?,
  dju_id_empleado = ?,
  dju_beneficiario = ?,
  dju_tipo = ?,
  dju_valor = ?,
  dju_saldo = ?,
  dju_fecha_inicio = ?,
  dju_fecha_final = ?,
  dju_estado = ?
WHERE dju_correlativo = ?;
