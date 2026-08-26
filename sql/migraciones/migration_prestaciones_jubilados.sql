-- ============================================================================
-- MIGRACIÓN — Prestaciones para Jubilados (Bono 14 y Aguinaldo)
-- Base de datos : apps_rpjepq
-- Motor         : MySQL 8 / MariaDB (portable, sin ADD COLUMN IF NOT EXISTS)
-- Idempotente, NO destructiva (sin DROP TABLE / TRUNCATE / DELETE de datos).
--
-- Hace:
--   1. Siembra tipos de planilla 6 (BONO 14 JUBILADOS) y 8 (AGUINALDO JUBILADOS).
--      Reutiliza los tipos de ingreso BONO 14 / AGUINALDO ya sembrados por
--      migration_prestaciones.sql (mismo concepto de pago, distinto colectivo).
--   2. Crea 3 procedimientos "núcleo" privados (compartidos entre bono14 y
--      aguinaldo, evitan duplicar la lógica 3 veces):
--        _pj_generar_jubilado_grupo  -> activos NORMALES y AMPARISTAS
--        _pj_generar_beneficiarios   -> beneficiarios de jubilados fallecidos
--   3. Crea los 7 SP públicos del documento:
--        sp_generar_bono14_jub_activos / _beneficiarios / _amparistas
--        sp_generar_aguinaldo_jub_activos / _beneficiarios / _amparistas
--        sp_revertir_prestacion_jubilados
--   4. Amplía sp_editar_monto_prestacion y sp_eliminar_linea_prestacion
--      (creados por migration_prestaciones.sql) para aceptar también los tipos
--      de planilla 6 y 8 — "reutilizar SPs de editar/eliminar" tal como pide
--      el documento, en vez de duplicarlos.
--   5. Crea sp_agregar_jubilado_prestacion (agregar manualmente un jubilado
--      o un beneficiario a una planilla de prestación 6/8).
--
-- DECISIONES DE IMPLEMENTACIÓN (ver INFORME_PRESTACIONES_JUBILADOS.md):
--   #1 nin_tipo_manejo = 2 para TODO renglón de jubilados (activos, amparistas
--      Y beneficiarios) — igual que sp_generar_nomina_pensionados/beneficiarios/
--      amparistas ya existentes. El beneficiario se distingue por
--      nin_id_beneficiario IS NOT NULL, NO por nin_tipo_manejo = 5 como sugiere
--      la sección 6.3/6.5 del documento (ese valor no se usa en ningún otro SP
--      del sistema; se sigue la convención real ya en producción).
--   #2 La pensión base sale de RPJ_MNT_SALARIO (sal_id_jubilado, sal_tipo_manejo=2,
--      sal_tipo_ingreso=1 'PENSION'), igual que los SP de nómina mensual.
--   #3 Elegibilidad: jub_tipo_manejo=2, jub_estado='ACTIVO', jub_estado_pago='ACTIVO'
--      (excluye SUSPENDIDO y FALLECIDO), jub_tipo_pago='NORMAL'|'AMPARISTA' según
--      el grupo. NO se consulta RPJ_MNT_DATOS_PLANILLA.dat_aplica_nomina — el
--      documento no lo pide y Bono14/Aguinaldo son prestaciones de ley, no nómina
--      discrecional. Si se requiere que un jubilado "suspendido de nómina" por
--      otra razón también quede excluido de estas prestaciones, hay que agregar
--      ese filtro explícitamente (decisión pendiente de confirmar).
--   #4 Sin deuda histórica ni descuentos (tal como pide el documento): a
--      diferencia de la nómina mensual, estos SP NO tocan RPJ_PRC_DEUDA_JUBILADO
--      ni RPJ_PRC_APLICACION_PAGO ni RPJ_PRC_NOMINA_DESCUENTO.
--   #5 Los 3 SP de cada prestación (activos/beneficiarios/amparistas) se pueden
--      llamar en cualquier orden contra la MISMA planilla; cada uno valida
--      idempotencia SOLO sobre su propio grupo (para no bloquear a los otros 2
--      si uno ya corrió) y marca la planilla GENERADA sin pisar la fecha de
--      generación si ya lo estaba.
-- ============================================================================

USE `apps_rpjepq`;

-- ============================================================================
-- BLOQUE 0 — Helper idempotente (se re-crea aquí para que este script sea
-- autosuficiente incluso si se corre sin haber corrido antes
-- migration_prestaciones.sql, que ya lo define igual).
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
-- BLOQUE 1 — Siembra de catálogos (tipos de planilla 6 y 8)
-- ============================================================================
SELECT 'BLOQUE 1: siembra de catalogos' AS etapa;

CALL _pr_safe(CONCAT(
  "INSERT INTO RPJ_CAT_TIPO_PLANILLA (tpl_id, tpl_tipo_planilla, tpl_descripcion, tpl_id_tipo_uso, tpl_usuario_creacion)
   SELECT 6,'BONO 14 JUBILADOS','Bonificacion anual jubilados Decreto 42-92',",
   COALESCE((SELECT tpl_id_tipo_uso FROM RPJ_CAT_TIPO_PLANILLA WHERE tpl_id=2), 1),
   ",'sistema' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM RPJ_CAT_TIPO_PLANILLA WHERE tpl_id = 6)"));

