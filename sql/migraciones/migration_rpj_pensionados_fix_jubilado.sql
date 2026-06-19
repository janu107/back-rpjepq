-- ============================================================================
-- FIX: SPs de PENSIONADOS al nuevo modelo *_id_jubilado
-- Base: apps_rpjepq | Motor: MySQL 8 / MariaDB
-- Requisito previo: ejecutar migration_rpj_nomina_empleados_pensionados.sql
-- Reemplaza 3 procedimientos para que lean jubilados desde dat_id_jubilado /
-- dju_id_jubilado / prr_id_jubilado (antes leían desde *_id_empleado).
-- Además registra lre_tipo_manejo y lre_tipo_reverso en RPJ_LOG_REVERSOS.
-- Idempotente: DROP + CREATE.
-- ============================================================================

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
    -- Tipo de ingreso de la pension: usa el recibido o 1 (SALARIO INICIAL) por defecto
    DECLARE v_tin_pension       INT DEFAULT 1;
    -- Datos de la planilla
    DECLARE v_porcentaje        DECIMAL(5,2);
    DECLARE v_estado_proc       VARCHAR(20);
    DECLARE v_fecha_inicio      DATE;
    DECLARE v_fecha_final       DATE;
    DECLARE v_dias_periodo      INT;

    -- Datos del jubilado (cursor)
    DECLARE v_id_jubilado       INT;
    DECLARE v_pension           DECIMAL(12,2);
    DECLARE v_fecha_jubilacion  DATE;
    DECLARE v_done              BOOLEAN DEFAULT FALSE;

    -- Datos de RPJ_MNT_DATOS_PLANILLA
    DECLARE v_aplica_nomina     BOOLEAN;
    DECLARE v_aplica_igss       BOOLEAN;
    DECLARE v_aplica_isr        BOOLEAN;
    DECLARE v_aplica_intecap    BOOLEAN;
    DECLARE v_aplica_asociacion BOOLEAN;
    DECLARE v_tiene_datos       INT;

    -- Parametros generales
    DECLARE v_pct_igss          DECIMAL(5,2);
    DECLARE v_pct_isr           DECIMAL(5,2);
    DECLARE v_pct_intecap       DECIMAL(5,2);
    DECLARE v_monto_asociacion  DECIMAL(10,2);

    -- Calculo de dias y pagos
    DECLARE v_dias_trabajados   INT;
    DECLARE v_factor_dias       DECIMAL(10,6);
    DECLARE v_pago_corriente    DECIMAL(12,2);
    DECLARE v_abono             DECIMAL(12,2);
    DECLARE v_total_ind         DECIMAL(12,2);
    DECLARE v_pension_proporcional DECIMAL(12,2);

    -- Deuda historica
    DECLARE v_id_deuda_vieja    INT;
    DECLARE v_periodo_deuda     INT;
    DECLARE v_pendiente_deuda   DECIMAL(12,2);

    -- Cursor: jubilados activos tipo_manejo = 2
    DECLARE cur_jub CURSOR FOR
        SELECT j.jub_correlativo,
               s.sal_salario,
               j.jub_fecha_jubilacion
          FROM RPJ_MNT_JUBILADO j
          INNER JOIN RPJ_MNT_SALARIO s
                  ON s.sal_id_jubilado  = j.jub_correlativo
                 AND s.sal_tipo_manejo  = 2
                 AND s.sal_tipo_ingreso = 1        -- SALARIO INICIAL
         WHERE j.jub_tipo_manejo = 2
           AND j.jub_estado      = 'ACTIVO';

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = TRUE;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    -- Inicializar contadores
    SET p_procesados   = 0;
    SET p_excluidos    = 0;
    SET p_total_pagado = 0.00;
    SET p_total_desc   = 0.00;
    SET v_tin_pension  = IF(p_tipo_ingreso IS NOT NULL AND p_tipo_ingreso > 0, p_tipo_ingreso, 1);

    -- 1. Validar planilla
    SELECT ppl_porcentaje_pago,
           ppl_estado_proceso,
           ppl_fecha_inicio,
           ppl_fecha_final
      INTO v_porcentaje, v_estado_proc,
           v_fecha_inicio, v_fecha_final
      FROM RPJ_CAT_PARAMETRO_PLANILLA
     WHERE ppl_correlativo = p_id_planilla;

    IF v_estado_proc IS NULL THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Planilla no encontrada';
    END IF;

    IF v_estado_proc != 'ABIERTA' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Solo se puede generar nomina si la planilla esta ABIERTA';
    END IF;

    -- 2. Dias calendario del periodo (ej. junio = 30)
    SET v_dias_periodo = DATEDIFF(v_fecha_final, v_fecha_inicio) + 1;

    -- 3. Leer parametros generales
    SELECT par_igss,
           par_isr,
           par_intecap,
           par_desc_asociacion
      INTO v_pct_igss, v_pct_isr,
           v_pct_intecap, v_monto_asociacion
      FROM RPJ_CAT_PARAMETRO_GENERAL
     ORDER BY par_id DESC LIMIT 1;

    START TRANSACTION;

    -- 4. Recorrer jubilados
    OPEN cur_jub;

    loop_jub: LOOP
        FETCH cur_jub INTO v_id_jubilado, v_pension, v_fecha_jubilacion;
        IF v_done THEN LEAVE loop_jub; END IF;

        -- 4a. Verificar RPJ_MNT_DATOS_PLANILLA
        SET v_aplica_nomina     = FALSE;
        SET v_aplica_igss       = FALSE;
        SET v_aplica_isr        = FALSE;
        SET v_aplica_intecap    = FALSE;
        SET v_aplica_asociacion = FALSE;
        SET v_tiene_datos       = 0;

        SELECT COUNT(*),
               MAX(dat_aplica_nomina),
               MAX(dat_aplica_desc_igss),
               MAX(dat_aplica_desc_isr),
               MAX(dat_aplica_intecap),
               MAX(dat_aplica_dasociacion)
          INTO v_tiene_datos,
               v_aplica_nomina,
               v_aplica_igss,
               v_aplica_isr,
               v_aplica_intecap,
               v_aplica_asociacion
          FROM RPJ_MNT_DATOS_PLANILLA
         WHERE dat_id_jubilado = v_id_jubilado
           AND dat_tipo_manejo = 2;

        -- Si no tiene datos o aplica_nomina = FALSE -> excluir
        IF v_tiene_datos = 0 OR v_aplica_nomina = FALSE THEN
            SET p_excluidos = p_excluidos + 1;

        ELSE
            -- 4b. Calcular dias trabajados
            --     Si jubilo DENTRO del periodo -> proporcional
            --     Si jubilo ANTES del inicio   -> dias completos
            IF v_fecha_jubilacion >= v_fecha_inicio
               AND v_fecha_jubilacion <= v_fecha_final THEN
                SET v_dias_trabajados = DATEDIFF(v_fecha_final, v_fecha_jubilacion) + 1;
                SET v_factor_dias     = v_dias_trabajados / v_dias_periodo;
            ELSE
                SET v_dias_trabajados = v_dias_periodo;
                SET v_factor_dias     = 1.0;
            END IF;

            -- 4c. Pension proporcional al factor de dias
            SET v_pension_proporcional = ROUND(v_pension * v_factor_dias, 2);

            -- 4d. Pago corriente = pension proporcional * porcentaje planilla
            SET v_pago_corriente = ROUND(v_pension_proporcional * v_porcentaje / 100, 2);

            -- 4e. Buscar deuda historica mas vieja pendiente
            SET v_id_deuda_vieja  = NULL;
            SET v_abono           = 0.00;
            SET v_periodo_deuda   = NULL;
            SET v_pendiente_deuda = 0.00;

            SELECT deu_correlativo,
                   deu_periodo,
                   deu_monto_pendiente
              INTO v_id_deuda_vieja,
                   v_periodo_deuda,
                   v_pendiente_deuda
              FROM RPJ_PRC_DEUDA_JUBILADO
             WHERE deu_id_jubilado = v_id_jubilado
               AND deu_estado      IN ('PENDIENTE','PARCIAL')
             ORDER BY deu_periodo ASC
             LIMIT 1;

            -- 4f. Abonar a la deuda mas vieja
            IF v_id_deuda_vieja IS NOT NULL THEN
                SET v_abono = LEAST(v_pago_corriente, v_pendiente_deuda);

                UPDATE RPJ_PRC_DEUDA_JUBILADO
                   SET deu_monto_pagado    = deu_monto_pagado + v_abono,
                       deu_monto_pendiente = deu_monto_pendiente - v_abono,
                       deu_estado = CASE
                                      WHEN deu_monto_pendiente - v_abono <= 0
                                      THEN 'PAGADA'
                                      ELSE 'PARCIAL'
                                    END,
                       deu_fecha_saldada = CASE
                                             WHEN deu_monto_pendiente - v_abono <= 0
                                             THEN CURDATE()
                                             ELSE NULL
                                           END
                 WHERE deu_correlativo = v_id_deuda_vieja;

                INSERT INTO RPJ_PRC_APLICACION_PAGO (
                    apa_id_planilla, apa_id_jubilado,
                    apa_id_deuda, apa_periodo_deuda,
                    apa_monto_aplicado, apa_fecha_aplicacion,
                    apa_observaciones, apa_usuario_creacion
                ) VALUES (
                    p_id_planilla, v_id_jubilado,
                    v_id_deuda_vieja, v_periodo_deuda,
                    v_abono, CURDATE(),
                    CONCAT('Abono al periodo ', v_periodo_deuda),
                    p_usuario
                );
            END IF;

            -- 4g. Total recibido en el mes
            SET v_total_ind = v_pago_corriente + v_abono;

            -- =================================================================
            -- 4h. INSERTAR INGRESO EN RPJ_PRC_NOMINA_INGRESO
            --     nin_tipo_ingreso = 1 (SALARIO INICIAL)
            --     nin_id_tipo_planilla = 2 (NOMINA PENSIONADOS)
            -- =================================================================
            INSERT INTO RPJ_PRC_NOMINA_INGRESO (
                nin_tipo_manejo,
                nin_id_tipo_planilla,
                nin_id_planilla,
                nin_id_jubilado,
                nin_tipo_ingreso,
                nin_valor,
                nin_valor_teorico,
                nin_porcentaje_aplicado,
                nin_pago_corriente,
                nin_abono_historico,
                nin_id_deuda_aplicada,
                nin_dias_trabajados,
                nin_puesto,
                nin_area,
                nin_usuario_creacion
            ) VALUES (
                2,                      -- nin_tipo_manejo
                2,                      -- nin_id_tipo_planilla (PENSIONADOS)
                p_id_planilla,
                v_id_jubilado,
                v_tin_pension,          -- nin_tipo_ingreso (SALARIO INICIAL por defecto)
                v_total_ind,
                v_pension,
                v_porcentaje,
                v_pago_corriente,
                v_abono,
                v_id_deuda_vieja,
                v_dias_trabajados,
                'JUBILADO',
                'ADMINISTRATIVA',
                p_usuario
            );

            -- =================================================================
            -- 4i. DESCUENTOS
            --     Cada descuento se inserta como renglon separado
            --     nde_tipo_manejo = 2
            --     nde_id_tipo_planilla = 2
            -- =================================================================

            -- DESCUENTO 1: IGSS (tde_id = 1)
            -- Formula: pension_proporcional * par_igss / 100
            IF v_aplica_igss = TRUE
               AND v_pct_igss > 0 THEN
                INSERT INTO RPJ_PRC_NOMINA_DESCUENTO (
                    nde_tipo_manejo, nde_id_tipo_planilla, nde_id_planilla,
                    nde_id_jubilado, nde_tipo_descuento, nde_valor,
                    nde_dias_trabajados, nde_puesto, nde_area, nde_usuario_creacion
                ) VALUES (
                    2, 2, p_id_planilla,
                    v_id_jubilado, 1,
                    ROUND(v_pension_proporcional * v_pct_igss / 100, 2),
                    v_dias_trabajados, 'JUBILADO', 'ADMINISTRATIVA', p_usuario
                );
            END IF;

            -- DESCUENTO 2: ISR (tde_id = 2 no aplica a pensionados)
            -- Se deja la validacion por si en el futuro se requiere
            IF v_aplica_isr = TRUE
               AND v_pct_isr > 0 THEN
                INSERT INTO RPJ_PRC_NOMINA_DESCUENTO (
                    nde_tipo_manejo, nde_id_tipo_planilla, nde_id_planilla,
                    nde_id_jubilado, nde_tipo_descuento, nde_valor,
                    nde_dias_trabajados, nde_puesto, nde_area, nde_usuario_creacion
                ) VALUES (
                    2, 2, p_id_planilla,
                    v_id_jubilado, 2,
                    ROUND(v_pension_proporcional * v_pct_isr / 100, 2),
                    v_dias_trabajados, 'JUBILADO', 'ADMINISTRATIVA', p_usuario
                );
            END IF;

            -- DESCUENTO 3: INTECAP (tde_id = 3)
            -- Formula: pension_proporcional * par_intecap / 100
            IF v_aplica_intecap = TRUE
               AND v_pct_intecap > 0 THEN
                INSERT INTO RPJ_PRC_NOMINA_DESCUENTO (
                    nde_tipo_manejo, nde_id_tipo_planilla, nde_id_planilla,
                    nde_id_jubilado, nde_tipo_descuento, nde_valor,
                    nde_dias_trabajados, nde_puesto, nde_area, nde_usuario_creacion
                ) VALUES (
                    2, 2, p_id_planilla,
                    v_id_jubilado, 3,
                    ROUND(v_pension_proporcional * v_pct_intecap / 100, 2),
                    v_dias_trabajados, 'JUBILADO', 'ADMINISTRATIVA', p_usuario
                );
            END IF;

            -- DESCUENTO 4: JUDICIAL (tde_id = 4)
            -- Se descuenta dju_valor por cada judicial activo con saldo > 0
            INSERT INTO RPJ_PRC_NOMINA_DESCUENTO (
                nde_tipo_manejo, nde_id_tipo_planilla, nde_id_planilla,
                nde_id_jubilado, nde_tipo_descuento, nde_valor,
                nde_dias_trabajados, nde_puesto, nde_area, nde_usuario_creacion
            )
            SELECT 2, 2, p_id_planilla,
                   v_id_jubilado, 4,
                   LEAST(dju_valor, dju_saldo),
                   v_dias_trabajados, 'JUBILADO', 'ADMINISTRATIVA', p_usuario
              FROM RPJ_MNT_DESC_JUDICIALES
             WHERE dju_id_jubilado = v_id_jubilado
               AND dju_tipo_manejo = 2
               AND dju_estado      = 'ACTIVO'
               AND dju_saldo       > 0;

            -- Actualizar saldo judiciales
            UPDATE RPJ_MNT_DESC_JUDICIALES
               SET dju_saldo  = GREATEST(dju_saldo - dju_valor, 0),
                   dju_estado = CASE
                                  WHEN dju_saldo - dju_valor <= 0 THEN 'CANCELADO'
                                  ELSE 'ACTIVO'
                                END
             WHERE dju_id_jubilado = v_id_jubilado
               AND dju_tipo_manejo = 2
               AND dju_estado      = 'ACTIVO'
               AND dju_saldo       > 0;

            -- DESCUENTO 5: PRESTAMO BANRURAL (tde_id = 5, prr_id_banco = 1)
            INSERT INTO RPJ_PRC_NOMINA_DESCUENTO (
                nde_tipo_manejo, nde_id_tipo_planilla, nde_id_planilla,
                nde_id_jubilado, nde_tipo_descuento, nde_valor,
                nde_dias_trabajados, nde_puesto, nde_area, nde_usuario_creacion
            )
            SELECT 2, 2, p_id_planilla,
                   v_id_jubilado, 5,
                   LEAST(prr_valor_mes, prr_saldo),
                   v_dias_trabajados, 'JUBILADO', 'ADMINISTRATIVA', p_usuario
              FROM RPJ_MNT_PRESTAMOS_REGIMEN
             WHERE prr_id_jubilado = v_id_jubilado
               AND prr_tipo_manejo = 2
               AND prr_id_banco    = 1          -- BANRURAL
               AND prr_estado      = 'ACTIVO'
               AND prr_saldo       > 0;

            UPDATE RPJ_MNT_PRESTAMOS_REGIMEN
               SET prr_saldo  = GREATEST(prr_saldo - prr_valor_mes, 0),
                   prr_estado = CASE
                                  WHEN prr_saldo - prr_valor_mes <= 0 THEN 'OPERADA'
                                  ELSE 'ACTIVO'
                                END
             WHERE prr_id_jubilado = v_id_jubilado
               AND prr_tipo_manejo = 2
               AND prr_id_banco    = 1
               AND prr_estado      = 'ACTIVO'
               AND prr_saldo       > 0;

            -- DESCUENTO 6: PRESTAMO BANTRAB (tde_id = 6, prr_id_banco = 2)
            INSERT INTO RPJ_PRC_NOMINA_DESCUENTO (
                nde_tipo_manejo, nde_id_tipo_planilla, nde_id_planilla,
                nde_id_jubilado, nde_tipo_descuento, nde_valor,
                nde_dias_trabajados, nde_puesto, nde_area, nde_usuario_creacion
            )
            SELECT 2, 2, p_id_planilla,
                   v_id_jubilado, 6,
                   LEAST(prr_valor_mes, prr_saldo),
                   v_dias_trabajados, 'JUBILADO', 'ADMINISTRATIVA', p_usuario
              FROM RPJ_MNT_PRESTAMOS_REGIMEN
             WHERE prr_id_jubilado = v_id_jubilado
               AND prr_tipo_manejo = 2
               AND prr_id_banco    = 2          -- BANTRAB
               AND prr_estado      = 'ACTIVO'
               AND prr_saldo       > 0;

            UPDATE RPJ_MNT_PRESTAMOS_REGIMEN
               SET prr_saldo  = GREATEST(prr_saldo - prr_valor_mes, 0),
                   prr_estado = CASE
                                  WHEN prr_saldo - prr_valor_mes <= 0 THEN 'OPERADA'
                                  ELSE 'ACTIVO'
                                END
             WHERE prr_id_jubilado = v_id_jubilado
               AND prr_tipo_manejo = 2
               AND prr_id_banco    = 2
               AND prr_estado      = 'ACTIVO'
               AND prr_saldo       > 0;

            -- DESCUENTO 7: PRESTAMO REGIMEN (tde_id = 7, prr_id_banco = 3)
            INSERT INTO RPJ_PRC_NOMINA_DESCUENTO (
                nde_tipo_manejo, nde_id_tipo_planilla, nde_id_planilla,
                nde_id_jubilado, nde_tipo_descuento, nde_valor,
                nde_dias_trabajados, nde_puesto, nde_area, nde_usuario_creacion
            )
            SELECT 2, 2, p_id_planilla,
                   v_id_jubilado, 7,
                   LEAST(prr_valor_mes, prr_saldo),
                   v_dias_trabajados, 'JUBILADO', 'ADMINISTRATIVA', p_usuario
              FROM RPJ_MNT_PRESTAMOS_REGIMEN
             WHERE prr_id_jubilado = v_id_jubilado
               AND prr_tipo_manejo = 2
               AND prr_id_banco    = 3          -- REGIMEN
               AND prr_estado      = 'ACTIVO'
               AND prr_saldo       > 0;

            UPDATE RPJ_MNT_PRESTAMOS_REGIMEN
               SET prr_saldo  = GREATEST(prr_saldo - prr_valor_mes, 0),
                   prr_estado = CASE
                                  WHEN prr_saldo - prr_valor_mes <= 0 THEN 'OPERADA'
                                  ELSE 'ACTIVO'
                                END
             WHERE prr_id_jubilado = v_id_jubilado
               AND prr_tipo_manejo = 2
               AND prr_id_banco    = 3
               AND prr_estado      = 'ACTIVO'
               AND prr_saldo       > 0;

            -- DESCUENTO 8: ASOCIACION (tde_id = 8)
            -- Monto fijo: par_desc_asociacion
            IF v_aplica_asociacion = TRUE
               AND v_monto_asociacion > 0 THEN
                INSERT INTO RPJ_PRC_NOMINA_DESCUENTO (
                    nde_tipo_manejo, nde_id_tipo_planilla, nde_id_planilla,
                    nde_id_jubilado, nde_tipo_descuento, nde_valor,
                    nde_dias_trabajados, nde_puesto, nde_area, nde_usuario_creacion
                ) VALUES (
                    2, 2, p_id_planilla,
                    v_id_jubilado, 8,
                    v_monto_asociacion,
                    v_dias_trabajados, 'JUBILADO', 'ADMINISTRATIVA', p_usuario
                );
            END IF;

            -- Acumular totales
            SELECT COALESCE(SUM(nde_valor), 0)
              INTO @desc_jub
              FROM RPJ_PRC_NOMINA_DESCUENTO
             WHERE nde_id_planilla = p_id_planilla
               AND nde_id_jubilado = v_id_jubilado;

            SET p_procesados   = p_procesados   + 1;
            SET p_total_pagado = p_total_pagado + v_total_ind;
            SET p_total_desc   = p_total_desc   + @desc_jub;

        END IF; -- fin aplica_nomina

    END LOOP loop_jub;

    CLOSE cur_jub;

    -- 5. Cambiar estado planilla a GENERADA
    UPDATE RPJ_CAT_PARAMETRO_PLANILLA
       SET ppl_estado_proceso   = 'GENERADA',
           ppl_fecha_generacion = NOW(),
           ppl_usuario_genera   = p_usuario
     WHERE ppl_correlativo = p_id_planilla;

    COMMIT;
