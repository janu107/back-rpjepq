UPDATE RPJ_MNT_SALARIO
SET
  sal_tipo_manejo = ?,
  sal_tipo_ingreso = ?,
  sal_salario = ?
WHERE sal_correlativo = ?;