CALL _pr_safe(CONCAT(
  "INSERT INTO RPJ_CAT_TIPO_PLANILLA (tpl_id, tpl_tipo_planilla, tpl_descripcion, tpl_id_tipo_uso, tpl_usuario_creacion)
   SELECT 8,'AGUINALDO JUBILADOS','Aguinaldo jubilados Decreto 76-78',",
   COALESCE((SELECT tpl_id_tipo_uso FROM RPJ_CAT_TIPO_PLANILLA WHERE tpl_id=2), 1),
   ",'sistema' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM RPJ_CAT_TIPO_PLANILLA WHERE tpl_id = 8)"));

-- ============================================================================
-- BLOQUE 2 — Núcleo privado: activos NORMALES y AMPARISTAS
-- ============================================================================
SELECT 'BLOQUE 2: nucleo _pj_generar_jubilado_grupo' AS etapa;

DROP PROCEDURE IF EXISTS _pj_generar_jubilado_grupo;
DELIMITER $$

CREATE PROCEDURE _pj_generar_jubilado_grupo(
    IN  p_id_planilla     INT,
    IN  p_tipo_planilla   INT,
    IN  p_tin             INT,
    IN  p_fecha_ini       DATE,
    IN  p_fecha_fin       DATE,
    IN  p_porcentaje      DECIMAL(5,2),
    IN  p_tipo_pago_filtro VARCHAR(20),  -- 'NORMAL' o 'AMPARISTA'
    IN  p_usuario         VARCHAR(50),
    OUT p_procesados      INT,
    OUT p_total_pagado    DECIMAL(12,2),
    OUT p_resultado       VARCHAR(200)
)
BEGIN
    DECLARE v_tipo_planilla INT;
    DECLARE v_estado_proc   VARCHAR(20);
    DECLARE v_ya            INT DEFAULT 0;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1 @pj_errno = MYSQL_ERRNO, @pj_msg = MESSAGE_TEXT;
        ROLLBACK;
        SET p_procesados = 0;
        SET p_total_pagado = 0.00;
        SET p_resultado = CONCAT('ERROR: ', @pj_errno, ' - ', @pj_msg);
    END;

    SET p_procesados = 0;
    SET p_total_pagado = 0.00;

    SELECT ppl_tipo_planilla, ppl_estado_proceso
      INTO v_tipo_planilla, v_estado_proc
      FROM RPJ_CAT_PARAMETRO_PLANILLA
     WHERE ppl_correlativo = p_id_planilla;

    SELECT COUNT(*) INTO v_ya
      FROM RPJ_PRC_NOMINA_INGRESO ni
      INNER JOIN RPJ_MNT_JUBILADO j ON j.jub_correlativo = ni.nin_id_jubilado
     WHERE ni.nin_id_planilla = p_id_planilla
       AND ni.nin_id_tipo_planilla = p_tipo_planilla
       AND ni.nin_id_beneficiario IS NULL
       AND j.jub_tipo_pago = p_tipo_pago_filtro;

    IF v_estado_proc IS NULL THEN
        SET p_resultado = 'ERROR: La planilla no existe.';
    ELSEIF v_tipo_planilla <> p_tipo_planilla THEN
        SET p_resultado = 'ERROR: La planilla no corresponde al tipo de prestacion esperado.';
    ELSEIF v_estado_proc NOT IN ('ABIERTA','GENERADA','REVERSADA') THEN
        SET p_resultado = CONCAT('ERROR: La planilla esta en estado ', v_estado_proc, '; no se puede generar.');
    ELSEIF p_porcentaje IS NULL OR p_porcentaje < 0.01 OR p_porcentaje > 100.00 THEN
        SET p_resultado = 'ERROR: El porcentaje debe estar entre 0.01 y 100.00.';
    ELSEIF v_ya > 0 THEN
        SET p_resultado = CONCAT('ERROR: Esta planilla ya tiene registros de ', p_tipo_pago_filtro,
                                 '. Revierta la planilla completa antes de regenerar.');
    ELSE
        START TRANSACTION;

        INSERT INTO RPJ_PRC_NOMINA_INGRESO (
            nin_tipo_manejo, nin_id_tipo_planilla, nin_id_planilla, nin_id_jubilado,
            nin_tipo_ingreso, nin_valor, nin_valor_teorico, nin_porcentaje_aplicado,
            nin_pago_corriente, nin_abono_historico, nin_dias_trabajados,
            nin_puesto, nin_area, nin_usuario_creacion
        )
        SELECT 2, p_tipo_planilla, p_id_planilla, x.jub, p_tin,
               ROUND(x.pension * x.dias / 365 * p_porcentaje / 100, 2),
               x.pension, p_porcentaje,
               ROUND(x.pension * x.dias / 365 * p_porcentaje / 100, 2),
               0.00, x.dias,
               'JUBILADO', 'ADMINISTRATIVA', p_usuario
          FROM (
            SELECT j.jub_correlativo AS jub,
                   s.sal_salario AS pension,
                   LEAST(365, GREATEST(0,
                     DATEDIFF(p_fecha_fin, GREATEST(p_fecha_ini, COALESCE(j.jub_fecha_jubilacion, p_fecha_ini))) + 1)) AS dias
              FROM RPJ_MNT_JUBILADO j
              INNER JOIN RPJ_MNT_SALARIO s
                      ON s.sal_id_jubilado  = j.jub_correlativo
                     AND s.sal_tipo_manejo  = 2
                     AND s.sal_tipo_ingreso = 1
             WHERE j.jub_tipo_manejo = 2
               AND j.jub_estado = 'ACTIVO'
               AND j.jub_tipo_pago = p_tipo_pago_filtro
               AND j.jub_estado_pago = 'ACTIVO'
          ) x
         WHERE x.dias > 0 AND x.pension > 0;

        SET p_procesados = ROW_COUNT();

        SELECT COALESCE(SUM(ni.nin_valor), 0) INTO p_total_pagado
          FROM RPJ_PRC_NOMINA_INGRESO ni
          INNER JOIN RPJ_MNT_JUBILADO j ON j.jub_correlativo = ni.nin_id_jubilado
         WHERE ni.nin_id_planilla = p_id_planilla
           AND ni.nin_id_tipo_planilla = p_tipo_planilla
           AND ni.nin_id_beneficiario IS NULL
           AND j.jub_tipo_pago = p_tipo_pago_filtro;

        UPDATE RPJ_CAT_PARAMETRO_PLANILLA
           SET ppl_estado_proceso   = 'GENERADA',
               ppl_fecha_generacion = NOW(),
               ppl_usuario_genera   = p_usuario
         WHERE ppl_correlativo = p_id_planilla
           AND ppl_estado_proceso <> 'GENERADA';

        COMMIT;

        SET p_resultado = CONCAT('PROCESO EXITOSO. ', p_tipo_pago_filtro, ': ', p_procesados,
                                 ' procesados. Total: Q', FORMAT(p_total_pagado, 2), '.');
    END IF;
