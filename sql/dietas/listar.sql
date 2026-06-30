-- Pago de Dietas (modelo vdi_*: encabezado de pago mensual por miembro de junta).
SELECT
  d.vdi_correlativo,
  d.vdi_id_junta_directiva,
  d.vdi_no_documento,
  d.vdi_tipo_documento,
  d.vdi_banco,
  d.vdi_fecha_pago,
  d.vdi_fecha_recibido,
  d.vdi_total_sesiones,
  d.vdi_valor,
  d.vdi_isr,
  d.vdi_valor_pago,
  d.vdi_estado,
  d.vdi_observaciones,
  d.vdi_periodo,
  d.vdi_fecha_creacion,
  d.vdi_usuario_creacion,
  j.jun_nombre,
  j.jun_apellidos,
  j.jun_puesto
FROM RPJ_MNT_DIETA d
LEFT JOIN RPJ_MNT_JUNTA_DIRECTIVA j ON j.jun_correlativo = d.vdi_id_junta_directiva
ORDER BY d.vdi_correlativo DESC;
