-- Dietas maestro-detalle: registra la asistencia de un miembro a una sesión.
-- die_valor = par_pago_dieta vigente al momento del registro (no se hardcodea).
INSERT INTO RPJ_MNT_DIETA_DET (
  die_id_dieta,
  die_id_sesion,
  die_valor,
  die_usuario_creacion
)
VALUES (?, ?, ?, ?);