END
$$
DELIMITER ;

DROP PROCEDURE IF EXISTS sp_reversar_pago_pensionado;
DELIMITER $$
CREATE PROCEDURE sp_reversar_pago_pensionado(
  IN p_id_planilla INT,
  IN p_id_jubilado INT,
  IN p_usuario     VARCHAR(50),
  IN p_motivo      VARCHAR(250)
)
BEGIN
    DECLARE v_estado VARCHAR(20);

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    SELECT ppl_estado_proceso INTO v_estado
      FROM RPJ_CAT_PARAMETRO_PLANILLA
     WHERE ppl_correlativo = p_id_planilla;

    IF v_estado NOT IN ('GENERADA','CERRADA') THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Solo se pueden reversar pagos en planillas GENERADAS o CERRADAS';
    END IF;

    START TRANSACTION;

    -- Restaurar deuda historica del jubilado
    UPDATE RPJ_PRC_DEUDA_JUBILADO d
     INNER JOIN RPJ_PRC_APLICACION_PAGO a
             ON a.apa_id_deuda = d.deu_correlativo
       SET d.deu_monto_pagado    = d.deu_monto_pagado    - a.apa_monto_aplicado,
           d.deu_monto_pendiente = d.deu_monto_pendiente + a.apa_monto_aplicado,
           d.deu_estado = CASE
                            WHEN d.deu_monto_pagado - a.apa_monto_aplicado <= 0
                            THEN 'PENDIENTE'
                            ELSE 'PARCIAL'
                          END,
           d.deu_fecha_saldada = NULL
     WHERE a.apa_id_planilla = p_id_planilla
       AND a.apa_id_jubilado  = p_id_jubilado;

    DELETE FROM RPJ_PRC_APLICACION_PAGO
     WHERE apa_id_planilla = p_id_planilla
       AND apa_id_jubilado  = p_id_jubilado;

    -- Restaurar prestamos (los 3 bancos)
    UPDATE RPJ_MNT_PRESTAMOS_REGIMEN p
     INNER JOIN RPJ_PRC_NOMINA_DESCUENTO n
             ON n.nde_id_jubilado = p.prr_id_jubilado
       SET p.prr_saldo  = p.prr_saldo + n.nde_valor,
           p.prr_estado = 'ACTIVO'
     WHERE n.nde_id_planilla      = p_id_planilla
       AND n.nde_id_jubilado      = p_id_jubilado
       AND p.prr_tipo_manejo      = 2
       AND n.nde_tipo_descuento  IN (5, 6, 7);

    -- Restaurar judiciales
    UPDATE RPJ_MNT_DESC_JUDICIALES j
     INNER JOIN RPJ_PRC_NOMINA_DESCUENTO n
             ON n.nde_id_jubilado = j.dju_id_jubilado
       SET j.dju_saldo  = j.dju_saldo + n.nde_valor,
           j.dju_estado = 'ACTIVO'
     WHERE n.nde_id_planilla     = p_id_planilla
       AND n.nde_id_jubilado     = p_id_jubilado
       AND j.dju_tipo_manejo     = 2
       AND n.nde_tipo_descuento  = 4;

    -- Eliminar registros del jubilado
    DELETE FROM RPJ_PRC_NOMINA_DESCUENTO
     WHERE nde_id_planilla = p_id_planilla
       AND nde_id_jubilado  = p_id_jubilado;

    DELETE FROM RPJ_PRC_NOMINA_INGRESO
     WHERE nin_id_planilla = p_id_planilla
       AND nin_id_jubilado  = p_id_jubilado;

    -- Bitacora
    INSERT INTO RPJ_LOG_REVERSOS (lre_id_planilla, lre_id_jubilado, lre_tipo_manejo, lre_tipo_reverso, lre_motivo, lre_usuario)
    VALUES (p_id_planilla, p_id_jubilado, 2, 'INDIVIDUAL', p_motivo, p_usuario);

    COMMIT;

    SELECT 'Pago del pensionado reversado correctamente' AS resultado;
