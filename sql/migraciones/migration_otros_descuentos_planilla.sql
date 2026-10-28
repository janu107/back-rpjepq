-- ============================================================================
-- Otros descuentos (extraordinarios) por persona y planilla. Idempotente.
--   - RPJ_MNT_OTRO_DESCUENTO: empleado o jubilado, período (YYYYMM) y estado.
--   - sp_generar_nomina_pensionados y sp_generar_nomina_trabajadores agregan los
--     descuentos ACTIVOS del período al generar (y de nuevo al reversar y generar).
-- ============================================================================

SET @existe := (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'RPJ_MNT_OTRO_DESCUENTO' AND COLUMN_NAME = 'ode_periodo');
SET @ddl := IF(@existe = 0,
  'ALTER TABLE RPJ_MNT_OTRO_DESCUENTO ADD COLUMN ode_id_empleado INT NULL AFTER ode_tipo_manejo, ADD COLUMN ode_id_jubilado INT NULL AFTER ode_id_empleado, ADD COLUMN ode_periodo INT NOT NULL DEFAULT 0 AFTER ode_id_jubilado, ADD COLUMN ode_estado VARCHAR(20) NOT NULL DEFAULT ''ACTIVO'' AFTER ode_fecha, ADD COLUMN ode_fecha_modificacion DATETIME NULL, ADD COLUMN ode_usuario_modificacion VARCHAR(50) NULL, ADD INDEX ix_ode_periodo (ode_tipo_manejo, ode_periodo, ode_estado)',
  'SELECT 1');
PREPARE st FROM @ddl;
EXECUTE st;
DEALLOCATE PREPARE st;

