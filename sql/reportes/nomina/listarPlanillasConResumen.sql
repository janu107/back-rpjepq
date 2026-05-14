SELECT
  p.ppl_correlativo AS id_planilla,
  p.ppl_numero AS numero_planilla,
  p.ppl_tipo_planilla AS id_tipo_planilla,
  tp.tpl_tipo_planilla,
  tp.tpl_descripcion AS tipo_planilla_descripcion,
  p.ppl_fecha_inicio,
  p.ppl_fecha_final,
  p.ppl_fecha_pago,
  p.ppl_frecuencia,
  p.ppl_estado,
  COALESCE(i.total_ingresos, 0) AS total_ingresos,
  COALESCE(d.total_descuentos, 0) AS total_descuentos,
  COALESCE(i.total_ingresos, 0) - COALESCE(d.total_descuentos, 0) AS liquido
FROM RPJ_CAT_PARAMETRO_PLANILLA p
LEFT JOIN RPJ_CAT_TIPO_PLANILLA tp ON tp.tpl_id = p.ppl_tipo_planilla
LEFT JOIN (
  SELECT nin_id_planilla, SUM(nin_valor) AS total_ingresos
  FROM RPJ_PRC_NOMINA_INGRESO
  GROUP BY nin_id_planilla
) i ON i.nin_id_planilla = p.ppl_correlativo
LEFT JOIN (
  SELECT nde_id_planilla, SUM(nde_valor) AS total_descuentos
  FROM RPJ_PRC_NOMINA_DESCUENTO
  GROUP BY nde_id_planilla
) d ON d.nde_id_planilla = p.ppl_correlativo
ORDER BY p.ppl_correlativo DESC;
