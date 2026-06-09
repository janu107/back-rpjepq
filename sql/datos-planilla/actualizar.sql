UPDATE RPJ_MNT_DATOS_PLANILLA
SET
  dpl_tipo_manejo = ?,
  dpl_id_banco = ?,
  dpl_no_cuenta = ?,
  dpl_forma_pago = ?,
  dpl_tipo_cuenta = ?,
  dpl_estado = ?
WHERE dpl_id = ?;
