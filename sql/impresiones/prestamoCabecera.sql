-- Cabecera del estado de cuenta de un préstamo de empleado EPQ. Params: [idPrestamo].
SELECT
  p.pre_correlativo      AS id,
  p.pre_no_contrato      AS no_contrato,
  p.pre_monto_autorizado AS monto_autorizado,
  p.pre_cuota_nivelada   AS cuota_nivelada,
  p.pre_plazo_meses      AS plazo_meses,
  p.pre_fecha_inicio     AS fecha_inicio,
  p.pre_fecha_fin        AS fecha_fin,
  p.pre_total_pagar      AS total_pagar,
  p.pre_tasa_interes     AS tasa_interes,
  p.pre_estado           AS estado,
  a.apo_correlativo      AS id_aportacion,
  a.apo_id               AS codigo,
  CONCAT(a.apo_nombre, ' ', a.apo_apellido) AS cliente,
  a.apo_dpi              AS dpi,
  a.apo_gerencia         AS gerencia
FROM RPJ_MNT_PRESTAMO p
INNER JOIN RPJ_MNT_APORTACION_EPQ a ON a.apo_correlativo = p.pre_id_aportacion
WHERE p.pre_correlativo = ?;
