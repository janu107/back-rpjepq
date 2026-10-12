-- ============================================================================
-- CARGA HISTÓRICA DE JUBILADOS (planillas + deuda)            "DEUDA HISTORIAL"
--
-- Reglas (documento DEUDA HISTORIAL):
--  1. Entran los jubilados ACTIVOS, de pago NORMAL, con pensión > 0 (salario con
--     tipo de manejo 2 y tipo de ingreso 1: la misma fuente que la nómina). Los
--     que no tienen valor se omiten hasta que lo tengan.
--  2. Desde el mes de jubilación MÁS ANTIGUO hasta el mes anterior al actual se
--     crea una planilla de jubilados por mes (numero YYYYMM, pago el último día del
--     mes, estado CERRADA y ppl_estado = 'HISTORICA').
--  3. Cada jubilado aparece desde SU mes de jubilación (el primer mes proporcional
--     a los días, igual que la nómina).
--  4. Antes del período parámetro: pago COMPLETO (100 %), sin deuda.
--     Desde el período parámetro en adelante: se paga el porcentaje (ej. 50 %) y
--     la diferencia queda como DEUDA de ese mes. Quien se jubiló después del
--     parámetro va al porcentaje desde su primer mes.
--  5. Volver a correrlo no toca lo existente: no se modifican planillas reales
--     (no históricas), ni renglones ya creados, ni deudas ya existentes. Sólo se
--     agregan los jubilados que antes no tenían valor.
--  7. Deudas existentes sin abonos y con otro monto se ajustan al monto correcto.
--  6. Se eliminan las deudas que dejó la carga anterior en períodos ANTERIORES al
--     parámetro, siempre que nunca hayan recibido abonos (con la regla nueva esos
--     meses se pagaron completos).
--
-- La nómina mensual ya existente se encarga del cobro: paga el porcentaje
-- corriente y con el resto abona el período pendiente más antiguo, así cada mes
-- se va completando uno (202303, luego 202304, ...).
-- ============================================================================
DELIMITER $$

