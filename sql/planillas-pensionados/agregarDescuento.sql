-- Renglón de descuento agregado a mano desde "Editar montos".
-- Params: [tipo, valor, usuario, idPlanilla, idPersona].
INSERT INTO RPJ_PRC_NOMINA_DESCUENTO (
  nde_tipo_manejo, nde_id_tipo_planilla, nde_id_planilla, nde_id_empleado, nde_id_jubilado,
  nde_id_beneficiario, nde_tipo_descuento, nde_valor, nde_dias_trabajados, nde_puesto, nde_area, nde_usuario_creacion
)
SELECT i.nin_tipo_manejo, i.nin_id_tipo_planilla, i.nin_id_planilla, i.nin_id_empleado, i.nin_id_jubilado,
       i.nin_id_beneficiario, ?, ?, i.nin_dias_trabajados, i.nin_puesto, i.nin_area, ?
  FROM RPJ_PRC_NOMINA_INGRESO i
 WHERE i.nin_id_planilla = ? AND i.nin_id_jubilado = ?
 ORDER BY i.nin_correlativo
 LIMIT 1;
