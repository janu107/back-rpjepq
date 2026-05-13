UPDATE RPJ_MNT_DIETA
SET
  die_id_junta_directiva = ?,
  die_fecha_sesion = ?,
  die_fecha_pago = ?,
  die_sesiones_mes = ?,
  die_acta = ?,
  die_valor = ?,
  die_retencion_isr = ?,
  die_liquido = ?,
  die_total = ?
WHERE die_correlativo = ?;
