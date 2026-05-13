SELECT
  tpl_id,
  tpl_tipo_planilla,
  tpl_descripcion,
  tpl_id_tipo_uso,
  tpl_fecha_creacion,
  tpl_usuario_creacion
FROM RPJ_CAT_TIPO_PLANILLA
WHERE tpl_id = ?;
