-- ============================================================================
-- MIGRACIÓN — Cierre prematuro del cursor en los SP de nómina de jubilados
-- Base de datos : apps_rpjepq
--
-- SÍNTOMA: la nómina procesaba un solo jubilado aunque hubiera varios aptos.
--
-- CAUSA: los tres SP usan
--     DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = TRUE;
-- para detectar el fin del cursor, pero ese handler también se dispara con
-- cualquier SELECT ... INTO sin filas dentro del ciclo. La consulta de deuda
-- pendiente no encuentra filas para la mayoría de jubilados, así que marcaba
-- v_done = TRUE y el ciclo salía tras el PRIMER jubilado sin deuda.
--
-- CORRECCIÓN: reponer v_done = FALSE al final del cuerpo del ciclo, para que
-- sólo el FETCH pueda terminarlo. La lógica de montos no se toca: el cuerpo de
-- cada SP se tomó tal cual de la base (ver scripts/generarFixCursorNomina.js).
--
-- Generado automáticamente. Idempotente: se puede volver a correr.
-- ============================================================================

USE `apps_rpjepq`;

SELECT 'Corrigiendo cursores de nomina de jubilados' AS etapa;
DROP PROCEDURE IF EXISTS sp_generar_nomina_pensionados;
DELIMITER $$

