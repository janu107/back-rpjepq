-- Prestaciones jubilados: jubilados NORMALES o AMPARISTAS activos que aún no
-- están en la planilla, para el diálogo "Agregar" (jubilado directo).
-- Params: [idPlanilla].
SELECT
  j.jub_correlativo AS id_jubilado,
  j.jub_dpi AS dpi,
  CONCAT(j.jub_nombres, ' ', j.jub_apellidos) AS nombre_completo,
  j.jub_tipo_pago AS tipo_pago,
  j.jub_fecha_jubilacion AS fecha_jubilacion,
  COALESCE(s.sal_salario, 0) AS pension
FROM RPJ_MNT_JUBILADO j
LEFT JOIN RPJ_MNT_SALARIO s ON s.sal_id_jubilado = j.jub_correlativo AND s.sal_tipo_manejo = 2 AND s.sal_tipo_ingreso = 1
WHERE j.jub_tipo_manejo = 2
  AND j.jub_estado = 'ACTIVO'
  AND j.jub_estado_pago = 'ACTIVO'
  AND j.jub_tipo_pago IN ('NORMAL', 'AMPARISTA')
  AND NOT EXISTS (
    SELECT 1 FROM RPJ_PRC_NOMINA_INGRESO ni
     WHERE ni.nin_id_planilla = ? AND ni.nin_id_jubilado = j.jub_correlativo
       AND ni.nin_id_beneficiario IS NULL AND ni.nin_id_tipo_planilla IN (6, 8)
  )
ORDER BY j.jub_apellidos, j.jub_nombres;
