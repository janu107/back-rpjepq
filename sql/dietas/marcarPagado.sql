-- Dietas maestro-detalle: emite el pago (PENDIENTE -> PAGADO) con comprobante.
UPDATE RPJ_MNT_DIETA
SET vdi_no_documento   = ?,
    vdi_tipo_documento = ?,
    vdi_banco          = ?,
    vdi_fecha_pago     = ?,
    vdi_estado         = 'PAGADO'
WHERE vdi_correlativo = ? AND vdi_estado = 'PENDIENTE';
