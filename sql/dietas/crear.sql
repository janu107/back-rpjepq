-- Pago de Dietas (modelo vdi_*): crear encabezado de pago.
-- valor/isr/valor_pago los calcula el backend desde par_pago_dieta y par_isr.
INSERT INTO RPJ_MNT_DIETA (
  vdi_id_junta_directiva,
  vdi_total_sesiones,
  vdi_valor,
  vdi_isr,
  vdi_valor_pago,
  vdi_no_documento,
  vdi_tipo_documento,
  vdi_banco,
  vdi_fecha_pago,
  vdi_fecha_recibido,
  vdi_estado,
  vdi_observaciones,
  vdi_usuario_creacion
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
