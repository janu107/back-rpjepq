SELECT
  p.prr_correlativo,
  p.prr_no_referencia,
  p.prr_monto,
  p.prr_valor_mes,
  p.prr_saldo,
  p.prr_no_cuotas,
  p.prr_fecha_inicio,
  p.prr_fecha_fin,
  p.prr_uso,
  p.prr_estado,
  p.prr_fecha_creacion,
  m.man_descripcion AS manejo_descripcion,
  b.ban_descripcion AS banco_nombre,
  CASE
    WHEN UPPER(m.man_descripcion) LIKE '%JUBILAD%'
      THEN COALESCE(CONCAT(j.jub_nombres, ' ', j.jub_apellidos), CONCAT(e.emp_nombres, ' ', e.emp_apellidos))
    ELSE COALESCE(CONCAT(e.emp_nombres, ' ', e.emp_apellidos), CONCAT(j.jub_nombres, ' ', j.jub_apellidos))
  END AS persona_nombre
FROM RPJ_MNT_PRESTAMOS_REGIMEN p
LEFT JOIN RPJ_CAT_MANEJO_ADMINISTRACION m ON m.man_id = p.prr_tipo_manejo
LEFT JOIN RPJ_CAT_BANCOS b ON b.ban_id = p.prr_id_banco
LEFT JOIN RPJ_MNT_EMPLEADO e ON e.emp_correlativo = p.prr_id_empleado
LEFT JOIN RPJ_MNT_JUBILADO j ON j.jub_correlativo = p.prr_id_empleado
/*WHERE_CLAUSE*/
ORDER BY p.prr_correlativo DESC;
