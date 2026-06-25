-- CAMBIO X: actualiza el valor de un renglón de ingreso de un jubilado.
-- nin_pago_corriente se mantiene consistente (= valor - abono histórico, que
-- está ligado a la deuda y no se altera aquí).
UPDATE RPJ_PRC_NOMINA_INGRESO
   SET nin_valor          = ?,
       nin_pago_corriente = GREATEST(? - nin_abono_historico, 0)
 WHERE nin_correlativo = ?
   AND nin_id_planilla = ?
   AND nin_id_jubilado = ?
   AND nin_tipo_manejo = 2;
