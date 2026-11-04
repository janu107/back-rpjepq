-- Nómina de deuda de fallecidos: lo que cada cónyuge cobra en la planilla de
-- jubilados para abonar a la deuda del jubilado fallecido (renglones
-- 'COBRO DEUDA DEL FALLECIDO'). Params: [idPlanilla].
SELECT
  i.nin_id_planilla                                   AS id_planilla,
  j.jub_correlativo                                   AS id_jubilado,
  j.jub_id                                            AS codigo,
  CONCAT(j.jub_nombres, ' ', j.jub_apellidos)         AS nombre_fallecido,
  j.jub_fecha_fallecimiento                           AS fecha_fallecimiento,
  b.ben_correlativo                                   AS id_beneficiario,
  TRIM(CONCAT(COALESCE(b.ben_nombres, ''), ' ', b.ben_apellidos)) AS nombre_conyuge,
  b.ben_tipo_parentesco                               AS parentesco,
  b.ben_forma_pago                                    AS forma_pago,
  bb.ban_descripcion                                  AS banco,
  b.ben_cuenta                                        AS cuenta,
  i.nin_valor                                         AS monto,
  i.nin_valor_teorico                                 AS teorico,
  i.nin_porcentaje_aplicado                           AS porcentaje,
  (SELECT c.con_no_documento FROM RPJ_MNT_CONVENIO_PAGO c
    WHERE c.con_id_beneficiario = b.ben_correlativo AND c.con_estado = 'VIGENTE'
    ORDER BY c.con_correlativo DESC LIMIT 1)          AS convenio_documento
FROM RPJ_PRC_NOMINA_INGRESO i
JOIN RPJ_MNT_BENEFICIARIO b ON b.ben_correlativo = i.nin_id_beneficiario
JOIN RPJ_MNT_JUBILADO j ON j.jub_correlativo = i.nin_id_jubilado
LEFT JOIN RPJ_CAT_BANCOS bb ON bb.ban_id = b.ben_id_banco
WHERE i.nin_id_planilla = ? AND i.nin_puesto = 'COBRO DEUDA DEL FALLECIDO'
ORDER BY nombre_fallecido;
