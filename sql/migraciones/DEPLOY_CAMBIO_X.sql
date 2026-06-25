-- ============================================================================
-- DEPLOY CAMBIO X — Consolidado (estados de planilla + SPs actualizados)
-- Base: apps_rpjepq | Motor: MySQL 8 / MariaDB
-- Ejecutar DESPUÉS de DEPLOY_PRODUCCION_RPJ.sql (modelo dual-ID ya aplicado).
-- Idempotente y NO destructivo. Incluye en orden:
--   1) migration_cambio_x_planillas_estados.sql (columnas estado + emp_estado + indice)
--   2) snapshot_trabajadores_sps.sql            (SPs empleados: generar/reversos CAMBIO X)
--   3) migration_rpj_pensionados_fix_jubilado.sql (SPs pensionados: generar/reversos CAMBIO X)
-- ============================================================================

-- >>>>>>>>>>>>>>>>>>>>>>>> migration_cambio_x_planillas_estados.sql <<<<<<<<<<<<<<<<<<<<<<<<

-- ============================================================================
-- MIGRACIÃ“N CAMBIO X â€” Estados de planilla y normalizaciÃ³n de empleados
-- Base de datos : apps_rpjepq
-- Motor         : MySQL 8 / MariaDB (sintaxis portable, sin ADD COLUMN IF NOT EXISTS)
-- Idempotente, NO destructiva (sin DROP TABLE / TRUNCATE / DELETE de datos).
--
-- Hace:
--   1. Garantiza las columnas de estado/auditorÃ­a en RPJ_CAT_PARAMETRO_PLANILLA:
--        ppl_estado_proceso, ppl_fecha_generacion, ppl_fecha_cierre,
--        ppl_usuario_genera, ppl_usuario_cierra.
--   2. Normaliza emp_estado: los empleados con estado NULL o vacÃ­o pasan a
--        'ACTIVO' (causa raÃ­z de "NO HAY DATOS PARA GENERAR").
--   3. Reporta duplicados por (ppl_tipo_planilla, ppl_numero) y crea Ã­ndice
--        Ãºnico SÃ“LO si no hay duplicados.
--
-- NOTA: los helpers son SILENCIOSOS (sin SELECT interno) para compatibilidad
--       con phpMyAdmin (evita el error #2014 Commands out of sync).
-- ============================================================================

CREATE DATABASE IF NOT EXISTS `apps_rpjepq`
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `apps_rpjepq`;

SET @OLD_FK := @@FOREIGN_KEY_CHECKS;
SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================================
-- BLOQUE 0 â€” HELPERS idempotentes (silenciosos)
-- ============================================================================
DELIMITER $$

DROP PROCEDURE IF EXISTS _cx_add_column $$
CREATE PROCEDURE _cx_add_column(IN p_table VARCHAR(64), IN p_column VARCHAR(64), IN p_ddl TEXT)
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND COLUMN_NAME = p_column) THEN
    SET @s = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN ', p_ddl);
    PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
  END IF;
END $$

-- Crea Ã­ndice Ãºnico sÃ³lo si NO existe y NO hay duplicados (p_dup_count = 0).
DROP PROCEDURE IF EXISTS _cx_add_unique_if_clean $$
CREATE PROCEDURE _cx_add_unique_if_clean(
  IN p_table VARCHAR(64), IN p_index VARCHAR(64), IN p_cols TEXT, IN p_dup_count INT)
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND INDEX_NAME = p_index)
     AND p_dup_count = 0 THEN
    SET @s = CONCAT('CREATE UNIQUE INDEX `', p_index, '` ON `', p_table, '` (', p_cols, ')');
    PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
  END IF;
END $$

DELIMITER ;

-- ============================================================================
-- BLOQUE 1 â€” Columnas de estado/auditorÃ­a en RPJ_CAT_PARAMETRO_PLANILLA
-- ============================================================================
SELECT 'BLOQUE 1: columnas de estado de planilla' AS etapa;

CALL _cx_add_column('RPJ_CAT_PARAMETRO_PLANILLA', 'ppl_estado_proceso',
     "ppl_estado_proceso ENUM('ABIERTA','GENERADA','CERRADA','REVERSADA') NOT NULL DEFAULT 'ABIERTA'");
CALL _cx_add_column('RPJ_CAT_PARAMETRO_PLANILLA', 'ppl_fecha_generacion',
     'ppl_fecha_generacion DATETIME NULL');
