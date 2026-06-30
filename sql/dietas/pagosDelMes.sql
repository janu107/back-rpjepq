-- Dietas maestro-detalle: pagos (encabezados) de un periodo (YYYY-MM).
SELECT
  d.vdi_correlativo,
  d.vdi_id_junta_directiva,
  d.vdi_periodo,
  d.vdi_total_sesiones,
  d.vdi_valor,
  d.vdi_isr,
  d.vdi_valor_pago,
  d.vdi_estado,
  d.vdi_no_documento,
  d.vdi_tipo_documento,
  d.vdi_banco,
  d.vdi_fecha_pago,
  d.vdi_fecha_recibido,
  d.vdi_observaciones,
  j.jun_nombre,
  j.jun_apellidos,
  j.jun_puesto
FROM RPJ_MNT_DIETA d
LEFT JOIN RPJ_MNT_JUNTA_DIRECTIVA j ON j.jun_correlativo = d.vdi_id_junta_directiva
WHERE d.vdi_periodo = ?
ORDER BY j.jun_apellidos ASC, j.jun_nombre ASC;
