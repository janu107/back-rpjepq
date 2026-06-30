SELECT
  t.tex_correlativo,
  t.tex_id_empleado,
  t.tex_fecha_hora_inicio,
  t.tex_fecha_hora_final,
  t.tex_cantidad_horas,
  t.tex_motivo,
  t.tex_tipo_hora,
  t.tex_fecha_pago,
  t.tex_fecha_creacion,
  t.tex_usuario_creacion,
  e.emp_id,
  e.emp_nombres,
  e.emp_apellidos,
  e.emp_dpi
FROM RPJ_MNT_TIEMPO_EXTRAORDINARIO t
LEFT JOIN RPJ_MNT_EMPLEADO e ON e.emp_correlativo = t.tex_id_empleado
WHERE t.tex_correlativo = ?;
