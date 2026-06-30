-- Dietas maestro-detalle: crea el encabezado mensual mínimo (PENDIENTE) de un miembro.
-- Los montos quedan en 0 y se calculan al registrar asistencia / recalcular.
INSERT INTO RPJ_MNT_DIETA (
  vdi_id_junta_directiva,
  vdi_periodo,
  vdi_estado,
  vdi_total_sesiones,
  vdi_valor,
  vdi_isr,
  vdi_valor_pago,
  vdi_usuario_creacion
)
VALUES (?, ?, 'PENDIENTE', 0, 0.00, 0.00, 0.00, ?);
