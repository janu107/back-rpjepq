-- Dietas maestro-detalle: parámetros VIGENTES (último registro) para el cálculo.
-- VALOR = par_pago_dieta * sesiones, RETENCION = VALOR * par_isr / 100.
SELECT par_pago_dieta, par_isr
FROM RPJ_CAT_PARAMETRO_GENERAL
ORDER BY par_id DESC
LIMIT 1;