DROP PROCEDURE IF EXISTS sp_carga_historica_jubilados$$

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
  DECLARE v_filas      INT;

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    DROP TEMPORARY TABLE IF EXISTS tmp_hist_jub;
    RESIGNAL;
  END;

  IF p_periodo_deuda IS NULL OR p_periodo_deuda < 190001 OR MOD(p_periodo_deuda, 100) NOT BETWEEN 1 AND 12 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El periodo debe tener formato YYYYMM (ej. 202303)';
  END IF;
  IF p_porcentaje IS NULL OR p_porcentaje <= 0 OR p_porcentaje > 100 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El porcentaje debe estar entre 1 y 100';
  END IF;

  SET p_jubilados = 0; SET p_planillas_creadas = 0; SET p_renglones = 0;
  SET p_deudas = 0; SET p_deudas_eliminadas = 0; SET p_deudas_ajustadas = 0;

  -- Jubilados que entran: activos, pago normal, con pensión configurada.
  DROP TEMPORARY TABLE IF EXISTS tmp_hist_jub;
  CREATE TEMPORARY TABLE tmp_hist_jub (
    id_jubilado  INT PRIMARY KEY,
    pension      DECIMAL(12,2) NOT NULL,
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

  -- Rango: mes de jubilación más antiguo -> mes anterior al actual.
  SET v_fin = DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 1 MONTH);
  SELECT DATE_FORMAT(MIN(fecha_jub), '%Y-%m-01') INTO v_mes FROM tmp_hist_jub;
  SET p_periodo_fin = YEAR(v_fin) * 100 + MONTH(v_fin);
  SET p_periodo_inicio = IF(v_mes IS NULL, NULL, YEAR(v_mes) * 100 + MONTH(v_mes));

  START TRANSACTION;

  -- Regla 6: deudas de la carga anterior en meses que ahora se pagan completos.
  DELETE d FROM RPJ_PRC_DEUDA_JUBILADO d
   INNER JOIN tmp_hist_jub t ON t.id_jubilado = d.deu_id_jubilado
   WHERE d.deu_periodo < p_periodo_deuda
     AND d.deu_estado = 'PENDIENTE'
     AND d.deu_monto_pagado = 0
     AND NOT EXISTS (SELECT 1 FROM RPJ_PRC_APLICACION_PAGO a WHERE a.apa_id_deuda = d.deu_correlativo);
  SET p_deudas_eliminadas = ROW_COUNT();

  WHILE v_mes IS NOT NULL AND v_mes <= v_fin DO
    SET v_periodo  = YEAR(v_mes) * 100 + MONTH(v_mes);
    SET v_dias_mes = DAY(LAST_DAY(v_mes));
    SET v_porc     = IF(v_periodo < p_periodo_deuda, 100.00, p_porcentaje);

    -- Planilla del mes: se crea sólo si no existe. Una planilla real (no
    -- histórica) ya existente no se toca.
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

    -- Renglones: sólo en planillas históricas y sólo para quien aún no tiene.
    IF v_es_hist = 1 THEN
      INSERT INTO RPJ_PRC_NOMINA_INGRESO (
        nin_tipo_manejo, nin_id_tipo_planilla, nin_id_planilla, nin_id_jubilado, nin_tipo_ingreso,
        nin_valor, nin_valor_teorico, nin_porcentaje_aplicado, nin_pago_corriente, nin_abono_historico,
        nin_id_deuda_aplicada, nin_dias_trabajados, nin_puesto, nin_area, nin_usuario_creacion
      )
      SELECT 2, 2, v_id_pla, x.id_jubilado, 1,
             ROUND(x.devengado * v_porc / 100, 2), x.pension, v_porc,
             ROUND(x.devengado * v_porc / 100, 2), 0.00,
             NULL, x.dias, 'JUBILADO', 'ADMINISTRATIVA', p_usuario
        FROM (
          SELECT t.id_jubilado, t.pension,
                 IF(t.periodo_ini = v_periodo, v_dias_mes - DAY(t.fecha_jub) + 1, v_dias_mes) AS dias,
                 ROUND(t.pension * IF(t.periodo_ini = v_periodo, (v_dias_mes - DAY(t.fecha_jub) + 1) / v_dias_mes, 1), 2) AS devengado
            FROM tmp_hist_jub t
           WHERE t.periodo_ini <= v_periodo
             AND NOT EXISTS (SELECT 1 FROM RPJ_PRC_NOMINA_INGRESO i
                              WHERE i.nin_id_planilla = v_id_pla AND i.nin_id_jubilado = t.id_jubilado)
        ) x;
      SET p_renglones = p_renglones + ROW_COUNT();
    END IF;

    -- Deuda del mes (desde el parámetro): la parte no pagada. Si ya existe, no se toca.
    IF v_periodo >= p_periodo_deuda AND p_porcentaje < 100 THEN
      INSERT IGNORE INTO RPJ_PRC_DEUDA_JUBILADO (
        deu_id_jubilado, deu_periodo, deu_monto_original, deu_monto_pagado, deu_monto_pendiente,
        deu_estado, deu_tipo_pago, deu_fecha_generacion, deu_observaciones, deu_usuario_creacion
      )
      SELECT x.id_jubilado, v_periodo, x.deuda, 0.00, x.deuda,
             'PENDIENTE', 'NORMAL', CURDATE(), 'Carga historica', p_usuario
        FROM (
          SELECT t.id_jubilado,
                 ROUND(t.pension * IF(t.periodo_ini = v_periodo, (v_dias_mes - DAY(t.fecha_jub) + 1) / v_dias_mes, 1), 2)
                 - ROUND(ROUND(t.pension * IF(t.periodo_ini = v_periodo, (v_dias_mes - DAY(t.fecha_jub) + 1) / v_dias_mes, 1), 2) * p_porcentaje / 100, 2) AS deuda
            FROM tmp_hist_jub t
           WHERE t.periodo_ini <= v_periodo
        ) x
       WHERE x.deuda > 0;
      SET v_filas = ROW_COUNT();
      SET p_deudas = p_deudas + GREATEST(v_filas, 0);

      -- Deudas que ya existían (de la carga anterior) con otro monto y que NUNCA
      -- recibieron abonos: se ajustan a la regla nueva. Las que tienen pagos no se tocan.
      UPDATE RPJ_PRC_DEUDA_JUBILADO d
       INNER JOIN (
          SELECT t.id_jubilado,
                 ROUND(t.pension * IF(t.periodo_ini = v_periodo, (v_dias_mes - DAY(t.fecha_jub) + 1) / v_dias_mes, 1), 2)
                 - ROUND(ROUND(t.pension * IF(t.periodo_ini = v_periodo, (v_dias_mes - DAY(t.fecha_jub) + 1) / v_dias_mes, 1), 2) * p_porcentaje / 100, 2) AS deuda
            FROM tmp_hist_jub t
           WHERE t.periodo_ini <= v_periodo
       ) x ON x.id_jubilado = d.deu_id_jubilado
         SET d.deu_monto_original = x.deuda,
             d.deu_monto_pendiente = x.deuda
       WHERE d.deu_periodo = v_periodo
         AND d.deu_estado = 'PENDIENTE'
         AND d.deu_monto_pagado = 0
         AND d.deu_monto_original <> x.deuda
         AND x.deuda > 0
         AND NOT EXISTS (SELECT 1 FROM RPJ_PRC_APLICACION_PAGO a WHERE a.apa_id_deuda = d.deu_correlativo);
      SET p_deudas_ajustadas = p_deudas_ajustadas + GREATEST(ROW_COUNT(), 0);
    END IF;

    SET v_mes = DATE_ADD(v_mes, INTERVAL 1 MONTH);
  END WHILE;

  COMMIT;
  DROP TEMPORARY TABLE IF EXISTS tmp_hist_jub;
END$$

DELIMITER ;
