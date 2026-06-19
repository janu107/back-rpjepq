BEGIN
    DECLARE v_fecha_jub       DATE;
    DECLARE v_tipo_manejo     INT;
    DECLARE v_pension         DECIMAL(12,2);
    DECLARE v_periodo_inicial INT;
    DECLARE v_periodo         INT;
    DECLARE v_anio            INT;
    DECLARE v_mes             INT;
    DECLARE v_monto_pendiente DECIMAL(12,2);
    DECLARE v_count_antes     INT;
    DECLARE v_count_despues   INT;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    -- Leer datos del jubilado
    SELECT j.jub_fecha_jubilacion,
           j.jub_tipo_manejo,
           s.sal_salario
      INTO v_fecha_jub, v_tipo_manejo, v_pension
      FROM RPJ_MNT_JUBILADO j
      LEFT JOIN RPJ_MNT_SALARIO s
             ON s.sal_id_jubilado  = j.jub_correlativo
            AND s.sal_tipo_manejo  = 2
            AND s.sal_tipo_ingreso = 1        -- SALARIO INICIAL
     WHERE j.jub_correlativo = p_id_jubilado
     LIMIT 1;

    IF v_fecha_jub IS NULL THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Jubilado no encontrado';
    END IF;

    IF v_tipo_manejo != 2 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'El registro no es un pensionado (tipo_manejo debe ser 2)';
    END IF;

    IF v_pension IS NULL OR v_pension <= 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'El jubilado no tiene pension configurada en RPJ_MNT_SALARIO';
    END IF;

    -- Periodo inicial desde la fecha de jubilacion
    SET v_periodo_inicial = YEAR(v_fecha_jub) * 100 + MONTH(v_fecha_jub);
    SET p_deudas_generadas = 0;

    IF v_periodo_inicial > p_periodo_final THEN
        SELECT 'Sin deudas: jubilacion posterior al periodo final' AS resultado;
    ELSE
        SET v_monto_pendiente = ROUND(v_pension * (100 - p_porcentaje_pago) / 100, 2);
        SET v_periodo = v_periodo_inicial;

        SELECT COUNT(*) INTO v_count_antes
          FROM RPJ_PRC_DEUDA_JUBILADO
         WHERE deu_id_jubilado = p_id_jubilado;

        START TRANSACTION;

        WHILE v_periodo <= p_periodo_final DO

            INSERT IGNORE INTO RPJ_PRC_DEUDA_JUBILADO (
                deu_id_jubilado, deu_periodo,
                deu_monto_original, deu_monto_pagado, deu_monto_pendiente,
                deu_estado, deu_fecha_generacion,
                deu_observaciones, deu_usuario_creacion
            ) VALUES (
                p_id_jubilado, v_periodo,
                v_pension, 0.00, v_monto_pendiente,
                'PENDIENTE',
                STR_TO_DATE(CONCAT(v_periodo, '01'), '%Y%m%d'),
                CONCAT('Generada desde jub_fecha_jubilacion (', v_fecha_jub, ')'),
                p_usuario
            );

            -- Avanzar al siguiente mes
            SET v_anio = FLOOR(v_periodo / 100);
            SET v_mes  = v_periodo MOD 100;
            IF v_mes = 12 THEN
                SET v_anio = v_anio + 1;
                SET v_mes  = 1;
            ELSE
                SET v_mes = v_mes + 1;
            END IF;
            SET v_periodo = v_anio * 100 + v_mes;

        END WHILE;

        COMMIT;

        SELECT COUNT(*) INTO v_count_despues
          FROM RPJ_PRC_DEUDA_JUBILADO
         WHERE deu_id_jubilado = p_id_jubilado;

        SET p_deudas_generadas = v_count_despues - v_count_antes;
    END IF;
END
