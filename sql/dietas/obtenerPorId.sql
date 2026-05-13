SELECT
  d.die_correlativo,
  d.die_id_junta_directiva,
  d.die_fecha_sesion,
  d.die_fecha_pago,
  d.die_sesiones_mes,
  d.die_acta,
  d.die_valor,
  d.die_retencion_isr,
  d.die_liquido,
  d.die_total,
  d.die_fecha_creacion,
  d.die_usuario_creacion,
  j.jun_nombre,
  j.jun_apellidos,
  j.jun_puesto
FROM RPJ_MNT_DIETA d
LEFT JOIN RPJ_MNT_JUNTA_DIRECTIVA j ON j.jun_correlativo = d.die_id_junta_directiva
WHERE d.die_correlativo = ?;
