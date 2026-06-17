SELECT
  deu_correlativo      AS id,
  deu_id_jubilado      AS idJubilado,
  deu_periodo          AS periodo,
  deu_monto_original   AS montoOriginal,
  deu_monto_pagado     AS montoPagado,
  deu_monto_pendiente  AS montoPendiente,
  deu_estado           AS estado,
  deu_fecha_generacion AS fechaGeneracion,
  deu_fecha_saldada    AS fechaSaldada
FROM RPJ_PRC_DEUDA_JUBILADO
WHERE deu_id_jubilado = ?
ORDER BY deu_periodo ASC;
