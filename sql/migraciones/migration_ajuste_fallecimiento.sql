-- ============================================================================
-- Ajuste de la deuda al registrar un fallecimiento (2026-11-03):
--   * El mes del fallecimiento se calcula proporcional a los días vividos
--     (mes de 30 días): pensión y descuentos × días / 30.
--   * Los meses POSTERIORES que solo eran deuda (sin planilla pagada con su código
--     y sin abonos) se borran: ya no se le deben.
-- Se guarda aquí lo que se cambió para poder restaurarlo si se corrige la fecha o
-- se revierte el fallecimiento. Idempotente.
-- ============================================================================
CREATE TABLE IF NOT EXISTS RPJ_PRC_AJUSTE_FALLECIMIENTO (
  afa_correlativo       INT AUTO_INCREMENT PRIMARY KEY,
  afa_id_jubilado       INT NOT NULL,
  afa_fecha_fallecimiento DATE NOT NULL,
  afa_detalle           LONGTEXT NOT NULL,
  afa_estado            ENUM('VIGENTE','REVERTIDO') NOT NULL DEFAULT 'VIGENTE',
  afa_fecha_creacion    TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  afa_usuario_creacion  VARCHAR(50) NOT NULL,
  afa_fecha_reversion   DATETIME NULL,
  KEY idx_afa_jubilado (afa_id_jubilado)
);
