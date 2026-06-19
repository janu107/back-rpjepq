SELECT
  j.jub_correlativo                                      AS id_jubilado,
  j.jub_dpi                                              AS dpi,
  CONCAT(j.jub_nombres, ' ', j.jub_apellidos)           AS nombre_completo,
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
  dat.dat_cuenta                                        AS cuenta_banco,
  dat.dat_forma_pago                                    AS forma_pago,
  b.ban_descripcion                                     AS banco_nombre
FROM RPJ_PRC_NOMINA_INGRESO ni
INNER JOIN RPJ_MNT_JUBILADO j            ON j.jub_correlativo  = ni.nin_id_jubilado
INNER JOIN RPJ_CAT_PARAMETRO_PLANILLA pp ON pp.ppl_correlativo = ni.nin_id_planilla
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
