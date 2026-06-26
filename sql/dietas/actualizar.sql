-- Pago de Dietas (modelo vdi_*): actualizar encabezado de pago.
UPDATE RPJ_MNT_DIETA
SET
  vdi_id_junta_directiva = ?,
  vdi_total_sesiones = ?,
  vdi_valor = ?,
  vdi_isr = ?,
  vdi_valor_pago = ?,
  vdi_no_documento = ?,
  vdi_tipo_documento = ?,
  vdi_banco = ?,
  vdi_fecha_pago = ?,
  vdi_fecha_recibido = ?,
  vdi_estado = ?,
  vdi_observaciones = ?
WHERE vdi_correlativo = ?;