END $$

DELIMITER ;

-- ============================================================================
-- BLOQUE 3 — Núcleo privado: beneficiarios de fallecidos
-- ============================================================================
SELECT 'BLOQUE 3: nucleo _pj_generar_beneficiarios' AS etapa;

DROP PROCEDURE IF EXISTS _pj_generar_beneficiarios;
DELIMITER $$

CREATE PROCEDURE _pj_generar_beneficiarios(
    IN  p_id_planilla   INT,
    IN  p_tipo_planilla INT,
    IN  p_tin           INT,
    IN  p_fecha_ini     DATE,
    IN  p_fecha_fin     DATE,
    IN  p_porcentaje    DECIMAL(5,2),
    IN  p_usuario       VARCHAR(50),
    OUT p_procesados    INT,
    OUT p_total_pagado  DECIMAL(12,2),
    OUT p_resultado     VARCHAR(200)
)
BEGIN
    DECLARE v_tipo_planilla INT;
    DECLARE v_estado_proc   VARCHAR(20);
    DECLARE v_ya            INT DEFAULT 0;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1 @pj_errno = MYSQL_ERRNO, @pj_msg = MESSAGE_TEXT;
        ROLLBACK;
        SET p_procesados = 0;
        SET p_total_pagado = 0.00;
        SET p_resultado = CONCAT('ERROR: ', @pj_errno, ' - ', @pj_msg);
    END;

    SET p_procesados = 0;
    SET p_total_pagado = 0.00;

    SELECT ppl_tipo_planilla, ppl_estado_proceso
      INTO v_tipo_planilla, v_estado_proc
      FROM RPJ_CAT_PARAMETRO_PLANILLA
     WHERE ppl_correlativo = p_id_planilla;

    SELECT COUNT(*) INTO v_ya
      FROM RPJ_PRC_NOMINA_INGRESO
     WHERE nin_id_planilla = p_id_planilla
       AND nin_id_tipo_planilla = p_tipo_planilla
       AND nin_id_beneficiario IS NOT NULL;

    IF v_estado_proc IS NULL THEN
        SET p_resultado = 'ERROR: La planilla no existe.';
    ELSEIF v_tipo_planilla <> p_tipo_planilla THEN
        SET p_resultado = 'ERROR: La planilla no corresponde al tipo de prestacion esperado.';
    ELSEIF v_estado_proc NOT IN ('ABIERTA','GENERADA','REVERSADA') THEN
        SET p_resultado = CONCAT('ERROR: La planilla esta en estado ', v_estado_proc, '; no se puede generar.');
    ELSEIF p_porcentaje IS NULL OR p_porcentaje < 0.01 OR p_porcentaje > 100.00 THEN
        SET p_resultado = 'ERROR: El porcentaje debe estar entre 0.01 y 100.00.';
    ELSEIF v_ya > 0 THEN
        SET p_resultado = 'ERROR: Esta planilla ya tiene registros de beneficiarios. Revierta la planilla completa antes de regenerar.';
    ELSE
        START TRANSACTION;

        INSERT INTO RPJ_PRC_NOMINA_INGRESO (
            nin_tipo_manejo, nin_id_tipo_planilla, nin_id_planilla, nin_id_jubilado, nin_id_beneficiario,
            nin_tipo_ingreso, nin_valor, nin_valor_teorico, nin_porcentaje_aplicado,
            nin_pago_corriente, nin_abono_historico, nin_dias_trabajados,
            nin_puesto, nin_area, nin_usuario_creacion
        )
        SELECT 2, p_tipo_planilla, p_id_planilla, x.jub, x.ben, p_tin,
               ROUND(x.pension * x.dias / 365 * p_porcentaje / 100 * x.ben_pct / 100, 2),
               x.pension, x.ben_pct,
               ROUND(x.pension * x.dias / 365 * p_porcentaje / 100 * x.ben_pct / 100, 2),
               0.00, x.dias,
               'BENEFICIARIO', 'ADMINISTRATIVA', p_usuario
          FROM (
            SELECT j.jub_correlativo AS jub, b.ben_correlativo AS ben, b.ben_porcentaje AS ben_pct,
                   s.sal_salario AS pension,
                   LEAST(365, GREATEST(0,
                     DATEDIFF(p_fecha_fin, GREATEST(p_fecha_ini, COALESCE(j.jub_fecha_jubilacion, p_fecha_ini))) + 1)) AS dias
              FROM RPJ_MNT_BENEFICIARIO b
              INNER JOIN RPJ_MNT_JUBILADO j
                      ON j.jub_correlativo = b.ben_id_jubilado
                     AND j.jub_tipo_manejo = 2
                     AND j.jub_estado_pago = 'FALLECIDO'
              INNER JOIN RPJ_MNT_SALARIO s
                      ON s.sal_id_jubilado  = j.jub_correlativo
                     AND s.sal_tipo_manejo  = 2
                     AND s.sal_tipo_ingreso = 1
             WHERE b.ben_estado = 'ACTIVO'
          ) x
         WHERE x.dias > 0 AND x.pension > 0 AND x.ben_pct > 0;

        SET p_procesados = ROW_COUNT();

        SELECT COALESCE(SUM(nin_valor), 0) INTO p_total_pagado
          FROM RPJ_PRC_NOMINA_INGRESO
         WHERE nin_id_planilla = p_id_planilla
           AND nin_id_tipo_planilla = p_tipo_planilla
           AND nin_id_beneficiario IS NOT NULL;

        UPDATE RPJ_CAT_PARAMETRO_PLANILLA
           SET ppl_estado_proceso   = 'GENERADA',
               ppl_fecha_generacion = NOW(),
               ppl_usuario_genera   = p_usuario
         WHERE ppl_correlativo = p_id_planilla
           AND ppl_estado_proceso <> 'GENERADA';

        COMMIT;

        SET p_resultado = CONCAT('PROCESO EXITOSO. Beneficiarios: ', p_procesados,
                                 ' procesados. Total: Q', FORMAT(p_total_pagado, 2), '.');
    END IF;
