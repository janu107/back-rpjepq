-- CAMBIO X: actualiza el valor de un renglón de descuento de un empleado.
UPDATE RPJ_PRC_NOMINA_DESCUENTO
   SET nde_valor = ?
 WHERE nde_correlativo = ?
   AND nde_id_planilla = ?
   AND nde_id_empleado = ?
   AND nde_tipo_manejo = 1;
