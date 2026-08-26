-- ============================================================================
-- MIGRACIÓN — Módulo de Prestaciones (Bono 14 · Aguinaldo · Bono Vacacional)
-- Base de datos : apps_rpjepq
-- Motor         : MySQL 8 / MariaDB (portable, sin ADD COLUMN IF NOT EXISTS)
-- Idempotente, NO destructiva (sin DROP TABLE / TRUNCATE / DELETE de datos).
--
-- Hace:
--   1. Siembra tipos de planilla 5 (BONO 14), 7 (AGUINALDO), 9 (BONO VACACIONAL).
--   2. Siembra tipos de ingreso BONO 14, AGUINALDO y BONO VACACIONAL.
--   3. Crea los 9 stored procedures del módulo:
--        sp_generar_bono14 / sp_generar_aguinaldo / sp_generar_bono_vacacional
--        sp_revertir_bono14 / sp_revertir_aguinaldo / sp_revertir_bono_vacacional
--        sp_editar_monto_prestacion / sp_agregar_empleado_prestacion /
--        sp_eliminar_linea_prestacion
--
-- DECISIONES DE IMPLEMENTACIÓN (difieren del documento fuente por el estado real
-- de la base; ver INFORME_PRESTACIONES.md):
--   #1 emp_estado se maneja como 'ACTIVO'/'INACTIVO' (el doc decía 'A'). Se usa
--      el mismo criterio que el resto del sistema: <> 'INACTIVO'.
--   #2 tin_id 9 YA ESTÁ OCUPADO por 'HORA EXTRA'. Los tipos de ingreso se
--      resuelven POR NOMBRE dentro de los SP (no se hardcodean ids), y se
--      siembran con AUTO_INCREMENT cuando el id sugerido no está libre.
--   #3 El salario mensual base sale de RPJ_MNT_SALARIO (sal_tipo_manejo = 1,
--      renglón de menor sal_correlativo del empleado), igual que
--      sp_generar_nomina_tiempo_extra.
--   #4 Días trabajados = DATEDIFF(fin_periodo, MAX(inicio_periodo, fecha_ingreso)) + 1,
--      acotado a [0, 365].
--   #5 La antigüedad del Bono Vacacional se mide contra ppl_fecha_pago de la
--      planilla (no contra CURDATE()), para que el cálculo sea reproducible.
--   #6 Ninguna de las 3 prestaciones genera descuentos (exentas de IGSS/ISR).
--
-- NOTA: helpers SILENCIOSOS (sin SELECT interno) para compatibilidad phpMyAdmin.
-- ============================================================================

USE `apps_rpjepq`;

-- ============================================================================
-- BLOQUE 0 — HELPERS idempotentes (silenciosos)
-- ============================================================================
DELIMITER $$

DROP PROCEDURE IF EXISTS _pr_safe $$
CREATE PROCEDURE _pr_safe(IN p_sql TEXT)
BEGIN
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION BEGIN END;
  SET @s = p_sql; PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
END $$

DELIMITER ;

-- ============================================================================
-- BLOQUE 1 — Siembra de catálogos
-- ============================================================================
SELECT 'BLOQUE 1: siembra de catalogos' AS etapa;

-- Tipos de planilla 5 / 7 / 9. Necesarios porque RPJ_PRC_NOMINA_INGRESO
-- referencia tpl_id; sin ellos el INSERT del SP haría ROLLBACK.
SET @uso_tipo := COALESCE((SELECT MIN(tpl_id_tipo_uso) FROM RPJ_CAT_TIPO_PLANILLA), 1);

