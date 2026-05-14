SELECT
  p.ppl_correlativo,
  p.ppl_tipo_planilla,
  p.ppl_numero,
  p.ppl_fecha_inicio,
  p.ppl_fecha_final,
  p.ppl_fecha_pago,
  p.ppl_frecuencia,
  p.ppl_estado,
  t.tpl_tipo_planilla,
  t.tpl_descripcion AS tipo_planilla_descripcion
FROM RPJ_CAT_PARAMETRO_PLANILLA p
LEFT JOIN RPJ_CAT_TIPO_PLANILLA t ON t.tpl_id = p.ppl_tipo_planilla
WHERE p.ppl_correlativo = ?;
