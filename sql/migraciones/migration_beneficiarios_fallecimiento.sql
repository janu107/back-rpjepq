-- ============================================================================
-- Pago a beneficiarios de jubilados fallecidos (reglas confirmadas 2026-10-28).
-- Ejemplo: pensión Q6,000, líquido Q5,985; esposa 50%, dos hijos 25%.
--   * La deuda del fallecido queda congelada a su fallecimiento.
--   * ESPOSA, fase 1 "COBRO DEUDA DEL FALLECIDO": cobra lo que recibía él
--     (50% de su último líquido = Q2,992.50) y todo abona a la deuda del
--     fallecido, del mes más viejo al más nuevo.
--   * ESPOSA, fase 2 "VIUDEZ": empieza la planilla siguiente a terminar esa
--     deuda. Cada mes se le debe su % de la pensión (Q3,000) y se le paga el %
--     de la planilla (50% = Q1,500); el resto queda como deuda a su favor.
--   * HIJOS "ORFANDAD": desde el mes siguiente al fallecimiento se les debe su
--     % (Q1,500) y se paga el 50% (Q750), a la tutora. Al cumplir 18 dejan de
--     generar meses y su deuda acumulada se paga de una vez ("LIQUIDACION
--     ORFANDAD"); luego quedan INACTIVOS. HIJO_INVALIDEZ no tiene límite de edad.
-- Al GENERAR solo se calcula; la deuda se crea y abona al CERRAR. Idempotente.
-- ============================================================================

CREATE TABLE IF NOT EXISTS RPJ_PRC_DEUDA_BENEFICIARIO (
  dbe_correlativo     INT AUTO_INCREMENT PRIMARY KEY,
  dbe_id_beneficiario INT NOT NULL,
  dbe_id_jubilado     INT NOT NULL,
  dbe_periodo         INT NOT NULL,
  dbe_concepto        VARCHAR(30) NOT NULL,
  dbe_id_planilla     INT NULL,
  dbe_monto_original  DECIMAL(12,2) NOT NULL,
  dbe_monto_pagado    DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  dbe_monto_pendiente DECIMAL(12,2) NOT NULL,
  dbe_estado          ENUM('PENDIENTE','PARCIAL','PAGADA') NOT NULL DEFAULT 'PENDIENTE',
  dbe_fecha_saldada   DATE NULL,
  dbe_fecha_creacion  TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  dbe_usuario_creacion VARCHAR(50) NOT NULL,
  UNIQUE KEY uq_dbe_ben_periodo (dbe_id_beneficiario, dbe_periodo),
  KEY ix_dbe_estado (dbe_id_beneficiario, dbe_estado),
  KEY ix_dbe_planilla (dbe_id_planilla),
  CONSTRAINT fk_dbe_beneficiario FOREIGN KEY (dbe_id_beneficiario) REFERENCES RPJ_MNT_BENEFICIARIO (ben_correlativo),
  CONSTRAINT fk_dbe_jubilado FOREIGN KEY (dbe_id_jubilado) REFERENCES RPJ_MNT_JUBILADO (jub_correlativo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS RPJ_PRC_APLICACION_PAGO_BEN (
  apb_correlativo     INT AUTO_INCREMENT PRIMARY KEY,
  apb_id_planilla     INT NOT NULL,
  apb_id_beneficiario INT NOT NULL,
  apb_id_deuda        INT NOT NULL,
  apb_periodo_deuda   INT NOT NULL,
  apb_monto_aplicado  DECIMAL(12,2) NOT NULL,
  apb_fecha_aplicacion DATE NOT NULL,
  apb_fecha_creacion  TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  apb_usuario_creacion VARCHAR(50) NOT NULL,
  KEY ix_apb_planilla (apb_id_planilla),
  KEY ix_apb_deuda (apb_id_deuda),
  CONSTRAINT fk_apb_deuda FOREIGN KEY (apb_id_deuda) REFERENCES RPJ_PRC_DEUDA_BENEFICIARIO (dbe_correlativo),
  CONSTRAINT fk_apb_beneficiario FOREIGN KEY (apb_id_beneficiario) REFERENCES RPJ_MNT_BENEFICIARIO (ben_correlativo),
  CONSTRAINT fk_apb_planilla FOREIGN KEY (apb_id_planilla) REFERENCES RPJ_CAT_PARAMETRO_PLANILLA (ppl_correlativo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- Primer mes (AAAAMM) que se les debe a los beneficiarios: el mes siguiente al
-- último mes que se le debe al fallecido, o el del fallecimiento si ese mes no
-- se le alcanzó a deber a él. Así ningún mes queda sin pagarse a nadie.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS fn_inicio_beneficios;
DELIMITER $$
CREATE FUNCTION fn_inicio_beneficios(p_id_jubilado INT) RETURNS INT
READS SQL DATA
BEGIN
    DECLARE v_ult INT;
    DECLARE v_fallec DATE;
    DECLARE v_sig INT;
    DECLARE v_mes_fallec INT;
    SELECT MAX(deu_periodo) INTO v_ult FROM RPJ_PRC_DEUDA_JUBILADO WHERE deu_id_jubilado = p_id_jubilado;
    SELECT jub_fecha_fallecimiento INTO v_fallec FROM RPJ_MNT_JUBILADO WHERE jub_correlativo = p_id_jubilado;
    SET v_mes_fallec = IF(v_fallec IS NULL, NULL, YEAR(v_fallec) * 100 + MONTH(v_fallec));
    IF v_ult IS NULL THEN RETURN v_mes_fallec; END IF;
    SET v_sig = IF(v_ult % 100 = 12, v_ult + 89, v_ult + 1);
    RETURN IF(v_mes_fallec IS NULL, v_sig, GREATEST(v_sig, v_mes_fallec));
END$$
DELIMITER ;

-- ---------------------------------------------------------------------------
-- Generar (vista previa): un renglón por beneficiario ACTIVO de fallecido.
-- Se llama desde sp_generar_nomina_pensionados, dentro de su transacción.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_generar_beneficiarios_planilla;
DELIMITER $$
CREATE PROCEDURE sp_generar_beneficiarios_planilla(
    IN  p_id_planilla INT,
    IN  p_usuario     VARCHAR(50),
    OUT p_procesados  INT,
    OUT p_total       DECIMAL(14,2)
)
BEGIN
    DECLARE v_porcentaje  DECIMAL(5,2);
    DECLARE v_fecha_ini   DATE;
    DECLARE v_fecha_fin   DATE;
    DECLARE v_done        BOOLEAN DEFAULT FALSE;
    DECLARE v_id_ben      INT;
    DECLARE v_id_jub      INT;
    DECLARE v_parentesco  VARCHAR(30);
    DECLARE v_pct         DECIMAL(5,2);
    DECLARE v_fnac        DATE;
    DECLARE v_pension     DECIMAL(12,2);
    DECLARE v_pend_fall   DECIMAL(14,2);
    DECLARE v_liq_fall    DECIMAL(12,2);
    DECLARE v_id_deu      INT;
    DECLARE v_monto       DECIMAL(12,2);
    DECLARE v_debe        DECIMAL(12,2);
    DECLARE v_teorico     DECIMAL(12,2);
    DECLARE v_concepto    VARCHAR(40);
    DECLARE v_periodo     INT;

    DECLARE cur CURSOR FOR
        SELECT b.ben_correlativo, b.ben_id_jubilado, UPPER(b.ben_tipo_parentesco), b.ben_porcentaje,
               b.ben_fecha_nacimiento, s.pension
          FROM RPJ_MNT_BENEFICIARIO b
          JOIN RPJ_MNT_JUBILADO j ON j.jub_correlativo = b.ben_id_jubilado AND j.jub_estado_pago = 'FALLECIDO'
          JOIN (SELECT sal_id_jubilado, MAX(sal_salario) AS pension
                  FROM RPJ_MNT_SALARIO
                 WHERE sal_tipo_manejo = 2 AND sal_tipo_ingreso = 1 AND sal_salario > 0
                 GROUP BY sal_id_jubilado) s ON s.sal_id_jubilado = j.jub_correlativo
         WHERE b.ben_estado = 'ACTIVO'
           AND (j.jub_fecha_fallecimiento IS NULL OR j.jub_fecha_fallecimiento <= v_fecha_fin)
         ORDER BY b.ben_id_jubilado, b.ben_correlativo;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = TRUE;

    SET p_procesados = 0;
    SET p_total = 0.00;
    SELECT ppl_porcentaje_pago, ppl_fecha_inicio, ppl_fecha_final
      INTO v_porcentaje, v_fecha_ini, v_fecha_fin
      FROM RPJ_CAT_PARAMETRO_PLANILLA WHERE ppl_correlativo = p_id_planilla;
    SET v_periodo = YEAR(v_fecha_ini) * 100 + MONTH(v_fecha_ini);

    DELETE FROM RPJ_PRC_NOMINA_INGRESO WHERE nin_id_planilla = p_id_planilla AND nin_id_beneficiario IS NOT NULL;

    OPEN cur;
    loop_ben: LOOP
        FETCH cur INTO v_id_ben, v_id_jub, v_parentesco, v_pct, v_fnac, v_pension;
        IF v_done THEN LEAVE loop_ben; END IF;

        SET v_monto = 0.00; SET v_debe = 0.00; SET v_teorico = 0.00; SET v_id_deu = NULL; SET v_concepto = NULL;

        IF v_parentesco = 'ESPOSA' THEN
            SET v_pend_fall = 0.00;
            SELECT COALESCE(SUM(deu_monto_pendiente), 0) INTO v_pend_fall
              FROM RPJ_PRC_DEUDA_JUBILADO
             WHERE deu_id_jubilado = v_id_jub AND deu_estado IN ('PENDIENTE','PARCIAL') AND deu_monto_pendiente > 0;
            IF v_pend_fall > 0 THEN
                -- Cobra lo que recibía él: el % de la planilla sobre su último líquido.
                SET v_liq_fall = 0.00;
                SELECT deu_monto_original INTO v_liq_fall
                  FROM RPJ_PRC_DEUDA_JUBILADO WHERE deu_id_jubilado = v_id_jub ORDER BY deu_periodo DESC LIMIT 1;
                SELECT deu_correlativo INTO v_id_deu
                  FROM RPJ_PRC_DEUDA_JUBILADO
                 WHERE deu_id_jubilado = v_id_jub AND deu_estado IN ('PENDIENTE','PARCIAL') AND deu_monto_pendiente > 0
                 ORDER BY deu_periodo ASC LIMIT 1;
                SET v_concepto = 'COBRO DEUDA DEL FALLECIDO';
                SET v_teorico  = v_liq_fall;
                SET v_monto    = LEAST(ROUND(v_liq_fall * v_porcentaje / 100, 2), v_pend_fall);
            ELSE
                SET v_concepto = 'VIUDEZ';
                SET v_debe     = ROUND(v_pension * v_pct / 100, 2);
                SET v_teorico  = v_debe;
                SET v_monto    = ROUND(v_debe * v_porcentaje / 100, 2);
            END IF;
        ELSEIF v_parentesco = 'HIJO' AND TIMESTAMPDIFF(YEAR, v_fnac, v_fecha_ini) >= 18 THEN
            -- Ya es mayor de edad: se le paga de una vez lo que se le debe.
            SELECT COALESCE(SUM(dbe_monto_pendiente), 0) INTO v_monto
              FROM RPJ_PRC_DEUDA_BENEFICIARIO
             WHERE dbe_id_beneficiario = v_id_ben AND dbe_estado IN ('PENDIENTE','PARCIAL');
            SET v_concepto = 'LIQUIDACION ORFANDAD';
        ELSEIF v_periodo >= fn_inicio_beneficios(v_id_jub) THEN
            SET v_concepto = 'ORFANDAD';
            SET v_debe     = ROUND(v_pension * v_pct / 100, 2);
            SET v_teorico  = v_debe;
            SET v_monto    = ROUND(v_debe * v_porcentaje / 100, 2);
        END IF;

        IF v_monto > 0 THEN
            INSERT INTO RPJ_PRC_NOMINA_INGRESO
                (nin_tipo_manejo, nin_id_tipo_planilla, nin_id_planilla, nin_id_jubilado, nin_id_beneficiario, nin_tipo_ingreso,
                 nin_valor, nin_valor_teorico, nin_porcentaje_aplicado, nin_pago_corriente, nin_abono_historico,
                 nin_id_deuda_aplicada, nin_dias_trabajados, nin_puesto, nin_area, nin_usuario_creacion)
            VALUES (2, 2, p_id_planilla, v_id_jub, v_id_ben, 1,
                 v_monto, v_teorico, IF(v_concepto = 'LIQUIDACION ORFANDAD', 100, v_porcentaje),
                 IF(v_concepto IN ('VIUDEZ','ORFANDAD'), v_monto, 0), IF(v_concepto IN ('VIUDEZ','ORFANDAD'), 0, v_monto),
                 v_id_deu, 30, v_concepto, 'BENEFICIARIO', p_usuario);
            SET p_procesados = p_procesados + 1;
            SET p_total = p_total + v_monto;
        END IF;

        SET v_done = FALSE;
    END LOOP loop_ben;
    CLOSE cur;
END$$
DELIMITER ;

-- ---------------------------------------------------------------------------
-- Cerrar: crea los meses que se deben a cada beneficiario y aplica lo pagado,
-- del mes más viejo al más nuevo. Se llama desde sp_cuadrar_planilla_pensionados.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_cuadrar_beneficiarios_planilla;
DELIMITER $$
CREATE PROCEDURE sp_cuadrar_beneficiarios_planilla(
    IN p_id_planilla INT,
    IN p_usuario     VARCHAR(50)
)
BEGIN
    DECLARE v_periodo    INT;
    DECLARE v_fecha_ini  DATE;
    DECLARE v_fecha_fin  DATE;
    DECLARE v_done       BOOLEAN DEFAULT FALSE;
    DECLARE v_id_ben     INT;
    DECLARE v_id_jub     INT;
    DECLARE v_concepto   VARCHAR(40);
    DECLARE v_valor      DECIMAL(12,2);
    DECLARE v_teorico    DECIMAL(12,2);
    DECLARE v_fallec     DATE;
    DECLARE v_mes        DATE;
    DECLARE v_disponible DECIMAL(12,2);
    DECLARE v_id_deuda   INT;
    DECLARE v_per_deuda  INT;
    DECLARE v_pend       DECIMAL(12,2);
    DECLARE v_abono      DECIMAL(12,2);

    DECLARE cur CURSOR FOR
        SELECT i.nin_id_beneficiario, i.nin_id_jubilado, i.nin_puesto, i.nin_valor, i.nin_valor_teorico, j.jub_fecha_fallecimiento
          FROM RPJ_PRC_NOMINA_INGRESO i
          JOIN RPJ_MNT_JUBILADO j ON j.jub_correlativo = i.nin_id_jubilado
         WHERE i.nin_id_planilla = p_id_planilla AND i.nin_id_beneficiario IS NOT NULL
         ORDER BY i.nin_correlativo;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = TRUE;

    SELECT YEAR(ppl_fecha_inicio) * 100 + MONTH(ppl_fecha_inicio), ppl_fecha_inicio, ppl_fecha_final
      INTO v_periodo, v_fecha_ini, v_fecha_fin
      FROM RPJ_CAT_PARAMETRO_PLANILLA WHERE ppl_correlativo = p_id_planilla;

    -- Deshacer lo aplicado antes por esta planilla (se puede cuadrar más de una vez).
    UPDATE RPJ_PRC_DEUDA_BENEFICIARIO d
      JOIN RPJ_PRC_APLICACION_PAGO_BEN a ON a.apb_id_deuda = d.dbe_correlativo
       SET d.dbe_monto_pagado = d.dbe_monto_pagado - a.apb_monto_aplicado,
           d.dbe_monto_pendiente = d.dbe_monto_pendiente + a.apb_monto_aplicado,
           d.dbe_fecha_saldada = NULL
     WHERE a.apb_id_planilla = p_id_planilla;
    -- El estado se recalcula aparte: en un UPDATE de varias tablas MySQL no
    -- garantiza el orden de las asignaciones.
    UPDATE RPJ_PRC_DEUDA_BENEFICIARIO d
      JOIN RPJ_PRC_APLICACION_PAGO_BEN a ON a.apb_id_deuda = d.dbe_correlativo
       SET d.dbe_estado = CASE WHEN d.dbe_monto_pendiente <= 0 THEN 'PAGADA' WHEN d.dbe_monto_pagado > 0 THEN 'PARCIAL' ELSE 'PENDIENTE' END
     WHERE a.apb_id_planilla = p_id_planilla;
    DELETE FROM RPJ_PRC_APLICACION_PAGO_BEN WHERE apb_id_planilla = p_id_planilla;
    DELETE FROM RPJ_PRC_DEUDA_BENEFICIARIO WHERE dbe_id_planilla = p_id_planilla;
    UPDATE RPJ_PRC_DEUDA_JUBILADO d
      JOIN RPJ_PRC_APLICACION_PAGO a ON a.apa_id_deuda = d.deu_correlativo
       SET d.deu_monto_pagado = d.deu_monto_pagado - a.apa_monto_aplicado,
           d.deu_monto_pendiente = d.deu_monto_pendiente + a.apa_monto_aplicado,
           d.deu_fecha_saldada = NULL
     WHERE a.apa_id_planilla = p_id_planilla AND a.apa_observaciones LIKE 'Beneficiario%';
    -- El estado se recalcula aparte: en un UPDATE de varias tablas MySQL no
    -- garantiza el orden de las asignaciones.
    UPDATE RPJ_PRC_DEUDA_JUBILADO d
      JOIN RPJ_PRC_APLICACION_PAGO a ON a.apa_id_deuda = d.deu_correlativo
       SET d.deu_estado = CASE WHEN d.deu_monto_pendiente <= 0 THEN 'PAGADA' WHEN d.deu_monto_pagado > 0 THEN 'PARCIAL' ELSE 'PENDIENTE' END
     WHERE a.apa_id_planilla = p_id_planilla AND a.apa_observaciones LIKE 'Beneficiario%';
    DELETE FROM RPJ_PRC_APLICACION_PAGO WHERE apa_id_planilla = p_id_planilla AND apa_observaciones LIKE 'Beneficiario%';

    OPEN cur;
    loop_ben: LOOP
        FETCH cur INTO v_id_ben, v_id_jub, v_concepto, v_valor, v_teorico, v_fallec;
        IF v_done THEN LEAVE loop_ben; END IF;
        SET v_disponible = v_valor;

        IF v_concepto = 'COBRO DEUDA DEL FALLECIDO' THEN
            -- Abona a la deuda del fallecido, del mes más viejo al más nuevo.
            loop_fall: WHILE v_disponible > 0 DO
                SET v_id_deuda = NULL; SET v_per_deuda = NULL; SET v_pend = 0;
                SELECT deu_correlativo, deu_periodo, deu_monto_pendiente INTO v_id_deuda, v_per_deuda, v_pend
                  FROM RPJ_PRC_DEUDA_JUBILADO
                 WHERE deu_id_jubilado = v_id_jub AND deu_estado IN ('PENDIENTE','PARCIAL') AND deu_monto_pendiente > 0
                 ORDER BY deu_periodo ASC LIMIT 1;
                IF v_id_deuda IS NULL THEN LEAVE loop_fall; END IF;
                SET v_abono = LEAST(v_disponible, v_pend);
                UPDATE RPJ_PRC_DEUDA_JUBILADO
                   SET deu_monto_pagado = deu_monto_pagado + v_abono,
                       deu_monto_pendiente = deu_monto_pendiente - v_abono,
                       deu_estado = CASE WHEN deu_monto_pendiente <= 0 THEN 'PAGADA' ELSE 'PARCIAL' END,
                       deu_fecha_saldada = CASE WHEN deu_monto_pendiente <= 0 THEN CURDATE() ELSE NULL END
                 WHERE deu_correlativo = v_id_deuda;
                INSERT INTO RPJ_PRC_APLICACION_PAGO
                    (apa_id_planilla, apa_id_jubilado, apa_id_deuda, apa_periodo_deuda, apa_monto_aplicado, apa_fecha_aplicacion, apa_observaciones, apa_usuario_creacion)
                VALUES (p_id_planilla, v_id_jub, v_id_deuda, v_per_deuda, v_abono, CURDATE(), CONCAT('Beneficiario ', v_id_ben, ': abono al periodo ', v_per_deuda), p_usuario);
                SET v_disponible = v_disponible - v_abono;
            END WHILE loop_fall;
        ELSE
            IF v_concepto = 'ORFANDAD' THEN
                -- Meses desde el siguiente al fallecimiento hasta esta planilla (si faltan).
                SET v_per_deuda = COALESCE(fn_inicio_beneficios(v_id_jub), v_periodo);
                SET v_mes = STR_TO_DATE(CONCAT(v_per_deuda, '01'), '%Y%m%d');
                WHILE YEAR(v_mes) * 100 + MONTH(v_mes) <= v_periodo DO
                    INSERT IGNORE INTO RPJ_PRC_DEUDA_BENEFICIARIO
                        (dbe_id_beneficiario, dbe_id_jubilado, dbe_periodo, dbe_concepto, dbe_id_planilla, dbe_monto_original, dbe_monto_pendiente, dbe_usuario_creacion)
                    VALUES (v_id_ben, v_id_jub, YEAR(v_mes) * 100 + MONTH(v_mes), 'ORFANDAD', p_id_planilla, v_teorico, v_teorico, p_usuario);
                    SET v_mes = DATE_ADD(v_mes, INTERVAL 1 MONTH);
                END WHILE;
            ELSEIF v_concepto = 'VIUDEZ' THEN
                INSERT IGNORE INTO RPJ_PRC_DEUDA_BENEFICIARIO
                    (dbe_id_beneficiario, dbe_id_jubilado, dbe_periodo, dbe_concepto, dbe_id_planilla, dbe_monto_original, dbe_monto_pendiente, dbe_usuario_creacion)
                VALUES (v_id_ben, v_id_jub, v_periodo, 'VIUDEZ', p_id_planilla, v_teorico, v_teorico, p_usuario);
            END IF;

            loop_ben_deuda: WHILE v_disponible > 0 DO
                SET v_id_deuda = NULL; SET v_per_deuda = NULL; SET v_pend = 0;
                SELECT dbe_correlativo, dbe_periodo, dbe_monto_pendiente INTO v_id_deuda, v_per_deuda, v_pend
                  FROM RPJ_PRC_DEUDA_BENEFICIARIO
                 WHERE dbe_id_beneficiario = v_id_ben AND dbe_estado IN ('PENDIENTE','PARCIAL') AND dbe_monto_pendiente > 0
                 ORDER BY dbe_periodo ASC LIMIT 1;
                IF v_id_deuda IS NULL THEN LEAVE loop_ben_deuda; END IF;
                SET v_abono = LEAST(v_disponible, v_pend);
                UPDATE RPJ_PRC_DEUDA_BENEFICIARIO
                   SET dbe_monto_pagado = dbe_monto_pagado + v_abono,
                       dbe_monto_pendiente = dbe_monto_pendiente - v_abono,
                       dbe_estado = CASE WHEN dbe_monto_pendiente <= 0 THEN 'PAGADA' ELSE 'PARCIAL' END,
                       dbe_fecha_saldada = CASE WHEN dbe_monto_pendiente <= 0 THEN CURDATE() ELSE NULL END
                 WHERE dbe_correlativo = v_id_deuda;
                INSERT INTO RPJ_PRC_APLICACION_PAGO_BEN
                    (apb_id_planilla, apb_id_beneficiario, apb_id_deuda, apb_periodo_deuda, apb_monto_aplicado, apb_fecha_aplicacion, apb_usuario_creacion)
                VALUES (p_id_planilla, v_id_ben, v_id_deuda, v_per_deuda, v_abono, CURDATE(), p_usuario);
                SET v_disponible = v_disponible - v_abono;
            END WHILE loop_ben_deuda;
        END IF;

        SET v_done = FALSE;
    END LOOP loop_ben;
    CLOSE cur;

    -- Hijos que ya cumplieron 18 y no deben nada: quedan INACTIVOS.
    UPDATE RPJ_MNT_BENEFICIARIO b
      JOIN RPJ_MNT_JUBILADO j ON j.jub_correlativo = b.ben_id_jubilado AND j.jub_estado_pago = 'FALLECIDO'
       SET b.ben_estado = 'INACTIVO',
           b.ben_fecha_desactivacion = v_fecha_fin,
           b.ben_observaciones = CONCAT(COALESCE(CONCAT(b.ben_observaciones, ' | '), ''), 'Mayor de edad: orfandad terminada en la planilla ', v_periodo)
     WHERE b.ben_estado = 'ACTIVO' AND b.ben_tipo_parentesco = 'HIJO'
       AND TIMESTAMPDIFF(YEAR, b.ben_fecha_nacimiento, v_fecha_ini) >= 18
       AND NOT EXISTS (SELECT 1 FROM RPJ_PRC_DEUDA_BENEFICIARIO d
                        WHERE d.dbe_id_beneficiario = b.ben_correlativo AND d.dbe_estado IN ('PENDIENTE','PARCIAL') AND d.dbe_monto_pendiente > 0);
END$$
DELIMITER ;

-- Nómina y cierre de jubilados (iguales a migration_regla_50_liquido.sql), ya con beneficiarios.
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
           d.deu_fecha_saldada = NULL
     WHERE a.apa_id_planilla = p_id_planilla;
    -- El estado se recalcula aparte: en un UPDATE de varias tablas MySQL no
    -- garantiza el orden de las asignaciones.
    UPDATE RPJ_PRC_DEUDA_JUBILADO d
     INNER JOIN RPJ_PRC_APLICACION_PAGO a ON a.apa_id_deuda = d.deu_correlativo
       SET d.deu_estado = CASE WHEN d.deu_monto_pendiente <= 0 THEN 'PAGADA' WHEN d.deu_monto_pagado > 0 THEN 'PARCIAL' ELSE 'PENDIENTE' END
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
                   dju_estado = CASE WHEN dju_saldo <= 0 THEN 'CANCELADO' ELSE 'ACTIVO' END
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
                   prr_estado = CASE WHEN prr_saldo <= 0 THEN 'OPERADA' ELSE 'ACTIVO' END
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

    -- Beneficiarios de jubilados fallecidos (esposa: deuda del fallecido o viudez;
    -- hijos: orfandad). Ver migration_beneficiarios_fallecimiento.sql.
    CALL sp_generar_beneficiarios_planilla(p_id_planilla, p_usuario, @ben_proc, @ben_total);
    SET p_total_pagado = p_total_pagado + COALESCE(@ben_total, 0);

    UPDATE RPJ_CAT_PARAMETRO_PLANILLA
       SET ppl_estado_proceso = 'GENERADA', ppl_fecha_generacion = NOW(), ppl_usuario_genera = p_usuario
     WHERE ppl_correlativo = p_id_planilla;

    COMMIT;
END$$
DELIMITER ;

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
           AND i.nin_id_beneficiario IS NULL
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
               d.deu_fecha_saldada = NULL
         WHERE a.apa_id_planilla = p_id_planilla AND a.apa_id_jubilado = v_id_jub;
        -- El estado se recalcula aparte: en un UPDATE de varias tablas MySQL no
        -- garantiza el orden de las asignaciones.
        UPDATE RPJ_PRC_DEUDA_JUBILADO d
         INNER JOIN RPJ_PRC_APLICACION_PAGO a ON a.apa_id_deuda = d.deu_correlativo
           SET d.deu_estado = CASE WHEN d.deu_monto_pendiente <= 0 THEN 'PAGADA' WHEN d.deu_monto_pagado > 0 THEN 'PARCIAL' ELSE 'PENDIENTE' END
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
                   deu_estado = CASE WHEN deu_monto_pendiente <= 0 THEN 'PAGADA' ELSE 'PARCIAL' END,
                   deu_fecha_saldada = CASE WHEN deu_monto_pendiente <= 0 THEN CURDATE() ELSE NULL END
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
         WHERE nin_id_planilla = p_id_planilla AND nin_id_jubilado = v_id_jub AND nin_id_beneficiario IS NULL;
        UPDATE RPJ_PRC_NOMINA_INGRESO
           SET nin_pago_corriente = v_pago_mes, nin_abono_historico = v_anterior, nin_id_deuda_aplicada = v_primera
         WHERE nin_id_planilla = p_id_planilla AND nin_id_jubilado = v_id_jub AND nin_id_beneficiario IS NULL
         ORDER BY nin_correlativo LIMIT 1;

        SET p_ajustados = p_ajustados + 1;
        SET v_done = FALSE;
    END LOOP loop_jub;
    CLOSE cur;

    -- Beneficiarios de fallecidos: meses que se les deben y abonos.
    CALL sp_cuadrar_beneficiarios_planilla(p_id_planilla, p_usuario);
    COMMIT;
END$$
DELIMITER ;

-- Registro de fallecimiento (definición vigente + exige la pensión cargada).
DROP PROCEDURE IF EXISTS sp_registrar_fallecimiento_jubilado;
DELIMITER $$
CREATE PROCEDURE `sp_registrar_fallecimiento_jubilado`(
    IN  p_id_jubilado       INT,
    IN  p_fecha_fallecim    DATE,
    IN  p_no_defuncion      VARCHAR(50),
    IN  p_usuario           VARCHAR(50),
    OUT p_beneficiarios_act INT,
    OUT p_resultado         VARCHAR(300)
)
BEGIN
    DECLARE v_existe            INT DEFAULT 0;
    DECLARE v_estado_actual     VARCHAR(20);
    DECLARE v_total_ben         INT DEFAULT 0;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        SET p_resultado = 'ERROR: ROLLBACK.';
        RESIGNAL;
    END;

    SELECT COUNT(*), MAX(jub_estado_pago)
      INTO v_existe, v_estado_actual
      FROM RPJ_MNT_JUBILADO
     WHERE jub_correlativo = p_id_jubilado;

    IF v_existe = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Jubilado no existe';
    END IF;

    IF v_estado_actual = 'FALLECIDO' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El jubilado ya esta registrado como fallecido';
    END IF;

    -- Verificar que tenga beneficiarios registrados
    SELECT COUNT(*) INTO v_total_ben
      FROM RPJ_MNT_BENEFICIARIO
     WHERE ben_id_jubilado = p_id_jubilado
       AND ben_estado      = 'REGISTRADO';

    IF v_total_ben = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El jubilado no tiene beneficiarios registrados';
    END IF;
    -- Sin pensión cargada no hay de dónde pagar a los beneficiarios.
    IF NOT EXISTS (SELECT 1 FROM RPJ_MNT_SALARIO WHERE sal_id_jubilado = p_id_jubilado AND sal_tipo_manejo = 2
                      AND sal_tipo_ingreso = 1 AND sal_salario > 0) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El jubilado no tiene la pension cargada: carguela (y su deuda historica) antes de registrar el fallecimiento';
    END IF;

    START TRANSACTION;

    -- Actualizar jubilado
    UPDATE RPJ_MNT_JUBILADO
       SET jub_estado_pago         = 'FALLECIDO',
           jub_fecha_fallecimiento = p_fecha_fallecim,
           jub_no_defuncion        = p_no_defuncion
     WHERE jub_correlativo = p_id_jubilado;

    -- Activar beneficiarios REGISTRADOS
    UPDATE RPJ_MNT_BENEFICIARIO
       SET ben_estado           = 'ACTIVO',
           ben_fecha_activacion = p_fecha_fallecim
     WHERE ben_id_jubilado = p_id_jubilado
       AND ben_estado      = 'REGISTRADO';

    SET p_beneficiarios_act = ROW_COUNT();

    COMMIT;

    SET p_resultado = CONCAT(
        'PROCESO EXITOSO. Beneficiarios activados: ', p_beneficiarios_act,
        '. La deuda del jubilado sera cobrada por los beneficiarios.'
    );
END$$
DELIMITER ;

-- Reversas (iguales a migration_regla_50_liquido.sql, con el estado de la deuda bien recalculado).
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
           d.deu_fecha_saldada = NULL
     WHERE a.apa_id_planilla = p_id_planilla;
    -- El estado se recalcula aparte: en un UPDATE de varias tablas MySQL no
    -- garantiza el orden de las asignaciones.
    UPDATE RPJ_PRC_DEUDA_JUBILADO d
    INNER JOIN RPJ_PRC_APLICACION_PAGO a ON a.apa_id_deuda = d.deu_correlativo
       SET d.deu_estado = CASE WHEN d.deu_monto_pendiente <= 0 THEN 'PAGADA' WHEN d.deu_monto_pagado > 0 THEN 'PARCIAL' ELSE 'PENDIENTE' END
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
           d.deu_fecha_saldada = NULL
     WHERE a.apa_id_planilla = p_id_planilla
       AND a.apa_id_jubilado = p_id_jubilado;
    -- El estado se recalcula aparte: en un UPDATE de varias tablas MySQL no
    -- garantiza el orden de las asignaciones.
    UPDATE RPJ_PRC_DEUDA_JUBILADO d
    INNER JOIN RPJ_PRC_APLICACION_PAGO a ON a.apa_id_deuda = d.deu_correlativo
       SET d.deu_estado = CASE WHEN d.deu_monto_pendiente <= 0 THEN 'PAGADA' WHEN d.deu_monto_pagado > 0 THEN 'PARCIAL' ELSE 'PENDIENTE' END
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
