INSERT INTO RPJ_MNT_PRESTAMOS_REGIMEN (
  prr_tipo_manejo,
  prr_tipo_persona,
  prr_id_persona,
  prr_id_banco,
  prr_no_contrato,
  prr_monto,
  prr_cuota,
  prr_plazo_meses,
  prr_fecha_inicio,
  prr_fecha_fin,
  prr_tasa_interes,
  prr_estado,
  prr_observaciones,
  prr_usuario_creacion
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
