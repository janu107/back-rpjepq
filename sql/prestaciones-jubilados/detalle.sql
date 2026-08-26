-- Prestaciones jubilados: detalle completo de una planilla, con categoria
-- calculada igual que la seccion 6.5 del documento (BENEFICIARIOS / AMPARISTAS /
-- JUBILADOS NORMALES), lista para que el frontend arme los tabs sin pedir 4
-- endpoints distintos. Params: [idPlanilla].
SELECT
  ni.nin_correlativo   AS id_linea,
  ni.nin_id_jubilado   AS id_jubilado,
  ni.nin_id_beneficiario AS id_beneficiario,
  CASE
    WHEN ni.nin_id_beneficiario IS NOT NULL THEN CONCAT(b.ben_nombres, ' ', b.ben_apellidos)
    ELSE CONCAT(j.jub_nombres, ' ', j.jub_apellidos)
  END AS nombre_completo,
  CASE
    WHEN ni.nin_id_beneficiario IS NOT NULL THEN b.ben_dpi
    ELSE j.jub_dpi
  END AS dpi,
  CASE
    WHEN ni.nin_id_beneficiario IS NOT NULL THEN 'BENEFICIARIOS'
    WHEN j.jub_tipo_pago = 'AMPARISTA' THEN 'AMPARISTAS'
    ELSE 'JUBILADOS NORMALES'
  END AS categoria,
  CONCAT(j.jub_nombres, ' ', j.jub_apellidos) AS jubilado_titular,
  tj.tju_descripcion   AS tipo_jubilacion,
  ni.nin_dias_trabajados AS dias,
  ni.nin_valor_teorico AS pension_base,
  ni.nin_porcentaje_aplicado AS porcentaje,
  ni.nin_valor         AS monto,
  ni.nin_usuario_creacion AS usuario,
  ni.nin_fecha_creacion   AS fecha
FROM RPJ_PRC_NOMINA_INGRESO ni
INNER JOIN RPJ_MNT_JUBILADO j ON j.jub_correlativo = ni.nin_id_jubilado
LEFT JOIN RPJ_MNT_BENEFICIARIO b ON b.ben_correlativo = ni.nin_id_beneficiario
LEFT JOIN RPJ_CAT_TIPO_JUBILACION tj ON tj.tju_id = j.jub_tipo_jubilacion
WHERE ni.nin_id_planilla = ?
  AND ni.nin_id_tipo_planilla IN (6, 8)
  AND ni.nin_tipo_manejo = 2
ORDER BY categoria, nombre_completo;
