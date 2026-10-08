-- Renglón de ingreso agregado a mano desde "Editar montos".
INSERT INTO RPJ_PRC_NOMINA_INGRESO (
  nin_tipo_manejo, nin_id_tipo_planilla, nin_id_planilla, nin_id_empleado, nin_id_jubilado,
  nin_id_beneficiario, nin_tipo_ingreso, nin_valor, nin_valor_teorico, nin_porcentaje_aplicado,
  nin_pago_corriente, nin_abono_historico, nin_dias_trabajados, nin_puesto, nin_area, nin_usuario_creacion
)
SELECT i.nin_tipo_manejo, i.nin_id_tipo_planilla, i.nin_id_planilla, i.nin_id_empleado, i.nin_id_jubilado,
       i.nin_id_beneficiario, ?, ?, ?, 100.00,
       ?, 0.00, i.nin_dias_trabajados, i.nin_puesto, i.nin_area, ?
  FROM RPJ_PRC_NOMINA_INGRESO i
 WHERE i.nin_id_planilla = ? AND i.nin_id_empleado = ?
 ORDER BY i.nin_correlativo
 LIMIT 1;
