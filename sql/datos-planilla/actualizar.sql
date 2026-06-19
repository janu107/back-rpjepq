UPDATE RPJ_MNT_DATOS_PLANILLA
SET
  dat_id_banco = ?,
  dat_forma_pago = ?,
  dat_cuenta = ?,
  dat_tipo_cuenta = ?,
  dat_aplica_desc_igss = ?,
  dat_aplica_desc_isr = ?,
  dat_aplica_intecap = ?,
  dat_aplica_dasociacion = ?,
  dat_aplica_seguro = ?,
  dat_no_probidad = ?,
  dat_no_sobrevivencia = ?,
  dat_aplica_nomina = ?
WHERE dat_correlativo = ?;
