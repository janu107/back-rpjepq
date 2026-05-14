SELECT
  t.tex_correlativo,
  t.tex_id_empleado,
  t.tex_fecha_hora_inicio,
  t.tex_fecha_hora_final,
  t.tex_cantidad_horas,
  t.tex_tipo_hora,
  pg.par_porcentaje_tiempo_extra,
  s.sal_tipo_ingreso,
  s.sal_salario
FROM RPJ_MNT_TIEMPO_EXTRAORDINARIO t
INNER JOIN RPJ_MNT_EMPLEADO e ON e.emp_correlativo = t.tex_id_empleado
LEFT JOIN RPJ_CAT_PARAMETRO_GENERAL pg ON pg.par_id = (SELECT MAX(par_id) FROM RPJ_CAT_PARAMETRO_GENERAL)
LEFT JOIN RPJ_MNT_SALARIO s ON s.sal_tipo_manejo = e.emp_tipo_manejo
WHERE e.emp_tipo_manejo = ?
  AND DATE(t.tex_fecha_hora_inicio) BETWEEN ? AND ?
ORDER BY t.tex_correlativo;