-- Generación de nómina de empleados régimen (definición vigente + otros descuentos)
DROP PROCEDURE IF EXISTS sp_generar_nomina_trabajadores;
DELIMITER $$
CREATE PROCEDURE `sp_generar_nomina_trabajadores`(
  IN  p_id_planilla  INT,
  IN  p_usuario      VARCHAR(50),
  OUT p_procesados   INT,
  OUT p_excluidos    INT,
  OUT p_total_pagado DECIMAL(12,2),
  OUT p_total_desc   DECIMAL(12,2)
)
BEGIN
    
    DECLARE v_porcentaje        DECIMAL(5,2);
    DECLARE v_tipo_planilla     INT;
    DECLARE v_estado_proc       VARCHAR(20);
    DECLARE v_fecha_inicio      DATE;
    DECLARE v_fecha_final       DATE;

    
    DECLARE v_id_empleado       INT;
    DECLARE v_tipo_manejo       INT;
    DECLARE v_puesto            VARCHAR(100);
    DECLARE v_fecha_ingreso     DATE;
    DECLARE v_done_emp          BOOLEAN DEFAULT FALSE;

    
    DECLARE v_aplica_igss       BOOLEAN;
    DECLARE v_aplica_isr        BOOLEAN;
    DECLARE v_aplica_nomina     BOOLEAN;
    DECLARE v_tiene_datos       INT;

    
    DECLARE v_pct_igss          DECIMAL(5,2);
    DECLARE v_pct_isr           DECIMAL(5,2);

    
    DECLARE v_dias_periodo      INT;
    DECLARE v_dias_trabajados   INT;
    DECLARE v_factor_dias       DECIMAL(10,6);

    
    DECLARE v_sal_correlativo   INT;
    DECLARE v_sal_tipo_ingreso  INT;
    DECLARE v_sal_salario       DECIMAL(12,2);
    DECLARE v_done_sal          BOOLEAN DEFAULT FALSE;
    DECLARE v_es_primer_ingreso BOOLEAN;
    DECLARE v_salario_base      DECIMAL(12,2);
    DECLARE v_valor_ingreso     DECIMAL(12,2);
    DECLARE v_total_ingresos_emp DECIMAL(12,2);

    
    DECLARE v_id_tipo_igss      INT;
    DECLARE v_id_tipo_isr       INT;
    DECLARE v_id_tipo_prest     INT;
    DECLARE v_id_tipo_judic     INT;

    
    
    
    DECLARE cur_empleados CURSOR FOR
        SELECT e.emp_correlativo,
               e.emp_tipo_manejo,
               e.emp_profesion_oficio,
               e.emp_fecha_ingreso
          FROM RPJ_MNT_EMPLEADO e
         WHERE e.emp_tipo_manejo = 1
           AND UPPER(COALESCE(e.emp_estado, 'ACTIVO')) <> 'INACTIVO';

    
    
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

    
    SET p_procesados   = 0;
    SET p_excluidos    = 0;
    SET p_total_pagado = 0.00;
    SET p_total_desc   = 0.00;

    
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

    
    
    IF v_estado_proc NOT IN ('ABIERTA', 'REVERSADA') THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Solo se puede generar nomina si la planilla esta ABIERTA o REVERSADA';
    END IF;

    
    SET v_dias_periodo = DATEDIFF(v_fecha_final, v_fecha_inicio) + 1;

    
    SELECT par_igss, par_isr
      INTO v_pct_igss, v_pct_isr
      FROM RPJ_CAT_PARAMETRO_GENERAL
     ORDER BY par_id DESC LIMIT 1;

    
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

    
    
    
    DELETE FROM RPJ_PRC_NOMINA_DESCUENTO
     WHERE nde_id_planilla = p_id_planilla AND nde_tipo_manejo = 1;
    DELETE FROM RPJ_PRC_NOMINA_INGRESO
     WHERE nin_id_planilla = p_id_planilla AND nin_tipo_manejo = 1;

    
    
    
    SET v_done_emp = FALSE;
    OPEN cur_empleados;

    loop_emp: LOOP
        FETCH cur_empleados
          INTO v_id_empleado, v_tipo_manejo,
               v_puesto, v_fecha_ingreso;

        IF v_done_emp THEN LEAVE loop_emp; END IF;

        
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
            
            SET p_excluidos = p_excluidos + 1;
        ELSE
            
            
            
            IF v_fecha_ingreso >= v_fecha_inicio
               AND v_fecha_ingreso <= v_fecha_final THEN
                
                SET v_dias_trabajados = DATEDIFF(v_fecha_final, v_fecha_ingreso) + 1;
                SET v_factor_dias = v_dias_trabajados / v_dias_periodo;
            ELSE
                SET v_dias_trabajados = v_dias_periodo;
                SET v_factor_dias     = 1.0;
            END IF;

            
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

                
                
                
                IF v_done_emp THEN LEAVE loop_sal; END IF;

                
                SET v_valor_ingreso = ROUND(
                    v_sal_salario
                    * v_factor_dias
                    * v_porcentaje / 100,
                    2
                );

                
                IF v_es_primer_ingreso THEN
                    SET v_salario_base      = v_valor_ingreso;
                    SET v_es_primer_ingreso = FALSE;
                END IF;

                
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
            
            
            
            SET v_done_emp = FALSE;

            
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

            
            -- Otros descuentos (extraordinarios) cargados para el empleado en esta
            -- planilla de nómina régimen (catálogo Otros descuentos, por período).
            IF v_tipo_planilla = 1 THEN
                INSERT INTO RPJ_PRC_NOMINA_DESCUENTO (
                    nde_tipo_manejo, nde_id_tipo_planilla, nde_id_planilla,
                    nde_id_empleado, nde_tipo_descuento, nde_valor,
                    nde_dias_trabajados, nde_puesto, nde_area, nde_usuario_creacion
                )
                SELECT 1, v_tipo_planilla, p_id_planilla,
                       v_id_empleado, o.ode_tipo_descuento, o.ode_valor,
                       v_dias_trabajados, v_puesto, 'TRABAJADORES', p_usuario
                  FROM RPJ_MNT_OTRO_DESCUENTO o
                 WHERE o.ode_tipo_manejo = 1
                   AND o.ode_id_empleado = v_id_empleado
                   AND o.ode_estado      = 'ACTIVO'
                   AND o.ode_periodo     = (SELECT ppl_numero FROM RPJ_CAT_PARAMETRO_PLANILLA WHERE ppl_correlativo = p_id_planilla);
            END IF;

            SELECT COALESCE(SUM(nde_valor), 0)
              INTO @desc_emp
              FROM RPJ_PRC_NOMINA_DESCUENTO
             WHERE nde_id_planilla = p_id_planilla
               AND nde_id_empleado = v_id_empleado;

            SET p_procesados   = p_procesados   + 1;
            SET p_total_pagado = p_total_pagado + v_total_ingresos_emp;
            SET p_total_desc   = p_total_desc   + @desc_emp;

        END IF; 

        
        SET v_done_sal = FALSE;

    END LOOP loop_emp;

    CLOSE cur_empleados;

    
    UPDATE RPJ_CAT_PARAMETRO_PLANILLA
       SET ppl_estado_proceso    = 'GENERADA',
           ppl_fecha_generacion  = NOW(),
           ppl_usuario_genera    = p_usuario
     WHERE ppl_correlativo = p_id_planilla;

    COMMIT;
