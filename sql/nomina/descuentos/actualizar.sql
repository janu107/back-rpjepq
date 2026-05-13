UPDATE RPJ_PRC_NOMINA_DESCUENTO
SET
  nde_tipo_manejo = ?,
  nde_id_tipo_planilla = ?,
  nde_id_planilla = ?,
  nde_id_empleado = ?,
  nde_id_jubilado = ?,
  nde_tipo_descuento = ?,
  nde_valor = ?,
  nde_dias_trabajados = ?,
  nde_puesto = ?,
  nde_area = ?
WHERE nde_correlativo = ?;
