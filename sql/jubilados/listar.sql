SELECT
  j.jub_correlativo,
  j.jub_tipo_manejo,
  j.jub_id,
  j.jub_nombres,
  j.jub_apellidos,
  j.jub_fecha_nacimiento,
  j.jub_sexo,
  j.jub_dpi,
  j.jub_direccion,
  j.jub_profesion_oficio,
  j.jub_estado_civil,
  j.jub_estado,
  j.jub_fecha_jubilacion,
  j.jub_tipo_jubilacion,
  j.jub_fecha_creacion,
  j.jub_usuario_creacion,
  m.man_descripcion AS manejo_descripcion,
  tj.tju_descripcion AS tipo_jubilacion_descripcion
FROM RPJ_MNT_JUBILADO j
LEFT JOIN RPJ_CAT_MANEJO_ADMINISTRACION m ON m.man_id = j.jub_tipo_manejo
LEFT JOIN RPJ_CAT_TIPO_JUBILACION tj ON tj.tju_id = j.jub_tipo_jubilacion
ORDER BY j.jub_correlativo DESC;