CALL _cx_add_column('RPJ_CAT_PARAMETRO_PLANILLA', 'ppl_fecha_cierre',
     'ppl_fecha_cierre DATETIME NULL');
CALL _cx_add_column('RPJ_CAT_PARAMETRO_PLANILLA', 'ppl_usuario_genera',
     'ppl_usuario_genera VARCHAR(50) NULL');
CALL _cx_add_column('RPJ_CAT_PARAMETRO_PLANILLA', 'ppl_usuario_cierra',
     'ppl_usuario_cierra VARCHAR(50) NULL');

-- ============================================================================
-- BLOQUE 2 â€” NormalizaciÃ³n de emp_estado (causa raÃ­z "NO HAY DATOS PARA GENERAR")
-- ============================================================================
SELECT 'BLOQUE 2: normalizar emp_estado NULL/vacÃ­o -> ACTIVO' AS etapa;

SELECT COUNT(*) AS empleados_sin_estado
  FROM RPJ_MNT_EMPLEADO
 WHERE emp_estado IS NULL OR TRIM(emp_estado) = '';

UPDATE RPJ_MNT_EMPLEADO
   SET emp_estado = 'ACTIVO'
 WHERE emp_estado IS NULL OR TRIM(emp_estado) = '';

-- ============================================================================
-- BLOQUE 3 â€” Duplicados (ppl_tipo_planilla + ppl_numero) e Ã­ndice Ãºnico
-- ============================================================================
SELECT 'BLOQUE 3: duplicados de planilla tipo+numero (deberÃ­an ser 0 filas)' AS etapa;
SELECT ppl_tipo_planilla, ppl_numero, COUNT(*) AS total
  FROM RPJ_CAT_PARAMETRO_PLANILLA
 GROUP BY ppl_tipo_planilla, ppl_numero
HAVING COUNT(*) > 1;

SELECT COUNT(*) INTO @dup_ppl FROM (
  SELECT 1 FROM RPJ_CAT_PARAMETRO_PLANILLA
   GROUP BY ppl_tipo_planilla, ppl_numero
  HAVING COUNT(*) > 1
) z;

CALL _cx_add_unique_if_clean('RPJ_CAT_PARAMETRO_PLANILLA', 'uq_planilla_tipo_numero',
     'ppl_tipo_planilla, ppl_numero', @dup_ppl);

-- ============================================================================
-- BLOQUE 4 â€” VERIFICACIÃ“N
-- ============================================================================
SELECT 'BLOQUE 4: verificaciÃ³n' AS etapa;
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'RPJ_CAT_PARAMETRO_PLANILLA'
   AND COLUMN_NAME IN ('ppl_estado_proceso','ppl_fecha_generacion','ppl_fecha_cierre',
                       'ppl_usuario_genera','ppl_usuario_cierra')
 ORDER BY COLUMN_NAME;

SELECT emp_tipo_manejo, emp_estado, COUNT(*) AS total
  FROM RPJ_MNT_EMPLEADO
 GROUP BY emp_tipo_manejo, emp_estado;

-- ============================================================================
-- BLOQUE 5 â€” LIMPIEZA
-- ============================================================================
DROP PROCEDURE IF EXISTS _cx_add_column;
DROP PROCEDURE IF EXISTS _cx_add_unique_if_clean;

SET FOREIGN_KEY_CHECKS = @OLD_FK;

SELECT 'MIGRACIÃ“N CAMBIO X COMPLETADA. Revisar BLOQUES 3 y 4.' AS estado;
-- ============================================================================
-- FIN
-- ============================================================================

