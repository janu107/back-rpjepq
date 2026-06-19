SELECT
  (SELECT COUNT(*) FROM RPJ_MNT_JUBILADO
   WHERE jub_tipo_manejo = 2 AND UPPER(COALESCE(jub_estado,'')) = 'ACTIVO')                               AS total_activos,
  (SELECT COUNT(DISTINCT d.dat_id_jubilado)
   FROM RPJ_MNT_DATOS_PLANILLA d
   INNER JOIN RPJ_MNT_JUBILADO j ON j.jub_correlativo = d.dat_id_jubilado
   WHERE d.dat_tipo_manejo = 2 AND d.dat_aplica_nomina = 1 AND UPPER(COALESCE(j.jub_estado,'')) = 'ACTIVO') AS con_datos_planilla,
  ppl_porcentaje_pago                                                                                       AS porcentaje_pago,
  ppl_estado_proceso                                                                                         AS estado_proceso
FROM RPJ_CAT_PARAMETRO_PLANILLA
WHERE ppl_correlativo = ?;
