-- ============================================================================
-- Mes de la deuda pagado fuera del sistema (2026-11-03).
-- La tabla de cancelaciones ahora distingue:
--   TOTAL: toda la deuda del fallecido (Fallecimientos → Deuda pagada).
--   MES:   un solo mes (Estado de cuenta → marcar mes como pagado), por ejemplo
--          enero 2023 cuando la deuda de todos pasó a empezar en 202302.
-- Idempotente.
-- ============================================================================
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'RPJ_PRC_CANCELACION_DEUDA' AND COLUMN_NAME = 'cde_tipo');
SET @s := IF(@c = 0, "ALTER TABLE RPJ_PRC_CANCELACION_DEUDA ADD COLUMN cde_tipo ENUM('TOTAL','MES') NOT NULL DEFAULT 'TOTAL' AFTER cde_id_jubilado", 'SELECT 1');
PREPARE st FROM @s;
EXECUTE st;
DEALLOCATE PREPARE st;
