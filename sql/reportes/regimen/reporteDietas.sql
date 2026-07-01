-- Reporte de Pago de Dietas (modelo vdi_*: encabezado de pago mensual por miembro).
SELECT
  d.vdi_correlativo,
  d.vdi_periodo,
  d.vdi_fecha_pago,
  d.vdi_total_sesiones,
  d.vdi_valor,
  d.vdi_isr,
  d.vdi_valor_pago,
  d.vdi_estado,
  d.vdi_fecha_creacion,
  CONCAT(j.jun_nombre, ' ', j.jun_apellidos) AS miembro_nombre,
  j.jun_puesto,
  j.jun_tipo_junta,
  m.man_descripcion AS manejo_descripcion
FROM RPJ_MNT_DIETA d
LEFT JOIN RPJ_MNT_JUNTA_DIRECTIVA j ON j.jun_correlativo = d.vdi_id_junta_directiva
LEFT JOIN RPJ_CAT_MANEJO_ADMINISTRACION m ON m.man_id = j.jun_tipo_manejo
/*WHERE_CLAUSE*/
ORDER BY d.vdi_correlativo DESC;
