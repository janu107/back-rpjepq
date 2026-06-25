-- CAMBIO X: actualiza el valor de un renglón de descuento de un jubilado.
UPDATE RPJ_PRC_NOMINA_DESCUENTO
   SET nde_valor = ?
 WHERE nde_correlativo = ?
   AND nde_id_planilla = ?
   AND nde_id_jubilado = ?
   AND nde_tipo_manejo = 2;