CREATE PROCEDURE sp_generar_nomina_pensionados(
    IN p_id_planilla int(11),
    IN p_tipo_ingreso int(11),
    IN p_usuario varchar(50),
    OUT p_procesados int(11),
    OUT p_excluidos int(11),
    OUT p_total_pagado decimal(12,2),
    OUT p_total_desc decimal(12,2)
)
BEGIN
    DECLARE v_tin_pension       INT DEFAULT 1;
    DECLARE v_porcentaje        DECIMAL(5,2);
    DECLARE v_estado_proc       VARCHAR(20);
    DECLARE v_fecha_inicio      DATE;
    DECLARE v_fecha_final       DATE;
    DECLARE v_dias_periodo      INT;

    DECLARE v_id_jubilado       INT;
    DECLARE v_pension           DECIMAL(12,2);
    DECLARE v_fecha_jubilacion  DATE;
    DECLARE v_done              BOOLEAN DEFAULT FALSE;

    DECLARE v_aplica_nomina     BOOLEAN;
    DECLARE v_aplica_igss       BOOLEAN;
    DECLARE v_aplica_isr        BOOLEAN;
    DECLARE v_aplica_intecap    BOOLEAN;
    DECLARE v_aplica_asociacion BOOLEAN;
    DECLARE v_tiene_datos       INT;

    DECLARE v_pct_igss          DECIMAL(5,2);
    DECLARE v_pct_isr           DECIMAL(5,2);
    DECLARE v_pct_intecap       DECIMAL(5,2);
    DECLARE v_monto_asociacion  DECIMAL(10,2);

    DECLARE v_dias_trabajados   INT;
    DECLARE v_factor_dias       DECIMAL(10,6);
    DECLARE v_pago_corriente    DECIMAL(12,2);
    DECLARE v_abono             DECIMAL(12,2);
    DECLARE v_total_ind         DECIMAL(12,2);
    DECLARE v_pension_proporcional DECIMAL(12,2);

    DECLARE v_id_deuda_vieja    INT;
    DECLARE v_periodo_deuda     INT;
    DECLARE v_pendiente_deuda   DECIMAL(12,2);

    
    DECLARE cur_jub CURSOR FOR
        SELECT j.jub_correlativo, s.sal_salario, j.jub_fecha_jubilacion
          FROM RPJ_MNT_JUBILADO j
          INNER JOIN RPJ_MNT_SALARIO s
                  ON s.sal_id_jubilado  = j.jub_correlativo
                 AND s.sal_tipo_manejo  = 2
                 AND s.sal_tipo_ingreso = 1
         WHERE j.jub_tipo_manejo   = 2
           AND j.jub_estado        = 'ACTIVO'
           AND j.jub_tipo_pago     = 'NORMAL'
           AND j.jub_estado_pago   = 'ACTIVO';

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = TRUE;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

    SET p_procesados   = 0;
    SET p_excluidos    = 0;
    SET p_total_pagado = 0.00;
    SET p_total_desc   = 0.00;
    SET v_tin_pension  = IF(p_tipo_ingreso IS NOT NULL AND p_tipo_ingreso > 0, p_tipo_ingreso, 1);

    SELECT ppl_porcentaje_pago, ppl_estado_proceso, ppl_fecha_inicio, ppl_fecha_final
      INTO v_porcentaje, v_estado_proc, v_fecha_inicio, v_fecha_final
      FROM RPJ_CAT_PARAMETRO_PLANILLA
     WHERE ppl_correlativo = p_id_planilla;

    IF v_estado_proc IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Planilla no encontrada';
    END IF;
    IF v_estado_proc NOT IN ('ABIERTA', 'REVERSADA') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Solo se puede generar nomina si la planilla esta ABIERTA o REVERSADA';
    END IF;

    SET v_dias_periodo = DATEDIFF(v_fecha_final, v_fecha_inicio) + 1;

    SELECT par_igss, par_isr, par_intecap, par_desc_asociacion
      INTO v_pct_igss, v_pct_isr, v_pct_intecap, v_monto_asociacion
      FROM RPJ_CAT_PARAMETRO_GENERAL
     ORDER BY par_id DESC LIMIT 1;

    START TRANSACTION;

    
    UPDATE RPJ_PRC_DEUDA_JUBILADO d
     INNER JOIN RPJ_PRC_APLICACION_PAGO a ON a.apa_id_deuda = d.deu_correlativo
       SET d.deu_monto_pagado    = d.deu_monto_pagado    - a.apa_monto_aplicado,
           d.deu_monto_pendiente = d.deu_monto_pendiente + a.apa_monto_aplicado,
           d.deu_estado = CASE WHEN d.deu_monto_pagado - a.apa_monto_aplicado <= 0 THEN 'PENDIENTE' ELSE 'PARCIAL' END,
           d.deu_fecha_saldada = NULL
     WHERE a.apa_id_planilla = p_id_planilla;
    DELETE FROM RPJ_PRC_APLICACION_PAGO WHERE apa_id_planilla = p_id_planilla;
    DELETE FROM RPJ_PRC_NOMINA_DESCUENTO WHERE nde_id_planilla = p_id_planilla AND nde_tipo_manejo = 2;
    DELETE FROM RPJ_PRC_NOMINA_INGRESO   WHERE nin_id_planilla = p_id_planilla AND nin_tipo_manejo = 2;

    OPEN cur_jub;
    loop_jub: LOOP
        FETCH cur_jub INTO v_id_jubilado, v_pension, v_fecha_jubilacion;
        IF v_done THEN LEAVE loop_jub; END IF;

        SET v_aplica_nomina = FALSE; SET v_aplica_igss = FALSE; SET v_aplica_isr = FALSE;
        SET v_aplica_intecap = FALSE; SET v_aplica_asociacion = FALSE; SET v_tiene_datos = 0;

        SELECT COUNT(*), MAX(dat_aplica_nomina), MAX(dat_aplica_desc_igss), MAX(dat_aplica_desc_isr),
               MAX(dat_aplica_intecap), MAX(dat_aplica_dasociacion)
          INTO v_tiene_datos, v_aplica_nomina, v_aplica_igss, v_aplica_isr, v_aplica_intecap, v_aplica_asociacion
          FROM RPJ_MNT_DATOS_PLANILLA
         WHERE dat_id_jubilado = v_id_jubilado AND dat_tipo_manejo = 2;

        IF v_tiene_datos = 0 OR v_aplica_nomina = FALSE THEN
            SET p_excluidos = p_excluidos + 1;
        ELSE
            IF v_fecha_jubilacion >= v_fecha_inicio AND v_fecha_jubilacion <= v_fecha_final THEN
                SET v_dias_trabajados = DATEDIFF(v_fecha_final, v_fecha_jubilacion) + 1;
                SET v_factor_dias     = v_dias_trabajados / v_dias_periodo;
            ELSE
                SET v_dias_trabajados = v_dias_periodo;
                SET v_factor_dias     = 1.0;
            END IF;

            SET v_pension_proporcional = ROUND(v_pension * v_factor_dias, 2);
            SET v_pago_corriente = ROUND(v_pension_proporcional * v_porcentaje / 100, 2);

            SET v_id_deuda_vieja = NULL; SET v_abono = 0.00; SET v_periodo_deuda = NULL; SET v_pendiente_deuda = 0.00;
            SELECT deu_correlativo, deu_periodo, deu_monto_pendiente
              INTO v_id_deuda_vieja, v_periodo_deuda, v_pendiente_deuda
              FROM RPJ_PRC_DEUDA_JUBILADO
             WHERE deu_id_jubilado = v_id_jubilado AND deu_estado IN ('PENDIENTE','PARCIAL')
             ORDER BY deu_periodo ASC LIMIT 1;

            IF v_id_deuda_vieja IS NOT NULL THEN
                SET v_abono = LEAST(v_pago_corriente, v_pendiente_deuda);
                UPDATE RPJ_PRC_DEUDA_JUBILADO
                   SET deu_monto_pagado    = deu_monto_pagado + v_abono,
                       deu_monto_pendiente = deu_monto_pendiente - v_abono,
                       deu_estado = CASE WHEN deu_monto_pendiente - v_abono <= 0 THEN 'PAGADA' ELSE 'PARCIAL' END,
                       deu_fecha_saldada = CASE WHEN deu_monto_pendiente - v_abono <= 0 THEN CURDATE() ELSE NULL END
                 WHERE deu_correlativo = v_id_deuda_vieja;
                INSERT INTO RPJ_PRC_APLICACION_PAGO
                    (apa_id_planilla, apa_id_jubilado, apa_id_deuda, apa_periodo_deuda, apa_monto_aplicado, apa_fecha_aplicacion, apa_observaciones, apa_usuario_creacion)
                VALUES (p_id_planilla, v_id_jubilado, v_id_deuda_vieja, v_periodo_deuda, v_abono, CURDATE(), CONCAT('Abono al periodo ', v_periodo_deuda), p_usuario);
            END IF;

            SET v_total_ind = v_pago_corriente + v_abono;

            INSERT INTO RPJ_PRC_NOMINA_INGRESO
                (nin_tipo_manejo, nin_id_tipo_planilla, nin_id_planilla, nin_id_jubilado, nin_tipo_ingreso,
                 nin_valor, nin_valor_teorico, nin_porcentaje_aplicado, nin_pago_corriente, nin_abono_historico,
                 nin_id_deuda_aplicada, nin_dias_trabajados, nin_puesto, nin_area, nin_usuario_creacion)
            VALUES (2, 2, p_id_planilla, v_id_jubilado, v_tin_pension,
                 v_total_ind, v_pension, v_porcentaje, v_pago_corriente, v_abono,
                 v_id_deuda_vieja, v_dias_trabajados, 'JUBILADO', 'ADMINISTRATIVA', p_usuario);

            
            IF v_aplica_igss = TRUE AND v_pct_igss > 0 THEN
                INSERT INTO RPJ_PRC_NOMINA_DESCUENTO (nde_tipo_manejo, nde_id_tipo_planilla, nde_id_planilla, nde_id_jubilado, nde_tipo_descuento, nde_valor, nde_dias_trabajados, nde_puesto, nde_area, nde_usuario_creacion)
                VALUES (2, 2, p_id_planilla, v_id_jubilado, 1, ROUND(v_pension_proporcional * v_pct_igss / 100, 2), v_dias_trabajados, 'JUBILADO', 'ADMINISTRATIVA', p_usuario);
            END IF;
            
            IF v_aplica_isr = TRUE AND v_pct_isr > 0 THEN
                INSERT INTO RPJ_PRC_NOMINA_DESCUENTO (nde_tipo_manejo, nde_id_tipo_planilla, nde_id_planilla, nde_id_jubilado, nde_tipo_descuento, nde_valor, nde_dias_trabajados, nde_puesto, nde_area, nde_usuario_creacion)
                VALUES (2, 2, p_id_planilla, v_id_jubilado, 2, ROUND(v_pension_proporcional * v_pct_isr / 100, 2), v_dias_trabajados, 'JUBILADO', 'ADMINISTRATIVA', p_usuario);
            END IF;
            
            IF v_aplica_intecap = TRUE AND v_pct_intecap > 0 THEN
                INSERT INTO RPJ_PRC_NOMINA_DESCUENTO (nde_tipo_manejo, nde_id_tipo_planilla, nde_id_planilla, nde_id_jubilado, nde_tipo_descuento, nde_valor, nde_dias_trabajados, nde_puesto, nde_area, nde_usuario_creacion)
                VALUES (2, 2, p_id_planilla, v_id_jubilado, 3, ROUND(v_pension_proporcional * v_pct_intecap / 100, 2), v_dias_trabajados, 'JUBILADO', 'ADMINISTRATIVA', p_usuario);
            END IF;
            
            INSERT INTO RPJ_PRC_NOMINA_DESCUENTO (nde_tipo_manejo, nde_id_tipo_planilla, nde_id_planilla, nde_id_jubilado, nde_tipo_descuento, nde_valor, nde_dias_trabajados, nde_puesto, nde_area, nde_usuario_creacion)
            SELECT 2, 2, p_id_planilla, v_id_jubilado, 4, LEAST(dju_valor, dju_saldo), v_dias_trabajados, 'JUBILADO', 'ADMINISTRATIVA', p_usuario
              FROM RPJ_MNT_DESC_JUDICIALES
             WHERE dju_id_jubilado = v_id_jubilado AND dju_tipo_manejo = 2 AND dju_estado = 'ACTIVO' AND dju_saldo > 0;
            UPDATE RPJ_MNT_DESC_JUDICIALES
               SET dju_saldo = GREATEST(dju_saldo - dju_valor, 0),
                   dju_estado = CASE WHEN dju_saldo - dju_valor <= 0 THEN 'CANCELADO' ELSE 'ACTIVO' END
             WHERE dju_id_jubilado = v_id_jubilado AND dju_tipo_manejo = 2 AND dju_estado = 'ACTIVO' AND dju_saldo > 0;
            
            INSERT INTO RPJ_PRC_NOMINA_DESCUENTO (nde_tipo_manejo, nde_id_tipo_planilla, nde_id_planilla, nde_id_jubilado, nde_tipo_descuento, nde_valor, nde_dias_trabajados, nde_puesto, nde_area, nde_usuario_creacion)
            SELECT 2, 2, p_id_planilla, v_id_jubilado, 4 + prr_id_banco, LEAST(prr_valor_mes, prr_saldo), v_dias_trabajados, 'JUBILADO', 'ADMINISTRATIVA', p_usuario
              FROM RPJ_MNT_PRESTAMOS_REGIMEN
             WHERE prr_id_jubilado = v_id_jubilado AND prr_tipo_manejo = 2 AND prr_id_banco IN (1,2,3) AND prr_estado = 'ACTIVO' AND prr_saldo > 0;
            UPDATE RPJ_MNT_PRESTAMOS_REGIMEN
               SET prr_saldo = GREATEST(prr_saldo - prr_valor_mes, 0),
                   prr_estado = CASE WHEN prr_saldo - prr_valor_mes <= 0 THEN 'OPERADA' ELSE 'ACTIVO' END
             WHERE prr_id_jubilado = v_id_jubilado AND prr_tipo_manejo = 2 AND prr_id_banco IN (1,2,3) AND prr_estado = 'ACTIVO' AND prr_saldo > 0;
            
            IF v_aplica_asociacion = TRUE AND v_monto_asociacion > 0 THEN
                INSERT INTO RPJ_PRC_NOMINA_DESCUENTO (nde_tipo_manejo, nde_id_tipo_planilla, nde_id_planilla, nde_id_jubilado, nde_tipo_descuento, nde_valor, nde_dias_trabajados, nde_puesto, nde_area, nde_usuario_creacion)
                VALUES (2, 2, p_id_planilla, v_id_jubilado, 8, v_monto_asociacion, v_dias_trabajados, 'JUBILADO', 'ADMINISTRATIVA', p_usuario);
            END IF;

            SELECT COALESCE(SUM(nde_valor), 0) INTO @desc_jub
              FROM RPJ_PRC_NOMINA_DESCUENTO WHERE nde_id_planilla = p_id_planilla AND nde_id_jubilado = v_id_jubilado;

            SET p_procesados   = p_procesados   + 1;
            SET p_total_pagado = p_total_pagado + v_total_ind;
            SET p_total_desc   = p_total_desc   + @desc_jub;
        END IF;
      -- FIX cursor: el handler NOT FOUND es compartido, y la búsqueda de deuda
        -- pendiente lo dispara cuando el jubilado no debe nada. Sin esta línea el
        -- ciclo terminaba después del primer jubilado sin deuda.
        SET v_done = FALSE;
    END LOOP loop_jub;
    CLOSE cur_jub;

    UPDATE RPJ_CAT_PARAMETRO_PLANILLA
       SET ppl_estado_proceso = 'GENERADA', ppl_fecha_generacion = NOW(), ppl_usuario_genera = p_usuario
     WHERE ppl_correlativo = p_id_planilla;

    COMMIT;
