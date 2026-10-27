-- Tiempo extraordinario: el período trabajado es el MES ANTERIOR a la fecha de pago
-- (pago quincenal). Ej.: pago 15/10/2026 -> 01/09/2026 al 30/09/2026.
-- Ajusta los registros existentes. Idempotente.
UPDATE RPJ_MNT_TIEMPO_EXTRAORDINARIO
   SET tex_fecha_hora_inicio = DATE_FORMAT(DATE_SUB(tex_fecha_pago, INTERVAL 1 MONTH), '%Y-%m-01'),
       tex_fecha_hora_final  = LAST_DAY(DATE_SUB(tex_fecha_pago, INTERVAL 1 MONTH))
 WHERE tex_fecha_pago IS NOT NULL;
