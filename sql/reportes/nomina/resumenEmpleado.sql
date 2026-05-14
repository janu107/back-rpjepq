SELECT
  e.emp_correlativo AS id_empleado,
  CONCAT(e.emp_nombres, ' ', e.emp_apellidos) AS empleado_nombre,
  e.emp_dpi,
  p.ppl_correlativo AS id_planilla,
  p.ppl_numero AS numero_planilla,
  tp.tpl_tipo_planilla,
  COALESCE(SUM(i.nin_valor), 0) AS total_ingresos,
  COALESCE((SELECT SUM(d.nde_valor) FROM RPJ_PRC_NOMINA_DESCUENTO d WHERE d.nde_id_empleado = e.emp_correlativo AND d.nde_id_planilla = COALESCE(?, p.ppl_correlativo)), 0) AS total_descuentos,
  COALESCE(SUM(i.nin_valor), 0)
    - COALESCE((SELECT SUM(d.nde_valor) FROM RPJ_PRC_NOMINA_DESCUENTO d WHERE d.nde_id_empleado = e.emp_correlativo AND d.nde_id_planilla = COALESCE(?, p.ppl_correlativo)), 0) AS liquido,
  COUNT(i.nin_correlativo) AS cantidad_ingresos,
  COALESCE((SELECT COUNT(*) FROM RPJ_PRC_NOMINA_DESCUENTO d WHERE d.nde_id_empleado = e.emp_correlativo AND d.nde_id_planilla = COALESCE(?, p.ppl_correlativo)), 0) AS cantidad_descuentos
FROM RPJ_MNT_EMPLEADO e
LEFT JOIN RPJ_PRC_NOMINA_INGRESO i ON i.nin_id_empleado = e.emp_correlativo AND (? IS NULL OR i.nin_id_planilla = ?)
LEFT JOIN RPJ_CAT_PARAMETRO_PLANILLA p ON p.ppl_correlativo = i.nin_id_planilla
LEFT JOIN RPJ_CAT_TIPO_PLANILLA tp ON tp.tpl_id = p.ppl_tipo_planilla
WHERE e.emp_correlativo = ?
GROUP BY e.emp_correlativo, empleado_nombre, e.emp_dpi, p.ppl_correlativo, p.ppl_numero, tp.tpl_tipo_planilla
ORDER BY p.ppl_correlativo DESC;
