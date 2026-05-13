UPDATE RPJ_PRC_NOMINA_INGRESO
SET
  nin_tipo_manejo = ?,
  nin_id_tipo_planilla = ?,
  nin_id_planilla = ?,
  nin_id_empleado = ?,
  nin_id_jubilado = ?,
  nin_tipo_ingreso = ?,
  nin_valor = ?,
  nin_dias_trabajados = ?,
  nin_puesto = ?,
  nin_area = ?
WHERE nin_correlativo = ?;
