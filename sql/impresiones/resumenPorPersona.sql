-- Reporte de resumen (punto 17): totales por persona y planilla, en un rango de
-- fechas de pago y para un tipo de manejo (1 = régimen, 2 = jubilados).
--
-- El agrupamiento POR ÁREA se hace en el servicio, no aquí: el área se resuelve
-- con areasPorEmpleado.sql, de modo que un catálogo de áreas incompleto no
-- tumbe el reporte entero.
--
-- Los descuentos se agregan POR PERSONA Y PLANILLA (no por planilla completa),
-- porque de lo contrario el total de descuentos de la planilla se restaría
-- íntegro a cada área.
-- Params: [tipoManejo, fechaDesde, fechaHasta].
SELECT
  ni.nin_id_empleado                               AS id_empleado,
  ni.nin_id_jubilado                               AS id_jubilado,
  COALESCE(ni.nin_id_empleado, ni.nin_id_jubilado) AS persona,
  ni.nin_id_planilla                               AS id_planilla,
  SUM(ni.nin_valor)                                AS nominal,
  COALESCE(MAX(des.total), 0)                      AS descuentos
FROM RPJ_PRC_NOMINA_INGRESO ni
INNER JOIN RPJ_CAT_PARAMETRO_PLANILLA pp ON pp.ppl_correlativo = ni.nin_id_planilla
LEFT JOIN (
  SELECT nde_id_planilla,
         COALESCE(nde_id_empleado, nde_id_jubilado) AS persona,
         SUM(nde_valor) AS total
    FROM RPJ_PRC_NOMINA_DESCUENTO
   GROUP BY nde_id_planilla, persona
) des ON des.nde_id_planilla = ni.nin_id_planilla
     AND des.persona = COALESCE(ni.nin_id_empleado, ni.nin_id_jubilado)
WHERE ni.nin_tipo_manejo = ?
  AND pp.ppl_fecha_pago BETWEEN ? AND ?
GROUP BY ni.nin_id_empleado, ni.nin_id_jubilado, persona, ni.nin_id_planilla;
