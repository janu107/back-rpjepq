SELECT
  j.jun_correlativo,
  j.jun_id,
  j.jun_nombre,
  j.jun_apellidos,
  j.jun_tipo_junta,
  j.jun_nit,
  j.jun_puesto,
  j.jun_estado,
  j.jun_fecha_inicio,
  j.jun_fecha_final,
  j.jun_fecha_creacion,
  m.man_descripcion AS manejo_descripcion
FROM RPJ_MNT_JUNTA_DIRECTIVA j
LEFT JOIN RPJ_CAT_MANEJO_ADMINISTRACION m ON m.man_id = j.jun_tipo_manejo
/*WHERE_CLAUSE*/
ORDER BY j.jun_correlativo DESC;
