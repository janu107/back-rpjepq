-- Ficha del empleado EPQ para el estado de cuenta de aportaciones.
-- El "área" de un empleado EPQ es su gerencia (apo_gerencia).
-- Params: [idAportacion].
SELECT
  a.apo_correlativo AS id,
  a.apo_id          AS codigo,
  CONCAT(a.apo_nombre, ' ', a.apo_apellido) AS nombre,
  a.apo_dpi         AS dpi,
  a.apo_gerencia    AS area,
  a.apo_estado      AS estado,
  a.apo_fecha_inicio_aportacion AS fecha_inicio,
  a.apo_fecha_fin_aportacion    AS fecha_fin,
  m.man_descripcion AS manejo
FROM RPJ_MNT_APORTACION_EPQ a
LEFT JOIN RPJ_CAT_MANEJO_ADMINISTRACION m ON m.man_id = a.apo_tipo_manejo
WHERE a.apo_correlativo = ?;
