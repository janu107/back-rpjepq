SELECT
  d.dju_id,
  d.dju_tipo_manejo,
  d.dju_tipo_persona,
  d.dju_id_persona,
  d.dju_expediente,
  d.dju_juzgado,
  d.dju_monto,
  d.dju_descripcion,
  d.dju_estado,
  d.dju_fecha_creacion,
  d.dju_usuario_creacion,
  m.man_descripcion AS manejo_descripcion,
  CASE
    WHEN d.dju_tipo_persona = 'EMPLEADO' THEN CONCAT(e.emp_nombres, ' ', e.emp_apellidos)
    WHEN d.dju_tipo_persona = 'JUBILADO' THEN CONCAT(j.jub_nombres, ' ', j.jub_apellidos)
    ELSE NULL
  END AS persona_nombre
FROM RPJ_MNT_DESC_JUDICIALES d
LEFT JOIN RPJ_CAT_MANEJO_ADMINISTRACION m ON m.man_id = d.dju_tipo_manejo
LEFT JOIN RPJ_MNT_EMPLEADO e ON d.dju_tipo_persona = 'EMPLEADO' AND e.emp_correlativo = d.dju_id_persona
LEFT JOIN RPJ_MNT_JUBILADO j ON d.dju_tipo_persona = 'JUBILADO' AND j.jub_correlativo = d.dju_id_persona
WHERE d.dju_id = ?;
