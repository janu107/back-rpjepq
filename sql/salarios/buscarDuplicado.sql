SELECT sal_correlativo
FROM RPJ_MNT_SALARIO
WHERE sal_tipo_manejo = ?
  AND sal_tipo_ingreso = ?
  AND (? IS NULL OR sal_correlativo <> ?);
