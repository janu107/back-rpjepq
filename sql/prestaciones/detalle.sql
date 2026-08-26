-- Prestaciones: detalle por empleado de una planilla (sección 6.1 / 9.1 del spec).
-- nin_dias_trabajados = días del período (Bono 14 / Aguinaldo) o días de
-- antigüedad (Bono Vacacional). Params: [idPlanilla].
SELECT
  ni.nin_correlativo                           AS id_linea,
  e.emp_correlativo                            AS id_empleado,
  e.emp_dpi                                    AS dpi,
  CONCAT(e.emp_nombres, ' ', e.emp_apellidos)  AS nombre_completo,
  e.emp_fecha_ingreso                          AS fecha_ingreso,
  ni.nin_puesto                                AS puesto,
  ni.nin_dias_trabajados                       AS dias,
  ni.nin_valor_teorico                         AS salario_base,
  ni.nin_porcentaje_aplicado                   AS porcentaje,
  ni.nin_valor                                 AS monto,
  ni.nin_usuario_creacion                      AS usuario,
  ni.nin_fecha_creacion                        AS fecha
FROM RPJ_PRC_NOMINA_INGRESO ni
INNER JOIN RPJ_MNT_EMPLEADO e ON e.emp_correlativo = ni.nin_id_empleado
WHERE ni.nin_id_planilla = ?
  AND ni.nin_id_tipo_planilla IN (5, 7, 9)
  AND ni.nin_tipo_manejo = 1
ORDER BY e.emp_apellidos, e.emp_nombres;
