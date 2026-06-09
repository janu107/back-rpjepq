SELECT
  d.dat_correlativo,
  d.dat_tipo_manejo,
  d.dat_id_empleado,
  d.dat_id_banco,
  d.dat_forma_pago,
  d.dat_cuenta,
  d.dat_tipo_cuenta,
  d.dat_aplica_desc_igss,
  d.dat_aplica_desc_isr,
  d.dat_aplica_seguro,
  d.dat_no_probidad,
  d.dat_no_sobrevivencia,
  d.dat_fecha_creacion,
  d.dat_usuario_creacion,
  b.ban_descripcion AS banco_nombre
FROM RPJ_MNT_DATOS_PLANILLA d
LEFT JOIN RPJ_CAT_BANCOS b ON b.ban_id = d.dat_id_banco
WHERE d.dat_tipo_manejo = ? AND d.dat_id_empleado = ?
ORDER BY d.dat_correlativo DESC
LIMIT 1;
