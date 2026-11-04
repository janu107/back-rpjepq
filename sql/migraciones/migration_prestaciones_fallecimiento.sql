-- ============================================================================
-- Aguinaldo y bono 14 del fallecido (2026-11-03).
--  * Al registrar el fallecimiento, el sistema agrega a la deuda del fallecido
--    (la cobra el cónyuge) su aguinaldo y bono 14 al 100%:
--      proporcional del período en curso (días hasta la fecha de fallecimiento).
--    Van en la deuda con período especial: AAAA13 = AGUINALDO del año AAAA,
--    AAAA14 = BONO 14 del año AAAA (se cobran después de los meses de pensión).
--  * La cuota mensual del cónyuge (su último líquido) ignora esos renglones.
--  * Viuda y huérfanos: su aguinaldo / bono 14 cuenta los días desde el día
--    siguiente al fallecimiento (antes contaba todo el período).
--  * Forma de cobro de la deuda del fallecido: si el cónyuge tiene un CONVENIO
--    VIGENTE (RPJ_MNT_CONVENIO_PAGO con su con_id_beneficiario), cobra la cuota
--    mensual del convenio (al 100%, hasta lo que falte de la deuda) en vez del
--    % de la planilla sobre el último líquido del fallecido.
-- ============================================================================

DROP PROCEDURE IF EXISTS _pj_generar_beneficiarios;
DELIMITER $$
CREATE PROCEDURE _pj_generar_beneficiarios(
    IN  p_id_planilla   INT,
    IN  p_tipo_planilla INT,
    IN  p_tin           INT,
    IN  p_fecha_ini     DATE,
    IN  p_fecha_fin     DATE,
    IN  p_porcentaje    DECIMAL(5,2),
    IN  p_usuario       VARCHAR(50),
    OUT p_procesados    INT,
    OUT p_total_pagado  DECIMAL(12,2),
    OUT p_resultado     VARCHAR(200)
)
BEGIN
    DECLARE v_tipo_planilla INT;
    DECLARE v_estado_proc   VARCHAR(20);
    DECLARE v_ya            INT DEFAULT 0;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1 @pj_errno = MYSQL_ERRNO, @pj_msg = MESSAGE_TEXT;
        ROLLBACK;
        SET p_procesados = 0;
        SET p_total_pagado = 0.00;
        SET p_resultado = CONCAT('ERROR: ', @pj_errno, ' - ', @pj_msg);
    END;

    SET p_procesados = 0;
    SET p_total_pagado = 0.00;

    SELECT ppl_tipo_planilla, ppl_estado_proceso
      INTO v_tipo_planilla, v_estado_proc
      FROM RPJ_CAT_PARAMETRO_PLANILLA
     WHERE ppl_correlativo = p_id_planilla;

    SELECT COUNT(*) INTO v_ya
      FROM RPJ_PRC_NOMINA_INGRESO
     WHERE nin_id_planilla = p_id_planilla
       AND nin_id_tipo_planilla = p_tipo_planilla
       AND nin_id_beneficiario IS NOT NULL;

    IF v_estado_proc IS NULL THEN
        SET p_resultado = 'ERROR: La planilla no existe.';
    ELSEIF v_tipo_planilla <> p_tipo_planilla THEN
        SET p_resultado = 'ERROR: La planilla no corresponde al tipo de prestacion esperado.';
    ELSEIF v_estado_proc NOT IN ('ABIERTA','GENERADA','REVERSADA') THEN
        SET p_resultado = CONCAT('ERROR: La planilla esta en estado ', v_estado_proc, '; no se puede generar.');
    ELSEIF p_porcentaje IS NULL OR p_porcentaje < 0.01 OR p_porcentaje > 100.00 THEN
        SET p_resultado = 'ERROR: El porcentaje debe estar entre 0.01 y 100.00.';
    ELSEIF v_ya > 0 THEN
        SET p_resultado = 'ERROR: Esta planilla ya tiene registros de beneficiarios. Revierta la planilla completa antes de regenerar.';
    ELSE
        START TRANSACTION;

        INSERT INTO RPJ_PRC_NOMINA_INGRESO (
            nin_tipo_manejo, nin_id_tipo_planilla, nin_id_planilla, nin_id_jubilado, nin_id_beneficiario,
            nin_tipo_ingreso, nin_valor, nin_valor_teorico, nin_porcentaje_aplicado,
            nin_pago_corriente, nin_abono_historico, nin_dias_trabajados,
            nin_puesto, nin_area, nin_usuario_creacion
        )
        SELECT 2, p_tipo_planilla, p_id_planilla, x.jub, x.ben, p_tin,
               ROUND(x.pension * x.dias / 365 * p_porcentaje / 100 * x.ben_pct / 100, 2),
               x.pension, x.ben_pct,
               ROUND(x.pension * x.dias / 365 * p_porcentaje / 100 * x.ben_pct / 100, 2),
               0.00, x.dias,
               'BENEFICIARIO', 'ADMINISTRATIVA', p_usuario
          FROM (
            SELECT j.jub_correlativo AS jub, b.ben_correlativo AS ben, b.ben_porcentaje AS ben_pct,
                   s.sal_salario AS pension,
                   LEAST(365, GREATEST(0,
                     DATEDIFF(p_fecha_fin, GREATEST(p_fecha_ini, COALESCE(j.jub_fecha_jubilacion, p_fecha_ini),
                                                   COALESCE(j.jub_fecha_fallecimiento + INTERVAL 1 DAY, p_fecha_ini))) + 1)) AS dias
              FROM RPJ_MNT_BENEFICIARIO b
              INNER JOIN RPJ_MNT_JUBILADO j
                      ON j.jub_correlativo = b.ben_id_jubilado
                     AND j.jub_tipo_manejo = 2
                     AND j.jub_estado_pago = 'FALLECIDO'
              INNER JOIN RPJ_MNT_SALARIO s
                      ON s.sal_id_jubilado  = j.jub_correlativo
                     AND s.sal_tipo_manejo  = 2
                     AND s.sal_tipo_ingreso = 1
             WHERE b.ben_estado = 'ACTIVO'
          ) x
         WHERE x.dias > 0 AND x.pension > 0 AND x.ben_pct > 0;

        SET p_procesados = ROW_COUNT();

        SELECT COALESCE(SUM(nin_valor), 0) INTO p_total_pagado
          FROM RPJ_PRC_NOMINA_INGRESO
         WHERE nin_id_planilla = p_id_planilla
           AND nin_id_tipo_planilla = p_tipo_planilla
           AND nin_id_beneficiario IS NOT NULL;

        UPDATE RPJ_CAT_PARAMETRO_PLANILLA
           SET ppl_estado_proceso   = 'GENERADA',
               ppl_fecha_generacion = NOW(),
               ppl_usuario_genera   = p_usuario
         WHERE ppl_correlativo = p_id_planilla
           AND ppl_estado_proceso <> 'GENERADA';

        COMMIT;

        SET p_resultado = CONCAT('PROCESO EXITOSO. Beneficiarios: ', p_procesados,
                                 ' procesados. Total: Q', FORMAT(p_total_pagado, 2), '.');
    END IF;
