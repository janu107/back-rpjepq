-- Dietas maestro-detalle: marca recibido (PAGADO -> RECIBIDO).
UPDATE RPJ_MNT_DIETA
SET vdi_fecha_recibido = ?,
    vdi_estado         = 'RECIBIDO'
WHERE vdi_correlativo = ? AND vdi_estado = 'PAGADO';
