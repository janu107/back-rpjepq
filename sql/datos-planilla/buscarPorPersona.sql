SELECT
  d.dpl_id,
  d.dpl_tipo_manejo,
  d.dpl_tipo_persona,
  d.dpl_id_persona,
  d.dpl_id_banco,
  d.dpl_no_cuenta,
  d.dpl_forma_pago,
  d.dpl_tipo_cuenta,
  d.dpl_estado,
  d.dpl_fecha_creacion,
  d.dpl_usuario_creacion,
  b.ban_nombre AS banco_nombre
FROM RPJ_MNT_DATOS_PLANILLA d
LEFT JOIN RPJ_CAT_BANCOS b ON b.ban_id = d.dpl_id_banco
WHERE d.dpl_tipo_persona = ? AND d.dpl_id_persona = ?
ORDER BY d.dpl_id DESC
LIMIT 1;
