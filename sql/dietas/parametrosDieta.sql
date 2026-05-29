-- Version IV: parametros base para el calculo de dietas.
-- VALOR = par_pago_dieta * sesiones, RETENCION = VALOR * par_isr / 100, LIQUIDO = VALOR - RETENCION.
SELECT
  par_pago_dieta,
  par_isr
FROM RPJ_CAT_PARAMETRO_GENERAL
ORDER BY par_id ASC
LIMIT 1;
