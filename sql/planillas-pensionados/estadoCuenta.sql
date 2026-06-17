SELECT
  id_jubilado, nombre_completo, dpi,
  meses_totales, meses_pagados, meses_pendientes,
  monto_original_total, monto_pagado_total, deuda_pendiente_total,
  periodo_mas_antiguo_pendiente
FROM V_ESTADO_CUENTA_PENSIONADO
WHERE id_jubilado = ?;
