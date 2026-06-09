UPDATE RPJ_MNT_DESC_JUDICIALES
SET
  dju_tipo_manejo = ?,
  dju_tipo_persona = ?,
  dju_id_persona = ?,
  dju_expediente = ?,
  dju_juzgado = ?,
  dju_monto = ?,
  dju_descripcion = ?,
  dju_estado = ?
WHERE dju_id = ?;
