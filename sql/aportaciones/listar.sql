SELECT
  a.apo_correlativo,
  a.apo_tipo_manejo,
  a.apo_id,
  a.apo_nombre,
  a.apo_apellido,
  a.apo_dpi,
  a.apo_gerencia,
  a.apo_fecha_inicio_aportacion,
  a.apo_fecha_fin_aportacion,
  a.apo_estado,
  a.apo_tiene_prestamo,
  a.apo_motivo_retiro,
  a.apo_fecha_nacimiento,
  a.apo_ubicacion,
  a.apo_fecha_creacion,
  a.apo_usuario_creacion,
  m.man_descripcion AS manejo_descripcion
FROM RPJ_MNT_APORTACION_EPQ a
LEFT JOIN RPJ_CAT_MANEJO_ADMINISTRACION m ON m.man_id = a.apo_tipo_manejo
ORDER BY a.apo_correlativo DESC;
