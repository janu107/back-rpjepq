-- ============================================================================
-- Orfandad al cumplir 18 (2026-11-04).
--  * El mes en que cumple 18 se paga proporcional: días antes del cumpleaños ÷ 30.
--  * Desde el mes siguiente ya no cobra orfandad. Lo que se le debe lo cobra según
--    su forma de cobro (ben_forma_cobro / convenio):
--      COMPLETO (por defecto): todo de una vez.
--      PORCENTAJE: cada mes el % de la planilla de su monto, hasta saldar.
--      CONVENIO: cuota fija (RPJ_MNT_CONVENIO_PAGO VIGENTE del hijo).
--  * Al cerrar, los meses atrasados de orfandad valen el monto completo (solo el mes
--    de la planilla puede ser proporcional).
-- Idempotente.
-- ============================================================================
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'RPJ_MNT_BENEFICIARIO' AND COLUMN_NAME = 'ben_forma_cobro');
SET @s := IF(@c = 0, 'ALTER TABLE RPJ_MNT_BENEFICIARIO ADD COLUMN ben_forma_cobro VARCHAR(20) NULL', 'SELECT 1');
PREPARE st FROM @s;
EXECUTE st;
DEALLOCATE PREPARE st;

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
    DECLARE v_forma       VARCHAR(20);
    DECLARE v_cumple18    DATE;

    DECLARE cur CURSOR FOR
        SELECT b.ben_correlativo, b.ben_id_jubilado, UPPER(b.ben_tipo_parentesco), b.ben_porcentaje, b.ben_monto,
               b.ben_fecha_nacimiento, s.pension, b.ben_forma_cobro
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
        FETCH cur INTO v_id_ben, v_id_jub, v_parentesco, v_pct, v_monto_ben, v_fnac, v_pension, v_forma;
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
            ELSEIF v_periodo >= COALESCE(fn_inicio_viudez(v_id_ben), v_periodo) THEN
                SET v_concepto = 'VIUDEZ';
                SET v_debe     = COALESCE(v_monto_ben, ROUND(v_pension * v_pct / 100, 2));
                SET v_teorico  = v_debe;
                SET v_monto    = ROUND(v_debe * v_porcentaje / 100, 2);
            END IF;
        ELSEIF v_parentesco NOT IN ('HIJO', 'HIJO_INVALIDEZ') THEN
            -- Otros parentescos: solo registro, todavía sin regla de pago.
            SET v_concepto = NULL;
        ELSEIF v_parentesco = 'HIJO' AND TIMESTAMPDIFF(YEAR, v_fnac, v_fecha_ini) >= 18 THEN
            -- Ya es mayor de edad: lo que se le debe, según su forma de cobro.
            SELECT COALESCE(SUM(dbe_monto_pendiente), 0) INTO v_monto
              FROM RPJ_PRC_DEUDA_BENEFICIARIO
             WHERE dbe_id_beneficiario = v_id_ben AND dbe_estado IN ('PENDIENTE','PARCIAL');
            SELECT con_monto_cuota INTO v_conv
              FROM RPJ_MNT_CONVENIO_PAGO
             WHERE con_id_beneficiario = v_id_ben AND con_estado = 'VIGENTE' AND con_fecha_inicio <= v_fecha_fin
             ORDER BY con_correlativo DESC LIMIT 1;
            IF v_conv IS NOT NULL AND v_conv > 0 THEN
                -- Convenio: cuota fija completa.
                SET v_monto = LEAST(v_conv, v_monto);
                SET v_teorico = v_conv;
                SET v_pct_apl = 100.00;
            ELSEIF v_forma = 'PORCENTAJE' THEN
                -- Por porcentaje: el % de la planilla de su monto mensual.
                SET v_teorico = COALESCE(v_monto_ben, ROUND(v_pension * v_pct / 100, 2));
                SET v_monto = LEAST(ROUND(v_teorico * v_porcentaje / 100, 2), v_monto);
                SET v_pct_apl = v_porcentaje;
            END IF;
            -- Si no: completo, todo de una vez (como antes).
            SET v_concepto = 'LIQUIDACION ORFANDAD';
        ELSEIF v_periodo >= fn_inicio_beneficios(v_id_jub) THEN
            SET v_concepto = 'ORFANDAD';
            SET v_debe     = COALESCE(v_monto_ben, ROUND(v_pension * v_pct / 100, 2));
            -- Mes en que cumple 18: proporcional a los días antes del cumpleaños (mes de 30 días).
            SET v_cumple18 = DATE_ADD(v_fnac, INTERVAL 18 YEAR);
            IF v_parentesco = 'HIJO' AND v_cumple18 BETWEEN v_fecha_ini AND v_fecha_fin THEN
                SET v_debe = ROUND(v_debe * LEAST(DAY(v_cumple18) - 1, 30) / 30, 2);
            END IF;
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

