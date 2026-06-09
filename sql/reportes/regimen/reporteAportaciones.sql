SELECT
  a.apo_correlativo,
  a.apo_id,
  a.apo_nombre,
  a.apo_apellido,
  a.apo_dpi,
  a.apo_gerencia,
  a.apo_estado,
  a.apo_fecha_inicio_aportacion,
  a.apo_fecha_fin_aportacion,
  a.apo_tiene_prestamo,
  IFNULL(SUM(d.dap_valor), 0) AS total_aportado,
  COUNT(d.dap_correlativo) AS cantidad_aportes,
  m.man_descripcion AS manejo_descripcion
FROM RPJ_MNT_APORTACION_EPQ a
LEFT JOIN RPJ_MNT_DETALLE_APORTACION_EPQ d ON d.dap_id_aportacion = a.apo_correlativo
LEFT JOIN RPJ_CAT_MANEJO_ADMINISTRACION m ON m.man_id = a.apo_tipo_manejo
/*WHERE_CLAUSE*/
GROUP BY
  a.apo_correlativo, a.apo_id, a.apo_nombre, a.apo_apellido,
  a.apo_dpi, a.apo_gerencia, a.apo_estado, a.apo_fecha_inicio_aportacion,
  a.apo_fecha_fin_aportacion, a.apo_tiene_prestamo, m.man_descripcion
ORDER BY a.apo_correlativo DESC;