END $$

DELIMITER ;

DROP PROCEDURE IF EXISTS sp_generar_nomina_amparistas;
DELIMITER $$

CREATE PROCEDURE sp_generar_nomina_amparistas(
    IN p_id_planilla int(11),
    IN p_usuario varchar(50),
    OUT p_procesados int(11),
    OUT p_total decimal(14,2),
    OUT p_resultado varchar(500)
)
BEGIN
    DECLARE v_tipo_planilla   INT;
    DECLARE v_estado_proc     VARCHAR(20);
    DECLARE v_fecha_inicio    DATE;
    DECLARE v_fecha_final     DATE;
    DECLARE v_dias_periodo    INT;
    DECLARE v_porcentaje      DECIMAL(5,2) DEFAULT 100.00; 

    DECLARE v_id_jubilado     INT;
    DECLARE v_pension         DECIMAL(12,2);
    DECLARE v_fecha_jubilacion DATE;
    DECLARE v_done            BOOLEAN DEFAULT FALSE;

    DECLARE v_aplica_nomina   BOOLEAN;
    DECLARE v_aplica_igss     BOOLEAN;
    DECLARE v_tiene_datos     INT;
    DECLARE v_pct_igss        DECIMAL(5,2);

    DECLARE v_dias_trabajados INT;
    DECLARE v_factor_dias     DECIMAL(10,6);
    DECLARE v_pago_corriente  DECIMAL(12,2);
    DECLARE v_abono           DECIMAL(12,2);
    DECLARE v_total_ind       DECIMAL(12,2);
    DECLARE v_pension_prop    DECIMAL(12,2);

    DECLARE v_id_deuda_vieja  INT;
    DECLARE v_periodo_deuda   INT;
    DECLARE v_pendiente_deuda DECIMAL(12,2);

    DECLARE cur_amp CURSOR FOR
        SELECT j.jub_correlativo, s.sal_salario, j.jub_fecha_jubilacion
          FROM RPJ_MNT_JUBILADO j
          INNER JOIN RPJ_MNT_SALARIO s
                  ON s.sal_id_jubilado  = j.jub_correlativo
                 AND s.sal_tipo_manejo  = 2
                 AND s.sal_tipo_ingreso = 1
         WHERE j.jub_tipo_manejo = 2
           AND j.jub_estado      = 'ACTIVO'
           AND j.jub_tipo_pago   = 'AMPARISTA'
           AND j.jub_estado_pago = 'ACTIVO';

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = TRUE;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

    SET p_procesados = 0;
    SET p_total      = 0.00;

    SELECT ppl_tipo_planilla, ppl_estado_proceso, ppl_fecha_inicio, ppl_fecha_final
      INTO v_tipo_planilla, v_estado_proc, v_fecha_inicio, v_fecha_final
      FROM RPJ_CAT_PARAMETRO_PLANILLA WHERE ppl_correlativo = p_id_planilla;

    IF v_estado_proc IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Planilla no encontrada';
    END IF;
    IF v_tipo_planilla <> 4 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La planilla no es de tipo 4 (Amparistas)';
    END IF;
    IF v_estado_proc NOT IN ('ABIERTA', 'REVERSADA') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Solo se puede generar nomina si la planilla esta ABIERTA o REVERSADA';
    END IF;

    SET v_dias_periodo = DATEDIFF(v_fecha_final, v_fecha_inicio) + 1;
    SELECT par_igss INTO v_pct_igss FROM RPJ_CAT_PARAMETRO_GENERAL ORDER BY par_id DESC LIMIT 1;

    START TRANSACTION;

    
    UPDATE RPJ_PRC_DEUDA_JUBILADO d
     INNER JOIN RPJ_PRC_APLICACION_PAGO a ON a.apa_id_deuda = d.deu_correlativo
       SET d.deu_monto_pagado    = d.deu_monto_pagado    - a.apa_monto_aplicado,
           d.deu_monto_pendiente = d.deu_monto_pendiente + a.apa_monto_aplicado,
           d.deu_estado = CASE WHEN d.deu_monto_pagado - a.apa_monto_aplicado <= 0 THEN 'PENDIENTE' ELSE 'PARCIAL' END,
           d.deu_fecha_saldada = NULL
     WHERE a.apa_id_planilla = p_id_planilla;
    DELETE FROM RPJ_PRC_APLICACION_PAGO WHERE apa_id_planilla = p_id_planilla;
    DELETE FROM RPJ_PRC_NOMINA_DESCUENTO WHERE nde_id_planilla = p_id_planilla AND nde_tipo_manejo = 2;
    DELETE FROM RPJ_PRC_NOMINA_INGRESO   WHERE nin_id_planilla = p_id_planilla AND nin_tipo_manejo = 2;

    OPEN cur_amp;
    loop_amp: LOOP
        FETCH cur_amp INTO v_id_jubilado, v_pension, v_fecha_jubilacion;
        IF v_done THEN LEAVE loop_amp; END IF;

        SET v_aplica_nomina = FALSE; SET v_aplica_igss = FALSE; SET v_tiene_datos = 0;
        SELECT COUNT(*), MAX(dat_aplica_nomina), MAX(dat_aplica_desc_igss)
          INTO v_tiene_datos, v_aplica_nomina, v_aplica_igss
          FROM RPJ_MNT_DATOS_PLANILLA WHERE dat_id_jubilado = v_id_jubilado AND dat_tipo_manejo = 2;

        IF v_tiene_datos > 0 AND v_aplica_nomina = TRUE THEN
            IF v_fecha_jubilacion >= v_fecha_inicio AND v_fecha_jubilacion <= v_fecha_final THEN
                SET v_dias_trabajados = DATEDIFF(v_fecha_final, v_fecha_jubilacion) + 1;
                SET v_factor_dias     = v_dias_trabajados / v_dias_periodo;
            ELSE
                SET v_dias_trabajados = v_dias_periodo;
                SET v_factor_dias     = 1.0;
            END IF;

            SET v_pension_prop   = ROUND(v_pension * v_factor_dias, 2);
            SET v_pago_corriente = ROUND(v_pension_prop * v_porcentaje / 100, 2); 

            SET v_id_deuda_vieja = NULL; SET v_abono = 0.00; SET v_periodo_deuda = NULL; SET v_pendiente_deuda = 0.00;
            SELECT deu_correlativo, deu_periodo, deu_monto_pendiente
              INTO v_id_deuda_vieja, v_periodo_deuda, v_pendiente_deuda
              FROM RPJ_PRC_DEUDA_JUBILADO
             WHERE deu_id_jubilado = v_id_jubilado AND deu_estado IN ('PENDIENTE','PARCIAL')
             ORDER BY deu_periodo ASC LIMIT 1;

            IF v_id_deuda_vieja IS NOT NULL THEN
                SET v_abono = LEAST(v_pago_corriente, v_pendiente_deuda);
                UPDATE RPJ_PRC_DEUDA_JUBILADO
                   SET deu_monto_pagado    = deu_monto_pagado + v_abono,
                       deu_monto_pendiente = deu_monto_pendiente - v_abono,
                       deu_estado = CASE WHEN deu_monto_pendiente - v_abono <= 0 THEN 'PAGADA' ELSE 'PARCIAL' END,
                       deu_fecha_saldada = CASE WHEN deu_monto_pendiente - v_abono <= 0 THEN CURDATE() ELSE NULL END
                 WHERE deu_correlativo = v_id_deuda_vieja;
                INSERT INTO RPJ_PRC_APLICACION_PAGO
                    (apa_id_planilla, apa_id_jubilado, apa_id_deuda, apa_periodo_deuda, apa_monto_aplicado, apa_fecha_aplicacion, apa_observaciones, apa_usuario_creacion)
                VALUES (p_id_planilla, v_id_jubilado, v_id_deuda_vieja, v_periodo_deuda, v_abono, CURDATE(), CONCAT('Abono amparista al periodo ', v_periodo_deuda), p_usuario);
            END IF;

            SET v_total_ind = v_pago_corriente + v_abono;

            INSERT INTO RPJ_PRC_NOMINA_INGRESO
                (nin_tipo_manejo, nin_id_tipo_planilla, nin_id_planilla, nin_id_jubilado, nin_tipo_ingreso,
                 nin_valor, nin_valor_teorico, nin_porcentaje_aplicado, nin_pago_corriente, nin_abono_historico,
                 nin_id_deuda_aplicada, nin_dias_trabajados, nin_puesto, nin_area, nin_usuario_creacion)
            VALUES (2, v_tipo_planilla, p_id_planilla, v_id_jubilado, 1,
                 v_total_ind, v_pension, v_porcentaje, v_pago_corriente, v_abono,
                 v_id_deuda_vieja, v_dias_trabajados, 'JUBILADO AMPARISTA', 'ADMINISTRATIVA', p_usuario);

            IF v_aplica_igss = TRUE AND v_pct_igss > 0 THEN
                INSERT INTO RPJ_PRC_NOMINA_DESCUENTO (nde_tipo_manejo, nde_id_tipo_planilla, nde_id_planilla, nde_id_jubilado, nde_tipo_descuento, nde_valor, nde_dias_trabajados, nde_puesto, nde_area, nde_usuario_creacion)
                VALUES (2, v_tipo_planilla, p_id_planilla, v_id_jubilado, 1, ROUND(v_pension_prop * v_pct_igss / 100, 2), v_dias_trabajados, 'JUBILADO AMPARISTA', 'ADMINISTRATIVA', p_usuario);
            END IF;

            SET p_procesados = p_procesados + 1;
            SET p_total      = p_total + v_total_ind;
        END IF;
      -- FIX cursor: el handler NOT FOUND es compartido, y la búsqueda de deuda
        -- pendiente lo dispara cuando el jubilado no debe nada. Sin esta línea el
        -- ciclo terminaba después del primer jubilado sin deuda.
        SET v_done = FALSE;
    END LOOP loop_amp;
    CLOSE cur_amp;

    UPDATE RPJ_CAT_PARAMETRO_PLANILLA
       SET ppl_estado_proceso = 'GENERADA', ppl_fecha_generacion = NOW(), ppl_usuario_genera = p_usuario
     WHERE ppl_correlativo = p_id_planilla;

    COMMIT;
    SET p_resultado = CONCAT('Nomina amparistas generada. Procesados: ', p_procesados, '. Total: ', p_total, '.');
