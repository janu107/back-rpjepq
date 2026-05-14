SELECT
  d.die_correlativo,
  d.die_id_junta_directiva,
  d.die_fecha_sesion,
  d.die_fecha_pago,
  d.die_valor,
  d.die_liquido,
  d.die_total,
  j.jun_nombre,
  j.jun_apellidos,
  j.jun_puesto
FROM RPJ_MNT_DIETA d
LEFT JOIN RPJ_MNT_JUNTA_DIRECTIVA j ON j.jun_correlativo = d.die_id_junta_directiva
WHERE DATE(d.die_fecha_pago) BETWEEN ? AND ?
ORDER BY d.die_correlativo;
