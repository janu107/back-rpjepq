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

    -- Restaurar saldos de prestamos
    UPDATE RPJ_MNT_PRESTAMOS_REGIMEN p
     INNER JOIN RPJ_PRC_NOMINA_DESCUENTO n
        ON n.nde_id_empleado = p.prr_id_empleado
     INNER JOIN RPJ_CAT_TIPO_DESCUENTO td
        ON td.tde_id = n.nde_tipo_descuento
       SET p.prr_saldo  = p.prr_saldo + n.nde_valor,
           p.prr_estado = 'ACTIVO'
     WHERE n.nde_id_planilla = p_id_planilla
       AND p.prr_tipo_manejo = 1
       AND UPPER(td.tde_tipo_descuento) IN ('PRESTAMO','PRESTAMOS');

    -- Restaurar saldos de judiciales
    UPDATE RPJ_MNT_DESC_JUDICIALES j
     INNER JOIN RPJ_PRC_NOMINA_DESCUENTO n
        ON n.nde_id_empleado = j.dju_id_empleado
     INNER JOIN RPJ_CAT_TIPO_DESCUENTO td
        ON td.tde_id = n.nde_tipo_descuento
       SET j.dju_saldo  = j.dju_saldo + n.nde_valor,
           j.dju_estado = 'ACTIVO'
     WHERE n.nde_id_planilla = p_id_planilla
       AND j.dju_tipo_manejo = 1
       AND UPPER(td.tde_tipo_descuento) IN ('JUDICIAL','JUDICIALES');

    -- Eliminar registros de la planilla (tipo_manejo = 1)
    DELETE FROM RPJ_PRC_NOMINA_DESCUENTO
     WHERE nde_id_planilla = p_id_planilla
       AND nde_tipo_manejo = 1;

    DELETE FROM RPJ_PRC_NOMINA_INGRESO
     WHERE nin_id_planilla = p_id_planilla
       AND nin_tipo_manejo = 1;

    -- Cambiar estado
    UPDATE RPJ_CAT_PARAMETRO_PLANILLA
       SET ppl_estado_proceso = 'REVERSADA'
     WHERE ppl_correlativo = p_id_planilla;

    -- Bitacora
    INSERT INTO RPJ_LOG_REVERSOS
        (lre_id_planilla, lre_motivo, lre_usuario)
    VALUES
        (p_id_planilla, p_motivo, p_usuario);

    COMMIT;

    SELECT 'Planilla de trabajadores reversada correctamente' AS resultado;
END
