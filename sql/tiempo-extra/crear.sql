-- Tiempo extraordinario: tex_fecha_hora_inicio/final se derivan del mes de la
-- fecha de pago (primer y último día del mes). tex_tipo_hora: 1=NORMAL, 2=DOBLE.
INSERT INTO RPJ_MNT_TIEMPO_EXTRAORDINARIO (
  tex_id_empleado,
  tex_fecha_hora_inicio,
  tex_fecha_hora_final,
  tex_cantidad_horas,
  tex_motivo,
  tex_tipo_hora,
  tex_fecha_pago,
  tex_usuario_creacion
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?);
