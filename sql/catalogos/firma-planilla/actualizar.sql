UPDATE RPJ_CAT_FIRMA_PLANILLA
SET
  fpl_tipo_manejo = ?,
  fpl_id = ?,
  fpl_nombre = ?,
  fpl_puesto = ?,
  fpl_tipo = ?
WHERE fpl_correlativo = ?;
