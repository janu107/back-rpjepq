-- ============================================================================
-- Planilla de jubilados: deuda por LÍQUIDO y pago del 50% aplicado a la deuda
-- más antigua. Correcciones de préstamos y reversas.
-- Ejecutar: node scripts/runSqlFile.js sql/migraciones/migration_regla_50_liquido.sql
-- Idempotente (se puede ejecutar más de una vez).
--
-- Regla acordada con el área usuaria (2026-10-25, Excel "juan perez"):
--   líquido del mes = pensión proporcional − descuentos del mes
--   cada mes se registra como deuda por su líquido completo
--   en cada nómina el jubilado recibe líquido × porcentaje (hoy 50%)
--   ese pago se aplica a la deuda más antigua con saldo (aunque sea el mes actual);
--   si sobra, pasa al mes siguiente. La deuda crece medio mes cada mes.
--   Antes del período de deuda (carga histórica) los meses se pagaban completos.
--
-- Registro en RPJ_PRC_NOMINA_INGRESO:
--   nin_pago_corriente  = parte del pago aplicada al mes de la planilla
--   nin_abono_historico = parte del pago aplicada a meses anteriores
--   nin_valor           = descuentos + pago (bruto; neto = nin_valor − descuentos)
-- ============================================================================

-- 1) Columnas nuevas ----------------------------------------------------------
-- nde_id_prestamo: préstamo que originó el descuento (la reversa devuelve el saldo
--                  al préstamo correcto aunque el jubilado tenga varios).
SET @existe := (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'RPJ_PRC_NOMINA_DESCUENTO'
                   AND COLUMN_NAME = 'nde_id_prestamo');
SET @ddl := IF(@existe = 0,
  'ALTER TABLE RPJ_PRC_NOMINA_DESCUENTO ADD COLUMN nde_id_prestamo INT NULL AFTER nde_tipo_descuento',
  'SELECT 1');
PREPARE st FROM @ddl;
EXECUTE st;
DEALLOCATE PREPARE st;

-- deu_id_planilla: planilla que creó el mes de deuda (la reversa lo borra).
SET @existe := (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'RPJ_PRC_DEUDA_JUBILADO'
                   AND COLUMN_NAME = 'deu_id_planilla');
SET @ddl := IF(@existe = 0,
  'ALTER TABLE RPJ_PRC_DEUDA_JUBILADO ADD COLUMN deu_id_planilla INT NULL AFTER deu_periodo',
  'SELECT 1');
PREPARE st FROM @ddl;
EXECUTE st;
DEALLOCATE PREPARE st;

-- 2) Tipo de descuento para préstamos del banco BI ---------------------------
INSERT INTO RPJ_CAT_TIPO_DESCUENTO (tde_tipo_descuento, tde_descripcion, tde_usuario_creacion)
SELECT '11', 'DESCUENTO PRESTAMO BI', 'migracion'
  FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM RPJ_CAT_TIPO_DESCUENTO WHERE tde_descripcion = 'DESCUENTO PRESTAMO BI');

-- 3) Descuentos de un mes pasado (para la carga histórica) -------------------
-- IGSS/ISR/INTECAP/asociación según sus datos de planilla; préstamos y descuentos
-- judiciales que estaban vigentes en ese mes según sus fechas.
DROP FUNCTION IF EXISTS fn_descuentos_jubilado_mes;
DELIMITER $$
CREATE FUNCTION fn_descuentos_jubilado_mes(p_id_jubilado INT, p_mes DATE, p_pension DECIMAL(12,2))
RETURNS DECIMAL(12,2)
READS SQL DATA
BEGIN
    DECLARE v_total DECIMAL(12,2) DEFAULT 0;
    DECLARE v_igss, v_isr, v_intecap, v_asoc BOOLEAN DEFAULT FALSE;
    DECLARE v_pct_igss, v_pct_isr, v_pct_intecap DECIMAL(5,2) DEFAULT 0;
    DECLARE v_monto_asoc DECIMAL(10,2) DEFAULT 0;
    DECLARE v_fin DATE DEFAULT LAST_DAY(p_mes);

    SELECT COALESCE(MAX(dat_aplica_desc_igss), 0), COALESCE(MAX(dat_aplica_desc_isr), 0),
           COALESCE(MAX(dat_aplica_intecap), 0), COALESCE(MAX(dat_aplica_dasociacion), 0)
      INTO v_igss, v_isr, v_intecap, v_asoc
      FROM RPJ_MNT_DATOS_PLANILLA
     WHERE dat_id_jubilado = p_id_jubilado AND dat_tipo_manejo = 2;

    SELECT COALESCE(par_igss, 0), COALESCE(par_isr, 0), COALESCE(par_intecap, 0), COALESCE(par_desc_asociacion, 0)
      INTO v_pct_igss, v_pct_isr, v_pct_intecap, v_monto_asoc
      FROM RPJ_CAT_PARAMETRO_GENERAL ORDER BY par_id DESC LIMIT 1;

    IF v_igss    THEN SET v_total = v_total + ROUND(p_pension * v_pct_igss / 100, 2); END IF;
    IF v_isr     THEN SET v_total = v_total + ROUND(p_pension * v_pct_isr / 100, 2); END IF;
    IF v_intecap THEN SET v_total = v_total + ROUND(p_pension * v_pct_intecap / 100, 2); END IF;
    IF v_asoc    THEN SET v_total = v_total + v_monto_asoc; END IF;

    SET v_total = v_total + COALESCE((
        SELECT SUM(prr_valor_mes) FROM RPJ_MNT_PRESTAMOS_REGIMEN
         WHERE prr_id_jubilado = p_id_jubilado AND prr_tipo_manejo = 2
           AND prr_fecha_inicio <= v_fin AND prr_fecha_fin >= p_mes), 0);

    SET v_total = v_total + COALESCE((
        SELECT SUM(dju_valor) FROM RPJ_MNT_DESC_JUDICIALES
         WHERE dju_id_jubilado = p_id_jubilado AND dju_tipo_manejo = 2
           AND dju_fecha_inicio <= v_fin AND (dju_fecha_final IS NULL OR dju_fecha_final >= p_mes)), 0);

    RETURN v_total;
