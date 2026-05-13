UPDATE RPJ_MNT_TIEMPO_EXTRAORDINARIO
SET
  tex_id_empleado = ?,
  tex_fecha_hora_inicio = ?,
  tex_fecha_hora_final = ?,
  tex_cantidad_horas = ?,
  tex_motivo = ?,
  tex_tipo_hora = ?
WHERE tex_correlativo = ?;
