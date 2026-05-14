SELECT
  COALESCE((SELECT COUNT(*) FROM RPJ_PRC_NOMINA_INGRESO WHERE nin_id_planilla = ?), 0) AS cantidad_ingresos,
  COALESCE((SELECT COUNT(*) FROM RPJ_PRC_NOMINA_DESCUENTO WHERE nde_id_planilla = ?), 0) AS cantidad_descuentos;