END$$
DELIMITER ;

-- Generación de nómina de jubilados (igual a migration_regla_50_liquido.sql)
DROP PROCEDURE IF EXISTS sp_generar_nomina_pensionados;
DELIMITER $$
CREATE PROCEDURE sp_generar_nomina_pensionados(
    IN p_id_planilla INT,
    IN p_tipo_ingreso INT,
    IN p_usuario VARCHAR(50),
    OUT p_procesados INT,
    OUT p_excluidos INT,
    OUT p_total_pagado DECIMAL(12,2),
    OUT p_total_desc DECIMAL(12,2)
)
BEGIN
    DECLARE v_tin_pension       INT DEFAULT 1;
    DECLARE v_porcentaje        DECIMAL(5,2);
    DECLARE v_estado_proc       VARCHAR(20);
    DECLARE v_fecha_inicio      DATE;
    DECLARE v_fecha_final       DATE;
    DECLARE v_periodo_pla       INT;
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
    DECLARE v_pension_prop      DECIMAL(12,2);
    DECLARE v_desc_total        DECIMAL(12,2);
    DECLARE v_liquido           DECIMAL(12,2);
    DECLARE v_pago              DECIMAL(12,2);
    DECLARE v_disponible        DECIMAL(12,2);
    DECLARE v_pago_mes          DECIMAL(12,2);
    DECLARE v_abono_anterior    DECIMAL(12,2);
    DECLARE v_abono             DECIMAL(12,2);
    DECLARE v_id_deuda          INT;
    DECLARE v_periodo_deuda     INT;
    DECLARE v_pendiente_deuda   DECIMAL(12,2);
    DECLARE v_primera_deuda     INT;
    DECLARE v_sin_tipo          INT;

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
    SET v_porcentaje  = IF(v_porcentaje IS NULL OR v_porcentaje <= 0 OR v_porcentaje > 100, 100, v_porcentaje);
    SET v_periodo_pla = YEAR(v_fecha_inicio) * 100 + MONTH(v_fecha_inicio);

    -- Un préstamo activo cuyo banco no tiene tipo de descuento se descartaría en
    -- silencio: se detiene la generación con un mensaje claro.
    SELECT COUNT(*) INTO v_sin_tipo
      FROM RPJ_MNT_PRESTAMOS_REGIMEN p
      LEFT JOIN RPJ_CAT_BANCOS b ON b.ban_id = p.prr_id_banco
      LEFT JOIN RPJ_CAT_TIPO_DESCUENTO t ON t.tde_descripcion = CONCAT('DESCUENTO PRESTAMO ', b.ban_descripcion)
     WHERE p.prr_tipo_manejo = 2 AND p.prr_estado = 'ACTIVO' AND p.prr_saldo > 0 AND t.tde_id IS NULL;
    IF v_sin_tipo > 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Hay prestamos activos de un banco sin tipo de descuento (DESCUENTO PRESTAMO <banco>). Agreguelo en Catalogos > Tipos de descuento.';
    END IF;

    SET v_dias_periodo = DATEDIFF(v_fecha_final, v_fecha_inicio) + 1;

    SELECT par_igss, par_isr, par_intecap, par_desc_asociacion
      INTO v_pct_igss, v_pct_isr, v_pct_intecap, v_monto_asociacion
      FROM RPJ_CAT_PARAMETRO_GENERAL
     ORDER BY par_id DESC LIMIT 1;

    START TRANSACTION;

    -- Limpieza por si quedó algo de una generación anterior de esta planilla.
    UPDATE RPJ_PRC_DEUDA_JUBILADO d
     INNER JOIN RPJ_PRC_APLICACION_PAGO a ON a.apa_id_deuda = d.deu_correlativo
       SET d.deu_monto_pagado    = d.deu_monto_pagado    - a.apa_monto_aplicado,
           d.deu_monto_pendiente = d.deu_monto_pendiente + a.apa_monto_aplicado,
           d.deu_estado = CASE WHEN d.deu_monto_pagado - a.apa_monto_aplicado <= 0 THEN 'PENDIENTE' ELSE 'PARCIAL' END,
           d.deu_fecha_saldada = NULL
     WHERE a.apa_id_planilla = p_id_planilla;
    DELETE FROM RPJ_PRC_APLICACION_PAGO WHERE apa_id_planilla = p_id_planilla;
    DELETE FROM RPJ_PRC_DEUDA_JUBILADO   WHERE deu_id_planilla = p_id_planilla;
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

        IF v_tiene_datos = 0 OR v_aplica_nomina = FALSE OR v_fecha_jubilacion > v_fecha_final THEN
            SET p_excluidos = p_excluidos + 1;
        ELSE
            IF v_fecha_jubilacion >= v_fecha_inicio AND v_fecha_jubilacion <= v_fecha_final THEN
                SET v_dias_trabajados = DATEDIFF(v_fecha_final, v_fecha_jubilacion) + 1;
                SET v_factor_dias     = v_dias_trabajados / v_dias_periodo;
            ELSE
                SET v_dias_trabajados = v_dias_periodo;
                SET v_factor_dias     = 1.0;
            END IF;
            SET v_pension_prop = ROUND(v_pension * v_factor_dias, 2);

            -- 1. Descuentos del mes (sobre la pensión proporcional completa) -----
            IF v_aplica_igss = TRUE AND v_pct_igss > 0 THEN
                INSERT INTO RPJ_PRC_NOMINA_DESCUENTO (nde_tipo_manejo, nde_id_tipo_planilla, nde_id_planilla, nde_id_jubilado, nde_tipo_descuento, nde_valor, nde_dias_trabajados, nde_puesto, nde_area, nde_usuario_creacion)
                VALUES (2, 2, p_id_planilla, v_id_jubilado, 1, ROUND(v_pension_prop * v_pct_igss / 100, 2), v_dias_trabajados, 'JUBILADO', 'ADMINISTRATIVA', p_usuario);
            END IF;
            IF v_aplica_isr = TRUE AND v_pct_isr > 0 THEN
                INSERT INTO RPJ_PRC_NOMINA_DESCUENTO (nde_tipo_manejo, nde_id_tipo_planilla, nde_id_planilla, nde_id_jubilado, nde_tipo_descuento, nde_valor, nde_dias_trabajados, nde_puesto, nde_area, nde_usuario_creacion)
                VALUES (2, 2, p_id_planilla, v_id_jubilado, 2, ROUND(v_pension_prop * v_pct_isr / 100, 2), v_dias_trabajados, 'JUBILADO', 'ADMINISTRATIVA', p_usuario);
            END IF;
            IF v_aplica_intecap = TRUE AND v_pct_intecap > 0 THEN
                INSERT INTO RPJ_PRC_NOMINA_DESCUENTO (nde_tipo_manejo, nde_id_tipo_planilla, nde_id_planilla, nde_id_jubilado, nde_tipo_descuento, nde_valor, nde_dias_trabajados, nde_puesto, nde_area, nde_usuario_creacion)
                VALUES (2, 2, p_id_planilla, v_id_jubilado, 3, ROUND(v_pension_prop * v_pct_intecap / 100, 2), v_dias_trabajados, 'JUBILADO', 'ADMINISTRATIVA', p_usuario);
            END IF;

            INSERT INTO RPJ_PRC_NOMINA_DESCUENTO (nde_tipo_manejo, nde_id_tipo_planilla, nde_id_planilla, nde_id_jubilado, nde_tipo_descuento, nde_valor, nde_dias_trabajados, nde_puesto, nde_area, nde_usuario_creacion)
            SELECT 2, 2, p_id_planilla, v_id_jubilado, 4, LEAST(dju_valor, dju_saldo), v_dias_trabajados, 'JUBILADO', 'ADMINISTRATIVA', p_usuario
              FROM RPJ_MNT_DESC_JUDICIALES
             WHERE dju_id_jubilado = v_id_jubilado AND dju_tipo_manejo = 2 AND dju_estado = 'ACTIVO' AND dju_saldo > 0;
            UPDATE RPJ_MNT_DESC_JUDICIALES
               SET dju_saldo = GREATEST(dju_saldo - dju_valor, 0),
                   dju_estado = CASE WHEN dju_saldo - dju_valor <= 0 THEN 'CANCELADO' ELSE 'ACTIVO' END
             WHERE dju_id_jubilado = v_id_jubilado AND dju_tipo_manejo = 2 AND dju_estado = 'ACTIVO' AND dju_saldo > 0;

            -- Préstamos: el tipo de descuento sale del banco y se guarda el préstamo.
            INSERT INTO RPJ_PRC_NOMINA_DESCUENTO (nde_tipo_manejo, nde_id_tipo_planilla, nde_id_planilla, nde_id_jubilado, nde_tipo_descuento, nde_id_prestamo, nde_valor, nde_dias_trabajados, nde_puesto, nde_area, nde_usuario_creacion)
            SELECT 2, 2, p_id_planilla, v_id_jubilado, t.tde_id, p.prr_correlativo, LEAST(p.prr_valor_mes, p.prr_saldo), v_dias_trabajados, 'JUBILADO', 'ADMINISTRATIVA', p_usuario
              FROM RPJ_MNT_PRESTAMOS_REGIMEN p
              JOIN RPJ_CAT_BANCOS b ON b.ban_id = p.prr_id_banco
              JOIN RPJ_CAT_TIPO_DESCUENTO t ON t.tde_descripcion = CONCAT('DESCUENTO PRESTAMO ', b.ban_descripcion)
             WHERE p.prr_id_jubilado = v_id_jubilado AND p.prr_tipo_manejo = 2 AND p.prr_estado = 'ACTIVO' AND p.prr_saldo > 0
               AND p.prr_fecha_inicio <= v_fecha_final;
            UPDATE RPJ_MNT_PRESTAMOS_REGIMEN
               SET prr_saldo = GREATEST(prr_saldo - prr_valor_mes, 0),
                   prr_estado = CASE WHEN prr_saldo - prr_valor_mes <= 0 THEN 'OPERADA' ELSE 'ACTIVO' END
             WHERE prr_id_jubilado = v_id_jubilado AND prr_tipo_manejo = 2 AND prr_estado = 'ACTIVO' AND prr_saldo > 0
               AND prr_fecha_inicio <= v_fecha_final;

            IF v_aplica_asociacion = TRUE AND v_monto_asociacion > 0 THEN
                INSERT INTO RPJ_PRC_NOMINA_DESCUENTO (nde_tipo_manejo, nde_id_tipo_planilla, nde_id_planilla, nde_id_jubilado, nde_tipo_descuento, nde_valor, nde_dias_trabajados, nde_puesto, nde_area, nde_usuario_creacion)
                VALUES (2, 2, p_id_planilla, v_id_jubilado, 8, v_monto_asociacion, v_dias_trabajados, 'JUBILADO', 'ADMINISTRATIVA', p_usuario);
            END IF;

            -- Otros descuentos (extraordinarios) cargados para el jubilado en esta
            -- planilla (catálogo Otros descuentos, por período). Van antes del líquido,
            -- así el porcentaje se calcula ya con el descuento y siempre se vuelven a
            -- aplicar al reversar y generar de nuevo.
            INSERT INTO RPJ_PRC_NOMINA_DESCUENTO (nde_tipo_manejo, nde_id_tipo_planilla, nde_id_planilla, nde_id_jubilado, nde_tipo_descuento, nde_valor, nde_dias_trabajados, nde_puesto, nde_area, nde_usuario_creacion)
            SELECT 2, 2, p_id_planilla, v_id_jubilado, o.ode_tipo_descuento, o.ode_valor, v_dias_trabajados, 'JUBILADO', 'ADMINISTRATIVA', p_usuario
              FROM RPJ_MNT_OTRO_DESCUENTO o
             WHERE o.ode_tipo_manejo = 2 AND o.ode_id_jubilado = v_id_jubilado
               AND o.ode_periodo = v_periodo_pla AND o.ode_estado = 'ACTIVO';

            SELECT COALESCE(SUM(nde_valor), 0) INTO v_desc_total
              FROM RPJ_PRC_NOMINA_DESCUENTO
             WHERE nde_id_planilla = p_id_planilla AND nde_id_jubilado = v_id_jubilado;

            -- 2. Líquido y pago ------------------------------------------------
            SET v_liquido = GREATEST(v_pension_prop - v_desc_total, 0);
            SET v_pago    = ROUND(v_liquido * v_porcentaje / 100, 2);

            -- 3. Vista previa del reparto. La deuda NO se toca al generar: el mes se
            --    registra y el pago se aplica al CERRAR la planilla
            --    (sp_cuadrar_planilla_pensionados). Aquí solo se indica a qué mes iría.
            SET v_primera_deuda = NULL;
            SELECT deu_correlativo INTO v_primera_deuda
              FROM RPJ_PRC_DEUDA_JUBILADO
             WHERE deu_id_jubilado = v_id_jubilado AND deu_estado IN ('PENDIENTE','PARCIAL')
               AND deu_monto_pendiente > 0 AND deu_periodo < v_periodo_pla
             ORDER BY deu_periodo ASC LIMIT 1;
            IF v_primera_deuda IS NULL THEN
                SET v_pago_mes = v_pago; SET v_abono_anterior = 0.00;
            ELSE
                SET v_pago_mes = 0.00; SET v_abono_anterior = v_pago;
            END IF;

            -- 5. Ingreso bruto: descuentos + pago ------------------------------
            INSERT INTO RPJ_PRC_NOMINA_INGRESO
                (nin_tipo_manejo, nin_id_tipo_planilla, nin_id_planilla, nin_id_jubilado, nin_tipo_ingreso,
                 nin_valor, nin_valor_teorico, nin_porcentaje_aplicado, nin_pago_corriente, nin_abono_historico,
                 nin_id_deuda_aplicada, nin_dias_trabajados, nin_puesto, nin_area, nin_usuario_creacion)
            VALUES (2, 2, p_id_planilla, v_id_jubilado, v_tin_pension,
                 LEAST(v_pension_prop, v_desc_total) + v_pago, v_pension, v_porcentaje,
                 v_pago_mes, v_abono_anterior,
                 v_primera_deuda, v_dias_trabajados, 'JUBILADO', 'ADMINISTRATIVA', p_usuario);

            SET p_procesados   = p_procesados   + 1;
            SET p_total_pagado = p_total_pagado + LEAST(v_pension_prop, v_desc_total) + v_pago;
            SET p_total_desc   = p_total_desc   + v_desc_total;
        END IF;

        -- El handler NOT FOUND es compartido con el cursor: la búsqueda de deuda lo
        -- dispara cuando ya no hay meses pendientes. Sin esto el ciclo terminaría.
        SET v_done = FALSE;
    END LOOP loop_jub;
    CLOSE cur_jub;

    UPDATE RPJ_CAT_PARAMETRO_PLANILLA
       SET ppl_estado_proceso = 'GENERADA', ppl_fecha_generacion = NOW(), ppl_usuario_genera = p_usuario
     WHERE ppl_correlativo = p_id_planilla;

    COMMIT;
