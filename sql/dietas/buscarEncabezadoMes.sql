-- Dietas maestro-detalle: encabezado PENDIENTE de un miembro para un periodo (YYYY-MM).
SELECT vdi_correlativo
FROM RPJ_MNT_DIETA
WHERE vdi_id_junta_directiva = ?
  AND vdi_periodo = ?
  AND vdi_estado = 'PENDIENTE'
ORDER BY vdi_correlativo ASC
LIMIT 1;
