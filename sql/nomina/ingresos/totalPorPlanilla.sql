SELECT
  COALESCE(SUM(nin_valor), 0) AS total_ingresos,
  COUNT(*) AS cantidad_ingresos
FROM RPJ_PRC_NOMINA_INGRESO
WHERE nin_id_planilla = ?;
