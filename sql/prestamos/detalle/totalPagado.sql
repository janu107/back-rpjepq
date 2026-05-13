SELECT COALESCE(SUM(dpr_cuota_nivelada), 0) AS total_pagado
FROM RPJ_MNT_DETALLE_PRESTAMO
WHERE dpr_id_prestamo = ?;
