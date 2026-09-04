-- Reporte de resumen (mejora 17): totales NOMINAL y LIQUIDO por área, para un
-- rango de fechas de pago y un tipo de manejo (1 = régimen, 2 = jubilados).
--
-- Los descuentos se agregan POR PERSONA Y PLANILLA (no por planilla completa),
-- porque de lo contrario el total de descuentos de la planilla se restaría
-- íntegro a cada área.
--
-- El área sale del puesto del empleado; los jubilados no tienen puesto, así que
-- se agrupan bajo la etiqueta 'JUBILADOS'.
-- Params: [tipoManejo, tipoManejo, fechaDesde, fechaHasta].
SELECT
  x.area,
  COUNT(DISTINCT x.persona) AS personas,
  SUM(x.nominal)      AS nominal,
  SUM(x.descuentos)   AS descuentos,
  SUM(x.nominal) - SUM(x.descuentos) AS liquido
FROM (
  SELECT
    CASE WHEN ? = 2 THEN 'JUBILADOS' ELSE COALESCE(ar.are_descripcion, 'SIN AREA') END AS area,
    ni.nin_id_planilla,
    COALESCE(ni.nin_id_empleado, ni.nin_id_jubilado) AS persona,
    SUM(ni.nin_valor) AS nominal,
    COALESCE(MAX(des.total), 0) AS descuentos
  FROM RPJ_PRC_NOMINA_INGRESO ni
  INNER JOIN RPJ_CAT_PARAMETRO_PLANILLA pp ON pp.ppl_correlativo = ni.nin_id_planilla
  LEFT JOIN RPJ_MNT_EMPLEADO e ON e.emp_correlativo = ni.nin_id_empleado
  LEFT JOIN RPJ_CAT_PUESTO  pu ON pu.pue_id = e.emp_id_puesto
  LEFT JOIN RPJ_CAT_AREA    ar ON ar.are_id = pu.pue_id_area
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
  GROUP BY area, ni.nin_id_planilla, persona
) x
GROUP BY x.area
ORDER BY x.area;
