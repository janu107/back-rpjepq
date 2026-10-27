-- Nómina de jubilados de una planilla, para impresión en oficio.
--
-- Sólo el pago propio del jubilado: los renglones de beneficiarios
-- (nin_id_beneficiario IS NOT NULL) se excluyen, porque este formato lista
-- pensionados por tipo de jubilación.
--
-- Ingresos y descuentos se agregan por separado para no multiplicar renglones.
-- El desglose de descuentos sigue RPJ_CAT_TIPO_DESCUENTO:
--   4 JUDICIAL · 5 PRESTAMO BANRURAL · 6 PRESTAMO BANTRAB
--   7 PRESTAMO REGIMEN, 9 PRESTAMO (genérico) y 11 PRESTAMO BI -> "DESC. PREST."
--   8 ASOCIACION
-- pension_total   = pensión completa del jubilado (sin el porcentaje).
-- periodo_aplicado / pct_periodo = mes de deuda al que se abona lo pagado y qué
--   porcentaje de ese mes queda cubierto con este pago (ej. 202301 100%). Si aún
--   no se aplicó (planilla generada, se aplica al cerrar) se calcula como quedará.
--   Sin meses atrasados: el mes de la planilla y su porcentaje de pago.
-- Params: [idPlanilla, idPlanilla].
SELECT
  j.jub_correlativo                           AS id_jubilado,
  j.jub_id                                    AS codigo,
  CONCAT(j.jub_nombres, ' ', j.jub_apellidos) AS nombre,
  COALESCE(tj.tju_descripcion, 'SIN CLASIFICAR') AS tipo_jubilacion,
  j.jub_fecha_jubilacion                      AS fecha_jubilacion,
  COALESCE(ing.pension_total, 0)              AS pension_total,
  COALESCE(ing.pension_mensual, 0)            AS pension_mensual,
  COALESCE(des.asociacion, 0)                 AS desc_asociacion,
  COALESCE(des.prestamos, 0)                  AS desc_prestamos,
  COALESCE(des.judicial, 0)                   AS desc_judicial,
  COALESCE(des.banrural, 0)                   AS desc_banrural,
  COALESCE(des.bantrab, 0)                    AS desc_bantrab,
  COALESCE(des.otros, 0)                      AS desc_otros,
  COALESCE(des.total_descuentos, 0)           AS total_descuentos,
  COALESCE(ing.pension_mensual, 0) - COALESCE(des.total_descuentos, 0) AS liquido,
  COALESCE(deu.deu_periodo, pla.ppl_numero)   AS periodo_aplicado,
  CASE
    WHEN deu.deu_correlativo IS NULL THEN pla.ppl_porcentaje_pago
    WHEN EXISTS (SELECT 1 FROM RPJ_PRC_APLICACION_PAGO a
                  WHERE a.apa_id_planilla = ing.nin_id_planilla AND a.apa_id_deuda = deu.deu_correlativo)
      THEN LEAST(100, ROUND(deu.deu_monto_pagado * 100 / NULLIF(deu.deu_monto_original, 0), 0))
    ELSE LEAST(100, ROUND((deu.deu_monto_pagado
           + LEAST(COALESCE(ing.pension_mensual, 0) - COALESCE(des.total_descuentos, 0), deu.deu_monto_pendiente))
           * 100 / NULLIF(deu.deu_monto_original, 0), 0))
  END                                         AS pct_periodo
FROM RPJ_MNT_JUBILADO j
INNER JOIN (
  SELECT nin_id_jubilado, MAX(nin_id_planilla) AS nin_id_planilla, SUM(nin_valor) AS pension_mensual,
         MAX(nin_valor_teorico) AS pension_total, MAX(nin_id_deuda_aplicada) AS id_deuda
    FROM RPJ_PRC_NOMINA_INGRESO
   WHERE nin_id_planilla = ? AND nin_id_jubilado IS NOT NULL AND nin_id_beneficiario IS NULL
   GROUP BY nin_id_jubilado
) ing ON ing.nin_id_jubilado = j.jub_correlativo
LEFT JOIN (
  SELECT nde_id_jubilado,
         SUM(CASE WHEN nde_tipo_descuento = 8 THEN nde_valor ELSE 0 END) AS asociacion,
         SUM(CASE WHEN nde_tipo_descuento IN (7, 9, 11) THEN nde_valor ELSE 0 END) AS prestamos,
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
LEFT JOIN RPJ_PRC_DEUDA_JUBILADO deu ON deu.deu_correlativo = ing.id_deuda
LEFT JOIN RPJ_CAT_PARAMETRO_PLANILLA pla ON pla.ppl_correlativo = ing.nin_id_planilla
ORDER BY tipo_jubilacion, j.jub_apellidos, j.jub_nombres;
