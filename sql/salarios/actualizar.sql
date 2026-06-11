UPDATE RPJ_MNT_SALARIO
SET
  sal_tipo_manejo = ?,
  sal_id_empleado = ?,
  sal_id_jubilado = ?,
  sal_tipo_ingreso = ?,
  sal_salario = ?
WHERE sal_correlativo = ?;
