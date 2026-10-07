-- Carga masiva de deuda historica: tolerante a jubilados con datos incompletos.
-- Antes, un solo jubilado sin fecha de jubilacion abortaba TODA la carga (error 500).
-- Ahora ese jubilado se omite y se informa cuantos fueron omitidos.
DELIMITER $$

DROP PROCEDURE IF EXISTS sp_generar_deuda_historica_masivo$$

CREATE PROCEDURE sp_generar_deuda_historica_masivo(
  IN  p_periodo_final         INT,
  IN  p_porcentaje_pago       DECIMAL(5,2),
  IN  p_usuario               VARCHAR(50),
  OUT p_jubilados_procesados  INT,
  OUT p_total_deudas          INT,
  OUT p_omitidos              INT
)
BEGIN
  DECLARE v_done        INT DEFAULT 0;
  DECLARE v_id_jubilado INT;
  DECLARE v_deudas_sub  INT DEFAULT 0;
  DECLARE v_fallo       INT DEFAULT 0;

  DECLARE cur_jub CURSOR FOR
    SELECT jub_correlativo
    FROM RPJ_MNT_JUBILADO
    WHERE jub_tipo_manejo = 2
      AND UPPER(COALESCE(jub_estado,'')) = 'ACTIVO'
    ORDER BY jub_correlativo;

  DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = 1;

  SET p_jubilados_procesados = 0;
  SET p_total_deudas         = 0;
  SET p_omitidos             = 0;

  OPEN cur_jub;
  loop_masivo: LOOP
    FETCH cur_jub INTO v_id_jubilado;
    IF v_done THEN LEAVE loop_masivo; END IF;

    SET v_deudas_sub = 0;
    SET v_fallo = 0;

    BEGIN
      DECLARE CONTINUE HANDLER FOR SQLEXCEPTION SET v_fallo = 1;
      CALL sp_generar_deuda_historica(v_id_jubilado, p_periodo_final, p_porcentaje_pago, p_usuario, v_deudas_sub);
    END;

    IF v_fallo = 1 THEN
      SET p_omitidos = p_omitidos + 1;
    ELSE
      SET p_jubilados_procesados = p_jubilados_procesados + 1;
      SET p_total_deudas         = p_total_deudas + v_deudas_sub;
    END IF;
  END LOOP;
  CLOSE cur_jub;
END$$

DELIMITER ;
