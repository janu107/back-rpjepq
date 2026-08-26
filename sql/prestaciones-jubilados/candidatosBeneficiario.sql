-- Prestaciones jubilados: beneficiarios activos de jubilados fallecidos que
-- aún no están en la planilla, para el diálogo "Agregar" (beneficiario).
-- Params: [idPlanilla].
SELECT
  b.ben_correlativo AS id_beneficiario,
  b.ben_id_jubilado AS id_jubilado,
  b.ben_dpi AS dpi,
  CONCAT(b.ben_nombres, ' ', b.ben_apellidos) AS nombre_completo,
  b.ben_tipo_parentesco AS parentesco,
  b.ben_porcentaje AS porcentaje,
  CONCAT(j.jub_nombres, ' ', j.jub_apellidos) AS jubilado_titular,
  COALESCE(s.sal_salario, 0) AS pension
FROM RPJ_MNT_BENEFICIARIO b
INNER JOIN RPJ_MNT_JUBILADO j ON j.jub_correlativo = b.ben_id_jubilado AND j.jub_tipo_manejo = 2 AND j.jub_estado_pago = 'FALLECIDO'
LEFT JOIN RPJ_MNT_SALARIO s ON s.sal_id_jubilado = j.jub_correlativo AND s.sal_tipo_manejo = 2 AND s.sal_tipo_ingreso = 1
WHERE b.ben_estado = 'ACTIVO'
  AND NOT EXISTS (
    SELECT 1 FROM RPJ_PRC_NOMINA_INGRESO ni
     WHERE ni.nin_id_planilla = ? AND ni.nin_id_beneficiario = b.ben_correlativo
       AND ni.nin_id_tipo_planilla IN (6, 8)
  )
ORDER BY j.jub_apellidos, b.ben_apellidos;
