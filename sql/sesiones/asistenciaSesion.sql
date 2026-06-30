-- Dietas maestro-detalle: asistentes registrados en una sesión, con el encabezado
-- de pago al que pertenecen (para reconciliar asistencia y recalcular).
SELECT
  det.die_correlativo,
  det.die_id_dieta,
  d.vdi_id_junta_directiva AS jun_id,
  d.vdi_periodo,
  d.vdi_estado,
  j.jun_nombre,
  j.jun_apellidos,
  j.jun_puesto
FROM RPJ_MNT_DIETA_DET det
INNER JOIN RPJ_MNT_DIETA d ON d.vdi_correlativo = det.die_id_dieta
LEFT JOIN RPJ_MNT_JUNTA_DIRECTIVA j ON j.jun_correlativo = d.vdi_id_junta_directiva
WHERE det.die_id_sesion = ?;
