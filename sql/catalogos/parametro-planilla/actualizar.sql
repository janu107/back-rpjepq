UPDATE RPJ_CAT_PARAMETRO_PLANILLA
SET
  ppl_tipo_planilla = ?,
  ppl_numero = ?,
  ppl_fecha_inicio = ?,
  ppl_fecha_final = ?,
  ppl_fecha_pago = ?,
  ppl_frecuencia = ?,
  ppl_estado = ?
WHERE ppl_correlativo = ?;
