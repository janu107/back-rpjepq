SELECT
  j.jub_correlativo AS id_jubilado,
  CONCAT(j.jub_nombres, ' ', j.jub_apellidos) AS jubilado_nombre,
  j.jub_dpi,
  p.ppl_correlativo AS id_planilla,
  p.ppl_numero AS numero_planilla,
  tp.tpl_tipo_planilla,
  COALESCE(SUM(i.nin_valor), 0) AS total_ingresos,
  COALESCE((SELECT SUM(d.nde_valor) FROM RPJ_PRC_NOMINA_DESCUENTO d WHERE d.nde_id_jubilado = j.jub_correlativo AND d.nde_id_planilla = COALESCE(?, p.ppl_correlativo)), 0) AS total_descuentos,
  COALESCE(SUM(i.nin_valor), 0)
    - COALESCE((SELECT SUM(d.nde_valor) FROM RPJ_PRC_NOMINA_DESCUENTO d WHERE d.nde_id_jubilado = j.jub_correlativo AND d.nde_id_planilla = COALESCE(?, p.ppl_correlativo)), 0) AS liquido,
  COUNT(i.nin_correlativo) AS cantidad_ingresos,
  COALESCE((SELECT COUNT(*) FROM RPJ_PRC_NOMINA_DESCUENTO d WHERE d.nde_id_jubilado = j.jub_correlativo AND d.nde_id_planilla = COALESCE(?, p.ppl_correlativo)), 0) AS cantidad_descuentos
FROM RPJ_MNT_JUBILADO j
LEFT JOIN RPJ_PRC_NOMINA_INGRESO i ON i.nin_id_jubilado = j.jub_correlativo AND (? IS NULL OR i.nin_id_planilla = ?)
LEFT JOIN RPJ_CAT_PARAMETRO_PLANILLA p ON p.ppl_correlativo = i.nin_id_planilla
LEFT JOIN RPJ_CAT_TIPO_PLANILLA tp ON tp.tpl_id = p.ppl_tipo_planilla
WHERE j.jub_correlativo = ?
GROUP BY j.jub_correlativo, jubilado_nombre, j.jub_dpi, p.ppl_correlativo, p.ppl_numero, tp.tpl_tipo_planilla
ORDER BY p.ppl_correlativo DESC;
