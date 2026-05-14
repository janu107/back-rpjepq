SELECT
  s.sal_correlativo,
  s.sal_tipo_manejo,
  s.sal_tipo_ingreso,
  s.sal_salario,
  ti.tin_tipo_ingreso,
  ti.tin_descripcion AS tipo_ingreso_descripcion
FROM RPJ_MNT_SALARIO s
LEFT JOIN RPJ_CAT_TIPO_INGRESO ti ON ti.tin_id = s.sal_tipo_ingreso
WHERE s.sal_tipo_manejo = ?
ORDER BY s.sal_correlativo DESC;
