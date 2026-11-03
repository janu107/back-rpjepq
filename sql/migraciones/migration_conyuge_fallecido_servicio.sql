-- ============================================================================
-- Beneficiarios (cambios pedidos 2026-11-02):
--   * Cónyuge: la viuda (ESPOSA) o el viudo (ESPOSO) cobran igual; uno por fallecido.
--   * Empleado EPQ que fallece en servicio (nunca fue jubilado): se registra como
--     jubilado FALLECIDO con jub_fallecido_en_servicio = 1 y una pensión de
--     referencia. No tiene deuda: el cónyuge entra directo a VIUDEZ y los hijos a
--     ORFANDAD, todos desde la planilla siguiente a la última de jubilados CERRADA
--     al registrarlo (jub_periodo_inicio_beneficios).
-- Idempotente.
-- ============================================================================

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'RPJ_MNT_JUBILADO' AND COLUMN_NAME = 'jub_fallecido_en_servicio');
SET @s := IF(@c = 0, 'ALTER TABLE RPJ_MNT_JUBILADO ADD COLUMN jub_fallecido_en_servicio TINYINT(1) NOT NULL DEFAULT 0 AFTER jub_no_defuncion', 'SELECT 1');
PREPARE st FROM @s;
EXECUTE st;
DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'RPJ_MNT_JUBILADO' AND COLUMN_NAME = 'jub_periodo_inicio_beneficios');
SET @s := IF(@c = 0, 'ALTER TABLE RPJ_MNT_JUBILADO ADD COLUMN jub_periodo_inicio_beneficios INT NULL AFTER jub_fallecido_en_servicio', 'SELECT 1');
PREPARE st FROM @s;
EXECUTE st;
DEALLOCATE PREPARE st;

-- Inicio de beneficios: igual que antes, salvo los fallecidos en servicio.
DROP FUNCTION IF EXISTS fn_inicio_beneficios;
DELIMITER $$
CREATE FUNCTION fn_inicio_beneficios(p_id_jubilado INT) RETURNS INT
READS SQL DATA
BEGIN
    DECLARE v_ult INT;
    DECLARE v_fallec DATE;
    DECLARE v_sig INT;
    DECLARE v_mes_fallec INT;
    DECLARE v_servicio TINYINT;
    DECLARE v_inicio INT;
    SELECT MAX(deu_periodo) INTO v_ult FROM RPJ_PRC_DEUDA_JUBILADO WHERE deu_id_jubilado = p_id_jubilado;
    SELECT jub_fecha_fallecimiento, COALESCE(jub_fallecido_en_servicio, 0), jub_periodo_inicio_beneficios
      INTO v_fallec, v_servicio, v_inicio
      FROM RPJ_MNT_JUBILADO WHERE jub_correlativo = p_id_jubilado;
    SET v_mes_fallec = IF(v_fallec IS NULL, NULL, YEAR(v_fallec) * 100 + MONTH(v_fallec));
    -- Falleció en servicio (nunca fue jubilado): sus beneficiarios cobran desde la
    -- planilla que se fijó al registrarlo, sin meses atrasados.
    IF v_servicio = 1 AND v_inicio IS NOT NULL THEN RETURN v_inicio; END IF;
    IF v_ult IS NULL THEN RETURN v_mes_fallec; END IF;
    SET v_sig = IF(v_ult % 100 = 12, v_ult + 89, v_ult + 1);
    RETURN IF(v_mes_fallec IS NULL, v_sig, GREATEST(v_sig, v_mes_fallec));
END$$
DELIMITER ;

-- Generar beneficiarios: el viudo (ESPOSO) cobra igual que la viuda (ESPOSA).
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
    DECLARE v_monto_ben   DECIMAL(12,2);
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
        SELECT b.ben_correlativo, b.ben_id_jubilado, UPPER(b.ben_tipo_parentesco), b.ben_porcentaje, b.ben_monto,
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
        FETCH cur INTO v_id_ben, v_id_jub, v_parentesco, v_pct, v_monto_ben, v_fnac, v_pension;
        IF v_done THEN LEAVE loop_ben; END IF;

        SET v_monto = 0.00; SET v_debe = 0.00; SET v_teorico = 0.00; SET v_id_deu = NULL; SET v_concepto = NULL;

        IF v_parentesco IN ('ESPOSA', 'ESPOSO') THEN
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
            ELSEIF v_periodo >= COALESCE(fn_inicio_beneficios(v_id_jub), v_periodo) THEN
                SET v_concepto = 'VIUDEZ';
                SET v_debe     = COALESCE(v_monto_ben, ROUND(v_pension * v_pct / 100, 2));
                SET v_teorico  = v_debe;
                SET v_monto    = ROUND(v_debe * v_porcentaje / 100, 2);
            END IF;
        ELSEIF v_parentesco NOT IN ('HIJO', 'HIJO_INVALIDEZ') THEN
            -- Otros parentescos: solo registro, todavía sin regla de pago.
            SET v_concepto = NULL;
        ELSEIF v_parentesco = 'HIJO' AND TIMESTAMPDIFF(YEAR, v_fnac, v_fecha_ini) >= 18 THEN
            -- Ya es mayor de edad: se le paga de una vez lo que se le debe.
            SELECT COALESCE(SUM(dbe_monto_pendiente), 0) INTO v_monto
              FROM RPJ_PRC_DEUDA_BENEFICIARIO
             WHERE dbe_id_beneficiario = v_id_ben AND dbe_estado IN ('PENDIENTE','PARCIAL');
            SET v_concepto = 'LIQUIDACION ORFANDAD';
        ELSEIF v_periodo >= fn_inicio_beneficios(v_id_jub) THEN
            SET v_concepto = 'ORFANDAD';
            SET v_debe     = COALESCE(v_monto_ben, ROUND(v_pension * v_pct / 100, 2));
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
