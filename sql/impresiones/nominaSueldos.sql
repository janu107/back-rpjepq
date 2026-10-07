-- Impresión de nómina de sueldos (empleados de régimen).
-- El área NO se resuelve aquí: se agrega después con areasPorEmpleado.sql, para
-- que un catálogo de áreas incompleto no tumbe el reporte completo.
-- Los descuentos se clasifican por NOMBRE del catalogo (no por id fijo): los ids
-- difieren entre ambientes y un id equivocado dejaba el I.G.S.S. en cero.
-- Ingresos y descuentos se agregan por separado para no multiplicar renglones.
-- Params: [idPlanilla, idPlanilla].
SELECT
  e.emp_correlativo                              AS id_empleado,
  e.emp_id                                       AS codigo,
  CONCAT(e.emp_nombres, ' ', e.emp_apellidos)    AS nombre,
  e.emp_apellidos                                AS apellidos,
  e.emp_fecha_ingreso                            AS fecha_inicio_labor,
  COALESCE(ing.puesto, e.emp_profesion_oficio)   AS cargo,
  COALESCE(ing.dias, 0)                          AS dias,
  COALESCE(ing.sueldo, 0)                        AS sueldo,
  COALESCE(ing.bonif_incentivo, 0)               AS bonif_incentivo,
  COALESCE(ing.bonif_productividad, 0)           AS bonif_productividad,
  COALESCE(ing.otros_ingresos, 0)                AS otros_ingresos,
  COALESCE(ing.total_ingresos, 0)                AS total_ingresos,
  COALESCE(des.igss, 0)                          AS igss,
  COALESCE(des.isr, 0)                           AS isr,
  COALESCE(des.judicial_otros, 0)                AS judicial_otros,
  COALESCE(des.prestamos, 0)                     AS prestamos,
  COALESCE(des.total_descuentos, 0)              AS total_descuentos,
  COALESCE(ing.total_ingresos, 0) - COALESCE(des.total_descuentos, 0) AS liquido
FROM RPJ_MNT_EMPLEADO e
INNER JOIN (
  SELECT nin_id_empleado,
         MAX(nin_dias_trabajados) AS dias,
         MAX(nin_puesto)          AS puesto,
         SUM(CASE WHEN nin_tipo_ingreso = 1 THEN nin_valor ELSE 0 END) AS sueldo,
         SUM(CASE WHEN nin_tipo_ingreso = 2 THEN nin_valor ELSE 0 END) AS bonif_incentivo,
         SUM(CASE WHEN nin_tipo_ingreso = 3 THEN nin_valor ELSE 0 END) AS bonif_productividad,
         SUM(CASE WHEN nin_tipo_ingreso NOT IN (1, 2, 3) THEN nin_valor ELSE 0 END) AS otros_ingresos,
         SUM(nin_valor) AS total_ingresos
    FROM RPJ_PRC_NOMINA_INGRESO
   WHERE nin_id_planilla = ? AND nin_id_empleado IS NOT NULL
   GROUP BY nin_id_empleado
) ing ON ing.nin_id_empleado = e.emp_correlativo
LEFT JOIN (
  SELECT d.nde_id_empleado,
         SUM(CASE WHEN UPPER(t.tde_tipo_descuento) = 'IGSS' THEN d.nde_valor ELSE 0 END) AS igss,
         SUM(CASE WHEN UPPER(t.tde_tipo_descuento) = 'ISR' THEN d.nde_valor ELSE 0 END) AS isr,
         SUM(CASE WHEN UPPER(t.tde_tipo_descuento) NOT IN ('IGSS', 'ISR')
                   AND UPPER(t.tde_tipo_descuento) NOT LIKE 'PRESTAMO%' THEN d.nde_valor ELSE 0 END) AS judicial_otros,
         SUM(CASE WHEN UPPER(t.tde_tipo_descuento) LIKE 'PRESTAMO%' THEN d.nde_valor ELSE 0 END) AS prestamos,
         SUM(d.nde_valor) AS total_descuentos
    FROM RPJ_PRC_NOMINA_DESCUENTO d
    LEFT JOIN RPJ_CAT_TIPO_DESCUENTO t ON t.tde_id = d.nde_tipo_descuento
   WHERE d.nde_id_planilla = ? AND d.nde_id_empleado IS NOT NULL
   GROUP BY d.nde_id_empleado
) des ON des.nde_id_empleado = e.emp_correlativo
ORDER BY e.emp_apellidos, e.emp_nombres;