DROP PROCEDURE IF EXISTS sp_cuadrar_beneficiarios_planilla;
DELIMITER $$
CREATE PROCEDURE sp_cuadrar_beneficiarios_planilla(
    IN p_id_planilla INT,
    IN p_usuario     VARCHAR(50)
)
BEGIN
    DECLARE v_periodo    INT;
    DECLARE v_fecha_ini  DATE;
    DECLARE v_fecha_fin  DATE;
    DECLARE v_done       BOOLEAN DEFAULT FALSE;
    DECLARE v_id_ben     INT;
    DECLARE v_id_jub     INT;
    DECLARE v_concepto   VARCHAR(40);
    DECLARE v_valor      DECIMAL(12,2);
    DECLARE v_teorico    DECIMAL(12,2);
    DECLARE v_fallec     DATE;
    DECLARE v_mes        DATE;
    DECLARE v_disponible DECIMAL(12,2);
    DECLARE v_id_deuda   INT;
    DECLARE v_per_deuda  INT;
    DECLARE v_pend       DECIMAL(12,2);
    DECLARE v_abono      DECIMAL(12,2);
    DECLARE v_pct_pla    DECIMAL(5,2);
    DECLARE v_mensual    DECIMAL(12,2);

    DECLARE cur CURSOR FOR
        SELECT i.nin_id_beneficiario, i.nin_id_jubilado, i.nin_puesto, i.nin_valor, i.nin_valor_teorico, j.jub_fecha_fallecimiento
          FROM RPJ_PRC_NOMINA_INGRESO i
          JOIN RPJ_MNT_JUBILADO j ON j.jub_correlativo = i.nin_id_jubilado
         WHERE i.nin_id_planilla = p_id_planilla AND i.nin_id_beneficiario IS NOT NULL
         ORDER BY i.nin_correlativo;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = TRUE;

    SELECT YEAR(ppl_fecha_inicio) * 100 + MONTH(ppl_fecha_inicio), ppl_fecha_inicio, ppl_fecha_final, COALESCE(ppl_porcentaje_pago, 50)
      INTO v_periodo, v_fecha_ini, v_fecha_fin, v_pct_pla
      FROM RPJ_CAT_PARAMETRO_PLANILLA WHERE ppl_correlativo = p_id_planilla;

    -- Deshacer lo aplicado antes por esta planilla (se puede cuadrar más de una vez).
    UPDATE RPJ_PRC_DEUDA_BENEFICIARIO d
      JOIN RPJ_PRC_APLICACION_PAGO_BEN a ON a.apb_id_deuda = d.dbe_correlativo
       SET d.dbe_monto_pagado = d.dbe_monto_pagado - a.apb_monto_aplicado,
           d.dbe_monto_pendiente = d.dbe_monto_pendiente + a.apb_monto_aplicado,
           d.dbe_fecha_saldada = NULL
     WHERE a.apb_id_planilla = p_id_planilla;
    -- El estado se recalcula aparte: en un UPDATE de varias tablas MySQL no
    -- garantiza el orden de las asignaciones.
    UPDATE RPJ_PRC_DEUDA_BENEFICIARIO d
      JOIN RPJ_PRC_APLICACION_PAGO_BEN a ON a.apb_id_deuda = d.dbe_correlativo
       SET d.dbe_estado = CASE WHEN d.dbe_monto_pendiente <= 0 THEN 'PAGADA' WHEN d.dbe_monto_pagado > 0 THEN 'PARCIAL' ELSE 'PENDIENTE' END
     WHERE a.apb_id_planilla = p_id_planilla;
    DELETE FROM RPJ_PRC_APLICACION_PAGO_BEN WHERE apb_id_planilla = p_id_planilla;
    DELETE FROM RPJ_PRC_DEUDA_BENEFICIARIO WHERE dbe_id_planilla = p_id_planilla;
    UPDATE RPJ_PRC_DEUDA_JUBILADO d
      JOIN RPJ_PRC_APLICACION_PAGO a ON a.apa_id_deuda = d.deu_correlativo
       SET d.deu_monto_pagado = d.deu_monto_pagado - a.apa_monto_aplicado,
           d.deu_monto_pendiente = d.deu_monto_pendiente + a.apa_monto_aplicado,
           d.deu_fecha_saldada = NULL
     WHERE a.apa_id_planilla = p_id_planilla AND a.apa_observaciones LIKE 'Beneficiario%';
    -- El estado se recalcula aparte: en un UPDATE de varias tablas MySQL no
    -- garantiza el orden de las asignaciones.
    UPDATE RPJ_PRC_DEUDA_JUBILADO d
      JOIN RPJ_PRC_APLICACION_PAGO a ON a.apa_id_deuda = d.deu_correlativo
       SET d.deu_estado = CASE WHEN d.deu_monto_pendiente <= 0 THEN 'PAGADA' WHEN d.deu_monto_pagado > 0 THEN 'PARCIAL' ELSE 'PENDIENTE' END
     WHERE a.apa_id_planilla = p_id_planilla AND a.apa_observaciones LIKE 'Beneficiario%';
    DELETE FROM RPJ_PRC_APLICACION_PAGO WHERE apa_id_planilla = p_id_planilla AND apa_observaciones LIKE 'Beneficiario%';

    OPEN cur;
    loop_ben: LOOP
        FETCH cur INTO v_id_ben, v_id_jub, v_concepto, v_valor, v_teorico, v_fallec;
        IF v_done THEN LEAVE loop_ben; END IF;
        SET v_disponible = v_valor;

        IF v_concepto = 'COBRO DEUDA DEL FALLECIDO' THEN
            -- Abona a la deuda del fallecido, del mes más viejo al más nuevo.
            loop_fall: WHILE v_disponible > 0 DO
                SET v_id_deuda = NULL; SET v_per_deuda = NULL; SET v_pend = 0;
                SELECT deu_correlativo, deu_periodo, deu_monto_pendiente INTO v_id_deuda, v_per_deuda, v_pend
                  FROM RPJ_PRC_DEUDA_JUBILADO
                 WHERE deu_id_jubilado = v_id_jub AND deu_estado IN ('PENDIENTE','PARCIAL') AND deu_monto_pendiente > 0
                 ORDER BY deu_periodo ASC LIMIT 1;
                IF v_id_deuda IS NULL THEN LEAVE loop_fall; END IF;
                SET v_abono = LEAST(v_disponible, v_pend);
                UPDATE RPJ_PRC_DEUDA_JUBILADO
                   SET deu_monto_pagado = deu_monto_pagado + v_abono,
                       deu_monto_pendiente = deu_monto_pendiente - v_abono,
                       deu_estado = CASE WHEN deu_monto_pendiente <= 0 THEN 'PAGADA' ELSE 'PARCIAL' END,
                       deu_fecha_saldada = CASE WHEN deu_monto_pendiente <= 0 THEN CURDATE() ELSE NULL END
                 WHERE deu_correlativo = v_id_deuda;
                INSERT INTO RPJ_PRC_APLICACION_PAGO
                    (apa_id_planilla, apa_id_jubilado, apa_id_deuda, apa_periodo_deuda, apa_monto_aplicado, apa_fecha_aplicacion, apa_observaciones, apa_usuario_creacion)
                VALUES (p_id_planilla, v_id_jub, v_id_deuda, v_per_deuda, v_abono, CURDATE(), CONCAT('Beneficiario ', v_id_ben, ': abono al periodo ', v_per_deuda), p_usuario);
                SET v_disponible = v_disponible - v_abono;
            END WHILE loop_fall;
        ELSE
            IF v_concepto = 'ORFANDAD' THEN
                -- Meses desde el siguiente al fallecimiento hasta esta planilla (si faltan).
                SET v_per_deuda = COALESCE(fn_inicio_beneficios(v_id_jub), v_periodo);
                SET v_mes = STR_TO_DATE(CONCAT(v_per_deuda, '01'), '%Y%m%d');
                -- Los meses anteriores valen su monto completo; el de esta planilla, lo que se generó
                -- (proporcional si es el mes en que cumple 18).
                SELECT COALESCE(b.ben_monto, ROUND((SELECT MAX(s.sal_salario) FROM RPJ_MNT_SALARIO s
                                                     WHERE s.sal_id_jubilado = b.ben_id_jubilado AND s.sal_tipo_manejo = 2 AND s.sal_tipo_ingreso = 1) * b.ben_porcentaje / 100, 2))
                  INTO v_mensual FROM RPJ_MNT_BENEFICIARIO b WHERE b.ben_correlativo = v_id_ben;
                WHILE YEAR(v_mes) * 100 + MONTH(v_mes) <= v_periodo DO
                    INSERT IGNORE INTO RPJ_PRC_DEUDA_BENEFICIARIO
                        (dbe_id_beneficiario, dbe_id_jubilado, dbe_periodo, dbe_concepto, dbe_id_planilla, dbe_monto_original, dbe_monto_pendiente, dbe_usuario_creacion)
                    VALUES (v_id_ben, v_id_jub, YEAR(v_mes) * 100 + MONTH(v_mes), 'ORFANDAD', p_id_planilla,
                            IF(YEAR(v_mes) * 100 + MONTH(v_mes) < v_periodo, COALESCE(v_mensual, v_teorico), v_teorico),
                            IF(YEAR(v_mes) * 100 + MONTH(v_mes) < v_periodo, COALESCE(v_mensual, v_teorico), v_teorico), p_usuario);
                    SET v_mes = DATE_ADD(v_mes, INTERVAL 1 MONTH);
                END WHILE;
            ELSEIF v_concepto = 'VIUDEZ' THEN
                -- Meses atrasados de viudez (desde su inicio hasta el mes anterior a esta
                -- planilla) que no estén creados: ya recibió el % de la planilla fuera del
                -- sistema, se le debe el resto.
                SET v_mes = STR_TO_DATE(CONCAT(fn_inicio_viudez(v_id_ben), '01'), '%Y%m%d');
                WHILE YEAR(v_mes) * 100 + MONTH(v_mes) < v_periodo DO
                    INSERT IGNORE INTO RPJ_PRC_DEUDA_BENEFICIARIO
                        (dbe_id_beneficiario, dbe_id_jubilado, dbe_periodo, dbe_concepto, dbe_id_planilla, dbe_monto_original, dbe_monto_pagado,
                         dbe_monto_pendiente, dbe_estado, dbe_usuario_creacion)
                    VALUES (v_id_ben, v_id_jub, YEAR(v_mes) * 100 + MONTH(v_mes), 'VIUDEZ', p_id_planilla, v_teorico,
                            ROUND(v_teorico * v_pct_pla / 100, 2), v_teorico - ROUND(v_teorico * v_pct_pla / 100, 2),
                            IF(v_pct_pla >= 100, 'PAGADA', 'PARCIAL'), p_usuario);
                    SET v_mes = DATE_ADD(v_mes, INTERVAL 1 MONTH);
                END WHILE;
                INSERT IGNORE INTO RPJ_PRC_DEUDA_BENEFICIARIO
                    (dbe_id_beneficiario, dbe_id_jubilado, dbe_periodo, dbe_concepto, dbe_id_planilla, dbe_monto_original, dbe_monto_pendiente, dbe_usuario_creacion)
                VALUES (v_id_ben, v_id_jub, v_periodo, 'VIUDEZ', p_id_planilla, v_teorico, v_teorico, p_usuario);
            END IF;

            loop_ben_deuda: WHILE v_disponible > 0 DO
                SET v_id_deuda = NULL; SET v_per_deuda = NULL; SET v_pend = 0;
                SELECT dbe_correlativo, dbe_periodo, dbe_monto_pendiente INTO v_id_deuda, v_per_deuda, v_pend
                  FROM RPJ_PRC_DEUDA_BENEFICIARIO
                 WHERE dbe_id_beneficiario = v_id_ben AND dbe_estado IN ('PENDIENTE','PARCIAL') AND dbe_monto_pendiente > 0
                 ORDER BY dbe_periodo ASC LIMIT 1;
                IF v_id_deuda IS NULL THEN LEAVE loop_ben_deuda; END IF;
                SET v_abono = LEAST(v_disponible, v_pend);
                UPDATE RPJ_PRC_DEUDA_BENEFICIARIO
                   SET dbe_monto_pagado = dbe_monto_pagado + v_abono,
                       dbe_monto_pendiente = dbe_monto_pendiente - v_abono,
                       dbe_estado = CASE WHEN dbe_monto_pendiente <= 0 THEN 'PAGADA' ELSE 'PARCIAL' END,
                       dbe_fecha_saldada = CASE WHEN dbe_monto_pendiente <= 0 THEN CURDATE() ELSE NULL END
                 WHERE dbe_correlativo = v_id_deuda;
                INSERT INTO RPJ_PRC_APLICACION_PAGO_BEN
                    (apb_id_planilla, apb_id_beneficiario, apb_id_deuda, apb_periodo_deuda, apb_monto_aplicado, apb_fecha_aplicacion, apb_usuario_creacion)
                VALUES (p_id_planilla, v_id_ben, v_id_deuda, v_per_deuda, v_abono, CURDATE(), p_usuario);
                SET v_disponible = v_disponible - v_abono;
            END WHILE loop_ben_deuda;
        END IF;

        SET v_done = FALSE;
    END LOOP loop_ben;
    CLOSE cur;

    -- Hijos que ya cumplieron 18 y no deben nada: quedan INACTIVOS.
    UPDATE RPJ_MNT_BENEFICIARIO b
      JOIN RPJ_MNT_JUBILADO j ON j.jub_correlativo = b.ben_id_jubilado AND j.jub_estado_pago = 'FALLECIDO'
       SET b.ben_estado = 'INACTIVO',
           b.ben_fecha_desactivacion = v_fecha_fin,
           b.ben_observaciones = CONCAT(COALESCE(CONCAT(b.ben_observaciones, ' | '), ''), 'Mayor de edad: orfandad terminada en la planilla ', v_periodo)
     WHERE b.ben_estado = 'ACTIVO' AND b.ben_tipo_parentesco = 'HIJO'
       AND TIMESTAMPDIFF(YEAR, b.ben_fecha_nacimiento, v_fecha_ini) >= 18
       AND NOT EXISTS (SELECT 1 FROM RPJ_PRC_DEUDA_BENEFICIARIO d
                        WHERE d.dbe_id_beneficiario = b.ben_correlativo AND d.dbe_estado IN ('PENDIENTE','PARCIAL') AND d.dbe_monto_pendiente > 0);
END$$
DELIMITER ;
