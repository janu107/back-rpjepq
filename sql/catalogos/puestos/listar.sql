SELECT
  p.pue_id,
  p.pue_tipo_manejo,
  p.pue_nombre,
  p.pue_funcion,
  p.pue_id_area,
  p.pue_fecha_creacion,
  p.pue_usuario_creacion,
  a.are_descripcion AS area_descripcion,
  m.man_descripcion AS manejo_descripcion
FROM RPJ_CAT_PUESTO p
LEFT JOIN RPJ_CAT_AREA a ON a.are_id = p.pue_id_area
LEFT JOIN RPJ_CAT_MANEJO_ADMINISTRACION m ON m.man_id = p.pue_tipo_manejo
ORDER BY p.pue_id DESC;