END$$
DELIMITER ;

-- Descuentos históricos: un préstamo de banco sin tipo propio cuenta como
-- DESCUENTO PRESTAMO REGIMEN (7), no como OTROS DESCUENTOS (9).
DROP PROCEDURE IF EXISTS sp_carga_descuentos_mes;
DELIMITER $$
CREATE PROCEDURE sp_carga_descuentos_mes(
    IN p_id_pla INT, IN p_periodo INT, IN p_mes DATE, IN p_usuario VARCHAR(50), IN p_solo_sin_renglon TINYINT
)
BEGIN
    DECLARE v_dias_mes INT DEFAULT DAY(LAST_DAY(p_mes));
    DECLARE v_fin DATE DEFAULT LAST_DAY(p_mes);
    DECLARE v_pct_igss, v_pct_isr, v_pct_intecap DECIMAL(5,2) DEFAULT 0;
    DECLARE v_monto_asoc DECIMAL(10,2) DEFAULT 0;

    SELECT COALESCE(par_igss, 0), COALESCE(par_isr, 0), COALESCE(par_intecap, 0), COALESCE(par_desc_asociacion, 0)
      INTO v_pct_igss, v_pct_isr, v_pct_intecap, v_monto_asoc
      FROM RPJ_CAT_PARAMETRO_GENERAL ORDER BY par_id DESC LIMIT 1;

    DROP TEMPORARY TABLE IF EXISTS tmp_desc_base;
    CREATE TEMPORARY TABLE tmp_desc_base (
      id_jubilado INT PRIMARY KEY, devengado DECIMAL(12,2), dias INT,
      igss TINYINT, isr TINYINT, intecap TINYINT, asoc TINYINT
    );
    INSERT INTO tmp_desc_base
    SELECT m.id_jubilado,
           ROUND(t.pension * IF(t.periodo_ini = p_periodo, (v_dias_mes - DAY(t.fecha_jub) + 1) / v_dias_mes, 1), 2),
           IF(t.periodo_ini = p_periodo, v_dias_mes - DAY(t.fecha_jub) + 1, v_dias_mes),
           COALESCE((SELECT MAX(d.dat_aplica_desc_igss) FROM RPJ_MNT_DATOS_PLANILLA d WHERE d.dat_id_jubilado = m.id_jubilado AND d.dat_tipo_manejo = 2), 0),
           COALESCE((SELECT MAX(d.dat_aplica_desc_isr) FROM RPJ_MNT_DATOS_PLANILLA d WHERE d.dat_id_jubilado = m.id_jubilado AND d.dat_tipo_manejo = 2), 0),
           COALESCE((SELECT MAX(d.dat_aplica_intecap) FROM RPJ_MNT_DATOS_PLANILLA d WHERE d.dat_id_jubilado = m.id_jubilado AND d.dat_tipo_manejo = 2), 0),
           COALESCE((SELECT MAX(d.dat_aplica_dasociacion) FROM RPJ_MNT_DATOS_PLANILLA d WHERE d.dat_id_jubilado = m.id_jubilado AND d.dat_tipo_manejo = 2), 0)
      FROM tmp_hist_mes m JOIN tmp_hist_jub t ON t.id_jubilado = m.id_jubilado
     WHERE m.periodo = p_periodo
       AND (p_solo_sin_renglon = 0 OR NOT EXISTS (SELECT 1 FROM RPJ_PRC_NOMINA_INGRESO i
                                                   WHERE i.nin_id_planilla = p_id_pla AND i.nin_id_jubilado = m.id_jubilado));

    -- IGSS, ISR e INTECAP (porcentaje de la pensión del mes) y asociación (monto fijo).
    IF v_pct_igss > 0 THEN
      INSERT INTO RPJ_PRC_NOMINA_DESCUENTO (nde_tipo_manejo, nde_id_tipo_planilla, nde_id_planilla, nde_id_jubilado, nde_tipo_descuento, nde_valor, nde_dias_trabajados, nde_puesto, nde_area, nde_usuario_creacion)
      SELECT 2, 2, p_id_pla, id_jubilado, 1, ROUND(devengado * v_pct_igss / 100, 2), dias, 'JUBILADO', 'ADMINISTRATIVA', p_usuario
        FROM tmp_desc_base WHERE igss = 1 AND ROUND(devengado * v_pct_igss / 100, 2) > 0;
    END IF;
    IF v_pct_isr > 0 THEN
      INSERT INTO RPJ_PRC_NOMINA_DESCUENTO (nde_tipo_manejo, nde_id_tipo_planilla, nde_id_planilla, nde_id_jubilado, nde_tipo_descuento, nde_valor, nde_dias_trabajados, nde_puesto, nde_area, nde_usuario_creacion)
      SELECT 2, 2, p_id_pla, id_jubilado, 2, ROUND(devengado * v_pct_isr / 100, 2), dias, 'JUBILADO', 'ADMINISTRATIVA', p_usuario
        FROM tmp_desc_base WHERE isr = 1 AND ROUND(devengado * v_pct_isr / 100, 2) > 0;
    END IF;
    IF v_pct_intecap > 0 THEN
      INSERT INTO RPJ_PRC_NOMINA_DESCUENTO (nde_tipo_manejo, nde_id_tipo_planilla, nde_id_planilla, nde_id_jubilado, nde_tipo_descuento, nde_valor, nde_dias_trabajados, nde_puesto, nde_area, nde_usuario_creacion)
      SELECT 2, 2, p_id_pla, id_jubilado, 3, ROUND(devengado * v_pct_intecap / 100, 2), dias, 'JUBILADO', 'ADMINISTRATIVA', p_usuario
        FROM tmp_desc_base WHERE intecap = 1 AND ROUND(devengado * v_pct_intecap / 100, 2) > 0;
    END IF;
    IF v_monto_asoc > 0 THEN
      INSERT INTO RPJ_PRC_NOMINA_DESCUENTO (nde_tipo_manejo, nde_id_tipo_planilla, nde_id_planilla, nde_id_jubilado, nde_tipo_descuento, nde_valor, nde_dias_trabajados, nde_puesto, nde_area, nde_usuario_creacion)
      SELECT 2, 2, p_id_pla, id_jubilado, 8, v_monto_asoc, dias, 'JUBILADO', 'ADMINISTRATIVA', p_usuario
        FROM tmp_desc_base WHERE asoc = 1;
    END IF;

    -- Préstamos vigentes en el mes (tipo según el banco; sin préstamo ligado porque es historia).
    INSERT INTO RPJ_PRC_NOMINA_DESCUENTO (nde_tipo_manejo, nde_id_tipo_planilla, nde_id_planilla, nde_id_jubilado, nde_tipo_descuento, nde_valor, nde_dias_trabajados, nde_puesto, nde_area, nde_usuario_creacion)
    SELECT 2, 2, p_id_pla, b.id_jubilado, COALESCE(td.tde_id, 7), p.prr_valor_mes, b.dias, 'JUBILADO', 'ADMINISTRATIVA', p_usuario
      FROM tmp_desc_base b
      JOIN RPJ_MNT_PRESTAMOS_REGIMEN p ON p.prr_id_jubilado = b.id_jubilado AND p.prr_tipo_manejo = 2
                                      AND p.prr_estado <> 'ANULADO'
                                      AND p.prr_fecha_inicio <= v_fin AND p.prr_fecha_fin >= p_mes
      LEFT JOIN RPJ_CAT_BANCOS bn ON bn.ban_id = p.prr_id_banco
      LEFT JOIN RPJ_CAT_TIPO_DESCUENTO td ON td.tde_descripcion = CONCAT('DESCUENTO PRESTAMO ', bn.ban_descripcion)
     WHERE p.prr_valor_mes > 0;

    INSERT INTO RPJ_PRC_NOMINA_DESCUENTO (nde_tipo_manejo, nde_id_tipo_planilla, nde_id_planilla, nde_id_jubilado, nde_tipo_descuento, nde_valor, nde_dias_trabajados, nde_puesto, nde_area, nde_usuario_creacion)
    SELECT 2, 2, p_id_pla, b.id_jubilado, 4, j.dju_valor, b.dias, 'JUBILADO', 'ADMINISTRATIVA', p_usuario
      FROM tmp_desc_base b
      JOIN RPJ_MNT_DESC_JUDICIALES j ON j.dju_id_jubilado = b.id_jubilado AND j.dju_tipo_manejo = 2
                                    AND j.dju_fecha_inicio <= v_fin AND (j.dju_fecha_final IS NULL OR j.dju_fecha_final >= p_mes)
     WHERE j.dju_valor > 0;

    DROP TEMPORARY TABLE IF EXISTS tmp_desc_base;
END$$
DELIMITER ;