END$$
DELIMITER ;

-- 4) Carga histórica: planillas mes a mes y deuda rehecha --------------------
DROP PROCEDURE IF EXISTS sp_carga_historica_jubilados;
DELIMITER $$
CREATE PROCEDURE sp_carga_historica_jubilados(
  IN  p_periodo_deuda      INT,            -- YYYYMM desde el que se paga el porcentaje
  IN  p_porcentaje         DECIMAL(5,2),   -- porcentaje pagado desde ese período (ej. 50)
  IN  p_usuario            VARCHAR(50),
  OUT p_jubilados          INT,
  OUT p_planillas_creadas  INT,
  OUT p_renglones          INT,
  OUT p_deudas             INT,
  OUT p_deudas_eliminadas  INT,
  OUT p_deudas_ajustadas   INT,
  OUT p_periodo_inicio     INT,
  OUT p_periodo_fin        INT
)
BEGIN
  DECLARE v_mes        DATE;
  DECLARE v_fin        DATE;
  DECLARE v_periodo    INT;
  DECLARE v_id_pla     INT;
  DECLARE v_es_hist    TINYINT;
  DECLARE v_porc       DECIMAL(5,2);
  DECLARE v_dias_mes   INT;
  DECLARE v_abiertas   INT;
  DECLARE v_es_nueva   INT;

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    DROP TEMPORARY TABLE IF EXISTS tmp_hist_jub;
    DROP TEMPORARY TABLE IF EXISTS tmp_hist_mes;
    RESIGNAL;
  END;

  IF p_periodo_deuda IS NULL OR p_periodo_deuda < 190001 OR MOD(p_periodo_deuda, 100) NOT BETWEEN 1 AND 12 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El periodo debe tener formato YYYYMM (ej. 202303)';
  END IF;
  IF p_porcentaje IS NULL OR p_porcentaje <= 0 OR p_porcentaje > 100 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El porcentaje debe estar entre 1 y 100';
  END IF;

  -- Una planilla GENERADA no afecta: la deuda solo cambia al CERRAR. Después de la
  -- carga conviene volver a generarla para que su vista previa quede al día.
  SET v_abiertas = 0;

  SET p_jubilados = 0; SET p_planillas_creadas = 0; SET p_renglones = 0;
  SET p_deudas = 0; SET p_deudas_eliminadas = 0; SET p_deudas_ajustadas = 0;

  -- Jubilados que entran: activos, pago normal, con pensión configurada.
  DROP TEMPORARY TABLE IF EXISTS tmp_hist_jub;
  CREATE TEMPORARY TABLE tmp_hist_jub (
    id_jubilado  INT PRIMARY KEY,
    pension      DECIMAL(12,2) NULL,
    fecha_jub    DATE NOT NULL,
    periodo_ini  INT NOT NULL
  );
  INSERT INTO tmp_hist_jub (id_jubilado, pension, fecha_jub, periodo_ini)
  SELECT j.jub_correlativo,
         (SELECT s.sal_salario FROM RPJ_MNT_SALARIO s
           WHERE s.sal_id_jubilado = j.jub_correlativo AND s.sal_tipo_manejo = 2 AND s.sal_tipo_ingreso = 1
           ORDER BY s.sal_correlativo DESC LIMIT 1),
         j.jub_fecha_jubilacion,
         YEAR(j.jub_fecha_jubilacion) * 100 + MONTH(j.jub_fecha_jubilacion)
    FROM RPJ_MNT_JUBILADO j
   WHERE j.jub_tipo_manejo = 2
     AND UPPER(COALESCE(j.jub_estado, '')) = 'ACTIVO'
     AND UPPER(COALESCE(j.jub_tipo_pago, 'NORMAL')) = 'NORMAL'
     AND UPPER(COALESCE(j.jub_estado_pago, 'ACTIVO')) = 'ACTIVO'
     AND j.jub_fecha_jubilacion IS NOT NULL;
  DELETE FROM tmp_hist_jub WHERE pension IS NULL OR pension <= 0;
  SELECT COUNT(*) INTO p_jubilados FROM tmp_hist_jub;

  -- Líquido y pago de cada jubilado en cada mes.
  DROP TEMPORARY TABLE IF EXISTS tmp_hist_mes;
  CREATE TEMPORARY TABLE tmp_hist_mes (
    id_jubilado INT NOT NULL,
    periodo     INT NOT NULL,
    liquido     DECIMAL(12,2) NOT NULL,
    pagado      DECIMAL(12,2) NOT NULL,
    id_planilla INT NULL,                    -- planilla de nómina (regla nueva) del mes
    fifo        TINYINT NOT NULL DEFAULT 0,  -- 1 = su pago se aplicó a la deuda más antigua
    PRIMARY KEY (id_jubilado, periodo)
  );

  -- Rango: mes de jubilación más antiguo -> mes anterior al actual.
  SET v_fin = DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 1 MONTH);
  SELECT DATE_FORMAT(MIN(fecha_jub), '%Y-%m-01') INTO v_mes FROM tmp_hist_jub;
  SET p_periodo_fin = YEAR(v_fin) * 100 + MONTH(v_fin);
  SET p_periodo_inicio = IF(v_mes IS NULL, NULL, YEAR(v_mes) * 100 + MONTH(v_mes));

  START TRANSACTION;

  WHILE v_mes IS NOT NULL AND v_mes <= v_fin DO
    SET v_periodo  = YEAR(v_mes) * 100 + MONTH(v_mes);
    SET v_dias_mes = DAY(LAST_DAY(v_mes));
    SET v_porc     = IF(v_periodo < p_periodo_deuda, 100.00, p_porcentaje);

    -- Planilla del mes: se crea sólo si no existe. Una planilla real (no histórica)
    -- no se toca: se toma lo que de verdad pagó.
    SET v_id_pla = NULL; SET v_es_hist = 0;
    SELECT ppl_correlativo, IF(ppl_estado = 'HISTORICA', 1, 0) INTO v_id_pla, v_es_hist
      FROM RPJ_CAT_PARAMETRO_PLANILLA
     WHERE ppl_tipo_planilla = 2 AND ppl_numero = v_periodo
     LIMIT 1;

    IF v_id_pla IS NULL THEN
      INSERT INTO RPJ_CAT_PARAMETRO_PLANILLA (
        ppl_tipo_planilla, ppl_numero, ppl_fecha_inicio, ppl_fecha_final, ppl_fecha_pago,
        ppl_frecuencia, ppl_estado, ppl_aplica_porcentaje, ppl_porcentaje_pago, ppl_estado_proceso,
        ppl_fecha_generacion, ppl_fecha_cierre, ppl_usuario_genera, ppl_usuario_cierra, ppl_usuario_creacion
      ) VALUES (
        2, v_periodo, v_mes, LAST_DAY(v_mes), LAST_DAY(v_mes),
        'MENSUAL', 'HISTORICA', IF(v_porc < 100, 1, 0), v_porc, 'CERRADA',
        NOW(), NOW(), p_usuario, p_usuario, p_usuario
      );
      SET v_id_pla = LAST_INSERT_ID();
      SET v_es_hist = 1;
      SET p_planillas_creadas = p_planillas_creadas + 1;
    END IF;

    -- Líquido del mes de cada jubilado (pensión proporcional − descuentos del mes).
    INSERT INTO tmp_hist_mes (id_jubilado, periodo, liquido, pagado)
    SELECT x.id_jubilado, v_periodo,
           GREATEST(x.devengado - fn_descuentos_jubilado_mes(x.id_jubilado, v_mes, x.devengado), 0), 0
      FROM (
        SELECT t.id_jubilado,
               ROUND(t.pension * IF(t.periodo_ini = v_periodo, (v_dias_mes - DAY(t.fecha_jub) + 1) / v_dias_mes, 1), 2) AS devengado
          FROM tmp_hist_jub t
         WHERE t.periodo_ini <= v_periodo
      ) x;

    IF v_es_hist = 1 THEN
      -- Planilla histórica: se rehacen sus renglones con la regla del líquido.
      DELETE n FROM RPJ_PRC_NOMINA_DESCUENTO n JOIN tmp_hist_jub t ON t.id_jubilado = n.nde_id_jubilado
       WHERE n.nde_id_planilla = v_id_pla;
      DELETE n FROM RPJ_PRC_NOMINA_INGRESO n JOIN tmp_hist_jub t ON t.id_jubilado = n.nin_id_jubilado
       WHERE n.nin_id_planilla = v_id_pla;

      UPDATE tmp_hist_mes SET pagado = ROUND(liquido * v_porc / 100, 2) WHERE periodo = v_periodo;

      INSERT INTO RPJ_PRC_NOMINA_INGRESO (
        nin_tipo_manejo, nin_id_tipo_planilla, nin_id_planilla, nin_id_jubilado, nin_tipo_ingreso,
        nin_valor, nin_valor_teorico, nin_porcentaje_aplicado, nin_pago_corriente, nin_abono_historico,
        nin_id_deuda_aplicada, nin_dias_trabajados, nin_puesto, nin_area, nin_usuario_creacion
      )
      SELECT 2, 2, v_id_pla, m.id_jubilado, 1,
             (ROUND(t.pension * IF(t.periodo_ini = v_periodo, (v_dias_mes - DAY(t.fecha_jub) + 1) / v_dias_mes, 1), 2) - m.liquido) + m.pagado,
             t.pension, v_porc, m.pagado, 0.00, NULL,
             IF(t.periodo_ini = v_periodo, v_dias_mes - DAY(t.fecha_jub) + 1, v_dias_mes),
             'JUBILADO', 'ADMINISTRATIVA', p_usuario
        FROM tmp_hist_mes m JOIN tmp_hist_jub t ON t.id_jubilado = m.id_jubilado
       WHERE m.periodo = v_periodo;
      SET p_renglones = p_renglones + ROW_COUNT();

      -- Un renglón de descuento con el total del mes (OTROS DESCUENTOS) para que la
      -- planilla histórica cuadre: ingreso − descuentos = lo pagado.
      INSERT INTO RPJ_PRC_NOMINA_DESCUENTO (nde_tipo_manejo, nde_id_tipo_planilla, nde_id_planilla, nde_id_jubilado, nde_tipo_descuento, nde_valor, nde_dias_trabajados, nde_puesto, nde_area, nde_usuario_creacion)
      SELECT 2, 2, v_id_pla, m.id_jubilado, 9,
             ROUND(t.pension * IF(t.periodo_ini = v_periodo, (v_dias_mes - DAY(t.fecha_jub) + 1) / v_dias_mes, 1), 2) - m.liquido,
             IF(t.periodo_ini = v_periodo, v_dias_mes - DAY(t.fecha_jub) + 1, v_dias_mes), 'JUBILADO', 'ADMINISTRATIVA', p_usuario
        FROM tmp_hist_mes m JOIN tmp_hist_jub t ON t.id_jubilado = m.id_jubilado
       WHERE m.periodo = v_periodo
         AND ROUND(t.pension * IF(t.periodo_ini = v_periodo, (v_dias_mes - DAY(t.fecha_jub) + 1) / v_dias_mes, 1), 2) - m.liquido > 0;
    ELSE
      -- Planilla real anterior a la regla nueva: a quien no tiene renglón se le
      -- agrega como en la historia (porcentaje de su líquido), para que todos queden
      -- completos hasta el mes anterior. Los renglones existentes no se tocan.
      SELECT COUNT(*) INTO v_es_nueva FROM RPJ_PRC_DEUDA_JUBILADO WHERE deu_id_planilla = v_id_pla;
      IF v_es_nueva = 0 THEN
        INSERT INTO RPJ_PRC_NOMINA_DESCUENTO (nde_tipo_manejo, nde_id_tipo_planilla, nde_id_planilla, nde_id_jubilado, nde_tipo_descuento, nde_valor, nde_dias_trabajados, nde_puesto, nde_area, nde_usuario_creacion)
        SELECT 2, 2, v_id_pla, m.id_jubilado, 9,
               ROUND(t.pension * IF(t.periodo_ini = v_periodo, (v_dias_mes - DAY(t.fecha_jub) + 1) / v_dias_mes, 1), 2) - m.liquido,
               IF(t.periodo_ini = v_periodo, v_dias_mes - DAY(t.fecha_jub) + 1, v_dias_mes), 'JUBILADO', 'ADMINISTRATIVA', p_usuario
          FROM tmp_hist_mes m JOIN tmp_hist_jub t ON t.id_jubilado = m.id_jubilado
         WHERE m.periodo = v_periodo
           AND ROUND(t.pension * IF(t.periodo_ini = v_periodo, (v_dias_mes - DAY(t.fecha_jub) + 1) / v_dias_mes, 1), 2) - m.liquido > 0
           AND NOT EXISTS (SELECT 1 FROM RPJ_PRC_NOMINA_INGRESO i WHERE i.nin_id_planilla = v_id_pla AND i.nin_id_jubilado = m.id_jubilado);

        INSERT INTO RPJ_PRC_NOMINA_INGRESO (
          nin_tipo_manejo, nin_id_tipo_planilla, nin_id_planilla, nin_id_jubilado, nin_tipo_ingreso,
          nin_valor, nin_valor_teorico, nin_porcentaje_aplicado, nin_pago_corriente, nin_abono_historico,
          nin_id_deuda_aplicada, nin_dias_trabajados, nin_puesto, nin_area, nin_usuario_creacion
        )
        SELECT 2, 2, v_id_pla, m.id_jubilado, 1,
               (ROUND(t.pension * IF(t.periodo_ini = v_periodo, (v_dias_mes - DAY(t.fecha_jub) + 1) / v_dias_mes, 1), 2) - m.liquido)
                 + ROUND(m.liquido * v_porc / 100, 2),
               t.pension, v_porc, ROUND(m.liquido * v_porc / 100, 2), 0.00, NULL,
               IF(t.periodo_ini = v_periodo, v_dias_mes - DAY(t.fecha_jub) + 1, v_dias_mes),
               'JUBILADO', 'ADMINISTRATIVA', p_usuario
          FROM tmp_hist_mes m JOIN tmp_hist_jub t ON t.id_jubilado = m.id_jubilado
         WHERE m.periodo = v_periodo
           AND NOT EXISTS (SELECT 1 FROM RPJ_PRC_NOMINA_INGRESO i WHERE i.nin_id_planilla = v_id_pla AND i.nin_id_jubilado = m.id_jubilado);
        SET p_renglones = p_renglones + ROW_COUNT();
      END IF;

      -- Planilla real: lo que de verdad recibió (ingreso − descuentos).
      UPDATE tmp_hist_mes m
         SET m.pagado = GREATEST(COALESCE((
               SELECT SUM(i.nin_valor) FROM RPJ_PRC_NOMINA_INGRESO i
                WHERE i.nin_id_planilla = v_id_pla AND i.nin_id_jubilado = m.id_jubilado), 0)
             - COALESCE((
               SELECT SUM(d.nde_valor) FROM RPJ_PRC_NOMINA_DESCUENTO d
                WHERE d.nde_id_planilla = v_id_pla AND d.nde_id_jubilado = m.id_jubilado), 0), 0)
       WHERE m.periodo = v_periodo;

      -- Nómina con la regla nueva: el mes vale lo que ella registró y su pago se
      -- abonó a la deuda más antigua (se respeta al rehacer).
      UPDATE tmp_hist_mes m
       INNER JOIN RPJ_PRC_DEUDA_JUBILADO d ON d.deu_id_planilla = v_id_pla AND d.deu_id_jubilado = m.id_jubilado
         SET m.liquido = d.deu_monto_original, m.fifo = 1, m.id_planilla = v_id_pla
       WHERE m.periodo = v_periodo;
    END IF;

    SET v_mes = DATE_ADD(v_mes, INTERVAL 1 MONTH);
  END WHILE;

  -- Deuda rehecha: cada mes desde el período de deuda vale su líquido y TODO lo
  -- pagado desde entonces se abona a los meses más antiguos (acordado con el
  -- contador, 2026-10-27): los meses que aún no les toca quedan con la pensión
  -- completa pendiente y abonado 0; solo el mes "en turno" queda parcial.
  -- Nóminas cerradas (regla nueva) de meses posteriores al rango (p. ej. el mes en curso).
  INSERT IGNORE INTO tmp_hist_mes (id_jubilado, periodo, liquido, pagado, id_planilla, fifo)
  SELECT d.deu_id_jubilado, d.deu_periodo, d.deu_monto_original,
         GREATEST(COALESCE((SELECT SUM(i.nin_valor) FROM RPJ_PRC_NOMINA_INGRESO i
                             WHERE i.nin_id_planilla = d.deu_id_planilla AND i.nin_id_jubilado = d.deu_id_jubilado), 0)
                - COALESCE((SELECT SUM(n.nde_valor) FROM RPJ_PRC_NOMINA_DESCUENTO n
                             WHERE n.nde_id_planilla = d.deu_id_planilla AND n.nde_id_jubilado = d.deu_id_jubilado), 0), 0),
         d.deu_id_planilla, 1
    FROM RPJ_PRC_DEUDA_JUBILADO d
    JOIN tmp_hist_jub t ON t.id_jubilado = d.deu_id_jubilado
   WHERE d.deu_id_planilla IS NOT NULL AND d.deu_periodo > p_periodo_fin;

  DELETE a FROM RPJ_PRC_APLICACION_PAGO a JOIN tmp_hist_jub t ON t.id_jubilado = a.apa_id_jubilado;
  DELETE d FROM RPJ_PRC_DEUDA_JUBILADO d JOIN tmp_hist_jub t ON t.id_jubilado = d.deu_id_jubilado;
  SET p_deudas_eliminadas = ROW_COUNT();

  IF p_porcentaje < 100 THEN
    INSERT INTO RPJ_PRC_DEUDA_JUBILADO (
      deu_id_jubilado, deu_periodo, deu_id_planilla, deu_monto_original, deu_monto_pagado, deu_monto_pendiente,
      deu_estado, deu_tipo_pago, deu_fecha_generacion, deu_fecha_saldada, deu_observaciones, deu_usuario_creacion
    )
    SELECT x.id_jubilado, x.periodo, x.id_planilla, x.liquido, x.pagado_mes, x.liquido - x.pagado_mes,
           CASE WHEN x.pagado_mes >= x.liquido THEN 'PAGADA' WHEN x.pagado_mes > 0 THEN 'PARCIAL' ELSE 'PENDIENTE' END,
           'NORMAL', CURDATE(), IF(x.pagado_mes >= x.liquido, CURDATE(), NULL), 'Carga historica', p_usuario
      FROM (
        SELECT g.id_jubilado, g.periodo, g.id_planilla, g.liquido,
               g.propio + LEAST(g.resto, GREATEST(g.sobrante - (g.resto_acum - g.resto), 0)) AS pagado_mes
          FROM (
            SELECT f.*,
                   SUM(f.resto)  OVER (PARTITION BY f.id_jubilado ORDER BY f.periodo) AS resto_acum,
                   SUM(f.exceso) OVER (PARTITION BY f.id_jubilado) AS sobrante
              FROM (
                SELECT m.id_jubilado, m.periodo, m.id_planilla, m.liquido,
                       0                                                AS propio,
                       m.liquido                                        AS resto,
                       m.pagado                                         AS exceso
                  FROM tmp_hist_mes m
                 WHERE m.periodo >= p_periodo_deuda
              ) f
          ) g
      ) x
     WHERE x.liquido > 0;
    SET p_deudas = ROW_COUNT();
    SELECT COUNT(*) INTO p_deudas_ajustadas FROM RPJ_PRC_DEUDA_JUBILADO d JOIN tmp_hist_jub t ON t.id_jubilado = d.deu_id_jubilado
     WHERE d.deu_estado IN ('PENDIENTE', 'PARCIAL');
  END IF;

  COMMIT;
  DROP TEMPORARY TABLE IF EXISTS tmp_hist_jub;
  DROP TEMPORARY TABLE IF EXISTS tmp_hist_mes;
