INSERT INTO RPJ_MNT_PRESTAMO (
  pre_id_aportacion,
  pre_no_contrato,
  pre_monto_autorizado,
  pre_cuota_nivelada,
  pre_plazo_meses,
  pre_fecha_inicio,
  pre_fecha_fin,
  pre_total_pagar,
  pre_tasa_interes,
  pre_estado,
  pre_usuario_creacion
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
