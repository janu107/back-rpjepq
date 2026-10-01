-- Resumen de nómina de jubilados, bloque PENSIONES: nominal y líquido por tipo
-- de jubilación, para una planilla. Params: [idPlanilla, idPlanilla].
SELECT
  COALESCE(tj.tju_descripcion, 'SIN CLASIFICAR') AS tipo_jubilacion,
  COUNT(*)                                       AS cantidad,
  SUM(x.pension_mensual)                         AS nominal,
  SUM(x.pension_mensual) - SUM(x.descuentos)     AS liquido
FROM (
  SELECT ing.nin_id_jubilado AS id_jubilado,
         ing.pension_mensual,
         COALESCE(des.total_descuentos, 0) AS descuentos
    FROM (
      SELECT nin_id_jubilado, SUM(nin_valor) AS pension_mensual
        FROM RPJ_PRC_NOMINA_INGRESO
       WHERE nin_id_planilla = ? AND nin_id_jubilado IS NOT NULL AND nin_id_beneficiario IS NULL
       GROUP BY nin_id_jubilado
    ) ing
    LEFT JOIN (
      SELECT nde_id_jubilado, SUM(nde_valor) AS total_descuentos
        FROM RPJ_PRC_NOMINA_DESCUENTO
       WHERE nde_id_planilla = ? AND nde_id_jubilado IS NOT NULL AND nde_id_beneficiario IS NULL
       GROUP BY nde_id_jubilado
    ) des ON des.nde_id_jubilado = ing.nin_id_jubilado
) x
INNER JOIN RPJ_MNT_JUBILADO j ON j.jub_correlativo = x.id_jubilado
LEFT JOIN RPJ_CAT_TIPO_JUBILACION tj ON tj.tju_id = j.jub_tipo_jubilacion
GROUP BY tipo_jubilacion
ORDER BY tipo_jubilacion;