END
$$
DELIMITER ;

DROP PROCEDURE IF EXISTS sp_reversar_planilla_pensionados;
DELIMITER $$
CREATE PROCEDURE sp_reversar_planilla_pensionados(
  IN p_id_planilla INT,
  IN p_usuario     VARCHAR(50),
  IN p_motivo      VARCHAR(250)
)
BEGIN
    DECLARE v_estado VARCHAR(20);

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    SELECT ppl_estado_proceso INTO v_estado
      FROM RPJ_CAT_PARAMETRO_PLANILLA
     WHERE ppl_correlativo = p_id_planilla;

    IF v_estado IS NULL THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Planilla no encontrada';
    END IF;

    IF v_estado NOT IN ('GENERADA','CERRADA') THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Solo se pueden reversar planillas GENERADAS o CERRADAS';
    END IF;

    START TRANSACTION;

    -- 1. Restaurar deudas historicas
    UPDATE RPJ_PRC_DEUDA_JUBILADO d
     INNER JOIN RPJ_PRC_APLICACION_PAGO a
             ON a.apa_id_deuda = d.deu_correlativo
       SET d.deu_monto_pagado    = d.deu_monto_pagado    - a.apa_monto_aplicado,
           d.deu_monto_pendiente = d.deu_monto_pendiente + a.apa_monto_aplicado,
           d.deu_estado = CASE
                            WHEN d.deu_monto_pagado - a.apa_monto_aplicado <= 0
                            THEN 'PENDIENTE'
                            ELSE 'PARCIAL'
                          END,
           d.deu_fecha_saldada = NULL
     WHERE a.apa_id_planilla = p_id_planilla;

    -- 2. Restaurar saldos de prestamos (los 3 bancos)
    UPDATE RPJ_MNT_PRESTAMOS_REGIMEN p
     INNER JOIN RPJ_PRC_NOMINA_DESCUENTO n
             ON n.nde_id_jubilado = p.prr_id_jubilado
      SET p.prr_saldo  = p.prr_saldo + n.nde_valor,
          p.prr_estado = 'ACTIVO'
    WHERE n.nde_id_planilla  = p_id_planilla
      AND p.prr_tipo_manejo  = 2
      AND n.nde_tipo_descuento IN (5, 6, 7);   -- BANRURAL, BANTRAB, REGIMEN

    -- 3. Restaurar saldos de judiciales
    UPDATE RPJ_MNT_DESC_JUDICIALES j
     INNER JOIN RPJ_PRC_NOMINA_DESCUENTO n
             ON n.nde_id_jubilado = j.dju_id_jubilado
       SET j.dju_saldo  = j.dju_saldo + n.nde_valor,
           j.dju_estado = 'ACTIVO'
     WHERE n.nde_id_planilla   = p_id_planilla
       AND j.dju_tipo_manejo   = 2
       AND n.nde_tipo_descuento = 4;           -- JUDICIAL

    -- 4. Eliminar registros de la planilla
    DELETE FROM RPJ_PRC_APLICACION_PAGO
     WHERE apa_id_planilla = p_id_planilla;

    DELETE FROM RPJ_PRC_NOMINA_DESCUENTO
     WHERE nde_id_planilla = p_id_planilla
       AND nde_tipo_manejo = 2;

    DELETE FROM RPJ_PRC_NOMINA_INGRESO
     WHERE nin_id_planilla = p_id_planilla
       AND nin_tipo_manejo = 2;

    -- 5. Cambiar estado
    UPDATE RPJ_CAT_PARAMETRO_PLANILLA
       SET ppl_estado_proceso = 'REVERSADA'
     WHERE ppl_correlativo = p_id_planilla;

    -- 6. Bitacora
    INSERT INTO RPJ_LOG_REVERSOS (lre_id_planilla, lre_tipo_manejo, lre_tipo_reverso, lre_motivo, lre_usuario)
    VALUES (p_id_planilla, 2, 'TOTAL', p_motivo, p_usuario);

    COMMIT;

    SELECT 'Planilla de pensionados reversada correctamente' AS resultado;
END
$$
DELIMITER ;