END$$
DELIMITER ;

-- 5) Generación de nómina de pensionados -------------------------------------
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
             WHERE p.prr_id_jubilado = v_id_jubilado AND p.prr_tipo_manejo = 2 AND p.prr_estado = 'ACTIVO' AND p.prr_saldo > 0;
            UPDATE RPJ_MNT_PRESTAMOS_REGIMEN
               SET prr_saldo = GREATEST(prr_saldo - prr_valor_mes, 0),
                   prr_estado = CASE WHEN prr_saldo - prr_valor_mes <= 0 THEN 'OPERADA' ELSE 'ACTIVO' END
             WHERE prr_id_jubilado = v_id_jubilado AND prr_tipo_manejo = 2 AND prr_estado = 'ACTIVO' AND prr_saldo > 0;

            IF v_aplica_asociacion = TRUE AND v_monto_asociacion > 0 THEN
                INSERT INTO RPJ_PRC_NOMINA_DESCUENTO (nde_tipo_manejo, nde_id_tipo_planilla, nde_id_planilla, nde_id_jubilado, nde_tipo_descuento, nde_valor, nde_dias_trabajados, nde_puesto, nde_area, nde_usuario_creacion)
                VALUES (2, 2, p_id_planilla, v_id_jubilado, 8, v_monto_asociacion, v_dias_trabajados, 'JUBILADO', 'ADMINISTRATIVA', p_usuario);
            END IF;

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

