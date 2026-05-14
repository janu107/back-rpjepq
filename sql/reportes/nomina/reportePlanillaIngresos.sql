SELECT
  n.nin_correlativo,
  n.nin_tipo_manejo,
  m.man_descripcion AS manejo_descripcion,
  n.nin_id_tipo_planilla,
  tp.tpl_tipo_planilla,
  tp.tpl_descripcion AS tipo_planilla_descripcion,
  n.nin_id_planilla,
  pp.ppl_numero AS numero_planilla,
  pp.ppl_fecha_inicio,
  pp.ppl_fecha_final,
  pp.ppl_fecha_pago,
  pp.ppl_frecuencia,
  pp.ppl_estado,
  n.nin_id_empleado,
  n.nin_id_jubilado,
  CONCAT(e.emp_nombres, ' ', e.emp_apellidos) AS empleado_nombre,
  CONCAT(j.jub_nombres, ' ', j.jub_apellidos) AS jubilado_nombre,
  n.nin_tipo_ingreso,
  ti.tin_tipo_ingreso,
  ti.tin_descripcion AS tipo_ingreso_descripcion,
  n.nin_valor,
  n.nin_dias_trabajados,
  n.nin_puesto,
  n.nin_area,
  n.nin_fecha_creacion
FROM RPJ_PRC_NOMINA_INGRESO n
LEFT JOIN RPJ_CAT_MANEJO_ADMINISTRACION m ON m.man_id = n.nin_tipo_manejo
LEFT JOIN RPJ_CAT_TIPO_PLANILLA tp ON tp.tpl_id = n.nin_id_tipo_planilla
LEFT JOIN RPJ_CAT_PARAMETRO_PLANILLA pp ON pp.ppl_correlativo = n.nin_id_planilla
LEFT JOIN RPJ_MNT_EMPLEADO e ON e.emp_correlativo = n.nin_id_empleado
LEFT JOIN RPJ_MNT_JUBILADO j ON j.jub_correlativo = n.nin_id_jubilado
LEFT JOIN RPJ_CAT_TIPO_INGRESO ti ON ti.tin_id = n.nin_tipo_ingreso
WHERE n.nin_id_planilla = ?
ORDER BY n.nin_correlativo;