END $$

DELIMITER ;

-- ============================================================================
-- BLOQUE 4 — SP públicos de BONO 14 JUBILADOS (tipo 6)
-- ============================================================================
SELECT 'BLOQUE 4: SPs de bono14 jubilados' AS etapa;

DROP PROCEDURE IF EXISTS sp_generar_bono14_jub_activos;
DROP PROCEDURE IF EXISTS sp_generar_bono14_beneficiarios;
DROP PROCEDURE IF EXISTS sp_generar_bono14_amparistas;
DELIMITER $$

CREATE PROCEDURE sp_generar_bono14_jub_activos(
    IN p_id_planilla INT, IN p_anio INT, IN p_porcentaje DECIMAL(5,2), IN p_usuario VARCHAR(50),
    OUT p_procesados INT, OUT p_total_pagado DECIMAL(12,2), OUT p_resultado VARCHAR(200)
)
BEGIN
    DECLARE v_ini DATE;
    DECLARE v_fin DATE;
    DECLARE v_tin INT DEFAULT NULL;

    IF p_anio IS NULL OR p_anio < 1900 OR p_anio > 2999 THEN
        SET p_procesados = 0, p_total_pagado = 0.00, p_resultado = 'ERROR: Anio invalido.';
    ELSE
        SET v_ini = MAKEDATE(p_anio - 1, 1) + INTERVAL 6 MONTH;               -- 01/07/(anio-1)
        SET v_fin = MAKEDATE(p_anio, 1) + INTERVAL 6 MONTH - INTERVAL 1 DAY;  -- 30/06/(anio)
        SELECT tin_id INTO v_tin FROM RPJ_CAT_TIPO_INGRESO WHERE UPPER(tin_tipo_ingreso) = 'BONO 14' ORDER BY tin_id LIMIT 1;
        IF v_tin IS NULL THEN
            SET p_procesados = 0, p_total_pagado = 0.00, p_resultado = 'ERROR: Falta el tipo de ingreso BONO 14 en el catalogo.';
        ELSE
            CALL _pj_generar_jubilado_grupo(p_id_planilla, 6, v_tin, v_ini, v_fin, p_porcentaje, 'NORMAL', p_usuario,
                                             p_procesados, p_total_pagado, p_resultado);
        END IF;
    END IF;
