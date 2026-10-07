-- Resumen de nómina de jubilados, bloque REMESAS: lo que se traslada a cada
-- destino (bancos, descuento judicial, asociación) en una planilla.
--
-- Se agrupa por el nombre del tipo de descuento tal como está en
-- RPJ_CAT_TIPO_DESCUENTO, para que si mañana se agrega un tipo nuevo aparezca
-- solo en el reporte en vez de quedar fuera.
-- Filtro opcional por tipo de jubilacion (nombre del catalogo); NULL = todos.
-- Params: [idPlanilla, tipo, tipo].
SELECT
  COALESCE(td.tde_tipo_descuento, CONCAT('TIPO ', d.nde_tipo_descuento)) AS concepto,
  COUNT(*)           AS cantidad,
  SUM(d.nde_valor)   AS monto
FROM RPJ_PRC_NOMINA_DESCUENTO d
LEFT JOIN RPJ_CAT_TIPO_DESCUENTO td ON td.tde_id = d.nde_tipo_descuento
LEFT JOIN RPJ_MNT_JUBILADO j ON j.jub_correlativo = d.nde_id_jubilado
LEFT JOIN RPJ_CAT_TIPO_JUBILACION tj ON tj.tju_id = j.jub_tipo_jubilacion
WHERE d.nde_id_planilla = ?
  AND (? IS NULL OR UPPER(tj.tju_descripcion) = ?)
GROUP BY concepto
ORDER BY concepto;
