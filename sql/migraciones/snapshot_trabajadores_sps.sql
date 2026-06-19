-- ============================================================================
-- SPs de TRABAJADORES (empleados regimen) - snapshot de produccion al repo.
-- Usan *_id_empleado (correcto: empleados = tipo_manejo 1). Sin cambios de
-- modelo; se versionan porque no existian en el repo.
-- ============================================================================

DROP PROCEDURE IF EXISTS sp_generar_nomina_trabajadores;
DELIMITER $$
CREATE PROCEDURE sp_generar_nomina_trabajadores(
  IN  p_id_planilla  INT,
  IN  p_usuario      VARCHAR(50),
  OUT p_procesados   INT,
  OUT p_excluidos    INT,
  OUT p_total_pagado DECIMAL(12,2),
  OUT p_total_desc   DECIMAL(12,2)
)
BEGIN
    -- Datos de la planilla
    DECLARE v_porcentaje        DECIMAL(5,2);
    DECLARE v_tipo_planilla     INT;
    DECLARE v_estado_proc       VARCHAR(20);
    DECLARE v_fecha_inicio      DATE;
    DECLARE v_fecha_final       DATE;

    -- Datos del empleado (cursor principal)
    DECLARE v_id_empleado       INT;
    DECLARE v_tipo_manejo       INT;
    DECLARE v_puesto            VARCHAR(100);
    DECLARE v_fecha_ingreso     DATE;
    DECLARE v_done_emp          BOOLEAN DEFAULT FALSE;

    -- Datos de RPJ_MNT_DATOS_PLANILLA
    DECLARE v_aplica_igss       BOOLEAN;
    DECLARE v_aplica_isr        BOOLEAN;
    DECLARE v_aplica_nomina     BOOLEAN;
    DECLARE v_tiene_datos       INT;

    -- Parametros generales
    DECLARE v_pct_igss          DECIMAL(5,2);
    DECLARE v_pct_isr           DECIMAL(5,2);

    -- Calculo de dias
    DECLARE v_dias_periodo      INT;
    DECLARE v_dias_trabajados   INT;
    DECLARE v_factor_dias       DECIMAL(10,6);

    -- Ingresos del empleado (cursor secundario)
    DECLARE v_sal_correlativo   INT;
    DECLARE v_sal_tipo_ingreso  INT;
    DECLARE v_sal_salario       DECIMAL(12,2);
    DECLARE v_done_sal          BOOLEAN DEFAULT FALSE;
    DECLARE v_es_primer_ingreso BOOLEAN;
    DECLARE v_salario_base      DECIMAL(12,2);
    DECLARE v_valor_ingreso     DECIMAL(12,2);
    DECLARE v_total_ingresos_emp DECIMAL(12,2);

    -- IDs de tipos de descuento
    DECLARE v_id_tipo_igss      INT;
    DECLARE v_id_tipo_isr       INT;
    DECLARE v_id_tipo_prest     INT;
    DECLARE v_id_tipo_judic     INT;

    -- Cursor principal: empleados activos tipo_manejo = 1
    DECLARE cur_empleados CURSOR FOR
        SELECT e.emp_correlativo,
               e.emp_tipo_manejo,
               e.emp_profesion_oficio,
               e.emp_fecha_ingreso
          FROM RPJ_MNT_EMPLEADO e
         WHERE e.emp_tipo_manejo = 1
           AND e.emp_estado      = 'ACTIVO';

    -- Cursor secundario: ingresos del empleado (ordenado por correlativo ASC
    --   para que el primer registro sea el salario base)
    DECLARE cur_salarios CURSOR FOR
        SELECT s.sal_correlativo,
               s.sal_tipo_ingreso,
               s.sal_salario
          FROM RPJ_MNT_SALARIO s
         WHERE s.sal_id_empleado  = v_id_empleado
           AND s.sal_tipo_manejo  = 1
         ORDER BY s.sal_correlativo ASC;

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done_emp = TRUE;
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

    -- 1. Validar planilla
    SELECT ppl_porcentaje_pago,
           ppl_tipo_planilla,
           ppl_estado_proceso,
           ppl_fecha_inicio,
           ppl_fecha_final
      INTO v_porcentaje, v_tipo_planilla, v_estado_proc,
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

    -- 3. Parametros generales (IGSS, ISR)
    SELECT par_igss, par_isr
      INTO v_pct_igss, v_pct_isr
      FROM RPJ_CAT_PARAMETRO_GENERAL
     ORDER BY par_id DESC LIMIT 1;

    -- 4. Tipos de descuento
    SELECT tde_id INTO v_id_tipo_igss
      FROM RPJ_CAT_TIPO_DESCUENTO
     WHERE UPPER(tde_tipo_descuento) = 'IGSS' LIMIT 1;

    SELECT tde_id INTO v_id_tipo_isr
      FROM RPJ_CAT_TIPO_DESCUENTO
     WHERE UPPER(tde_tipo_descuento) = 'ISR' LIMIT 1;

    SELECT tde_id INTO v_id_tipo_prest
      FROM RPJ_CAT_TIPO_DESCUENTO
     WHERE UPPER(tde_tipo_descuento) IN ('PRESTAMO','PRESTAMOS') LIMIT 1;

    SELECT tde_id INTO v_id_tipo_judic
      FROM RPJ_CAT_TIPO_DESCUENTO
     WHERE UPPER(tde_tipo_descuento) IN ('JUDICIAL','JUDICIALES') LIMIT 1;

    START TRANSACTION;

    -- 5. Recorrer empleados
    -- Reset del flag NOT FOUND por si algun SELECT INTO previo (lookups de
    -- tipos de descuento) no encontro fila y lo activo antes de tiempo.
    SET v_done_emp = FALSE;
    OPEN cur_empleados;

    loop_emp: LOOP
        FETCH cur_empleados
          INTO v_id_empleado, v_tipo_manejo,
               v_puesto, v_fecha_ingreso;

        IF v_done_emp THEN LEAVE loop_emp; END IF;

        -- 5a. Verificar dat_aplica_nomina
        SET v_aplica_igss   = FALSE;
        SET v_aplica_isr    = FALSE;
        SET v_aplica_nomina = FALSE;
        SET v_tiene_datos   = 0;

        SELECT COUNT(*),
               MAX(dat_aplica_desc_igss),
               MAX(dat_aplica_desc_isr),
               MAX(dat_aplica_nomina)
          INTO v_tiene_datos,
               v_aplica_igss,
               v_aplica_isr,
               v_aplica_nomina
          FROM RPJ_MNT_DATOS_PLANILLA
         WHERE dat_id_empleado = v_id_empleado
           AND dat_tipo_manejo = 1;

        IF v_tiene_datos = 0 OR v_aplica_nomina = FALSE THEN
            -- Excluir este empleado
            SET p_excluidos = p_excluidos + 1;
        ELSE
            -- 5b. Calcular factor de dias
            --     Si emp_fecha_ingreso cae dentro del periodo -> proporcional
            --     Si es anterior al inicio del periodo        -> factor = 1
            IF v_fecha_ingreso >= v_fecha_inicio
               AND v_fecha_ingreso <= v_fecha_final THEN
                -- Dias desde la fecha de ingreso hasta el fin del periodo
                SET v_dias_trabajados = DATEDIFF(v_fecha_final, v_fecha_ingreso) + 1;
                SET v_factor_dias = v_dias_trabajados / v_dias_periodo;
            ELSE
                SET v_dias_trabajados = v_dias_periodo;
                SET v_factor_dias     = 1.0;
            END IF;

            -- 5c. Recorrer cada tipo de ingreso del empleado
            SET v_es_primer_ingreso    = TRUE;
            SET v_salario_base         = 0.00;
            SET v_total_ingresos_emp   = 0.00;
            SET v_done_sal             = FALSE;

            OPEN cur_salarios;

            loop_sal: LOOP
                FETCH cur_salarios
                  INTO v_sal_correlativo,
                       v_sal_tipo_ingreso,
                       v_sal_salario;

                -- El handler NOT FOUND (compartido) activa v_done_emp al
                -- agotar este cursor. Se evalua aqui para salir del loop
                -- interno y se restaura despues de CLOSE.
                IF v_done_emp THEN LEAVE loop_sal; END IF;

                -- Valor proporcional segun dias trabajados y porcentaje de la planilla
                SET v_valor_ingreso = ROUND(
                    v_sal_salario
                    * v_factor_dias
                    * v_porcentaje / 100,
                    2
                );

                -- El primer registro es el salario base (para IGSS/ISR)
                IF v_es_primer_ingreso THEN
                    SET v_salario_base      = v_valor_ingreso;
                    SET v_es_primer_ingreso = FALSE;
                END IF;

                -- Insertar renglon de ingreso
                INSERT INTO RPJ_PRC_NOMINA_INGRESO (
                    nin_tipo_manejo,
                    nin_id_tipo_planilla,
                    nin_id_planilla,
                    nin_id_empleado,
                    nin_tipo_ingreso,
                    nin_valor,
                    nin_valor_teorico,
                    nin_porcentaje_aplicado,
                    nin_pago_corriente,
                    nin_abono_historico,
                    nin_dias_trabajados,
                    nin_puesto,
                    nin_area,
                    nin_usuario_creacion
                ) VALUES (
                    1,
                    v_tipo_planilla,
                    p_id_planilla,
                    v_id_empleado,
                    v_sal_tipo_ingreso,
                    v_valor_ingreso,
                    v_sal_salario,
                    v_porcentaje,
                    v_valor_ingreso,
                    0.00,
                    v_dias_trabajados,
                    v_puesto,
                    'TRABAJADORES',
                    p_usuario
                );

                SET v_total_ingresos_emp = v_total_ingresos_emp + v_valor_ingreso;

            END LOOP loop_sal;

            CLOSE cur_salarios;
            -- Restaurar el flag: el NOT FOUND fue por agotar cur_salarios,
            -- no por agotar cur_empleados. Sin esto el loop externo terminaria
            -- prematuramente tras el primer empleado.
            SET v_done_emp = FALSE;

            -- 5d. Descuento IGSS (sobre salario base)
            IF v_aplica_igss = TRUE
               AND v_id_tipo_igss IS NOT NULL
               AND v_pct_igss > 0
               AND v_salario_base > 0 THEN

                INSERT INTO RPJ_PRC_NOMINA_DESCUENTO (
                    nde_tipo_manejo, nde_id_tipo_planilla, nde_id_planilla,
                    nde_id_empleado, nde_tipo_descuento, nde_valor,
                    nde_dias_trabajados, nde_puesto, nde_area, nde_usuario_creacion
                ) VALUES (
                    1, v_tipo_planilla, p_id_planilla,
                    v_id_empleado, v_id_tipo_igss,
                    ROUND(v_salario_base * v_pct_igss / 100, 2),
                    v_dias_trabajados, v_puesto, 'TRABAJADORES', p_usuario
                );
            END IF;

            -- 5e. Descuento ISR (sobre salario base)
            IF v_aplica_isr = TRUE
               AND v_id_tipo_isr IS NOT NULL
               AND v_pct_isr > 0
               AND v_salario_base > 0 THEN

                INSERT INTO RPJ_PRC_NOMINA_DESCUENTO (
                    nde_tipo_manejo, nde_id_tipo_planilla, nde_id_planilla,
                    nde_id_empleado, nde_tipo_descuento, nde_valor,
                    nde_dias_trabajados, nde_puesto, nde_area, nde_usuario_creacion
                ) VALUES (
                    1, v_tipo_planilla, p_id_planilla,
                    v_id_empleado, v_id_tipo_isr,
                    ROUND(v_salario_base * v_pct_isr / 100, 2),
                    v_dias_trabajados, v_puesto, 'TRABAJADORES', p_usuario
                );
            END IF;

            -- 5f. Prestamos activos
            IF v_id_tipo_prest IS NOT NULL THEN
                INSERT INTO RPJ_PRC_NOMINA_DESCUENTO (
                    nde_tipo_manejo, nde_id_tipo_planilla, nde_id_planilla,
                    nde_id_empleado, nde_tipo_descuento, nde_valor,
                    nde_dias_trabajados, nde_puesto, nde_area, nde_usuario_creacion
                )
                SELECT 1, v_tipo_planilla, p_id_planilla,
                       v_id_empleado, v_id_tipo_prest,
                       LEAST(prr_valor_mes, prr_saldo),
                       v_dias_trabajados, v_puesto, 'TRABAJADORES', p_usuario
                  FROM RPJ_MNT_PRESTAMOS_REGIMEN
                 WHERE prr_id_empleado = v_id_empleado
                   AND prr_tipo_manejo = 1
                   AND prr_estado      = 'ACTIVO'
                   AND prr_saldo       > 0;

                UPDATE RPJ_MNT_PRESTAMOS_REGIMEN
                   SET prr_saldo  = GREATEST(prr_saldo - prr_valor_mes, 0),
                       prr_estado = CASE
                                      WHEN prr_saldo - prr_valor_mes <= 0
                                      THEN 'CANCELADO'
                                      ELSE 'ACTIVO'
                                    END
                 WHERE prr_id_empleado = v_id_empleado
                   AND prr_tipo_manejo = 1
                   AND prr_estado      = 'ACTIVO'
                   AND prr_saldo       > 0;
            END IF;

            -- 5g. Descuentos judiciales activos
            IF v_id_tipo_judic IS NOT NULL THEN
                INSERT INTO RPJ_PRC_NOMINA_DESCUENTO (
                    nde_tipo_manejo, nde_id_tipo_planilla, nde_id_planilla,
                    nde_id_empleado, nde_tipo_descuento, nde_valor,
                    nde_dias_trabajados, nde_puesto, nde_area, nde_usuario_creacion
                )
                SELECT 1, v_tipo_planilla, p_id_planilla,
                       v_id_empleado, v_id_tipo_judic,
                       LEAST(dju_valor, dju_saldo),
                       v_dias_trabajados, v_puesto, 'TRABAJADORES', p_usuario
                  FROM RPJ_MNT_DESC_JUDICIALES
                 WHERE dju_id_empleado = v_id_empleado
                   AND dju_tipo_manejo = 1
                   AND dju_estado      = 'ACTIVO'
                   AND dju_saldo       > 0;

                UPDATE RPJ_MNT_DESC_JUDICIALES
                   SET dju_saldo  = GREATEST(dju_saldo - dju_valor, 0),
                       dju_estado = CASE
                                      WHEN dju_saldo - dju_valor <= 0
                                      THEN 'CANCELADO'
                                      ELSE 'ACTIVO'
                                    END
                 WHERE dju_id_empleado = v_id_empleado
                   AND dju_tipo_manejo = 1
                   AND dju_estado      = 'ACTIVO'
                   AND dju_saldo       > 0;
            END IF;

            -- 5h. Acumular totales
            SELECT COALESCE(SUM(nde_valor), 0)
              INTO @desc_emp
              FROM RPJ_PRC_NOMINA_DESCUENTO
             WHERE nde_id_planilla = p_id_planilla
               AND nde_id_empleado = v_id_empleado;

            SET p_procesados   = p_procesados   + 1;
            SET p_total_pagado = p_total_pagado + v_total_ingresos_emp;
            SET p_total_desc   = p_total_desc   + @desc_emp;

        END IF; -- fin aplica_nomina

        -- Resetear handler para el siguiente empleado
        SET v_done_sal = FALSE;

    END LOOP loop_emp;

    CLOSE cur_empleados;

    -- 6. Cambiar estado de planilla a GENERADA
    UPDATE RPJ_CAT_PARAMETRO_PLANILLA
       SET ppl_estado_proceso    = 'GENERADA',
           ppl_fecha_generacion  = NOW(),
           ppl_usuario_genera    = p_usuario
     WHERE ppl_correlativo = p_id_planilla;

    COMMIT;