END $$

CREATE PROCEDURE sp_generar_bono14_beneficiarios(
    IN p_id_planilla INT, IN p_anio INT, IN p_porcentaje DECIMAL(5,2), IN p_usuario VARCHAR(50),
    OUT p_procesados INT, OUT p_total_pagado DECIMAL(12,2), OUT p_resultado VARCHAR(200)
)
BEGIN
    DECLARE v_ini DATE;
    DECLARE v_fin DATE;
    DECLARE v_tin INT DEFAULT NULL;

    IF p_anio IS NULL OR p_anio < 1900 OR p_anio > 2999 THEN
        SET p_procesados = 0, p_total_pagado = 0.00, p_resultado = 'ERROR: Anio invalido.';
    ELSE
        SET v_ini = MAKEDATE(p_anio - 1, 1) + INTERVAL 6 MONTH;
        SET v_fin = MAKEDATE(p_anio, 1) + INTERVAL 6 MONTH - INTERVAL 1 DAY;
        SELECT tin_id INTO v_tin FROM RPJ_CAT_TIPO_INGRESO WHERE UPPER(tin_tipo_ingreso) = 'BONO 14' ORDER BY tin_id LIMIT 1;
        IF v_tin IS NULL THEN
            SET p_procesados = 0, p_total_pagado = 0.00, p_resultado = 'ERROR: Falta el tipo de ingreso BONO 14 en el catalogo.';
        ELSE
            CALL _pj_generar_beneficiarios(p_id_planilla, 6, v_tin, v_ini, v_fin, p_porcentaje, p_usuario,
                                            p_procesados, p_total_pagado, p_resultado);
        END IF;
    END IF;
END $$

CREATE PROCEDURE sp_generar_bono14_amparistas(
    IN p_id_planilla INT, IN p_anio INT, IN p_usuario VARCHAR(50),
    OUT p_procesados INT, OUT p_total_pagado DECIMAL(12,2), OUT p_resultado VARCHAR(200)
)
BEGIN
    DECLARE v_ini DATE;
    DECLARE v_fin DATE;
    DECLARE v_tin INT DEFAULT NULL;

    IF p_anio IS NULL OR p_anio < 1900 OR p_anio > 2999 THEN
        SET p_procesados = 0, p_total_pagado = 0.00, p_resultado = 'ERROR: Anio invalido.';
    ELSE
        SET v_ini = MAKEDATE(p_anio - 1, 1) + INTERVAL 6 MONTH;
        SET v_fin = MAKEDATE(p_anio, 1) + INTERVAL 6 MONTH - INTERVAL 1 DAY;
        SELECT tin_id INTO v_tin FROM RPJ_CAT_TIPO_INGRESO WHERE UPPER(tin_tipo_ingreso) = 'BONO 14' ORDER BY tin_id LIMIT 1;
        IF v_tin IS NULL THEN
            SET p_procesados = 0, p_total_pagado = 0.00, p_resultado = 'ERROR: Falta el tipo de ingreso BONO 14 en el catalogo.';
        ELSE
            -- Los amparistas siempre reciben 100% (sentencia judicial); no llevan p_porcentaje.
            CALL _pj_generar_jubilado_grupo(p_id_planilla, 6, v_tin, v_ini, v_fin, 100.00, 'AMPARISTA', p_usuario,
                                             p_procesados, p_total_pagado, p_resultado);
        END IF;
    END IF;
END $$

DELIMITER ;

-- ============================================================================
-- BLOQUE 5 — SP públicos de AGUINALDO JUBILADOS (tipo 8)
-- ============================================================================
SELECT 'BLOQUE 5: SPs de aguinaldo jubilados' AS etapa;

DROP PROCEDURE IF EXISTS sp_generar_aguinaldo_jub_activos;
DROP PROCEDURE IF EXISTS sp_generar_aguinaldo_beneficiarios;
DROP PROCEDURE IF EXISTS sp_generar_aguinaldo_amparistas;
DELIMITER $$

CREATE PROCEDURE sp_generar_aguinaldo_jub_activos(
    IN p_id_planilla INT, IN p_anio INT, IN p_porcentaje DECIMAL(5,2), IN p_usuario VARCHAR(50),
    OUT p_procesados INT, OUT p_total_pagado DECIMAL(12,2), OUT p_resultado VARCHAR(200)
)
BEGIN
    DECLARE v_ini DATE;
    DECLARE v_fin DATE;
    DECLARE v_tin INT DEFAULT NULL;

    IF p_anio IS NULL OR p_anio < 1900 OR p_anio > 2999 THEN
        SET p_procesados = 0, p_total_pagado = 0.00, p_resultado = 'ERROR: Anio invalido.';
    ELSE
        SET v_ini = MAKEDATE(p_anio - 1, 1) + INTERVAL 11 MONTH;              -- 01/12/(anio-1)
        SET v_fin = MAKEDATE(p_anio, 1) + INTERVAL 11 MONTH - INTERVAL 1 DAY; -- 30/11/(anio)
        SELECT tin_id INTO v_tin FROM RPJ_CAT_TIPO_INGRESO WHERE UPPER(tin_tipo_ingreso) = 'AGUINALDO' ORDER BY tin_id LIMIT 1;
        IF v_tin IS NULL THEN
            SET p_procesados = 0, p_total_pagado = 0.00, p_resultado = 'ERROR: Falta el tipo de ingreso AGUINALDO en el catalogo.';
        ELSE
            CALL _pj_generar_jubilado_grupo(p_id_planilla, 8, v_tin, v_ini, v_fin, p_porcentaje, 'NORMAL', p_usuario,
                                             p_procesados, p_total_pagado, p_resultado);
        END IF;
    END IF;
