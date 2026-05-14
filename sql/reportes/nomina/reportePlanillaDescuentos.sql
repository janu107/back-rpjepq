SELECT
  n.nde_correlativo,
  n.nde_tipo_manejo,
  m.man_descripcion AS manejo_descripcion,
  n.nde_id_tipo_planilla,
  tp.tpl_tipo_planilla,
  tp.tpl_descripcion AS tipo_planilla_descripcion,
  n.nde_id_planilla,
  pp.ppl_numero AS numero_planilla,
  pp.ppl_fecha_inicio,
  pp.ppl_fecha_final,
  pp.ppl_fecha_pago,
  pp.ppl_frecuencia,
  pp.ppl_estado,
  n.nde_id_empleado,
  n.nde_id_jubilado,
  CONCAT(e.emp_nombres, ' ', e.emp_apellidos) AS empleado_nombre,
  CONCAT(j.jub_nombres, ' ', j.jub_apellidos) AS jubilado_nombre,
  n.nde_tipo_descuento,
  td.tde_tipo_descuento,
  td.tde_descripcion AS tipo_descuento_descripcion,
  n.nde_valor,
  n.nde_dias_trabajados,
  n.nde_puesto,
  n.nde_area,
  n.nde_fecha_creacion
FROM RPJ_PRC_NOMINA_DESCUENTO n
LEFT JOIN RPJ_CAT_MANEJO_ADMINISTRACION m ON m.man_id = n.nde_tipo_manejo
LEFT JOIN RPJ_CAT_TIPO_PLANILLA tp ON tp.tpl_id = n.nde_id_tipo_planilla
LEFT JOIN RPJ_CAT_PARAMETRO_PLANILLA pp ON pp.ppl_correlativo = n.nde_id_planilla
LEFT JOIN RPJ_MNT_EMPLEADO e ON e.emp_correlativo = n.nde_id_empleado
LEFT JOIN RPJ_MNT_JUBILADO j ON j.jub_correlativo = n.nde_id_jubilado
LEFT JOIN RPJ_CAT_TIPO_DESCUENTO td ON td.tde_id = n.nde_tipo_descuento
WHERE n.nde_id_planilla = ?
ORDER BY n.nde_correlativo;