END $$
DELIMITER ;

DROP PROCEDURE IF EXISTS sp_generar_beneficiarios_planilla;
DELIMITER $$
CREATE PROCEDURE sp_generar_beneficiarios_planilla(
    IN  p_id_planilla INT,
    IN  p_usuario     VARCHAR(50),
    OUT p_procesados  INT,
    OUT p_total       DECIMAL(14,2)
)
BEGIN
    DECLARE v_porcentaje  DECIMAL(5,2);
    DECLARE v_fecha_ini   DATE;
    DECLARE v_fecha_fin   DATE;
    DECLARE v_done        BOOLEAN DEFAULT FALSE;
    DECLARE v_id_ben      INT;
    DECLARE v_id_jub      INT;
    DECLARE v_parentesco  VARCHAR(30);
    DECLARE v_pct         DECIMAL(5,2);
    DECLARE v_monto_ben   DECIMAL(12,2);
    DECLARE v_fnac        DATE;
    DECLARE v_pension     DECIMAL(12,2);
    DECLARE v_pend_fall   DECIMAL(14,2);
    DECLARE v_liq_fall    DECIMAL(12,2);
    DECLARE v_id_deu      INT;
    DECLARE v_monto       DECIMAL(12,2);
    DECLARE v_debe        DECIMAL(12,2);
    DECLARE v_teorico     DECIMAL(12,2);
    DECLARE v_concepto    VARCHAR(40);
    DECLARE v_periodo     INT;
    DECLARE v_conv        DECIMAL(12,2);
    DECLARE v_pct_apl     DECIMAL(5,2);

    DECLARE cur CURSOR FOR
        SELECT b.ben_correlativo, b.ben_id_jubilado, UPPER(b.ben_tipo_parentesco), b.ben_porcentaje, b.ben_monto,
               b.ben_fecha_nacimiento, s.pension
          FROM RPJ_MNT_BENEFICIARIO b
          JOIN RPJ_MNT_JUBILADO j ON j.jub_correlativo = b.ben_id_jubilado AND j.jub_estado_pago = 'FALLECIDO'
          JOIN (SELECT sal_id_jubilado, MAX(sal_salario) AS pension
                  FROM RPJ_MNT_SALARIO
                 WHERE sal_tipo_manejo = 2 AND sal_tipo_ingreso = 1 AND sal_salario > 0
                 GROUP BY sal_id_jubilado) s ON s.sal_id_jubilado = j.jub_correlativo
         WHERE b.ben_estado = 'ACTIVO'
           AND (j.jub_fecha_fallecimiento IS NULL OR j.jub_fecha_fallecimiento <= v_fecha_fin)
         ORDER BY b.ben_id_jubilado, b.ben_correlativo;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = TRUE;

    SET p_procesados = 0;
    SET p_total = 0.00;
    SELECT ppl_porcentaje_pago, ppl_fecha_inicio, ppl_fecha_final
      INTO v_porcentaje, v_fecha_ini, v_fecha_fin
      FROM RPJ_CAT_PARAMETRO_PLANILLA WHERE ppl_correlativo = p_id_planilla;
    SET v_periodo = YEAR(v_fecha_ini) * 100 + MONTH(v_fecha_ini);

    DELETE FROM RPJ_PRC_NOMINA_INGRESO WHERE nin_id_planilla = p_id_planilla AND nin_id_beneficiario IS NOT NULL;

    OPEN cur;
    loop_ben: LOOP
        FETCH cur INTO v_id_ben, v_id_jub, v_parentesco, v_pct, v_monto_ben, v_fnac, v_pension;
        IF v_done THEN LEAVE loop_ben; END IF;

        SET v_monto = 0.00; SET v_debe = 0.00; SET v_teorico = 0.00; SET v_id_deu = NULL; SET v_concepto = NULL;
        SET v_conv = NULL; SET v_pct_apl = NULL;

        IF v_parentesco IN ('ESPOSA', 'ESPOSO') THEN
            SET v_pend_fall = 0.00;
            SELECT COALESCE(SUM(deu_monto_pendiente), 0) INTO v_pend_fall
              FROM RPJ_PRC_DEUDA_JUBILADO
             WHERE deu_id_jubilado = v_id_jub AND deu_estado IN ('PENDIENTE','PARCIAL') AND deu_monto_pendiente > 0;
            IF v_pend_fall > 0 THEN
                -- Cobra lo que recibía él: el % de la planilla sobre su último líquido.
                SET v_liq_fall = 0.00;
                SELECT deu_monto_original INTO v_liq_fall
                  FROM RPJ_PRC_DEUDA_JUBILADO WHERE deu_id_jubilado = v_id_jub
                 ORDER BY (MOD(deu_periodo, 100) > 12), (COALESCE(deu_observaciones, '') LIKE '%Proporcional por fallecimiento%'), deu_periodo DESC LIMIT 1;
                SELECT deu_correlativo INTO v_id_deu
                  FROM RPJ_PRC_DEUDA_JUBILADO
                 WHERE deu_id_jubilado = v_id_jub AND deu_estado IN ('PENDIENTE','PARCIAL') AND deu_monto_pendiente > 0
                 ORDER BY deu_periodo ASC LIMIT 1;
                SET v_concepto = 'COBRO DEUDA DEL FALLECIDO';
                SET v_teorico  = v_liq_fall;
                SET v_monto    = LEAST(ROUND(v_liq_fall * v_porcentaje / 100, 2), v_pend_fall);
                -- Por convenio: la cuota mensual acordada, completa.
                SELECT con_monto_cuota INTO v_conv
                  FROM RPJ_MNT_CONVENIO_PAGO
                 WHERE con_id_beneficiario = v_id_ben AND con_estado = 'VIGENTE' AND con_fecha_inicio <= v_fecha_fin
                 ORDER BY con_correlativo DESC LIMIT 1;
                IF v_conv IS NOT NULL AND v_conv > 0 THEN
                    SET v_teorico = v_conv;
                    SET v_monto   = LEAST(v_conv, v_pend_fall);
                    SET v_pct_apl = 100.00;
                END IF;
            ELSEIF v_periodo >= COALESCE(fn_inicio_beneficios(v_id_jub), v_periodo) THEN
                SET v_concepto = 'VIUDEZ';
                SET v_debe     = COALESCE(v_monto_ben, ROUND(v_pension * v_pct / 100, 2));
                SET v_teorico  = v_debe;
                SET v_monto    = ROUND(v_debe * v_porcentaje / 100, 2);
            END IF;
        ELSEIF v_parentesco NOT IN ('HIJO', 'HIJO_INVALIDEZ') THEN
            -- Otros parentescos: solo registro, todavía sin regla de pago.
            SET v_concepto = NULL;
        ELSEIF v_parentesco = 'HIJO' AND TIMESTAMPDIFF(YEAR, v_fnac, v_fecha_ini) >= 18 THEN
            -- Ya es mayor de edad: se le paga de una vez lo que se le debe.
            SELECT COALESCE(SUM(dbe_monto_pendiente), 0) INTO v_monto
              FROM RPJ_PRC_DEUDA_BENEFICIARIO
             WHERE dbe_id_beneficiario = v_id_ben AND dbe_estado IN ('PENDIENTE','PARCIAL');
            SET v_concepto = 'LIQUIDACION ORFANDAD';
        ELSEIF v_periodo >= fn_inicio_beneficios(v_id_jub) THEN
            SET v_concepto = 'ORFANDAD';
            SET v_debe     = COALESCE(v_monto_ben, ROUND(v_pension * v_pct / 100, 2));
            SET v_teorico  = v_debe;
            SET v_monto    = ROUND(v_debe * v_porcentaje / 100, 2);
        END IF;

        IF v_monto > 0 THEN
            INSERT INTO RPJ_PRC_NOMINA_INGRESO
                (nin_tipo_manejo, nin_id_tipo_planilla, nin_id_planilla, nin_id_jubilado, nin_id_beneficiario, nin_tipo_ingreso,
                 nin_valor, nin_valor_teorico, nin_porcentaje_aplicado, nin_pago_corriente, nin_abono_historico,
                 nin_id_deuda_aplicada, nin_dias_trabajados, nin_puesto, nin_area, nin_usuario_creacion)
            VALUES (2, 2, p_id_planilla, v_id_jub, v_id_ben, 1,
                 v_monto, v_teorico, COALESCE(v_pct_apl, IF(v_concepto = 'LIQUIDACION ORFANDAD', 100, v_porcentaje)),
                 IF(v_concepto IN ('VIUDEZ','ORFANDAD'), v_monto, 0), IF(v_concepto IN ('VIUDEZ','ORFANDAD'), 0, v_monto),
                 v_id_deu, 30, v_concepto, 'BENEFICIARIO', p_usuario);
            SET p_procesados = p_procesados + 1;
            SET p_total = p_total + v_monto;
        END IF;

        SET v_done = FALSE;
    END LOOP loop_ben;
    CLOSE cur;
END$$
DELIMITER ;
