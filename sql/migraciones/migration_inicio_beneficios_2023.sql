-- ============================================================================
-- Inicio de beneficios (2026-11-02): la orfandad (y viudez) se debe desde el mes del
-- fallecimiento, pero nunca antes de enero 2023 (igual que la deuda de los jubilados).
-- Si el fallecimiento se registró tarde, lo generado con el código del fallecido
-- después de su muerte ya no atrasa el inicio de los hijos.
-- Caso 340 (falleció 2011-10): cada hija se debe desde 202301.
-- ============================================================================
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
    SELECT jub_fecha_fallecimiento, COALESCE(jub_fallecido_en_servicio, 0), jub_periodo_inicio_beneficios
      INTO v_fallec, v_servicio, v_inicio
      FROM RPJ_MNT_JUBILADO WHERE jub_correlativo = p_id_jubilado;
    SET v_mes_fallec = IF(v_fallec IS NULL, NULL, YEAR(v_fallec) * 100 + MONTH(v_fallec));
    -- Falleció en servicio (nunca fue jubilado): sus beneficiarios cobran desde la
    -- planilla que se fijó al registrarlo, sin meses atrasados.
    IF v_servicio = 1 AND v_inicio IS NOT NULL THEN RETURN v_inicio; END IF;
    -- Solo cuenta la deuda del fallecido hasta el mes en que falleció: lo generado con
    -- su código después (fallecimiento registrado tarde) lo cobró su cónyuge.
    SELECT MAX(deu_periodo) INTO v_ult FROM RPJ_PRC_DEUDA_JUBILADO
     WHERE deu_id_jubilado = p_id_jubilado AND (v_mes_fallec IS NULL OR deu_periodo <= v_mes_fallec);
    -- La deuda con beneficiarios empieza, como la de los jubilados, en enero 2023.
    IF v_ult IS NULL THEN RETURN GREATEST(COALESCE(v_mes_fallec, 202301), 202301); END IF;
    SET v_sig = IF(v_ult % 100 = 12, v_ult + 89, v_ult + 1);
    RETURN GREATEST(IF(v_mes_fallec IS NULL, v_sig, GREATEST(v_sig, v_mes_fallec)), 202301);
END$$
DELIMITER ;
