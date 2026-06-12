SELECT pre_correlativo
FROM RPJ_MNT_PRESTAMO
WHERE pre_id_aportacion = ?
  AND pre_estado IN ('ACTIVO', 'MORA')
LIMIT 1;
