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
  COALESCE((SELECT SUM(nin_valor) FROM RPJ_PRC_NOMINA_INGRESO WHERE nin_id_planilla = p.ppl_correlativo), 0) AS total_ingresos,
  COALESCE((SELECT SUM(nde_valor) FROM RPJ_PRC_NOMINA_DESCUENTO WHERE nde_id_planilla = p.ppl_correlativo), 0) AS total_descuentos,
  COALESCE((SELECT SUM(nin_valor) FROM RPJ_PRC_NOMINA_INGRESO WHERE nin_id_planilla = p.ppl_correlativo), 0)
    - COALESCE((SELECT SUM(nde_valor) FROM RPJ_PRC_NOMINA_DESCUENTO WHERE nde_id_planilla = p.ppl_correlativo), 0) AS liquido,
  COALESCE((SELECT COUNT(*) FROM RPJ_PRC_NOMINA_INGRESO WHERE nin_id_planilla = p.ppl_correlativo), 0) AS cantidad_ingresos,
  COALESCE((SELECT COUNT(*) FROM RPJ_PRC_NOMINA_DESCUENTO WHERE nde_id_planilla = p.ppl_correlativo), 0) AS cantidad_descuentos,
  COALESCE((SELECT COUNT(DISTINCT nin_id_empleado) FROM RPJ_PRC_NOMINA_INGRESO WHERE nin_id_planilla = p.ppl_correlativo AND nin_id_empleado IS NOT NULL), 0) AS cantidad_empleados,
  COALESCE((SELECT COUNT(DISTINCT nin_id_jubilado) FROM RPJ_PRC_NOMINA_INGRESO WHERE nin_id_planilla = p.ppl_correlativo AND nin_id_jubilado IS NOT NULL), 0) AS cantidad_jubilados
FROM RPJ_CAT_PARAMETRO_PLANILLA p
LEFT JOIN RPJ_CAT_TIPO_PLANILLA tp ON tp.tpl_id = p.ppl_tipo_planilla
WHERE p.ppl_correlativo = ?;
