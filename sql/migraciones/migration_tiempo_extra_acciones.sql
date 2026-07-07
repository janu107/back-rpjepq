-- ============================================================
-- Migración: acciones faltantes para nómina tiempo extra
--   - sp_reversar_planilla_tiempo_extra
-- Idempotente: usa DROP IF EXISTS antes de cada CREATE.
-- Ejecutar UNA vez en producción.
-- ============================================================

DELIMITER $$

DROP PROCEDURE IF EXISTS sp_reversar_planilla_tiempo_extra$$

CREATE PROCEDURE sp_reversar_planilla_tiempo_extra(
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

  BEGIN
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_estado = NULL;
    SELECT ppl_estado_proceso INTO v_estado
    FROM RPJ_CAT_PARAMETRO_PLANILLA
    WHERE ppl_correlativo = p_id_planilla LIMIT 1;
  END;

  IF v_estado IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La planilla no existe';
  END IF;
  IF v_estado != 'GENERADA' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Solo se puede reversar una planilla en estado GENERADA';
  END IF;

  START TRANSACTION;

  -- Elimina ingresos de tiempo extra generados para esta planilla
  DELETE FROM RPJ_PRC_NOMINA_INGRESO
  WHERE nin_id_planilla    = p_id_planilla
    AND nin_id_tipo_planilla = 3
    AND nin_tipo_manejo     = 1;

  -- Elimina descuentos (IGSS) generados para esta planilla
  DELETE FROM RPJ_PRC_NOMINA_DESCUENTO
  WHERE nde_id_planilla    = p_id_planilla
    AND nde_id_tipo_planilla = 3
    AND nde_tipo_manejo     = 1;

  -- Regresa la planilla a estado ABIERTA
  UPDATE RPJ_CAT_PARAMETRO_PLANILLA
  SET ppl_estado_proceso  = 'ABIERTA',
      ppl_fecha_generacion = NULL,
      ppl_usuario_genera   = NULL
  WHERE ppl_correlativo = p_id_planilla;

  COMMIT;
END$$

DELIMITER ;
