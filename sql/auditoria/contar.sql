SELECT COUNT(*) AS total
FROM RPJ_SEG_AUDITORIA
WHERE (? IS NULL OR aud_usuario LIKE CONCAT('%', ?, '%'))
  AND (? IS NULL OR aud_modulo = ?)
  AND (? IS NULL OR aud_accion = ?)
  AND (? IS NULL OR DATE(aud_fecha) >= ?)
  AND (? IS NULL OR DATE(aud_fecha) <= ?);