END $$

CREATE PROCEDURE sp_generar_aguinaldo_beneficiarios(
    IN p_id_planilla INT, IN p_anio INT, IN p_porcentaje DECIMAL(5,2), IN p_usuario VARCHAR(50),
    OUT p_procesados INT, OUT p_total_pagado DECIMAL(12,2), OUT p_resultado VARCHAR(200)
)
BEGIN
    DECLARE v_ini DATE;
    DECLARE v_fin DATE;
    DECLARE v_tin INT DEFAULT NULL;

    IF p_anio IS NULL OR p_anio < 1900 OR p_anio > 2999 THEN
        SET p_procesados = 0, p_total_pagado = 0.00, p_resultado = 'ERROR: Anio invalido.';
    ELSE
        SET v_ini = MAKEDATE(p_anio - 1, 1) + INTERVAL 11 MONTH;
        SET v_fin = MAKEDATE(p_anio, 1) + INTERVAL 11 MONTH - INTERVAL 1 DAY;
        SELECT tin_id INTO v_tin FROM RPJ_CAT_TIPO_INGRESO WHERE UPPER(tin_tipo_ingreso) = 'AGUINALDO' ORDER BY tin_id LIMIT 1;
        IF v_tin IS NULL THEN
            SET p_procesados = 0, p_total_pagado = 0.00, p_resultado = 'ERROR: Falta el tipo de ingreso AGUINALDO en el catalogo.';
        ELSE
            CALL _pj_generar_beneficiarios(p_id_planilla, 8, v_tin, v_ini, v_fin, p_porcentaje, p_usuario,
                                            p_procesados, p_total_pagado, p_resultado);
        END IF;
    END IF;
END $$

CREATE PROCEDURE sp_generar_aguinaldo_amparistas(
    IN p_id_planilla INT, IN p_anio INT, IN p_usuario VARCHAR(50),
    OUT p_procesados INT, OUT p_total_pagado DECIMAL(12,2), OUT p_resultado VARCHAR(200)
)
BEGIN
    DECLARE v_ini DATE;
    DECLARE v_fin DATE;
    DECLARE v_tin INT DEFAULT NULL;

    IF p_anio IS NULL OR p_anio < 1900 OR p_anio > 2999 THEN
        SET p_procesados = 0, p_total_pagado = 0.00, p_resultado = 'ERROR: Anio invalido.';
    ELSE
        SET v_ini = MAKEDATE(p_anio - 1, 1) + INTERVAL 11 MONTH;
        SET v_fin = MAKEDATE(p_anio, 1) + INTERVAL 11 MONTH - INTERVAL 1 DAY;
        SELECT tin_id INTO v_tin FROM RPJ_CAT_TIPO_INGRESO WHERE UPPER(tin_tipo_ingreso) = 'AGUINALDO' ORDER BY tin_id LIMIT 1;
        IF v_tin IS NULL THEN
            SET p_procesados = 0, p_total_pagado = 0.00, p_resultado = 'ERROR: Falta el tipo de ingreso AGUINALDO en el catalogo.';
        ELSE
            CALL _pj_generar_jubilado_grupo(p_id_planilla, 8, v_tin, v_ini, v_fin, 100.00, 'AMPARISTA', p_usuario,
                                             p_procesados, p_total_pagado, p_resultado);
        END IF;
    END IF;
END $$

DELIMITER ;

-- ============================================================================
-- BLOQUE 6 — Reversión completa (activos + beneficiarios + amparistas)
-- ============================================================================
SELECT 'BLOQUE 6: SP de reversion' AS etapa;

DROP PROCEDURE IF EXISTS sp_revertir_prestacion_jubilados;
DELIMITER $$

