BEGIN
    DECLARE v_estado VARCHAR(20);

    SELECT ppl_estado_proceso INTO v_estado
      FROM RPJ_CAT_PARAMETRO_PLANILLA
     WHERE ppl_correlativo = p_id_planilla;

    IF v_estado IS NULL THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Planilla no encontrada';
    END IF;

    IF v_estado != 'GENERADA' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Solo se puede cerrar una planilla en estado GENERADA';
    END IF;

    UPDATE RPJ_CAT_PARAMETRO_PLANILLA
       SET ppl_estado_proceso = 'CERRADA',
           ppl_fecha_cierre   = NOW(),
           ppl_usuario_cierra = p_usuario
     WHERE ppl_correlativo = p_id_planilla;

    SELECT 'Planilla cerrada correctamente' AS resultado;
END