-- 6) Reversa de la planilla completa -----------------------------------------
DROP PROCEDURE IF EXISTS sp_reversar_planilla_pensionados;
DELIMITER $$
CREATE PROCEDURE sp_reversar_planilla_pensionados(
    IN p_id_planilla INT,
    IN p_usuario VARCHAR(50),
    IN p_motivo VARCHAR(250)
)
BEGIN
    DECLARE v_estado VARCHAR(20);

    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

    START TRANSACTION;

    SELECT ppl_estado_proceso INTO v_estado
      FROM RPJ_CAT_PARAMETRO_PLANILLA
     WHERE ppl_correlativo = p_id_planilla
       FOR UPDATE;

    IF v_estado IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Planilla no encontrada';
    END IF;
    IF v_estado != 'GENERADA' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Solo se pueden reversar planillas GENERADAS';
    END IF;

    -- Abonos a deuda (puede haber varios meses por jubilado).
    UPDATE RPJ_PRC_DEUDA_JUBILADO d
    INNER JOIN RPJ_PRC_APLICACION_PAGO a ON a.apa_id_deuda = d.deu_correlativo
       SET d.deu_monto_pagado    = d.deu_monto_pagado - a.apa_monto_aplicado,
           d.deu_monto_pendiente = d.deu_monto_pendiente + a.apa_monto_aplicado,
           d.deu_estado = CASE WHEN d.deu_monto_pagado - a.apa_monto_aplicado <= 0 THEN 'PENDIENTE' ELSE 'PARCIAL' END,
           d.deu_fecha_saldada = NULL
     WHERE a.apa_id_planilla = p_id_planilla;

    -- Préstamos: cada descuento devuelve su saldo a SU préstamo.
    UPDATE RPJ_MNT_PRESTAMOS_REGIMEN p
    INNER JOIN RPJ_PRC_NOMINA_DESCUENTO n ON n.nde_id_prestamo = p.prr_correlativo
       SET p.prr_saldo  = p.prr_saldo + n.nde_valor,
           p.prr_estado = 'ACTIVO'
     WHERE n.nde_id_planilla = p_id_planilla
       AND n.nde_tipo_manejo = 2;

    -- Descuentos de préstamo generados antes de esta versión (sin nde_id_prestamo).
    UPDATE RPJ_MNT_PRESTAMOS_REGIMEN p
    INNER JOIN RPJ_PRC_NOMINA_DESCUENTO n ON n.nde_id_jubilado = p.prr_id_jubilado
       SET p.prr_saldo  = p.prr_saldo + n.nde_valor,
           p.prr_estado = 'ACTIVO'
     WHERE n.nde_id_planilla = p_id_planilla
       AND n.nde_id_prestamo IS NULL
       AND p.prr_tipo_manejo = 2
       AND n.nde_tipo_descuento IN (5, 6, 7);

    UPDATE RPJ_MNT_DESC_JUDICIALES j
    INNER JOIN RPJ_PRC_NOMINA_DESCUENTO n ON n.nde_id_jubilado = j.dju_id_jubilado
       SET j.dju_saldo  = j.dju_saldo + n.nde_valor,
           j.dju_estado = 'ACTIVO'
     WHERE n.nde_id_planilla = p_id_planilla
       AND j.dju_tipo_manejo = 2
       AND n.nde_tipo_descuento = 4;

    DELETE FROM RPJ_PRC_APLICACION_PAGO  WHERE apa_id_planilla = p_id_planilla;
    DELETE FROM RPJ_PRC_DEUDA_JUBILADO   WHERE deu_id_planilla = p_id_planilla;
    DELETE FROM RPJ_PRC_NOMINA_DESCUENTO WHERE nde_id_planilla = p_id_planilla AND nde_tipo_manejo = 2;
    DELETE FROM RPJ_PRC_NOMINA_INGRESO   WHERE nin_id_planilla = p_id_planilla AND nin_tipo_manejo = 2;

    UPDATE RPJ_CAT_PARAMETRO_PLANILLA
       SET ppl_estado_proceso = 'REVERSADA'
     WHERE ppl_correlativo = p_id_planilla;

    INSERT INTO RPJ_LOG_REVERSOS (lre_id_planilla, lre_motivo, lre_usuario)
    VALUES (p_id_planilla, p_motivo, p_usuario);

    COMMIT;
    SELECT 'Planilla de pensionados reversada correctamente' AS resultado;
