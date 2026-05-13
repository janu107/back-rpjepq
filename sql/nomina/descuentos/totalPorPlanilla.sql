SELECT
  COALESCE(SUM(nde_valor), 0) AS total_descuentos,
  COUNT(*) AS cantidad_descuentos
FROM RPJ_PRC_NOMINA_DESCUENTO
WHERE nde_id_planilla = ?;
