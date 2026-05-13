SELECT
  ? AS id_empleado,
  COALESCE((SELECT SUM(nin_valor) FROM RPJ_PRC_NOMINA_INGRESO WHERE nin_id_empleado = ?), 0) AS total_ingresos,
  COALESCE((SELECT SUM(nde_valor) FROM RPJ_PRC_NOMINA_DESCUENTO WHERE nde_id_empleado = ?), 0) AS total_descuentos,
  COALESCE((SELECT COUNT(*) FROM RPJ_PRC_NOMINA_INGRESO WHERE nin_id_empleado = ?), 0) AS cantidad_ingresos,
  COALESCE((SELECT COUNT(*) FROM RPJ_PRC_NOMINA_DESCUENTO WHERE nde_id_empleado = ?), 0) AS cantidad_descuentos;
