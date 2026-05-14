SELECT
  COALESCE((SELECT SUM(nin_valor) FROM RPJ_PRC_NOMINA_INGRESO WHERE nin_id_planilla = ?), 0) AS total_ingresos,
  COALESCE((SELECT SUM(nde_valor) FROM RPJ_PRC_NOMINA_DESCUENTO WHERE nde_id_planilla = ?), 0) AS total_descuentos,
  COALESCE((SELECT COUNT(*) FROM RPJ_PRC_NOMINA_INGRESO WHERE nin_id_planilla = ?), 0) AS cantidad_ingresos,
  COALESCE((SELECT COUNT(*) FROM RPJ_PRC_NOMINA_DESCUENTO WHERE nde_id_planilla = ?), 0) AS cantidad_descuentos,
  COALESCE((SELECT COUNT(DISTINCT nin_id_empleado) FROM RPJ_PRC_NOMINA_INGRESO WHERE nin_id_planilla = ? AND nin_id_empleado IS NOT NULL), 0) AS cantidad_empleados,
  COALESCE((SELECT COUNT(DISTINCT nin_id_jubilado) FROM RPJ_PRC_NOMINA_INGRESO WHERE nin_id_planilla = ? AND nin_id_jubilado IS NOT NULL), 0) AS cantidad_jubilados;
