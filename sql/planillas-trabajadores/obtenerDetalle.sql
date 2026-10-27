SELECT
  id_empleado,
  (SELECT e.emp_id FROM RPJ_MNT_EMPLEADO e WHERE e.emp_correlativo = id_empleado) AS codigo,
  emp_dpi,
  nombre_completo,
  emp_fecha_ingreso,
  puesto,
  dias_trabajados,
  total_ingresos,
  total_descuentos,
  neto_a_pagar,
  estado_planilla
FROM v_neto_pagar_trabajadores
WHERE nin_id_planilla = ?
ORDER BY nombre_completo ASC;