CALL _pr_safe(CONCAT(
  "INSERT INTO RPJ_CAT_TIPO_PLANILLA (tpl_id, tpl_tipo_planilla, tpl_descripcion, tpl_id_tipo_uso, tpl_usuario_creacion)
   SELECT 5,'BONO 14','Bonificacion anual Decreto 42-92',", @uso_tipo, ",'sistema' FROM DUAL
   WHERE NOT EXISTS (SELECT 1 FROM RPJ_CAT_TIPO_PLANILLA WHERE tpl_id = 5)"));

CALL _pr_safe(CONCAT(
  "INSERT INTO RPJ_CAT_TIPO_PLANILLA (tpl_id, tpl_tipo_planilla, tpl_descripcion, tpl_id_tipo_uso, tpl_usuario_creacion)
   SELECT 7,'AGUINALDO','Aguinaldo Decreto 76-78',", @uso_tipo, ",'sistema' FROM DUAL
   WHERE NOT EXISTS (SELECT 1 FROM RPJ_CAT_TIPO_PLANILLA WHERE tpl_id = 7)"));

CALL _pr_safe(CONCAT(
  "INSERT INTO RPJ_CAT_TIPO_PLANILLA (tpl_id, tpl_tipo_planilla, tpl_descripcion, tpl_id_tipo_uso, tpl_usuario_creacion)
   SELECT 9,'BONO VACACIONAL','Prestacion adicional de la asociacion',", @uso_tipo, ",'sistema' FROM DUAL
   WHERE NOT EXISTS (SELECT 1 FROM RPJ_CAT_TIPO_PLANILLA WHERE tpl_id = 9)"));

-- Tipos de ingreso. Se intenta el id sugerido por el documento (7 y 8); si está
-- ocupado se cae al AUTO_INCREMENT. Los SP los resuelven SIEMPRE por nombre.
CALL _pr_safe(
  "INSERT INTO RPJ_CAT_TIPO_INGRESO (tin_id, tin_tipo_ingreso, tin_descripcion, tin_usuario_creacion)
   SELECT 7,'BONO 14','Bonificacion anual (Decreto 42-92)','sistema' FROM DUAL
   WHERE NOT EXISTS (SELECT 1 FROM RPJ_CAT_TIPO_INGRESO WHERE tin_id = 7)
     AND NOT EXISTS (SELECT 1 FROM RPJ_CAT_TIPO_INGRESO WHERE UPPER(tin_tipo_ingreso) = 'BONO 14')");

CALL _pr_safe(
  "INSERT INTO RPJ_CAT_TIPO_INGRESO (tin_tipo_ingreso, tin_descripcion, tin_usuario_creacion)
   SELECT 'BONO 14','Bonificacion anual (Decreto 42-92)','sistema' FROM DUAL
   WHERE NOT EXISTS (SELECT 1 FROM RPJ_CAT_TIPO_INGRESO WHERE UPPER(tin_tipo_ingreso) = 'BONO 14')");

CALL _pr_safe(
  "INSERT INTO RPJ_CAT_TIPO_INGRESO (tin_id, tin_tipo_ingreso, tin_descripcion, tin_usuario_creacion)
   SELECT 8,'AGUINALDO','Aguinaldo (Decreto 76-78)','sistema' FROM DUAL
   WHERE NOT EXISTS (SELECT 1 FROM RPJ_CAT_TIPO_INGRESO WHERE tin_id = 8)
     AND NOT EXISTS (SELECT 1 FROM RPJ_CAT_TIPO_INGRESO WHERE UPPER(tin_tipo_ingreso) = 'AGUINALDO')");

CALL _pr_safe(
  "INSERT INTO RPJ_CAT_TIPO_INGRESO (tin_tipo_ingreso, tin_descripcion, tin_usuario_creacion)
   SELECT 'AGUINALDO','Aguinaldo (Decreto 76-78)','sistema' FROM DUAL
   WHERE NOT EXISTS (SELECT 1 FROM RPJ_CAT_TIPO_INGRESO WHERE UPPER(tin_tipo_ingreso) = 'AGUINALDO')");

-- tin_id 9 está ocupado por HORA EXTRA: el bono vacacional toma AUTO_INCREMENT.
CALL _pr_safe(
  "INSERT INTO RPJ_CAT_TIPO_INGRESO (tin_tipo_ingreso, tin_descripcion, tin_usuario_creacion)
   SELECT 'BONO VACACIONAL','Prestacion adicional de la asociacion','sistema' FROM DUAL
   WHERE NOT EXISTS (SELECT 1 FROM RPJ_CAT_TIPO_INGRESO WHERE UPPER(tin_tipo_ingreso) = 'BONO VACACIONAL')");

-- ============================================================================
-- BLOQUE 2 — SP sp_generar_bono14  (planilla tipo 5)
-- Periodo: 01/07/(anio-1) al 30/06/(anio). Formula: salario * dias / 365.
-- ============================================================================
SELECT 'BLOQUE 2: SP sp_generar_bono14' AS etapa;

DROP PROCEDURE IF EXISTS sp_generar_bono14;
DELIMITER $$

CREATE PROCEDURE sp_generar_bono14(
    IN  p_id_planilla  INT,
    IN  p_anio         INT,
    IN  p_usuario      VARCHAR(50),
    OUT p_procesados   INT,
    OUT p_total_pagado DECIMAL(12,2),
    OUT p_resultado    VARCHAR(200)
)
BEGIN
    DECLARE v_tipo_planilla INT;
    DECLARE v_estado_proc   VARCHAR(20);
    DECLARE v_ini           DATE;
    DECLARE v_fin           DATE;
    DECLARE v_tin           INT DEFAULT NULL;
    DECLARE v_ya            INT DEFAULT 0;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1 @pr_errno = MYSQL_ERRNO, @pr_msg = MESSAGE_TEXT;
        ROLLBACK;
        SET p_procesados = 0;
        SET p_total_pagado = 0.00;
        SET p_resultado = CONCAT('ERROR: ', @pr_errno, ' - ', @pr_msg);
    END;

    SET p_procesados = 0;
    SET p_total_pagado = 0.00;

    SELECT ppl_tipo_planilla, ppl_estado_proceso
      INTO v_tipo_planilla, v_estado_proc
      FROM RPJ_CAT_PARAMETRO_PLANILLA
     WHERE ppl_correlativo = p_id_planilla;

    SELECT tin_id INTO v_tin FROM RPJ_CAT_TIPO_INGRESO
     WHERE UPPER(tin_tipo_ingreso) = 'BONO 14' ORDER BY tin_id LIMIT 1;

    SELECT COUNT(*) INTO v_ya FROM RPJ_PRC_NOMINA_INGRESO
     WHERE nin_id_planilla = p_id_planilla AND nin_id_tipo_planilla = 5;

    IF v_estado_proc IS NULL THEN
        SET p_resultado = 'ERROR: La planilla no existe.';
    ELSEIF v_tipo_planilla <> 5 THEN
        SET p_resultado = 'ERROR: La planilla no es de tipo 5 (Bono 14).';
    ELSEIF v_estado_proc NOT IN ('ABIERTA','REVERSADA') THEN
        SET p_resultado = CONCAT('ERROR: La planilla esta en estado ', v_estado_proc, '; solo se genera desde ABIERTA o REVERSADA.');
    ELSEIF v_tin IS NULL THEN
        SET p_resultado = 'ERROR: Falta el tipo de ingreso BONO 14 en el catalogo.';
    ELSEIF p_anio IS NULL OR p_anio < 1900 OR p_anio > 2999 THEN
        SET p_resultado = 'ERROR: Anio invalido.';
    ELSEIF v_ya > 0 THEN
        SET p_resultado = 'ERROR: Esta planilla ya tiene registros de Bono 14. Reviertala antes de regenerar.';
    ELSE
        SET v_ini = MAKEDATE(p_anio - 1, 1) + INTERVAL 6 MONTH;              -- 01/07/(anio-1)
        SET v_fin = MAKEDATE(p_anio, 1) + INTERVAL 6 MONTH - INTERVAL 1 DAY; -- 30/06/(anio)

        START TRANSACTION;

        INSERT INTO RPJ_PRC_NOMINA_INGRESO (
            nin_tipo_manejo, nin_id_tipo_planilla, nin_id_planilla, nin_id_empleado,
            nin_tipo_ingreso, nin_valor, nin_valor_teorico, nin_porcentaje_aplicado,
            nin_pago_corriente, nin_abono_historico, nin_dias_trabajados,
            nin_puesto, nin_area, nin_usuario_creacion
        )
        SELECT 1, 5, p_id_planilla, x.emp,
               v_tin,
               ROUND(x.salario * x.dias / 365, 2),
               x.salario, 100.00,
               ROUND(x.salario * x.dias / 365, 2),
               0.00, x.dias,
               COALESCE(x.puesto, 'N/D'), 'TRABAJADORES', p_usuario
          FROM (
            SELECT e.emp_correlativo AS emp,
                   e.emp_profesion_oficio AS puesto,
                   base.salario AS salario,
                   LEAST(365, GREATEST(0,
                     DATEDIFF(v_fin, GREATEST(v_ini, COALESCE(e.emp_fecha_ingreso, v_ini))) + 1)) AS dias
              FROM RPJ_MNT_EMPLEADO e
              INNER JOIN (
                    SELECT s.sal_id_empleado, s.sal_salario AS salario
                      FROM RPJ_MNT_SALARIO s
                     WHERE s.sal_tipo_manejo = 1
                       AND s.sal_correlativo = (
                           SELECT MIN(s2.sal_correlativo) FROM RPJ_MNT_SALARIO s2
                            WHERE s2.sal_id_empleado = s.sal_id_empleado AND s2.sal_tipo_manejo = 1)
              ) base ON base.sal_id_empleado = e.emp_correlativo
             WHERE e.emp_tipo_manejo = 1
               AND UPPER(COALESCE(e.emp_estado,'ACTIVO')) <> 'INACTIVO'
               AND COALESCE(e.emp_fecha_ingreso, v_ini) <= v_fin
          ) x
         WHERE x.dias > 0 AND x.salario > 0;

        SET p_procesados = ROW_COUNT();

        SELECT COALESCE(SUM(nin_valor), 0) INTO p_total_pagado
          FROM RPJ_PRC_NOMINA_INGRESO
         WHERE nin_id_planilla = p_id_planilla AND nin_id_tipo_planilla = 5;

        UPDATE RPJ_CAT_PARAMETRO_PLANILLA
           SET ppl_estado_proceso   = 'GENERADA',
               ppl_fecha_generacion = NOW(),
               ppl_usuario_genera   = p_usuario
         WHERE ppl_correlativo = p_id_planilla;

        COMMIT;

        SET p_resultado = CONCAT('PROCESO EXITOSO. Periodo ', DATE_FORMAT(v_ini,'%d/%m/%Y'),
                                 ' al ', DATE_FORMAT(v_fin,'%d/%m/%Y'),
                                 '. Empleados: ', p_procesados,
                                 '. Total: Q', FORMAT(p_total_pagado, 2), '.');
    END IF;
END $$

DELIMITER ;

-- ============================================================================
-- BLOQUE 3 — SP sp_generar_aguinaldo  (planilla tipo 7)
-- Periodo: 01/12/(anio-1) al 30/11/(anio). Formula: salario * dias / 365.
-- ============================================================================
SELECT 'BLOQUE 3: SP sp_generar_aguinaldo' AS etapa;

DROP PROCEDURE IF EXISTS sp_generar_aguinaldo;
DELIMITER $$

CREATE PROCEDURE sp_generar_aguinaldo(
    IN  p_id_planilla  INT,
    IN  p_anio         INT,
    IN  p_usuario      VARCHAR(50),
    OUT p_procesados   INT,
    OUT p_total_pagado DECIMAL(12,2),
    OUT p_resultado    VARCHAR(200)
)
BEGIN
    DECLARE v_tipo_planilla INT;
    DECLARE v_estado_proc   VARCHAR(20);
    DECLARE v_ini           DATE;
    DECLARE v_fin           DATE;
    DECLARE v_tin           INT DEFAULT NULL;
    DECLARE v_ya            INT DEFAULT 0;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1 @pr_errno = MYSQL_ERRNO, @pr_msg = MESSAGE_TEXT;
        ROLLBACK;
        SET p_procesados = 0;
        SET p_total_pagado = 0.00;
        SET p_resultado = CONCAT('ERROR: ', @pr_errno, ' - ', @pr_msg);
    END;

    SET p_procesados = 0;
    SET p_total_pagado = 0.00;

    SELECT ppl_tipo_planilla, ppl_estado_proceso
      INTO v_tipo_planilla, v_estado_proc
      FROM RPJ_CAT_PARAMETRO_PLANILLA
     WHERE ppl_correlativo = p_id_planilla;

    SELECT tin_id INTO v_tin FROM RPJ_CAT_TIPO_INGRESO
     WHERE UPPER(tin_tipo_ingreso) = 'AGUINALDO' ORDER BY tin_id LIMIT 1;

    SELECT COUNT(*) INTO v_ya FROM RPJ_PRC_NOMINA_INGRESO
     WHERE nin_id_planilla = p_id_planilla AND nin_id_tipo_planilla = 7;

    IF v_estado_proc IS NULL THEN
        SET p_resultado = 'ERROR: La planilla no existe.';
    ELSEIF v_tipo_planilla <> 7 THEN
        SET p_resultado = 'ERROR: La planilla no es de tipo 7 (Aguinaldo).';
    ELSEIF v_estado_proc NOT IN ('ABIERTA','REVERSADA') THEN
        SET p_resultado = CONCAT('ERROR: La planilla esta en estado ', v_estado_proc, '; solo se genera desde ABIERTA o REVERSADA.');
    ELSEIF v_tin IS NULL THEN
        SET p_resultado = 'ERROR: Falta el tipo de ingreso AGUINALDO en el catalogo.';
    ELSEIF p_anio IS NULL OR p_anio < 1900 OR p_anio > 2999 THEN
        SET p_resultado = 'ERROR: Anio invalido.';
    ELSEIF v_ya > 0 THEN
        SET p_resultado = 'ERROR: Esta planilla ya tiene registros de Aguinaldo. Reviertala antes de regenerar.';
    ELSE
        SET v_ini = MAKEDATE(p_anio - 1, 1) + INTERVAL 11 MONTH;              -- 01/12/(anio-1)
        SET v_fin = MAKEDATE(p_anio, 1) + INTERVAL 11 MONTH - INTERVAL 1 DAY; -- 30/11/(anio)

        START TRANSACTION;

        INSERT INTO RPJ_PRC_NOMINA_INGRESO (
            nin_tipo_manejo, nin_id_tipo_planilla, nin_id_planilla, nin_id_empleado,
            nin_tipo_ingreso, nin_valor, nin_valor_teorico, nin_porcentaje_aplicado,
            nin_pago_corriente, nin_abono_historico, nin_dias_trabajados,
            nin_puesto, nin_area, nin_usuario_creacion
        )
        SELECT 1, 7, p_id_planilla, x.emp,
               v_tin,
               ROUND(x.salario * x.dias / 365, 2),
               x.salario, 100.00,
               ROUND(x.salario * x.dias / 365, 2),
               0.00, x.dias,
               COALESCE(x.puesto, 'N/D'), 'TRABAJADORES', p_usuario
          FROM (
            SELECT e.emp_correlativo AS emp,
                   e.emp_profesion_oficio AS puesto,
                   base.salario AS salario,
                   LEAST(365, GREATEST(0,
                     DATEDIFF(v_fin, GREATEST(v_ini, COALESCE(e.emp_fecha_ingreso, v_ini))) + 1)) AS dias
              FROM RPJ_MNT_EMPLEADO e
              INNER JOIN (
                    SELECT s.sal_id_empleado, s.sal_salario AS salario
                      FROM RPJ_MNT_SALARIO s
                     WHERE s.sal_tipo_manejo = 1
                       AND s.sal_correlativo = (
                           SELECT MIN(s2.sal_correlativo) FROM RPJ_MNT_SALARIO s2
                            WHERE s2.sal_id_empleado = s.sal_id_empleado AND s2.sal_tipo_manejo = 1)
              ) base ON base.sal_id_empleado = e.emp_correlativo
             WHERE e.emp_tipo_manejo = 1
               AND UPPER(COALESCE(e.emp_estado,'ACTIVO')) <> 'INACTIVO'
               AND COALESCE(e.emp_fecha_ingreso, v_ini) <= v_fin
          ) x
         WHERE x.dias > 0 AND x.salario > 0;

        SET p_procesados = ROW_COUNT();

        SELECT COALESCE(SUM(nin_valor), 0) INTO p_total_pagado
          FROM RPJ_PRC_NOMINA_INGRESO
         WHERE nin_id_planilla = p_id_planilla AND nin_id_tipo_planilla = 7;

        UPDATE RPJ_CAT_PARAMETRO_PLANILLA
           SET ppl_estado_proceso   = 'GENERADA',
               ppl_fecha_generacion = NOW(),
               ppl_usuario_genera   = p_usuario
         WHERE ppl_correlativo = p_id_planilla;

        COMMIT;

        SET p_resultado = CONCAT('PROCESO EXITOSO. Periodo ', DATE_FORMAT(v_ini,'%d/%m/%Y'),
                                 ' al ', DATE_FORMAT(v_fin,'%d/%m/%Y'),
                                 '. Empleados: ', p_procesados,
                                 '. Total: Q', FORMAT(p_total_pagado, 2), '.');
    END IF;
END $$

DELIMITER ;

-- ============================================================================
-- BLOQUE 4 — SP sp_generar_bono_vacacional  (planilla tipo 9)
-- Formula: salario * porcentaje / 100. Solo empleados con >= 365 dias de
-- antiguedad, medidos contra ppl_fecha_pago de la planilla.
-- ============================================================================
SELECT 'BLOQUE 4: SP sp_generar_bono_vacacional' AS etapa;

DROP PROCEDURE IF EXISTS sp_generar_bono_vacacional;
DELIMITER $$

CREATE PROCEDURE sp_generar_bono_vacacional(
    IN  p_id_planilla  INT,
    IN  p_porcentaje   DECIMAL(5,2),
    IN  p_usuario      VARCHAR(50),
    OUT p_procesados   INT,
    OUT p_excluidos    INT,
    OUT p_total_pagado DECIMAL(12,2),
    OUT p_resultado    VARCHAR(200)
)
BEGIN
    DECLARE v_tipo_planilla INT;
    DECLARE v_estado_proc   VARCHAR(20);
    DECLARE v_fecha_corte   DATE;
    DECLARE v_tin           INT DEFAULT NULL;
    DECLARE v_ya            INT DEFAULT 0;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1 @pr_errno = MYSQL_ERRNO, @pr_msg = MESSAGE_TEXT;
        ROLLBACK;
        SET p_procesados = 0;
        SET p_excluidos = 0;
        SET p_total_pagado = 0.00;
        SET p_resultado = CONCAT('ERROR: ', @pr_errno, ' - ', @pr_msg);
    END;

    SET p_procesados = 0;
    SET p_excluidos = 0;
    SET p_total_pagado = 0.00;

    SELECT ppl_tipo_planilla, ppl_estado_proceso, COALESCE(ppl_fecha_pago, CURDATE())
      INTO v_tipo_planilla, v_estado_proc, v_fecha_corte
      FROM RPJ_CAT_PARAMETRO_PLANILLA
     WHERE ppl_correlativo = p_id_planilla;

    SELECT tin_id INTO v_tin FROM RPJ_CAT_TIPO_INGRESO
     WHERE UPPER(tin_tipo_ingreso) = 'BONO VACACIONAL' ORDER BY tin_id LIMIT 1;

    SELECT COUNT(*) INTO v_ya FROM RPJ_PRC_NOMINA_INGRESO
     WHERE nin_id_planilla = p_id_planilla AND nin_id_tipo_planilla = 9;

    IF v_estado_proc IS NULL THEN
        SET p_resultado = 'ERROR: La planilla no existe.';
    ELSEIF v_tipo_planilla <> 9 THEN
        SET p_resultado = 'ERROR: La planilla no es de tipo 9 (Bono Vacacional).';
    ELSEIF v_estado_proc NOT IN ('ABIERTA','REVERSADA') THEN
        SET p_resultado = CONCAT('ERROR: La planilla esta en estado ', v_estado_proc, '; solo se genera desde ABIERTA o REVERSADA.');
    ELSEIF v_tin IS NULL THEN
        SET p_resultado = 'ERROR: Falta el tipo de ingreso BONO VACACIONAL en el catalogo.';
    ELSEIF p_porcentaje IS NULL OR p_porcentaje < 0.01 OR p_porcentaje > 100.00 THEN
        SET p_resultado = 'ERROR: El porcentaje debe estar entre 0.01 y 100.00.';
    ELSEIF v_ya > 0 THEN
        SET p_resultado = 'ERROR: Esta planilla ya tiene registros de Bono Vacacional. Reviertala antes de regenerar.';
    ELSE
        -- Empleados activos SIN el año de antigüedad: se reportan como excluidos.
        SELECT COUNT(*) INTO p_excluidos
          FROM RPJ_MNT_EMPLEADO e
         WHERE e.emp_tipo_manejo = 1
           AND UPPER(COALESCE(e.emp_estado,'ACTIVO')) <> 'INACTIVO'
           AND DATEDIFF(v_fecha_corte, COALESCE(e.emp_fecha_ingreso, v_fecha_corte)) < 365;

        START TRANSACTION;

        INSERT INTO RPJ_PRC_NOMINA_INGRESO (
            nin_tipo_manejo, nin_id_tipo_planilla, nin_id_planilla, nin_id_empleado,
            nin_tipo_ingreso, nin_valor, nin_valor_teorico, nin_porcentaje_aplicado,
            nin_pago_corriente, nin_abono_historico, nin_dias_trabajados,
            nin_puesto, nin_area, nin_usuario_creacion
        )
        SELECT 1, 9, p_id_planilla, x.emp,
               v_tin,
               ROUND(x.salario * p_porcentaje / 100, 2),
               x.salario, p_porcentaje,
               ROUND(x.salario * p_porcentaje / 100, 2),
               0.00, x.dias_antiguedad,
               COALESCE(x.puesto, 'N/D'), 'TRABAJADORES', p_usuario
          FROM (
            SELECT e.emp_correlativo AS emp,
                   e.emp_profesion_oficio AS puesto,
                   base.salario AS salario,
                   DATEDIFF(v_fecha_corte, COALESCE(e.emp_fecha_ingreso, v_fecha_corte)) AS dias_antiguedad
              FROM RPJ_MNT_EMPLEADO e
              INNER JOIN (
                    SELECT s.sal_id_empleado, s.sal_salario AS salario
                      FROM RPJ_MNT_SALARIO s
                     WHERE s.sal_tipo_manejo = 1
                       AND s.sal_correlativo = (
                           SELECT MIN(s2.sal_correlativo) FROM RPJ_MNT_SALARIO s2
                            WHERE s2.sal_id_empleado = s.sal_id_empleado AND s2.sal_tipo_manejo = 1)
              ) base ON base.sal_id_empleado = e.emp_correlativo
             WHERE e.emp_tipo_manejo = 1
               AND UPPER(COALESCE(e.emp_estado,'ACTIVO')) <> 'INACTIVO'
          ) x
         WHERE x.dias_antiguedad >= 365 AND x.salario > 0;

        SET p_procesados = ROW_COUNT();

        SELECT COALESCE(SUM(nin_valor), 0) INTO p_total_pagado
          FROM RPJ_PRC_NOMINA_INGRESO
         WHERE nin_id_planilla = p_id_planilla AND nin_id_tipo_planilla = 9;

        UPDATE RPJ_CAT_PARAMETRO_PLANILLA
           SET ppl_estado_proceso    = 'GENERADA',
               ppl_fecha_generacion  = NOW(),
               ppl_usuario_genera    = p_usuario,
               ppl_aplica_porcentaje = 1,
               ppl_porcentaje_pago   = p_porcentaje
         WHERE ppl_correlativo = p_id_planilla;

        COMMIT;

        SET p_resultado = CONCAT('PROCESO EXITOSO. Porcentaje: ', p_porcentaje,
                                 '%. Empleados: ', p_procesados,
                                 '. Excluidos (sin 1 anio): ', p_excluidos,
                                 '. Total: Q', FORMAT(p_total_pagado, 2), '.');
    END IF;
END $$

DELIMITER ;

-- ============================================================================
-- BLOQUE 5 — SPs de reversión (uno por prestación)
-- Solo desde GENERADA. Elimina TODOS los renglones de la planilla y la deja
-- en REVERSADA (los DELETE quedan en b_RPJ_PRC_NOMINA_INGRESO por trigger).
-- ============================================================================
SELECT 'BLOQUE 5: SPs de reversion' AS etapa;

DROP PROCEDURE IF EXISTS sp_revertir_bono14;
DROP PROCEDURE IF EXISTS sp_revertir_aguinaldo;
DROP PROCEDURE IF EXISTS sp_revertir_bono_vacacional;
DROP PROCEDURE IF EXISTS _sp_revertir_prestacion;
DELIMITER $$

-- Núcleo común: recibe el tipo de planilla esperado.
CREATE PROCEDURE _sp_revertir_prestacion(
    IN  p_id_planilla   INT,
    IN  p_tipo_planilla INT,
    IN  p_nombre        VARCHAR(40),
    IN  p_usuario       VARCHAR(50),
    IN  p_motivo        VARCHAR(200),
    OUT p_resultado     VARCHAR(200)
)
BEGIN
    DECLARE v_tipo    INT;
    DECLARE v_estado  VARCHAR(20);
    DECLARE v_lineas  INT DEFAULT 0;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1 @pr_errno = MYSQL_ERRNO, @pr_msg = MESSAGE_TEXT;
        ROLLBACK;
        SET p_resultado = CONCAT('ERROR: ', @pr_errno, ' - ', @pr_msg);
    END;

    SELECT ppl_tipo_planilla, ppl_estado_proceso
      INTO v_tipo, v_estado
      FROM RPJ_CAT_PARAMETRO_PLANILLA
     WHERE ppl_correlativo = p_id_planilla;

    IF v_estado IS NULL THEN
        SET p_resultado = 'ERROR: La planilla no existe.';
    ELSEIF v_tipo <> p_tipo_planilla THEN
        SET p_resultado = CONCAT('ERROR: La planilla no es de ', p_nombre, '.');
    ELSEIF v_estado <> 'GENERADA' THEN
        SET p_resultado = CONCAT('ERROR: Solo se puede revertir una planilla GENERADA (actual: ', v_estado, ').');
    ELSEIF p_motivo IS NULL OR TRIM(p_motivo) = '' THEN
        SET p_resultado = 'ERROR: El motivo de la reversion es obligatorio.';
    ELSE
        START TRANSACTION;

        DELETE FROM RPJ_PRC_NOMINA_INGRESO
         WHERE nin_id_planilla = p_id_planilla
           AND nin_id_tipo_planilla = p_tipo_planilla;
        SET v_lineas = ROW_COUNT();

        UPDATE RPJ_CAT_PARAMETRO_PLANILLA
           SET ppl_estado_proceso   = 'REVERSADA',
               ppl_fecha_generacion = NULL,
               ppl_usuario_genera   = p_usuario
         WHERE ppl_correlativo = p_id_planilla;

        COMMIT;

        SET p_resultado = CONCAT('REVERSION EXITOSA. ', p_nombre, ': ', v_lineas,
                                 ' renglones eliminados. Motivo: ', p_motivo);
    END IF;
END $$

CREATE PROCEDURE sp_revertir_bono14(
    IN p_id_planilla INT, IN p_usuario VARCHAR(50), IN p_motivo VARCHAR(200),
    OUT p_resultado VARCHAR(200))
BEGIN
    CALL _sp_revertir_prestacion(p_id_planilla, 5, 'BONO 14', p_usuario, p_motivo, p_resultado);
END $$

CREATE PROCEDURE sp_revertir_aguinaldo(
    IN p_id_planilla INT, IN p_usuario VARCHAR(50), IN p_motivo VARCHAR(200),
    OUT p_resultado VARCHAR(200))
BEGIN
    CALL _sp_revertir_prestacion(p_id_planilla, 7, 'AGUINALDO', p_usuario, p_motivo, p_resultado);
END $$

CREATE PROCEDURE sp_revertir_bono_vacacional(
    IN p_id_planilla INT, IN p_usuario VARCHAR(50), IN p_motivo VARCHAR(200),
    OUT p_resultado VARCHAR(200))
BEGIN
    CALL _sp_revertir_prestacion(p_id_planilla, 9, 'BONO VACACIONAL', p_usuario, p_motivo, p_resultado);
END $$

DELIMITER ;

-- ============================================================================
-- BLOQUE 6 — SPs de edición manual (editar / agregar / eliminar renglón)
-- Aplican a los 3 tipos de prestación (5, 7, 9).
-- ============================================================================
SELECT 'BLOQUE 6: SPs de edicion manual' AS etapa;

DROP PROCEDURE IF EXISTS sp_editar_monto_prestacion;
DROP PROCEDURE IF EXISTS sp_agregar_empleado_prestacion;
DROP PROCEDURE IF EXISTS sp_eliminar_linea_prestacion;
DELIMITER $$

CREATE PROCEDURE sp_editar_monto_prestacion(
    IN  p_id_linea    INT,
    IN  p_nuevo_monto DECIMAL(10,2),
    IN  p_usuario     VARCHAR(50),
    OUT p_resultado   VARCHAR(200)
)
BEGIN
    DECLARE v_tipo_planilla INT;
    DECLARE v_id_planilla   INT;
    DECLARE v_estado        VARCHAR(20);
    DECLARE v_monto_ant     DECIMAL(10,2);

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1 @pr_errno = MYSQL_ERRNO, @pr_msg = MESSAGE_TEXT;
        ROLLBACK;
        SET p_resultado = CONCAT('ERROR: ', @pr_errno, ' - ', @pr_msg);
    END;

    SELECT nin_id_tipo_planilla, nin_id_planilla, nin_valor
      INTO v_tipo_planilla, v_id_planilla, v_monto_ant
      FROM RPJ_PRC_NOMINA_INGRESO
     WHERE nin_correlativo = p_id_linea;

    SELECT ppl_estado_proceso INTO v_estado
      FROM RPJ_CAT_PARAMETRO_PLANILLA
     WHERE ppl_correlativo = v_id_planilla;

    IF v_id_planilla IS NULL THEN
        SET p_resultado = 'ERROR: El renglon no existe.';
    ELSEIF v_tipo_planilla NOT IN (5,7,9) THEN
        SET p_resultado = 'ERROR: El renglon no pertenece a una planilla de prestaciones (5, 7 o 9).';
    ELSEIF v_estado NOT IN ('ABIERTA','GENERADA') THEN
        SET p_resultado = CONCAT('ERROR: Solo se puede editar en estado ABIERTA o GENERADA (actual: ', v_estado, ').');
    ELSEIF p_nuevo_monto IS NULL OR p_nuevo_monto <= 0 THEN
        SET p_resultado = 'ERROR: El monto debe ser mayor a cero.';
    ELSE
        START TRANSACTION;

        UPDATE RPJ_PRC_NOMINA_INGRESO
           SET nin_valor           = p_nuevo_monto,
               nin_pago_corriente  = p_nuevo_monto,
               nin_usuario_creacion = p_usuario
         WHERE nin_correlativo = p_id_linea;

        COMMIT;

        SET p_resultado = CONCAT('MONTO ACTUALIZADO. Anterior: Q', FORMAT(v_monto_ant, 2),
                                 ' -> Nuevo: Q', FORMAT(p_nuevo_monto, 2), '.');
    END IF;
END $$

CREATE PROCEDURE sp_agregar_empleado_prestacion(
    IN  p_id_planilla INT,
    IN  p_id_empleado INT,
    IN  p_monto       DECIMAL(10,2),
    IN  p_dias        INT,
    IN  p_usuario     VARCHAR(50),
    OUT p_resultado   VARCHAR(200)
)
BEGIN
    DECLARE v_tipo_planilla INT;
    DECLARE v_estado        VARCHAR(20);
    DECLARE v_emp_estado    VARCHAR(45);
    DECLARE v_puesto        VARCHAR(100);
    DECLARE v_tin           INT DEFAULT NULL;
    DECLARE v_dup           INT DEFAULT 0;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1 @pr_errno = MYSQL_ERRNO, @pr_msg = MESSAGE_TEXT;
        ROLLBACK;
        SET p_resultado = CONCAT('ERROR: ', @pr_errno, ' - ', @pr_msg);
    END;

    SELECT ppl_tipo_planilla, ppl_estado_proceso
      INTO v_tipo_planilla, v_estado
      FROM RPJ_CAT_PARAMETRO_PLANILLA
     WHERE ppl_correlativo = p_id_planilla;

    SELECT COALESCE(emp_estado,'ACTIVO'), emp_profesion_oficio
      INTO v_emp_estado, v_puesto
      FROM RPJ_MNT_EMPLEADO
     WHERE emp_correlativo = p_id_empleado AND emp_tipo_manejo = 1;

    SELECT COUNT(*) INTO v_dup
      FROM RPJ_PRC_NOMINA_INGRESO
     WHERE nin_id_planilla = p_id_planilla
       AND nin_id_empleado = p_id_empleado
       AND nin_id_tipo_planilla = COALESCE(v_tipo_planilla, 0);

    SELECT tin_id INTO v_tin FROM RPJ_CAT_TIPO_INGRESO
     WHERE UPPER(tin_tipo_ingreso) = CASE COALESCE(v_tipo_planilla, 0)
                                       WHEN 5 THEN 'BONO 14'
                                       WHEN 7 THEN 'AGUINALDO'
                                       WHEN 9 THEN 'BONO VACACIONAL'
                                       ELSE '' END
     ORDER BY tin_id LIMIT 1;

    IF v_estado IS NULL THEN
        SET p_resultado = 'ERROR: La planilla no existe.';
    ELSEIF v_tipo_planilla NOT IN (5,7,9) THEN
        SET p_resultado = 'ERROR: La planilla no es de prestaciones (tipo 5, 7 o 9).';
    ELSEIF v_estado NOT IN ('ABIERTA','GENERADA') THEN
        SET p_resultado = CONCAT('ERROR: Solo se puede agregar en estado ABIERTA o GENERADA (actual: ', v_estado, ').');
    ELSEIF v_emp_estado IS NULL THEN
        SET p_resultado = 'ERROR: El empleado no existe o no es de regimen.';
    ELSEIF UPPER(v_emp_estado) = 'INACTIVO' THEN
        SET p_resultado = 'ERROR: El empleado no esta activo.';
    ELSEIF v_dup > 0 THEN
        SET p_resultado = 'ERROR: El empleado ya esta registrado en esta planilla.';
    ELSEIF p_monto IS NULL OR p_monto <= 0 THEN
        SET p_resultado = 'ERROR: El monto debe ser mayor a cero.';
    ELSEIF v_tin IS NULL THEN
        SET p_resultado = 'ERROR: Falta el tipo de ingreso de la prestacion en el catalogo.';
    ELSE
        START TRANSACTION;

        INSERT INTO RPJ_PRC_NOMINA_INGRESO (
            nin_tipo_manejo, nin_id_tipo_planilla, nin_id_planilla, nin_id_empleado,
            nin_tipo_ingreso, nin_valor, nin_valor_teorico, nin_porcentaje_aplicado,
            nin_pago_corriente, nin_abono_historico, nin_dias_trabajados,
            nin_puesto, nin_area, nin_usuario_creacion
        ) VALUES (
            1, v_tipo_planilla, p_id_planilla, p_id_empleado,
            v_tin, p_monto, p_monto, 100.00,
            p_monto, 0.00, COALESCE(p_dias, 0),
            COALESCE(v_puesto, 'N/D'), 'TRABAJADORES', p_usuario
        );

        COMMIT;

        SET p_resultado = CONCAT('EMPLEADO AGREGADO. Monto: Q', FORMAT(p_monto, 2),
                                 '. Dias: ', COALESCE(p_dias, 0), '.');
    END IF;
END $$

CREATE PROCEDURE sp_eliminar_linea_prestacion(
    IN  p_id_linea  INT,
    IN  p_usuario   VARCHAR(50),
    IN  p_motivo    VARCHAR(200),
    OUT p_resultado VARCHAR(200)
)
BEGIN
    DECLARE v_tipo_planilla INT;
    DECLARE v_id_planilla   INT;
    DECLARE v_estado        VARCHAR(20);
    DECLARE v_monto         DECIMAL(10,2);

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1 @pr_errno = MYSQL_ERRNO, @pr_msg = MESSAGE_TEXT;
        ROLLBACK;
        SET p_resultado = CONCAT('ERROR: ', @pr_errno, ' - ', @pr_msg);
    END;

    SELECT nin_id_tipo_planilla, nin_id_planilla, nin_valor
      INTO v_tipo_planilla, v_id_planilla, v_monto
      FROM RPJ_PRC_NOMINA_INGRESO
     WHERE nin_correlativo = p_id_linea;

    SELECT ppl_estado_proceso INTO v_estado
      FROM RPJ_CAT_PARAMETRO_PLANILLA
     WHERE ppl_correlativo = v_id_planilla;

    IF v_id_planilla IS NULL THEN
        SET p_resultado = 'ERROR: El renglon no existe.';
    ELSEIF v_tipo_planilla NOT IN (5,7,9) THEN
        SET p_resultado = 'ERROR: El renglon no pertenece a una planilla de prestaciones (5, 7 o 9).';
    ELSEIF v_estado NOT IN ('ABIERTA','GENERADA') THEN
        SET p_resultado = CONCAT('ERROR: Solo se puede eliminar en estado ABIERTA o GENERADA (actual: ', v_estado, ').');
    ELSEIF p_motivo IS NULL OR TRIM(p_motivo) = '' THEN
        SET p_resultado = 'ERROR: El motivo es obligatorio.';
    ELSE
        START TRANSACTION;

        DELETE FROM RPJ_PRC_NOMINA_INGRESO WHERE nin_correlativo = p_id_linea;

        COMMIT;

        SET p_resultado = CONCAT('RENGLON ELIMINADO. Monto: Q', FORMAT(v_monto, 2),
                                 '. Motivo: ', p_motivo);
    END IF;
END $$

DELIMITER ;

-- ============================================================================
-- BLOQUE 7 — VERIFICACIÓN
-- ============================================================================
SELECT 'BLOQUE 7: verificacion' AS etapa;

SELECT tpl_id, tpl_tipo_planilla
  FROM RPJ_CAT_TIPO_PLANILLA
 WHERE tpl_id IN (5,7,9)
 ORDER BY tpl_id;

SELECT tin_id, tin_tipo_ingreso
  FROM RPJ_CAT_TIPO_INGRESO
 WHERE UPPER(tin_tipo_ingreso) IN ('BONO 14','AGUINALDO','BONO VACACIONAL')
 ORDER BY tin_id;

SELECT ROUTINE_NAME
  FROM information_schema.ROUTINES
 WHERE ROUTINE_SCHEMA = DATABASE()
   AND ROUTINE_NAME IN ('sp_generar_bono14','sp_generar_aguinaldo','sp_generar_bono_vacacional',
                        'sp_revertir_bono14','sp_revertir_aguinaldo','sp_revertir_bono_vacacional',
                        'sp_editar_monto_prestacion','sp_agregar_empleado_prestacion',
                        'sp_eliminar_linea_prestacion')
 ORDER BY ROUTINE_NAME;

SELECT 'MIGRACION DE PRESTACIONES COMPLETADA' AS resultado;
