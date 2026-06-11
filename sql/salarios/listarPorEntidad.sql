SELECT
  s.sal_correlativo,
  s.sal_tipo_manejo,
  s.sal_id_empleado,
  s.sal_id_jubilado,
  s.sal_tipo_ingreso,
  s.sal_salario,
  s.sal_fecha_creacion,
  s.sal_usuario_creacion,
  m.man_descripcion AS manejo_descripcion,
  ti.tin_tipo_ingreso,
  ti.tin_descripcion AS tipo_ingreso_descripcion
FROM RPJ_MNT_SALARIO s
LEFT JOIN RPJ_CAT_MANEJO_ADMINISTRACION m ON m.man_id = s.sal_tipo_manejo
LEFT JOIN RPJ_CAT_TIPO_INGRESO ti ON ti.tin_id = s.sal_tipo_ingreso
WHERE s.sal_id_empleado <=> ?
  AND s.sal_id_jubilado <=> ?
ORDER BY s.sal_correlativo ASC;
