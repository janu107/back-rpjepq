-- CAMBIO X: lista de empleados régimen candidatos a generar, con su elegibilidad.
-- Un empleado es APTO si tiene datos de planilla y aplica a nómina.
-- Se informa además si tiene salario configurado (si no, generaría Q0.00).
SELECT
  e.emp_correlativo                                   AS id_empleado,
  e.emp_dpi                                           AS dpi,
  CONCAT(e.emp_nombres, ' ', e.emp_apellidos)         AS nombre_completo,
  e.emp_profesion_oficio                              AS puesto,
  e.emp_fecha_ingreso                                 AS fecha_ingreso,
  CASE WHEN dp.tiene_datos > 0 THEN 1 ELSE 0 END      AS tiene_datos,
  COALESCE(dp.aplica_nomina, 0)                       AS aplica_nomina,
  CASE WHEN sal.tiene_salario > 0 THEN 1 ELSE 0 END   AS tiene_salario,
  -- salario base = primer renglón de salario por correlativo (igual que el SP)
  COALESCE((SELECT s2.sal_salario FROM RPJ_MNT_SALARIO s2
             WHERE s2.sal_id_empleado = e.emp_correlativo AND s2.sal_tipo_manejo = 1
             ORDER BY s2.sal_correlativo ASC LIMIT 1), 0) AS salario_base
FROM RPJ_MNT_EMPLEADO e
LEFT JOIN (
  SELECT dat_id_empleado,
         COUNT(*)                AS tiene_datos,
         MAX(dat_aplica_nomina)  AS aplica_nomina
    FROM RPJ_MNT_DATOS_PLANILLA
   WHERE dat_tipo_manejo = 1
   GROUP BY dat_id_empleado
) dp ON dp.dat_id_empleado = e.emp_correlativo
LEFT JOIN (
  SELECT sal_id_empleado,
         COUNT(*) AS tiene_salario
    FROM RPJ_MNT_SALARIO
   WHERE sal_tipo_manejo = 1
   GROUP BY sal_id_empleado
) sal ON sal.sal_id_empleado = e.emp_correlativo
WHERE e.emp_tipo_manejo = 1
  AND UPPER(COALESCE(e.emp_estado,'ACTIVO')) <> 'INACTIVO'
ORDER BY nombre_completo ASC;
