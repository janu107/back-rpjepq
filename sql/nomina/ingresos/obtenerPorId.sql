SELECT
  n.nin_correlativo,
  n.nin_tipo_manejo,
  n.nin_id_tipo_planilla,
  n.nin_id_planilla,
  n.nin_id_empleado,
  n.nin_id_jubilado,
  n.nin_tipo_ingreso,
  n.nin_valor,
  n.nin_dias_trabajados,
  n.nin_puesto,
  n.nin_area,
  n.nin_fecha_creacion,
  n.nin_usuario_creacion,
  m.man_descripcion AS manejo_descripcion,
  tp.tpl_tipo_planilla,
  pp.ppl_numero AS numero_planilla,
  CONCAT(e.emp_nombres, ' ', e.emp_apellidos) AS empleado_nombre,
  CONCAT(j.jub_nombres, ' ', j.jub_apellidos) AS jubilado_nombre,
  ti.tin_tipo_ingreso
FROM RPJ_PRC_NOMINA_INGRESO n
LEFT JOIN RPJ_CAT_MANEJO_ADMINISTRACION m ON m.man_id = n.nin_tipo_manejo
LEFT JOIN RPJ_CAT_TIPO_PLANILLA tp ON tp.tpl_id = n.nin_id_tipo_planilla
LEFT JOIN RPJ_CAT_PARAMETRO_PLANILLA pp ON pp.ppl_correlativo = n.nin_id_planilla
LEFT JOIN RPJ_MNT_EMPLEADO e ON e.emp_correlativo = n.nin_id_empleado
LEFT JOIN RPJ_MNT_JUBILADO j ON j.jub_correlativo = n.nin_id_jubilado
LEFT JOIN RPJ_CAT_TIPO_INGRESO ti ON ti.tin_id = n.nin_tipo_ingreso
WHERE n.nin_correlativo = ?;
