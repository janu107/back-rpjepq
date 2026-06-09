SELECT
  d.die_correlativo,
  d.die_fecha_sesion,
  d.die_fecha_pago,
  d.die_sesiones_mes,
  d.die_acta,
  d.die_valor,
  d.die_retencion_isr,
  d.die_liquido,
  d.die_fecha_creacion,
  CONCAT(j.jun_nombre, ' ', j.jun_apellidos) AS miembro_nombre,
  j.jun_puesto,
  j.jun_tipo_junta,
  m.man_descripcion AS manejo_descripcion
FROM RPJ_MNT_DIETA d
LEFT JOIN RPJ_MNT_JUNTA_DIRECTIVA j ON j.jun_correlativo = d.die_id_junta_directiva
LEFT JOIN RPJ_CAT_MANEJO_ADMINISTRACION m ON m.man_id = j.jun_tipo_manejo
/*WHERE_CLAUSE*/
ORDER BY d.die_correlativo DESC;
