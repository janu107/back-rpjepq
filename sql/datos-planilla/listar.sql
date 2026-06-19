SELECT
  d.dat_correlativo,
  d.dat_tipo_manejo,
  d.dat_id_empleado,
  d.dat_id_jubilado,
  d.dat_id_banco,
  d.dat_forma_pago,
  d.dat_cuenta,
  d.dat_tipo_cuenta,
  d.dat_aplica_desc_igss,
  d.dat_aplica_desc_isr,
  d.dat_aplica_intecap,
  d.dat_aplica_dasociacion,
  d.dat_aplica_seguro,
  d.dat_no_probidad,
  d.dat_no_sobrevivencia,
  d.dat_aplica_nomina,
  d.dat_fecha_creacion,
  d.dat_usuario_creacion,
  b.ban_descripcion AS banco_nombre,
  m.man_descripcion AS manejo_descripcion,
  COALESCE(
    CONCAT(e.emp_nombres, ' ', e.emp_apellidos),
    CONCAT(j.jub_nombres, ' ', j.jub_apellidos)
  ) AS persona_nombre
FROM RPJ_MNT_DATOS_PLANILLA d
LEFT JOIN RPJ_CAT_BANCOS b ON b.ban_id = d.dat_id_banco
LEFT JOIN RPJ_CAT_MANEJO_ADMINISTRACION m ON m.man_id = d.dat_tipo_manejo
LEFT JOIN RPJ_MNT_EMPLEADO e ON e.emp_correlativo = d.dat_id_empleado
LEFT JOIN RPJ_MNT_JUBILADO j ON j.jub_correlativo = d.dat_id_jubilado
ORDER BY d.dat_correlativo DESC;
