SELECT
  e.emp_correlativo,
  e.emp_tipo_manejo,
  e.emp_id,
  e.emp_nombres,
  e.emp_apellidos,
  e.emp_direccion,
  e.emp_nit,
  e.emp_dpi,
  e.emp_estado_civil,
  e.emp_profesion_oficio,
  e.emp_fecha_nacimiento,
  e.emp_sexo,
  e.emp_tipo_puesto,
  e.emp_id_puesto,
  e.emp_fecha_creacion,
  e.emp_usuario_creacion,
  m.man_descripcion AS manejo_descripcion,
  p.pue_nombre AS puesto_nombre,
  a.are_descripcion AS area_descripcion
FROM RPJ_MNT_EMPLEADO e
LEFT JOIN RPJ_CAT_MANEJO_ADMINISTRACION m ON m.man_id = e.emp_tipo_manejo
LEFT JOIN RPJ_CAT_PUESTO p ON p.pue_id = e.emp_id_puesto
LEFT JOIN RPJ_CAT_AREA a ON a.are_id = p.pue_id_area
ORDER BY e.emp_id ASC;