-- >>>>>>>>>>>>>>>>>>>>>>>> snapshot_trabajadores_sps.sql <<<<<<<<<<<<<<<<<<<<<<<<

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
    -- CAMBIO X: emp_estado puede venir NULL (la app no lo setea al crear). Se
    -- considera ACTIVO todo empleado cuyo estado NO sea explÃ­citamente INACTIVO.
    DECLARE cur_empleados CURSOR FOR
        SELECT e.emp_correlativo,
               e.emp_tipo_manejo,
               e.emp_profesion_oficio,
               e.emp_fecha_ingreso
          FROM RPJ_MNT_EMPLEADO e
         WHERE e.emp_tipo_manejo = 1
           AND UPPER(COALESCE(e.emp_estado, 'ACTIVO')) <> 'INACTIVO';

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

    -- CAMBIO X: se permite generar desde ABIERTA o desde REVERSADA (volver a
    -- generar). Cualquier otro estado (GENERADA / CERRADA) se rechaza.
    IF v_estado_proc NOT IN ('ABIERTA', 'REVERSADA') THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Solo se puede generar nomina si la planilla esta ABIERTA o REVERSADA';
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

    -- CAMBIO X: limpieza defensiva anti-duplicados. Si se estÃ¡ volviendo a
    -- generar (estado REVERSADA) o quedaron renglones huÃ©rfanos, se eliminan
    -- los registros previos de esta planilla (tipo_manejo = 1) antes de insertar.
    DELETE FROM RPJ_PRC_NOMINA_DESCUENTO
     WHERE nde_id_planilla = p_id_planilla AND nde_tipo_manejo = 1;
    DELETE FROM RPJ_PRC_NOMINA_INGRESO
     WHERE nin_id_planilla = p_id_planilla AND nin_tipo_manejo = 1;

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

    -- CAMBIO X: sÃ³lo se reversa una planilla GENERADA. CERRADA queda bloqueada.
    IF v_estado != 'GENERADA' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Solo se pueden reversar pagos en planillas GENERADAS';
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

    -- CAMBIO X: sÃ³lo se reversa una planilla GENERADA. CERRADA queda bloqueada.
    IF v_estado != 'GENERADA' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Solo se pueden reversar planillas GENERADAS';
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

-- >>>>>>>>>>>>>>>>>>>>>>>> migration_rpj_pensionados_fix_jubilado.sql <<<<<<<<<<<<<<<<<<<<<<<<

-- ============================================================================
-- FIX: SPs de PENSIONADOS al nuevo modelo *_id_jubilado
-- Base: apps_rpjepq | Motor: MySQL 8 / MariaDB
-- Requisito previo: ejecutar migration_rpj_nomina_empleados_pensionados.sql
-- Reemplaza 3 procedimientos para que lean jubilados desde dat_id_jubilado /
-- dju_id_jubilado / prr_id_jubilado (antes leÃ­an desde *_id_empleado).
-- AdemÃ¡s registra lre_tipo_manejo y lre_tipo_reverso en RPJ_LOG_REVERSOS.
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

    -- CAMBIO X: se permite generar desde ABIERTA o desde REVERSADA (volver a
    -- generar). Cualquier otro estado (GENERADA / CERRADA) se rechaza.
    IF v_estado_proc NOT IN ('ABIERTA', 'REVERSADA') THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Solo se puede generar nomina si la planilla esta ABIERTA o REVERSADA';
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

    -- CAMBIO X: limpieza defensiva anti-duplicados. Si se estÃ¡ volviendo a
    -- generar (estado REVERSADA) o quedaron renglones huÃ©rfanos, se eliminan
    -- los registros previos de esta planilla (tipo_manejo = 2) antes de insertar.
    -- Primero se restauran las deudas histÃ³ricas ligadas a aplicaciones previas
    -- (para no dejar deudas "pagadas" huÃ©rfanas), luego se borran las aplicaciones.
    UPDATE RPJ_PRC_DEUDA_JUBILADO d
     INNER JOIN RPJ_PRC_APLICACION_PAGO a
             ON a.apa_id_deuda = d.deu_correlativo
       SET d.deu_monto_pagado    = d.deu_monto_pagado    - a.apa_monto_aplicado,
           d.deu_monto_pendiente = d.deu_monto_pendiente + a.apa_monto_aplicado,
           d.deu_estado = CASE
                            WHEN d.deu_monto_pagado - a.apa_monto_aplicado <= 0
                            THEN 'PENDIENTE' ELSE 'PARCIAL'
                          END,
           d.deu_fecha_saldada = NULL
     WHERE a.apa_id_planilla = p_id_planilla;

    DELETE FROM RPJ_PRC_APLICACION_PAGO
     WHERE apa_id_planilla = p_id_planilla;
    DELETE FROM RPJ_PRC_NOMINA_DESCUENTO
     WHERE nde_id_planilla = p_id_planilla AND nde_tipo_manejo = 2;
    DELETE FROM RPJ_PRC_NOMINA_INGRESO
     WHERE nin_id_planilla = p_id_planilla AND nin_tipo_manejo = 2;

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

    -- CAMBIO X: sÃ³lo se reversa una planilla GENERADA. CERRADA queda bloqueada.
    IF v_estado != 'GENERADA' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Solo se pueden reversar pagos en planillas GENERADAS';
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

    -- CAMBIO X: sÃ³lo se reversa una planilla GENERADA. CERRADA queda bloqueada.
    IF v_estado != 'GENERADA' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Solo se pueden reversar planillas GENERADAS';
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
