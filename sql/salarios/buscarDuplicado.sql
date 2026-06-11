SELECT sal_correlativo
FROM RPJ_MNT_SALARIO
WHERE sal_tipo_manejo = ?
  AND sal_tipo_ingreso = ?
  AND sal_id_empleado <=> ?
  AND sal_id_jubilado <=> ?
  AND (? IS NULL OR sal_correlativo <> ?);
