-- Depósitos de una planilla de jubilados por banco y tipo de jubilación.
-- Un renglón por persona a la que se le deposita: cada jubilado (neto = ingresos
-- menos descuentos) y cada beneficiario de un fallecido (a los menores se les
-- deposita en la cuenta de la tutora). banco = banco de la cuenta, o 'CHEQUE' si
-- se le paga con cheque, o NULL si no tiene datos de pago.
-- Params: [idPlanilla, idPlanilla, idPlanilla].
SELECT * FROM (
  SELECT
    CASE WHEN dat.dat_correlativo IS NULL THEN NULL
         WHEN UPPER(dat.dat_forma_pago) = 'CHEQUE' THEN 'CHEQUE'
         ELSE COALESCE(bk.ban_descripcion, 'SIN BANCO') END        AS banco,
    COALESCE(tj.tju_descripcion, 'SIN CLASIFICAR')                  AS tipo_jubilacion,
    j.jub_id                                                        AS codigo,
    CONCAT(j.jub_nombres, ' ', j.jub_apellidos)                     AS nombre,
    NULL                                                            AS detalle,
    IF(UPPER(dat.dat_forma_pago) = 'CHEQUE', NULL, dat.dat_cuenta) AS cuenta,
    dat.dat_tipo_cuenta                                             AS tipo_cuenta,
    ing.valor - COALESCE(des.total, 0)                              AS monto
  FROM (
    SELECT nin_id_jubilado, SUM(nin_valor) AS valor
      FROM RPJ_PRC_NOMINA_INGRESO
     WHERE nin_id_planilla = ? AND nin_id_jubilado IS NOT NULL AND nin_id_beneficiario IS NULL
     GROUP BY nin_id_jubilado
  ) ing
  JOIN RPJ_MNT_JUBILADO j ON j.jub_correlativo = ing.nin_id_jubilado
  LEFT JOIN RPJ_CAT_TIPO_JUBILACION tj ON tj.tju_id = j.jub_tipo_jubilacion
  LEFT JOIN (
    SELECT nde_id_jubilado, SUM(nde_valor) AS total
      FROM RPJ_PRC_NOMINA_DESCUENTO
     WHERE nde_id_planilla = ? AND nde_id_jubilado IS NOT NULL AND nde_id_beneficiario IS NULL
     GROUP BY nde_id_jubilado
  ) des ON des.nde_id_jubilado = j.jub_correlativo
  LEFT JOIN RPJ_MNT_DATOS_PLANILLA dat ON dat.dat_correlativo = (
    SELECT d2.dat_correlativo FROM RPJ_MNT_DATOS_PLANILLA d2
     WHERE d2.dat_id_jubilado = j.jub_correlativo AND d2.dat_tipo_manejo = 2
     ORDER BY d2.dat_correlativo DESC LIMIT 1)
  LEFT JOIN RPJ_CAT_BANCOS bk ON bk.ban_id = dat.dat_id_banco

  UNION ALL

  SELECT
    CASE WHEN COALESCE(t.tut_forma_pago, b.ben_forma_pago) IS NULL THEN NULL
         WHEN UPPER(COALESCE(IF(t.tut_correlativo IS NOT NULL, t.tut_forma_pago, b.ben_forma_pago), '')) = 'CHEQUE' THEN 'CHEQUE'
         ELSE COALESCE(IF(t.tut_correlativo IS NOT NULL, bt.ban_descripcion, bb.ban_descripcion), 'SIN BANCO') END,
    CASE WHEN i.nin_puesto IN ('COBRO DEUDA DEL FALLECIDO', 'VIUDEZ') THEN 'VIUDEZ' ELSE 'ORFANDAD' END,
    j.jub_id,
    IF(t.tut_correlativo IS NOT NULL, TRIM(CONCAT(COALESCE(t.tut_nombres, ''), ' ', t.tut_apellidos)),
       TRIM(CONCAT(COALESCE(b.ben_nombres, ''), ' ', b.ben_apellidos))),
    CONCAT(IF(t.tut_correlativo IS NOT NULL,
              CONCAT('Tutora de ', TRIM(CONCAT(COALESCE(b.ben_nombres, ''), ' ', b.ben_apellidos)), ' · '), ''),
           'Beneficiario de ', j.jub_nombres, ' ', j.jub_apellidos),
    IF(UPPER(COALESCE(IF(t.tut_correlativo IS NOT NULL, t.tut_forma_pago, b.ben_forma_pago), '')) = 'CHEQUE', NULL,
       IF(t.tut_correlativo IS NOT NULL, t.tut_cuenta, b.ben_cuenta)),
    IF(t.tut_correlativo IS NOT NULL, t.tut_tipo_cuenta, b.ben_tipo_cuenta),
    i.nin_valor
  FROM RPJ_PRC_NOMINA_INGRESO i
  JOIN RPJ_MNT_BENEFICIARIO b ON b.ben_correlativo = i.nin_id_beneficiario
  JOIN RPJ_MNT_JUBILADO j ON j.jub_correlativo = i.nin_id_jubilado
  JOIN RPJ_CAT_PARAMETRO_PLANILLA pla ON pla.ppl_correlativo = i.nin_id_planilla
  LEFT JOIN RPJ_MNT_TUTOR t ON t.tut_correlativo = (
    SELECT t2.tut_correlativo FROM RPJ_MNT_TUTOR t2
     WHERE t2.tut_id_beneficiario = b.ben_correlativo AND t2.tut_estado = 'VIGENTE'
       AND b.ben_tipo_parentesco <> 'ESPOSA'
       AND TIMESTAMPDIFF(YEAR, b.ben_fecha_nacimiento, pla.ppl_fecha_inicio) < 18
     ORDER BY t2.tut_correlativo DESC LIMIT 1)
  LEFT JOIN RPJ_CAT_BANCOS bt ON bt.ban_id = t.tut_id_banco
  LEFT JOIN RPJ_CAT_BANCOS bb ON bb.ban_id = b.ben_id_banco
  WHERE i.nin_id_planilla = ? AND i.nin_id_beneficiario IS NOT NULL
) x
WHERE x.monto > 0
ORDER BY x.banco, x.tipo_jubilacion, x.nombre;