CREATE PROCEDURE sp_revertir_prestacion_jubilados(
    IN  p_id_planilla INT,
    IN  p_usuario     VARCHAR(50),
    IN  p_motivo      VARCHAR(200),
    OUT p_eliminados  INT,
    OUT p_resultado   VARCHAR(200)
)
BEGIN
    DECLARE v_tipo   INT;
    DECLARE v_estado VARCHAR(20);

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1 @pj_errno = MYSQL_ERRNO, @pj_msg = MESSAGE_TEXT;
        ROLLBACK;
        SET p_eliminados = 0;
        SET p_resultado = CONCAT('ERROR: ', @pj_errno, ' - ', @pj_msg);
    END;

    SET p_eliminados = 0;

    SELECT ppl_tipo_planilla, ppl_estado_proceso INTO v_tipo, v_estado
      FROM RPJ_CAT_PARAMETRO_PLANILLA WHERE ppl_correlativo = p_id_planilla;

    IF v_estado IS NULL THEN
        SET p_resultado = 'ERROR: La planilla no existe.';
    ELSEIF v_tipo NOT IN (6, 8) THEN
        SET p_resultado = 'ERROR: La planilla no es de prestaciones para jubilados (tipo 6 u 8).';
    ELSEIF v_estado <> 'GENERADA' THEN
        SET p_resultado = CONCAT('ERROR: Solo se puede revertir una planilla GENERADA (actual: ', v_estado, ').');
    ELSEIF p_motivo IS NULL OR TRIM(p_motivo) = '' THEN
        SET p_resultado = 'ERROR: El motivo de la reversion es obligatorio.';
    ELSE
        START TRANSACTION;

        DELETE FROM RPJ_PRC_NOMINA_INGRESO
         WHERE nin_id_planilla = p_id_planilla AND nin_id_tipo_planilla = v_tipo;
        SET p_eliminados = ROW_COUNT();

        UPDATE RPJ_CAT_PARAMETRO_PLANILLA
           SET ppl_estado_proceso   = 'REVERSADA',
               ppl_fecha_generacion = NULL,
               ppl_usuario_genera   = p_usuario
         WHERE ppl_correlativo = p_id_planilla;

        COMMIT;

        SET p_resultado = CONCAT('REVERSION EXITOSA. ', p_eliminados, ' renglones eliminados (activos + beneficiarios + amparistas). Motivo: ', p_motivo);
    END IF;
END $$

DELIMITER ;

-- ============================================================================
-- BLOQUE 7 — Ampliar SPs de edición manual para aceptar tipo 6 y 8
-- (reutiliza los SP creados por migration_prestaciones.sql en vez de
-- duplicarlos, tal como pide la seccion 8.3 del documento)
-- ============================================================================
SELECT 'BLOQUE 7: ampliar SPs de edicion manual' AS etapa;

DROP PROCEDURE IF EXISTS sp_editar_monto_prestacion;
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
    ELSEIF v_tipo_planilla NOT IN (5,6,7,8,9) THEN
        SET p_resultado = 'ERROR: El renglon no pertenece a una planilla de prestaciones (5, 6, 7, 8 o 9).';
    ELSEIF v_estado NOT IN ('ABIERTA','GENERADA') THEN
        SET p_resultado = CONCAT('ERROR: Solo se puede editar en estado ABIERTA o GENERADA (actual: ', v_estado, ').');
    ELSEIF p_nuevo_monto IS NULL OR p_nuevo_monto <= 0 THEN
        SET p_resultado = 'ERROR: El monto debe ser mayor a cero.';
    ELSE
        START TRANSACTION;

        UPDATE RPJ_PRC_NOMINA_INGRESO
           SET nin_valor            = p_nuevo_monto,
               nin_pago_corriente   = p_nuevo_monto,
               nin_usuario_creacion = p_usuario
         WHERE nin_correlativo = p_id_linea;

        COMMIT;

        SET p_resultado = CONCAT('MONTO ACTUALIZADO. Anterior: Q', FORMAT(v_monto_ant, 2),
                                 ' -> Nuevo: Q', FORMAT(p_nuevo_monto, 2), '.');
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
    ELSEIF v_tipo_planilla NOT IN (5,6,7,8,9) THEN
        SET p_resultado = 'ERROR: El renglon no pertenece a una planilla de prestaciones (5, 6, 7, 8 o 9).';
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
-- BLOQUE 8 — Agregar jubilado/beneficiario manualmente a una planilla 6/8
-- ============================================================================
SELECT 'BLOQUE 8: SP sp_agregar_jubilado_prestacion' AS etapa;

DROP PROCEDURE IF EXISTS sp_agregar_jubilado_prestacion;
DELIMITER $$

