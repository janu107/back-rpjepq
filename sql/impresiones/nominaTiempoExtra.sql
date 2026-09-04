-- Impresión de nómina de tiempo extraordinario (empleados de régimen), por área.
-- En los renglones de tiempo extra: nin_dias_trabajados = cantidad de horas y
-- nin_valor_teorico = valor de la hora extra (salario/30/8 x multiplicador).
-- El salario mensual se toma de RPJ_MNT_SALARIO, no del renglón.
-- Params: [idPlanilla, idPlanilla].
SELECT
  e.emp_correlativo                           AS id_empleado,
  e.emp_id                                    AS codigo,
  CONCAT(e.emp_nombres, ' ', e.emp_apellidos) AS nombre,
  COALESCE(ar.are_descripcion, 'SIN AREA')    AS area,
  COALESCE(pu.pue_nombre, ing.puesto, e.emp_profesion_oficio) AS cargo,
  COALESCE(sal.salario, 0)                    AS salario_mensual,
  COALESCE(ing.valor_hora_normal, 0)          AS valor_hora_normal,
  COALESCE(ing.horas_normales, 0)             AS horas_normales,
  COALESCE(ing.total_normal, 0)               AS total_normal,
  COALESCE(ing.valor_hora_doble, 0)           AS valor_hora_doble,
  COALESCE(ing.horas_dobles, 0)               AS horas_dobles,
  COALESCE(ing.total_doble, 0)                AS total_doble,
  COALESCE(ing.total_ingresos, 0)             AS total,
  COALESCE(des.igss, 0)                       AS igss,
  COALESCE(des.total_descuentos, 0)           AS total_descuentos,
  COALESCE(ing.total_ingresos, 0) - COALESCE(des.total_descuentos, 0) AS liquido
FROM RPJ_MNT_EMPLEADO e
INNER JOIN (
  SELECT nin_id_empleado,
         MAX(nin_puesto) AS puesto,
         MAX(CASE WHEN nin_tipo_ingreso = 9  THEN nin_valor_teorico END) AS valor_hora_normal,
         SUM(CASE WHEN nin_tipo_ingreso = 9  THEN nin_dias_trabajados ELSE 0 END) AS horas_normales,
         SUM(CASE WHEN nin_tipo_ingreso = 9  THEN nin_valor ELSE 0 END) AS total_normal,
         MAX(CASE WHEN nin_tipo_ingreso = 10 THEN nin_valor_teorico END) AS valor_hora_doble,
         SUM(CASE WHEN nin_tipo_ingreso = 10 THEN nin_dias_trabajados ELSE 0 END) AS horas_dobles,
         SUM(CASE WHEN nin_tipo_ingreso = 10 THEN nin_valor ELSE 0 END) AS total_doble,
         SUM(nin_valor) AS total_ingresos
    FROM RPJ_PRC_NOMINA_INGRESO
   WHERE nin_id_planilla = ? AND nin_id_empleado IS NOT NULL
   GROUP BY nin_id_empleado
) ing ON ing.nin_id_empleado = e.emp_correlativo
LEFT JOIN (
  SELECT nde_id_empleado,
         SUM(CASE WHEN nde_tipo_descuento = 1 THEN nde_valor ELSE 0 END) AS igss,
         SUM(nde_valor) AS total_descuentos
    FROM RPJ_PRC_NOMINA_DESCUENTO
   WHERE nde_id_planilla = ? AND nde_id_empleado IS NOT NULL
   GROUP BY nde_id_empleado
) des ON des.nde_id_empleado = e.emp_correlativo
LEFT JOIN (
  SELECT s.sal_id_empleado, s.sal_salario AS salario
    FROM RPJ_MNT_SALARIO s
   WHERE s.sal_tipo_manejo = 1
     AND s.sal_correlativo = (
       SELECT MIN(s2.sal_correlativo) FROM RPJ_MNT_SALARIO s2
        WHERE s2.sal_id_empleado = s.sal_id_empleado AND s2.sal_tipo_manejo = 1)
) sal ON sal.sal_id_empleado = e.emp_correlativo
LEFT JOIN RPJ_CAT_PUESTO pu ON pu.pue_id = e.emp_id_puesto
LEFT JOIN RPJ_CAT_AREA   ar ON ar.are_id = pu.pue_id_area
ORDER BY area, e.emp_apellidos, e.emp_nombres;
