-- ============================================================================
-- MÓDULO: Jubilados, Beneficiarios y Control de Deuda
-- FASE 3 — Stored Procedures (03_stored_procedures_completos.sql)
-- Base de datos : apps_rpjepq
-- Motor         : MariaDB 10.4 / MySQL 8
-- Idempotente   : DROP PROCEDURE IF EXISTS antes de cada CREATE.
--
-- ESTRATEGIA "REUTILIZAR Y EXTENDER":
--   * Se REUTILIZAN sin cambios: sp_cerrar_planilla, sp_generar_deuda_historica(_masivo),
--     sp_reversar_planilla_pensionados (opera por id de planilla y tipo_manejo=2,
--     sirve también para amparistas de planilla tipo 4).
--   * Se MODIFICA sp_generar_nomina_pensionados: se agregan 2 filtros al cursor para
--     que NO pague amparistas ni fallecidos/suspendidos (cambio aditivo y seguro:
--     los jubilados actuales son NORMAL/ACTIVO por defecto).
--   * Se CREAN 5 SP nuevos: sp_cargar_historial_y_deuda, sp_generar_nomina_amparistas,
--     sp_generar_nomina_beneficiarios, sp_registrar_fallecimiento_jubilado,
--     sp_registrar_amparista.
--
-- CONTRATO DE ERRORES: validaciones -> SIGNAL SQLSTATE '45000' (el backend lo captura
--   y responde 400/409). Éxito -> OUT p_resultado con mensaje. EXIT HANDLER hace
--   ROLLBACK + RESIGNAL ante cualquier error inesperado.
--
-- MAPEO deuda (tabla RPJ_PRC_DEUDA_JUBILADO):
--   deu_monto_original  = pensión mensual completa (100%)
--   deu_monto_pendiente = saldo por pagar   |  deu_monto_pagado = abonado
--   deu_es_deuda: 0=historia (pagado 100%), 1=deuda real
--   deu_tipo_pago: NORMAL | AMPARISTA | BENEFICIARIO
-- ============================================================================

USE `apps_rpjepq`;

-- ============================================================================
-- BLOQUE 0 — Catálogo: tipo de planilla 4 (AMPARISTAS)  [idempotente]
-- ============================================================================
SELECT 'BLOQUE 0: seed tipo de planilla 4 (AMPARISTAS)' AS etapa;

SET @uso_tipo := (SELECT COALESCE(MIN(tpl_id_tipo_uso), 1) FROM RPJ_CAT_TIPO_PLANILLA);
INSERT INTO RPJ_CAT_TIPO_PLANILLA (tpl_id, tpl_tipo_planilla, tpl_descripcion, tpl_id_tipo_uso, tpl_usuario_creacion)
SELECT 4, 'NOMINA AMPARISTAS', 'Nomina de jubilados amparistas (100%)', @uso_tipo, 'sistema'
  FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM RPJ_CAT_TIPO_PLANILLA WHERE tpl_id = 4);

-- ============================================================================
-- BLOQUE 1 — MODIFICAR sp_generar_nomina_pensionados (nómina NORMAL, tipo 2)
--   Único cambio vs la versión desplegada: 2 filtros en el cursor
--     AND j.jub_tipo_pago   = 'NORMAL'   -> excluye amparistas (se pagan al 100% en tipo 4)
--     AND j.jub_estado_pago = 'ACTIVO'   -> excluye fallecidos y suspendidos
-- ============================================================================
SELECT 'BLOQUE 1: sp_generar_nomina_pensionados (con filtros)' AS etapa;

