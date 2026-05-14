SELECT
  j.jub_correlativo,
  j.jub_tipo_manejo,
  j.jub_nombres,
  j.jub_apellidos,
  j.jub_dpi,
  j.jub_estado
FROM RPJ_MNT_JUBILADO j
WHERE j.jub_tipo_manejo = ?
  AND UPPER(COALESCE(j.jub_estado, 'ACTIVO')) IN ('ACTIVO', 'ABIERTA')
ORDER BY j.jub_correlativo;