CREATE PROCEDURE sp_agregar_jubilado_prestacion(
    IN  p_id_planilla    INT,
    IN  p_id_jubilado    INT,  -- jubilado (activo o amparista) o el fallecido si p_id_beneficiario no es NULL
    IN  p_id_beneficiario INT, -- NULL si es un jubilado directo
    IN  p_monto          DECIMAL(10,2),
    IN  p_dias           INT,
    IN  p_usuario        VARCHAR(50),
    OUT p_resultado      VARCHAR(200)
)
BEGIN
    DECLARE v_tipo_planilla INT;
    DECLARE v_estado        VARCHAR(20);
    DECLARE v_jub_existe    INT DEFAULT 0;
    DECLARE v_ben_ok        INT DEFAULT 0;
    DECLARE v_tin           INT DEFAULT NULL;
    DECLARE v_dup           INT DEFAULT 0;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1 @pj_errno = MYSQL_ERRNO, @pj_msg = MESSAGE_TEXT;
        ROLLBACK;
        SET p_resultado = CONCAT('ERROR: ', @pj_errno, ' - ', @pj_msg);
    END;

    SELECT ppl_tipo_planilla, ppl_estado_proceso INTO v_tipo_planilla, v_estado
      FROM RPJ_CAT_PARAMETRO_PLANILLA WHERE ppl_correlativo = p_id_planilla;

    SELECT COUNT(*) INTO v_jub_existe FROM RPJ_MNT_JUBILADO
     WHERE jub_correlativo = p_id_jubilado AND jub_tipo_manejo = 2;

    IF p_id_beneficiario IS NOT NULL THEN
        SELECT COUNT(*) INTO v_ben_ok FROM RPJ_MNT_BENEFICIARIO
         WHERE ben_correlativo = p_id_beneficiario AND ben_id_jubilado = p_id_jubilado AND ben_estado = 'ACTIVO';
    END IF;

    SELECT tin_id INTO v_tin FROM RPJ_CAT_TIPO_INGRESO
     WHERE UPPER(tin_tipo_ingreso) = CASE COALESCE(v_tipo_planilla, 0)
                                       WHEN 6 THEN 'BONO 14'
                                       WHEN 8 THEN 'AGUINALDO'
                                       ELSE '' END
     ORDER BY tin_id LIMIT 1;

    SELECT COUNT(*) INTO v_dup FROM RPJ_PRC_NOMINA_INGRESO
     WHERE nin_id_planilla = p_id_planilla
       AND nin_id_tipo_planilla = COALESCE(v_tipo_planilla, 0)
       AND nin_id_jubilado = p_id_jubilado
       AND ((p_id_beneficiario IS NULL AND nin_id_beneficiario IS NULL)
            OR nin_id_beneficiario = p_id_beneficiario);

    IF v_estado IS NULL THEN
        SET p_resultado = 'ERROR: La planilla no existe.';
    ELSEIF v_tipo_planilla NOT IN (6,8) THEN
        SET p_resultado = 'ERROR: La planilla no es de prestaciones para jubilados (tipo 6 u 8).';
    ELSEIF v_estado NOT IN ('ABIERTA','GENERADA') THEN
        SET p_resultado = CONCAT('ERROR: Solo se puede agregar en estado ABIERTA o GENERADA (actual: ', v_estado, ').');
    ELSEIF v_jub_existe = 0 THEN
        SET p_resultado = 'ERROR: El jubilado no existe.';
    ELSEIF p_id_beneficiario IS NOT NULL AND v_ben_ok = 0 THEN
        SET p_resultado = 'ERROR: El beneficiario no existe, no esta activo, o no pertenece a ese jubilado.';
    ELSEIF v_dup > 0 THEN
        SET p_resultado = 'ERROR: Esa persona ya esta registrada en esta planilla.';
    ELSEIF p_monto IS NULL OR p_monto <= 0 THEN
        SET p_resultado = 'ERROR: El monto debe ser mayor a cero.';
    ELSEIF v_tin IS NULL THEN
        SET p_resultado = 'ERROR: Falta el tipo de ingreso de la prestacion en el catalogo.';
    ELSE
        START TRANSACTION;

        INSERT INTO RPJ_PRC_NOMINA_INGRESO (
            nin_tipo_manejo, nin_id_tipo_planilla, nin_id_planilla, nin_id_jubilado, nin_id_beneficiario,
            nin_tipo_ingreso, nin_valor, nin_valor_teorico, nin_porcentaje_aplicado,
            nin_pago_corriente, nin_abono_historico, nin_dias_trabajados,
            nin_puesto, nin_area, nin_usuario_creacion
        ) VALUES (
            2, v_tipo_planilla, p_id_planilla, p_id_jubilado, p_id_beneficiario,
            v_tin, p_monto, p_monto, 100.00,
            p_monto, 0.00, COALESCE(p_dias, 0),
            IF(p_id_beneficiario IS NULL, 'JUBILADO', 'BENEFICIARIO'), 'ADMINISTRATIVA', p_usuario
        );

        COMMIT;

        SET p_resultado = CONCAT('REGISTRO AGREGADO. Monto: Q', FORMAT(p_monto, 2),
                                 '. Dias: ', COALESCE(p_dias, 0), '.');
    END IF;
END $$

DELIMITER ;

-- ============================================================================
-- BLOQUE 9 — VERIFICACIÓN
-- ============================================================================
SELECT 'BLOQUE 9: verificacion' AS etapa;

SELECT tpl_id, tpl_tipo_planilla, tpl_descripcion
  FROM RPJ_CAT_TIPO_PLANILLA WHERE tpl_id IN (6,8) ORDER BY tpl_id;

SELECT ROUTINE_NAME FROM information_schema.ROUTINES
 WHERE ROUTINE_SCHEMA = DATABASE()
   AND ROUTINE_NAME IN ('sp_generar_bono14_jub_activos','sp_generar_bono14_beneficiarios','sp_generar_bono14_amparistas',
                        'sp_generar_aguinaldo_jub_activos','sp_generar_aguinaldo_beneficiarios','sp_generar_aguinaldo_amparistas',
                        'sp_revertir_prestacion_jubilados','sp_agregar_jubilado_prestacion',
                        'sp_editar_monto_prestacion','sp_eliminar_linea_prestacion')
 ORDER BY ROUTINE_NAME;

SELECT 'MIGRACION DE PRESTACIONES JUBILADOS COMPLETADA' AS resultado;
