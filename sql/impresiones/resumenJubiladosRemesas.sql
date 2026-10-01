-- Resumen de nómina de jubilados, bloque REMESAS: lo que se traslada a cada
-- destino (bancos, descuento judicial, asociación) en una planilla.
--
-- Se agrupa por el nombre del tipo de descuento tal como está en
-- RPJ_CAT_TIPO_DESCUENTO, para que si mañana se agrega un tipo nuevo aparezca
-- solo en el reporte en vez de quedar fuera.
-- Params: [idPlanilla].
SELECT
  COALESCE(td.tde_tipo_descuento, CONCAT('TIPO ', d.nde_tipo_descuento)) AS concepto,
  COUNT(*)           AS cantidad,
  SUM(d.nde_valor)   AS monto
FROM RPJ_PRC_NOMINA_DESCUENTO d
LEFT JOIN RPJ_CAT_TIPO_DESCUENTO td ON td.tde_id = d.nde_tipo_descuento
WHERE d.nde_id_planilla = ?
GROUP BY concepto
ORDER BY concepto;
