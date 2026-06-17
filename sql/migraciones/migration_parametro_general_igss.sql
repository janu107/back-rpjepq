-- ============================================================
-- MIGRACIÓN: Agregar columnas IGSS / IGSS Patronal / INTECAP
-- a RPJ_CAT_PARAMETRO_GENERAL
-- Base de datos: apps_rpjepq
-- Idempotente (IF NOT EXISTS)
-- ============================================================

ALTER TABLE RPJ_CAT_PARAMETRO_GENERAL
  ADD COLUMN IF NOT EXISTS par_igss          DECIMAL(5,2) NOT NULL DEFAULT 0.00 AFTER par_pago_dieta,
  ADD COLUMN IF NOT EXISTS par_igss_patronal DECIMAL(5,2) NOT NULL DEFAULT 0.00 AFTER par_igss,
  ADD COLUMN IF NOT EXISTS par_intecap       DECIMAL(5,2) NOT NULL DEFAULT 0.00 AFTER par_igss_patronal;
