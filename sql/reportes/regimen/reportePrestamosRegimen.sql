SELECT
  p.prr_id,
  p.prr_no_contrato,
  p.prr_tipo_persona,
  p.prr_monto,
  p.prr_cuota,
  p.prr_plazo_meses,
  p.prr_fecha_inicio,
  p.prr_fecha_fin,
  p.prr_tasa_interes,
  p.prr_estado,
  p.prr_observaciones,
  p.prr_fecha_creacion,
  m.man_descripcion AS manejo_descripcion,
  b.ban_nombre AS banco_nombre,
  CASE
    WHEN p.prr_tipo_persona = 'EMPLEADO' THEN CONCAT(e.emp_nombres, ' ', e.emp_apellidos)
    WHEN p.prr_tipo_persona = 'JUBILADO' THEN CONCAT(j.jub_nombres, ' ', j.jub_apellidos)
    ELSE NULL
  END AS persona_nombre
FROM RPJ_MNT_PRESTAMOS_REGIMEN p
LEFT JOIN RPJ_CAT_MANEJO_ADMINISTRACION m ON m.man_id = p.prr_tipo_manejo
LEFT JOIN RPJ_CAT_BANCOS b ON b.ban_id = p.prr_id_banco
LEFT JOIN RPJ_MNT_EMPLEADO e ON p.prr_tipo_persona = 'EMPLEADO' AND e.emp_correlativo = p.prr_id_persona
LEFT JOIN RPJ_MNT_JUBILADO j ON p.prr_tipo_persona = 'JUBILADO' AND j.jub_correlativo = p.prr_id_persona
/*WHERE_CLAUSE*/
ORDER BY p.prr_id DESC;
