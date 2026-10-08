-- Deuda histórica: toma la pensión de la misma fuente que la nómina.
-- Corrige que la carga masiva "no cargara ningún jubilado" sin dar error.
DELIMITER $$

DROP PROCEDURE IF EXISTS sp_generar_deuda_historica$$

CREATE PROCEDURE sp_generar_deuda_historica(
  IN  p_id_jubilado    INT,
  IN  p_periodo_final  INT,
  IN  p_porcentaje_pago DECIMAL(5,2),
  IN  p_usuario        VARCHAR(50),
  OUT p_total_deudas   INT
)
BEGIN
  DECLARE v_fecha_jub     DATE;
  DECLARE v_pension       DECIMAL(12,2) DEFAULT 0;
  DECLARE v_monto_deuda   DECIMAL(12,2) DEFAULT 0;
  DECLARE v_periodo_cur   INT;
  DECLARE v_periodo_date  DATE;
  DECLARE v_inserted      INT DEFAULT 0;

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  START TRANSACTION;

  -- Get jubilacion date
  SELECT jub_fecha_jubilacion INTO v_fecha_jub
  FROM RPJ_MNT_JUBILADO
  WHERE jub_correlativo = p_id_jubilado
  LIMIT 1;

  IF v_fecha_jub IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Jubilado no encontrado o sin fecha de jubilacion';
  END IF;

  -- Pensión: MISMA fuente que la nómina de jubilados (salario del jubilado con
  -- tipo de manejo 2 y tipo de ingreso 1). Antes se buscaba por el NOMBRE del tipo
  -- de ingreso ('PENSION'); en producción ese nombre no coincide, la pensión
  -- quedaba en 0 y el jubilado se saltaba sin generar deuda ni dar error.
  BEGIN
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_pension = 0;
    SELECT COALESCE(s.sal_salario, 0) INTO v_pension
    FROM RPJ_MNT_SALARIO s
    WHERE s.sal_id_jubilado = p_id_jubilado
      AND s.sal_tipo_manejo = 2
      AND s.sal_tipo_ingreso = 1
    ORDER BY s.sal_correlativo DESC LIMIT 1;
  END;

  -- Respaldo: cualquier salario del jubilado cuyo tipo de ingreso se llame PENSION.
  IF v_pension = 0 THEN
    BEGIN
      DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_pension = 0;
      SELECT COALESCE(s.sal_salario, 0) INTO v_pension
      FROM RPJ_MNT_SALARIO s
      INNER JOIN RPJ_CAT_TIPO_INGRESO ti ON ti.tin_id = s.sal_tipo_ingreso
      WHERE s.sal_id_jubilado = p_id_jubilado
        AND UPPER(ti.tin_tipo_ingreso) LIKE 'PENSI%'
      ORDER BY s.sal_correlativo DESC LIMIT 1;
    END;
  END IF;

  SET v_inserted = 0;

  -- Si tiene pension configurada, generar deuda. Si no, se omite (0 deudas)
  -- para no abortar la carga masiva del resto de jubilados.
  IF v_pension > 0 THEN
    -- Deuda = la parte NO pagada de la pension
    SET v_monto_deuda = ROUND(v_pension * (100 - p_porcentaje_pago) / 100, 2);

    -- Start at jubilacion month
    SET v_periodo_date = DATE_FORMAT(v_fecha_jub, '%Y-%m-01');
    SET v_periodo_cur  = YEAR(v_periodo_date) * 100 + MONTH(v_periodo_date);

    -- Generate one debt record per month from jubilacion to periodo_final
    WHILE v_periodo_cur <= p_periodo_final DO
      INSERT IGNORE INTO RPJ_PRC_DEUDA_JUBILADO (
        deu_id_jubilado, deu_periodo, deu_monto_original, deu_monto_pagado,
        deu_monto_pendiente, deu_estado, deu_fecha_generacion, deu_usuario_creacion
      ) VALUES (
        p_id_jubilado, v_periodo_cur, v_monto_deuda, 0.00,
        v_monto_deuda, 'PENDIENTE', CURDATE(), p_usuario
      );

      IF ROW_COUNT() > 0 THEN
        SET v_inserted = v_inserted + 1;
      END IF;

      -- Advance one month
      SET v_periodo_date = DATE_ADD(v_periodo_date, INTERVAL 1 MONTH);
      SET v_periodo_cur  = YEAR(v_periodo_date) * 100 + MONTH(v_periodo_date);
    END WHILE;
  END IF;

  SET p_total_deudas = v_inserted;
  COMMIT;
END$$

DELIMITER ;
