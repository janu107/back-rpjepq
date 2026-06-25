-- CAMBIO X: lista de jubilados candidatos a generar, con su elegibilidad.
-- Un jubilado es APTO si tiene datos de planilla, aplica a nómina y tiene
-- salario inicial configurado (el SP exige sal_tipo_ingreso = 1).
SELECT
  j.jub_correlativo                                   AS id_jubilado,
  j.jub_dpi                                           AS dpi,
  CONCAT(j.jub_nombres, ' ', j.jub_apellidos)         AS nombre_completo,
  j.jub_fecha_jubilacion                              AS fecha_jubilacion,
  CASE WHEN dp.tiene_datos > 0 THEN 1 ELSE 0 END      AS tiene_datos,
  COALESCE(dp.aplica_nomina, 0)                       AS aplica_nomina,
  CASE WHEN s.tiene_salario > 0 THEN 1 ELSE 0 END     AS tiene_salario,
  COALESCE(s.pension, 0)                              AS salario_base
FROM RPJ_MNT_JUBILADO j
LEFT JOIN (
  SELECT dat_id_jubilado,
         COUNT(*)               AS tiene_datos,
         MAX(dat_aplica_nomina) AS aplica_nomina
    FROM RPJ_MNT_DATOS_PLANILLA
   WHERE dat_tipo_manejo = 2
   GROUP BY dat_id_jubilado
) dp ON dp.dat_id_jubilado = j.jub_correlativo
LEFT JOIN (
  SELECT sal_id_jubilado,
         COUNT(*)         AS tiene_salario,
         MAX(sal_salario) AS pension
    FROM RPJ_MNT_SALARIO
   WHERE sal_tipo_manejo = 2 AND sal_tipo_ingreso = 1
   GROUP BY sal_id_jubilado
) s ON s.sal_id_jubilado = j.jub_correlativo
WHERE j.jub_tipo_manejo = 2
  AND UPPER(COALESCE(j.jub_estado,'ACTIVO')) <> 'INACTIVO'
ORDER BY nombre_completo ASC;
