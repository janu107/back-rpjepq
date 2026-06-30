-- Dietas maestro-detalle: valida acta única (excluye la sesión en edición).
SELECT ses_correlativo
FROM RPJ_MNT_SESION
WHERE UPPER(ses_acta) = UPPER(?)
  AND ses_correlativo <> ?;