END$$
DELIMITER ;

-- 7) Reversa del pago de un solo jubilado (no existía en producción) --------
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

    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

    START TRANSACTION;

    SELECT ppl_estado_proceso INTO v_estado
      FROM RPJ_CAT_PARAMETRO_PLANILLA
     WHERE ppl_correlativo = p_id_planilla
       FOR UPDATE;

    IF v_estado IS NULL OR v_estado != 'GENERADA' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Solo se pueden reversar pagos en planillas GENERADAS';
    END IF;

    UPDATE RPJ_PRC_DEUDA_JUBILADO d
    INNER JOIN RPJ_PRC_APLICACION_PAGO a ON a.apa_id_deuda = d.deu_correlativo
       SET d.deu_monto_pagado    = d.deu_monto_pagado - a.apa_monto_aplicado,
           d.deu_monto_pendiente = d.deu_monto_pendiente + a.apa_monto_aplicado,
           d.deu_estado = CASE WHEN d.deu_monto_pagado - a.apa_monto_aplicado <= 0 THEN 'PENDIENTE' ELSE 'PARCIAL' END,
           d.deu_fecha_saldada = NULL
     WHERE a.apa_id_planilla = p_id_planilla
       AND a.apa_id_jubilado = p_id_jubilado;

    UPDATE RPJ_MNT_PRESTAMOS_REGIMEN p
    INNER JOIN RPJ_PRC_NOMINA_DESCUENTO n ON n.nde_id_prestamo = p.prr_correlativo
       SET p.prr_saldo  = p.prr_saldo + n.nde_valor,
           p.prr_estado = 'ACTIVO'
     WHERE n.nde_id_planilla = p_id_planilla
       AND n.nde_id_jubilado = p_id_jubilado;

    UPDATE RPJ_MNT_PRESTAMOS_REGIMEN p
    INNER JOIN RPJ_PRC_NOMINA_DESCUENTO n ON n.nde_id_jubilado = p.prr_id_jubilado
       SET p.prr_saldo  = p.prr_saldo + n.nde_valor,
           p.prr_estado = 'ACTIVO'
     WHERE n.nde_id_planilla = p_id_planilla
       AND n.nde_id_jubilado = p_id_jubilado
       AND n.nde_id_prestamo IS NULL
       AND p.prr_tipo_manejo = 2
       AND n.nde_tipo_descuento IN (5, 6, 7);

    UPDATE RPJ_MNT_DESC_JUDICIALES j
    INNER JOIN RPJ_PRC_NOMINA_DESCUENTO n ON n.nde_id_jubilado = j.dju_id_jubilado
       SET j.dju_saldo  = j.dju_saldo + n.nde_valor,
           j.dju_estado = 'ACTIVO'
     WHERE n.nde_id_planilla = p_id_planilla
       AND n.nde_id_jubilado = p_id_jubilado
       AND j.dju_tipo_manejo = 2
       AND n.nde_tipo_descuento = 4;

    DELETE FROM RPJ_PRC_APLICACION_PAGO  WHERE apa_id_planilla = p_id_planilla AND apa_id_jubilado = p_id_jubilado;
    DELETE FROM RPJ_PRC_DEUDA_JUBILADO   WHERE deu_id_planilla = p_id_planilla AND deu_id_jubilado = p_id_jubilado;
    DELETE FROM RPJ_PRC_NOMINA_DESCUENTO WHERE nde_id_planilla = p_id_planilla AND nde_id_jubilado = p_id_jubilado;
    DELETE FROM RPJ_PRC_NOMINA_INGRESO   WHERE nin_id_planilla = p_id_planilla AND nin_id_jubilado = p_id_jubilado;

    INSERT INTO RPJ_LOG_REVERSOS (lre_id_planilla, lre_id_jubilado, lre_motivo, lre_usuario)
    VALUES (p_id_planilla, p_id_jubilado, p_motivo, p_usuario);

    COMMIT;
    SELECT 'Pago del jubilado reversado correctamente' AS resultado;