DROP PROCEDURE IF EXISTS sp_generar_nomina_pensionados;
DELIMITER $$
CREATE PROCEDURE sp_generar_nomina_pensionados(
  IN  p_id_planilla  INT,
  IN  p_tipo_ingreso INT,
  IN  p_usuario      VARCHAR(50),
  OUT p_procesados   INT,
  OUT p_excluidos    INT,
  OUT p_total_pagado DECIMAL(12,2),
  OUT p_total_desc   DECIMAL(12,2)
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

    -- *** CAMBIO: se agregan los 2 filtros jub_tipo_pago y jub_estado_pago ***
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

    -- Limpieza idempotente: revertir aplicaciones previas de esta planilla y borrar ingresos/descuentos
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

            -- IGSS
            IF v_aplica_igss = TRUE AND v_pct_igss > 0 THEN
                INSERT INTO RPJ_PRC_NOMINA_DESCUENTO (nde_tipo_manejo, nde_id_tipo_planilla, nde_id_planilla, nde_id_jubilado, nde_tipo_descuento, nde_valor, nde_dias_trabajados, nde_puesto, nde_area, nde_usuario_creacion)
                VALUES (2, 2, p_id_planilla, v_id_jubilado, 1, ROUND(v_pension_proporcional * v_pct_igss / 100, 2), v_dias_trabajados, 'JUBILADO', 'ADMINISTRATIVA', p_usuario);
            END IF;
            -- ISR
            IF v_aplica_isr = TRUE AND v_pct_isr > 0 THEN
                INSERT INTO RPJ_PRC_NOMINA_DESCUENTO (nde_tipo_manejo, nde_id_tipo_planilla, nde_id_planilla, nde_id_jubilado, nde_tipo_descuento, nde_valor, nde_dias_trabajados, nde_puesto, nde_area, nde_usuario_creacion)
                VALUES (2, 2, p_id_planilla, v_id_jubilado, 2, ROUND(v_pension_proporcional * v_pct_isr / 100, 2), v_dias_trabajados, 'JUBILADO', 'ADMINISTRATIVA', p_usuario);
            END IF;
            -- INTECAP
            IF v_aplica_intecap = TRUE AND v_pct_intecap > 0 THEN
                INSERT INTO RPJ_PRC_NOMINA_DESCUENTO (nde_tipo_manejo, nde_id_tipo_planilla, nde_id_planilla, nde_id_jubilado, nde_tipo_descuento, nde_valor, nde_dias_trabajados, nde_puesto, nde_area, nde_usuario_creacion)
                VALUES (2, 2, p_id_planilla, v_id_jubilado, 3, ROUND(v_pension_proporcional * v_pct_intecap / 100, 2), v_dias_trabajados, 'JUBILADO', 'ADMINISTRATIVA', p_usuario);
            END IF;
            -- JUDICIALES (tde 4)
            INSERT INTO RPJ_PRC_NOMINA_DESCUENTO (nde_tipo_manejo, nde_id_tipo_planilla, nde_id_planilla, nde_id_jubilado, nde_tipo_descuento, nde_valor, nde_dias_trabajados, nde_puesto, nde_area, nde_usuario_creacion)
            SELECT 2, 2, p_id_planilla, v_id_jubilado, 4, LEAST(dju_valor, dju_saldo), v_dias_trabajados, 'JUBILADO', 'ADMINISTRATIVA', p_usuario
              FROM RPJ_MNT_DESC_JUDICIALES
             WHERE dju_id_jubilado = v_id_jubilado AND dju_tipo_manejo = 2 AND dju_estado = 'ACTIVO' AND dju_saldo > 0;
            UPDATE RPJ_MNT_DESC_JUDICIALES
               SET dju_saldo = GREATEST(dju_saldo - dju_valor, 0),
                   dju_estado = CASE WHEN dju_saldo - dju_valor <= 0 THEN 'CANCELADO' ELSE 'ACTIVO' END
             WHERE dju_id_jubilado = v_id_jubilado AND dju_tipo_manejo = 2 AND dju_estado = 'ACTIVO' AND dju_saldo > 0;
            -- PRESTAMOS REGIMEN (bancos 1,2,3 -> tde 5,6,7)
            INSERT INTO RPJ_PRC_NOMINA_DESCUENTO (nde_tipo_manejo, nde_id_tipo_planilla, nde_id_planilla, nde_id_jubilado, nde_tipo_descuento, nde_valor, nde_dias_trabajados, nde_puesto, nde_area, nde_usuario_creacion)
            SELECT 2, 2, p_id_planilla, v_id_jubilado, 4 + prr_id_banco, LEAST(prr_valor_mes, prr_saldo), v_dias_trabajados, 'JUBILADO', 'ADMINISTRATIVA', p_usuario
              FROM RPJ_MNT_PRESTAMOS_REGIMEN
             WHERE prr_id_jubilado = v_id_jubilado AND prr_tipo_manejo = 2 AND prr_id_banco IN (1,2,3) AND prr_estado = 'ACTIVO' AND prr_saldo > 0;
            UPDATE RPJ_MNT_PRESTAMOS_REGIMEN
               SET prr_saldo = GREATEST(prr_saldo - prr_valor_mes, 0),
                   prr_estado = CASE WHEN prr_saldo - prr_valor_mes <= 0 THEN 'OPERADA' ELSE 'ACTIVO' END
             WHERE prr_id_jubilado = v_id_jubilado AND prr_tipo_manejo = 2 AND prr_id_banco IN (1,2,3) AND prr_estado = 'ACTIVO' AND prr_saldo > 0;
            -- ASOCIACION (tde 8)
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
    END LOOP loop_jub;
    CLOSE cur_jub;

    UPDATE RPJ_CAT_PARAMETRO_PLANILLA
       SET ppl_estado_proceso = 'GENERADA', ppl_fecha_generacion = NOW(), ppl_usuario_genera = p_usuario
     WHERE ppl_correlativo = p_id_planilla;

    COMMIT;
END $$
DELIMITER ;

-- ============================================================================
-- BLOQUE 2 — sp_registrar_fallecimiento_jubilado
-- ============================================================================
SELECT 'BLOQUE 2: sp_registrar_fallecimiento_jubilado' AS etapa;

DROP PROCEDURE IF EXISTS sp_registrar_fallecimiento_jubilado;
DELIMITER $$
CREATE PROCEDURE sp_registrar_fallecimiento_jubilado(
  IN  p_id_jubilado         INT,
  IN  p_fecha_fallecimiento DATE,
  IN  p_no_defuncion        VARCHAR(50),
  IN  p_usuario             VARCHAR(50),
  OUT p_beneficiarios_activados INT,
  OUT p_resultado           VARCHAR(500)
)
BEGIN
    DECLARE v_estado_pago   VARCHAR(20);
    DECLARE v_fecha_jub     DATE;
    DECLARE v_reg           INT DEFAULT 0;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

    SET p_beneficiarios_activados = 0;

    SELECT jub_estado_pago, jub_fecha_jubilacion INTO v_estado_pago, v_fecha_jub
      FROM RPJ_MNT_JUBILADO WHERE jub_correlativo = p_id_jubilado;

    IF v_estado_pago IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El jubilado no existe';
    END IF;
    IF v_estado_pago <> 'ACTIVO' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El jubilado no esta ACTIVO (ya fue marcado como fallecido o suspendido)';
    END IF;
    IF p_fecha_fallecimiento IS NULL OR p_fecha_fallecimiento > CURDATE() THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La fecha de fallecimiento no puede ser futura';
    END IF;
    IF p_fecha_fallecimiento < v_fecha_jub THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La fecha de fallecimiento no puede ser anterior a la fecha de jubilacion';
    END IF;

    SELECT COUNT(*) INTO v_reg FROM RPJ_MNT_BENEFICIARIO
     WHERE ben_id_jubilado = p_id_jubilado AND ben_estado = 'REGISTRADO';
    IF v_reg = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El jubilado no tiene beneficiarios en estado REGISTRADO para activar';
    END IF;

    START TRANSACTION;

    UPDATE RPJ_MNT_JUBILADO
       SET jub_estado_pago         = 'FALLECIDO',
           jub_fecha_fallecimiento = p_fecha_fallecimiento,
           jub_no_defuncion        = p_no_defuncion
     WHERE jub_correlativo = p_id_jubilado;

    UPDATE RPJ_MNT_BENEFICIARIO
       SET ben_estado = 'ACTIVO'
     WHERE ben_id_jubilado = p_id_jubilado AND ben_estado = 'REGISTRADO';
    SET p_beneficiarios_activados = ROW_COUNT();

    COMMIT;

    SET p_resultado = CONCAT('Fallecimiento registrado. Beneficiarios activados: ', p_beneficiarios_activados, '.');
END $$
DELIMITER ;

-- ============================================================================
-- BLOQUE 3 — sp_registrar_amparista
-- ============================================================================
SELECT 'BLOQUE 3: sp_registrar_amparista' AS etapa;

DROP PROCEDURE IF EXISTS sp_registrar_amparista;
DELIMITER $$
CREATE PROCEDURE sp_registrar_amparista(
  IN  p_id_jubilado    INT,
  IN  p_no_expediente  VARCHAR(50),
  IN  p_juzgado        VARCHAR(150),
  IN  p_fecha_sentencia DATE,
  IN  p_fecha_efectiva DATE,
  IN  p_abogado        VARCHAR(150),
  IN  p_observaciones  TEXT,
  IN  p_usuario        VARCHAR(50),
  OUT p_deudas_ajustadas INT,
  OUT p_resultado      VARCHAR(500)
)
BEGIN
    DECLARE v_tipo_pago     VARCHAR(20);
    DECLARE v_dup_exp       INT DEFAULT 0;
    DECLARE v_juicio_vig    INT DEFAULT 0;
    DECLARE v_periodo_efec  INT;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

    SET p_deudas_ajustadas = 0;

    SELECT jub_tipo_pago INTO v_tipo_pago FROM RPJ_MNT_JUBILADO WHERE jub_correlativo = p_id_jubilado;
    IF v_tipo_pago IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El jubilado no existe';
    END IF;
    IF v_tipo_pago = 'AMPARISTA' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El jubilado ya es AMPARISTA';
    END IF;

    SELECT COUNT(*) INTO v_dup_exp FROM RPJ_MNT_JUICIO WHERE jui_no_expediente = p_no_expediente;
    IF v_dup_exp > 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Ya existe un juicio con ese numero de expediente';
    END IF;

    SELECT COUNT(*) INTO v_juicio_vig FROM RPJ_MNT_JUICIO
     WHERE jui_id_jubilado = p_id_jubilado AND jui_estado = 'VIGENTE';
    IF v_juicio_vig > 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El jubilado ya tiene un juicio VIGENTE';
    END IF;

    IF p_fecha_efectiva < p_fecha_sentencia THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La fecha efectiva no puede ser anterior a la fecha de sentencia';
    END IF;

    SET v_periodo_efec = YEAR(p_fecha_efectiva) * 100 + MONTH(p_fecha_efectiva);

    START TRANSACTION;

    INSERT INTO RPJ_MNT_JUICIO
        (jui_id_jubilado, jui_no_expediente, jui_juzgado, jui_fecha_sentencia, jui_fecha_efectiva, jui_abogado, jui_observaciones, jui_estado, jui_usuario_creacion)
    VALUES (p_id_jubilado, p_no_expediente, p_juzgado, p_fecha_sentencia, p_fecha_efectiva, p_abogado, p_observaciones, 'VIGENTE', p_usuario);

    UPDATE RPJ_MNT_JUBILADO SET jub_tipo_pago = 'AMPARISTA' WHERE jub_correlativo = p_id_jubilado;

    -- Recalcular deuda a 100% para periodos >= fecha efectiva (que son deuda real)
    UPDATE RPJ_PRC_DEUDA_JUBILADO
       SET deu_monto_pendiente = deu_monto_original - deu_monto_pagado,
           deu_tipo_pago       = 'AMPARISTA',
           deu_estado = CASE
                          WHEN deu_monto_original - deu_monto_pagado <= 0 THEN 'PAGADA'
                          WHEN deu_monto_pagado > 0 THEN 'PARCIAL'
                          ELSE 'PENDIENTE'
                        END,
           deu_fecha_saldada = CASE WHEN deu_monto_original - deu_monto_pagado <= 0 THEN CURDATE() ELSE NULL END
     WHERE deu_id_jubilado = p_id_jubilado
       AND deu_es_deuda    = 1
       AND deu_periodo    >= v_periodo_efec;
    SET p_deudas_ajustadas = ROW_COUNT();

    COMMIT;

    SET p_resultado = CONCAT('Amparista registrado. Deudas ajustadas a 100%: ', p_deudas_ajustadas, '.');
END $$
DELIMITER ;

-- ============================================================================
-- BLOQUE 4 — sp_generar_nomina_amparistas  (planilla tipo 4, 100%)
--   Misma lógica que la normal pero: planilla tipo 4, solo jub_tipo_pago='AMPARISTA'
--   vivos, pago corriente = 100% y abono con el 100%.
-- ============================================================================
SELECT 'BLOQUE 4: sp_generar_nomina_amparistas' AS etapa;

DROP PROCEDURE IF EXISTS sp_generar_nomina_amparistas;
DELIMITER $$
CREATE PROCEDURE sp_generar_nomina_amparistas(
  IN  p_id_planilla INT,
  IN  p_usuario     VARCHAR(50),
  OUT p_procesados  INT,
  OUT p_total       DECIMAL(14,2),
  OUT p_resultado   VARCHAR(500)
)
BEGIN
    DECLARE v_tipo_planilla   INT;
    DECLARE v_estado_proc     VARCHAR(20);
    DECLARE v_fecha_inicio    DATE;
    DECLARE v_fecha_final     DATE;
    DECLARE v_dias_periodo    INT;
    DECLARE v_porcentaje      DECIMAL(5,2) DEFAULT 100.00; -- amparistas: 100%

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

    -- Limpieza idempotente de esta planilla
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
            SET v_pago_corriente = ROUND(v_pension_prop * v_porcentaje / 100, 2); -- 100%

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
    END LOOP loop_amp;
    CLOSE cur_amp;

    UPDATE RPJ_CAT_PARAMETRO_PLANILLA
       SET ppl_estado_proceso = 'GENERADA', ppl_fecha_generacion = NOW(), ppl_usuario_genera = p_usuario
     WHERE ppl_correlativo = p_id_planilla;

    COMMIT;
    SET p_resultado = CONCAT('Nomina amparistas generada. Procesados: ', p_procesados, '. Total: ', p_total, '.');
END $$
DELIMITER ;

-- ============================================================================
-- BLOQUE 5 — sp_generar_nomina_beneficiarios  (planilla tipo 2)
--   Paga a beneficiarios ACTIVOS de jubilados FALLECIDOS:
--   monto = (pensión * % planilla) * (ben_porcentaje/100). Abona a su deuda de
--   beneficiario si existe. NO cambia el estado de la planilla (corre después de
--   sp_generar_nomina_pensionados, que ya la dejó GENERADA).
-- ============================================================================
SELECT 'BLOQUE 5: sp_generar_nomina_beneficiarios' AS etapa;

DROP PROCEDURE IF EXISTS sp_generar_nomina_beneficiarios;
DELIMITER $$
CREATE PROCEDURE sp_generar_nomina_beneficiarios(
  IN  p_id_planilla INT,
  IN  p_usuario     VARCHAR(50),
  OUT p_procesados  INT,
  OUT p_total       DECIMAL(14,2),
  OUT p_resultado   VARCHAR(500)
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

    -- Limpieza idempotente: borrar solo pagos previos de beneficiarios de esta planilla
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
    END LOOP loop_ben;
    CLOSE cur_ben;

    COMMIT;
    SET p_resultado = CONCAT('Pagos a beneficiarios generados. Procesados: ', p_procesados, '. Total: ', p_total, '.');
END $$
DELIMITER ;

-- ============================================================================
-- BLOQUE 6 — sp_cargar_historial_y_deuda
--   Genera, por jubilado (o TODOS si p_id_jubilado=0), un renglón por mes desde
--   su fecha de jubilación hasta p_periodo_final:
--     periodo <  corte  -> HISTORIA: es_deuda=0, PAGADA, pagado=100%, saldo=0
--     periodo >= corte  -> DEUDA   : es_deuda=1, PENDIENTE, saldo = parte no pagada
--   El % no pagado (deuda mensual) = pensión * (100 - p_porcentaje_pago)/100.
--   Idempotente: usa INSERT ... WHERE NOT EXISTS por (jubilado, periodo).
-- ============================================================================
SELECT 'BLOQUE 6: sp_cargar_historial_y_deuda' AS etapa;

DROP PROCEDURE IF EXISTS sp_cargar_historial_y_deuda;
DELIMITER $$
CREATE PROCEDURE sp_cargar_historial_y_deuda(
  IN  p_id_jubilado    INT,
  IN  p_periodo_final  INT,
  IN  p_porcentaje_pago DECIMAL(5,2),
  IN  p_fecha_corte    DATE,
  IN  p_usuario        VARCHAR(50),
  OUT p_registros_generados INT,
  OUT p_resultado      VARCHAR(500)
)
BEGIN
    DECLARE v_done          BOOLEAN DEFAULT FALSE;
    DECLARE v_jub           INT;
    DECLARE v_pension       DECIMAL(12,2);
    DECLARE v_fecha_jub     DATE;
    DECLARE v_periodo_corte INT;
    DECLARE v_periodo       INT;
    DECLARE v_anio          INT;
    DECLARE v_mes           INT;
    DECLARE v_saldo         DECIMAL(12,2);
    DECLARE v_es_deuda      TINYINT;
    DECLARE v_estado        VARCHAR(12);
    DECLARE v_pagado        DECIMAL(12,2);

    DECLARE cur_jub CURSOR FOR
        SELECT j.jub_correlativo, s.sal_salario, j.jub_fecha_jubilacion
          FROM RPJ_MNT_JUBILADO j
          INNER JOIN RPJ_MNT_SALARIO s
                  ON s.sal_id_jubilado  = j.jub_correlativo
                 AND s.sal_tipo_manejo  = 2
                 AND s.sal_tipo_ingreso = 1
         WHERE j.jub_tipo_manejo = 2
           AND j.jub_estado      = 'ACTIVO'
           AND (p_id_jubilado = 0 OR j.jub_correlativo = p_id_jubilado);

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = TRUE;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

    SET p_registros_generados = 0;
    SET v_periodo_corte = YEAR(p_fecha_corte) * 100 + MONTH(p_fecha_corte);

    START TRANSACTION;

    OPEN cur_jub;
    loop_jub: LOOP
        FETCH cur_jub INTO v_jub, v_pension, v_fecha_jub;
        IF v_done THEN LEAVE loop_jub; END IF;

        SET v_periodo = YEAR(v_fecha_jub) * 100 + MONTH(v_fecha_jub);

        WHILE v_periodo <= p_periodo_final DO
            IF v_periodo < v_periodo_corte THEN
                -- HISTORIA: se pagó el 100%
                SET v_es_deuda = 0; SET v_estado = 'PAGADA'; SET v_pagado = v_pension; SET v_saldo = 0.00;
            ELSE
                -- DEUDA real: solo se pagó p_porcentaje_pago%; el resto es saldo
                SET v_es_deuda = 1; SET v_estado = 'PENDIENTE'; SET v_pagado = 0.00;
                SET v_saldo = ROUND(v_pension * (100 - p_porcentaje_pago) / 100, 2);
            END IF;

            INSERT INTO RPJ_PRC_DEUDA_JUBILADO
                (deu_id_jubilado, deu_periodo, deu_monto_original, deu_monto_pagado, deu_monto_pendiente,
                 deu_estado, deu_es_deuda, deu_tipo_pago, deu_fecha_generacion, deu_observaciones, deu_usuario_creacion)
            SELECT v_jub, v_periodo, v_pension, v_pagado, v_saldo,
                   v_estado, v_es_deuda, 'NORMAL', STR_TO_DATE(CONCAT(v_periodo, '01'), '%Y%m%d'),
                   CONCAT('Carga historial/deuda (corte ', v_periodo_corte, ')'), p_usuario
              FROM DUAL
             WHERE NOT EXISTS (SELECT 1 FROM RPJ_PRC_DEUDA_JUBILADO
                                WHERE deu_id_jubilado = v_jub AND deu_periodo = v_periodo);
            SET p_registros_generados = p_registros_generados + ROW_COUNT();

            -- avanzar un mes
            SET v_anio = FLOOR(v_periodo / 100); SET v_mes = v_periodo MOD 100;
            IF v_mes = 12 THEN SET v_anio = v_anio + 1; SET v_mes = 1; ELSE SET v_mes = v_mes + 1; END IF;
            SET v_periodo = v_anio * 100 + v_mes;
        END WHILE;
    END LOOP loop_jub;
    CLOSE cur_jub;

    COMMIT;
    SET p_resultado = CONCAT('Historial/deuda cargado. Registros nuevos: ', p_registros_generados, '.');
END $$
DELIMITER ;

-- ============================================================================
-- BLOQUE 7 — VERIFICACIÓN
-- ============================================================================
SELECT 'BLOQUE 7: verificación' AS etapa;

SELECT ROUTINE_NAME
  FROM information_schema.ROUTINES
 WHERE ROUTINE_SCHEMA = DATABASE() AND ROUTINE_TYPE = 'PROCEDURE'
   AND ROUTINE_NAME IN ('sp_generar_nomina_pensionados','sp_registrar_fallecimiento_jubilado',
        'sp_registrar_amparista','sp_generar_nomina_amparistas','sp_generar_nomina_beneficiarios',
        'sp_cargar_historial_y_deuda')
 ORDER BY ROUTINE_NAME;

SELECT tpl_id, tpl_tipo_planilla FROM RPJ_CAT_TIPO_PLANILLA WHERE tpl_id = 4;

SELECT 'FASE 3 COMPLETADA. Deben aparecer 6 procedimientos y el tipo de planilla 4.' AS estado;
-- ============================================================================
-- FIN FASE 3
-- ============================================================================
