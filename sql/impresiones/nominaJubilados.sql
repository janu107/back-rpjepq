-- Nómina de jubilados de una planilla, para impresión en oficio.
--
-- Sólo el pago propio del jubilado: los renglones de beneficiarios
-- (nin_id_beneficiario IS NOT NULL) se excluyen, porque este formato lista
-- pensionados por tipo de jubilación.
--
-- Ingresos y descuentos se agregan por separado para no multiplicar renglones.
-- El desglose de descuentos sigue RPJ_CAT_TIPO_DESCUENTO:
--   4 JUDICIAL · 5 PRESTAMO BANRURAL · 6 PRESTAMO BANTRAB
--   7 PRESTAMO REGIMEN y 9 PRESTAMO (genérico) -> "DESC. PREST."
--   8 ASOCIACION
-- Params: [idPlanilla, idPlanilla].
SELECT
  j.jub_correlativo                           AS id_jubilado,
  j.jub_id                                    AS codigo,
  CONCAT(j.jub_nombres, ' ', j.jub_apellidos) AS nombre,
  COALESCE(tj.tju_descripcion, 'SIN CLASIFICAR') AS tipo_jubilacion,
  j.jub_fecha_jubilacion                      AS fecha_jubilacion,
  COALESCE(ing.pension_mensual, 0)            AS pension_mensual,
  COALESCE(des.asociacion, 0)                 AS desc_asociacion,
  COALESCE(des.prestamos, 0)                  AS desc_prestamos,
  COALESCE(des.judicial, 0)                   AS desc_judicial,
  COALESCE(des.banrural, 0)                   AS desc_banrural,
  COALESCE(des.bantrab, 0)                    AS desc_bantrab,
  COALESCE(des.otros, 0)                      AS desc_otros,
  COALESCE(des.total_descuentos, 0)           AS total_descuentos,
  COALESCE(ing.pension_mensual, 0) - COALESCE(des.total_descuentos, 0) AS liquido
FROM RPJ_MNT_JUBILADO j
INNER JOIN (
  SELECT nin_id_jubilado, SUM(nin_valor) AS pension_mensual
    FROM RPJ_PRC_NOMINA_INGRESO
   WHERE nin_id_planilla = ? AND nin_id_jubilado IS NOT NULL AND nin_id_beneficiario IS NULL
   GROUP BY nin_id_jubilado
) ing ON ing.nin_id_jubilado = j.jub_correlativo
LEFT JOIN (
  SELECT nde_id_jubilado,
         SUM(CASE WHEN nde_tipo_descuento = 8 THEN nde_valor ELSE 0 END) AS asociacion,
         SUM(CASE WHEN nde_tipo_descuento IN (7, 9) THEN nde_valor ELSE 0 END) AS prestamos,
         SUM(CASE WHEN nde_tipo_descuento = 4 THEN nde_valor ELSE 0 END) AS judicial,
         SUM(CASE WHEN nde_tipo_descuento = 5 THEN nde_valor ELSE 0 END) AS banrural,
         SUM(CASE WHEN nde_tipo_descuento = 6 THEN nde_valor ELSE 0 END) AS bantrab,
         SUM(CASE WHEN nde_tipo_descuento IN (1, 2, 3) THEN nde_valor ELSE 0 END) AS otros,
         SUM(nde_valor) AS total_descuentos
    FROM RPJ_PRC_NOMINA_DESCUENTO
   WHERE nde_id_planilla = ? AND nde_id_jubilado IS NOT NULL AND nde_id_beneficiario IS NULL
   GROUP BY nde_id_jubilado
) des ON des.nde_id_jubilado = j.jub_correlativo
LEFT JOIN RPJ_CAT_TIPO_JUBILACION tj ON tj.tju_id = j.jub_tipo_jubilacion
ORDER BY tipo_jubilacion, j.jub_apellidos, j.jub_nombres;
