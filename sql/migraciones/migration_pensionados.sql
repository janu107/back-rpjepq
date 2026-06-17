-- ============================================================
-- MIGRACIÓN: SISTEMA DE PLANILLA DE PENSIONADOS
-- Base de datos: apps_rpjepq
-- Ejecutar en phpMyAdmin (compatible MariaDB / MySQL 8)
-- Idempotente: puede ejecutarse más de una vez sin error
-- ============================================================

-- ============================================================
-- PASO 1: MODIFICAR RPJ_CAT_PARAMETRO_PLANILLA
-- ============================================================

ALTER TABLE RPJ_CAT_PARAMETRO_PLANILLA
  ADD COLUMN IF NOT EXISTS ppl_aplica_porcentaje  TINYINT(1)   NOT NULL DEFAULT 0        AFTER ppl_estado,
  ADD COLUMN IF NOT EXISTS ppl_porcentaje_pago    DECIMAL(5,2) NOT NULL DEFAULT 100.00   AFTER ppl_aplica_porcentaje,
  ADD COLUMN IF NOT EXISTS ppl_estado_proceso     ENUM('ABIERTA','GENERADA','CERRADA','REVERSADA') NOT NULL DEFAULT 'ABIERTA' AFTER ppl_porcentaje_pago,
  ADD COLUMN IF NOT EXISTS ppl_fecha_generacion   DATETIME NULL                           AFTER ppl_estado_proceso,
  ADD COLUMN IF NOT EXISTS ppl_fecha_cierre       DATETIME NULL                           AFTER ppl_fecha_generacion,
  ADD COLUMN IF NOT EXISTS ppl_usuario_genera     VARCHAR(50) NULL                        AFTER ppl_fecha_cierre,
  ADD COLUMN IF NOT EXISTS ppl_usuario_cierra     VARCHAR(50) NULL                        AFTER ppl_usuario_genera;

-- ============================================================
-- PASO 2: MODIFICAR RPJ_PRC_NOMINA_INGRESO
-- ============================================================

ALTER TABLE RPJ_PRC_NOMINA_INGRESO
  ADD COLUMN IF NOT EXISTS nin_valor_teorico       DECIMAL(10,2) NOT NULL DEFAULT 0.00   AFTER nin_valor,
  ADD COLUMN IF NOT EXISTS nin_porcentaje_aplicado DECIMAL(5,2)  NOT NULL DEFAULT 100.00 AFTER nin_valor_teorico,
  ADD COLUMN IF NOT EXISTS nin_pago_corriente      DECIMAL(10,2) NOT NULL DEFAULT 0.00   AFTER nin_porcentaje_aplicado,
  ADD COLUMN IF NOT EXISTS nin_abono_historico     DECIMAL(10,2) NOT NULL DEFAULT 0.00   AFTER nin_pago_corriente,
  ADD COLUMN IF NOT EXISTS nin_id_deuda_aplicada   INT NULL                              AFTER nin_abono_historico;

-- ============================================================
-- PASO 3: CREAR TABLA RPJ_PRC_DEUDA_JUBILADO
-- ============================================================

