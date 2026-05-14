SELECT
  e.emp_correlativo,
  e.emp_tipo_manejo,
  e.emp_nombres,
  e.emp_apellidos,
  e.emp_dpi,
  e.emp_tipo_puesto,
  p.pue_nombre AS puesto_nombre,
  a.are_descripcion AS area_descripcion
FROM RPJ_MNT_EMPLEADO e
LEFT JOIN RPJ_CAT_PUESTO p ON p.pue_id = e.emp_id_puesto
LEFT JOIN RPJ_CAT_AREA a ON a.are_id = p.pue_id_area
WHERE e.emp_tipo_manejo = ?
ORDER BY e.emp_correlativo;
