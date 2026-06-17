SELECT
  id, tipo_planilla, tipo_planilla_nombre, tipo_planilla_descripcion,
  numero, fecha_inicio, fecha_final, fecha_pago, frecuencia, estado,
  aplica_porcentaje, porcentaje_pago, estado_proceso,
  fecha_generacion, fecha_cierre, usuario_genera, usuario_cierra,
  fecha_creacion, usuario_creacion,
  total_jubilados, total_ingresos, total_descuentos, neto_a_pagar
FROM V_PLANILLAS_PENSIONADOS
ORDER BY id DESC;
