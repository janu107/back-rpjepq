SELECT
  f.fpl_correlativo,
  f.fpl_tipo_manejo,
  f.fpl_id,
  f.fpl_nombre,
  f.fpl_puesto,
  f.fpl_tipo,
  f.fpl_fecha_creacion,
  f.fpl_usuario_creacion,
  m.man_descripcion AS manejo_descripcion
FROM RPJ_CAT_FIRMA_PLANILLA f
LEFT JOIN RPJ_CAT_MANEJO_ADMINISTRACION m ON m.man_id = f.fpl_tipo_manejo
ORDER BY f.fpl_correlativo ASC;
