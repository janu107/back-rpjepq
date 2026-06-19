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
             ON n.nde_id_jubilado = p.prr_id_empleado
       SET p.prr_saldo  = p.prr_saldo + n.nde_valor,
           p.prr_estado = 'ACTIVO'
     WHERE n.nde_id_planilla      = p_id_planilla
       AND n.nde_id_jubilado      = p_id_jubilado
       AND p.prr_tipo_manejo      = 2
       AND n.nde_tipo_descuento  IN (5, 6, 7);

    -- Restaurar judiciales
    UPDATE RPJ_MNT_DESC_JUDICIALES j
     INNER JOIN RPJ_PRC_NOMINA_DESCUENTO n
             ON n.nde_id_jubilado = j.dju_id_empleado
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
    INSERT INTO RPJ_LOG_REVERSOS (lre_id_planilla, lre_id_jubilado, lre_motivo, lre_usuario)
    VALUES (p_id_planilla, p_id_jubilado, p_motivo, p_usuario);

    COMMIT;

    SELECT 'Pago del pensionado reversado correctamente' AS resultado;
END
