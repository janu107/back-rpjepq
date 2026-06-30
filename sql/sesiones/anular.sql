-- Dietas maestro-detalle: anular sesión (no se elimina; queda como ANULADA).
-- El recálculo posterior excluye las sesiones ANULADAS de los pagos PENDIENTE.
UPDATE RPJ_MNT_SESION
SET ses_estado = 'ANULADA'
WHERE ses_correlativo = ? AND ses_estado = 'ACTIVA';
