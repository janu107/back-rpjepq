SELECT
  p.pre_correlativo,
  p.pre_id_aportacion,
  p.pre_no_contrato,
  p.pre_monto_autorizado,
  p.pre_cuota_nivelada,
  p.pre_plazo_meses,
  p.pre_fecha_inicio,
  p.pre_fecha_fin,
  p.pre_total_pagar,
  p.pre_tasa_interes,
  p.pre_estado,
  p.pre_fecha_creacion,
  p.pre_usuario_creacion,
  a.apo_nombre,
  a.apo_apellido,
  a.apo_dpi
FROM RPJ_MNT_PRESTAMO p
INNER JOIN RPJ_MNT_APORTACION_EPQ a ON a.apo_correlativo = p.pre_id_aportacion
WHERE p.pre_correlativo = ?;
