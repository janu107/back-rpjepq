BEGIN
    DECLARE v_id_jubilado INT;
    DECLARE v_deudas_jub  INT;
    DECLARE v_done        BOOLEAN DEFAULT FALSE;

    DECLARE cur_jub CURSOR FOR
        SELECT jub_correlativo
          FROM RPJ_MNT_JUBILADO
         WHERE jub_tipo_manejo = 2
           AND jub_estado      = 'ACTIVO';

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = TRUE;

    SET p_jubilados_procesados = 0;
    SET p_total_deudas         = 0;

    OPEN cur_jub;
    loop_jub: LOOP
        FETCH cur_jub INTO v_id_jubilado;
        IF v_done THEN LEAVE loop_jub; END IF;

        CALL sp_generar_deuda_historica(
            v_id_jubilado, p_periodo_final,
            p_porcentaje_pago, p_usuario, v_deudas_jub
        );

        SET p_jubilados_procesados = p_jubilados_procesados + 1;
        SET p_total_deudas         = p_total_deudas + IFNULL(v_deudas_jub, 0);
    END LOOP;
    CLOSE cur_jub;
END
