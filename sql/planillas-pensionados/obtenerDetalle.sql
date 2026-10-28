SELECT
  j.jub_correlativo                                      AS id_jubilado,
  j.jub_id                                               AS codigo,
  j.jub_dpi                                              AS dpi,
  -- Renglones de beneficiarios de fallecidos: su nombre y el concepto del pago.
  CASE WHEN ni.nin_id_beneficiario IS NOT NULL
       THEN TRIM(CONCAT(COALESCE(bn.ben_nombres, ''), ' ', bn.ben_apellidos))
       ELSE CONCAT(j.jub_nombres, ' ', j.jub_apellidos) END AS nombre_completo,
  ni.nin_id_beneficiario                                AS id_beneficiario,
  CASE WHEN ni.nin_id_beneficiario IS NOT NULL THEN ni.nin_puesto END AS concepto_beneficiario,
  CASE WHEN ni.nin_id_beneficiario IS NOT NULL THEN CONCAT(j.jub_nombres, ' ', j.jub_apellidos) END AS fallecido,
  j.jub_fecha_jubilacion                                AS fecha_jubilacion,
  COALESCE(ni.nin_valor_teorico,   0)                   AS pension_teorica,
  COALESCE(ni.nin_porcentaje_aplicado, 100)             AS porcentaje_aplicado,
  COALESCE(ni.nin_pago_corriente,  0)                   AS pago_corriente,
  COALESCE(ni.nin_abono_historico, 0)                   AS abono_historico,
  deu.deu_periodo                                       AS periodo_aplicado,
  ni.nin_valor                                          AS total_ingreso,
  COALESCE(da.total_descuentos, 0)                      AS total_descuentos,
  ni.nin_valor - COALESCE(da.total_descuentos, 0)       AS neto_a_pagar,
  pp.ppl_estado_proceso                                 AS estado_planilla,
  -- Beneficiarios: a los menores se les deposita en la cuenta de la tutora.
  CASE WHEN ni.nin_id_beneficiario IS NULL THEN dat.dat_cuenta
       WHEN pagaTutora.tut_correlativo IS NOT NULL THEN pagaTutora.tut_cuenta ELSE bn.ben_cuenta END       AS cuenta_banco,
  CASE WHEN ni.nin_id_beneficiario IS NULL THEN dat.dat_forma_pago
       WHEN pagaTutora.tut_correlativo IS NOT NULL THEN pagaTutora.tut_forma_pago ELSE bn.ben_forma_pago END AS forma_pago,
  CASE WHEN ni.nin_id_beneficiario IS NULL THEN b.ban_descripcion
       WHEN pagaTutora.tut_correlativo IS NOT NULL THEN bt.ban_descripcion ELSE bbn.ban_descripcion END      AS banco_nombre,
  CASE WHEN pagaTutora.tut_correlativo IS NOT NULL
       THEN TRIM(CONCAT(COALESCE(pagaTutora.tut_nombres, ''), ' ', pagaTutora.tut_apellidos)) END             AS pagar_a
FROM RPJ_PRC_NOMINA_INGRESO ni
INNER JOIN RPJ_MNT_JUBILADO j            ON j.jub_correlativo  = ni.nin_id_jubilado
INNER JOIN RPJ_CAT_PARAMETRO_PLANILLA pp ON pp.ppl_correlativo = ni.nin_id_planilla
LEFT JOIN  RPJ_MNT_BENEFICIARIO bn       ON bn.ben_correlativo = ni.nin_id_beneficiario
LEFT JOIN  RPJ_MNT_TUTOR pagaTutora
       ON pagaTutora.tut_correlativo = (
            SELECT t2.tut_correlativo FROM RPJ_MNT_TUTOR t2
             WHERE t2.tut_id_beneficiario = bn.ben_correlativo AND t2.tut_estado = 'VIGENTE'
               AND bn.ben_tipo_parentesco <> 'ESPOSA'
               AND TIMESTAMPDIFF(YEAR, bn.ben_fecha_nacimiento, pp.ppl_fecha_inicio) < 18
             ORDER BY t2.tut_correlativo DESC LIMIT 1)
LEFT JOIN  RPJ_CAT_BANCOS bt             ON bt.ban_id = pagaTutora.tut_id_banco
LEFT JOIN  RPJ_CAT_BANCOS bbn            ON bbn.ban_id = bn.ben_id_banco
LEFT JOIN  RPJ_PRC_DEUDA_JUBILADO deu    ON deu.deu_correlativo = ni.nin_id_deuda_aplicada
LEFT JOIN  RPJ_MNT_DATOS_PLANILLA dat
       ON dat.dat_correlativo = (
            SELECT d2.dat_correlativo FROM RPJ_MNT_DATOS_PLANILLA d2
            WHERE d2.dat_id_jubilado = j.jub_correlativo AND d2.dat_tipo_manejo = 2
            ORDER BY d2.dat_correlativo DESC LIMIT 1
          )
LEFT JOIN  RPJ_CAT_BANCOS b              ON b.ban_id = dat.dat_id_banco
LEFT JOIN (
  SELECT nde_id_planilla, nde_id_jubilado, SUM(nde_valor) AS total_descuentos
  FROM RPJ_PRC_NOMINA_DESCUENTO
  WHERE nde_id_jubilado IS NOT NULL
  GROUP BY nde_id_planilla, nde_id_jubilado
) da ON da.nde_id_planilla = ni.nin_id_planilla AND da.nde_id_jubilado = ni.nin_id_jubilado
WHERE ni.nin_id_jubilado IS NOT NULL
  AND ni.nin_tipo_manejo = 2
  AND ni.nin_id_planilla = ?
ORDER BY nombre_completo ASC;