CREATE TABLE IF NOT EXISTS RPJ_PRC_DEUDA_JUBILADO (
    deu_correlativo      INT AUTO_INCREMENT PRIMARY KEY,
    deu_id_jubilado      INT NOT NULL,
    deu_periodo          INT NOT NULL,
    deu_monto_original   DECIMAL(12,2) NOT NULL,
    deu_monto_pagado     DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    deu_monto_pendiente  DECIMAL(12,2) NOT NULL,
    deu_estado           ENUM('PENDIENTE','PARCIAL','PAGADA') NOT NULL DEFAULT 'PENDIENTE',
    deu_fecha_generacion DATE NOT NULL,
    deu_fecha_saldada    DATE NULL,
    deu_observaciones    VARCHAR(250) NULL,
    deu_fecha_creacion   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deu_usuario_creacion VARCHAR(50) NOT NULL,
    CONSTRAINT fk_deu_jubilado    FOREIGN KEY (deu_id_jubilado) REFERENCES RPJ_MNT_JUBILADO(jub_correlativo),
    CONSTRAINT uq_deu_jub_periodo UNIQUE (deu_id_jubilado, deu_periodo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX IF NOT EXISTS idx_deu_estado ON RPJ_PRC_DEUDA_JUBILADO(deu_id_jubilado, deu_estado);

-- ============================================================
-- PASO 4: CREAR TABLA RPJ_PRC_APLICACION_PAGO
-- ============================================================

CREATE TABLE IF NOT EXISTS RPJ_PRC_APLICACION_PAGO (
    apa_correlativo      INT AUTO_INCREMENT PRIMARY KEY,
    apa_id_planilla      INT NOT NULL,
    apa_id_jubilado      INT NOT NULL,
    apa_id_deuda         INT NOT NULL,
    apa_periodo_deuda    INT NOT NULL,
    apa_monto_aplicado   DECIMAL(12,2) NOT NULL,
    apa_fecha_aplicacion DATE NOT NULL,
    apa_observaciones    VARCHAR(250) NULL,
    apa_fecha_creacion   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    apa_usuario_creacion VARCHAR(50) NOT NULL,
    CONSTRAINT fk_apa_planilla FOREIGN KEY (apa_id_planilla) REFERENCES RPJ_CAT_PARAMETRO_PLANILLA(ppl_correlativo),
    CONSTRAINT fk_apa_jubilado FOREIGN KEY (apa_id_jubilado) REFERENCES RPJ_MNT_JUBILADO(jub_correlativo),
    CONSTRAINT fk_apa_deuda    FOREIGN KEY (apa_id_deuda)    REFERENCES RPJ_PRC_DEUDA_JUBILADO(deu_correlativo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX IF NOT EXISTS idx_apa_planilla ON RPJ_PRC_APLICACION_PAGO(apa_id_planilla);

-- ============================================================
-- PASO 5: CREAR TABLA RPJ_LOG_REVERSOS
-- ============================================================

CREATE TABLE IF NOT EXISTS RPJ_LOG_REVERSOS (
    lre_correlativo INT AUTO_INCREMENT PRIMARY KEY,
    lre_id_planilla INT NOT NULL,
    lre_id_jubilado INT NULL,
    lre_motivo      VARCHAR(250) NOT NULL,
    lre_usuario     VARCHAR(50)  NOT NULL,
    lre_fecha       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_lre_planilla FOREIGN KEY (lre_id_planilla) REFERENCES RPJ_CAT_PARAMETRO_PLANILLA(ppl_correlativo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- PASO 6: VISTAS
-- ============================================================

CREATE OR REPLACE VIEW V_PLANILLAS_PENSIONADOS AS
SELECT
  p.ppl_correlativo            AS id,
  p.ppl_tipo_planilla          AS tipo_planilla,
  t.tpl_tipo_planilla          AS tipo_planilla_nombre,
  t.tpl_descripcion            AS tipo_planilla_descripcion,
  p.ppl_numero                 AS numero,
  p.ppl_fecha_inicio           AS fecha_inicio,
  p.ppl_fecha_final            AS fecha_final,
  p.ppl_fecha_pago             AS fecha_pago,
  p.ppl_frecuencia             AS frecuencia,
  p.ppl_estado                 AS estado,
  p.ppl_aplica_porcentaje      AS aplica_porcentaje,
  p.ppl_porcentaje_pago        AS porcentaje_pago,
  p.ppl_estado_proceso         AS estado_proceso,
  p.ppl_fecha_generacion       AS fecha_generacion,
  p.ppl_fecha_cierre           AS fecha_cierre,
  p.ppl_usuario_genera         AS usuario_genera,
  p.ppl_usuario_cierra         AS usuario_cierra,
  p.ppl_fecha_creacion         AS fecha_creacion,
  p.ppl_usuario_creacion       AS usuario_creacion,
  COALESCE(ing.total_jubilados, 0)  AS total_jubilados,
  COALESCE(ing.total_ingresos,  0)  AS total_ingresos,
  COALESCE(desc_.total_descuentos,0) AS total_descuentos,
  COALESCE(ing.total_ingresos, 0) - COALESCE(desc_.total_descuentos, 0) AS neto_a_pagar
FROM RPJ_CAT_PARAMETRO_PLANILLA p
LEFT JOIN RPJ_CAT_TIPO_PLANILLA t ON t.tpl_id = p.ppl_tipo_planilla
LEFT JOIN (
  SELECT nin_id_planilla,
         COUNT(DISTINCT nin_id_jubilado) AS total_jubilados,
         SUM(nin_valor)                  AS total_ingresos
  FROM RPJ_PRC_NOMINA_INGRESO
  WHERE nin_id_jubilado IS NOT NULL AND nin_tipo_manejo = 2
  GROUP BY nin_id_planilla
) ing ON ing.nin_id_planilla = p.ppl_correlativo
LEFT JOIN (
  SELECT nde_id_planilla,
         SUM(nde_valor) AS total_descuentos
  FROM RPJ_PRC_NOMINA_DESCUENTO
  WHERE nde_id_jubilado IS NOT NULL AND nde_tipo_manejo = 2
  GROUP BY nde_id_planilla
) desc_ ON desc_.nde_id_planilla = p.ppl_correlativo
WHERE p.ppl_aplica_porcentaje = 1
ORDER BY p.ppl_correlativo DESC;

-- ------------------------------------------------------------------

CREATE OR REPLACE VIEW V_DETALLE_NOMINA_PENSIONADOS AS
SELECT
  j.jub_correlativo                                           AS id_jubilado,
  j.jub_dpi                                                   AS dpi,
  CONCAT(j.jub_nombres, ' ', j.jub_apellidos)                AS nombre_completo,
  j.jub_fecha_jubilacion                                      AS fecha_jubilacion,
  COALESCE(ni.nin_valor_teorico,   0)                         AS pension_teorica,
  COALESCE(ni.nin_porcentaje_aplicado, 100)                   AS porcentaje_aplicado,
  COALESCE(ni.nin_pago_corriente,  0)                         AS pago_corriente,
  COALESCE(ni.nin_abono_historico, 0)                         AS abono_historico,
  deu.deu_periodo                                             AS periodo_aplicado,
  ni.nin_valor                                                AS total_ingreso,
  COALESCE(desc_agg.total_descuentos, 0)                      AS total_descuentos,
  ni.nin_valor - COALESCE(desc_agg.total_descuentos, 0)       AS neto_a_pagar,
  ni.nin_id_planilla                                          AS id_planilla,
  pp.ppl_estado_proceso                                       AS estado_planilla,
  dat.dat_cuenta                                              AS cuenta_banco,
  dat.dat_forma_pago                                          AS forma_pago,
  b.ban_descripcion                                           AS banco_nombre
FROM RPJ_PRC_NOMINA_INGRESO ni
INNER JOIN RPJ_MNT_JUBILADO j       ON j.jub_correlativo  = ni.nin_id_jubilado
INNER JOIN RPJ_CAT_PARAMETRO_PLANILLA pp ON pp.ppl_correlativo = ni.nin_id_planilla
LEFT JOIN  RPJ_PRC_DEUDA_JUBILADO deu ON deu.deu_correlativo   = ni.nin_id_deuda_aplicada
LEFT JOIN  RPJ_MNT_DATOS_PLANILLA dat
       ON dat.dat_correlativo = (
            SELECT d2.dat_correlativo FROM RPJ_MNT_DATOS_PLANILLA d2
            WHERE d2.dat_id_empleado = j.jub_correlativo AND d2.dat_tipo_manejo = 2
            ORDER BY d2.dat_correlativo DESC LIMIT 1
          )
LEFT JOIN  RPJ_CAT_BANCOS b         ON b.ban_id               = dat.dat_id_banco
LEFT JOIN (
  SELECT nde_id_planilla, nde_id_jubilado, SUM(nde_valor) AS total_descuentos
  FROM RPJ_PRC_NOMINA_DESCUENTO
  WHERE nde_id_jubilado IS NOT NULL
  GROUP BY nde_id_planilla, nde_id_jubilado
) desc_agg ON desc_agg.nde_id_planilla = ni.nin_id_planilla
           AND desc_agg.nde_id_jubilado = ni.nin_id_jubilado
WHERE ni.nin_id_jubilado IS NOT NULL
  AND ni.nin_tipo_manejo = 2;

-- ------------------------------------------------------------------

CREATE OR REPLACE VIEW V_ESTADO_CUENTA_PENSIONADO AS
SELECT
  j.jub_correlativo                                           AS id_jubilado,
  CONCAT(j.jub_nombres, ' ', j.jub_apellidos)                AS nombre_completo,
  j.jub_dpi                                                   AS dpi,
  COUNT(d.deu_correlativo)                                    AS meses_totales,
  SUM(CASE WHEN d.deu_estado = 'PAGADA'  THEN 1 ELSE 0 END)  AS meses_pagados,
  SUM(CASE WHEN d.deu_estado IN ('PENDIENTE','PARCIAL') THEN 1 ELSE 0 END) AS meses_pendientes,
  SUM(d.deu_monto_original)                                   AS monto_original_total,
  SUM(d.deu_monto_pagado)                                     AS monto_pagado_total,
  SUM(d.deu_monto_pendiente)                                  AS deuda_pendiente_total,
  MIN(CASE WHEN d.deu_estado IN ('PENDIENTE','PARCIAL') THEN d.deu_periodo END) AS periodo_mas_antiguo_pendiente
FROM RPJ_MNT_JUBILADO j
LEFT JOIN RPJ_PRC_DEUDA_JUBILADO d ON d.deu_id_jubilado = j.jub_correlativo
WHERE j.jub_tipo_manejo = 2
GROUP BY j.jub_correlativo, j.jub_nombres, j.jub_apellidos, j.jub_dpi;

-- ============================================================
-- PASO 7: PROCEDIMIENTOS ALMACENADOS
-- ============================================================

DELIMITER $$

-- ------------------------------------------------------------
-- sp_generar_deuda_historica: genera deuda para UN jubilado
-- ------------------------------------------------------------
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

  -- Get pension from salario (individual first, then by tipo_manejo)
  BEGIN
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_pension = 0;
    SELECT COALESCE(s.sal_salario, 0) INTO v_pension
    FROM RPJ_MNT_SALARIO s
    INNER JOIN RPJ_CAT_TIPO_INGRESO ti ON ti.tin_id = s.sal_tipo_ingreso
    WHERE s.sal_id_jubilado = p_id_jubilado
      AND UPPER(ti.tin_tipo_ingreso) = 'PENSION'
    ORDER BY s.sal_correlativo DESC LIMIT 1;
  END;

  IF v_pension = 0 THEN
    BEGIN
      DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_pension = 0;
      SELECT COALESCE(sal_salario, 0) INTO v_pension
      FROM RPJ_MNT_SALARIO
      WHERE sal_tipo_manejo = 2 AND sal_id_jubilado IS NULL
      ORDER BY sal_correlativo DESC LIMIT 1;
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

-- ------------------------------------------------------------
-- sp_generar_deuda_historica_masivo: genera deuda para TODOS
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_generar_deuda_historica_masivo$$

CREATE PROCEDURE sp_generar_deuda_historica_masivo(
  IN  p_periodo_final         INT,
  IN  p_porcentaje_pago       DECIMAL(5,2),
  IN  p_usuario               VARCHAR(50),
  OUT p_jubilados_procesados  INT,
  OUT p_total_deudas          INT
)
BEGIN
  DECLARE v_done        INT DEFAULT 0;
  DECLARE v_id_jubilado INT;
  DECLARE v_deudas_sub  INT DEFAULT 0;

  DECLARE cur_jub CURSOR FOR
    SELECT jub_correlativo
    FROM RPJ_MNT_JUBILADO
    WHERE jub_tipo_manejo = 2
      AND UPPER(COALESCE(jub_estado,'')) = 'ACTIVO'
    ORDER BY jub_correlativo;

  DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = 1;

  SET p_jubilados_procesados = 0;
  SET p_total_deudas         = 0;

  OPEN cur_jub;
  loop_masivo: LOOP
    FETCH cur_jub INTO v_id_jubilado;
    IF v_done THEN LEAVE loop_masivo; END IF;

    SET v_deudas_sub = 0;
    CALL sp_generar_deuda_historica(v_id_jubilado, p_periodo_final, p_porcentaje_pago, p_usuario, v_deudas_sub);

    SET p_jubilados_procesados = p_jubilados_procesados + 1;
    SET p_total_deudas         = p_total_deudas + v_deudas_sub;
  END LOOP;
  CLOSE cur_jub;
END$$

-- ------------------------------------------------------------
-- sp_generar_nomina_pensionados
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_generar_nomina_pensionados$$

CREATE PROCEDURE sp_generar_nomina_pensionados(
  IN  p_id_planilla  INT,
  IN  p_tipo_ingreso INT,
  IN  p_usuario      VARCHAR(50),
  OUT p_procesados   INT,
  OUT p_excluidos    INT,
  OUT p_total_pagado DECIMAL(14,2),
  OUT p_total_desc   DECIMAL(14,2)
)
BEGIN
  DECLARE v_done           INT DEFAULT 0;
  DECLARE v_id_jubilado    INT;
  DECLARE v_pension        DECIMAL(12,2) DEFAULT 0;
  DECLARE v_id_deuda       INT DEFAULT NULL;
  DECLARE v_deu_periodo    INT DEFAULT NULL;
  DECLARE v_monto_pend     DECIMAL(12,2) DEFAULT 0;
  DECLARE v_pago_corriente DECIMAL(12,2) DEFAULT 0;
  DECLARE v_abono          DECIMAL(12,2) DEFAULT 0;
  DECLARE v_total_ingreso  DECIMAL(12,2) DEFAULT 0;
  DECLARE v_porcentaje     DECIMAL(5,2)  DEFAULT 50.00;
  DECLARE v_igss_pct       DECIMAL(5,2)  DEFAULT 0;
  DECLARE v_isr_pct        DECIMAL(5,2)  DEFAULT 0;
  DECLARE v_desc_igss      DECIMAL(12,2) DEFAULT 0;
  DECLARE v_desc_isr       DECIMAL(12,2) DEFAULT 0;
  DECLARE v_tipo_igss      INT DEFAULT NULL;
  DECLARE v_tipo_isr       INT DEFAULT NULL;
  DECLARE v_tipo_prestamo  INT DEFAULT NULL;
  DECLARE v_tipo_judicial  INT DEFAULT NULL;
  DECLARE v_tipo_planilla  INT DEFAULT NULL;
  DECLARE v_fecha_pago     DATE;
  DECLARE v_estado_proc    VARCHAR(20);
  DECLARE v_aplica_igss    TINYINT DEFAULT 1;
  DECLARE v_aplica_isr     TINYINT DEFAULT 0;
  DECLARE v_tin_pension    INT DEFAULT NULL;
  DECLARE v_total_prr      DECIMAL(12,2) DEFAULT 0;
  DECLARE v_total_dju      DECIMAL(12,2) DEFAULT 0;

  DECLARE cur_jub CURSOR FOR
    SELECT DISTINCT j.jub_correlativo
    FROM RPJ_MNT_JUBILADO j
    INNER JOIN RPJ_MNT_DATOS_PLANILLA dp
      ON dp.dat_id_empleado = j.jub_correlativo
      AND dp.dat_tipo_manejo = 2
      AND dp.dat_aplica_nomina = 1
    WHERE j.jub_tipo_manejo = 2
      AND UPPER(COALESCE(j.jub_estado,'')) = 'ACTIVO'
    ORDER BY j.jub_correlativo;

  DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = 1;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  START TRANSACTION;

  -- Validate planilla
  BEGIN
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_estado_proc = NULL;
    SELECT ppl_estado_proceso, ppl_porcentaje_pago, ppl_fecha_pago, ppl_tipo_planilla
    INTO v_estado_proc, v_porcentaje, v_fecha_pago, v_tipo_planilla
    FROM RPJ_CAT_PARAMETRO_PLANILLA WHERE ppl_correlativo = p_id_planilla LIMIT 1;
  END;

  IF v_estado_proc IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La planilla no existe';
  END IF;
  IF v_estado_proc != 'ABIERTA' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Solo se puede generar una planilla en estado ABIERTA';
  END IF;

  -- Get parametros
  BEGIN
    DECLARE CONTINUE HANDLER FOR NOT FOUND BEGIN SET v_igss_pct = 0; SET v_isr_pct = 0; END;
    SELECT COALESCE(par_igss,0), COALESCE(par_isr,0)
    INTO v_igss_pct, v_isr_pct
    FROM RPJ_CAT_PARAMETRO_GENERAL ORDER BY par_id DESC LIMIT 1;
  END;

  -- Get tipo_descuento IDs
  BEGIN
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_tipo_igss = NULL;
    SELECT tde_id INTO v_tipo_igss FROM RPJ_CAT_TIPO_DESCUENTO WHERE UPPER(tde_tipo_descuento) = 'IGSS' LIMIT 1;
  END;
  BEGIN
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_tipo_isr = NULL;
    SELECT tde_id INTO v_tipo_isr FROM RPJ_CAT_TIPO_DESCUENTO WHERE UPPER(tde_tipo_descuento) = 'ISR' LIMIT 1;
  END;
  BEGIN
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_tipo_prestamo = NULL;
    SELECT tde_id INTO v_tipo_prestamo FROM RPJ_CAT_TIPO_DESCUENTO
    WHERE UPPER(tde_tipo_descuento) IN ('PRESTAMO','PRESTAMOS') LIMIT 1;
  END;
  BEGIN
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_tipo_judicial = NULL;
    SELECT tde_id INTO v_tipo_judicial FROM RPJ_CAT_TIPO_DESCUENTO
    WHERE UPPER(tde_tipo_descuento) IN ('JUDICIAL','JUDICIALES') LIMIT 1;
  END;

  -- Get tipo_ingreso for pension (use parameter if given, else lookup)
  IF p_tipo_ingreso > 0 THEN
    SET v_tin_pension = p_tipo_ingreso;
  ELSE
    BEGIN
      DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_tin_pension = NULL;
      SELECT tin_id INTO v_tin_pension FROM RPJ_CAT_TIPO_INGRESO
      WHERE UPPER(tin_tipo_ingreso) = 'PENSION' LIMIT 1;
    END;
  END IF;

  SET p_procesados   = 0;
  SET p_excluidos    = 0;
  SET p_total_pagado = 0.00;
  SET p_total_desc   = 0.00;

  OPEN cur_jub;

  loop_jub: LOOP
    FETCH cur_jub INTO v_id_jubilado;
    IF v_done THEN LEAVE loop_jub; END IF;

    -- Reset per-jubilado vars
    SET v_pension = 0; SET v_id_deuda = NULL; SET v_deu_periodo = NULL;
    SET v_monto_pend = 0; SET v_pago_corriente = 0; SET v_abono = 0;
    SET v_total_ingreso = 0; SET v_aplica_igss = 1; SET v_aplica_isr = 0;
    SET v_desc_igss = 0; SET v_desc_isr = 0;
    SET v_total_prr = 0; SET v_total_dju = 0;

    -- Get pension for this jubilado
    BEGIN
      DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_pension = 0;
      SELECT COALESCE(s.sal_salario,0) INTO v_pension
      FROM RPJ_MNT_SALARIO s
      INNER JOIN RPJ_CAT_TIPO_INGRESO ti ON ti.tin_id = s.sal_tipo_ingreso
      WHERE s.sal_id_jubilado = v_id_jubilado AND UPPER(ti.tin_tipo_ingreso) = 'PENSION'
      ORDER BY s.sal_correlativo DESC LIMIT 1;
    END;

    -- Fallback: global salary for tipo_manejo=2
    IF v_pension = 0 THEN
      BEGIN
        DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_pension = 0;
        SELECT COALESCE(sal_salario,0) INTO v_pension
        FROM RPJ_MNT_SALARIO
        WHERE sal_tipo_manejo = 2 AND sal_id_jubilado IS NULL
        ORDER BY sal_correlativo DESC LIMIT 1;
      END;
    END IF;

    IF v_pension = 0 THEN
      SET p_excluidos = p_excluidos + 1;
      ITERATE loop_jub;
    END IF;

    -- Get aplica_igss / aplica_isr from datos_planilla
    BEGIN
      DECLARE CONTINUE HANDLER FOR NOT FOUND BEGIN SET v_aplica_igss = 1; SET v_aplica_isr = 0; END;
      SELECT dat_aplica_desc_igss, dat_aplica_desc_isr INTO v_aplica_igss, v_aplica_isr
      FROM RPJ_MNT_DATOS_PLANILLA
      WHERE dat_id_empleado = v_id_jubilado AND dat_tipo_manejo = 2
      ORDER BY dat_correlativo DESC LIMIT 1;
    END;

    -- Calculate pago corriente
    SET v_pago_corriente = ROUND(v_pension * v_porcentaje / 100, 2);

    -- Find oldest pending debt
    BEGIN
      DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_id_deuda = NULL;
      SELECT deu_correlativo, deu_periodo, deu_monto_pendiente
      INTO v_id_deuda, v_deu_periodo, v_monto_pend
      FROM RPJ_PRC_DEUDA_JUBILADO
      WHERE deu_id_jubilado = v_id_jubilado AND deu_estado IN ('PENDIENTE','PARCIAL')
      ORDER BY deu_periodo ASC LIMIT 1;
    END;

    IF v_id_deuda IS NOT NULL THEN
      SET v_abono = LEAST(v_pago_corriente, v_monto_pend);
      -- Update debt record
      UPDATE RPJ_PRC_DEUDA_JUBILADO
      SET
        deu_monto_pagado    = deu_monto_pagado + v_abono,
        deu_monto_pendiente = deu_monto_pendiente - v_abono,
        deu_estado = CASE
          WHEN deu_monto_pendiente - v_abono <= 0 THEN 'PAGADA'
          ELSE 'PARCIAL'
        END,
        deu_fecha_saldada = CASE
          WHEN deu_monto_pendiente - v_abono <= 0 THEN CURDATE()
          ELSE NULL
        END
      WHERE deu_correlativo = v_id_deuda;

      INSERT INTO RPJ_PRC_APLICACION_PAGO (
        apa_id_planilla, apa_id_jubilado, apa_id_deuda, apa_periodo_deuda,
        apa_monto_aplicado, apa_fecha_aplicacion, apa_usuario_creacion
      ) VALUES (
        p_id_planilla, v_id_jubilado, v_id_deuda, v_deu_periodo,
        v_abono, v_fecha_pago, p_usuario
      );
    ELSE
      SET v_abono = 0;
    END IF;

    SET v_total_ingreso = v_pago_corriente + v_abono;

    -- Insert ingreso
    INSERT INTO RPJ_PRC_NOMINA_INGRESO (
      nin_tipo_manejo, nin_id_tipo_planilla, nin_id_planilla,
      nin_id_empleado, nin_id_jubilado, nin_tipo_ingreso, nin_valor,
      nin_dias_trabajados, nin_puesto, nin_area, nin_usuario_creacion,
      nin_valor_teorico, nin_porcentaje_aplicado, nin_pago_corriente,
      nin_abono_historico, nin_id_deuda_aplicada
    ) VALUES (
      2, v_tipo_planilla, p_id_planilla,
      NULL, v_id_jubilado, v_tin_pension, v_total_ingreso,
      30, 'Jubilado', 'Jubilados', p_usuario,
      v_pension, v_porcentaje, v_pago_corriente, v_abono, v_id_deuda
    );

    -- Descuento IGSS
    IF v_aplica_igss = 1 AND v_igss_pct > 0 AND v_tipo_igss IS NOT NULL THEN
      SET v_desc_igss = ROUND(v_total_ingreso * v_igss_pct / 100, 2);
      INSERT INTO RPJ_PRC_NOMINA_DESCUENTO (
        nde_tipo_manejo, nde_id_tipo_planilla, nde_id_planilla,
        nde_id_empleado, nde_id_jubilado, nde_tipo_descuento, nde_valor,
        nde_dias_trabajados, nde_puesto, nde_area, nde_usuario_creacion
      ) VALUES (2, v_tipo_planilla, p_id_planilla, NULL, v_id_jubilado, v_tipo_igss, v_desc_igss, 30, 'Jubilado', 'Jubilados', p_usuario);
    END IF;

    -- Descuento ISR
    IF v_aplica_isr = 1 AND v_isr_pct > 0 AND v_tipo_isr IS NOT NULL THEN
      SET v_desc_isr = ROUND(v_total_ingreso * v_isr_pct / 100, 2);
      INSERT INTO RPJ_PRC_NOMINA_DESCUENTO (
        nde_tipo_manejo, nde_id_tipo_planilla, nde_id_planilla,
        nde_id_empleado, nde_id_jubilado, nde_tipo_descuento, nde_valor,
        nde_dias_trabajados, nde_puesto, nde_area, nde_usuario_creacion
      ) VALUES (2, v_tipo_planilla, p_id_planilla, NULL, v_id_jubilado, v_tipo_isr, v_desc_isr, 30, 'Jubilado', 'Jubilados', p_usuario);
    END IF;

    -- Descuentos Prestamos (nested block)
    BEGIN
      DECLARE v_prr_done    INT DEFAULT 0;
      DECLARE v_prr_corr    INT;
      DECLARE v_prr_cuota   DECIMAL(12,2);
      DECLARE v_prr_saldo   DECIMAL(12,2);

      DECLARE cur_prr CURSOR FOR
        SELECT prr_correlativo, prr_valor_mes, prr_saldo
        FROM RPJ_MNT_PRESTAMOS_REGIMEN
        WHERE prr_id_empleado = v_id_jubilado
          AND prr_tipo_manejo = 2
          AND UPPER(prr_estado) = 'ACTIVO'
          AND prr_saldo > 0
        ORDER BY prr_correlativo;

      DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_prr_done = 1;

      OPEN cur_prr;
      loop_prr: LOOP
        FETCH cur_prr INTO v_prr_corr, v_prr_cuota, v_prr_saldo;
        IF v_prr_done THEN LEAVE loop_prr; END IF;

        IF v_tipo_prestamo IS NOT NULL THEN
          INSERT INTO RPJ_PRC_NOMINA_DESCUENTO (
            nde_tipo_manejo, nde_id_tipo_planilla, nde_id_planilla,
            nde_id_empleado, nde_id_jubilado, nde_tipo_descuento, nde_valor,
            nde_dias_trabajados, nde_puesto, nde_area, nde_usuario_creacion
          ) VALUES (2, v_tipo_planilla, p_id_planilla, NULL, v_id_jubilado, v_tipo_prestamo, v_prr_cuota, 30, 'Jubilado', 'Jubilados', p_usuario);

          SET v_total_prr = v_total_prr + v_prr_cuota;

          UPDATE RPJ_MNT_PRESTAMOS_REGIMEN
          SET
            prr_saldo  = GREATEST(prr_saldo - v_prr_cuota, 0),
            prr_estado = IF(prr_saldo - v_prr_cuota <= 0, 'CANCELADO', prr_estado)
          WHERE prr_correlativo = v_prr_corr;
        END IF;
      END LOOP;
      CLOSE cur_prr;
    END;

    -- Descuentos Judiciales (nested block)
    BEGIN
      DECLARE v_dju_done  INT DEFAULT 0;
      DECLARE v_dju_corr  INT;
      DECLARE v_dju_valor DECIMAL(12,2);
      DECLARE v_dju_saldo DECIMAL(12,2);

      DECLARE cur_dju CURSOR FOR
        SELECT dju_correlativo, dju_valor, dju_saldo
        FROM RPJ_MNT_DESC_JUDICIALES
        WHERE dju_id_empleado = v_id_jubilado
          AND dju_tipo_manejo = 2
          AND UPPER(dju_estado) = 'ACTIVO'
          AND dju_saldo > 0
        ORDER BY dju_correlativo;

      DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_dju_done = 1;

      OPEN cur_dju;
      loop_dju: LOOP
        FETCH cur_dju INTO v_dju_corr, v_dju_valor, v_dju_saldo;
        IF v_dju_done THEN LEAVE loop_dju; END IF;

        IF v_tipo_judicial IS NOT NULL THEN
          INSERT INTO RPJ_PRC_NOMINA_DESCUENTO (
            nde_tipo_manejo, nde_id_tipo_planilla, nde_id_planilla,
            nde_id_empleado, nde_id_jubilado, nde_tipo_descuento, nde_valor,
            nde_dias_trabajados, nde_puesto, nde_area, nde_usuario_creacion
          ) VALUES (2, v_tipo_planilla, p_id_planilla, NULL, v_id_jubilado, v_tipo_judicial, v_dju_valor, 30, 'Jubilado', 'Jubilados', p_usuario);

          SET v_total_dju = v_total_dju + v_dju_valor;

          UPDATE RPJ_MNT_DESC_JUDICIALES
          SET
            dju_saldo  = GREATEST(dju_saldo - v_dju_valor, 0),
            dju_estado = IF(dju_saldo - v_dju_valor <= 0, 'INACTIVO', dju_estado)
          WHERE dju_correlativo = v_dju_corr;
        END IF;
      END LOOP;
      CLOSE cur_dju;
    END;

    SET p_procesados   = p_procesados + 1;
    SET p_total_pagado = p_total_pagado + v_total_ingreso;
    SET p_total_desc   = p_total_desc + v_desc_igss + v_desc_isr + v_total_prr + v_total_dju;

  END LOOP;
  CLOSE cur_jub;

  -- Update planilla state to GENERADA
  UPDATE RPJ_CAT_PARAMETRO_PLANILLA
  SET ppl_estado_proceso   = 'GENERADA',
      ppl_fecha_generacion = NOW(),
      ppl_usuario_genera   = p_usuario
  WHERE ppl_correlativo = p_id_planilla;

  COMMIT;
END$$

-- ------------------------------------------------------------
-- sp_cerrar_planilla
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_cerrar_planilla$$

CREATE PROCEDURE sp_cerrar_planilla(
  IN p_id_planilla INT,
  IN p_usuario     VARCHAR(50)
)
BEGIN
  DECLARE v_estado VARCHAR(20);

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  BEGIN
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_estado = NULL;
    SELECT ppl_estado_proceso INTO v_estado
    FROM RPJ_CAT_PARAMETRO_PLANILLA WHERE ppl_correlativo = p_id_planilla LIMIT 1;
  END;

  IF v_estado IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La planilla no existe';
  END IF;
  IF v_estado != 'GENERADA' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Solo se puede cerrar una planilla en estado GENERADA';
  END IF;

  START TRANSACTION;
  UPDATE RPJ_CAT_PARAMETRO_PLANILLA
  SET ppl_estado_proceso = 'CERRADA',
      ppl_fecha_cierre   = NOW(),
      ppl_usuario_cierra = p_usuario
  WHERE ppl_correlativo = p_id_planilla;
  COMMIT;
END$$

-- ------------------------------------------------------------
-- sp_reversar_pago_pensionado: reverso individual
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_reversar_pago_pensionado$$

CREATE PROCEDURE sp_reversar_pago_pensionado(
  IN p_id_planilla  INT,
  IN p_id_jubilado  INT,
  IN p_usuario      VARCHAR(50),
  IN p_motivo       VARCHAR(250)
)
BEGIN
  DECLARE v_estado          VARCHAR(20);
  DECLARE v_tipo_prestamo   INT DEFAULT NULL;
  DECLARE v_tipo_judicial   INT DEFAULT NULL;

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  -- Validate estado
  BEGIN
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_estado = NULL;
    SELECT ppl_estado_proceso INTO v_estado
    FROM RPJ_CAT_PARAMETRO_PLANILLA WHERE ppl_correlativo = p_id_planilla LIMIT 1;
  END;

  IF v_estado IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La planilla no existe';
  END IF;
  IF v_estado != 'GENERADA' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Solo se puede reversar un pago individual en planilla GENERADA';
  END IF;
  IF p_motivo IS NULL OR TRIM(p_motivo) = '' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El motivo de reverso es obligatorio';
  END IF;

  -- Get tipo_descuento IDs
  BEGIN
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_tipo_prestamo = NULL;
    SELECT tde_id INTO v_tipo_prestamo FROM RPJ_CAT_TIPO_DESCUENTO
    WHERE UPPER(tde_tipo_descuento) IN ('PRESTAMO','PRESTAMOS') LIMIT 1;
  END;
  BEGIN
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_tipo_judicial = NULL;
    SELECT tde_id INTO v_tipo_judicial FROM RPJ_CAT_TIPO_DESCUENTO
    WHERE UPPER(tde_tipo_descuento) IN ('JUDICIAL','JUDICIALES') LIMIT 1;
  END;

  START TRANSACTION;

  -- Restore debt amounts from aplicacion_pago
  UPDATE RPJ_PRC_DEUDA_JUBILADO deu
  INNER JOIN RPJ_PRC_APLICACION_PAGO apa ON apa.apa_id_deuda = deu.deu_correlativo
  SET
    deu.deu_monto_pagado    = GREATEST(deu.deu_monto_pagado    - apa.apa_monto_aplicado, 0),
    deu.deu_monto_pendiente = deu.deu_monto_pendiente + apa.apa_monto_aplicado,
    deu.deu_estado = CASE
      WHEN deu.deu_monto_pagado - apa.apa_monto_aplicado <= 0 THEN 'PENDIENTE'
      ELSE 'PARCIAL'
    END,
    deu.deu_fecha_saldada = NULL
  WHERE apa.apa_id_planilla = p_id_planilla AND apa.apa_id_jubilado = p_id_jubilado;

  -- Restore prestamo saldos
  BEGIN
    DECLARE v_desc_done  INT DEFAULT 0;
    DECLARE v_desc_val   DECIMAL(12,2);

    DECLARE cur_desc_prr CURSOR FOR
      SELECT nde_valor FROM RPJ_PRC_NOMINA_DESCUENTO
      WHERE nde_id_planilla = p_id_planilla AND nde_id_jubilado = p_id_jubilado
        AND nde_tipo_descuento = v_tipo_prestamo;

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_desc_done = 1;

    IF v_tipo_prestamo IS NOT NULL THEN
      OPEN cur_desc_prr;
      loop_desc_prr: LOOP
        FETCH cur_desc_prr INTO v_desc_val;
        IF v_desc_done THEN LEAVE loop_desc_prr; END IF;
        UPDATE RPJ_MNT_PRESTAMOS_REGIMEN
        SET prr_saldo  = prr_saldo + v_desc_val,
            prr_estado = IF(UPPER(prr_estado) = 'CANCELADO', 'ACTIVO', prr_estado)
        WHERE prr_id_empleado = p_id_jubilado AND prr_tipo_manejo = 2
          AND prr_valor_mes = v_desc_val
        LIMIT 1;
      END LOOP;
      CLOSE cur_desc_prr;
    END IF;
  END;

  -- Restore judicial saldos
  BEGIN
    DECLARE v_djud_done  INT DEFAULT 0;
    DECLARE v_djud_val   DECIMAL(12,2);

    DECLARE cur_desc_dju CURSOR FOR
      SELECT nde_valor FROM RPJ_PRC_NOMINA_DESCUENTO
      WHERE nde_id_planilla = p_id_planilla AND nde_id_jubilado = p_id_jubilado
        AND nde_tipo_descuento = v_tipo_judicial;

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_djud_done = 1;

    IF v_tipo_judicial IS NOT NULL THEN
      OPEN cur_desc_dju;
      loop_desc_dju: LOOP
        FETCH cur_desc_dju INTO v_djud_val;
        IF v_djud_done THEN LEAVE loop_desc_dju; END IF;
        UPDATE RPJ_MNT_DESC_JUDICIALES
        SET dju_saldo  = dju_saldo + v_djud_val,
            dju_estado = IF(UPPER(dju_estado) = 'INACTIVO', 'ACTIVO', dju_estado)
        WHERE dju_id_empleado = p_id_jubilado AND dju_tipo_manejo = 2
          AND dju_valor = v_djud_val
        LIMIT 1;
      END LOOP;
      CLOSE cur_desc_dju;
    END IF;
  END;

  -- Delete application of payment
  DELETE FROM RPJ_PRC_APLICACION_PAGO
  WHERE apa_id_planilla = p_id_planilla AND apa_id_jubilado = p_id_jubilado;

  -- Delete nomina records for this jubilado
  DELETE FROM RPJ_PRC_NOMINA_DESCUENTO
  WHERE nde_id_planilla = p_id_planilla AND nde_id_jubilado = p_id_jubilado;

  DELETE FROM RPJ_PRC_NOMINA_INGRESO
  WHERE nin_id_planilla = p_id_planilla AND nin_id_jubilado = p_id_jubilado;

  -- Log reverso
  INSERT INTO RPJ_LOG_REVERSOS (lre_id_planilla, lre_id_jubilado, lre_motivo, lre_usuario)
  VALUES (p_id_planilla, p_id_jubilado, p_motivo, p_usuario);

  COMMIT;
END$$

-- ------------------------------------------------------------
-- sp_reversar_planilla_pensionados: reverso total
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_reversar_planilla_pensionados$$

CREATE PROCEDURE sp_reversar_planilla_pensionados(
  IN p_id_planilla INT,
  IN p_usuario     VARCHAR(50),
  IN p_motivo      VARCHAR(250)
)
BEGIN
  DECLARE v_estado         VARCHAR(20);
  DECLARE v_tipo_prestamo  INT DEFAULT NULL;
  DECLARE v_tipo_judicial  INT DEFAULT NULL;

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  BEGIN
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_estado = NULL;
    SELECT ppl_estado_proceso INTO v_estado
    FROM RPJ_CAT_PARAMETRO_PLANILLA WHERE ppl_correlativo = p_id_planilla LIMIT 1;
  END;

  IF v_estado IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La planilla no existe';
  END IF;
  IF v_estado NOT IN ('GENERADA','CERRADA') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Solo se puede reversar una planilla GENERADA o CERRADA';
  END IF;
  IF p_motivo IS NULL OR TRIM(p_motivo) = '' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El motivo de reverso es obligatorio';
  END IF;

  BEGIN
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_tipo_prestamo = NULL;
    SELECT tde_id INTO v_tipo_prestamo FROM RPJ_CAT_TIPO_DESCUENTO
    WHERE UPPER(tde_tipo_descuento) IN ('PRESTAMO','PRESTAMOS') LIMIT 1;
  END;
  BEGIN
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_tipo_judicial = NULL;
    SELECT tde_id INTO v_tipo_judicial FROM RPJ_CAT_TIPO_DESCUENTO
    WHERE UPPER(tde_tipo_descuento) IN ('JUDICIAL','JUDICIALES') LIMIT 1;
  END;

  START TRANSACTION;

  -- Restore all debts from this planilla
  UPDATE RPJ_PRC_DEUDA_JUBILADO deu
  INNER JOIN RPJ_PRC_APLICACION_PAGO apa ON apa.apa_id_deuda = deu.deu_correlativo
  SET
    deu.deu_monto_pagado    = GREATEST(deu.deu_monto_pagado    - apa.apa_monto_aplicado, 0),
    deu.deu_monto_pendiente = deu.deu_monto_pendiente + apa.apa_monto_aplicado,
    deu.deu_estado = CASE
      WHEN deu.deu_monto_pagado - apa.apa_monto_aplicado <= 0 THEN 'PENDIENTE'
      ELSE 'PARCIAL'
    END,
    deu.deu_fecha_saldada = NULL
  WHERE apa.apa_id_planilla = p_id_planilla;

  -- Restore ALL prestamos saldos for jubilados in this planilla
  IF v_tipo_prestamo IS NOT NULL THEN
    UPDATE RPJ_MNT_PRESTAMOS_REGIMEN prr
    INNER JOIN (
      SELECT nde_id_jubilado, nde_valor, nde_tipo_descuento
      FROM RPJ_PRC_NOMINA_DESCUENTO
      WHERE nde_id_planilla = p_id_planilla AND nde_tipo_descuento = v_tipo_prestamo
    ) nde ON nde.nde_id_jubilado = prr.prr_id_empleado
          AND nde.nde_valor = prr.prr_valor_mes
          AND prr.prr_tipo_manejo = 2
    SET prr.prr_saldo  = prr.prr_saldo + nde.nde_valor,
        prr.prr_estado = IF(UPPER(prr.prr_estado) = 'CANCELADO', 'ACTIVO', prr.prr_estado);
  END IF;

  -- Restore ALL judiciales saldos
  IF v_tipo_judicial IS NOT NULL THEN
    UPDATE RPJ_MNT_DESC_JUDICIALES dju
    INNER JOIN (
      SELECT nde_id_jubilado, nde_valor
      FROM RPJ_PRC_NOMINA_DESCUENTO
      WHERE nde_id_planilla = p_id_planilla AND nde_tipo_descuento = v_tipo_judicial
    ) nde ON nde.nde_id_jubilado = dju.dju_id_empleado
          AND nde.nde_valor = dju.dju_valor
          AND dju.dju_tipo_manejo = 2
    SET dju.dju_saldo  = dju.dju_saldo + nde.nde_valor,
        dju.dju_estado = IF(UPPER(dju.dju_estado) = 'INACTIVO', 'ACTIVO', dju.dju_estado);
  END IF;

  -- Delete all payment applications
  DELETE FROM RPJ_PRC_APLICACION_PAGO WHERE apa_id_planilla = p_id_planilla;

  -- Delete all nomina records (jubilados only)
  DELETE FROM RPJ_PRC_NOMINA_DESCUENTO
  WHERE nde_id_planilla = p_id_planilla AND nde_id_jubilado IS NOT NULL AND nde_tipo_manejo = 2;

  DELETE FROM RPJ_PRC_NOMINA_INGRESO
  WHERE nin_id_planilla = p_id_planilla AND nin_id_jubilado IS NOT NULL AND nin_tipo_manejo = 2;

  -- Update planilla state
  UPDATE RPJ_CAT_PARAMETRO_PLANILLA
  SET ppl_estado_proceso = 'REVERSADA'
  WHERE ppl_correlativo = p_id_planilla;

  -- Log reverso total
  INSERT INTO RPJ_LOG_REVERSOS (lre_id_planilla, lre_id_jubilado, lre_motivo, lre_usuario)
  VALUES (p_id_planilla, NULL, p_motivo, p_usuario);

  COMMIT;
END$$

DELIMITER ;

-- ============================================================
-- FIN DE MIGRACIÓN
-- ============================================================
