-- Reporte de resumen (mejora 17): desglose por concepto (sueldos, tiempo extra,
-- bono vacacional, aguinaldo, bono 14) para un rango de fechas de pago y un tipo
-- de manejo (1 = régimen, 2 = jubilados). Params: [tipoManejo, fechaDesde, fechaHasta].
SELECT
  CASE
    WHEN ni.nin_id_tipo_planilla = 3      THEN 'TIEMPO EXTRA'
    WHEN ni.nin_id_tipo_planilla IN (5,6) THEN 'BONO 14'
    WHEN ni.nin_id_tipo_planilla IN (7,8) THEN 'AGUINALDO'
    WHEN ni.nin_id_tipo_planilla = 9      THEN 'BONO VACACIONAL'
    ELSE 'SUELDOS'
  END AS concepto,
  COUNT(DISTINCT COALESCE(ni.nin_id_empleado, ni.nin_id_jubilado)) AS personas,
  SUM(ni.nin_valor) AS nominal
FROM RPJ_PRC_NOMINA_INGRESO ni
INNER JOIN RPJ_CAT_PARAMETRO_PLANILLA pp ON pp.ppl_correlativo = ni.nin_id_planilla
WHERE ni.nin_tipo_manejo = ?
  AND pp.ppl_fecha_pago BETWEEN ? AND ?
GROUP BY concepto
ORDER BY concepto;
