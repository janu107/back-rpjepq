-- Impresión de nómina de sueldos (empleados de régimen), agrupable por área.
-- El área NO viene del renglón de nómina (nin_area guarda la constante
-- 'TRABAJADORES'): se resuelve por el puesto del empleado
-- (RPJ_MNT_EMPLEADO -> RPJ_CAT_PUESTO -> RPJ_CAT_AREA).
-- Ingresos y descuentos se agregan por separado para no multiplicar renglones.
-- Params: [idPlanilla, idPlanilla].
SELECT
  e.emp_correlativo                              AS id_empleado,
  e.emp_id                                       AS codigo,
  CONCAT(e.emp_nombres, ' ', e.emp_apellidos)    AS nombre,
  COALESCE(ar.are_descripcion, 'SIN AREA')       AS area,
  e.emp_fecha_ingreso                            AS fecha_inicio_labor,
  COALESCE(pu.pue_nombre, ing.puesto, e.emp_profesion_oficio) AS cargo,
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
  SELECT nde_id_empleado,
         SUM(CASE WHEN nde_tipo_descuento = 1 THEN nde_valor ELSE 0 END) AS igss,
         SUM(CASE WHEN nde_tipo_descuento = 2 THEN nde_valor ELSE 0 END) AS isr,
         SUM(CASE WHEN nde_tipo_descuento IN (3, 4, 8) THEN nde_valor ELSE 0 END) AS judicial_otros,
         SUM(CASE WHEN nde_tipo_descuento IN (5, 6, 7, 9) THEN nde_valor ELSE 0 END) AS prestamos,
         SUM(nde_valor) AS total_descuentos
    FROM RPJ_PRC_NOMINA_DESCUENTO
   WHERE nde_id_planilla = ? AND nde_id_empleado IS NOT NULL
   GROUP BY nde_id_empleado
) des ON des.nde_id_empleado = e.emp_correlativo
LEFT JOIN RPJ_CAT_PUESTO pu ON pu.pue_id = e.emp_id_puesto
LEFT JOIN RPJ_CAT_AREA   ar ON ar.are_id = pu.pue_id_area

ORDER BY area, e.emp_apellidos, e.emp_nombres;
