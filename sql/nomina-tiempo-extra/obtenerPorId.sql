-- Nómina de Tiempo Extra (planilla tipo 3): una planilla con totales.
SELECT
  p.ppl_correlativo       AS id,
  p.ppl_tipo_planilla     AS tipo_planilla,
  t.tpl_tipo_planilla     AS tipo_planilla_nombre,
  p.ppl_numero            AS numero,
  p.ppl_fecha_inicio      AS fecha_inicio,
  p.ppl_fecha_final       AS fecha_final,
  p.ppl_fecha_pago        AS fecha_pago,
  p.ppl_estado_proceso    AS estado_proceso,
  p.ppl_fecha_generacion  AS fecha_generacion,
  p.ppl_usuario_genera    AS usuario_genera,
  COALESCE(ing.total_empleados, 0)  AS total_empleados,
  COALESCE(ing.total_ingresos,  0)  AS total_ingresos,
  COALESCE(des.total_descuentos, 0) AS total_descuentos,
  COALESCE(ing.total_ingresos, 0) - COALESCE(des.total_descuentos, 0) AS neto_a_pagar
FROM RPJ_CAT_PARAMETRO_PLANILLA p
LEFT JOIN RPJ_CAT_TIPO_PLANILLA t ON t.tpl_id = p.ppl_tipo_planilla
LEFT JOIN (
  SELECT nin_id_planilla,
         COUNT(DISTINCT nin_id_empleado) AS total_empleados,
         SUM(nin_valor)                  AS total_ingresos
  FROM RPJ_PRC_NOMINA_INGRESO
  WHERE nin_id_tipo_planilla = 3 AND nin_tipo_manejo = 1
  GROUP BY nin_id_planilla
) ing ON ing.nin_id_planilla = p.ppl_correlativo
LEFT JOIN (
  SELECT nde_id_planilla,
         SUM(nde_valor) AS total_descuentos
  FROM RPJ_PRC_NOMINA_DESCUENTO
  WHERE nde_id_tipo_planilla = 3 AND nde_tipo_manejo = 1
  GROUP BY nde_id_planilla
) des ON des.nde_id_planilla = p.ppl_correlativo
WHERE p.ppl_correlativo = ?;
