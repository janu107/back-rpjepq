UPDATE RPJ_CAT_PARAMETRO_PLANILLA
SET
  ppl_numero          = ?,
  ppl_fecha_inicio    = ?,
  ppl_fecha_final     = ?,
  ppl_fecha_pago      = ?,
  ppl_porcentaje_pago = ?
WHERE ppl_correlativo = ?
  AND ppl_estado_proceso = 'ABIERTA';
