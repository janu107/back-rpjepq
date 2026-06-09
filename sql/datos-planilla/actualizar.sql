UPDATE RPJ_MNT_DATOS_PLANILLA
SET
  dat_id_banco = ?,
  dat_forma_pago = ?,
  dat_cuenta = ?,
  dat_tipo_cuenta = ?,
  dat_aplica_desc_igss = ?,
  dat_aplica_desc_isr = ?,
  dat_aplica_seguro = ?,
  dat_no_probidad = ?,
  dat_no_sobrevivencia = ?
WHERE dat_correlativo = ?;
