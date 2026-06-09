SELECT
  d.dju_correlativo,
  d.dju_tipo_manejo,
  d.dju_id_empleado,
  d.dju_beneficiario,
  d.dju_tipo,
  d.dju_valor,
  d.dju_saldo,
  d.dju_fecha_inicio,
  d.dju_fecha_final,
  d.dju_estado,
  d.dju_fecha_creacion,
  d.dju_usuario_creacion,
  m.man_descripcion AS manejo_descripcion,
  CASE
    WHEN UPPER(m.man_descripcion) LIKE '%JUBILAD%'
      THEN COALESCE(CONCAT(j.jub_nombres, ' ', j.jub_apellidos), CONCAT(e.emp_nombres, ' ', e.emp_apellidos))
    ELSE COALESCE(CONCAT(e.emp_nombres, ' ', e.emp_apellidos), CONCAT(j.jub_nombres, ' ', j.jub_apellidos))
  END AS persona_nombre
FROM RPJ_MNT_DESC_JUDICIALES d
LEFT JOIN RPJ_CAT_MANEJO_ADMINISTRACION m ON m.man_id = d.dju_tipo_manejo
LEFT JOIN RPJ_MNT_EMPLEADO e ON e.emp_correlativo = d.dju_id_empleado
LEFT JOIN RPJ_MNT_JUBILADO j ON j.jub_correlativo = d.dju_id_empleado
ORDER BY d.dju_correlativo DESC;
