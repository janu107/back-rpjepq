-- Instala únicamente el reverso completo de pensionados (planillas tipo 2 y 4).
-- Corrige ER_SP_DOES_NOT_EXIST al llamar sp_reversar_planilla_pensionados.
-- Ejecutar sobre la base configurada en .env:
--   node scripts/runSqlFile.js sql/migraciones/migration_instalar_reverso_pensionados.sql
-- No ejecuta reversos ni modifica pagos al instalarse. Puede repetirse.

CREATE TABLE IF NOT EXISTS RPJ_LOG_REVERSOS (
    lre_correlativo INT AUTO_INCREMENT PRIMARY KEY,
    lre_id_planilla INT NOT NULL,
    lre_id_jubilado INT NULL,
    lre_motivo VARCHAR(250) NOT NULL,
    lre_usuario VARCHAR(50) NOT NULL,
    lre_fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_lre_planilla FOREIGN KEY (lre_id_planilla)
        REFERENCES RPJ_CAT_PARAMETRO_PLANILLA(ppl_correlativo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP PROCEDURE IF EXISTS sp_reversar_planilla_pensionados;
DELIMITER $$
CREATE PROCEDURE sp_reversar_planilla_pensionados(
    IN p_id_planilla INT,
    IN p_usuario VARCHAR(50),
    IN p_motivo VARCHAR(250)
)
BEGIN
    DECLARE v_estado VARCHAR(20);

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;

    SELECT ppl_estado_proceso INTO v_estado
      FROM RPJ_CAT_PARAMETRO_PLANILLA
     WHERE ppl_correlativo = p_id_planilla
       FOR UPDATE;

    IF v_estado IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Planilla no encontrada';
    END IF;
    IF v_estado != 'GENERADA' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Solo se pueden reversar planillas GENERADAS';
    END IF;

    -- Restaurar los abonos históricos registrados por esta planilla.
    UPDATE RPJ_PRC_DEUDA_JUBILADO d
    INNER JOIN RPJ_PRC_APLICACION_PAGO a ON a.apa_id_deuda = d.deu_correlativo
       SET d.deu_monto_pagado = d.deu_monto_pagado - a.apa_monto_aplicado,
           d.deu_monto_pendiente = d.deu_monto_pendiente + a.apa_monto_aplicado,
           d.deu_estado = CASE
               WHEN d.deu_monto_pagado - a.apa_monto_aplicado <= 0 THEN 'PENDIENTE'
               ELSE 'PARCIAL'
           END,
           d.deu_fecha_saldada = NULL
     WHERE a.apa_id_planilla = p_id_planilla;

    -- Mismo modelo de jubilados que utiliza la generación de nómina.
    UPDATE RPJ_MNT_PRESTAMOS_REGIMEN p
    INNER JOIN RPJ_PRC_NOMINA_DESCUENTO n ON n.nde_id_jubilado = p.prr_id_jubilado
       SET p.prr_saldo = p.prr_saldo + n.nde_valor,
           p.prr_estado = 'ACTIVO'
     WHERE n.nde_id_planilla = p_id_planilla
       AND p.prr_tipo_manejo = 2
       AND n.nde_tipo_descuento IN (5, 6, 7);

    UPDATE RPJ_MNT_DESC_JUDICIALES j
    INNER JOIN RPJ_PRC_NOMINA_DESCUENTO n ON n.nde_id_jubilado = j.dju_id_jubilado
       SET j.dju_saldo = j.dju_saldo + n.nde_valor,
           j.dju_estado = 'ACTIVO'
     WHERE n.nde_id_planilla = p_id_planilla
       AND j.dju_tipo_manejo = 2
       AND n.nde_tipo_descuento = 4;

    DELETE FROM RPJ_PRC_APLICACION_PAGO WHERE apa_id_planilla = p_id_planilla;
    DELETE FROM RPJ_PRC_NOMINA_DESCUENTO
     WHERE nde_id_planilla = p_id_planilla AND nde_tipo_manejo = 2;
    DELETE FROM RPJ_PRC_NOMINA_INGRESO
     WHERE nin_id_planilla = p_id_planilla AND nin_tipo_manejo = 2;

    UPDATE RPJ_CAT_PARAMETRO_PLANILLA
       SET ppl_estado_proceso = 'REVERSADA'
     WHERE ppl_correlativo = p_id_planilla;

    -- Columnas comunes a la bitácora original y a su versión ampliada.
    INSERT INTO RPJ_LOG_REVERSOS (lre_id_planilla, lre_motivo, lre_usuario)
    VALUES (p_id_planilla, p_motivo, p_usuario);

    COMMIT;
    SELECT 'Planilla de pensionados reversada correctamente' AS resultado;
END
$$
DELIMITER ;

SELECT ROUTINE_NAME AS procedimiento_instalado
  FROM information_schema.ROUTINES
 WHERE ROUTINE_SCHEMA = DATABASE()
   AND ROUTINE_NAME = 'sp_reversar_planilla_pensionados';