END $$

DELIMITER ;

DROP PROCEDURE IF EXISTS sp_generar_nomina_beneficiarios;
DELIMITER $$

CREATE PROCEDURE sp_generar_nomina_beneficiarios(
    IN p_id_planilla int(11),
    IN p_usuario varchar(50),
    OUT p_procesados int(11),
    OUT p_total decimal(14,2),
    OUT p_resultado varchar(500)
)
BEGIN
    DECLARE v_estado_proc   VARCHAR(20);
    DECLARE v_porcentaje    DECIMAL(5,2);

    DECLARE v_id_ben        INT;
    DECLARE v_id_jubilado   INT;
    DECLARE v_ben_pct       DECIMAL(5,2);
    DECLARE v_pension       DECIMAL(12,2);
    DECLARE v_done          BOOLEAN DEFAULT FALSE;

    DECLARE v_pago_corriente DECIMAL(12,2);
    DECLARE v_abono          DECIMAL(12,2);
    DECLARE v_total_ind      DECIMAL(12,2);
    DECLARE v_id_deuda_vieja INT;
    DECLARE v_periodo_deuda  INT;
    DECLARE v_pendiente_deuda DECIMAL(12,2);

    DECLARE cur_ben CURSOR FOR
        SELECT b.ben_correlativo, b.ben_id_jubilado, b.ben_porcentaje, s.sal_salario
          FROM RPJ_MNT_BENEFICIARIO b
          INNER JOIN RPJ_MNT_JUBILADO j
                  ON j.jub_correlativo = b.ben_id_jubilado
                 AND j.jub_tipo_manejo = 2
                 AND j.jub_estado_pago = 'FALLECIDO'
          INNER JOIN RPJ_MNT_SALARIO s
                  ON s.sal_id_jubilado  = j.jub_correlativo
                 AND s.sal_tipo_manejo  = 2
                 AND s.sal_tipo_ingreso = 1
         WHERE b.ben_estado = 'ACTIVO';

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = TRUE;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

    SET p_procesados = 0;
    SET p_total      = 0.00;

    SELECT ppl_estado_proceso, ppl_porcentaje_pago INTO v_estado_proc, v_porcentaje
      FROM RPJ_CAT_PARAMETRO_PLANILLA WHERE ppl_correlativo = p_id_planilla;
    IF v_estado_proc IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Planilla no encontrada';
    END IF;
    IF v_estado_proc NOT IN ('ABIERTA','GENERADA','REVERSADA') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La planilla no admite generacion de pagos a beneficiarios en su estado actual';
    END IF;

    START TRANSACTION;

    
    DELETE FROM RPJ_PRC_NOMINA_INGRESO
     WHERE nin_id_planilla = p_id_planilla AND nin_id_beneficiario IS NOT NULL;

    OPEN cur_ben;
    loop_ben: LOOP
        FETCH cur_ben INTO v_id_ben, v_id_jubilado, v_ben_pct, v_pension;
        IF v_done THEN LEAVE loop_ben; END IF;

        SET v_pago_corriente = ROUND(v_pension * v_porcentaje / 100 * v_ben_pct / 100, 2);

        SET v_id_deuda_vieja = NULL; SET v_abono = 0.00; SET v_periodo_deuda = NULL; SET v_pendiente_deuda = 0.00;
        SELECT deu_correlativo, deu_periodo, deu_monto_pendiente
          INTO v_id_deuda_vieja, v_periodo_deuda, v_pendiente_deuda
          FROM RPJ_PRC_DEUDA_JUBILADO
         WHERE deu_id_beneficiario = v_id_ben AND deu_estado IN ('PENDIENTE','PARCIAL')
         ORDER BY deu_periodo ASC LIMIT 1;

        IF v_id_deuda_vieja IS NOT NULL THEN
            SET v_abono = LEAST(v_pago_corriente, v_pendiente_deuda);
            UPDATE RPJ_PRC_DEUDA_JUBILADO
               SET deu_monto_pagado    = deu_monto_pagado + v_abono,
                   deu_monto_pendiente = deu_monto_pendiente - v_abono,
                   deu_estado = CASE WHEN deu_monto_pendiente - v_abono <= 0 THEN 'PAGADA' ELSE 'PARCIAL' END,
                   deu_fecha_saldada = CASE WHEN deu_monto_pendiente - v_abono <= 0 THEN CURDATE() ELSE NULL END
             WHERE deu_correlativo = v_id_deuda_vieja;
            INSERT INTO RPJ_PRC_APLICACION_PAGO
                (apa_id_planilla, apa_id_jubilado, apa_id_deuda, apa_periodo_deuda, apa_monto_aplicado, apa_fecha_aplicacion, apa_observaciones, apa_usuario_creacion)
            VALUES (p_id_planilla, v_id_jubilado, v_id_deuda_vieja, v_periodo_deuda, v_abono, CURDATE(), CONCAT('Abono beneficiario al periodo ', v_periodo_deuda), p_usuario);
        END IF;

        SET v_total_ind = v_pago_corriente + v_abono;

        INSERT INTO RPJ_PRC_NOMINA_INGRESO
            (nin_tipo_manejo, nin_id_tipo_planilla, nin_id_planilla, nin_id_jubilado, nin_id_beneficiario, nin_tipo_ingreso,
             nin_valor, nin_valor_teorico, nin_porcentaje_aplicado, nin_pago_corriente, nin_abono_historico,
             nin_id_deuda_aplicada, nin_dias_trabajados, nin_puesto, nin_area, nin_usuario_creacion)
        VALUES (2, 2, p_id_planilla, v_id_jubilado, v_id_ben, 1,
             v_total_ind, v_pension, v_ben_pct, v_pago_corriente, v_abono,
             v_id_deuda_vieja, 30, 'BENEFICIARIO', 'ADMINISTRATIVA', p_usuario);

        SET p_procesados = p_procesados + 1;
        SET p_total      = p_total + v_total_ind;
      -- FIX cursor: el handler NOT FOUND es compartido, y la búsqueda de deuda
        -- pendiente lo dispara cuando el jubilado no debe nada. Sin esta línea el
        -- ciclo terminaba después del primer jubilado sin deuda.
        SET v_done = FALSE;
    END LOOP loop_ben;
    CLOSE cur_ben;

    COMMIT;
    SET p_resultado = CONCAT('Pagos a beneficiarios generados. Procesados: ', p_procesados, '. Total: ', p_total, '.');
END $$

DELIMITER ;

SELECT ROUTINE_NAME, 
       CASE WHEN ROUTINE_DEFINITION LIKE '%FIX cursor%' THEN 'CORREGIDO' ELSE 'SIN CORREGIR' END AS estado
  FROM information_schema.ROUTINES
 WHERE ROUTINE_SCHEMA = DATABASE()
   AND ROUTINE_NAME IN ('sp_generar_nomina_pensionados','sp_generar_nomina_amparistas','sp_generar_nomina_beneficiarios')
 ORDER BY ROUTINE_NAME;

SELECT 'MIGRACION COMPLETADA' AS resultado;
