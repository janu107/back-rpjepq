SELECT
  t.tpl_id,
  t.tpl_tipo_planilla,
  t.tpl_descripcion,
  t.tpl_id_tipo_uso,
  t.tpl_fecha_creacion,
  t.tpl_usuario_creacion,
  m.man_descripcion AS tipo_uso_descripcion
FROM RPJ_CAT_TIPO_PLANILLA t
LEFT JOIN RPJ_CAT_MANEJO_ADMINISTRACION m ON m.man_id = t.tpl_id_tipo_uso
WHERE t.tpl_id = ?;