END$$
DELIMITER ;

-- 8) Cierre: el mes entra a la deuda y el pago se aplica ------------------------
-- Se ejecuta al CERRAR la planilla de jubilados (antes de sp_cerrar_planilla).
-- Para cada jubilado: el mes de la planilla queda como deuda por su líquido (con
-- los montos ya editados) y lo que recibe se abona a los meses pendientes más
-- antiguos. Si ya se había aplicado (p. ej. se repite), primero se deshace.
DROP PROCEDURE IF EXISTS sp_cuadrar_planilla_pensionados;
DELIMITER $$
CREATE PROCEDURE sp_cuadrar_planilla_pensionados(
    IN  p_id_planilla INT,
    IN  p_usuario     VARCHAR(50),
    OUT p_ajustados   INT
)
BEGIN
    DECLARE v_estado       VARCHAR(20);
    DECLARE v_periodo_pla  INT;
    DECLARE v_dias_periodo INT;
    DECLARE v_done         BOOLEAN DEFAULT FALSE;
    DECLARE v_id_jub       INT;
    DECLARE v_neto         DECIMAL(12,2);
    DECLARE v_liquido      DECIMAL(12,2);
    DECLARE v_disponible   DECIMAL(12,2);
    DECLARE v_pago_mes     DECIMAL(12,2);
    DECLARE v_anterior     DECIMAL(12,2);
    DECLARE v_abono        DECIMAL(12,2);
    DECLARE v_id_deuda     INT;
    DECLARE v_per_deuda    INT;
    DECLARE v_pend_deuda   DECIMAL(12,2);
    DECLARE v_primera      INT;

    -- Jubilados descuadrados: lo aplicado a deuda + lo no aplicado ≠ lo que recibe,
    -- o el mes de deuda de esta planilla no vale su líquido.
    DECLARE cur CURSOR FOR
        SELECT i.nin_id_jubilado AS id_jub,
               SUM(i.nin_valor) - COALESCE((SELECT SUM(d.nde_valor) FROM RPJ_PRC_NOMINA_DESCUENTO d
                                             WHERE d.nde_id_planilla = p_id_planilla AND d.nde_id_jubilado = i.nin_id_jubilado), 0) AS neto,
               GREATEST(ROUND(MAX(i.nin_valor_teorico) * MAX(i.nin_dias_trabajados) / v_dias_periodo, 2)
                        - COALESCE((SELECT SUM(d.nde_valor) FROM RPJ_PRC_NOMINA_DESCUENTO d
                                     WHERE d.nde_id_planilla = p_id_planilla AND d.nde_id_jubilado = i.nin_id_jubilado), 0), 0) AS liquido
          FROM RPJ_PRC_NOMINA_INGRESO i
         WHERE i.nin_id_planilla = p_id_planilla AND i.nin_tipo_manejo = 2 AND i.nin_id_jubilado IS NOT NULL
         GROUP BY i.nin_id_jubilado;

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = TRUE;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

    SET p_ajustados = 0;
    SELECT ppl_estado_proceso, YEAR(ppl_fecha_inicio) * 100 + MONTH(ppl_fecha_inicio), DATEDIFF(ppl_fecha_final, ppl_fecha_inicio) + 1
      INTO v_estado, v_periodo_pla, v_dias_periodo
      FROM RPJ_CAT_PARAMETRO_PLANILLA WHERE ppl_correlativo = p_id_planilla;
    IF v_estado IS NULL OR v_estado != 'GENERADA' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Solo se puede cuadrar una planilla GENERADA';
    END IF;

    START TRANSACTION;
    OPEN cur;
    loop_jub: LOOP
        FETCH cur INTO v_id_jub, v_neto, v_liquido;
        IF v_done THEN LEAVE loop_jub; END IF;

        IF v_neto < 0 THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Un jubilado tiene descuentos mayores que su ingreso: revise sus montos antes de cerrar';
        END IF;

        -- Deshacer lo aplicado por esta planilla a este jubilado.
        UPDATE RPJ_PRC_DEUDA_JUBILADO d
         INNER JOIN RPJ_PRC_APLICACION_PAGO a ON a.apa_id_deuda = d.deu_correlativo
           SET d.deu_monto_pagado    = d.deu_monto_pagado - a.apa_monto_aplicado,
               d.deu_monto_pendiente = d.deu_monto_pendiente + a.apa_monto_aplicado,
               d.deu_estado = CASE WHEN d.deu_monto_pagado - a.apa_monto_aplicado <= 0 THEN 'PENDIENTE' ELSE 'PARCIAL' END,
               d.deu_fecha_saldada = NULL
         WHERE a.apa_id_planilla = p_id_planilla AND a.apa_id_jubilado = v_id_jub;
        DELETE FROM RPJ_PRC_APLICACION_PAGO WHERE apa_id_planilla = p_id_planilla AND apa_id_jubilado = v_id_jub;

        -- El mes de la planilla vale el líquido con los montos editados.
        DELETE FROM RPJ_PRC_DEUDA_JUBILADO WHERE deu_id_planilla = p_id_planilla AND deu_id_jubilado = v_id_jub;
        IF v_liquido > 0 THEN
            INSERT INTO RPJ_PRC_DEUDA_JUBILADO
                (deu_id_jubilado, deu_periodo, deu_id_planilla, deu_monto_original, deu_monto_pagado, deu_monto_pendiente,
                 deu_estado, deu_tipo_pago, deu_fecha_generacion, deu_observaciones, deu_usuario_creacion)
            VALUES (v_id_jub, v_periodo_pla, p_id_planilla, v_liquido, 0.00, v_liquido, 'PENDIENTE', 'NORMAL', CURDATE(), 'Nomina', p_usuario)
            ON DUPLICATE KEY UPDATE deu_id_planilla = p_id_planilla, deu_monto_original = v_liquido,
                 deu_monto_pendiente = GREATEST(v_liquido - deu_monto_pagado, 0),
                 deu_estado = CASE WHEN deu_monto_pagado >= v_liquido THEN 'PAGADA' WHEN deu_monto_pagado > 0 THEN 'PARCIAL' ELSE 'PENDIENTE' END;
        END IF;

        -- Lo que recibe se aplica a la deuda más antigua.
        SET v_disponible = v_neto; SET v_pago_mes = 0; SET v_anterior = 0; SET v_primera = NULL;
        loop_deuda: WHILE v_disponible > 0 DO
            SET v_id_deuda = NULL; SET v_per_deuda = NULL; SET v_pend_deuda = 0;
            SELECT deu_correlativo, deu_periodo, deu_monto_pendiente INTO v_id_deuda, v_per_deuda, v_pend_deuda
              FROM RPJ_PRC_DEUDA_JUBILADO
             WHERE deu_id_jubilado = v_id_jub AND deu_estado IN ('PENDIENTE','PARCIAL') AND deu_monto_pendiente > 0
             ORDER BY deu_periodo ASC LIMIT 1;
            IF v_id_deuda IS NULL THEN LEAVE loop_deuda; END IF;
            SET v_abono = LEAST(v_disponible, v_pend_deuda);
            UPDATE RPJ_PRC_DEUDA_JUBILADO
               SET deu_monto_pagado = deu_monto_pagado + v_abono,
                   deu_monto_pendiente = deu_monto_pendiente - v_abono,
                   deu_estado = CASE WHEN deu_monto_pendiente - v_abono <= 0 THEN 'PAGADA' ELSE 'PARCIAL' END,
                   deu_fecha_saldada = CASE WHEN deu_monto_pendiente - v_abono <= 0 THEN CURDATE() ELSE NULL END
             WHERE deu_correlativo = v_id_deuda;
            INSERT INTO RPJ_PRC_APLICACION_PAGO
                (apa_id_planilla, apa_id_jubilado, apa_id_deuda, apa_periodo_deuda, apa_monto_aplicado, apa_fecha_aplicacion, apa_observaciones, apa_usuario_creacion)
            VALUES (p_id_planilla, v_id_jub, v_id_deuda, v_per_deuda, v_abono, CURDATE(), CONCAT('Abono al periodo ', v_per_deuda), p_usuario);
            IF v_primera IS NULL THEN SET v_primera = v_id_deuda; END IF;
            IF v_per_deuda = v_periodo_pla THEN SET v_pago_mes = v_pago_mes + v_abono; ELSE SET v_anterior = v_anterior + v_abono; END IF;
            SET v_disponible = v_disponible - v_abono;
        END WHILE loop_deuda;
        SET v_pago_mes = v_pago_mes + v_disponible;

        -- El reparto queda en el primer renglón de ingreso del jubilado.
        UPDATE RPJ_PRC_NOMINA_INGRESO
           SET nin_pago_corriente = 0, nin_abono_historico = 0
         WHERE nin_id_planilla = p_id_planilla AND nin_id_jubilado = v_id_jub;
        UPDATE RPJ_PRC_NOMINA_INGRESO
           SET nin_pago_corriente = v_pago_mes, nin_abono_historico = v_anterior, nin_id_deuda_aplicada = v_primera
         WHERE nin_id_planilla = p_id_planilla AND nin_id_jubilado = v_id_jub
         ORDER BY nin_correlativo LIMIT 1;

        SET p_ajustados = p_ajustados + 1;
        SET v_done = FALSE;
    END LOOP loop_jub;
    CLOSE cur;
    COMMIT;
END$$
DELIMITER ;
