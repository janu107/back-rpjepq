-- Dietas maestro-detalle: limpia la asistencia de una sesión antes de re-sincronizar.
DELETE FROM RPJ_MNT_DIETA_DET
WHERE die_id_sesion = ?;
