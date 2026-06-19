SELECT
  id_empleado,
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