END
$$
DELIMITER ;

DROP PROCEDURE IF EXISTS sp_reversar_pago_trabajador;
DELIMITER $$
CREATE PROCEDURE sp_reversar_pago_trabajador(
  IN p_id_planilla INT,
  IN p_id_empleado INT,
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

    -- Restaurar prestamos del empleado
    UPDATE RPJ_MNT_PRESTAMOS_REGIMEN p
     INNER JOIN RPJ_PRC_NOMINA_DESCUENTO n
        ON n.nde_id_empleado = p.prr_id_empleado
     INNER JOIN RPJ_CAT_TIPO_DESCUENTO td
        ON td.tde_id = n.nde_tipo_descuento
       SET p.prr_saldo  = p.prr_saldo + n.nde_valor,
           p.prr_estado = 'ACTIVO'
     WHERE n.nde_id_planilla = p_id_planilla
       AND n.nde_id_empleado = p_id_empleado
       AND p.prr_tipo_manejo = 1
       AND UPPER(td.tde_tipo_descuento) IN ('PRESTAMO','PRESTAMOS');

    -- Restaurar judiciales del empleado
    UPDATE RPJ_MNT_DESC_JUDICIALES j
     INNER JOIN RPJ_PRC_NOMINA_DESCUENTO n
        ON n.nde_id_empleado = j.dju_id_empleado
     INNER JOIN RPJ_CAT_TIPO_DESCUENTO td
        ON td.tde_id = n.nde_tipo_descuento
       SET j.dju_saldo  = j.dju_saldo + n.nde_valor,
           j.dju_estado = 'ACTIVO'
     WHERE n.nde_id_planilla = p_id_planilla
       AND n.nde_id_empleado = p_id_empleado
       AND j.dju_tipo_manejo = 1
       AND UPPER(td.tde_tipo_descuento) IN ('JUDICIAL','JUDICIALES');

    -- Eliminar registros del empleado
    DELETE FROM RPJ_PRC_NOMINA_DESCUENTO
     WHERE nde_id_planilla = p_id_planilla
       AND nde_id_empleado = p_id_empleado;

    DELETE FROM RPJ_PRC_NOMINA_INGRESO
     WHERE nin_id_planilla = p_id_planilla
       AND nin_id_empleado = p_id_empleado;

    -- Bitacora
    INSERT INTO RPJ_LOG_REVERSOS
        (lre_id_planilla, lre_id_empleado, lre_tipo_manejo, lre_tipo_reverso, lre_motivo, lre_usuario)
    VALUES (
        p_id_planilla,
        p_id_empleado,
        1,
        'INDIVIDUAL',
        CONCAT('Reverso individual empleado ', p_id_empleado, ': ', p_motivo),
        p_usuario
    );

    COMMIT;

    SELECT 'Pago del trabajador reversado correctamente' AS resultado;
END
$$
DELIMITER ;

DROP PROCEDURE IF EXISTS sp_reversar_planilla_trabajadores;
DELIMITER $$
CREATE PROCEDURE sp_reversar_planilla_trabajadores(
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
        (lre_id_planilla, lre_tipo_manejo, lre_tipo_reverso, lre_motivo, lre_usuario)
    VALUES
        (p_id_planilla, 1, 'TOTAL', p_motivo, p_usuario);

    COMMIT;

    SELECT 'Planilla de trabajadores reversada correctamente' AS resultado;
END
$$
DELIMITER ;
