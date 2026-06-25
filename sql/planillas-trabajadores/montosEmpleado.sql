-- CAMBIO X: renglones de ingreso y descuento de un empleado en una planilla,
-- para edición de montos mientras la planilla no esté cerrada.
SELECT 'INGRESO' AS clase,
       i.nin_correlativo        AS id,
       COALESCE(ti.tin_tipo_ingreso, 'INGRESO') AS concepto,
       i.nin_valor              AS valor
  FROM RPJ_PRC_NOMINA_INGRESO i
  LEFT JOIN RPJ_CAT_TIPO_INGRESO ti ON ti.tin_id = i.nin_tipo_ingreso
 WHERE i.nin_id_planilla = ? AND i.nin_id_empleado = ? AND i.nin_tipo_manejo = 1
UNION ALL
SELECT 'DESCUENTO',
       d.nde_correlativo,
       COALESCE(td.tde_tipo_descuento, 'DESCUENTO'),
       d.nde_valor
  FROM RPJ_PRC_NOMINA_DESCUENTO d
  LEFT JOIN RPJ_CAT_TIPO_DESCUENTO td ON td.tde_id = d.nde_tipo_descuento
 WHERE d.nde_id_planilla = ? AND d.nde_id_empleado = ? AND d.nde_tipo_manejo = 1
ORDER BY clase, id;
