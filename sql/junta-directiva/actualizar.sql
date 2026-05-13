UPDATE RPJ_MNT_JUNTA_DIRECTIVA
SET
  jun_tipo_manejo = ?,
  jun_id = ?,
  jun_nombre = ?,
  jun_apellidos = ?,
  jun_tipo_junta = ?,
  jun_nit = ?,
  jun_puesto = ?,
  jun_estado = ?,
  jun_fecha_inicio = ?,
  jun_fecha_final = ?
WHERE jun_correlativo = ?;
